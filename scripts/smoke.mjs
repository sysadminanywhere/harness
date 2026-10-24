import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const baseUrl = process.env.HARNESS_URL || 'http://localhost:4173';
const root = path.resolve(import.meta.dirname, '..');

async function request(route, options) {
  const response = await fetch(`${baseUrl}${route}`, options);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* text response is valid for error diagnostics */ }
  if (!response.ok) throw new Error(`${options?.method || 'GET'} ${route} -> ${response.status}: ${text}`);
  return body;
}

const projects = await request('/api/projects');
if (!Array.isArray(projects) || !projects.some((project) => project.id === 'harness')) throw new Error('Harness project is missing');

const state = await request('/api/projects/harness/state');
if (!Array.isArray(state.plan?.cards) || !Array.isArray(state.plan?.columns)) throw new Error('Invalid persisted plan');
if (!state.claims || typeof state.claims !== 'object') throw new Error('Claim state is missing from project state');
if (!state.worker || state.worker.enabled !== false) throw new Error('Test worker mode is not explicit');
if (!['idle', 'working', 'paused', 'cancelled', 'completed', 'failed'].includes(state.status?.status)) throw new Error(`Unknown runtime status: ${state.status?.status}`);

const suggestion = await request('/api/projects/harness/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: 'smoke test' }) });
if (suggestion.provider !== 'local-planner' || suggestion.steps?.length !== 3) throw new Error('Local planner response is invalid');

for (const required of ['.harness/project.json', '.harness/plan.json', '.harness/status.json', '.harness/current-task.md', '.harness/events.jsonl', '.harness/reports/latest.md']) {
  if (!fs.existsSync(path.join(root, required))) throw new Error(`Missing file: ${required}`);
}
const localizationSource = fs.readFileSync(path.join(root, 'i18n.js'), 'utf8');
if (!localizationSource.includes('en:') || !localizationSource.includes('localStorage')) throw new Error('Localization source is incomplete');
if (!fs.existsSync(path.join(root, 'manifest.json')) || !fs.existsSync(path.join(root, 'sw.js'))) throw new Error('PWA shell is incomplete');
if (!fs.readFileSync(path.join(root, 'board.js'), 'utf8').includes('Notification.requestPermission')) throw new Error('Local notification support is incomplete');
const boardSource = fs.readFileSync(path.join(root, 'board.js'), 'utf8');
if (!boardSource.includes('parseImportedCards') || !boardSource.includes('githubIssues') || !boardSource.includes('trelloCards') || !boardSource.includes("accept = '.md,.markdown,.json,.csv")) throw new Error('Plan import support is incomplete');
if (!boardSource.includes('event.source || event.executor || event.claimedBy || \'user\'')) throw new Error('Event source display is incomplete');
if (!boardSource.includes('showPlanPreview') || !boardSource.includes('dependsOn') || !boardSource.includes('claimCard') || !boardSource.includes('heartbeatCard') || !boardSource.includes('data-release-id') || !boardSource.includes('renderDependencyGraph') || !boardSource.includes('eventsSearch') || !boardSource.includes('lastWarning')) throw new Error('Plan orchestration support is incomplete');

const temporaryProjectPath = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-smoke-'));
let temporaryProject;
let policyProject;
let policyPath;
const temporaryTemplateProjects = [];
const temporaryTemplatePaths = [];
try {
  temporaryProject = await request('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Smoke Recovery', path: temporaryProjectPath, template: 'backend' }) });
  const templateState = await request(`/api/projects/${temporaryProject.id}/state`);
  if (templateState.project.template !== 'backend' || templateState.plan.cards.length !== 3) throw new Error('Project template is invalid');
  policyPath = path.join(path.dirname(temporaryProjectPath), `harness-policy-${Date.now()}`);
  fs.mkdirSync(policyPath, { recursive: true });
  policyProject = await request('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Smoke Safe Policy', path: policyPath, template: 'backend', policy: 'safe' }) });
  const policyState = await request(`/api/projects/${policyProject.id}/state`);
  if (policyState.project.policy !== 'safe' || policyState.policy?.allowedAdapters?.includes('npm-build')) throw new Error('Safe project policy is invalid');
  for (const template of ['development', 'bug', 'research', 'release', 'migration', 'security']) {
    const templatePath = path.join(path.dirname(temporaryProjectPath), `harness-smoke-${template}-${Date.now()}`);
    fs.mkdirSync(templatePath, { recursive: true });
    temporaryTemplatePaths.push(templatePath);
    const templated = await request('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: `Smoke ${template}`, path: templatePath, template }) });
    temporaryTemplateProjects.push(templated);
    const templatedState = await request(`/api/projects/${templated.id}/state`);
    if (templatedState.plan.cards.length !== 3) throw new Error(`Template ${template} is invalid`);
  }
  await request(`/api/projects/${temporaryProject.id}/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(templateState.plan) });
  if (!fs.existsSync(path.join(temporaryProjectPath, '.harness', 'backups'))) throw new Error('Harness backup directory is missing');
  const stalePlanResponse = await fetch(`${baseUrl}/api/projects/${temporaryProject.id}/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...templateState.plan, revision: 0 }) });
  if (stalePlanResponse.status !== 409) throw new Error('Concurrent plan edit was not rejected');
  const changedPlan = structuredClone(templateState.plan); changedPlan.cards.push({ id: 'smoke-version', title: 'Version marker', status: 'inbox', priority: 'low', criteria: [] });
  await request(`/api/projects/${temporaryProject.id}/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(changedPlan) });
  const versions = await request(`/api/projects/${temporaryProject.id}/plan/versions`);
  if (versions.length < 2) throw new Error('Plan versions are missing');
  await request(`/api/projects/${temporaryProject.id}/plan/rollback`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ file: versions[0].file }) });
  const rolledBack = await request(`/api/projects/${temporaryProject.id}/state`);
  if (rolledBack.plan.cards.some((card) => card.id === 'smoke-version')) throw new Error('Plan rollback did not restore version');
  const cyclicPlan = structuredClone(templateState.plan); cyclicPlan.cards[0].dependencies = [cyclicPlan.cards[1].id]; cyclicPlan.cards[1].dependencies = [cyclicPlan.cards[0].id];
  const cycleResponse = await fetch(`${baseUrl}/api/projects/${temporaryProject.id}/plan`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cyclicPlan) });
  if (cycleResponse.status !== 400) throw new Error('Dependency cycle was accepted');
  const taskRequest = await request(`/api/projects/${temporaryProject.id}/task`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'smoke-task', title: 'Executor contract', executor: 'powershell', plan: [{ id: 'plan-api', title: 'Implement API', description: 'Create the endpoint' }, { id: 'plan-tests', title: 'Add tests', dependsOn: ['plan-api'] }] }) });
  if (taskRequest.executor !== 'powershell') throw new Error('Executor contract is missing from task request');
  const taskState = await request(`/api/projects/${temporaryProject.id}/state`);
  if (taskState.status?.executor !== 'powershell') throw new Error('Executor contract is missing from status');
  if (!taskState.currentTask.includes('## План') || !taskState.currentTask.includes('[plan:plan-api] Implement API') || !taskState.currentTask.includes('```json') || !taskState.currentTask.includes('"id": "plan-api"') || !taskState.currentTask.includes('plan-tests')) throw new Error('LLM plan was not written to current-task.md');
  const firstClaim = await request(`/api/projects/${temporaryProject.id}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'claim-demo', claimedBy: 'agent-a' }) });
  if (firstClaim.claimedBy !== 'agent-a') throw new Error('Task claim was not recorded');
  const claimedState = await request(`/api/projects/${temporaryProject.id}/state`);
  if (claimedState.claims['claim-demo']?.claimedBy !== 'agent-a') throw new Error('Claim is missing from project state');
  const secondClaim = await fetch(`${baseUrl}/api/projects/${temporaryProject.id}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'claim-demo', claimedBy: 'agent-b' }) });
  if (secondClaim.status !== 409) throw new Error('Concurrent task claim was accepted');
  await request(`/api/projects/${temporaryProject.id}/release`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'claim-demo', claimedBy: 'agent-a' }) });
  const reclaimed = await request(`/api/projects/${temporaryProject.id}/claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'claim-demo', claimedBy: 'agent-b' }) });
  if (reclaimed.claimedBy !== 'agent-b') throw new Error('Released task could not be reclaimed');
  const queuedRequest = await request(`/api/projects/${temporaryProject.id}/task`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'queued-task', title: 'Queued executor task', executor: 'cli', description: 'Queue contract', criteria: ['Queue is visible'] }) });
  if (!queuedRequest.queued || queuedRequest.selectedExecutor !== 'cli') throw new Error('Executor queue did not retain the requested executor');
  await request(`/api/projects/${temporaryProject.id}/task`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'priority-task', title: 'Priority executor task', executor: 'cli', priority: 'high', dueDate: '2026-10-25' }) });
  const queue = await request(`/api/projects/${temporaryProject.id}/queue`);
  if (queue.length !== 2 || !queue.some((item) => item.taskId === 'queued-task') || !queue.some((item) => item.taskId === 'priority-task')) throw new Error('Executor queue is missing the tasks');
  fs.writeFileSync(path.join(temporaryProjectPath, '.harness', 'status.json'), JSON.stringify({ ...taskState.status, status: 'completed', updatedAt: new Date().toISOString() }));
  const dispatched = await request(`/api/projects/${temporaryProject.id}/queue/next`, { method: 'POST' });
  if (!dispatched.dispatched || dispatched.taskId !== 'priority-task') throw new Error('Executor queue did not dispatch the highest-priority task');
  fs.writeFileSync(path.join(temporaryProjectPath, '.harness', 'status.json'), JSON.stringify({ ...taskState.status, updatedAt: new Date(Date.now() - 31 * 60 * 1000).toISOString() }));
  const staleState = await request(`/api/projects/${temporaryProject.id}/state`);
  if (!staleState.health?.warnings?.some((warning) => warning.includes('30 минут'))) throw new Error('Stale task warning is missing');
  const dryRun = await request(`/api/projects/${temporaryProject.id}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'smoke-command', command: 'Write-Output HARNESS_SMOKE', executor: 'powershell', dryRun: true }) });
  if (!dryRun.dryRun || dryRun.cwd !== temporaryProjectPath || dryRun.requiresConfirmation !== true) throw new Error('PowerShell dry-run contract is invalid');
  if (process.platform === 'win32') {
    const commandResult = await request(`/api/projects/${temporaryProject.id}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'smoke-command', title: 'PowerShell smoke', command: 'Write-Output HARNESS_SMOKE', executor: 'powershell', confirmed: true }) });
    if (commandResult.status !== 'completed' || !commandResult.output?.includes('HARNESS_SMOKE')) throw new Error(`PowerShell execution failed: ${JSON.stringify(commandResult)}`);
    const commandState = await request(`/api/projects/${temporaryProject.id}/state`);
    if (commandState.status?.source !== 'powershell' || !commandState.report.includes('HARNESS_SMOKE')) throw new Error('PowerShell report contract is invalid');
  }
  const adapterPreview = await request(`/api/projects/${temporaryProject.id}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'smoke-adapter', executor: 'cli', adapter: 'npm-test', dryRun: true }) });
  if (adapterPreview.adapter !== 'npm-test' || !adapterPreview.command.includes('npm')) throw new Error('CLI adapter dry-run is invalid');
  const autonomousBlocked = await fetch(`${baseUrl}/api/projects/${temporaryProject.id}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'smoke-autonomous-command', executor: 'cli', command: 'npm test', executionMode: 'auto', confirmed: true }) });
  if (autonomousBlocked.status !== 403) throw new Error('Autonomous arbitrary command was not blocked');
  const autonomousAdapter = await request(`/api/projects/${temporaryProject.id}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'smoke-autonomous-adapter', executor: 'cli', adapter: 'npm-test', executionMode: 'auto', dryRun: true }) });
  if (autonomousAdapter.adapter !== 'npm-test') throw new Error('Autonomous adapter policy rejected a safe adapter');
  const updatedPolicy = await request(`/api/projects/${temporaryProject.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ policy: 'manual', allowedAdapters: ['npm-test'] }) });
  const updatedPolicyState = await request(`/api/projects/${temporaryProject.id}/state`);
  if (updatedPolicy.policy !== 'manual' || updatedPolicyState.policy?.label !== 'Полный ручной контроль' || updatedPolicyState.policy.allowedAdapters.length !== 1) throw new Error('Project policy update was not persisted');
  const safeBlocked = await fetch(`${baseUrl}/api/projects/${policyProject.id}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'smoke-safe-command', executor: 'powershell', command: 'Write-Output SAFE', confirmed: true }) });
  if (safeBlocked.status !== 403) throw new Error('Safe policy allowed arbitrary shell command');
  const cliResult = await request(`/api/projects/${temporaryProject.id}/command`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ taskId: 'smoke-cli', executor: 'cli', command: 'node -e "console.log(\'HARNESS_CLI\')"', confirmed: true }) });
  if (cliResult.status !== 'completed' || !cliResult.output.includes('HARNESS_CLI') || cliResult.source !== 'cli') throw new Error('CLI execution failed');
  fs.writeFileSync(path.join(temporaryProjectPath, '.harness', 'plan.json'), '{"columns": [');
  const recovered = await request(`/api/projects/${temporaryProject.id}/state`);
  if (!recovered.health?.warnings?.some((warning) => warning.startsWith('plan.json:')) || !recovered.plan?.columns?.length) throw new Error('Corrupted JSON recovery warning is missing');
} finally {
  if (temporaryProject) await request(`/api/projects/${temporaryProject.id}`, { method: 'DELETE' });
  if (policyProject) await request(`/api/projects/${policyProject.id}`, { method: 'DELETE' });
  if (policyPath) fs.rmSync(policyPath, { recursive: true, force: true });
  for (const project of temporaryTemplateProjects) await request(`/api/projects/${project.id}`, { method: 'DELETE' });
  for (const templatePath of temporaryTemplatePaths) fs.rmSync(templatePath, { recursive: true, force: true });
  fs.rmSync(temporaryProjectPath, { recursive: true, force: true });
}

console.log(`HARNESS_SMOKE_OK projects=${projects.length} cards=${state.plan.cards.length} provider=${suggestion.provider}`);
