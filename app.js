const $ = (id) => document.getElementById(id);
let running = false, completed = false, activeTab = 'summary', events = [], startTime = 0, timer, runSnapshot = null;
let history = [];
try { history = JSON.parse(localStorage.getItem('harness-history') || '[]'); if (!Array.isArray(history)) history = []; } catch {}
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function toast(message) { $('toast').textContent = message; $('toast').classList.add('visible'); setTimeout(() => $('toast').classList.remove('visible'), 2600); }
function renderResult() {
  if (!completed) {
    $('result-content').innerHTML = `<div class="empty-output"><div class="output-icon">▤</div><h3>${running ? 'Агент выполняет задачу' : 'Результат появится здесь'}</h3><p>${running ? 'Сводка и изменения будут доступны<br>после завершения проверок.' : 'Изменения, проверки и краткая сводка<br>после завершения задачи.'}</p></div><div class="placeholder-check"><span>◇</span> Изменения файлов</div><div class="placeholder-check"><span>✓</span> Результаты проверок</div><div class="placeholder-check"><span>↻</span> Повторяемый запуск</div>`;
    return;
  }
  if (activeTab === 'diff') {
    $('result-content').innerHTML = `<div class="output-label">ДЕМОНСТРАЦИОННЫЙ DIFF</div><div class="diff-file">⑂ src/components/RunHistory.tsx</div><pre class="diff-code"><span class="diff-context">@@ История запусков @@</span>\n<span class="diff-add">+ const [query, setQuery] = useState('');\n+ const filtered = runs.filter(run =&gt;\n+   run.title.toLowerCase().includes(\n+     query.trim().toLowerCase()\n+   )\n+ );\n+\n+ &lt;SearchInput value={query}\n+   onChange={setQuery} /&gt;</span>\n<span class="diff-remove">- &lt;RunList runs={runs} /&gt;</span>\n<span class="diff-add">+ &lt;RunList runs={filtered} /&gt;</span></pre><div class="diff-file">⑂ src/components/EmptyState.tsx</div><pre class="diff-code"><span class="diff-add">+ export function EmptyState() {\n+   return (\n+     &lt;p&gt;Ничего не найдено.\n+       Попробуйте другой запрос.&lt;/p&gt;\n+   );\n+ }</span></pre><p class="run-note">Пример изменений. Файлы проекта не изменялись.</p>`;
  } else {
    $('result-content').innerHTML = `<div class="result-banner"><span>✓</span> Демонстрация завершена</div><p class="result-description">Показан пример добавления поиска по истории запусков и пустого состояния. Настоящую историю можно открыть кнопкой ◷ слева.</p><div class="result-stats"><div><strong>2</strong><small>файла в примере</small></div><div><strong class="positive">+18</strong><small>добавлено</small></div><div><strong class="negative">−1</strong><small>удалено</small></div></div><div class="output-label">КРИТЕРИИ СЦЕНАРИЯ</div><div class="check-row"><span>✓</span> Поиск по названию задачи</div><div class="check-row"><span>✓</span> Пустое состояние для поиска</div><div class="check-row"><span>✓</span> Показан этап проверки</div><p class="run-note">Проверки в ленте имитируются. Агент не подключён.</p><button id="replay" class="button secondary replay">↻ Повторить запуск</button>`;
    $('replay').onclick = run;
  }
}
function addEvent(title, description, tool, icon = '✓') {
  const time = $('elapsed').textContent;
  events.push({ title, description, tool, time });
  const element = document.createElement('article'); element.className = 'event';
  element.innerHTML = `<span class="event-icon">${icon}</span><div><div class="event-title">${escapeHtml(title)}<time>${time}</time></div><p>${escapeHtml(description)}</p>${tool ? `<div class="tool-block">${escapeHtml(tool)}</div>` : ''}</div>`;
  $('timeline').append(element); $('timeline').scrollTop = $('timeline').scrollHeight;
}
async function run() {
  if (running) return;
  const goal = $('goal').value.trim();
  if (!goal) { $('goal').focus(); toast('Опиши задачу перед запуском'); return; }
  runSnapshot = { goal, constraints: $('constraints').value, criteria: [...document.querySelectorAll('.criteria input')].map(input => ({ title: input.parentElement.textContent.trim(), enabled: input.checked })), date: new Date().toISOString() };
  running = true; completed = false; events = []; startTime = Date.now();
  $('timeline').innerHTML = ''; $('elapsed').textContent = '00:00'; $('run').disabled = true; $('new-task').disabled = true; $('goal').disabled = true; $('constraints').disabled = true; $('export').disabled = true;
  $('run').innerHTML = '<span>◌</span> Агент работает…'; $('top-status').textContent = 'Выполняется демо'; $('flow-status').textContent = 'В работе'; $('flow-status').classList.add('running'); $('flow-title').textContent = 'Демонстрационный запуск'; $('file-count').textContent = '0'; renderResult();
  timer = setInterval(() => { const seconds = Math.floor((Date.now() - startTime) / 1000); $('elapsed').textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`; }, 250);
  addEvent('Задача принята', goal, null, '↗'); await wait(1100);
  addEvent('Собираю контекст', 'Пример: агент изучает компоненты истории и существующие стили.', 'read_file  src/components/RunHistory.tsx\nread_file  src/styles/workspace.css', '⌕'); await wait(1400);
  addEvent('План изменений', 'Пример сценария: добавить фильтр по названию, обработать пустой список и проверить результат.', null, '◇'); await wait(1300);
  addEvent('Подготовлены изменения', 'В демонстрации показаны изменения двух компонентов.', 'apply_patch  RunHistory.tsx    +11 −1\napply_patch  EmptyState.tsx     +7', '⑂'); await wait(1500);
  addEvent('Проверки', 'Имитация проверки сценария: совпадение, пустой запрос, отсутствие результатов.', 'demo_check  title matching        PASS\ndemo_check  empty query           PASS\ndemo_check  no results            PASS', '✓'); await wait(900);
  addEvent('Запуск завершён', 'Сводка и пример diff доступны справа. Журнал можно сохранить.', null);
  clearInterval(timer); running = false; completed = true;
  $('run').disabled = false; $('new-task').disabled = false; $('goal').disabled = false; $('constraints').disabled = false; $('export').disabled = false;
  $('run').innerHTML = '<span>↻</span> Запустить снова <span class="key">↵</span>'; $('top-status').textContent = 'Демо завершено'; $('flow-status').textContent = 'Готово'; $('flow-title').textContent = 'Все этапы завершены'; $('file-count').textContent = '2'; renderResult();
  history.unshift({ ...runSnapshot, events: [...events] }); history = history.slice(0, 50);
  try { localStorage.setItem('harness-history', JSON.stringify(history)); } catch { toast('История доступна только в текущем сеансе'); }
}
function selectTab(tab) { activeTab = tab; $('summary-tab').classList.toggle('selected', tab === 'summary'); $('diff-tab').classList.toggle('selected', tab === 'diff'); $('summary-tab').setAttribute('aria-selected', String(tab === 'summary')); $('diff-tab').setAttribute('aria-selected', String(tab === 'diff')); renderResult(); }
function renderHistory() {
  const query = $('history-search').value.trim().toLocaleLowerCase();
  const filtered = history.map((item, index) => ({ ...item, index })).filter((item) => item.goal.toLocaleLowerCase().includes(query));
  $('history-list').innerHTML = filtered.length ? filtered.map((item) => `<button class="history-row" data-index="${item.index}"><strong>${escapeHtml(item.goal)}</strong><small>${new Date(item.date).toLocaleString('ru-RU')} · демонстрация · загрузить задачу</small></button>`).join('') : `<p class="history-empty">${query ? 'Ничего не найдено. Попробуй другой запрос.' : 'Пока нет запусков. Запусти первую задачу.'}</p>`;
  $('history-list').querySelectorAll('button').forEach((button) => { button.onclick = () => { if (running) { toast('Дождись завершения текущего запуска'); return; } const item = history[Number(button.dataset.index)]; $('goal').value = item.goal; $('constraints').value = item.constraints; $('history').close(); toast('Задача загружена для нового запуска'); }; });
}
$('run').onclick = run;
$('summary-tab').onclick = () => selectTab('summary'); $('diff-tab').onclick = () => selectTab('diff');
$('history-button').onclick = () => { $('history-search').value = ''; renderHistory(); $('history').showModal(); };
$('close-history').onclick = () => $('history').close(); $('history-search').oninput = renderHistory;
$('new-task').onclick = () => { if (running) return; $('goal').value = ''; $('constraints').value = ''; completed = false; events = []; $('timeline').innerHTML = '<div class="idle-state"><div class="orbit"><span>✳</span></div><h3>Новая цель — новый запуск</h3><p>Опиши задачу слева, чтобы начать.</p></div>'; $('elapsed').textContent = '00:00'; $('top-status').textContent = 'Готов к запуску'; $('flow-status').textContent = 'Ожидание'; $('flow-status').classList.remove('running'); $('flow-title').textContent = 'Всё готово к старту'; $('file-count').textContent = '0'; $('export').disabled = true; $('run').innerHTML = '<span>▶</span> Запустить задачу <span class="key">↵</span>'; selectTab('summary'); $('goal').focus(); };
$('export').onclick = () => { const blob = new Blob([JSON.stringify({ mode: 'demo', ...runSnapshot, events }, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'harness-run.json'; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
document.addEventListener('keydown', (event) => { if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && !$('history').open) { event.preventDefault(); run(); } if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); $('history-button').click(); } });
renderResult();
