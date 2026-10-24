const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { execFile, execFileSync } = require('node:child_process');

const root = __dirname;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };
const boardFile = path.join(root, 'data', 'board.json');
const projectsFile = path.join(root, 'data', 'projects.json');
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
const executorRules = { codex: { priority: 1 }, ide: { priority: 2 }, powershell: { priority: 3 }, cli: { priority: 3 }, human: { priority: 4 } };

function ensureBoard() {
  fs.mkdirSync(path.dirname(boardFile), { recursive: true });
  if (!fs.existsSync(boardFile)) fs.writeFileSync(boardFile, JSON.stringify(defaultBoard, null, 2));
}
function readBoard() { ensureBoard(); try { return JSON.parse(fs.readFileSync(boardFile, 'utf8')); } catch { return defaultBoard; } }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value, null, 2)); fs.renameSync(temporary, file); }
function writeText(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; fs.writeFileSync(temporary, value); fs.renameSync(temporary, file); }
function backupFile(file, backupDir, prefix) { if (!fs.existsSync(file)) return; fs.mkdirSync(backupDir, { recursive: true }); fs.copyFileSync(file, path.join(backupDir, `${prefix}-${Date.now()}.bak`)); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function fileHealth(file) { try { JSON.parse(fs.readFileSync(file, 'utf8')); return { valid: true }; } catch (error) { return { valid: false, error: error.message }; } }
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48) || 'project'; }
function harnessDirFor(project) { return path.join(project.path, '.harness'); }

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
}
function ensureProjects() {
  fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
  let projects = readJson(projectsFile, null);
  if (!Array.isArray(projects)) { projects = [{ id: 'harness', name: 'Harness Lab', path: root, createdAt: new Date().toISOString() }]; writeJson(projectsFile, projects); }
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
function projectState(project) {
  const harnessDir = harnessDirFor(project);
  ensureProjectFiles(project);
  const jsonFiles = ['plan.json', 'status.json'];
  const status = readJson(path.join(harnessDir, 'status.json'), { status: 'idle' });
  const warnings = jsonFiles.flatMap((file) => { const health = fileHealth(path.join(harnessDir, file)); return health.valid ? [] : [`${file}: ${health.error}`]; });
  if (status.status === 'working' && status.updatedAt && Date.now() - new Date(status.updatedAt).getTime() > staleTaskMs) warnings.push(`Задача ${status.taskId || ''} не обновлялась более 30 минут`);
  return { project, git: gitInfo(project), health: { readAt: new Date().toISOString(), warnings }, plan: readJson(path.join(harnessDir, 'plan.json'), defaultBoard), status, queue: readJson(path.join(harnessDir, 'queue.json'), []), report: fs.readFileSync(path.join(harnessDir, 'reports', 'latest.md'), 'utf8'), currentTask: fs.readFileSync(path.join(harnessDir, 'current-task.md'), 'utf8'), events: fs.readFileSync(path.join(harnessDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-100).map(readJsonFromLine) };
}
function readBody(req, callback) { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { callback(JSON.parse(body || '{}')); } catch { callback(null); } }); }
function sendJson(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
function localSuggestion(goal) { return [{ title: 'Уточнить цель и ограничения', description: `Зафиксировать ожидаемый результат для: ${goal}`, priority: 'high', status: 'ready', agent: 'Local planner', criteria: ['Цель сформулирована', 'Ограничения понятны'] }, { title: 'Собрать контекст проекта', description: 'Изучить релевантные файлы, решения и предыдущие результаты.', priority: 'medium', status: 'ready', agent: 'Local planner', criteria: ['Контекст приложен к шагу'] }, { title: 'Выполнить первый проверяемый результат', description: 'Сделать минимальное изменение и показать его пользователю.', priority: 'high', status: 'ready', agent: 'Local planner', criteria: ['Результат можно проверить'] }]; }
function templatePlan(template) {
  const cards = {
    web: [['Сформулировать пользовательский сценарий', 'Определить основной путь пользователя.', 'high'], ['Собрать UI-каркас', 'Создать страницы и состояния интерфейса.', 'medium'], ['Проверить адаптивность', 'Проверить desktop и mobile сценарии.', 'medium']],
    backend: [['Описать API-контракт', 'Зафиксировать входы, выходы и ошибки.', 'high'], ['Реализовать вертикальный срез', 'Сделать один проверяемый endpoint с persistence.', 'high'], ['Добавить тесты', 'Проверить happy path и ошибки.', 'medium']],
    saas: [['Описать роли и тарифы', 'Зафиксировать границы доступа и планов.', 'high'], ['Собрать onboarding', 'Провести пользователя от регистрации до первого результата.', 'medium'], ['Подготовить эксплуатацию', 'Добавить health-check, backup и инструкции запуска.', 'medium']],
    research: [['Сформулировать вопрос', 'Определить результат и критерии исследования.', 'high'], ['Собрать источники', 'Зафиксировать факты и ссылки в контексте проекта.', 'medium'], ['Сделать вывод', 'Собрать проверяемый итог и следующие шаги.', 'medium']],
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
function planVersions(project) { const dir = path.join(harnessDirFor(project), 'backups'); ensureProjectFiles(project); return fs.readdirSync(dir).filter((file) => file.startsWith('plan-') && file.endsWith('.bak')).sort().reverse().map((file) => ({ file, createdAt: fs.statSync(path.join(dir, file)).mtime.toISOString() })); }
function writeTaskRequest(project, input, queued = false) {
  const harnessDir = harnessDirFor(project);
  const executor = executorRules[input.executor] ? input.executor : 'codex';
  const request = { id: `request-${Date.now()}`, type: 'start_task', taskId: input.taskId, title: input.title, executor, queued, selectedExecutor: executor, createdAt: new Date().toISOString() };
  writeJson(path.join(harnessDir, 'requests', `${request.id}.json`), request);
  appendEvent(project, request);
  return request;
}
function createTask(project, input) {
  const harnessDir = harnessDirFor(project);
  const currentStatus = readJson(path.join(harnessDir, 'status.json'), { status: 'idle' });
  if (currentStatus.status === 'working') {
    const queueFile = path.join(harnessDir, 'queue.json');
    const queue = readJson(queueFile, []);
    const request = writeTaskRequest(project, input, true);
    queue.push({ ...request, description: input.description || '', criteria: input.criteria || [], constraints: input.constraints || '', queuedAt: new Date().toISOString() });
    writeJson(queueFile, queue);
    return request;
  }
  const task = `# Текущая задача\n\n## ${input.title}\n\n${input.description || ''}\n\n## Критерии готовности\n\n${(input.criteria || []).map((item) => `- [ ] ${item}`).join('\n') || '- [ ] Результат проверен'}\n\n## Ограничения\n\n${input.constraints || 'Не менять файлы без проверки.'}\n`;
  backupFile(path.join(harnessDir, 'current-task.md'), path.join(harnessDir, 'backups'), 'current-task'); writeText(path.join(harnessDir, 'current-task.md'), task);
  const selectedExecutor = executorRules[input.executor] ? input.executor : 'codex';
  const status = { status: 'working', taskId: input.taskId, title: input.title, executor: selectedExecutor, selectedExecutor, updatedAt: new Date().toISOString() };
  backupFile(path.join(harnessDir, 'status.json'), path.join(harnessDir, 'backups'), 'status'); writeJson(path.join(harnessDir, 'status.json'), status);
  return writeTaskRequest(project, input, false);
}
function dispatchNextTask(project) {
  const statusFile = path.join(harnessDirFor(project), 'status.json');
  const currentStatus = readJson(statusFile, { status: 'idle' });
  if (currentStatus.status === 'working') return { error: 'Current task is still working' };
  const queueFile = path.join(harnessDirFor(project), 'queue.json');
  const queue = readJson(queueFile, []);
  const next = queue.shift();
  writeJson(queueFile, queue);
  if (!next) return { empty: true, queue: [] };
  const request = createTask(project, next);
  appendEvent(project, { type: 'queue_dispatched', taskId: next.taskId, executor: next.executor, at: new Date().toISOString() });
  return { ...request, dispatched: true, queue };
}
function controlTask(project, input) {
  if (!input?.taskId || !controlStatuses[input.action]) return null;
  const status = { status: controlStatuses[input.action], taskId: input.taskId, title: input.title || '', executor: input.executor || 'codex', updatedAt: new Date().toISOString() };
  backupFile(path.join(harnessDirFor(project), 'status.json'), path.join(harnessDirFor(project), 'backups'), 'status'); writeJson(path.join(harnessDirFor(project), 'status.json'), status);
  const request = { id: `request-${Date.now()}`, type: 'task_control', action: input.action, taskId: input.taskId, title: input.title || '', executor: input.executor || 'codex', createdAt: new Date().toISOString() };
  writeJson(path.join(harnessDirFor(project), 'requests', `${request.id}.json`), request);
  appendEvent(project, request);
  return request;
}
function commandReport(input, result) {
  return [`# Отчёт ${result.source || input.executor || 'локального исполнителя'}`, '', `## Команда`, '', '```text', result.command || input.command, '```', '', `- Статус: ${result.status}`, `- Код выхода: ${result.exitCode ?? 'нет'}`, `- Начало: ${result.startedAt}`, `- Завершение: ${result.finishedAt}`, '', '## Вывод', '', '```text', result.output || '(пусто)', '```', ''].join('\n');
}
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
  const allowed = new Set(['Path', 'PATH', 'PATHEXT', 'SystemRoot', 'TEMP', 'TMP', 'ComSpec', 'PROCESSOR_ARCHITECTURE', 'PROCESSOR_ARCHITEW6432', 'NODE_PATH']);
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key)));
}
function executeLocalCommand(project, input, onComplete) {
  const command = String(input.command || '').trim();
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
  const startedAt = new Date().toISOString();
  const harnessDir = harnessDirFor(project);
  const statusFile = path.join(harnessDir, 'status.json');
  const source = input.executor === 'cli' ? (input.adapter || 'cli') : 'powershell';
  const displayCommand = [file, ...args].join(' ');
  const running = { status: 'working', taskId: input.taskId || null, title: input.title || displayCommand, executor: input.executor, source, command: displayCommand, cwd: project.path, updatedAt: startedAt };
  backupFile(statusFile, path.join(harnessDir, 'backups'), 'status'); writeJson(statusFile, running);
  appendEvent(project, { type: 'command_started', source, taskId: input.taskId, command: displayCommand });
  const execArgs = ['powershell.exe', 'powershell', 'pwsh.exe', 'pwsh'].includes(String(file).toLowerCase()) ? ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', args.join(' ')] : args;
  const execFileName = ['powershell', 'pwsh'].includes(String(file).toLowerCase()) ? `${file}.exe` : file;
  execFile(execFileName, execArgs, { cwd: project.path, env: safeEnvironment(), timeout: 30000, windowsHide: true, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
    const finishedAt = new Date().toISOString();
    const output = [stdout, stderr ? `STDERR:\n${stderr}` : ''].filter(Boolean).join('\n').trim();
    const result = { status: error ? 'failed' : 'completed', exitCode: error?.code ?? 0, output, startedAt, finishedAt, source, command: displayCommand };
    const status = { ...running, status: result.status, exitCode: result.exitCode, updatedAt: finishedAt };
    backupFile(statusFile, path.join(harnessDir, 'backups'), 'status'); writeJson(statusFile, status);
    writeText(path.join(harnessDir, 'reports', 'latest.md'), commandReport(input, result));
    appendEvent(project, { type: 'command_finished', source, taskId: input.taskId, status: result.status, exitCode: result.exitCode, at: finishedAt });
    onComplete(null, { ...result, taskId: input.taskId, executor: input.executor, adapter: input.adapter || null });
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
    const project = { id, name, path: projectPath, template: String(input?.template || 'web'), createdAt: new Date().toISOString() };
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
      const planFile = path.join(harnessDirFor(project), 'plan.json'); backupFile(planFile, path.join(harnessDirFor(project), 'backups'), 'plan'); writeJson(planFile, plan); appendEvent(project, { type: 'plan_rollback', file: filename }); return sendJson(res, 200, plan);
    });
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)(?:\/(state|plan|task|suggest|command|queue(?:\/next)?))?$/);
  if (projectMatch) {
    const project = getProject(decodeURIComponent(projectMatch[1]));
    if (!project) { res.writeHead(404); return res.end('Project not found'); }
    if (!projectMatch[2] && req.method === 'GET') return sendJson(res, 200, project);
    if (!projectMatch[2] && req.method === 'DELETE') { writeJson(projectsFile, ensureProjects().filter((item) => item.id !== project.id)); res.writeHead(204); return res.end(); }
    if (projectMatch[2] === 'state' && req.method === 'GET') return sendJson(res, 200, projectState(project));
    if (projectMatch[2] === 'queue' && req.method === 'GET') return sendJson(res, 200, readJson(path.join(harnessDirFor(project), 'queue.json'), []));
    if (projectMatch[2] === 'queue/next' && req.method === 'POST') { const result = dispatchNextTask(project); return sendJson(res, result.error ? 409 : 200, result); }
    if (projectMatch[2] === 'plan' && req.method === 'PUT') return readBody(req, (plan) => { if (!plan || !Array.isArray(plan.cards) || !Array.isArray(plan.columns)) { res.writeHead(400); return res.end('Invalid plan'); } if (hasDependencyCycle(plan)) return sendJson(res, 400, { error: 'Dependency cycle detected' }); const planFile = path.join(harnessDirFor(project), 'plan.json'); const currentPlan = readJson(planFile, defaultBoard); const currentRevision = Number(currentPlan.revision || 0); if (plan.revision !== undefined && Number(plan.revision || 0) !== currentRevision) return sendJson(res, 409, { error: 'Plan has changed since it was loaded', revision: currentRevision }); const nextPlan = { ...plan, revision: currentRevision + 1, updatedAt: new Date().toISOString() }; backupFile(planFile, path.join(harnessDirFor(project), 'backups'), 'plan'); writeJson(planFile, nextPlan); appendEvent(project, { type: 'plan_saved', revision: nextPlan.revision }); return sendJson(res, 200, nextPlan); });
    if (projectMatch[2] === 'task' && req.method === 'POST') return readBody(req, (input) => { if (!input?.taskId) { res.writeHead(400); return res.end('Invalid task'); } if (input.action) { const request = controlTask(project, input); if (!request) { res.writeHead(400); return res.end('Invalid task action'); } return sendJson(res, 201, request); } if (!input.title) { res.writeHead(400); return res.end('Invalid task'); } return sendJson(res, 201, createTask(project, input)); });
    if (projectMatch[2] === 'command' && req.method === 'POST') return readBody(req, (input) => {
      if (!input?.taskId || (!String(input.command || '').trim() && !adapterDefinitions[input.adapter])) return sendJson(res, 400, { error: 'Task and command are required' });
      const adapter = adapterDefinitions[input.adapter];
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
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
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
