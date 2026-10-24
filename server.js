const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml' };
const boardFile = path.join(root, 'data', 'board.json');
const projectsFile = path.join(root, 'data', 'projects.json');
const defaultBoard = { columns: [{ id: 'inbox', title: 'Идеи', tone: 'muted' }, { id: 'ready', title: 'Готово', tone: 'blue' }, { id: 'working', title: 'В работе', tone: 'green' }, { id: 'approval', title: 'Ожидает решения', tone: 'amber' }, { id: 'review', title: 'Проверка', tone: 'amber' }, { id: 'blocked', title: 'Заблокировано', tone: 'red' }, { id: 'done', title: 'Завершено', tone: 'done' }], cards: [], events: [] };
function ensureBoard() { fs.mkdirSync(path.dirname(boardFile), { recursive: true }); if (!fs.existsSync(boardFile)) fs.writeFileSync(boardFile, JSON.stringify(defaultBoard, null, 2)); }
function readBoard() { ensureBoard(); try { return JSON.parse(fs.readFileSync(boardFile, 'utf8')); } catch { return defaultBoard; } }
function writeBoard(board) { ensureBoard(); const temporary = `${boardFile}.tmp`; fs.writeFileSync(temporary, JSON.stringify(board, null, 2)); fs.renameSync(temporary, boardFile); }
function writeJson(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.tmp`; fs.writeFileSync(temporary, JSON.stringify(value, null, 2)); fs.renameSync(temporary, file); }
function readJson(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function slug(value) { return String(value).toLowerCase().replace(/[^a-z0-9а-яё]+/gi, '-').replace(/^-|-$/g, '').slice(0, 48) || 'project'; }
function ensureProjectFiles(project) {
  const harnessDir = path.join(project.path, '.harness');
  fs.mkdirSync(path.join(harnessDir, 'requests'), { recursive: true });
  fs.mkdirSync(path.join(harnessDir, 'reports'), { recursive: true });
  if (!fs.existsSync(path.join(harnessDir, 'project.json'))) writeJson(path.join(harnessDir, 'project.json'), project);
  if (!fs.existsSync(path.join(harnessDir, 'plan.json'))) writeJson(path.join(harnessDir, project.id === 'harness' ? 'plan.json' : 'plan.json'), project.id === 'harness' ? readBoard() : defaultBoard);
  if (!fs.existsSync(path.join(harnessDir, 'status.json'))) writeJson(path.join(harnessDir, 'status.json'), { status: 'idle', taskId: null, updatedAt: new Date().toISOString() });
  for (const file of ['events.jsonl', 'current-task.md', 'context.md']) if (!fs.existsSync(path.join(harnessDir, file))) fs.writeFileSync(path.join(harnessDir, file), '');
  if (!fs.existsSync(path.join(harnessDir, 'reports', 'latest.md'))) fs.writeFileSync(path.join(harnessDir, 'reports', 'latest.md'), '# Отчёт\n\nПока нет отчёта Codex.\n');
  ensureAgentProtocol(project);
}
function ensureAgentProtocol(project) {
  const agentFile = path.join(project.path, 'AGENTS.md');
  const protocol = ['## Harness file protocol', '', 'If `.harness/current-task.md` exists, read it before starting work.', '', 'During work:', '- update `.harness/status.json`;', '- append important events to `.harness/events.jsonl`;', '- write the final report to `.harness/reports/latest.md`;', '- do not mark the task completed if required checks failed.'].join('\n');
  if (!fs.existsSync(agentFile)) { fs.writeFileSync(agentFile, `# Agent instructions\n\n${protocol}\n`); return; }
  const current = fs.readFileSync(agentFile, 'utf8');
  if (!current.includes('Harness file protocol')) { fs.copyFileSync(agentFile, path.join(harnessDirFor(project), 'AGENTS.before-harness.md')); fs.appendFileSync(agentFile, `\n\n${protocol}\n`); }
}
function harnessDirFor(project) { return path.join(project.path, '.harness'); }
function ensureProjects() {
  fs.mkdirSync(path.dirname(projectsFile), { recursive: true });
  let projects = readJson(projectsFile, null);
  if (!Array.isArray(projects)) { projects = [{ id: 'harness', name: 'Harness Lab', path: root, createdAt: new Date().toISOString() }]; writeJson(projectsFile, projects); }
  projects.forEach(ensureProjectFiles);
  return projects;
}
function getProject(id) { return ensureProjects().find((project) => project.id === id); }
function projectState(project) {
  const harnessDir = path.join(project.path, '.harness');
  ensureProjectFiles(project);
  return { project, plan: readJson(path.join(harnessDir, 'plan.json'), defaultBoard), status: readJson(path.join(harnessDir, 'status.json'), { status: 'idle' }), report: fs.readFileSync(path.join(harnessDir, 'reports', 'latest.md'), 'utf8'), currentTask: fs.readFileSync(path.join(harnessDir, 'current-task.md'), 'utf8'), events: fs.readFileSync(path.join(harnessDir, 'events.jsonl'), 'utf8').split('\n').filter(Boolean).slice(-100).map((line) => readJsonFromLine(line)) };
}
function readJsonFromLine(line) { try { return JSON.parse(line); } catch { return { type: 'invalid', raw: line }; } }
function appendEvent(project, event) { const file = path.join(project.path, '.harness', 'events.jsonl'); fs.appendFileSync(file, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`); }
function readBody(req, callback) { let body = ''; req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); }); req.on('end', () => { try { callback(JSON.parse(body || '{}')); } catch { callback(null); } }); }
function localSuggestion(goal) { return [{ title: 'Уточнить цель и ограничения', description: `Зафиксировать ожидаемый результат для: ${goal}`, priority: 'high', status: 'ready', agent: 'Local planner', criteria: ['Цель сформулирована', 'Ограничения понятны'] }, { title: 'Собрать контекст проекта', description: 'Изучить релевантные файлы, решения и предыдущие результаты.', priority: 'medium', status: 'ready', agent: 'Local planner', criteria: ['Контекст приложен к шагу'] }, { title: 'Выполнить первый проверяемый результат', description: 'Сделать минимальное изменение и показать его пользователю.', priority: 'high', status: 'ready', agent: 'Local planner', criteria: ['Результат можно проверить'] }]; }
const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); }
  catch { res.writeHead(400); return res.end('Bad request'); }
  if (pathname === '/api/projects' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(ensureProjects())); }
  if (pathname === '/api/projects' && req.method === 'POST') {
    return readBody(req, (input) => { const projectPath = path.resolve(String(input?.path || '')); const name = String(input?.name || path.basename(projectPath) || 'Новый проект').trim(); if (!projectPath || !fs.existsSync(projectPath) || !fs.statSync(projectPath).isDirectory()) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Папка проекта не найдена' })); } const projects = ensureProjects(); if (projects.some((project) => path.resolve(project.path) === projectPath)) { res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify({ error: 'Проект уже добавлен' })); } let id = slug(name); let suffix = 2; while (projects.some((project) => project.id === id)) id = `${slug(name)}-${suffix++}`; const project = { id, name, path: projectPath, createdAt: new Date().toISOString() }; projects.push(project); writeJson(projectsFile, projects); ensureProjectFiles(project); res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(project)); });
  }
  const projectMatch = pathname.match(/^\/api\/projects\/([^/]+)(?:\/(state|plan|task|suggest))?$/);
  if (projectMatch) {
    const project = getProject(decodeURIComponent(projectMatch[1]));
    if (!project) { res.writeHead(404); return res.end('Project not found'); }
    if (!projectMatch[2] && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(project)); }
    if (!projectMatch[2] && req.method === 'DELETE') { const projects = ensureProjects().filter((item) => item.id !== project.id); writeJson(projectsFile, projects); res.writeHead(204); return res.end(); }
    if (projectMatch[2] === 'state' && req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(projectState(project))); }
    if (projectMatch[2] === 'plan' && req.method === 'PUT') return readBody(req, (plan) => { if (!plan || !Array.isArray(plan.cards) || !Array.isArray(plan.columns)) { res.writeHead(400); return res.end('Invalid plan'); } writeJson(path.join(project.path, '.harness', 'plan.json'), plan); appendEvent(project, { type: 'plan_saved' }); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(plan)); });
    if (projectMatch[2] === 'task' && req.method === 'POST') return readBody(req, (input) => { if (!input?.taskId || !input?.title) { res.writeHead(400); return res.end('Invalid task'); } const harnessDir = path.join(project.path, '.harness'); const task = `# Текущая задача\n\n## ${input.title}\n\n${input.description || ''}\n\n## Критерии готовности\n\n${(input.criteria || []).map((item) => `- [ ] ${item}`).join('\n') || '- [ ] Результат проверен'}\n\n## Ограничения\n\n${input.constraints || 'Не менять файлы без проверки.'}\n`; fs.writeFileSync(path.join(harnessDir, 'current-task.md'), task); writeJson(path.join(harnessDir, 'status.json'), { status: 'working', taskId: input.taskId, title: input.title, updatedAt: new Date().toISOString() }); const request = { id: `request-${Date.now()}`, type: 'start_task', taskId: input.taskId, title: input.title, createdAt: new Date().toISOString() }; writeJson(path.join(harnessDir, 'requests', `${request.id}.json`), request); appendEvent(project, request); res.writeHead(201, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(request)); });
    if (projectMatch[2] === 'suggest' && req.method === 'POST') return readBody(req, (input) => { if (!input?.goal) { res.writeHead(400); return res.end('Goal is required'); } const result = { provider: 'local-planner', steps: localSuggestion(String(input.goal)) }; appendEvent(project, { type: 'plan_suggested', provider: result.provider, count: result.steps.length }); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(result)); });
  }
  if (pathname === '/api/board') {
    if (req.method === 'GET') { res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); return res.end(JSON.stringify(readBoard())); }
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; if (body.length > 1_000_000) req.destroy(); });
      req.on('end', () => { try { const board = JSON.parse(body); if (!Array.isArray(board.cards) || !Array.isArray(board.columns)) throw new Error('Invalid board'); writeBoard(board); res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(board)); } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: error.message })); } });
      return;
    }
    res.writeHead(405); return res.end('Method not allowed');
  }
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(file, (error, data) => {
    if (error) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': (types[path.extname(file)] || 'application/octet-stream') + '; charset=utf-8' });
    res.end(data);
  });
});
let port = 4173;
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE' && port < 4193) {
    console.log(`Port ${port} is in use, trying ${port + 1}...`);
    port += 1;
    server.listen(port, '127.0.0.1');
    return;
  }
  console.error(`Cannot start Harness Lab: ${error.message}`);
  process.exitCode = 1;
});
server.on('listening', () => console.log(`Harness Lab: http://localhost:${port}`));
server.listen(port, '127.0.0.1');
