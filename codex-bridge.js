const fs = require('node:fs');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');

function findCodex({ env = process.env, platform = process.platform } = {}) {
  const isFile = (file) => { try { return Boolean(file) && fs.statSync(file).isFile(); } catch { return false; } };
  // An explicit user override must not silently select a different installation.
  if (env.CODEX_CLI_PATH) {
    if (isFile(env.CODEX_CLI_PATH)) return path.resolve(env.CODEX_CLI_PATH);
    throw new Error(`Codex CLI not found at CODEX_CLI_PATH: ${env.CODEX_CLI_PATH}`);
  }
  if (isFile(env.CODEX_APP_RUNTIME_CLI_PATH)) return path.resolve(env.CODEX_APP_RUNTIME_CLI_PATH);
  const executable = platform === 'win32' ? 'codex.exe' : 'codex';
  const pathValue = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || '';
  const pathCandidate = pathValue.split(platform === 'win32' ? ';' : ':').filter(Boolean)
    .map((directory) => path.join(directory.replace(/^"|"$/g, ''), executable)).find(isFile);
  if (pathCandidate) return path.resolve(pathCandidate);
  const local = env.LOCALAPPDATA || (env.USERPROFILE ? path.join(env.USERPROFILE, 'AppData', 'Local') : null);
  if (platform === 'win32' && local) {
    const bin = path.join(local, 'OpenAI', 'Codex', 'bin');
    const stable = [path.join(bin, executable), path.join(local, 'Programs', 'Codex', executable)].find(isFile);
    if (stable) return stable;
    // Desktop updates install the CLI in bin/<build-id>/codex.exe, not bin/codex.exe.
    let builds = [];
    try { builds = fs.readdirSync(bin, { withFileTypes: true }).filter((entry) => entry.isDirectory())
      .map((entry) => path.join(bin, entry.name, executable)).filter(isFile); } catch { /* desktop may not be installed */ }
    builds.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs || a.localeCompare(b));
    if (builds.length) return builds[0];
  }
  throw new Error('Codex CLI не найден. Укажите полный путь к исполняемому файлу в CODEX_CLI_PATH или установите Codex CLI в PATH.');
}

const textKeys = new Set(['message', 'text', 'summary', 'content', 'output', 'aggregated_output', 'delta', 'detail', 'reason']);
const sandboxFailurePattern = /helper_unknown_error|setup refresh had errors|windows sandbox failed|Failed to create unified exec process/i;
function prepareCodexEnvironment(project, run, env = process.env) {
  const temp = path.resolve(project.path, '.harness', 'runs', run.runId, 'tmp');
  fs.mkdirSync(temp, { recursive: true });
  // The legacy Windows sandbox must be able to grant ACLs on its TEMP root.
  // A shared TEMP directory may allow file creation but deny WRITE_DAC.
  return { ...Object.fromEntries(Object.entries(env).filter(([key]) => !['TEMP', 'TMP'].includes(key.toUpperCase()))), TEMP: temp, TMP: temp };
}
function collectText(value, key = '', result = []) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (text && (textKeys.has(key) || key === '')) result.push(text);
    return result;
  }
  if (Array.isArray(value)) { value.forEach((item) => collectText(item, key, result)); return result; }
  if (!value || typeof value !== 'object') return result;
  Object.entries(value).forEach(([childKey, childValue]) => collectText(childValue, childKey, result));
  return result;
}
function eventMessage(event) {
  const values = collectText(event).filter((text, index, all) => all.indexOf(text) === index);
  return values.join('\n').slice(0, 12000) || null;
}

function terminateProcessTree(child) {
  if (!child?.pid || child.exitCode !== null && child.exitCode !== undefined || child.signalCode) return;
  if (process.platform === 'win32') {
    const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
    try { execFileSync(path.join(systemRoot, 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000, stdio: 'ignore' }); }
    catch (error) { try { process.kill(child.pid, 0); } catch (probe) { if (probe.code === 'ESRCH') return; } throw error; }
  } else child.kill('SIGTERM');
}

class CodexBridge {
  constructor({ appendEvent, updateStatus, updateProgress, finishRun, isCurrent = () => true, spawnProcess = spawn, startupTimeoutMs = Number(process.env.HARNESS_CODEX_START_TIMEOUT_MS || 30000), terminateProcess, prepareEnvironment = prepareCodexEnvironment }) {
    Object.assign(this, { appendEvent, updateStatus, updateProgress, finishRun, isCurrent, spawnProcess, startupTimeoutMs, prepareEnvironment });
    this.active = new Map();
    this.terminateProcess = terminateProcess || terminateProcessTree;
  }

  stop(project, runId, status = 'cancelled') {
    const active = this.active.get(project.path);
    if (!active || active.runId !== runId) return false;
    this.terminateProcess(active.child);
    active.finish(status, null, status === 'paused' ? null : 'Запуск остановлен пользователем.');
    return true;
  }

