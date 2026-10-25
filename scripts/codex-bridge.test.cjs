const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { CodexBridge, findCodex, prepareCodexEnvironment } = require('../codex-bridge');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('desktop CLI is found without Codex environment or PATH, including versioned builds', () => {
  const local = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-cli-path-'));
  const bin = path.join(local, 'OpenAI', 'Codex', 'bin');
  const older = path.join(bin, 'older-build', 'codex.exe');
  const newer = path.join(bin, 'newer-build', 'codex.exe');
  try {
    for (const file of [older, newer]) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'test executable'); }
    fs.utimesSync(older, new Date(1000), new Date(1000));
    fs.mkdirSync(path.join(bin, 'incomplete-update'), { recursive: true });
    assert.equal(findCodex({ platform: 'win32', env: { LOCALAPPDATA: local } }), newer);
    assert.equal(findCodex({ platform: 'win32', env: { LOCALAPPDATA: local, CODEX_APP_RUNTIME_CLI_PATH: path.join(local, 'removed.exe') } }), newer);
    assert.equal(findCodex({ platform: 'win32', env: { CODEX_CLI_PATH: older, LOCALAPPDATA: local } }), older);
    assert.throws(() => findCodex({ platform: 'win32', env: { CODEX_CLI_PATH: path.join(local, 'missing.exe'), LOCALAPPDATA: local } }), /CODEX_CLI_PATH/);
    assert.equal(findCodex({ platform: 'win32', env: { Path: path.dirname(older) } }), older);
    assert.throws(() => findCodex({ platform: 'win32', env: {} }), /CODEX_CLI_PATH/);
  } finally { fs.rmSync(local, { recursive: true, force: true }); }
});

function fixture(options = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 123;
  const result = { progress: [], statuses: [], finished: [], events: [], killed: 0 };
  let current = 'run-1';
  const bridge = new CodexBridge({
    prepareEnvironment: () => ({ ...process.env }),
    spawnProcess: () => child, startupTimeoutMs: 10000,
    terminateProcess: () => { result.killed++; },
    isCurrent: (_, id) => id === current,
    appendEvent: (_, event) => result.events.push(event),
    updateProgress: (_, run, progress) => result.progress.push({ run, ...progress }),
    updateStatus: (_, status) => result.statuses.push(status),
    finishRun: (_, id, status) => result.finished.push({ id, ...status }), ...options,
  });
  const project = { path: 'test-project' };
  const start = () => bridge.start(project, { taskId: 'task', title: 'Test' }, { runId: 'run-1' });
  const emit = (event) => child.stdout.emit('data', JSON.stringify(event) + '\n');
  return { child, bridge, result, project, start, emit, changeRun: (id) => { current = id; } };
}

