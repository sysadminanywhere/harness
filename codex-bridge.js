const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function findCodex() {
  const configured = process.env.CODEX_CLI_PATH || process.env.CODEX_APP_RUNTIME_CLI_PATH;
  if (configured && fs.existsSync(configured)) return configured;
  const candidates = [path.join(process.env.LOCALAPPDATA || '', 'OpenAI', 'Codex', 'bin', 'codex.exe'), path.join(process.env.LOCALAPPDATA || '', 'Programs', 'Codex', 'codex.exe')];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || 'codex';
}

class CodexBridge {
  constructor({ appendEvent, updateStatus, finishRun }) { this.appendEvent = appendEvent; this.updateStatus = updateStatus; this.finishRun = finishRun; }

  start(project, input, run) {
    const prompt = [`Harness task: ${input.title}`, '', input.description || '', '', 'Acceptance criteria:', ...(input.criteria || []).map((item) => `- ${item}`), '', 'Work in this project and report meaningful progress in the Codex thread. Finish with a concise summary.'].join('\n');
    const child = spawn(findCodex(), ['exec', '--json', '--cd', project.path, '--sandbox', 'workspace-write', '--thread-source', 'harness', prompt], { cwd: project.path, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    let threadId = null;
    const handleEvent = (event) => {
      const eventThreadId = event.thread_id || event.threadId || event.thread?.id || threadId;
      if (eventThreadId && !threadId) {
        threadId = eventThreadId;
        this.updateStatus(project, { codexProjectPath: project.path, codexThreadId: threadId, codexThreadUrl: `codex://threads/${encodeURIComponent(threadId)}`, source: 'codex-exec', updatedAt: new Date().toISOString() });
        this.appendEvent(project, { type: 'codex_thread_started', source: 'codex-exec', taskId: input.taskId, runId: run.runId, threadId });
      }
      const meaningful = ['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.completed', 'error'].includes(event.type);
      if (meaningful) this.appendEvent(project, { type: 'codex_progress', source: 'codex-exec', taskId: input.taskId, runId: run.runId, threadId, event: event.type, status: event.status || null, message: event.message || event.error?.message || null });
    };
    child.stdout.on('data', (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
      for (const line of lines) { if (!line.trim()) continue; try { handleEvent(JSON.parse(line)); } catch { this.appendEvent(project, { type: 'codex_output', source: 'codex-exec', taskId: input.taskId, runId: run.runId, line: line.slice(0, 2000) }); } }
    });
    child.stderr.on('data', (chunk) => { const message = String(chunk).trim(); if (message) this.appendEvent(project, { type: 'codex_diagnostic', source: 'codex-exec', taskId: input.taskId, runId: run.runId, message: message.slice(0, 2000) }); });
    child.on('error', (error) => this.fail(project, input, run, error.message));
    child.on('close', (code) => {
      if (buffer.trim()) { try { handleEvent(JSON.parse(buffer)); } catch {} }
      const status = code === 0 ? 'completed' : 'failed';
      this.finishRun?.(project, run.runId, { status, exitCode: code, finishedAt: new Date().toISOString(), report: `# Codex report\n\n- Status: ${status}\n- Thread: ${threadId || 'not received'}\n- Exit code: ${code}` });
      this.updateStatus(project, { status, source: 'codex-exec', codexThreadId: threadId, codexThreadUrl: threadId ? `codex://threads/${encodeURIComponent(threadId)}` : undefined, exitCode: code, updatedAt: new Date().toISOString() });
      this.appendEvent(project, { type: code === 0 ? 'codex_completed' : 'codex_failed', source: 'codex-exec', taskId: input.taskId, runId: run.runId, threadId, exitCode: code });
    });
    return { runId: run.runId, status: 'working', source: 'codex-exec' };
  }

  fail(project, input, run, error) {
    this.updateStatus(project, { status: 'failed', source: 'codex-exec', codexError: error, updatedAt: new Date().toISOString() });
    this.appendEvent(project, { type: 'codex_bridge_error', source: 'codex-exec', taskId: input.taskId, runId: run.runId, error });
  }
}

module.exports = { CodexBridge };
