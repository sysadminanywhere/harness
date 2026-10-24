import { spawn } from 'node:child_process';

const port = process.env.HARNESS_TEST_PORT || '43173';
const baseUrl = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server.js'], {
  cwd: process.cwd(),
    env: { ...process.env, HARNESS_PORT: port },
  stdio: 'inherit',
  windowsHide: true,
});

let stopping = false;

function stopServer() {
  if (stopping) return;
  stopping = true;
  if (!server.killed) server.kill();
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/api/projects`);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Harness server did not start at ${baseUrl}: ${lastError?.message || 'timeout'}`);
}

async function main() {
  await waitForServer();
  const smoke = spawn(process.execPath, ['scripts/smoke.mjs'], {
    cwd: process.cwd(),
    env: { ...process.env, HARNESS_URL: baseUrl },
    stdio: 'inherit',
    windowsHide: true,
  });

  const exitCode = await new Promise((resolve, reject) => {
    smoke.once('error', reject);
    smoke.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

try {
  await main();
} finally {
  stopServer();
}
