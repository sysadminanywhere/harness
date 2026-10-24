const plannerDialog = document.getElementById('planner-dialog');
document.querySelector('#planner-dialog .eyebrow')?.replaceChildren('LOCAL PLANNER');
const plannerForm = document.getElementById('planner-form');
const plannerGoal = document.getElementById('planner-goal');
const plannerConstraints = document.getElementById('planner-constraints');
document.getElementById('suggest-plan').onclick = () => { plannerDialog.showModal(); plannerGoal.focus(); };
plannerForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = document.getElementById('planner-submit');
  submit.disabled = true;
  submit.textContent = 'ИИ планирует…';
  try {
    const response = await fetch(`/api/projects/${encodeURIComponent(boardState.projectId)}/suggest`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ goal: plannerGoal.value.trim(), constraints: plannerConstraints.value.trim() }) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Не удалось построить план');
    result.steps.forEach((step) => boardState.data.cards.push({ ...step, id: uid(), updatedAt: new Date().toISOString() }));
    boardState.data.events.push({ type: 'suggest-plan', provider: result.provider, count: result.steps.length, at: new Date().toISOString() });
    await saveBoard();
    plannerDialog.close();
    renderBoard();
    toast(`ИИ предложил ${result.steps.length} шагов (${result.provider})`);
  } catch (error) { toast(error.message); }
  finally { submit.disabled = false; submit.textContent = 'Сформировать план'; }
});
