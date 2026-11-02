const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { regressionPlan } = require('./cypress-regression-plan');
const root = path.resolve(__dirname, '..');
test('standard regression discovers every view-state spec, batches deterministically and never duplicates a spec', () => {
  const plan = regressionPlan(root);
  assert.deepEqual(plan, regressionPlan(root));
  for (const batch of plan) { assert.ok(batch.specs.length <= 25); assert.deepEqual(batch.specs, [...batch.specs].sort()); }
  const specs = plan.flatMap(batch => batch.specs);
  assert.equal(new Set(specs).size, specs.length);
  assert.deepEqual(plan.filter(batch => batch.suite === 'view-state').flatMap(batch => batch.specs), fs.readdirSync(path.join(root, 'cypress/e2e/view-state')).filter(name => name.endsWith('.cy.ts')).sort().map(name => `cypress/e2e/view-state/${name}`));
  assert.ok(specs.some(file => file.includes('load-nextstrain-url')));
  assert.ok(specs.some(file => file.includes('heatmap-controls')));
  assert.ok(!specs.some(file => /\/performance\/|large-uploaded|newick-large/.test(file)));
  assert.ok(plan.filter(batch => batch.suite === 'contracts').flatMap(batch => batch.specs).some(file => file.includes('post-launch-distance')));
});
test('suite selection is explicit and invalid suites fail before launching a browser', () => {
  assert.ok(regressionPlan(root, 'view-state').every(batch => batch.suite === 'view-state'));
  assert.throws(() => regressionPlan(root, 'typo'), /Unknown/);
});
