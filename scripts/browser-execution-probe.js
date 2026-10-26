// Verifies that primary navigation controls actual runs instead of the old demo.
(async (page) => {
  await page.reload(); const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  await page.locator('#project-select').selectOption('browser-controls'); await page.waitForFunction(() => boardState.loadedProjectId === 'browser-controls');
  const url = (suffix) => new URL('/api/projects/browser-controls' + suffix, page.url()).href;
  const state = await (await page.request.get(url('/state'))).json();
  state.plan.cards.push({ id: 'execution-monitor-probe', title: 'Actual execution monitor probe', status: 'ready', executor: 'ide', priority: 'medium', criteria: ['Actual run and report visible'] });
  const saved = await page.request.put(url('/plan'), { data: state.plan }); if (!saved.ok()) throw new Error('Execution fixture failed');
  await page.reload(); await page.locator('[data-card-id="execution-monitor-probe"] [data-run-id]').click();
  await page.locator('.board-column[data-status="working"] [data-card-id="execution-monitor-probe"]').waitFor();
  const first = await (await page.request.get(url('/state'))).json(); await page.locator('#show-run').click();
  await page.waitForFunction((id) => document.querySelector('#execution-select').value === id, first.status.runId);
  if (!(await page.locator('#execution-title').innerText()).includes('Actual execution monitor')) throw new Error('Execution tab is not showing the actual task');
  if (!(await page.locator('#execution-events').innerText()).includes('start_task')) throw new Error('Actual request event is missing');
  if (await page.locator('#goal, #run, #result-content, #history').count()) throw new Error('Demo controls are still reachable');
  await page.locator('[data-execution-action="cancel"]').click(); await page.waitForFunction(() => document.querySelector('#execution-meta').textContent.includes('cancelled'));
  await page.locator('[data-execution-action="retry"]').click(); await page.waitForFunction((id) => document.querySelector('#execution-select').value !== id && document.querySelector('#execution-meta').textContent.includes('working'), first.status.runId);
  await page.evaluate(() => { window.executionProbePrompt = window.prompt; window.prompt = () => 'REAL_EXECUTION_MONITOR_RESULT verified.'; });
  await page.locator('[data-execution-action="submit"]').click(); await page.waitForFunction(() => document.querySelector('#execution-report').textContent.includes('REAL_EXECUTION_MONITOR_RESULT'));
  await page.evaluate(() => { window.prompt = window.executionProbePrompt; delete window.executionProbePrompt; });
  await page.locator('[data-execution-action="complete"]').click(); await page.waitForFunction(() => !document.querySelector('[data-execution-action="complete"]'));
  const complete = await (await page.request.get(url('/state'))).json(); if (complete.plan.cards.find((card) => card.id === 'execution-monitor-probe').status !== 'done') throw new Error('Execution monitor acceptance did not persist');
  await page.locator('#history-button').click(); await page.locator('#report-dialog').waitFor();
  if (!(await page.locator('#report-content').innerText()).includes('REAL_EXECUTION_MONITOR_RESULT')) throw new Error('Sidebar history shows demo or another report');
  await page.locator('#close-report').click();
  await page.locator('#new-task').click(); await page.locator('#planner-dialog').waitFor();
  await page.locator('#planner-goal').fill('Real navigation planner probe'); await page.locator('#planner-constraints').fill('Preserve execution monitor API'); await page.locator('#planner-submit').click(); await page.locator('#planner-dialog').waitFor({ state: 'hidden' });
  if (await page.locator('#board-view').evaluate((node) => node.classList.contains('hidden-view'))) throw new Error('New plan did not return to the actual board');
  const final = await (await page.request.get(url('/state'))).json(); if (final.runs.length !== complete.runs.length || final.plan.cards.length !== complete.plan.cards.length + 3) throw new Error('Planner simulated a run instead of creating real plan cards');
  const previousIds = new Set(complete.plan.cards.map((card) => card.id)); if (final.plan.cards.filter((card) => !previousIds.has(card.id)).some((card) => card.constraints !== 'Preserve execution monitor API' || !card.description.includes('Real navigation planner probe'))) throw new Error('Planner lost goal or constraints before task execution');
  if (errors.length) throw new Error(errors.join('\n'));
  return { result: 'HARNESS_BROWSER_EXECUTION_OK', checks: ['real task and events', 'cancel and Retry control actual attempts', 'result submit and acceptance', 'sidebar actual run history', 'new-plan actual planner', 'no demo controls'], errors };
})
