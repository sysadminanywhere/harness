import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-controls-'));
const harness = path.join(workspace, '.harness');
const write = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); };
const columns = ['inbox', 'ready', 'working', 'approval', 'review', 'blocked', 'done'].map((id) => ({ id, title: id }));
const cards = ['a', 'b', 'c'].map((id) => ({ id, title: 'Control ' + id, status: 'ready', executor: 'ide', priority: 'medium', criteria: ['Verified'] }));
cards[0] = { ...cards[0], status: 'working', runId: 'legacy-run' };
write(path.join(workspace, 'data', 'board.json'), { columns, cards, events: [] });
write(path.join(harness, 'plan.json'), { columns, cards, events: [] });
write(path.join(harness, 'status.json'), { status: 'ready', taskId: 'a', runId: null, executor: 'ide' });
write(path.join(harness, 'runs', 'legacy-run', 'run.json'), { runId: 'legacy-run', taskId: 'a', status: 'failed' });
const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, HARNESS_WORKSPACE: workspace, HARNESS_PORT: String(port), HARNESS_AUTO_DISPATCH: 'false', HARNESS_CODEX_BRIDGE: 'false' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let logs = ''; server.stdout.on('data', (chunk) => { logs += chunk; }); server.stderr.on('data', (chunk) => { logs += chunk; });
const base = 'http://127.0.0.1:' + port;
const prefix = '/api/projects/harness';
async function request(route, body, expected = 200, method = 'POST') {
  const response = await fetch(base + prefix + route, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await response.json();
  assert.equal(response.status, expected, JSON.stringify(result)); return result;
}
const state = () => request('/state');
const card = (s, id) => s.plan.cards.find((item) => item.id === id);
const start = (id) => request('/task', { taskId: id, title: 'Control ' + id, executor: 'ide' }, 201);
const control = (id, action, runId, expected = 200) => request('/task', { taskId: id, action, runId }, expected);
async function until(check) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error('Control condition timed out: ' + logs);
}
try {
  await until(() => logs.includes('Harness Lab:'));
  let s = await state(); assert.equal(card(s, 'a').status, 'ready'); assert.equal(card(s, 'a').runId, null);
  await control('a', 'cancel', 'legacy-run'); s = await state(); assert.equal(card(s, 'a').cancelled, true); assert.equal(card(s, 'a').status, 'blocked');
  assert.match(s.report, /cancelled/);
  await control('a', 'cancel');
  const noRunRetry = await control('a', 'retry', null);
  assert.equal(noRunRetry.status, 'working'); assert.ok(noRunRetry.runId);
  const duplicateNoRunRetry = await control('a', 'retry', null);
  assert.equal(duplicateNoRunRetry.duplicate, true); assert.equal(duplicateNoRunRetry.runId, noRunRetry.runId);
  await control('a', 'cancel', noRunRetry.runId); await control('a', 'reset', noRunRetry.runId);
  assert.match((await state()).report, /ready/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(harness, 'plan.json'))).cards[0].status, 'ready');
  const beforeStart = (await state()).plan;
  const a = await start('a');
  await request('/plan', beforeStart, 409, 'PUT');
  let edited = (await state()).plan; edited.cards.find((c) => c.id === 'a').status = 'done';
  const guarded = await request('/plan', edited, 200, 'PUT'); assert.equal(card({ plan: guarded }, 'a').status, 'working');
  const b = await start('b'); assert.equal(b.queued, true);
  await control('b', 'cancel', a.runId, 409);
  await control('b', 'cancel', b.runId); s = await state(); assert.equal(s.status.runId, a.runId); assert.equal(s.queue.length, 0); assert.equal(card(s, 'b').cancelled, true);
  await control('b', 'cancel', b.runId);
  const queuedRetry = await control('b', 'retry', b.runId);
  assert.equal(queuedRetry.queued, true); assert.notEqual(queuedRetry.runId, b.runId);
  const duplicateQueuedRetry = await control('b', 'retry', b.runId);
  assert.equal(duplicateQueuedRetry.duplicate, true); assert.equal(duplicateQueuedRetry.runId, queuedRetry.runId);
  await control('b', 'cancel', queuedRetry.runId); await control('b', 'reset', queuedRetry.runId);
  await control('a', 'pause', a.runId); s = await state(); assert.equal(s.status.status, 'paused'); assert.equal(card(s, 'a').paused, true);
  await control('a', 'pause', a.runId, 409); await request('/queue/next', {}, 409);
  await control('a', 'resume', a.runId); assert.equal((await state()).status.status, 'working');
  await control('a', 'complete', a.runId, 409);
  await control('a', 'cancel', a.runId); await control('a', 'retry', a.runId);
  s = await state(); assert.equal(card(s, 'a').status, 'working');
  const a2 = { runId: s.status.runId }; assert.notEqual(a2.runId, a.runId);
  await control('a', 'cancel', a.runId, 409);
  await control('a', 'cancel', a2.runId);
  await control('a', 'reset', a2.runId);
  const completed = await start('a');
  const runFile = path.join(harness, 'runs', completed.runId, 'run.json');
  write(runFile, { ...JSON.parse(fs.readFileSync(runFile)), status: 'completed' });
  fs.writeFileSync(path.join(harness, 'runs', completed.runId, 'report.md'), '# Verified result');
  write(path.join(harness, 'status.json'), { ...(await state()).status, status: 'completed' });
  const activeB = await start('b');
  await control('a', 'complete', completed.runId);
  s = await state(); assert.equal(card(s, 'a').status, 'done'); assert.equal(s.status.runId, activeB.runId);
  await control('a', 'return', completed.runId);
  s = await state(); assert.equal(card(s, 'a').status, 'ready'); assert.equal(s.status.runId, activeB.runId);
  await control('b', 'cancel', activeB.runId);
  const command = { taskId: 'c', title: 'Long command', executor: 'cli', command: 'node -e "setInterval(() => {}, 1000)"', confirmed: true, background: true };
  const local = await request('/command', command); assert.equal(local.status, 'working');
  await control('c', 'retry', local.runId, 409);
  assert.equal((await state()).status.runId, local.runId);
  const same = await request('/command', command); assert.equal(same.duplicate, true); assert.equal(same.runId, local.runId);
  await control('c', 'pause', local.runId, 409);
  const queued = await start('a'); assert.equal(queued.queued, true);
  const deletion = (await state()).plan; deletion.cards = deletion.cards.filter((c) => c.id !== 'a');
  await request('/plan', deletion, 409, 'PUT');
  await control('a', 'cancel', queued.runId);
  await control('c', 'cancel', local.runId);
  const afterCancel = await start('a');
  await new Promise((resolve) => setTimeout(resolve, 150));
  s = await state(); assert.equal(s.status.runId, afterCancel.runId); assert.equal(s.runs.find((r) => r.runId === local.runId).status, 'cancelled');
  const queuedCommandRetry = await request('/task', { taskId: 'c', action: 'retry', runId: local.runId, confirmed: true });
  assert.equal(queuedCommandRetry.queued, true); assert.notEqual(queuedCommandRetry.runId, local.runId);
  await control('a', 'cancel', afterCancel.runId);
  const dispatchedCommand = await request('/queue/next', {});
  assert.equal(dispatchedCommand.dispatched, true); assert.equal(dispatchedCommand.runId, queuedCommandRetry.runId);
  assert.equal((await state()).status.runId, queuedCommandRetry.runId);
  await control('c', 'cancel', queuedCommandRetry.runId);
  await control('c', 'reset', queuedCommandRetry.runId);
  const success = await request('/command', { ...command, command: 'node -e "console.log(12345)"' });
  await until(async () => { const s = await state(); return s.status.runId === success.runId && s.status.status === 'completed'; });
  s = await state(); assert.equal(card(s, 'c').status, 'review'); assert.match(s.report, /12345/);
  const modelProjectPath = path.join(workspace, 'model-project'); fs.mkdirSync(modelProjectPath);
  const modelResponse = await fetch(base + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Model settings fixture', path: modelProjectPath, model: 'project-one' }) });
  assert.equal(modelResponse.status, 201); const mp = await modelResponse.json();
  async function modelRequest(route, body, expected = 200, method = 'POST') {
    const r = await fetch(base + '/api/projects/' + mp.id + route, body === undefined ? undefined : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const value = await r.json(); assert.equal(r.status, expected, JSON.stringify(value)); return value;
  }
  const modelPlan = { columns, cards: [
    { id: 'scope', title: 'Model scope', isGlobal: true, model: 'scope-one', status: 'inbox', priority: 'medium' },
    { id: 'task-model', title: 'Task model', parentId: 'scope', model: 'task-one', status: 'ready', executor: 'codex', priority: 'medium' },
    { id: 'task-inherit', title: 'Inherited model', parentId: 'scope', model: null, status: 'ready', executor: 'codex', priority: 'medium' },
    { id: 'task-project', title: 'Project model', status: 'ready', executor: 'codex', priority: 'medium' },
  ] };
  await modelRequest('/plan', modelPlan, 200, 'PUT');
  let ms = await modelRequest('/state'); assert.equal(ms.project.model, 'project-one');
  assert.equal(card(ms, 'task-inherit').effectiveModel, 'scope-one'); assert.equal(card(ms, 'task-project').effectiveModel, 'project-one');
  const mr = await modelRequest('/task', { taskId: 'task-model', title: 'Task model', executor: 'codex', model: 'stale-client-value' }, 201);
  ms = await modelRequest('/state'); assert.equal(ms.status.model, 'task-one'); assert.equal(ms.runs.find((r) => r.runId === mr.runId).input.model, 'task-one');
  const mq = await modelRequest('/task', { taskId: 'task-inherit', title: 'Inherited model', executor: 'codex' }, 201);
  assert.equal(mq.model, 'scope-one'); assert.equal(mq.queued, true);
  const editedModels = (await modelRequest('/state')).plan;
  editedModels.cards.find((c) => c.id === 'scope').model = 'scope-two'; editedModels.cards.find((c) => c.id === 'task-model').model = 'task-two';
  await modelRequest('/plan', editedModels, 200, 'PUT'); await modelRequest('', { model: 'project-two' }, 200, 'PUT');
  ms = await modelRequest('/state'); assert.equal(ms.project.model, 'project-two'); assert.equal(card(ms, 'task-model').effectiveModel, 'task-two'); assert.equal(card(ms, 'task-model').executionModel, 'task-one');
  await modelRequest('/task', { taskId: 'task-model', action: 'pause', runId: mr.runId });
  await modelRequest('/task', { taskId: 'task-model', action: 'resume', runId: mr.runId });
  assert.equal((await modelRequest('/state')).status.model, 'task-one');
  await modelRequest('/task', { taskId: 'task-model', action: 'cancel', runId: mr.runId });
  assert.match((await modelRequest('/state')).report, /task-one/);
  const md = await modelRequest('/queue/next', {}); assert.equal(md.runId, mq.runId); assert.equal(md.model, 'scope-one');
  await modelRequest('/task', { taskId: 'task-inherit', action: 'cancel', runId: mq.runId });
  const retryModel = await modelRequest('/task', { taskId: 'task-model', action: 'retry', runId: mr.runId }); assert.equal(retryModel.model, 'task-two');
  await modelRequest('/task', { taskId: 'task-model', action: 'cancel', runId: retryModel.runId });
  await modelRequest('', { model: null }, 200, 'PUT');
  const defaultModel = await modelRequest('/task', { taskId: 'task-project', title: 'Default', executor: 'codex' }, 201); assert.equal(defaultModel.model, null);
  await modelRequest('', { model: '--invalid flag' }, 400, 'PUT'); assert.equal((await modelRequest('/state')).project.model, null);
  const invalidModelPlan = (await modelRequest('/state')).plan; invalidModelPlan.cards[0].model = 'bad model';
  await modelRequest('/plan', invalidModelPlan, 400, 'PUT');
  assert.equal(JSON.parse(fs.readFileSync(path.join(modelProjectPath, '.harness', 'project.json'))).model, null);
  const mpFile = path.join(modelProjectPath, '.harness', 'plan.json');
  const externalPlan = JSON.parse(fs.readFileSync(mpFile)); externalPlan.cards[0].model = 'invalid external model'; write(mpFile, externalPlan);
  assert.ok((await modelRequest('/state')).health.warnings.some((warning) => warning.includes('Invalid model')));
  externalPlan.cards[0].model = 'scope-two'; write(mpFile, externalPlan);
  const catalog = await (await fetch(base + '/api/models')).json(); assert.ok(Array.isArray(catalog.models)); assert.equal(Object.hasOwn(catalog, 'identity'), false);
  console.log('HARNESS_MODELS_OK task/scope/project inheritance, queued snapshot, resume snapshot, retry current selection, validation, persisted settings');
  console.log('HARNESS_CONTROLS_OK legacy ready/cancel, queued cancel, retry, real command cancellation, pause/resume, stale run, historic review, plan conflict, persisted state');
  if (process.argv.includes('--preview')) {
    const previewPath = path.join(workspace, 'browser-project'); fs.mkdirSync(previewPath);
    const response = await fetch(base + '/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Browser controls', path: previewPath }) });
    const project = await response.json();
    const plan = { columns, events: [], cards: [
      { id: 'ui-active', title: 'Active control probe', status: 'ready', priority: 'medium', executor: 'ide', criteria: ['Controls work'] },
      { id: 'ui-queued', title: 'Queued control probe', status: 'ready', priority: 'medium', executor: 'ide', criteria: ['Queue cancellation works'] },
      { id: 'ui-command', title: 'Command control probe', status: 'ready', priority: 'medium', executor: 'cli', command: command.command, criteria: ['Process stopped'] },
      { id: 'ui-review', title: 'Review control probe', status: 'review', runId: 'review-fixture', priority: 'medium', executor: 'ide', criteria: ['Verified result'] },
      { id: 'ui-return', title: 'Return control probe', status: 'review', runId: 'return-fixture', priority: 'medium', executor: 'ide', criteria: ['Review result'] },
      { id: 'ui-model-scope', title: 'Model scope probe', status: 'inbox', isGlobal: true, priority: 'medium', executor: 'codex', model: null, criteria: ['Scope model saved'] },
      { id: 'ui-model-child', title: 'Model child probe', parentId: 'ui-model-scope', status: 'ready', priority: 'medium', executor: 'codex', model: null, criteria: ['Model selection works'] },
    ] };
    for (const [id, taskId] of [['review-fixture', 'ui-review'], ['return-fixture', 'ui-return']]) {
      write(path.join(previewPath, '.harness', 'runs', id, 'run.json'), { runId: id, taskId, status: 'completed', title: taskId });
      fs.writeFileSync(path.join(previewPath, '.harness', 'runs', id, 'report.md'), '# Verified fixture report');
    }
    await fetch(base + '/api/projects/' + project.id + '/plan', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(plan) });
    console.log('CONTROL_PREVIEW ' + JSON.stringify({ url: base, workspace, projectId: project.id }));
    await new Promise((resolve) => process.once('SIGINT', resolve));
  }
} finally {
  if (server.exitCode === null && server.signalCode === null) { const exited = new Promise((resolve) => server.once('exit', resolve)); server.kill(); await exited; }
  fs.rmSync(workspace, { recursive: true, force: true });
}
