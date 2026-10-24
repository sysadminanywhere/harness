const projectSelect = document.getElementById('project-select');
const projectDialog = document.getElementById('project-dialog');
const projectForm = document.getElementById('project-form');
const projectName = document.getElementById('project-name');
const projectPath = document.getElementById('project-path');
let projects = [];
async function loadProjects() { const response = await fetch('/api/projects'); if (!response.ok) throw new Error('Projects unavailable'); projects = await response.json(); projectSelect.innerHTML = projects.map((project) => `<option value="${project.id}">${project.name}</option>`).join(''); const selected = projects.find((project) => project.id === (localStorage.getItem('harness-project') || 'harness')) || projects[0]; projectSelect.value = selected.id; await setActiveProject(selected); }
projectSelect.addEventListener('change', async () => { const project = projects.find((item) => item.id === projectSelect.value); if (project) await setActiveProject(project); });
document.getElementById('add-project').addEventListener('click', () => { projectForm.reset(); projectDialog.showModal(); projectName.focus(); });
projectForm.addEventListener('submit', async (event) => { event.preventDefault(); const response = await fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: projectName.value.trim(), path: projectPath.value.trim() }) }); const result = await response.json(); if (!response.ok) { toast(result.error || 'Не удалось добавить проект'); return; } projectDialog.close(); projects.push(result); projectSelect.insertAdjacentHTML('beforeend', `<option value="${result.id}">${result.name}</option>`); projectSelect.value = result.id; await setActiveProject(result); toast('Проект добавлен, папка .harness создана'); });
loadProjects().catch(() => toast('Не удалось загрузить проекты'));
