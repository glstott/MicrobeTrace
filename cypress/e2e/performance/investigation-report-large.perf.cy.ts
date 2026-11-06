/// <reference types="cypress" />
import { benchmarkInvestigationReport, INVESTIGATION_REPORT_SCENARIOS } from '../../performance/investigation-report-benchmark';
import { collectPerformanceCounts, writePerformanceResult, type PerformanceScenario } from '../../support/perf-helpers';

const describeReports = Cypress.env('perfMode') && Cypress.env('perfReports') ? describe : describe.skip;

describeReports('Performance Baseline - large reproducibility reports', { retries: 0 }, () => {
  const filter = String(Cypress.env('perfReportScenario') || '').split(',').map(id => id.trim()).filter(Boolean);
  for (const scenario of INVESTIGATION_REPORT_SCENARIOS) {
    if (scenario.id.startsWith('stress-') && !Cypress.env('perfStress')) continue;
    if (filter.length && !filter.includes(scenario.id)) continue;
    it(`measures ${scenario.id}: save, file reopen, browser storage, memory and quota recovery`, () => {
      cy.visit('/?skipEula=1&skipDemoSession=1');
      cy.get('#fileDropRef').selectFile('cypress/fixtures/investigation/02-configured.microbetrace', { force: true });
      cy.window({ timeout: 60000, log: false }).should((win: any) => {
        expect(win.commonService.session.data.nodes.length).to.equal(6);
        expect(win.commonService.session.network.isFullyLoaded).to.equal(true);
        expect(win.commonService.session.tabLoaded).to.equal(true);
        expect(win.commonService.pendingDashboardRestore).not.to.exist;
        expect(win.commonService.visuals.microbeTrace.applyingPendingDashboardRestore).to.equal(false);
      });
      cy.window({ log: false }).then({ timeout: 900000 }, async (win: any) => {
        const result = await benchmarkInvestigationReport(win, scenario);
        expect(result.checks.images).to.equal(scenario.images);
        expect(result.checks.historicalRecords).to.equal(scenario.evidenceVariants);
        expect(result.checks.fileReopened).to.equal(true);
        expect(result.checks.savedRunsPreserved).to.equal(true);
        expect(result.checks.replacementCalculations).to.equal(0);
        // Storage capacity is browser-dependent; preserve a usable timing artifact even when it is unavailable.
        if (result.storage.saveOutcome === 'saved') {
          expect(result.checks.localLinkReopened).to.equal(true);
          expect(result.checks.quotaFailureExplained).to.equal(true);
          expect(result.checks.previousLinkSurvivedQuotaFailure).to.equal(true);
        }
        const profile: PerformanceScenario = { id: scenario.id, title: `Reproducibility report: ${scenario.images} PNG images`,
          files: [{ name: 'investigation/02-configured.microbetrace', datatype: 'MT/other' }],
          preLaunch: { metric: 'snps', threshold: 3 }, expected: { nodes: 6 },
          metadata: { fixtureKind: 'deterministic-canvas-noise', tier: scenario.id.startsWith('stress-') ? 'stress' : scenario.id.startsWith('large-') ? 'large' : 'control', ...scenario } };
        return { profile, measurement: { scenarioId: scenario.id, startedAt: result.startedAt, metrics: result.metrics,
          counts: collectPerformanceCounts(win), heap: result.heap, longTasks: result.longTasks, app: { loadTimeMs: null, performance: { investigationReport: result } } } };
      }).then(({ profile, measurement }) => writePerformanceResult(profile, measurement));
    });
  }
});
