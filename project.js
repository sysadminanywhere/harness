const projectSelect = document.getElementById('project-select');
const projectDialog = document.getElementById('project-dialog');
const projectForm = document.getElementById('project-form');
const projectName = document.getElementById('project-name');
const projectPath = document.getElementById('project-path');
const templateLabel = document.createElement('label'); templateLabel.htmlFor = 'project-template'; templateLabel.textContent = 'Шаблон проекта';
const projectTemplate = document.createElement('select'); projectTemplate.id = 'project-template'; projectTemplate.innerHTML = '<option value="web">Web-приложение</option><option value="backend">Backend/API</option><option value="saas">SaaS</option><option value="research">Исследование</option><option value="game">Игра</option>'; projectPath.before(templateLabel, projectTemplate);
let projects = [];
async function loadProjects() { const response = await fetch('/api/projects'); if (!response.ok) throw new Error('Projects unavailable'); projects = await response.json(); projectSelect.innerHTML = projects.map((project) => `<option value="${project.id}">${project.name}</option>`).join(''); const selected = projects.find((project) => project.id === (localStorage.getItem('harness-project') || 'harness')) || projects[0]; projectSelect.value = selected.id; await setActiveProject(selected); }
projectSelect.addEventListener('change', async () => { const project = projects.find((item) => item.id === projectSelect.value); if (project) await setActiveProject(project); });
document.getElementById('add-project').addEventListener('click', () => { projectForm.reset(); projectTemplate.value = 'web'; projectDialog.showModal(); projectName.focus(); });
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
projectForm.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: projectName.value.trim(), path: projectPath.value.trim(), template: projectTemplate.value }) }); const result = await response.json(); if (!response.ok) { toast(result.error || 'Не удалось добавить проект'); return; } projectDialog.close(); projects.push(result); projectSelect.insertAdjacentHTML('beforeend', `<option value="${result.id}">${result.name}</option>`); projectSelect.value = result.id; await setActiveProject(result); toast('Проект добавлен, папка .harness создана'); });
loadProjects().catch(() => toast('Не удалось загрузить проекты'));
