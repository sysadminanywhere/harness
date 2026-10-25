// Optional live probe: uses the signed-in Codex account, without modifying a project.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { CodexBridge } = require('../codex-bridge');
const project = { path: fs.mkdtempSync(path.join(os.tmpdir(), 'harness-codex-controls-')) };
execFileSync('git', ['init', '-q', project.path], { windowsHide: true, stdio: 'ignore' });
const run = { runId: 'live-controls-probe' };
const input = { taskId: 'live-controls-probe', title: 'Control transport probe', description: 'Reply with HARNESS_CONTROLS_RESUMED only. Do not read, create or modify files. Do not use tools.' };
let phase = 'starting';
let reply = '';
const bridge = new CodexBridge({
  appendEvent: (_, event) => console.log(event.type, event.event || '', event.error || ''),
  updateStatus: () => {},
  updateProgress: (_, __, progress) => {
    if (progress.event === 'item.completed' && progress.message) reply += progress.message;
    if (progress.event === 'turn.started' && phase === 'starting') {
      phase = 'pausing';
      setTimeout(() => bridge.stop(project, run.runId, 'paused'), 0);
    }
  },
  finishRun: (_, __, result) => {
    if (result.status === 'paused' && result.threadId) {
      console.log('LIVE_PAUSED', result.threadId); phase = 'resuming';
      setTimeout(() => bridge.start(project, { ...input, resumeThreadId: result.threadId }, run), 100);
    } else {
      const ok = result.status === 'completed' && phase === 'resuming' && reply.includes('HARNESS_CONTROLS_RESUMED');
      console.log(ok ? 'HARNESS_REAL_CONTROLS_OK' : 'HARNESS_REAL_CONTROLS_FAILED', result.status, result.error || '', reply);
      if (!ok) process.exitCode = 1;
      fs.rmSync(project.path, { recursive: true, force: true });
    }
  },
});
bridge.start(project, input, run);
