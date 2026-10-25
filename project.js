const projectSelect = document.getElementById('project-select');
const projectDialog = document.getElementById('project-dialog');
const projectForm = document.getElementById('project-form');
const projectName = document.getElementById('project-name');
const projectPath = document.getElementById('project-path');
const templateLabel = document.createElement('label'); templateLabel.htmlFor = 'project-template'; templateLabel.textContent = 'Шаблон проекта';
const projectTemplate = document.createElement('select'); projectTemplate.id = 'project-template'; projectTemplate.innerHTML = '<option value="web">Web-приложение</option><option value="backend">Backend/API</option><option value="saas">SaaS</option><option value="development">Разработка</option><option value="bug">Исправление дефекта</option><option value="research">Исследование</option><option value="release">Релиз</option><option value="migration">Миграция</option><option value="security">Проверка безопасности</option><option value="game">Игра</option>'; projectPath.before(templateLabel, projectTemplate);
const policyLabel = document.createElement('label'); policyLabel.htmlFor = 'project-policy'; policyLabel.textContent = 'Политика автономности';
const projectPolicy = document.createElement('select'); projectPolicy.id = 'project-policy'; projectPolicy.innerHTML = '<option value="safe">Строго безопасный — адаптеры git/npm</option><option value="development" selected>Обычная разработка — адаптеры и подтверждённые команды</option><option value="manual">Полный ручной контроль — без автозапуска</option>'; projectPath.before(policyLabel, projectPolicy);
let projects = [];
const onboardingStorageKey = 'harness-onboarding-complete';
function showProjectOnboarding() {
  if (localStorage.getItem(onboardingStorageKey) || projects.length > 1) return;
  const english = window.harnessI18n?.getLanguage() !== 'ru';
  const dialog = document.createElement('dialog');
  dialog.id = 'onboarding-dialog';
  dialog.innerHTML = `<div class="dialog-heading"><div><div class="eyebrow">${english ? 'FIRST WORKSPACE' : 'ПЕРВАЯ РАБОЧАЯ ОБЛАСТЬ'}</div><h2>${english ? 'Set up your first project' : 'Настройте первый проект'}</h2></div></div><p>${english ? 'Harness works with local project folders. Create a new workspace or connect an existing project to get started.' : 'Harness работает с локальными папками проектов. Создайте рабочую область или подключите существующий проект, чтобы начать.'}</p><div class="dialog-actions"><button id="onboarding-create" class="button primary">${english ? 'Create or connect project' : 'Создать или подключить проект'}</button></div><p class="run-note">${english ? 'You can add more projects later from the project switcher.' : 'Позже можно добавить проекты через переключатель проектов.'}</p>`;
  document.body.append(dialog);
  const finish = () => { localStorage.setItem(onboardingStorageKey, '1'); dialog.close(); dialog.remove(); };
  dialog.querySelector('#onboarding-create').onclick = () => { finish(); document.getElementById('add-project').click(); };
  dialog.addEventListener('cancel', finish, { once: true });
  dialog.showModal();
}
async function loadProjects() { const response = await fetch('/api/projects'); if (!response.ok) throw new Error('Projects unavailable'); projects = await response.json(); projectSelect.innerHTML = projects.map((project) => `<option value="${project.id}">${project.name}</option>`).join(''); const selected = projects.find((project) => project.id === (localStorage.getItem('harness-project') || 'harness')) || projects[0]; projectSelect.value = selected.id; await setActiveProject(selected); setTimeout(showProjectOnboarding, 0); }
projectSelect.addEventListener('change', async () => { const project = projects.find((item) => item.id === projectSelect.value); if (project) await setActiveProject(project); });
document.getElementById('add-project').addEventListener('click', () => { projectForm.reset(); projectTemplate.value = 'web'; projectPolicy.value = 'development'; projectDialog.showModal(); projectName.focus(); });
document.getElementById('remove-project').addEventListener('click', async () => {
  const selected = projects.find((item) => item.id === projectSelect.value);
  if (!selected || selected.id === 'harness') { toast('Основной проект Harness нельзя убрать из списка'); return; }
  if (!window.confirm(`Убрать «${selected.name}» из Harness? Файлы проекта не будут удалены.`)) return;
  const response = await fetch(`/api/projects/${encodeURIComponent(selected.id)}`, { method: 'DELETE' });
  if (!response.ok) { toast('Не удалось убрать проект'); return; }
  projects = projects.filter((item) => item.id !== selected.id);
  const fallback = projects.find((item) => item.id === 'harness') || projects[0];
  projectSelect.innerHTML = projects.map((project) => `<option value="${project.id}">${project.name}</option>`).join('');
  if (fallback) { projectSelect.value = fallback.id; await setActiveProject(fallback); }
  toast('Проект убран из списка, файлы сохранены');
});
projectForm.addEventListener('submit', async (event) => { if (event.submitter?.value === 'cancel') return; event.preventDefault(); const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: projectName.value.trim(), path: projectPath.value.trim(), template: projectTemplate.value, policy: projectPolicy.value }) }); const result = await response.json(); if (!response.ok) { toast(result.error || 'Не удалось добавить проект'); return; } projectDialog.close(); projects.push(result); projectSelect.insertAdjacentHTML('beforeend', `<option value="${result.id}">${result.name}</option>`); projectSelect.value = result.id; await setActiveProject(result); toast('Проект добавлен, папка .harness создана'); });
loadProjects().catch(() => toast('Не удалось загрузить проекты'));
