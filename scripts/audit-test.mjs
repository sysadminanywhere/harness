import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-audit-'));
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
let server, logs = '', failures = 0;
async function stop() { if (server && server.exitCode === null && server.signalCode === null) { const closed = new Promise((resolve) => server.once('exit', resolve)); if (server.connected) server.send({ type: 'harness:shutdown' }); else server.kill(); const timer = setTimeout(() => server.kill(), 7000); await closed; clearTimeout(timer); } }
async function start(auto = false) {
  logs = '';
  server = spawn(process.execPath, ['server.js'], { env: { ...process.env, HARNESS_WORKSPACE: workspace, HARNESS_PORT: String(port), HARNESS_AUTO_DISPATCH: String(auto), HARNESS_AUTO_DISPATCH_INTERVAL_MS: '100', HARNESS_CODEX_BRIDGE: 'false' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
  server.stdout.on('data', (chunk) => { logs += chunk; }); server.stderr.on('data', (chunk) => { logs += chunk; });
  for (let i = 0; i < 100; i++) { if (logs.includes('Harness Lab:')) return; if (server.exitCode !== null) throw new Error(logs); await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error('Server did not start: ' + logs);
}
async function req(route, body, method = 'POST', status = 200) {
  const response = await fetch(base + route, { method: body === undefined ? 'GET' : method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), signal: AbortSignal.timeout(10000) });
  const result = await response.json(); assert.equal(response.status, status, JSON.stringify(result)); return result;
}
async function project(name) {
  const directory = path.join(workspace, name); fs.mkdirSync(directory, { recursive: true });
  return req('/api/projects', { name, path: directory, template: 'development' }, 'POST', 201);
}
const route = (p, suffix) => `/api/projects/${p.id}${suffix}`;
async function plan(p, cards) { const current = await req(route(p, '/state')); return req(route(p, '/plan'), { ...current.plan, cards }, 'PUT'); }
const card = (id, extra = {}) => ({ id, title: id, status: 'ready', executor: 'ide', priority: 'medium', criteria: ['Verified'], ...extra });
const task = (p, id) => req(route(p, '/task'), { taskId: id, title: id, executor: 'ide' }, 'POST', 201);
const cancel = (p, run) => req(route(p, '/task'), { taskId: run.taskId, action: 'cancel', runId: run.runId });
async function check(name, run) { try { await run(); console.log('AUDIT_PASS', name); } catch (error) { failures++; console.error('AUDIT_FAIL', name, error.message); } }
try {
  await start();
  await check('reconnect preserves the existing plan and validates path', async () => {
    const p = await project('reconnect'); await plan(p, [card('keep-me')]);
    const saved = fs.readFileSync(path.join(p.path, '.harness', 'plan.json'), 'utf8');
    const removed = await fetch(base + route(p, ''), { method: 'DELETE' }); assert.equal(removed.status, 204);
    await req('/api/projects', { name: 'reconnected', path: p.path }, 'POST', 201);
    assert.equal(fs.readFileSync(path.join(p.path, '.harness', 'plan.json'), 'utf8'), saved);
    await req('/api/projects', { name: 'missing-path' }, 'POST', 400);
  });
  await check('blocked queue head does not starve runnable tasks', async () => {
    const p = await project('queue'); await plan(p, [card('active'), card('blocked'), card('runnable'), card('dependency')]);
    const a = await task(p, 'active'); await task(p, 'blocked'); const b = await task(p, 'runnable');
    const state = await req(route(p, '/state')); state.plan.cards.find((c) => c.id === 'blocked').dependencies = ['dependency'];
    await req(route(p, '/plan'), state.plan, 'PUT'); await cancel(p, a);
    const dispatched = await req(route(p, '/queue/next'), {}); assert.equal(dispatched.runId, b.runId);
    assert.match((await req(route(p, '/queue')))[0].blockedReason, /dependenc/i); await cancel(p, b);
  });
  await check('local commands queue while busy and enforce task approvals', async () => {
    const p = await project('commands'); await plan(p, [card('active'), card('cmd', { executor: 'cli', command: 'node -e "console.log(123)"' }), card('approval', { priority: 'high', executor: 'cli' })]);
    const a = await task(p, 'active');
    const queued = await req(route(p, '/command'), { taskId: 'cmd', executor: 'cli', command: 'node -e "console.log(123)"', confirmed: true, background: true }); assert.equal(queued.queued, true);
    await cancel(p, a); await req(route(p, '/queue/next'), {});
    for (let i = 0; i < 60; i++) { const s = await req(route(p, '/state')); if (s.status.status === 'completed') break; await new Promise((resolve) => setTimeout(resolve, 50)); }
    const s = await req(route(p, '/state')); assert.equal(s.status.status, 'completed'); assert.match(s.report, /123/);
    const denied = await fetch(base + route(p, '/command'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'approval', executor: 'cli', command: 'node -v', confirmed: true, background: true }) }); assert.equal(denied.status, 409);
  });
  await check('retention preserves working, queued and referenced runs', async () => {
    const p = await project('retention'); await plan(p, [card('active'), card('waiting')]);
    const a = await task(p, 'active'); const b = await task(p, 'waiting');
    for (let i = 0; i < 3; i++) write(path.join(p.path, '.harness', 'runs', `old-${i}`, 'run.json'), { runId: `old-${i}`, taskId: `old-${i}`, status: 'completed', updatedAt: '2099-01-01' });
    await req(route(p, '/retention'), { keep: 1, confirm: true });
    for (const run of [a, b]) assert.ok(fs.existsSync(path.join(p.path, '.harness', 'runs', run.runId, 'run.json')), run.runId + ' archived');
    await cancel(p, b); await cancel(p, a);
  });
  await check('manual result and external file bridge both support actual review acceptance', async () => {
    const p = await project('manual-results'); await plan(p, [card('manual'), card('external')]);
    const manual = await task(p, 'manual');
    await req(route(p, '/task'), { taskId: 'manual', runId: manual.runId, action: 'submit' }, 'POST', 409);
    await req(route(p, '/task'), { taskId: 'manual', runId: manual.runId, action: 'submit', result: 'Implemented and checked manually.' });
    await req(route(p, '/task'), { taskId: 'manual', runId: manual.runId, action: 'complete' });
    const external = await task(p, 'external');
    fs.writeFileSync(path.join(p.path, '.harness', 'reports', 'latest.md'), '# External result\n\nVerified external changes.');
    const statusFile = path.join(p.path, '.harness', 'status.json'); const status = JSON.parse(fs.readFileSync(statusFile)); write(statusFile, { ...status, status: 'completed' });
    let s = await req(route(p, '/state')); assert.equal(s.runs.find((run) => run.runId === external.runId).status, 'completed'); assert.match(s.runs.find((run) => run.runId === external.runId).report, /Verified external/);
    await req(route(p, '/task'), { taskId: 'external', runId: external.runId, action: 'complete' });
    s = await req(route(p, '/state')); assert.ok(s.plan.cards.every((card) => card.status === 'done'));
  });
  await check('ad-hoc command retry retains the original command input', async () => {
    const p = await project('command-retry'); const run = await req(route(p, '/command'), { taskId: 'ad-hoc', executor: 'cli', command: 'node -e "console.log(456)"', confirmed: true });
    const retry = await req(route(p, '/task'), { taskId: 'ad-hoc', action: 'retry', runId: run.runId, confirmed: true }); assert.notEqual(retry.runId, run.runId);
    let state; for (let i = 0; i < 100; i++) { state = await req(route(p, '/state')); if (state.status.status === 'completed') break; await new Promise((resolve) => setTimeout(resolve, 30)); }
    assert.equal(state.status.status, 'completed'); assert.match(state.report, /456/);
    if (process.platform === 'win32') { const shell = await req(route(p, '/command'), { taskId: 'cli-powershell', executor: 'cli', command: 'powershell.exe -NoProfile -Command "Write-Output HARNESS_CLI_POWERSHELL_OK"', confirmed: true }); assert.equal(shell.status, 'completed'); assert.match(shell.output, /HARNESS_CLI_POWERSHELL_OK/); }
  });
  await check('rollback cannot delete active tasks', async () => {
    const p = await project('rollback'); await plan(p, [card('old')]); const versions = await req(route(p, '/plan/versions'));
    await plan(p, [card('active')]); const a = await task(p, 'active');
    await req(route(p, '/plan/rollback'), { file: versions[0].file }, 'POST', 409); await cancel(p, a);
  });
  await check('restart fails lost local command instead of leaving it working', async () => {
    const p = await project('lost-command');
    write(path.join(p.path, '.harness', 'status.json'), { status: 'working', executor: 'cli', source: 'cli', taskId: 'cmd', runId: 'lost-local' });
    write(path.join(p.path, '.harness', 'runs', 'lost-local', 'run.json'), { status: 'working', executor: 'cli', taskId: 'cmd', runId: 'lost-local' });
    await plan(p, [card('cmd', { executor: 'cli', runId: 'lost-local', status: 'working' })]);
    await stop(); await start(); const s = await req(route(p, '/state')); assert.equal(s.status.status, 'failed'); assert.equal(s.plan.cards[0].status, 'blocked');
  });
  await check('malformed plans and task bodies do not crash server', async () => {
    const p = await project('validation');
    for (const cards of [[null], [card('bad', { dependencies: 'not-an-array' })], [card('same'), card('same')], [card('self', { parentId: 'self' })]]) await req(route(p, '/plan'), { columns: [{ id: 'ready' }], cards }, 'PUT', 400);
    await req(route(p, '/task'), { taskId: 'test', title: 'test', criteria: 'bad' }, 'POST', 400);
    assert.equal((await req(route(p, '/health'))).ok, true);
  });
  await check('desktop shutdown stops the actual command process and persists cancellation', async () => {
    const p = await project('shutdown'); await plan(p, [card('shutdown-cmd', { executor: 'cli' })]);
    await req(route(p, '/command'), { taskId: 'shutdown-cmd', executor: 'cli', command: 'node -e "require(\'node:fs\').writeFileSync(\'child.pid\',String(process.pid));setInterval(()=>{},1000)"', confirmed: true, background: true });
    const pidFile = path.join(p.path, 'child.pid'); for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise((resolve) => setTimeout(resolve, 30));
    const pid = Number(fs.readFileSync(pidFile, 'utf8')); await stop(); assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    await start(); assert.equal((await req(route(p, '/state'))).status.status, 'cancelled');
  });
  await check('one unavailable project does not crash the server or block other projects', async () => {
    const p = await project('unavailable'); const backup = p.path + '-backup'; fs.renameSync(p.path, backup); fs.writeFileSync(p.path, 'Directory temporarily unavailable');
    try {
      await req(route(p, '/state'), undefined, 'GET', 503);
      assert.ok(Array.isArray(await req('/api/projects'))); assert.equal((await req('/api/projects/harness/health')).ok, true);
    } finally { fs.unlinkSync(p.path); fs.renameSync(backup, p.path); }
    const blockedWrite = path.join(p.path, '.harness', 'plan.json.tmp'); fs.mkdirSync(blockedWrite);
    try { const s = await req(route(p, '/state')); await req(route(p, '/plan'), s.plan, 'PUT', 503); assert.equal((await req(route(p, '/health'))).ok, true); } finally { fs.rmdirSync(blockedWrite); }
    fs.renameSync(p.path, backup); try { await req(route(p, '/state'), undefined, 'GET', 503); assert.equal(fs.existsSync(p.path), false, 'A missing project folder was recreated as an empty project'); const removed = await fetch(base + route(p, ''), { method: 'DELETE' }); assert.equal(removed.status, 204); assert.ok(!(await req('/api/projects')).some((item) => item.id === p.id)); } finally { fs.renameSync(backup, p.path); }
  });
  await check('autonomous pickup runs without a browser and respects manual policy', async () => {
    const p = await project('autonomous'); await plan(p, [card('auto-task', { executor: 'codex', executionMode: 'auto' })]);
    const manual = await project('manual'); await req(route(manual, ''), { policy: 'manual' }, 'PUT'); await plan(manual, [card('manual-task', { executor: 'codex', executionMode: 'auto' })]);
    await stop(); await start(true);
    let state;
    for (let i = 0; i < 100; i++) { state = await req(route(p, '/state')); if (state.status.status === 'working') break; await new Promise((resolve) => setTimeout(resolve, 50)); }
    assert.equal(state.status.taskId, 'auto-task'); assert.ok(state.events.some((event) => event.type === 'automatic_task_started'));
    assert.notEqual((await req(route(manual, '/state'))).status.status, 'working');
    await cancel(p, { taskId: 'auto-task', runId: state.status.runId });
  });
  await stop(); await start(false);
  await check('reconnect retains model policy and adapter settings and rejects path aliases', async () => {
    const p = await project('settings-reconnect'); await req(route(p, ''), { model: 'preserved-model', policy: 'safe', allowedAdapters: ['git-status'] }, 'PUT');
    await fetch(base + route(p, ''), { method: 'DELETE' });
    const connected = await req('/api/projects', { name: p.name, path: p.path }, 'POST', 201);
    assert.equal(connected.model, 'preserved-model'); assert.equal(connected.policy, 'safe'); assert.deepEqual(connected.allowedAdapters, ['git-status']);
    if (process.platform === 'win32') await req('/api/projects', { name: 'Alias project', path: p.path.toUpperCase() }, 'POST', 409);
  });
  await check('file bridge failures and cancellations are persisted as terminal runs', async () => {
    const p = await project('bridge-failure'); await plan(p, [card('failed'), card('cancelled')]);
    for (const outcome of ['failed', 'cancelled']) {
      const run = await task(p, outcome); const file = path.join(p.path, '.harness', 'status.json');
      fs.writeFileSync(path.join(p.path, '.harness', 'reports', 'latest.md'), '# Bridge result\n\nActual ' + outcome + ' result.');
      write(file, { ...JSON.parse(fs.readFileSync(file)), status: outcome, error: 'Executor ' + outcome });
      const s = await req(route(p, '/state')); const result = s.runs.find((item) => item.runId === run.runId);
      assert.equal(result.status, outcome); assert.match(result.report, new RegExp('Actual ' + outcome));
    }
  });
  await check('legacy file bridge keeps the active run identity and rejects a stale report', async () => {
    const p = await project('legacy-bridge'); await plan(p, [card('legacy'), card('queued'), card('stale')]);
    const run = await task(p, 'legacy'); const queued = await task(p, 'queued');
    assert.equal(JSON.parse(fs.readFileSync(path.join(p.path, '.harness', 'active-run.json'))).runId, run.runId); fs.unlinkSync(path.join(p.path, '.harness', 'active-run.json'));
    fs.writeFileSync(path.join(p.path, '.harness', 'runs', run.runId, 'report.md'), '# Scoped result\n\nLegacy result verified.');
    write(path.join(p.path, '.harness', 'status.json'), { taskId: 'legacy', status: 'completed', executor: 'ide' });
    const state = await req(route(p, '/state')); assert.equal(state.status.runId, run.runId); assert.equal(state.runs.filter((item) => item.taskId === 'legacy').length, 1); assert.equal(state.runs.find((item) => item.runId === run.runId).status, 'completed');
    await cancel(p, queued);
    const stale = await task(p, 'stale'); const statusFile = path.join(p.path, '.harness', 'status.json'); write(statusFile, { ...JSON.parse(fs.readFileSync(statusFile)), status: 'completed' });
    const failed = await req(route(p, '/state')); assert.equal(failed.runs.find((item) => item.runId === stale.runId).status, 'failed'); assert.match(failed.report, /без актуального отчёта/);
  });
  await check('invalid queued commands and fabricated runtime cards are rejected', async () => {
    const p = await project('runtime-validation'); await plan(p, [card('active')]); const active = await task(p, 'active');
    await req(route(p, '/command'), { taskId: 'invalid', executor: 'cli', command: 'not-an-allowed-executable --x', confirmed: true, background: true }, 'POST', 400);
    await req(route(p, '/task'), { taskId: 'preview-only', title: 'Preview only', executor: 'cli', command: 'node -v', dryRun: true, confirmed: true }, 'POST', 409);
    await cancel(p, active);
    for (const cards of [[card('ghost', { status: 'working' })], [card('foreign', { status: 'review', runId: 'foreign-run' })]]) {
      const s = await req(route(p, '/state')); await req(route(p, '/plan'), { ...s.plan, cards }, 'PUT', 400);
    }
    await plan(p, [card('preview-retry', { executor: 'cli', command: 'node -v' })]);
    const run = await req(route(p, '/command'), { taskId: 'preview-retry', executor: 'cli', command: 'node -v', confirmed: true });
    const state = await req(route(p, '/state')); state.plan.cards[0].dryRun = true; await req(route(p, '/plan'), state.plan, 'PUT');
    const preview = await req(route(p, '/task'), { taskId: 'preview-retry', action: 'retry', runId: run.runId }); assert.equal(preview.dryRun, true); assert.equal(preview.runId, run.runId); assert.equal((await req(route(p, '/state'))).runs.length, state.runs.length);
  });
  await check('cross-origin commands are rejected before any state mutation', async () => {
    const p = await project('origin'); const response = await fetch(base + route(p, '/task'), { method: 'POST', headers: { 'Content-Type': 'text/plain', Origin: 'https://unrelated.example' }, body: JSON.stringify({ taskId: 'foreign-origin', title: 'Must not start', executor: 'ide' }) });
    assert.equal(response.status, 403); assert.equal((await req(route(p, '/state'))).status.status, 'idle');
  });
  await check('a queued dependency does not prevent its automatic prerequisite from running', async () => {
    const p = await project('queue-dependency');
    fs.writeFileSync(path.join(p.path, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(\'AUTOMATIC_DEPENDENCY_OK\')"' } }));
    await plan(p, [card('active'), card('child'), card('dependency', { executor: 'cli', adapter: 'npm-test', executionMode: 'auto' })]);
    const active = await task(p, 'active'); const child = await task(p, 'child'); const s = await req(route(p, '/state')); s.plan.cards.find((c) => c.id === 'child').dependencies = ['dependency']; await req(route(p, '/plan'), s.plan, 'PUT'); await cancel(p, active);
    try {
      await stop(); await start(true); let ready;
      for (let i = 0; i < 80; i++) { const current = await req(route(p, '/state')); if (current.status.taskId === 'dependency' && current.status.status === 'completed') { ready = current; break; } await new Promise((resolve) => setTimeout(resolve, 50)); }
      assert.ok(ready, 'Automatic prerequisite was starved by the queue'); assert.match(ready.report, /AUTOMATIC_DEPENDENCY_OK/); assert.equal(ready.queue[0].runId, child.runId);
      await req(route(p, '/task'), { taskId: 'dependency', runId: ready.status.runId, action: 'complete' });
      let started;
      for (let i = 0; i < 80; i++) { const current = await req(route(p, '/state')); if (current.status.runId === child.runId && current.status.status === 'working') { started = current; break; } await new Promise((resolve) => setTimeout(resolve, 50)); }
      assert.ok(started, 'Queued child did not dispatch after accepting prerequisite'); await cancel(p, child);
    } finally { await stop(); await start(false); }
  });
  await check('automatic tasks honor priority instead of their order on the board', async () => {
    const p = await project('auto-priority'); fs.writeFileSync(path.join(p.path, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(\'PRIORITY_WORKER_OK\')"' } }));
    await plan(p, [card('preview-only', { priority: 'high', approved: true, dryRun: true, executor: 'cli', adapter: 'npm-test', executionMode: 'auto' }), card('low-first', { priority: 'low', executor: 'cli', adapter: 'npm-test', executionMode: 'auto' }), card('high-second', { priority: 'high', approved: true, executor: 'cli', adapter: 'npm-test', executionMode: 'auto' })]);
    try {
      await stop(); await start(true); let state;
      for (let i = 0; i < 100; i++) { state = await req(route(p, '/state')); if (state.events.some((event) => event.type === 'automatic_task_started')) break; await new Promise((resolve) => setTimeout(resolve, 50)); }
      assert.equal(state.events.find((event) => event.type === 'automatic_task_started').taskId, 'high-second');
      assert.ok(!state.runs.some((run) => run.taskId === 'preview-only'));
    } finally { await stop(); await start(false); }
  });
  await check('a corrupted project registry is reported without replacing its contents', async () => {
    const file = path.join(workspace, 'data', 'projects.json'); const saved = fs.readFileSync(file, 'utf8');
    try { fs.writeFileSync(file, '{invalid registry'); await req('/api/projects', undefined, 'GET', 503); assert.equal(fs.readFileSync(file, 'utf8'), '{invalid registry'); assert.equal((await fetch(base + '/')).status, 200); } finally { fs.writeFileSync(file, saved); }
  });
  await check('planner preserves the goal and constraints in every executable step', async () => {
    const p = await project('planner-constraints'); const suggestion = await req(route(p, '/suggest'), { goal: 'Preserve actual user intent', constraints: 'Keep existing API' });
    assert.ok(suggestion.steps.length > 0); assert.ok(suggestion.steps.every((step) => step.constraints === 'Keep existing API' && step.description.includes('Preserve actual user intent')));
  });
  if (failures) throw new Error(`${failures} audit regression checks failed`);
  console.log('HARNESS_AUDIT_OK');
} finally { await stop(); fs.rmSync(workspace, { recursive: true, force: true }); }
