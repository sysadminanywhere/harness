const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

function normalizeModel(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new Error('Model must be a model ID or empty for inheritance');
  const model = value.trim();
  if (!model) return null;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) throw new Error('Invalid model ID: use letters, digits, dots, dashes, underscores, colons or slashes');
  return model;
}

function resolveTaskModel(project, plan, task) {
  const own = normalizeModel(task?.model);
  if (own) return { model: own, modelSource: { type: 'task', taskId: task.id || task.taskId } };
  const visited = new Set([task?.id || task?.taskId]);
  let parentId = task?.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = (plan.cards || []).find((card) => card.id === parentId);
    if (!parent) break;
    const model = normalizeModel(parent.model);
    if (model) return { model, modelSource: { type: 'scope', taskId: parent.id, title: parent.title } };
    parentId = parent.parentId;
  }
  const model = normalizeModel(project.model);
  return { model, modelSource: { type: model ? 'project' : 'codex-default' } };
}

function readModelCatalog(env = process.env) {
  const file = path.join(env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'models_cache.json');
  try {
    const cache = JSON.parse(fs.readFileSync(file, 'utf8'));
    const models = (cache.models || []).filter((model) => model.visibility === 'list').map((model) => ({ id: normalizeModel(model.slug), name: String(model.display_name || model.slug) })).filter((model) => model.id);
    return { models, source: 'codex-cache', fetchedAt: cache.fetched_at || null };
  } catch { return { models: [], source: 'custom-only', fetchedAt: null }; }
}

module.exports = { normalizeModel, resolveTaskModel, readModelCatalog };
