// Optional live smoke: verifies actual tool execution, not just a model reply.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { CodexBridge } = require('../codex-bridge');
const existingProject = process.argv[2];
const project = { path: existingProject ? fs.realpathSync(existingProject) : fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-tools-')) };
if (!existingProject) execFileSync('git', ['init', '-q', project.path], { windowsHide: true, stdio: 'ignore' });
let toolSucceeded = false;
new CodexBridge({
  appendEvent: (_, event) => console.log(event.type, event.event || '', event.error || ''),
  updateStatus: () => {},
  updateProgress: (_, __, p) => {
    if (p.itemType === 'command_execution' && p.exitCode === 0 && p.message?.includes('HARNESS_TOOLS_OK')) toolSucceeded = true;
  },
  finishRun: (_, __, result) => {
    const ok = result.status === 'completed' && toolSucceeded;
    console.log(ok ? 'HARNESS_REAL_TOOLS_OK' : 'HARNESS_REAL_TOOLS_FAILED', result.status, result.error || '');
    if (!ok) process.exitCode = 1;
    if (!existingProject) fs.rmSync(project.path, { recursive: true, force: true });
  },
}).start(project, { taskId: 'tools-probe', title: 'Verify tool execution', description: 'Use the terminal tool once to execute Write-Output HARNESS_TOOLS_OK in PowerShell. This is a read-only environment probe, not an implementation task. Do not create or modify any project files, do not stage or commit files, and do not update Harness status or reports. After seeing the command succeed, reply HARNESS_TOOLS_VERIFIED and stop.' }, { runId: `tools-probe-${Date.now()}` });
