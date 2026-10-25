// Run with playwright-cli run-code --filename scripts/browser-controls-probe.js
// against the isolated Browser controls project created by controls-test.mjs --preview.
(async (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const card = (id) => page.locator('[data-card-id="' + id + '"]');
  const waitColumn = (id, column) => page.waitForFunction(({ id, column }) => Boolean(document.querySelector('.board-column[data-status="' + column + '"] [data-card-id="' + id + '"]')), { id, column });
  const act = async (id, action) => card(id).locator('[data-action="' + action + '"]').click();
  const run = async (id) => card(id).locator('[data-run-id]').click();
  const getState = async () => (await page.request.get(new URL('/api/projects/browser-controls/state', page.url()).href)).json();
  await run('ui-active'); await waitColumn('ui-active', 'working');
  const firstRun = (await getState()).status.runId;
  await run('ui-queued'); await card('ui-queued').locator('.queue-info').waitFor();
  await act('ui-queued', 'cancel'); await waitColumn('ui-queued', 'blocked');
  if ((await getState()).queue.length) throw new Error('Queued cancellation left a request');
  await act('ui-review', 'complete'); await waitColumn('ui-review', 'done');
  await act('ui-return', 'return'); await waitColumn('ui-return', 'ready');
  if ((await getState()).status.runId !== firstRun) throw new Error('Historical review overwrote the active run');
  await act('ui-active', 'pause'); await waitColumn('ui-active', 'approval');
  await act('ui-active', 'resume'); await waitColumn('ui-active', 'working');
  await act('ui-active', 'cancel'); await waitColumn('ui-active', 'blocked');
  await act('ui-active', 'retry'); await waitColumn('ui-active', 'working');
  if ((await getState()).status.runId === firstRun) throw new Error('Retry reused an old attempt');
  await act('ui-active', 'cancel'); await waitColumn('ui-active', 'blocked');
  page.once('dialog', (dialog) => dialog.accept());
  await run('ui-command'); await waitColumn('ui-command', 'working');
  if (await card('ui-command').locator('[data-action="pause"]').count()) throw new Error('Command advertises unsupported pause');
  await act('ui-command', 'cancel'); await waitColumn('ui-command', 'blocked');
  await page.reload(); await card('ui-command').waitFor();
  for (const id of ['ui-active', 'ui-command', 'ui-queued']) await waitColumn(id, 'blocked');
  await waitColumn('ui-review', 'done'); await waitColumn('ui-return', 'ready');
  const final = await getState();
  if (final.status.status !== 'cancelled' || final.queue.length || Object.keys(final.claims).length) throw new Error('Final runtime or claims did not persist');
  if (errors.length) throw new Error(errors.join('\n'));
  return { result: 'HARNESS_BROWSER_CONTROLS_OK', checks: ['active and queued cancellation', 'historical review and return', 'pause/resume', 'retry identity', 'real command cancellation', 'reload persistence'], errors };
})
