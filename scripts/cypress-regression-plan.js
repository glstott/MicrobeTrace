const fs = require('node:fs');
const path = require('node:path');
const large = new Set(['aggregate-large-uploaded.cy.ts', 'heatmap-large-uploaded.cy.ts', 'sankey-large-uploaded.cy.ts', 'smart-launch-newick-large.cy.ts', 'waterfall-large-uploaded.cy.ts']);
const contract = name => name.endsWith('.contract.cy.ts') || ['behavior-contracts.cy.ts', 'post-launch-distance-metric-switch.cy.ts'].includes(name);
function specsIn(root, directory) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return [];
  return fs.readdirSync(absolute, { withFileTypes: true }).flatMap(entry => entry.isDirectory()
    ? specsIn(root, `${directory}/${entry.name}`) : entry.name.endsWith('.cy.ts') && !entry.name.includes('.legacy.') ? [`${directory}/${entry.name}`] : []);
}
function regressionPlan(root, suite = 'all') {
  if (!['all', 'flows', 'view-state', 'contracts'].includes(suite)) throw new Error(`Unknown regression suite: ${suite}`);
  const flows = specsIn(root, 'cypress/e2e/journeys/flows');
  const suites = {
    flows: [...specsIn(root, 'cypress/e2e/ingestion'), ...flows.filter(file => !contract(path.basename(file)) && !large.has(path.basename(file)))],
    'view-state': specsIn(root, 'cypress/e2e/view-state'),
    contracts: flows.filter(file => contract(path.basename(file))),
  };
  return Object.entries(suites).filter(([name]) => suite === 'all' || name === suite).flatMap(([name, files]) => {
    const sorted = files.sort();
    return Array.from({ length: Math.ceil(sorted.length / 25) }, (_, index) => ({ suite: name, specs: sorted.slice(index * 25, (index + 1) * 25) }));
  });
}
module.exports = { regressionPlan };
