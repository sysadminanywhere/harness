// Use with controls-test.mjs --preview and playwright-cli run-code --filename.
(async (page) => {
  const getState = async () => (await page.request.get(new URL('/api/projects/browser-controls/state', page.url()).href)).json();
  const catalog = await (await page.request.get(new URL('/api/models', page.url()).href)).json();
  const models = [0, 1, 2].map((i) => catalog.models[i]?.id || 'test-model-' + i);
  const choose = async (id, model) => {
    const select = page.locator('#' + id);
    if (!model) return select.selectOption('');
    if (await select.locator('option').evaluateAll((options, value) => options.some((option) => option.value === value), model)) return select.selectOption(model);
    await select.selectOption('__custom__'); await page.locator('#' + id + '-custom').fill(model);
  };
  const openTask = async (id, global = false) => {
    await page.locator('[' + (global ? 'data-global-id' : 'data-card-id') + '="' + id + '"] .card-menu').click();
    await page.locator('#card-model').waitFor();
  };
  const saveTask = async () => { await page.locator('#save-card').click(); await page.locator('#card-dialog').waitFor({ state: 'hidden' }); };
  await page.getByRole('button', { name: '⚙ Настройки', exact: true }).click();
  await choose('project-model', models[0]); await page.locator('.settings-save').click();
  await page.locator('.project-settings-dialog').waitFor({ state: 'detached' });
  if ((await getState()).project.model !== models[0]) throw new Error('Project model not persisted');
  await openTask('ui-model-scope', true); await choose('card-model', models[1]); await saveTask();
  let s = await getState();
  if (s.plan.cards.find((c) => c.id === 'ui-model-child').effectiveModel !== models[1]) throw new Error('Scope inheritance failed');
  await openTask('ui-model-child'); await choose('card-model', models[2]); await saveTask();
  await page.reload(); await page.locator('[data-card-id="ui-model-child"]').waitFor();
  await openTask('ui-model-child');
  if (await page.locator('#card-model').inputValue() !== models[2]) throw new Error('Task model not restored after reload');
  await page.locator('#card-dialog .close-button').click();
  await page.locator('[data-card-id="ui-model-child"] [data-run-id]').click();
  await page.locator('.board-column[data-status="working"] [data-card-id="ui-model-child"]').waitFor();
  s = await getState(); const runId = s.status.runId;
  if (s.status.model !== models[2]) throw new Error('Run did not receive task model');
  await openTask('ui-model-child'); await choose('card-model', null); await saveTask();
  s = await getState(); const child = s.plan.cards.find((c) => c.id === 'ui-model-child');
  if (child.effectiveModel !== models[1] || child.executionModel !== models[2]) throw new Error('Running model was not pinned');
  const badge = await page.locator('[data-card-id="ui-model-child"] .model-badge').innerText();
  if (!badge.includes(models[2])) throw new Error('Badge shows planned model instead of active model');
  await page.locator('[data-card-id="ui-model-child"] [data-action="cancel"]').click();
  await page.locator('.board-column[data-status="blocked"] [data-card-id="ui-model-child"]').waitFor();
  await page.locator('[data-card-id="ui-model-child"] [data-action="retry"]').click();
  await page.locator('.board-column[data-status="working"] [data-card-id="ui-model-child"]').waitFor();
  s = await getState();
  if (s.status.model !== models[1] || s.status.runId === runId) throw new Error('Retry did not apply current inherited model');
  await page.locator('[data-card-id="ui-model-child"] [data-action="cancel"]').click();
  await page.locator('.board-column[data-status="blocked"] [data-card-id="ui-model-child"]').waitFor();
  return { result: 'HARNESS_BROWSER_MODELS_OK', models, checks: ['project persistence', 'scope inheritance', 'task override and reload', 'run pinning', 'retry current model'] };
})
