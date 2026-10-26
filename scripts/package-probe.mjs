// Build the unpacked Windows app first, then verify its actual Electron Node runtime.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
const packageDir = path.resolve(process.argv[2] || 'release/audit-desktop/win-unpacked');
const executable = path.join(packageDir, 'Harness Lab.exe');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-package-'));
fs.writeFileSync(path.join(workspace, 'package.json'), JSON.stringify({ scripts: { test: 'node -e "console.log(\'HARNESS_PACKAGED_NPM_OK\')"' } }));
const probe = net.createServer(); await new Promise((resolve) => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise((resolve) => probe.close(resolve));
const server = spawn(executable, [path.join(packageDir, 'resources', 'app.asar.unpacked', 'server.js')], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', HARNESS_WORKSPACE: workspace, HARNESS_APP_ROOT: path.join(packageDir, 'resources', 'app.asar'), HARNESS_PORT: String(port), HARNESS_AUTO_DISPATCH: 'false', HARNESS_CODEX_BRIDGE: 'false' }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], windowsHide: true });
let logs = ''; server.stdout.on('data', (chunk) => { logs += chunk; }); server.stderr.on('data', (chunk) => { logs += chunk; });
try {
  for (let i = 0; i < 150 && !logs.includes('Harness Lab:'); i++) { if (server.exitCode !== null) throw new Error(logs); await new Promise((resolve) => setTimeout(resolve, 50)); }
  const base = `http://127.0.0.1:${port}`;
  assert.match(await (await fetch(base + '/')).text(), /Harness Lab/);
  const catalog = await (await fetch(base + '/api/models')).json(); assert.ok(Array.isArray(catalog.models));
  await fetch(base + '/api/projects');
  const response = await fetch(base + '/api/projects/harness/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'packaged-npm', executor: 'cli', adapter: 'npm-test', confirmed: true }) });
  const result = await response.json(); assert.equal(result.status, 'completed', JSON.stringify(result)); assert.match(result.output, /HARNESS_PACKAGED_NPM_OK/);
  console.log('HARNESS_PACKAGED_RUNTIME_OK static asar, model module, npm adapter through Electron Node, IPC shutdown');
} finally {
  if (server.exitCode === null && server.signalCode === null) { const closed = new Promise((resolve) => server.once('exit', resolve)); if (server.connected) server.send({ type: 'harness:shutdown' }); else server.kill(); const timer = setTimeout(() => server.kill(), 7000); await closed; clearTimeout(timer); }
  fs.rmSync(workspace, { recursive: true, force: true });
}
