const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');
const { randomUUID } = require('node:crypto');

const root = path.resolve(process.env.HARNESS_APP_ROOT || __dirname);
const workspaceRoot = path.resolve(process.env.HARNESS_WORKSPACE || root);
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const boardFile = path.join(workspaceRoot, 'data', 'board.json');
const projectsFile = path.join(workspaceRoot, 'data', 'projects.json');
const publicFiles = new Set(['index.html', 'style.css', 'app.js', 'board.js', 'project.js', 'planner.js', 'i18n.js', 'favicon.svg', 'manifest.json', 'sw.js']);
const defaultBoard = {
  columns: [
    { id: 'inbox', title: 'Идеи', tone: 'muted' },
    { id: 'ready', title: 'Готово', tone: 'blue' },
    { id: 'working', title: 'В работе', tone: 'green' },
    { id: 'approval', title: 'Ожидает решения', tone: 'amber' },
    { id: 'review', title: 'Проверка', tone: 'amber' },
    { id: 'blocked', title: 'Заблокировано', tone: 'red' },
    { id: 'done', title: 'Завершено', tone: 'done' }
  ],
  cards: [],
  events: []
};
const controlStatuses = { pause: 'paused', resume: 'working', cancel: 'cancelled', retry: 'ready', complete: 'completed', return: 'working' };
const staleTaskMs = 30 * 60 * 1000;
const autoDispatchEnabled = process.env.HARNESS_AUTO_DISPATCH !== 'false';
const autoDispatchIntervalMs = Number(process.env.HARNESS_AUTO_DISPATCH_INTERVAL_MS || 1500);
const dispatchLocks = new Set();
const executorRules = { codex: { priority: 1 }, ide: { priority: 2 }, powershell: { priority: 3 }, cli: { priority: 3 }, human: { priority: 4 } };
const policyProfiles = {
  safe: { label: 'Строго безопасный', allowAutonomous: true, allowShell: false, allowedAdapters: ['git-status', 'npm-test'] },
  development: { label: 'Обычная разработка', allowAutonomous: true, allowShell: true, allowedAdapters: ['git-status', 'npm-test', 'npm-lint', 'npm-build'] },
  manual: { label: 'Полный ручной контроль', allowAutonomous: false, allowShell: true, allowedAdapters: ['git-status', 'npm-test', 'npm-lint', 'npm-build'] }
};
function projectPolicy(project) { const base = policyProfiles[project.policy] || policyProfiles.development; return { ...base, allowedAdapters: Array.isArray(project.allowedAdapters) ? project.allowedAdapters.filter((adapter) => base.allowedAdapters.includes(adapter)) : base.allowedAdapters }; }

function ensureBoard() {
  fs.mkdirSync(path.dirname(boardFile), { recursive: true });
  if (!fs.existsSync(boardFile)) fs.writeFileSync(boardFile, JSON.stringify(defaultBoard, null, 2));
}
function readBoard() { ensureBoard(); try { return JSON.parse(fs.readFileSync(boardFile, 'utf8')); } catch { return defaultBoard; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value, null, 2)); fs.renameSync(temporary, file); }
function writeText(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; fs.writeFileSync(temporary, value); fs.renameSync(temporary, file); }
function backupFile(file, backupDir, prefix) { if (!fs.existsSync(file)) return; fs.mkdirSync(backupDir, { recursive: true }); let name = `${prefix}-${Date.now()}`; let suffix = 0; while (fs.existsSync(path.join(backupDir, `${name}.bak`))) name = `${prefix}-${Date.now()}-${++suffix}`; fs.copyFileSync(file, path.join(backupDir, `${name}.bak`)); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function fileHealth(file) { try { JSON.parse(fs.readFileSync(file, 'utf8')); return { valid: true }; } catch (error) { return { valid: false, error: error.message }; } }
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48) || 'project'; }
function harnessDirFor(project) { return path.join(project.path, '.harness'); }
function runDir(project, runId) { return path.join(harnessDirFor(project), 'runs', runId); }
function workerLeasePath(project) { return path.join(harnessDirFor(project), 'worker-lease.json'); }
function createRun(project, input, status = 'queued') { const runId = input.runId || `run-${Date.now()}-${randomUUID().slice(0, 8)}`; const run = { runId, projectId: project.id, taskId: input.taskId, title: input.title || '', executor: input.executor || 'codex', priority: input.priority || 'medium', dueDate: input.dueDate || null, status, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }; fs.mkdirSync(runDir(project, runId), { recursive: true }); writeJson(path.join(runDir(project, runId), 'run.json'), run); return run; }
function finishRun(project, runId, result) { if (!runId) return; const file = path.join(runDir(project, runId), 'run.json'); const run = readJson(file, { runId }); const finished = { ...run, ...result, runId, updatedAt: result.finishedAt || new Date().toISOString() }; writeJson(file, finished); if (result.report) writeText(path.join(runDir(project, runId), 'report.md'), result.report); }
function listRuns(project) { const root = path.join(harnessDirFor(project), 'runs'); if (!fs.existsSync(root)) return []; return fs.readdirSync(root).map((runId) => { const run = readJson(path.join(root, runId, 'run.json'), null); if (!run) return null; const reportFile = path.join(root, runId, 'report.md'); return { ...run, report: fs.existsSync(reportFile) ? fs.readFileSync(reportFile, 'utf8') : '' }; }).filter(Boolean).sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''))); }
function projectHealth(project) { ensureProjectFiles(project); const harnessDir = harnessDirFor(project); const required = ['project.json', 'plan.json', 'status.json', 'queue.json', 'events.jsonl', 'current-task.md', 'context.md', 'reports/latest.md']; const files = required.map((relative) => { const file = path.join(harnessDir, relative); return { file: relative, exists: fs.existsSync(file), valid: relative.endsWith('.json') ? fileHealth(file).valid : fs.existsSync(file) }; }); const status = readJson(path.join(harnessDir, 'status.json'), {}); const runs = listRuns(project); return { ok: files.every((item) => item.exists && item.valid), projectId: project.id, checkedAt: new Date().toISOString(), files, activeRunId: status.runId || null, runCount: runs.length, warnings: files.filter((item) => !item.exists || !item.valid).map((item) => `${item.file} is missing or invalid`) }; }
function createRuntimeBackup(project) { ensureProjectFiles(project); const stamp = new Date().toISOString().replace(/[:.]/g, '-'); const file = path.join(harnessDirFor(project), 'backups', `runtime-${stamp}.json`); const snapshot = { version: 1, createdAt: new Date().toISOString(), project: readJson(path.join(harnessDirFor(project), 'project.json'), project), plan: readJson(path.join(harnessDirFor(project), 'plan.json'), defaultBoard), status: readJson(path.join(harnessDirFor(project), 'status.json'), {}), queue: readJson(path.join(harnessDirFor(project), 'queue.json'), []), runs: listRuns(project) }; writeJson(file, snapshot); appendEvent(project, { type: 'runtime_backup_created', file: path.basename(file) }); return { file: path.basename(file), path: file, createdAt: snapshot.createdAt, runCount: snapshot.runs.length }; }
function retentionPreview(project, keep = 20) { const backupDir = path.join(harnessDirFor(project), 'backups'); const runRoot = path.join(harnessDirFor(project), 'runs'); const backups = fs.existsSync(backupDir) ? fs.readdirSync(backupDir).filter((file) => file.startsWith('runtime-') && file.endsWith('.json')).sort().reverse() : []; const runs = listRuns(project); return { keep, backupsToArchive: backups.slice(keep), runsToArchive: runs.slice(keep).map((run) => run.runId) }; }
function archiveRetention(project, keep = 20) { const preview = retentionPreview(project, keep); const archiveDir = path.join(harnessDirFor(project), 'backups', 'archive'); fs.mkdirSync(archiveDir, { recursive: true }); const backupDir = path.join(harnessDirFor(project), 'backups'); preview.backupsToArchive.forEach((file) => fs.renameSync(path.join(backupDir, file), path.join(archiveDir, file))); const runArchive = path.join(archiveDir, 'runs'); fs.mkdirSync(runArchive, { recursive: true }); preview.runsToArchive.forEach((runId) => { const source = runDir(project, runId); if (fs.existsSync(source)) fs.renameSync(source, path.join(runArchive, runId)); }); appendEvent(project, { type: 'runtime_retention_archived', keep, backups: preview.backupsToArchive.length, runs: preview.runsToArchive.length }); return { ...preview, archived: true }; }

