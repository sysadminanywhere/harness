const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { normalizeModel, resolveTaskModel, readModelCatalog } = require('../model-settings');

test('model IDs accept explicit providers and reject CLI flags or malformed values', () => {
  assert.equal(normalizeModel('  provider/model-v1:latest  '), 'provider/model-v1:latest');
  assert.equal(normalizeModel('  '), null);
  for (const value of ['--model=test', 'model with spaces', 'a\n--flag', '<script>', 42, {}]) assert.throws(() => normalizeModel(value));
});
test('task overrides nearest scope, project and Codex default', () => {
  const project = { model: 'project-model' };
  const plan = { cards: [{ id: 'outer', model: 'outer-model' }, { id: 'inner', parentId: 'outer', model: 'inner-model' }] };
  const task = { id: 'task', parentId: 'inner', model: 'task-model' };
  assert.equal(resolveTaskModel(project, plan, task).model, 'task-model');
  task.model = null;
  assert.deepEqual(resolveTaskModel(project, plan, task), { model: 'inner-model', modelSource: { type: 'scope', taskId: 'inner', title: undefined } });
  plan.cards[1].model = null; assert.equal(resolveTaskModel(project, plan, task).model, 'outer-model');
  plan.cards[0].model = null; assert.equal(resolveTaskModel(project, plan, task).model, 'project-model');
  project.model = null; assert.deepEqual(resolveTaskModel(project, plan, task), { model: null, modelSource: { type: 'codex-default' } });
});
test('broken or cyclic parent chains terminate and fall back to project', () => {
  const plan = { cards: [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }] };
  assert.equal(resolveTaskModel({ model: 'project' }, plan, plan.cards[0]).model, 'project');
  assert.equal(resolveTaskModel({ model: 'project' }, plan, { id: 'c', parentId: 'missing' }).model, 'project');
});
test('catalog only exposes visible model IDs and labels, not account identity', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-model-catalog-'));
  try {
    fs.writeFileSync(path.join(root, 'models_cache.json'), JSON.stringify({ identity: { secret: 'private' }, fetched_at: 'timestamp', models: [{ slug: 'listed', display_name: 'Listed', visibility: 'list' }, { slug: 'hidden', visibility: 'hide' }] }));
    assert.deepEqual(readModelCatalog({ CODEX_HOME: root }), { models: [{ id: 'listed', name: 'Listed' }], source: 'codex-cache', fetchedAt: 'timestamp' });
    assert.equal(readModelCatalog({ CODEX_HOME: path.join(root, 'missing') }).models.length, 0);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
