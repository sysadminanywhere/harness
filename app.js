const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
let toastTimer;
function toast(message) { const element = $('toast'); clearTimeout(toastTimer); element.textContent = message; element.classList.add('visible'); toastTimer = setTimeout(() => element.classList.remove('visible'), 8000); }
function executionText(ru, en) { return window.harnessI18n?.getLanguage() === 'en' ? en : ru; }
function executionNode(tag, className, text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function renderExecution() {
  if (!window.harnessBoardReady) return;
  const view = $('run-view'), status = boardState.runtimeStatus || {};
  $('top-status').textContent = window.harnessI18n?.t(status.status, status.status || 'idle') || status.status || 'idle';
  if (view.classList.contains('hidden-view')) return;
  if (view.dataset.projectId !== boardState.projectId) { view.dataset.projectId = boardState.projectId; delete view.dataset.selectedRun; }
  if (boardState.loadedProjectId !== boardState.projectId) { $('execution-title').textContent = executionText('Загрузка проекта…', 'Loading project…'); $('execution-report').textContent = ''; $('execution-events').replaceChildren(); $('execution-actions').replaceChildren(); $('execution-select').disabled = true; return; }
  $('execution-events-heading').textContent = executionText('События запуска', 'Run events'); $('execution-report-heading').textContent = executionText('Отчёт запуска', 'Run report');
  const runs = boardState.runs || [];
  const selected = runs.find((run) => run.runId === view.dataset.selectedRun) || runs.find((run) => run.runId === status.runId) || runs[0];
  const runId = selected?.runId;
  const picker = $('execution-select'); picker.replaceChildren(...runs.map((run) => new Option((run.title || run.taskId) + ' · ' + run.status + ' · ' + run.runId, run.runId))); picker.disabled = !runs.length; if (runId) picker.value = runId;
  picker.onchange = () => { view.dataset.selectedRun = picker.value; renderExecution(); };
  $('execution-follow').textContent = executionText('Текущий запуск', 'Current run'); $('execution-follow').onclick = () => { delete view.dataset.selectedRun; renderExecution(); };
  $('execution-title').textContent = selected?.title || selected?.taskId || executionText('Запусков пока нет', 'No runs yet');
  $('execution-meta').textContent = selected ? [selected.status, selected.executor, selected.executor === 'codex' ? selected.model || 'Codex default' : '', runId].filter(Boolean).join(' · ') : boardState.project?.name || '';
  $('execution-report').textContent = selected?.report || executionText('Отчёт этого запуска ещё не получен.', 'No report has been received for this run.');
  const card = boardState.data.cards.find((item) => item.id === selected?.taskId && item.runId === runId);
  $('execution-description').textContent = card?.description || selected?.input?.description || '';
  $('execution-criteria').replaceChildren(...(card?.criteria || selected?.input?.criteria || []).map((criterion) => executionNode('li', '', criterion)));
  const events = (boardState.events || []).filter((event) => runId && event.runId === runId).slice(-60);
  $('execution-events').replaceChildren(...events.map((event) => { const row = executionNode('article', 'execution-event'); row.append(executionNode('strong', '', event.event || event.type), executionNode('time', '', event.at ? new Date(event.at).toLocaleTimeString(languageLocale()) : ''), executionNode('p', '', event.message || event.error || event.command || [event.status, event.exitCode !== undefined ? 'exit: ' + event.exitCode : ''].filter(Boolean).join(' · '))); return row; }));
  if (!events.length) $('execution-events').append(executionNode('p', 'history-empty', executionText('Событий этого запуска пока нет.', 'No events for this run yet.')));
  const actions = [];
  if (card?.queued) actions.push('cancel');
  else if (card?.status === 'working') { if (['ide', 'human'].includes(card.executor)) actions.push('submit'); if (!['cli', 'powershell'].includes(card.executor)) actions.push('pause'); actions.push('cancel'); }
  else if (card?.paused) actions.push('resume', 'cancel');
  else if (card?.status === 'review') actions.push('complete', 'return');
  else if (card?.status === 'blocked') actions.push('retry');
  const names = { submit: executionText('Отправить результат', 'Submit result'), pause: executionText('Пауза', 'Pause'), resume: executionText('Продолжить', 'Resume'), cancel: executionText('Отменить', 'Cancel'), complete: executionText('Подтвердить результат', 'Accept result'), return: executionText('Вернуть', 'Return'), retry: executionText('Повторить', 'Retry') };
  $('execution-actions').replaceChildren(...actions.map((action) => { const button = executionNode('button', 'button secondary compact', names[action]); button.dataset.executionAction = action; button.onclick = () => performCardAction(card.id, action); return button; }));
  $('execution-export').disabled = !selected; $('execution-export').textContent = executionText('Экспорт запуска', 'Export run');
  $('execution-export').onclick = () => { if (selected) downloadExport('harness-' + runId + '.json', 'application/json', JSON.stringify({ project: boardState.project, run: selected, events }, null, 2)); };
  $('execution-back').textContent = executionText('Открыть доску', 'Open board'); $('execution-back').onclick = () => $('show-board').click();
}
$('history-button').onclick = () => { if (window.harnessBoardReady) showReport(); };
$('new-task').onclick = () => $('suggest-plan').click();
document.querySelector('.rail .rail-button.active')?.addEventListener('click', () => $('show-board').click());
document.addEventListener('keydown', (event) => {
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === 'k') { event.preventDefault(); $('history-button').click(); }
  if (event.key === 'Enter') { event.preventDefault(); const form = document.querySelector('dialog[open] form'); if (form) form.requestSubmit(); else if (!document.querySelector('dialog[open]')) $('add-card').click(); }
});
if (window.isSecureContext && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