function ensureAgentProtocol(project) {
  const agentFile = path.join(project.path, 'AGENTS.md');
  const protocol = ['## Harness file protocol', '', 'If `.harness/current-task.md` exists, read it before starting work.', '', 'During work:', '- update `.harness/status.json`;', '- append important events to `.harness/events.jsonl`;', '- write the final report to `.harness/reports/latest.md`;', '- do not mark the task completed if required checks failed.'].join('\n');
  if (!fs.existsSync(agentFile)) { writeText(agentFile, `# Agent instructions\n\n${protocol}\n`); return; }
  const current = fs.readFileSync(agentFile, 'utf8');
  if (!current.includes('Harness file protocol')) { fs.copyFileSync(agentFile, path.join(harnessDirFor(project), 'AGENTS.before-harness.md')); fs.appendFileSync(agentFile, `\n\n${protocol}\n`); }
}

function ensureProjectFiles(project) {
  const harnessDir = harnessDirFor(project);
  fs.mkdirSync(path.join(harnessDir, 'requests'), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, 'backups'), { recursive: true });
  if (!fs.existsSync(path.join(harnessDir, 'project.json'))) writeJson(path.join(harnessDir, 'project.json'), project);
  if (!fs.existsSync(path.join(harnessDir, 'plan.json'))) writeJson(path.join(harnessDir, 'plan.json'), project.id === 'harness' ? readBoard() : defaultBoard);
  if (!fs.existsSync(path.join(harnessDir, 'status.json'))) writeJson(path.join(harnessDir, 'status.json'), { status: 'idle', taskId: null, updatedAt: new Date().toISOString() });
  if (!fs.existsSync(path.join(harnessDir, 'queue.json'))) writeJson(path.join(harnessDir, 'queue.json'), []);
  for (const file of ['events.jsonl', 'current-task.md', 'context.md']) if (!fs.existsSync(path.join(harnessDir, file))) writeText(path.join(harnessDir, file), '');
  if (!fs.existsSync(path.join(harnessDir, 'reports', 'latest.md'))) writeText(path.join(harnessDir, 'reports', 'latest.md'), '# Отчёт\n\nПока нет отчёта Codex.\n');
  ensureAgentProtocol(project);
  migrateLegacyStatus(project);
}
function migrateLegacyStatus(project) { const statusFile = path.join(harnessDirFor(project), 'status.json'); const status = readJson(statusFile, null); if (!status?.taskId || status.runId || !['working', 'paused', 'completed', 'failed'].includes(status.status)) return; const run = createRun(project, { taskId: status.taskId, title: status.title || status.taskId, executor: status.executor || 'codex' }, status.status); writeJson(statusFile, { ...status, runId: run.runId, migratedAt: new Date().toISOString() }); appendEvent(project, { type: 'legacy_run_migrated', taskId: status.taskId, runId: run.runId }); }
function ensureProjects() {
  fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
  let projects = readJson(projectsFile, null);
  if (!Array.isArray(projects)) { projects = [{ id: 'harness', name: 'Harness Lab', path: workspaceRoot, createdAt: new Date().toISOString() }]; writeJson(projectsFile, projects); }
  projects.forEach(ensureProjectFiles);
  return projects;
}
function getProject(id) { return ensureProjects().find((project) => project.id === id); }
function gitInfo(project) {
  try {
    const branch = execFileSync('git', ['-C', project.path, 'branch', '--show-current'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return { available: true, branch: branch || 'detached HEAD' };
  } catch { return { available: false, branch: 'не Git-проект' }; }
}
function readJsonFromLine(line) { try { return JSON.parse(line); } catch { return { type: 'invalid', raw: line }; } }
function appendEvent(project, event) { fs.appendFileSync(path.join(harnessDirFor(project), 'events.jsonl'), `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`); }
const claimTtlMs = 30 * 60 * 1000;
function claimsPath(project) { return path.join(harnessDirFor(project), 'claims.json'); }
function claimTask(project, input) { ensureProjectFiles(project); const claims = readJson(claimsPath(project), {}); const now = Date.now(); const current = claims[input.taskId]; if (current && current.claimedBy !== input.claimedBy && now - new Date(current.claimedAt).getTime() < claimTtlMs) return { error: 'Task is already claimed', claim: current }; const claim = { taskId: input.taskId, claimedBy: String(input.claimedBy || 'unknown'), claimedAt: new Date(now).toISOString(), expiresAt: new Date(now + claimTtlMs).toISOString() }; claims[input.taskId] = claim; writeJson(claimsPath(project), claims); appendEvent(project, { type: 'task_claimed', ...claim }); return claim; }
function releaseTask(project, input) { ensureProjectFiles(project); const claims = readJson(claimsPath(project), {}); const current = claims[input.taskId]; if (current && current.claimedBy !== input.claimedBy) return { error: 'Task is claimed by another agent', claim: current }; delete claims[input.taskId]; writeJson(claimsPath(project), claims); appendEvent(project, { type: 'task_released', taskId: input.taskId, claimedBy: input.claimedBy }); return { released: true, taskId: input.taskId }; }
function projectState(project) {
  const harnessDir = harnessDirFor(project);
  ensureProjectFiles(project);
  const jsonFiles = ['plan.json', 'status.json'];
  const status = readJson(path.join(harnessDir, 'status.json'), { status: 'idle' });
  const warnings = jsonFiles.flatMap((file) => { const health = fileHealth(path.join(harnessDir, file)); return health.valid ? [] : [`${file}: ${health.error}`]; });
  if (status.status === 'working' && status.updatedAt && Date.now() - new Date(status.updatedAt).getTime() > staleTaskMs) warnings.push(`Задача ${status.taskId || ''} не обновлялась более 30 минут`);
  return { project, git: gitInfo(project), policy: projectPolicy(project), worker: { enabled: autoDispatchEnabled, intervalMs: autoDispatchIntervalMs }, health: { readAt: new Date().toISOString(), warnings }, plan: readJson(path.join(harnessDir, 'plan.json'), defaultBoard), status, queue: readJson(path.join(harnessDir, 'queue.json'), []), runs: listRuns(project), claims: readJson(claimsPath(project), {}), report: fs.readFileSync(path.join(harnessDir, 'reports', 'latest.md'), 'utf8'), currentTask: fs.readFileSync(path.join(harnessDir, 'current-task.md'), 'utf8'), events: fs.readFileSync(path.join(harnessDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-100).map(readJsonFromLine) };
}
function readBody(req, callback) { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); }); req.on('end', () => { let input; try { input = JSON.parse(body || '{}'); } catch { return callback(null); } callback(input); }); }
function sendJson(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function localSuggestion(goal) { return [{ title: 'Уточнить цель и ограничения', description: `Зафиксировать ожидаемый результат для: ${goal}`, priority: 'high', status: 'ready', agent: 'Local planner', criteria: ['Цель сформулирована', 'Ограничения понятны'] }, { title: 'Собрать контекст проекта', description: 'Изучить релевантные файлы, решения и предыдущие результаты.', priority: 'medium', status: 'ready', agent: 'Local planner', criteria: ['Контекст приложен к шагу'] }, { title: 'Выполнить первый проверяемый результат', description: 'Сделать минимальное изменение и показать его пользователю.', priority: 'high', status: 'ready', agent: 'Local planner', criteria: ['Результат можно проверить'] }]; }
function templatePlan(template) {
  const cards = {
    web: [['Сформулировать пользовательский сценарий', 'Определить основной путь пользователя.', 'high'], ['Собрать UI-каркас', 'Создать страницы и состояния интерфейса.', 'medium'], ['Проверить адаптивность', 'Проверить desktop и mobile сценарии.', 'medium']],
    backend: [['Описать API-контракт', 'Зафиксировать входы, выходы и ошибки.', 'high'], ['Реализовать вертикальный срез', 'Сделать один проверяемый endpoint с persistence.', 'high'], ['Добавить тесты', 'Проверить happy path и ошибки.', 'medium']],
    saas: [['Описать роли и тарифы', 'Зафиксировать границы доступа и планов.', 'high'], ['Собрать onboarding', 'Провести пользователя от регистрации до первого результата.', 'medium'], ['Подготовить эксплуатацию', 'Добавить health-check, backup и инструкции запуска.', 'medium']],
    research: [['Сформулировать вопрос', 'Определить результат и критерии исследования.', 'high'], ['Собрать источники', 'Зафиксировать факты и ссылки в контексте проекта.', 'medium'], ['Сделать вывод', 'Собрать проверяемый итог и следующие шаги.', 'medium']],
    development: [['Уточнить требования', 'Зафиксировать сценарий, границы и критерии готовности.', 'high'], ['Собрать вертикальный срез', 'Реализовать минимальный проверяемый путь от входа до результата.', 'high'], ['Проверить и задокументировать', 'Добавить тесты, инструкции запуска и ограничения.', 'medium']],
    bug: [['Воспроизвести дефект', 'Зафиксировать шаги, окружение и ожидаемое поведение.', 'high'], ['Найти причину и исправить', 'Локализовать источник проблемы и внести минимальное исправление.', 'high'], ['Добавить регрессионную проверку', 'Проверить исправление и закрепить сценарий тестом.', 'medium']],
    release: [['Проверить готовность', 'Сверить критерии, миграции, конфигурацию и changelog.', 'high'], ['Собрать и прогнать проверки', 'Выполнить сборку, тесты и smoke-проверку.', 'high'], ['Опубликовать и наблюдать', 'Выполнить релиз и проверить health, логи и откат.', 'medium']],
    migration: [['Составить карту данных', 'Определить источники, соответствия, ограничения и резервную копию.', 'high'], ['Выполнить пробную миграцию', 'Прогнать миграцию на копии и проверить контрольные суммы.', 'high'], ['Переключить и подтвердить результат', 'Выполнить production-переход и сверить итоговые данные.', 'medium']],
    security: [['Составить модель угроз', 'Зафиксировать активы, границы доверия и основные риски.', 'high'], ['Проверить защитные меры', 'Провести анализ зависимостей, доступа, секретов и входных данных.', 'high'], ['Оформить исправления и остаточный риск', 'Добавить меры защиты, доказательства и план повторной проверки.', 'medium']],
    game: [['Описать игровой цикл', 'Определить цель игрока, ресурсы и победу.', 'high'], ['Собрать прототип механики', 'Реализовать минимальный playable slice.', 'high'], ['Проверить ощущение игры', 'Провести playtest и записать наблюдения.', 'medium']]
  };
  return { ...defaultBoard, cards: (cards[template] || cards.web).map(([title, description, priority], index) => ({ id: `template-${Date.now()}-${index}`, title, description, priority, status: 'ready', executor: 'codex', criteria: ['Результат проверен'], updatedAt: new Date().toISOString() })) };
}
function hasDependencyCycle(plan) {
  const cards = new Map((plan.cards || []).map((card) => [card.id, card]));
  const visiting = new Set(); const visited = new Set();
  function visit(id) { if (visiting.has(id)) return true; if (visited.has(id)) return false; visiting.add(id); const card = cards.get(id); for (const dependency of card?.dependencies || []) if (cards.has(dependency) && visit(dependency)) return true; visiting.delete(id); visited.add(id); return false; }
  return [...cards.keys()].some(visit);
}
function updateGlobalStatuses(plan) { const cards = plan.cards || []; cards.filter((card) => card.isGlobal || card.type === 'global').forEach((group) => { const children = cards.filter((card) => card.parentId === group.id); if (!children.length) return; group.status = children.every((card) => card.status === 'done') ? 'done' : children.some((card) => card.status === 'blocked') ? 'blocked' : children.some((card) => ['working', 'review', 'approval'].includes(card.status)) ? 'working' : children.some((card) => card.status === 'ready') ? 'ready' : 'inbox'; }); return plan; }
function planVersions(project) { const dir = path.join(harnessDirFor(project), 'backups'); ensureProjectFiles(project); return fs.readdirSync(dir).filter((file) => file.startsWith('plan-') && file.endsWith('.bak')).sort().reverse().map((file) => ({ file, createdAt: fs.statSync(path.join(dir, file)).mtime.toISOString() })); }
function writeTaskRequest(project, input, queued = false) {
  const harnessDir = harnessDirFor(project);
  const executor = executorRules[input.executor] ? input.executor : 'codex';
  const run = createRun(project, { ...input, executor }, queued ? 'queued' : 'working');
  const request = { id: `request-${Date.now()}`, type: 'start_task', taskId: input.taskId, runId: run.runId, title: input.title, executor, queued, selectedExecutor: executor, createdAt: new Date().toISOString() };
  writeJson(path.join(harnessDir, 'requests', `${request.id}.json`), request);
  appendEvent(project, request);
  return request;
}
function createTask(project, input) {
  const harnessDir = harnessDirFor(project);
  const currentStatus = readJson(path.join(harnessDir, 'status.json'), { status: 'idle' });
  if (['working', 'paused'].includes(currentStatus.status)) {
    const queueFile = path.join(harnessDir, 'queue.json');
    const queue = readJson(queueFile, []);
    const existing = queue.find((item) => item.taskId === input.taskId);
    if (existing) return { ...existing, queued: true, duplicate: true };
    const request = writeTaskRequest(project, input, true);
    queue.push({ ...request, description: input.description || '', criteria: input.criteria || [], plan: input.plan || [], constraints: input.constraints || '', priority: ['high', 'medium', 'low'].includes(input.priority) ? input.priority : 'medium', dueDate: input.dueDate || null, queuedAt: new Date().toISOString() });
    writeJson(queueFile, queue);
    return request;
  }
  const sourcePlan = Array.isArray(input.plan) && input.plan.length ? input.plan : (readJson(path.join(harnessDir, 'plan.json'), defaultBoard).cards || []).filter((item) => item.parentId === input.taskId);
  const planItems = sourcePlan.filter((item) => item?.title).map((item, index) => ({ id: item.planKey || item.id || `step-${index + 1}`, title: item.title, description: item.description || '', status: item.status || 'ready', dependsOn: item.dependsOn || item.dependencies || [] }));
  const plan = planItems.map((item) => `- [ ] [plan:${item.id}] ${item.title}${item.description ? ` — ${item.description}` : ''}`).join('\n');
  const jsonFence = String.fromCharCode(96).repeat(3);
  const jsonPlan = planItems.length ? `## План JSON\n\n${jsonFence}json\n${JSON.stringify({ plan: planItems }, null, 2)}\n${jsonFence}\n\n` : '';
  const task = `# Текущая задача\n\n## ${input.title}\n\n${input.description || ''}\n\n${plan ? `## План\n\n${plan}\n\n` : ''}${jsonPlan}## Критерии готовности\n\n${(input.criteria || []).map((item) => `- [ ] ${item}`).join('\n') || '- [ ] Результат проверен'}\n\n## Ограничения\n\n${input.constraints || 'Не менять файлы без проверки.'}\n`;
  backupFile(path.join(harnessDir, 'current-task.md'), path.join(harnessDir, 'backups'), 'current-task'); writeText(path.join(harnessDir, 'current-task.md'), task);
  const selectedExecutor = executorRules[input.executor] ? input.executor : 'codex';
  const request = writeTaskRequest(project, input, false);
  const status = { status: 'working', taskId: input.taskId, runId: request.runId, title: input.title, executor: selectedExecutor, selectedExecutor, updatedAt: new Date().toISOString() };
  backupFile(path.join(harnessDir, 'status.json'), path.join(harnessDir, 'backups'), 'status'); writeJson(path.join(harnessDir, 'status.json'), status);
  return request;
}
function dispatchNextTask(project) {
  if (dispatchLocks.has(project.id)) return { error: 'Dispatch is already in progress' };
  dispatchLocks.add(project.id);
  const leaseFile = workerLeasePath(project); const now = Date.now(); const existingLease = readJson(leaseFile, null);
  if (existingLease?.expiresAt && new Date(existingLease.expiresAt).getTime() > now) { dispatchLocks.delete(project.id); return { error: 'Worker lease is active', lease: existingLease }; }
  const lease = { owner: `worker-${randomUUID().slice(0, 8)}`, projectId: project.id, acquiredAt: new Date(now).toISOString(), expiresAt: new Date(now + 30_000).toISOString() }; writeJson(leaseFile, lease);
  try {
  const statusFile = path.join(harnessDirFor(project), 'status.json');
  const currentStatus = readJson(statusFile, { status: 'idle' });
  if (['working', 'paused'].includes(currentStatus.status)) return { error: 'Current task is still working or paused' };
  const queueFile = path.join(harnessDirFor(project), 'queue.json');
  const queue = readJson(queueFile, []);
  const priorityRank = { high: 0, medium: 1, low: 2 };
  queue.sort((a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1) || String(a.dueDate || '9999-12-31').localeCompare(String(b.dueDate || '9999-12-31')) || String(a.queuedAt || '').localeCompare(String(b.queuedAt || '')));
  const next = queue.shift();
  writeJson(queueFile, queue);
  if (!next) return { empty: true, queue: [] };
  const request = createTask(project, next);
  appendEvent(project, { type: 'queue_dispatched', taskId: next.taskId, executor: next.executor, at: new Date().toISOString() });
  return { ...request, dispatched: true, queue };
  } finally { const currentLease = readJson(leaseFile, null); if (currentLease?.owner === lease.owner) fs.rmSync(leaseFile, { force: true }); dispatchLocks.delete(project.id); }
}
function dispatchQueuedProjects() { if (!autoDispatchEnabled) return []; const dispatched = []; for (const project of ensureProjects()) { const status = readJson(path.join(harnessDirFor(project), 'status.json'), { status: 'idle' }); const queue = readJson(path.join(harnessDirFor(project), 'queue.json'), []); if (!['working', 'paused'].includes(status.status) && queue.length) { const result = dispatchNextTask(project); if (result.dispatched) dispatched.push({ projectId: project.id, taskId: result.taskId }); } } return dispatched; }
function controlTask(project, input) {
  if (!input?.taskId || !controlStatuses[input.action]) return null;
  const statusFile = path.join(harnessDirFor(project), 'status.json');
  const currentStatus = readJson(statusFile, { status: 'idle', taskId: null });
  if (!currentStatus.taskId || currentStatus.taskId !== input.taskId) return { error: 'Task is not the active project task', activeTaskId: currentStatus.taskId || null };
  if (!currentStatus.runId || (input.runId && input.runId !== currentStatus.runId)) return { error: 'Run is not the active project run', activeRunId: currentStatus.runId || null };
  if (input.action === 'complete') {
    const run = readJson(path.join(runDir(project, currentStatus.runId), 'run.json'), null);
    if (!run || run.taskId !== currentStatus.taskId || run.status !== 'completed' || !fs.existsSync(path.join(runDir(project, currentStatus.runId), 'report.md'))) return { error: 'A completed run report is required before accepting the task', runId: currentStatus.runId };
  }
  const status = { ...currentStatus, status: controlStatuses[input.action], taskId: currentStatus.taskId, runId: input.action === 'retry' ? null : currentStatus.runId, title: currentStatus.title || input.title || '', executor: currentStatus.executor || input.executor || 'codex', updatedAt: new Date().toISOString() };
  backupFile(statusFile, path.join(harnessDirFor(project), 'backups'), 'status'); writeJson(statusFile, status);
  const request = { id: `request-${Date.now()}`, type: 'task_control', action: input.action, taskId: input.taskId, runId: currentStatus.runId, title: input.title || '', executor: input.executor || 'codex', createdAt: new Date().toISOString() };
  writeJson(path.join(harnessDirFor(project), 'requests', `${request.id}.json`), request);
  appendEvent(project, request);
  return request;
}
function commandReport(input, result) {
  return [`# Отчёт ${result.source || input.executor || 'локального исполнителя'}`, '', `## Команда`, '', '```text', redactSecrets(result.command || input.command), '```', '', `- Статус: ${result.status}`, `- Код выхода: ${result.exitCode ?? 'нет'}`, `- Начало: ${result.startedAt}`, `- Завершение: ${result.finishedAt}`, '', '## Вывод', '', '```text', redactSecrets(result.output || '(пусто)'), '```', ''].join('\n');
}
function redactSecrets(value) { return String(value || '').replace(/((?:token|secret|password|passwd|api[_-]?key)\s*[=:]\s*)([^\s\n]+)/gi, '$1[REDACTED]').replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [REDACTED]'); }
const adapterDefinitions = {
  'git-status': { executor: 'cli', file: 'git', args: ['status', '--short'] },
  'npm-test': { executor: 'cli', file: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['test'] },
  'npm-lint': { executor: 'cli', file: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'lint'] },
  'npm-build': { executor: 'cli', file: process.platform === 'win32' ? 'npm.cmd' : 'npm', args: ['run', 'build'] }
};
function splitCommand(command) {
  const parts = String(command || '').trim().match(/(?:[^\s"]+|"[^"]*")+/g) || [];
  return parts.map((part) => part.startsWith('"') && part.endsWith('"') ? part.slice(1, -1) : part);
}
function safeEnvironment() {
  const allowed = new Set(['path', 'pathext', 'systemroot', 'windir', 'temp', 'tmp', 'comspec', 'psmodulepath', 'programfiles', 'programfiles(x86)', 'programw6432', 'processor_architecture', 'processor_architew6432', 'node_path']);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
}
function executeLocalCommand(project, input, onComplete) {
  const command = String(input.command || '').trim();
  if (command.length > 4000) return onComplete(null, { error: 'Command exceeds the 4000 character limit' });
  const adapter = adapterDefinitions[input.adapter];
  const parts = adapter ? [adapter.file, ...adapter.args] : input.executor === 'powershell' ? ['powershell.exe', command] : splitCommand(command);
  const file = parts.shift();
  const args = parts;
  const allowedFiles = new Set(['powershell.exe', 'powershell', 'pwsh.exe', 'pwsh', 'npm', 'npm.cmd', 'node', 'node.exe', 'git', 'git.exe']);
  if (!file) return onComplete(null, { error: 'Command is required' });
  if (!adapter && !allowedFiles.has(String(file).toLowerCase())) return onComplete(null, { error: 'Executable is not allowed; use PowerShell, npm, node or git' });
  if (adapter && input.executor !== adapter.executor) return onComplete(null, { error: 'Adapter and executor do not match' });
  if (!['powershell', 'cli'].includes(input.executor)) return onComplete(null, { error: 'Local command execution supports PowerShell or CLI' });
  if (input.confirmed !== true) return onComplete(null, { error: 'Explicit confirmation is required' });
  const execArgs = ['powershell.exe', 'powershell', 'pwsh.exe', 'pwsh'].includes(String(file).toLowerCase()) ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', args.join(' ')] : args;
  let execFileName = ['powershell', 'pwsh'].includes(String(file).toLowerCase()) ? `${file}.exe` : file;
  // Windows cannot execute npm.cmd through execFile without a shell. Run npm's JS entry point directly.
  if (process.platform === 'win32' && ['npm', 'npm.cmd'].includes(String(file).toLowerCase())) {
    const npmDirs = [path.dirname(process.execPath), ...(process.env.PATH || process.env.Path || '').split(path.delimiter)];
    const npmCli = npmDirs.map((dir) => path.join(dir.replace(/^"|"$/g, ''), 'node_modules', 'npm', 'bin', 'npm-cli.js')).find((candidate) => fs.existsSync(candidate));
    if (!npmCli) return onComplete(null, { error: 'npm CLI entry point was not found' });
    execFileName = process.execPath;
    execArgs.unshift(npmCli);
  }
  const startedAt = new Date().toISOString();
  const harnessDir = harnessDirFor(project);
  const run = createRun(project, input, 'working');
  const runId = run.runId;
  const statusFile = path.join(harnessDir, 'status.json');
  const source = input.executor === 'cli' ? (input.adapter || 'cli') : 'powershell';
  const displayCommand = [file, ...args].join(' ');
  const running = { status: 'working', taskId: input.taskId || null, runId, title: input.title || displayCommand, executor: input.executor, source, command: displayCommand, cwd: project.path, updatedAt: startedAt };
  backupFile(statusFile, path.join(harnessDir, 'backups'), 'status'); writeJson(statusFile, running);
  appendEvent(project, { type: 'command_started', source, taskId: input.taskId, command: displayCommand });
  execFile(execFileName, execArgs, { cwd: project.path, env: safeEnvironment(), timeout: 30000, windowsHide: true, maxBuffer: 256 * 1024 }, (error, stdout, stderr) => {
    const finishedAt = new Date().toISOString();
    const output = redactSecrets([stdout, stderr ? `STDERR:\n${stderr}` : ''].filter(Boolean).join('\n').trim()).slice(0, 256 * 1024);
    const result = { status: error ? 'failed' : 'completed', exitCode: error?.code ?? 0, output, startedAt, finishedAt, source, command: displayCommand };
    const status = { ...running, status: result.status, exitCode: result.exitCode, updatedAt: finishedAt };
    backupFile(statusFile, path.join(harnessDir, 'backups'), 'status'); writeJson(statusFile, status);
    const report = commandReport(input, result);
    writeText(path.join(harnessDir, 'reports', 'latest.md'), report);
    finishRun(project, runId, { ...result, report });
    appendEvent(project, { type: 'command_finished', source, taskId: input.taskId, status: result.status, exitCode: result.exitCode, at: finishedAt });
    onComplete(null, { ...result, taskId: input.taskId, runId, executor: input.executor, adapter: input.adapter || null });
  });
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch { res.writeHead(400); return res.end('Bad request'); }
  if (pathname === '/api/projects' && req.method === 'GET') return sendJson(res, 200, ensureProjects());
  if (pathname === '/api/projects' && req.method === 'POST') return readBody(req, (input) => {
    const projectPath = path.resolve(String(input?.path || ''));
    const name = String(input?.name || path.basename(projectPath) || 'Новый проект').trim();
    if (!projectPath || !fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) return sendJson(res, 400, { error: 'Папка проекта не найдена' });
    const projects = ensureProjects();
    if (projects.some((project) => path.resolve(project.path) === projectPath)) return sendJson(res, 409, { error: 'Проект уже добавлен' });
    let id = slug(name); let suffix = 2;
    while (projects.some((project) => project.id === id)) id = `${slug(name)}-${suffix++}`;
    const policy = policyProfiles[input?.policy] ? input.policy : 'development';
    const project = { id, name, path: projectPath, template: String(input?.template || 'web'), policy, createdAt: new Date().toISOString() };
    projects.push(project); writeJson(projectsFile, projects); ensureProjectFiles(project); writeJson(path.join(harnessDirFor(project), 'plan.json'), templatePlan(project.template)); return sendJson(res, 201, project);
  });
  const versionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/plan\/(versions|rollback)$/);
  if (versionsMatch) {
    const project = getProject(decodeURIComponent(versionsMatch[1]));
    if (!project) { res.writeHead(404); return res.end('Project not found'); }
    if (versionsMatch[2] === 'versions' && req.method === 'GET') return sendJson(res, 200, planVersions(project));
    if (versionsMatch[2] === 'rollback' && req.method === 'POST') return readBody(req, (input) => {
      const filename = path.basename(String(input?.file || ''));
      if (!filename || !filename.startsWith('plan-') || !filename.endsWith('.bak')) return sendJson(res, 400, { error: 'Invalid plan version' });
      const backup = path.join(harnessDirFor(project), 'backups', filename); if (!fs.existsSync(backup)) return sendJson(res, 404, { error: 'Plan version not found' });
      const plan = readJson(backup, null); if (!plan || !Array.isArray(plan.cards) || !Array.isArray(plan.columns) || hasDependencyCycle(plan)) return sendJson(res, 400, { error: 'Invalid plan version' });
      const planFile = path.join(harnessDirFor(project), 'plan.json'); const current = readJson(planFile, defaultBoard); const restored = { ...plan, revision: Number(current.revision || 0) + 1, updatedAt: new Date().toISOString() }; backupFile(planFile, path.join(harnessDirFor(project), 'backups'), 'plan'); writeJson(planFile, restored); appendEvent(project, { type: 'plan_rollback', file: filename }); return sendJson(res, 200, restored);
    });
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)(?:\/(state|health|backup|retention|plan|task|suggest|command|claim|release|runs|queue(?:\/next)?))?$/);
  if (projectMatch) {
    const project = getProject(decodeURIComponent(projectMatch[1]));
    if (!project) { res.writeHead(404); return res.end('Project not found'); }
    if (!projectMatch[2] && req.method === 'GET') return sendJson(res, 200, project);
    if (!projectMatch[2] && req.method === 'PUT') return readBody(req, (input) => { const nextPolicy = policyProfiles[input?.policy] ? input.policy : project.policy || 'development'; const base = policyProfiles[nextPolicy]; const allowedAdapters = Array.isArray(input?.allowedAdapters) ? input.allowedAdapters.filter((adapter) => base.allowedAdapters.includes(adapter)) : project.allowedAdapters; Object.assign(project, { policy: nextPolicy, ...(allowedAdapters ? { allowedAdapters } : {}) }); const projects = readJson(projectsFile, []); const persisted = projects.find((item) => item.id === project.id); if (persisted) Object.assign(persisted, project); writeJson(projectsFile, projects); writeJson(path.join(harnessDirFor(project), 'project.json'), project); appendEvent(project, { type: 'project_policy_updated', policy: nextPolicy, allowedAdapters: projectPolicy(project).allowedAdapters }); return sendJson(res, 200, project); });
    if (!projectMatch[2] && req.method === 'DELETE') { writeJson(projectsFile, ensureProjects().filter((item) => item.id !== project.id)); res.writeHead(204); return res.end(); }
    if (projectMatch[2] === 'state' && req.method === 'GET') return sendJson(res, 200, projectState(project));
    if (projectMatch[2] === 'health' && req.method === 'GET') return sendJson(res, 200, projectHealth(project));
    if (projectMatch[2] === 'backup' && req.method === 'POST') return sendJson(res, 201, createRuntimeBackup(project));
    if (projectMatch[2] === 'retention' && req.method === 'GET') return sendJson(res, 200, retentionPreview(project, 20));
    if (projectMatch[2] === 'retention' && req.method === 'POST') return readBody(req, (input) => { const keep = Math.max(1, Math.min(500, Number(input?.keep || 20))); if (input?.confirm !== true) return sendJson(res, 200, { ...retentionPreview(project, keep), dryRun: true, confirmationRequired: true }); return sendJson(res, 200, archiveRetention(project, keep)); });
    if (projectMatch[2] === 'claim' && req.method === 'POST') return readBody(req, (input) => { if (!input?.taskId || !input?.claimedBy) return sendJson(res, 400, { error: 'Task and claimant are required' }); const result = claimTask(project, input); return sendJson(res, result.error ? 409 : 200, result); });
    if (projectMatch[2] === 'release' && req.method === 'POST') return readBody(req, (input) => { if (!input?.taskId || !input?.claimedBy) return sendJson(res, 400, { error: 'Task and claimant are required' }); const result = releaseTask(project, input); return sendJson(res, result.error ? 409 : 200, result); });
    if (projectMatch[2] === 'queue' && req.method === 'GET') return sendJson(res, 200, readJson(path.join(harnessDirFor(project), 'queue.json'), []));
    if (projectMatch[2] === 'runs' && req.method === 'GET') return sendJson(res, 200, listRuns(project));
    if (projectMatch[2] === 'queue/next' && req.method === 'POST') { const result = dispatchNextTask(project); return sendJson(res, result.error ? 409 : 200, result); }
    if (projectMatch[2] === 'plan' && req.method === 'PUT') return readBody(req, (plan) => { if (!plan || !Array.isArray(plan.cards) || !Array.isArray(plan.columns)) { res.writeHead(400); return res.end('Invalid plan'); } if (hasDependencyCycle(plan)) return sendJson(res, 400, { error: 'Dependency cycle detected' }); updateGlobalStatuses(plan); const planFile = path.join(harnessDirFor(project), 'plan.json'); const currentPlan = readJson(planFile, defaultBoard); const currentRevision = Number(currentPlan.revision || 0); if (plan.revision !== undefined && Number(plan.revision || 0) !== currentRevision) return sendJson(res, 409, { error: 'Plan has changed since it was loaded', revision: currentRevision }); const nextPlan = { ...plan, revision: currentRevision + 1, updatedAt: new Date().toISOString() }; backupFile(planFile, path.join(harnessDirFor(project), 'backups'), 'plan'); writeJson(planFile, nextPlan); appendEvent(project, { type: 'plan_saved', revision: nextPlan.revision }); return sendJson(res, 200, nextPlan); });
    if (projectMatch[2] === 'task' && req.method === 'POST') return readBody(req, (input) => { if (!input?.taskId) { res.writeHead(400); return res.end('Invalid task'); } if (input.action) { const request = controlTask(project, input); if (!request) { res.writeHead(400); return res.end('Invalid task action'); } if (request.error) return sendJson(res, 409, request); return sendJson(res, 201, request); } if (!input.title) { res.writeHead(400); return res.end('Invalid task'); } return sendJson(res, 201, createTask(project, input)); });
    if (projectMatch[2] === 'command' && req.method === 'POST') return readBody(req, (input) => {
      if (!input?.taskId || (!String(input.command || '').trim() && !adapterDefinitions[input.adapter])) return sendJson(res, 400, { error: 'Task and command are required' });
      const adapter = adapterDefinitions[input.adapter];
      const executionMode = input.executionMode || input.autonomyMode || 'manual';
      const policy = projectPolicy(project);
      if (executionMode === 'auto' && !policy.allowAutonomous) return sendJson(res, 403, { error: `Профиль «${policy.label}» запрещает автономный запуск`, policy: project.policy || 'development' });
      if (executionMode === 'auto' && !adapter) return sendJson(res, 403, { error: 'Автономный запуск разрешён только для готового адаптера', policy: 'adapter-only', requiresConfirmation: true });
      if (adapter && !policy.allowedAdapters.includes(input.adapter)) return sendJson(res, 403, { error: `Адаптер ${input.adapter} запрещён профилем проекта`, policy: project.policy || 'development' });
      if (!adapter && !policy.allowShell && input.dryRun !== true) return sendJson(res, 403, { error: `Профиль «${policy.label}» разрешает только dry-run и готовые адаптеры`, policy: project.policy || 'development' });
      const previewParts = adapter ? [adapter.file, ...adapter.args] : splitCommand(input.command);
      const preview = { taskId: input.taskId, executor: input.executor || 'powershell', adapter: input.adapter || null, command: previewParts.join(' '), cwd: project.path, dryRun: input.dryRun === true, requiresConfirmation: true, allowedEnvironment: ['Path', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'ComSpec', 'NODE_PATH'] };
      if (input.dryRun === true) { appendEvent(project, { type: 'command_dry_run', source: input.adapter || input.executor || 'powershell', taskId: input.taskId, command: preview.command }); return sendJson(res, 200, preview); }
      if (input.confirmed !== true) return sendJson(res, 409, { error: 'Explicit confirmation is required', preview });
      return executeLocalCommand(project, input, (error, result) => error ? sendJson(res, 500, error) : result.error ? sendJson(res, 400, result) : sendJson(res, 200, result));
    });
    if (projectMatch[2] === 'suggest' && req.method === 'POST') return readBody(req, (input) => { if (!input?.goal) { res.writeHead(400); return res.end('Goal is required'); } const result = { provider: 'local-planner', steps: localSuggestion(String(input.goal)) }; appendEvent(project, { type: 'plan_suggested', provider: result.provider, count: result.steps.length }); return sendJson(res, 200, result); });
  }
  if (pathname === '/api/board') {
    if (req.method === 'GET') return sendJson(res, 200, readBoard());
    if (req.method === 'PUT') return readBody(req, (board) => { if (!board || !Array.isArray(board.cards) || !Array.isArray(board.columns)) return sendJson(res, 400, { error: 'Invalid board' }); writeJson(boardFile, board); return sendJson(res, 200, board); });
    res.writeHead(405); return res.end('Method not allowed');
  }
  const publicPath = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!publicFiles.has(publicPath)) { res.writeHead(404); return res.end('Not found'); }
  const file = path.resolve(root, publicPath);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404); return res.end('Not found'); } res.writeHead(200, { 'Content-Type': `${types[path.extname(file)] || 'application/octet-stream'}; charset=utf-8` }); res.end(data); });
});

let port = Number(process.env.HARNESS_PORT || 4173);
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && port < 4193) { console.log(`Port ${port} is in use, trying ${port + 1}...`); port += 1; server.listen(port, '127.0.0.1'); return; }
  console.error(`Cannot start Harness Lab: ${error.message}`); process.exitCode = 1;
});
server.on('listening', () => console.log(`Harness Lab: http://localhost:${port}`));
server.listen(port, '127.0.0.1');
const queueWorker = setInterval(() => { try { const dispatched = dispatchQueuedProjects(); dispatched.forEach((item) => console.log(`Harness queue worker: ${item.projectId}/${item.taskId}`)); } catch (error) { console.error(`Harness queue worker: ${error.message}`); } }, autoDispatchIntervalMs);
queueWorker.unref();
