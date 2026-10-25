import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';

const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-runtime-'));
const harness = path.join(workspace, '.harness');
function write(file, value) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); }
const seedPlan = { columns: [{ id: 'ready', title: 'To do' }, { id: 'working', title: 'Working' }, { id: 'blocked', title: 'Blocked' }], cards: [
  { id: 'lost', title: 'Lost executor', status: 'ready', queued: true, runId: 'duplicate' },
  { id: 'first', title: 'First', status: 'ready' }, { id: 'broken-cli', title: 'Broken CLI', status: 'ready', queued: true },
  { id: 'next', title: 'Next', status: 'ready', queued: true },
] };
write(path.join(workspace, 'data', 'board.json'), seedPlan);
write(path.join(harness, 'plan.json'), seedPlan);
write(path.join(harness, 'status.json'), { status: 'working', source: 'codex-exec', executor: 'codex', runId: 'lost-run', taskId: 'lost', updatedAt: new Date().toISOString() });
write(path.join(harness, 'queue.json'), [{ taskId: 'lost', runId: 'duplicate', title: 'Lost executor' }]);
for (const id of ['lost-run', 'duplicate']) write(path.join(harness, 'runs', id, 'run.json'), { runId: id, taskId: 'lost', status: id === 'duplicate' ? 'queued' : 'working', createdAt: new Date().toISOString() });
const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
const server = spawn(process.execPath, ['server.js'], { env: { ...process.env, HARNESS_WORKSPACE: workspace, HARNESS_PORT: String(port), HARNESS_AUTO_DISPATCH: 'true', HARNESS_AUTO_DISPATCH_INTERVAL_MS: '50', HARNESS_CODEX_BRIDGE: 'true', CODEX_CLI_PATH: process.execPath }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
let logs = ''; server.stdout.on('data', (chunk) => { logs += chunk; }); server.stderr.on('data', (chunk) => { logs += chunk; });
const base = `http://127.0.0.1:${port}/api/projects/harness`;
async function request(route, body) {
  const response = await fetch(base + route, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
  const result = await response.json(); assert.ok(response.ok, JSON.stringify(result)); return result;
}
async function until(check) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) { try { const value = await check(); if (value) return value; } catch { /* server starting */ } await new Promise((resolve) => setTimeout(resolve, 50)); }
  throw new Error(`Runtime condition timed out: ${logs}`);
}
try {
  await until(() => logs.includes('Harness Lab:'));
  let state = await request('/state');
  assert.equal(state.status.status, 'failed'); assert.equal(state.queue.length, 0);
  assert.equal(state.runs.find((r) => r.runId === 'duplicate').status, 'cancelled');
  assert.equal(state.plan.cards.find((c) => c.id === 'lost').queued, false);
  assert.equal(state.plan.cards.find((c) => c.id === 'lost').status, 'blocked');
  assert.match(state.report, /failed/);
  await request('/task', { taskId: 'lost', action: 'reset', runId: 'lost-run' });
  const first = await request('/task', { taskId: 'first', title: 'First', executor: 'ide' });
  const duplicate = await request('/task', { taskId: 'first', title: 'Duplicate', executor: 'ide' });
  assert.equal(duplicate.runId, first.runId); assert.equal(duplicate.duplicate, true);
  const before = (await request('/state')).status.updatedAt;
  await request('/claim', { taskId: 'first', claimedBy: 'browser' });
  await request('/claim', { taskId: 'first', claimedBy: 'browser' });
  state = await request('/state');
  assert.equal(state.status.updatedAt, before, 'Browser claim changed executor heartbeat');
  assert.equal(state.events.filter((e) => e.type === 'task_claimed' && e.taskId === 'first').length, 1);
  const runFile = path.join(harness, 'runs', first.runId, 'run.json');
  const activeRun = JSON.parse(fs.readFileSync(runFile, 'utf8'));
  write(runFile, { ...activeRun, createdAt: new Date(Date.now() - 120000).toISOString() });
  write(path.join(harness, 'status.json'), { ...state.status, executor: 'codex', progressEvent: 'codex_started', progressAt: new Date().toISOString() });
  const silent = await request('/state');
  assert.ok(silent.health.warnings.some((warning) => warning.includes('не передаёт прогресс')), 'Synthetic startup message hid a silent executor');
  write(path.join(harness, 'status.json'), state.status);
  const broken = await request('/task', { taskId: 'broken-cli', title: 'Broken CLI', executor: 'codex', priority: 'high' });
  const next = await request('/task', { taskId: 'next', title: 'Next', executor: 'ide', priority: 'low' });
  assert.equal(broken.queued, true); assert.equal(next.queued, true);
  await request('/task', { taskId: 'first', action: 'cancel', runId: first.runId });
  assert.equal((await request('/state')).claims.first, undefined, 'Cancelled task retained its browser claim');
  state = await until(async () => { const s = await request('/state'); return s.status.taskId === 'next' && s.status.status === 'working' && s; });
  assert.equal(state.runs.find((r) => r.runId === broken.runId).status, 'failed');
  assert.equal(state.runs.filter((r) => r.taskId === 'broken-cli').length, 1);
  assert.equal(state.status.runId, next.runId); assert.equal(state.queue.length, 0);
  assert.equal(state.plan.cards.find((c) => c.id === 'next').queued, false);
  assert.equal(state.plan.cards.find((c) => c.id === 'next').status, 'working');
  const stale = await fetch(base + '/task', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'next', action: 'cancel', runId: first.runId }) });
  assert.equal(stale.status, 409);
  console.log('HARNESS_RUNTIME_OK recovery, deduplication, heartbeat, live queue dispatch, CLI failure, run identity');
} finally {
  const exited = new Promise((resolve) => server.once('exit', resolve));
  if (server.exitCode === null) { server.kill(); await exited; }
  fs.rmSync(workspace, { recursive: true, force: true });
}
