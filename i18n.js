const translations = {
  ru: {
    'workspace': 'Рабочая область', 'project': 'ПРОЕКТ', 'addProject': 'Добавить проект', 'removeProject': 'Убрать проект из Harness', 'fileBridge': 'File bridge', 'projectBridge': 'PROJECT BRIDGE', 'name': 'Название', 'path': 'Путь к папке проекта', 'projectHint': 'Harness создаст внутри проекта папку .harness и не изменит исходный код.',
    'missionEyebrow': 'MISSION CONTROL / 001', 'heroTitle': 'План под контролем.', 'heroText': 'Разложи цель на шаги, запусти исполнителя и контролируй каждое решение.',
    'board': '▦ Доска', 'execution': '▶ Исполнение', 'newPlan': 'Новый план', 'activePlan': 'ACTIVE PLAN', 'report': '▤ Отчёт', 'suggest': '✦ Предложить план', 'addStep': '＋ Добавить шаг',
    'searchPlaceholder': 'Поиск по плану…', 'allPriorities': 'Все приоритеты', 'high': 'Высокий', 'medium': 'Средний', 'low': 'Низкий',
    'projectLabel': 'ПРОЕКТ', 'branchLabel': 'ВЕТКА', 'modeLabel': 'РЕЖИМ', 'modeDemo': 'Локальная рабочая область', 'branchLoading': 'проверка…', 'branchNone': 'не Git-проект',
    'steps': 'шагов', 'completed': 'завершено', 'sync': 'синхр.', 'ideas': 'Идеи', 'ready': 'К выполнению', 'working': 'В работе', 'approval': 'Ожидает решения', 'review': 'Проверка', 'blocked': 'Заблокировано', 'done': 'Завершено',
    'localPlanner': 'LOCAL PLANNER', 'plannerTitle': 'Предложить план', 'goal': 'Цель', 'constraints': 'Ограничения', 'plannerHint': 'План будет предложен на доску и не запустится без вашего решения.', 'buildPlan': 'Сформировать план',
    'codexReport': 'CODEX REPORT', 'reportTitle': 'Отчёт проекта', 'lastEvents': 'Последние события', 'noEvents': 'Событий пока нет.', 'noReport': 'Отчёт пока не создан.',
    'step': 'PLAN STEP', 'newStep': 'Новый шаг', 'editStep': 'Изменить шаг', 'title': 'Название', 'description': 'Что сделать', 'priority': 'Приоритет', 'status': 'Статус', 'executor': 'Исполнитель', 'dependencies': 'Зависимости (ID карточек через запятую)', 'delete': 'Удалить', 'cancel': 'Отмена', 'saveStep': 'Сохранить шаг',
    'local': 'local', 'pause': 'Ⅱ Пауза', 'resume': '▶ Продолжить', 'cancelTask': 'Отменить', 'approve': '✓ Разрешить запуск', 'complete': '✓ Подтвердить результат', 'return': '↶ Вернуть в работу', 'retry': '↻ Повторить', 'run': '▶ Запустить', 'running': '◌ Исполнитель в работе', 'paused': 'Ⅱ Исполнитель на паузе',
    'history': 'История карточки', 'noHistory': 'Пока нет событий', 'noMatches': 'Нет совпадений', 'dependenciesShort': 'завис.', 'dependencyBlocked': 'Сначала завершите зависимости', 'highApproval': 'Высокий приоритет требует подтверждения', 'taskSaved': 'Задача записана в .harness/current-task.md', 'projectRemoved': 'Проект убран из списка, файлы сохранены', 'projectProtected': 'Основной проект Harness нельзя убрать из списка', 'executor.codex': 'Codex', 'executor.ide': 'IDE', 'executor.powershell': 'PowerShell', 'executor.cli': 'CLI / скрипт', 'executor.human': 'Человек'
  },
  en: {
    'workspace': 'Workspace', 'project': 'PROJECT', 'addProject': 'Add project', 'removeProject': 'Remove project from Harness', 'fileBridge': 'File bridge', 'projectBridge': 'PROJECT BRIDGE', 'name': 'Name', 'path': 'Project folder path', 'projectHint': 'Harness will create a .harness folder inside the project and will not change source code.',
    'missionEyebrow': 'MISSION CONTROL / 001', 'heroTitle': 'Plan under control.', 'heroText': 'Break down the goal, launch an executor and control every decision.',
    'board': '▦ Board', 'execution': '▶ Execution', 'newPlan': 'New plan', 'activePlan': 'ACTIVE PLAN', 'report': '▤ Report', 'suggest': '✦ Suggest plan', 'addStep': '＋ Add step',
    'searchPlaceholder': 'Search plan…', 'allPriorities': 'All priorities', 'high': 'High', 'medium': 'Medium', 'low': 'Low',
    'projectLabel': 'PROJECT', 'branchLabel': 'BRANCH', 'modeLabel': 'MODE', 'modeDemo': 'Local workspace', 'branchLoading': 'checking…', 'branchNone': 'not a Git project',
    'steps': 'steps', 'completed': 'completed', 'sync': 'synced', 'ideas': 'Ideas', 'ready': 'To do', 'working': 'Working', 'approval': 'Needs decision', 'review': 'Review', 'blocked': 'Blocked', 'done': 'Done',
    'localPlanner': 'LOCAL PLANNER', 'plannerTitle': 'Suggest plan', 'goal': 'Goal', 'constraints': 'Constraints', 'plannerHint': 'The plan will be added to the board and will not start without your decision.', 'buildPlan': 'Build plan',
    'codexReport': 'EXECUTOR REPORT', 'reportTitle': 'Project report', 'lastEvents': 'Recent events', 'noEvents': 'No events yet.', 'noReport': 'No report yet.',
    'step': 'PLAN STEP', 'newStep': 'New step', 'editStep': 'Edit step', 'title': 'Title', 'description': 'What to do', 'priority': 'Priority', 'status': 'Status', 'executor': 'Executor', 'dependencies': 'Dependencies (comma-separated card IDs)', 'delete': 'Delete', 'cancel': 'Cancel', 'saveStep': 'Save step',
    'local': 'local', 'pause': 'Ⅱ Pause', 'resume': '▶ Resume', 'cancelTask': 'Cancel', 'approve': '✓ Approve launch', 'complete': '✓ Confirm result', 'return': '↶ Return to work', 'retry': '↻ Retry', 'run': '▶ Run', 'running': '◌ Executor is working', 'paused': 'Ⅱ Executor is paused',
    'history': 'Card history', 'noHistory': 'No events yet', 'noMatches': 'No matches', 'dependenciesShort': 'deps.', 'dependencyBlocked': 'Complete dependencies first', 'highApproval': 'High priority requires approval', 'taskSaved': 'Task written to .harness/current-task.md', 'projectRemoved': 'Project removed from list, files preserved', 'projectProtected': 'The main Harness project cannot be removed', 'executor.codex': 'Codex', 'executor.ide': 'IDE', 'executor.powershell': 'PowerShell', 'executor.cli': 'CLI / script', 'executor.human': 'Human'
  }
};