  start(project, input, run) {
    const prompt = [`Harness task: ${input.title}`, '', input.description || '', '', 'Acceptance criteria:', ...(input.criteria || []).map((item) => `- ${item}`), '', 'Work in this project and report meaningful progress in the Codex thread. Finish with a concise summary.'].join('\n');
    if (!this.isCurrent(project, run.runId)) return { runId: run.runId, status: 'cancelled' };
    if (this.active.has(project.path)) throw new Error('Previous Codex process is still running');
    const args = ['exec', '--json', '--cd', project.path, '--sandbox', 'workspace-write', '--thread-source', 'harness', ...(input.resumeThreadId ? ['resume', input.resumeThreadId] : []), prompt];
    const child = this.spawnProcess(findCodex(), args, { cwd: project.path, env: this.prepareEnvironment(project, run), windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '';
    let threadId = null;
    let finished = false;
    let turnCompleted = false;
    let failure = null;
    let turnFailed = false;
    let infrastructureFailure = null;
    let startupTimer;
    const finish = (status, code, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(startupTimer);
      this.active.delete(project.path);
      this.finishRun?.(project, run.runId, { status, threadId, suspended: status === 'paused', exitCode: code, error: error || null, finishedAt: new Date().toISOString() });
      if (this.isCurrent(project, run.runId)) this.updateStatus(project, { status, source: 'codex-exec', codexThreadId: threadId, codexError: error || null, exitCode: code, updatedAt: new Date().toISOString() });
      this.appendEvent(project, { type: `codex_${status}`, source: 'codex-exec', taskId: input.taskId, runId: run.runId, threadId, exitCode: code, error: error || null });
    };
    this.active.set(project.path, { child, runId: run.runId, finish });
    startupTimer = setTimeout(() => {
      const error = 'Codex не создал сессию за отведённое время. Проверьте CLI и авторизацию.';
      try { this.terminateProcess(child); } catch (cause) { failure = cause.message; }
      finish('failed', null, failure ? `${error} ${failure}` : error);
    }, this.startupTimeoutMs);
    startupTimer.unref?.();
    this.updateProgress?.(project, run, { event: 'codex_started', message: `Codex начал работу над задачей «${input.title}».` });
    const handleEvent = (event) => {
      if (finished || !this.isCurrent(project, run.runId)) return;
      const eventThreadId = event.thread_id || event.threadId || event.thread?.id || threadId;
      if (eventThreadId && !threadId) {
        threadId = eventThreadId;
        clearTimeout(startupTimer);
        this.updateStatus(project, { codexProjectPath: project.path, codexThreadId: threadId, codexThreadUrl: `codex://threads/${encodeURIComponent(threadId)}`, source: 'codex-exec', updatedAt: new Date().toISOString() });
        this.appendEvent(project, { type: 'codex_thread_started', source: 'codex-exec', taskId: input.taskId, runId: run.runId, threadId });
      }
      if (event.type === 'turn.completed') turnCompleted = true;
      if (event.type === 'turn.failed') turnFailed = true;
      if (event.type === 'item.completed' && event.item?.type === 'command_execution') {
        if (event.item.exit_code === 0 && event.item.status === 'completed') infrastructureFailure = null;
        else if (sandboxFailurePattern.test(event.item.aggregated_output || '')) infrastructureFailure = 'Windows sandbox: setup refresh had errors; инструменты Codex не запустились.';
      }
      if (event.type === 'turn.failed' || event.type === 'error') failure = eventMessage(event) || event.error?.message || 'Codex сообщил об ошибке.';
      const meaningful = ['thread.started', 'turn.started', 'turn.completed', 'turn.failed', 'item.started', 'item.completed', 'error'].includes(event.type);
      const message = eventMessage(event);
      if (meaningful || message) {
        this.appendEvent(project, { type: 'codex_progress', source: 'codex-exec', taskId: input.taskId, runId: run.runId, threadId, event: event.type, status: event.status || event.item?.status || null, itemType: event.item?.type, exitCode: event.item?.exit_code, message });
        this.updateProgress?.(project, run, { event: event.type, status: event.status || null, message, threadId, itemType: event.item?.type, itemStatus: event.item?.status, exitCode: event.item?.exit_code });
      }
    };
    child.stdout.on('data', (chunk) => {
      if (finished || !this.isCurrent(project, run.runId)) return;
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/); buffer = lines.pop() || '';
      for (const line of lines) { if (!line.trim()) continue; try { handleEvent(JSON.parse(line)); } catch { const output = line.slice(0, 2000); this.appendEvent(project, { type: 'codex_output', source: 'codex-exec', taskId: input.taskId, runId: run.runId, line: output }); this.updateProgress?.(project, run, { event: 'codex_output', message: output }); } }
    });
    child.stderr.on('data', (chunk) => { if (finished || !this.isCurrent(project, run.runId)) return; const message = String(chunk).trim(); if (message) { const output = message.slice(0, 2000); failure = output; if (sandboxFailurePattern.test(message)) infrastructureFailure = 'Windows sandbox: setup refresh had errors; инструменты Codex не запустились.'; this.appendEvent(project, { type: 'codex_diagnostic', source: 'codex-exec', taskId: input.taskId, runId: run.runId, message: output }); this.updateProgress?.(project, run, { event: 'codex_diagnostic', message: output }); } });
    child.on('error', (error) => finish('failed', null, error.message));
    child.on('close', (code) => {
      if (buffer.trim()) { try { handleEvent(JSON.parse(buffer)); } catch {} }
      const success = code === 0 && turnCompleted && !turnFailed && !infrastructureFailure;
      finish(success ? 'completed' : 'failed', code, success ? null : infrastructureFailure || failure || 'Codex завершился без события turn.completed.');
    });
    return { runId: run.runId, status: 'working', source: 'codex-exec' };
  }

  fail(project, input, run, error) {
    this.finishRun?.(project, run.runId, { status: 'failed', error, exitCode: null, finishedAt: new Date().toISOString() });
    if (this.isCurrent(project, run.runId)) this.updateStatus(project, { status: 'failed', source: 'codex-exec', codexError: error, updatedAt: new Date().toISOString() });
    this.appendEvent(project, { type: 'codex_bridge_error', source: 'codex-exec', taskId: input.taskId, runId: run.runId, error });
  }
}

module.exports = { CodexBridge, eventMessage, findCodex, terminateProcessTree, prepareCodexEnvironment };
