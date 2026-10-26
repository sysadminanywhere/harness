// Use on the isolated controls-test.mjs --preview workspace.
(async (page) => {
  await page.reload();
  const errors = []; page.on('pageerror', (error) => errors.push(error.message));
  const api = (suffix) => new URL(suffix, page.url()).href;
  await page.locator('#project-select').selectOption('browser-controls');
  await page.locator('[data-card-id="ui-active"]').waitFor();
  const projectA = 'browser-controls', projectB = 'harness';
  let release, reached;
  const gate = new Promise((resolve) => { release = resolve; });
  const intercepted = new Promise((resolve) => { reached = resolve; });
  const planAUrl = api('/api/projects/' + projectA + '/plan');
  const stateBUrl = api('/api/projects/' + projectB + '/state');
  let releaseLoad, reachedLoad;
  const loadGate = new Promise((resolve) => { releaseLoad = resolve; }); const loadIntercepted = new Promise((resolve) => { reachedLoad = resolve; });
  await page.route(stateBUrl, async (route) => { reachedLoad(); await loadGate; await route.continue(); });
  await page.route(planAUrl, async (route) => { if (route.request().method() !== 'PUT') return route.continue(); reached(); await gate; await route.continue(); });
  let independent = false;
  try {
    await page.evaluate(() => {
      boardState.data.cards = boardState.data.cards.filter((card) => card.id !== 'independent-save-a');
      boardState.data.cards.push({ id: 'independent-save-a', title: 'Independent A', status: 'inbox', priority: 'medium', executor: 'human' });
      window.workflowSaveA = saveBoard();
    });
    await Promise.race([intercepted, new Promise((_, reject) => setTimeout(() => reject(new Error('Save A did not reach server route')), 5000))]);
    await page.locator('#project-select').selectOption(projectB);
    await loadIntercepted;
    const blocked = await page.evaluate(async () => { let rejected = false; try { await saveBoard(); } catch { rejected = true; } return rejected && !canEdit() && boardEl.inert; });
    if (!blocked) throw new Error('Old project data remained actionable while loading another project');
    releaseLoad();
    await page.waitForFunction(() => boardState.loadedProjectId === 'harness');
    independent = await page.evaluate(async () => {
      boardState.data.cards = boardState.data.cards.filter((card) => card.id !== 'independent-save-b');
      boardState.data.cards.push({ id: 'independent-save-b', title: 'Independent B', status: 'inbox', priority: 'medium', executor: 'human' });
      window.workflowSaveB = saveBoard();
      return Promise.race([window.workflowSaveB.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 2000))]);
    });
  } finally {
    releaseLoad(); release();
    await page.evaluate(async () => { await Promise.all([window.workflowSaveA, window.workflowSaveB]); delete window.workflowSaveA; delete window.workflowSaveB; });
    await page.unroute(planAUrl);
    await page.unroute(stateBUrl);
  }
  if (!independent) throw new Error('Saving B waited for delayed save A');
  const stateA = await (await page.request.get(api('/api/projects/' + projectA + '/state'))).json();
  const stateB = await (await page.request.get(api('/api/projects/' + projectB + '/state'))).json();
  if (!stateA.plan.cards.some((card) => card.id === 'independent-save-a') || stateA.plan.cards.some((card) => card.id === 'independent-save-b') || !stateB.plan.cards.some((card) => card.id === 'independent-save-b') || stateB.plan.cards.some((card) => card.id === 'independent-save-a')) throw new Error('Independent project saves crossed project boundaries');
  if (await page.evaluate(() => boardState.projectId !== 'harness' || boardState.data.cards.some((card) => card.id === 'independent-save-a'))) throw new Error('Late A response replaced B');
  await page.locator('#project-select').selectOption(projectA); await page.locator('[data-card-id="ui-active"]').waitFor();
  const imported = { cards: [{ id: 'foreign-active', title: 'Workflow imported active', status: 'working', runId: 'foreign-run', executor: 'codex', executionMode: 'auto', approved: true }, { id: 'foreign-review', title: 'Workflow imported review', status: 'review', runId: 'foreign-review-run', executor: 'ide' }] };
  await page.locator('input[type="file"]').setInputFiles({ name: 'workflow.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(imported)) });
  await page.waitForFunction(() => pendingSaves === 0 && boardState.data.cards.some((card) => card.title === 'Workflow imported review'));
  const importedState = await (await page.request.get(api('/api/projects/' + projectA + '/state'))).json();
  for (const card of importedState.plan.cards.filter((item) => item.title.startsWith('Workflow imported'))) if (card.runId || card.status !== 'ready' || card.executionMode !== 'manual' || card.approved) throw new Error('Import retained execution identity or automatic approval');
  const csv = '\uFEFFtitle,description,status,executor\r\n"Workflow CSV, quoted","One ""quoted"" line\nSecond line",ready,human';
  await page.locator('input[type="file"]').setInputFiles({ name: 'workflow.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await page.waitForFunction(() => pendingSaves === 0 && boardState.data.cards.some((card) => card.title === 'Workflow CSV, quoted'));
  const csvCard = await page.evaluate(() => boardState.data.cards.find((card) => card.title === 'Workflow CSV, quoted'));
  if (csvCard.description !== 'One "quoted" line\nSecond line') throw new Error('CSV quoted fields or newlines were corrupted');
  const projectPath = stateA.project.path + '/.harness/reports';
  const create = await page.request.post(api('/api/projects'), { data: { name: 'Workflow reconnect', path: projectPath } });
  if (!create.ok()) throw new Error('Reconnect fixture failed'); const connected = await create.json();
  await page.request.put(api('/api/projects/' + connected.id), { data: { model: 'workflow-model', policy: 'safe', allowedAdapters: ['git-status'] } });
  await page.request.delete(api('/api/projects/' + connected.id));
  await page.locator('#add-project').click(); await page.locator('#project-name').fill('Workflow reconnect'); await page.locator('#project-path').fill(projectPath);
  if (await page.locator('#project-policy').inputValue() !== '') throw new Error('Connect form overrides existing settings by default');
  await page.locator('#project-form button[value="default"]').click(); await page.locator('#project-dialog').waitFor({ state: 'hidden' });
  await page.waitForFunction(() => boardState.project?.name === 'Workflow reconnect');
  const restored = await page.evaluate(() => boardState.project);
  if (restored.model !== 'workflow-model' || restored.policy !== 'safe' || restored.allowedAdapters.join(',') !== 'git-status') throw new Error('Reconnect form lost project settings');
  await page.request.delete(api('/api/projects/' + restored.id)); await page.reload(); await page.locator('#project-select').selectOption(projectA);
  await page.locator('[data-card-id="ui-active"]').waitFor();
  if (errors.length) throw new Error(errors.join('\n'));
  return { result: 'HARNESS_BROWSER_WORKFLOWS_OK', checks: ['independent project saves', 'late response isolation', 'project loading blocks stale actions', 'import resets foreign execution state', 'CSV quotes newlines and BOM', 'reconnect form preserves settings'], errors };
})