const languageStorageKey = 'harness-language';
let language = localStorage.getItem(languageStorageKey) || 'en';
function t(key, fallback = translations.en[key] || key) { return translations[language]?.[key] || translations.en[key] || fallback; }
function setText(selector, key) { const element = document.querySelector(selector); if (element) element.textContent = t(key); }
function applyLanguage() {
  document.documentElement.lang = language;
  setText('.project-switcher span', 'project'); setText('.connection', 'fileBridge'); setText('.page-heading .eyebrow', 'missionEyebrow'); setText('.page-heading h1', 'heroTitle'); setText('.page-heading p', 'heroText');
  setText('#show-board', 'board'); setText('#show-run', 'execution'); setText('#new-plan', 'newPlan'); setText('.board-toolbar .tiny-label', 'activePlan'); setText('#show-report', 'report'); setText('#suggest-plan', 'suggest'); setText('#add-card', 'addStep');
  setText('.overview>div:nth-child(1) small', 'projectLabel'); setText('.overview>div:nth-child(2) small', 'branchLabel'); setText('.overview>div:nth-child(3) small', 'modeLabel'); setText('.overview>div:nth-child(3) strong', 'modeDemo');
  setText('#planner-dialog .eyebrow', 'localPlanner'); setText('#planner-dialog h2', 'plannerTitle'); setText('#planner-dialog label[for="planner-goal"]', 'goal'); setText('#planner-dialog label[for="planner-constraints"]', 'constraints'); setText('#planner-dialog .run-note', 'plannerHint'); setText('#planner-submit', 'buildPlan'); setText('#project-dialog .eyebrow', 'projectBridge'); setText('#project-dialog h2', 'addProject'); setText('#project-dialog label[for="project-name"]', 'name'); setText('#project-dialog label[for="project-path"]', 'path'); setText('#project-dialog .run-note', 'projectHint'); setText('#save-project', 'addProject');
  setText('#report-dialog .eyebrow', 'codexReport'); setText('#report-dialog h2', 'reportTitle'); setText('#card-dialog .eyebrow', 'step'); setText('#card-dialog label[for="card-title"]', 'title'); setText('#card-dialog label[for="card-description"]', 'description');
  const cardLabel = document.querySelector('#card-priority')?.parentElement; if (cardLabel) cardLabel.childNodes[0].textContent = `${t('priority')} `;
  const statusLabel = document.querySelector('#card-status')?.parentElement; if (statusLabel) statusLabel.childNodes[0].textContent = `${t('status')} `;
  const executorLabel = document.querySelector('label[for="card-executor"]'); if (executorLabel) executorLabel.textContent = t('executor');
  const executor = document.querySelector('#card-executor'); if (executor) executor.querySelectorAll('option').forEach((option) => { option.textContent = t(`executor.${option.value}`, option.textContent); });
  const plannerGoal = document.querySelector('#planner-goal'); if (plannerGoal) plannerGoal.placeholder = language === 'en' ? 'For example: add authentication to the project' : 'Например: добавить авторизацию в проект';
  const plannerConstraints = document.querySelector('#planner-constraints'); if (plannerConstraints) plannerConstraints.placeholder = language === 'en' ? 'No new dependencies, preserve the current API' : 'Без новых зависимостей, сохранить текущий API';
  const search = document.querySelector('#board-search'); if (search) search.placeholder = t('searchPlaceholder');
  const priority = document.querySelector('#board-priority'); if (priority) { priority.options[0].text = t('allPriorities'); priority.options[1].text = t('high'); priority.options[2].text = t('medium'); priority.options[3].text = t('low'); }
  const executorFilter = document.querySelector('#board-executor'); if (executorFilter) { executorFilter.options[0].text = language === 'en' ? 'All executors' : 'Все исполнители'; executorFilter.querySelectorAll('option:not(:first-child)').forEach((option) => { option.textContent = t(`executor.${option.value}`, option.textContent); }); }
  const dependencyFilter = document.querySelector('#board-dependency'); if (dependencyFilter) { dependencyFilter.options[0].text = language === 'en' ? 'All dependencies' : 'Все зависимости'; dependencyFilter.options[1].text = language === 'en' ? 'With dependencies' : 'С зависимостями'; dependencyFilter.options[2].text = language === 'en' ? 'Without dependencies' : 'Без зависимостей'; }
  const deadlineFilter = document.querySelector('#board-deadline'); if (deadlineFilter) { deadlineFilter.options[0].text = language === 'en' ? 'All deadlines' : 'Все сроки'; deadlineFilter.options[1].text = language === 'en' ? 'Overdue' : 'Просроченные'; deadlineFilter.options[2].text = language === 'en' ? 'With deadline' : 'С дедлайном'; deadlineFilter.options[3].text = language === 'en' ? 'No deadline' : 'Без дедлайна'; }
  const viewFilter = document.querySelector('#board-saved-view'); if (viewFilter) { viewFilter.options[0].text = language === 'en' ? 'All tasks' : 'Все задачи'; viewFilter.options[1].text = language === 'en' ? 'My tasks' : 'Мои задачи'; viewFilter.options[2].text = language === 'en' ? 'Blocked' : 'Заблокированные'; viewFilter.options[3].text = language === 'en' ? 'In review' : 'На проверке'; viewFilter.options[4].text = 'Timeline'; }
  const dueDateLabel = document.querySelector('label[for="card-due-date"]'); if (dueDateLabel) dueDateLabel.textContent = language === 'en' ? 'Due date' : 'Дедлайн';
  const estimateLabel = document.querySelector('label[for="card-estimate"]'); if (estimateLabel) estimateLabel.textContent = language === 'en' ? 'Estimate, hours' : 'Оценка, часов';
  const roleLabel = document.querySelector('label[for="card-role"]'); if (roleLabel) roleLabel.textContent = language === 'en' ? 'Role' : 'Роль';
  const commentLabel = document.querySelector('label[for="card-comment"]'); if (commentLabel) commentLabel.textContent = language === 'en' ? 'Comment' : 'Комментарий';
  const role = document.querySelector('#card-role'); if (role) { role.options[0].text = language === 'en' ? 'Executor' : 'Исполнитель'; role.options[1].text = language === 'en' ? 'Owner' : 'Владелец'; role.options[2].text = language === 'en' ? 'Reviewer' : 'Ревьюер'; role.options[3].text = language === 'en' ? 'Observer' : 'Наблюдатель'; }
  const userRole = document.querySelector('#user-role'); if (userRole) { userRole.options[0].text = language === 'en' ? 'Owner' : 'Владелец'; userRole.options[1].text = language === 'en' ? 'Executor' : 'Исполнитель'; userRole.options[2].text = language === 'en' ? 'Reviewer' : 'Ревьюер'; userRole.options[3].text = language === 'en' ? 'Observer' : 'Наблюдатель'; }
  document.querySelectorAll('#card-priority option')[0].text = t('low'); document.querySelectorAll('#card-priority option')[1].text = t('medium'); document.querySelectorAll('#card-priority option')[2].text = t('high');
  document.querySelectorAll('#card-status option').forEach((option) => { option.text = t(option.value); });
  if (window.harnessBoardReady && window.renderBoard) window.renderBoard();
}
function installLanguagePicker() {
  const header = document.querySelector('.header-right'); if (!header || document.querySelector('#language-select')) return;
  const select = document.createElement('select'); select.id = 'language-select'; select.className = 'language-select'; select.setAttribute('aria-label', 'Language'); select.innerHTML = '<option value="ru">RU</option><option value="en">EN</option>'; select.value = language;
  select.addEventListener('change', () => { language = select.value; localStorage.setItem(languageStorageKey, language); applyLanguage(); }); header.prepend(select); applyLanguage();
}
window.harnessI18n = { t: (key, fallback) => t(key, fallback), getLanguage: () => language, applyLanguage };
installLanguagePicker();