test('spawn error and close finish only once and preserve the cause', () => {
  const f = fixture(); f.start(); f.child.emit('error', new Error('ENOENT'));
  f.child.emit('close', -4058);
  assert.equal(f.result.finished.length, 1); assert.equal(f.result.finished[0].error, 'ENOENT');
  assert.equal(f.result.statuses.at(-1).status, 'failed');
});
test('zero exit without completed turn is a failure', () => {
  const f = fixture(); f.start(); f.child.emit('close', 0);
  assert.equal(f.result.finished[0].status, 'failed');
});
test('split JSONL, trailing event and messages survive a successful run', () => {
  const f = fixture(); f.start();
  f.child.stdout.emit('data', '{"type":"thread.');
  f.child.stdout.emit('data', 'started","thread_id":"thread-1"}\n');
  f.emit({ type: 'item.completed', item: { type: 'agent_message', text: 'Result verified' } });
  f.child.stdout.emit('data', '{"type":"turn.completed"}'); f.child.emit('close', 0);
  assert.equal(f.result.finished[0].status, 'completed');
  assert.ok(f.result.progress.some((p) => p.message === 'Result verified'));
});
test('turn failure is not accepted as success even after a zero exit', () => {
  const f = fixture(); f.start(); f.emit({ type: 'turn.failed', error: { message: 'Auth failed' } }); f.child.emit('close', 0);
  assert.equal(f.result.finished[0].status, 'failed'); assert.match(f.result.finished[0].error, /Auth failed/);
});
test('cancel stops the process and ignores late progress and close', () => {
  const f = fixture(); f.start(); assert.equal(f.bridge.stop(f.project, 'run-1'), true);
  const count = f.result.progress.length;
  f.emit({ type: 'thread.started', thread_id: 'late' }); f.child.emit('close', 0);
  assert.equal(f.result.killed, 1); assert.equal(f.result.finished.length, 1);
  assert.equal(f.result.finished[0].status, 'cancelled'); assert.equal(f.result.progress.length, count);
});
test('old run cannot change the new run status', () => {
  const f = fixture(); f.start(); f.changeRun('run-2');
  f.emit({ type: 'thread.started', thread_id: 'old' }); f.child.emit('close', 1);
  assert.equal(f.result.statuses.length, 0); assert.equal(f.result.progress.length, 1);
  assert.equal(f.result.finished[0].id, 'run-1');
});
test('missing thread hits startup timeout and terminates process', async () => {
  const f = fixture({ startupTimeoutMs: 15 }); f.start();
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(f.result.killed, 1); assert.equal(f.result.finished[0].status, 'failed');
  f.child.emit('close', 1); assert.equal(f.result.finished.length, 1);
});
test('real thread cancels startup timeout', async () => {
  const f = fixture({ startupTimeoutMs: 15 }); f.start(); f.emit({ type: 'thread.started', thread_id: 'thread' });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(f.result.killed, 0); assert.equal(f.result.finished.length, 0);
  f.emit({ type: 'turn.completed' }); f.child.emit('close', 0);
});
test('second process in same project is rejected until cancelled', () => {
  const f = fixture(); f.start(); assert.throws(f.start, /still running/); f.bridge.stop(f.project, 'run-1');
});
test('cancel terminates a real child process', async () => {
  const { spawn } = require('node:child_process');
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const closed = new Promise((resolve) => child.once('close', resolve));
  const f = fixture({ spawnProcess: () => child, terminateProcess: undefined });
  try {
    f.start(); f.bridge.stop(f.project, 'run-1'); await closed;
    assert.throws(() => process.kill(child.pid, 0), { code: 'ESRCH' });
    assert.equal(f.result.finished.length, 1); assert.equal(f.result.finished[0].status, 'cancelled');
  } finally { if (child.exitCode === null && child.signalCode === null) child.kill(); }
});
test('pause stops the child, preserves the thread and resumes via exec resume', () => {
  const calls = [];
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.pid = 321;
  const f = fixture({ spawnProcess: (file, args) => { calls.push(args); return child; } });
  f.start(); child.stdout.emit('data', '{"type":"thread.started","thread_id":"saved-thread"}\n');
  assert.equal(f.bridge.stop(f.project, 'run-1', 'paused'), true);
  assert.equal(f.result.finished[0].status, 'paused'); assert.equal(f.result.finished[0].threadId, 'saved-thread'); assert.equal(f.result.killed, 1);
  f.bridge.start(f.project, { taskId: 'task', title: 'Continue', resumeThreadId: 'saved-thread' }, { runId: 'run-1' });
  assert.ok(calls[1].includes('resume')); assert.ok(calls[1].includes('saved-thread'));
  f.bridge.stop(f.project, 'run-1');
});
test('sandbox failure is not completed merely because the model exits zero', () => {
  const f = fixture(); f.start(); f.emit({ type: 'thread.started', thread_id: 'thread' });
  f.child.stderr.emit('data', 'exec_command failed: helper_unknown_error: setup refresh had errors');
  f.emit({ type: 'turn.completed' }); f.child.emit('close', 0);
  assert.equal(f.result.finished[0].status, 'failed'); assert.match(f.result.finished[0].error, /sandbox/);
});
test('a successful command after transient sandbox failure permits recovery', () => {
  const f = fixture(); f.start(); f.child.stderr.emit('data', 'setup refresh had errors');
  f.emit({ type: 'item.completed', item: { type: 'command_execution', status: 'completed', exit_code: 0, aggregated_output: 'TOOLS_OK' } });
  f.emit({ type: 'turn.completed' }); f.child.emit('close', 0);
  assert.equal(f.result.finished[0].status, 'completed'); assert.ok(f.result.progress.some((p) => p.message === 'TOOLS_OK'));
});
test('each Codex run gets an owned temporary directory without changing global environment', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-env-'));
  try {
    const env = { TEMP: 'shared-root', TMP: 'shared-root', Path: 'preserved' };
    const prepared = prepareCodexEnvironment({ path: root }, { runId: 'probe-run' }, env);
    assert.equal(prepared.TEMP, path.join(root, '.harness', 'runs', 'probe-run', 'tmp'));
    assert.equal(prepared.TEMP, prepared.TMP); assert.ok(fs.statSync(prepared.TEMP).isDirectory());
    assert.equal(env.TEMP, 'shared-root'); assert.equal(prepared.Path, 'preserved');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
