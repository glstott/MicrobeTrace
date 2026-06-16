import { runPhylogeneticBootstrap } from './phylo-bootstrap-engine';
import type { PhyloBootstrapRequest } from './phylo-bootstrap.types';
import { normalizeSplitKey } from './phylo-bootstrap-utils';

describe('phylo bootstrap engine', () => {
  function request(overrides: Partial<PhyloBootstrapRequest> = {}): PhyloBootstrapRequest {
    return {
      type: 'START',
      jobId: 1,
      leafIds: ['A', 'B', 'C', 'D'],
      sequences: [
        { id: 'A', sequence: 'AAAAAA' },
        { id: 'B', sequence: 'AAAAAA' },
        { id: 'C', sequence: 'CCCCCC' },
        { id: 'D', sequence: 'CCCCCC' },
      ],
      referenceTree: {
        children: [
          { children: [{ id: 'A' }, { id: 'B' }] },
          { children: [{ id: 'C' }, { id: 'D' }] },
        ],
      },
      metric: 'snps',
      ambiguityStrategy: 'AVERAGE',
      ambiguityThreshold: 0.015,
      replicates: 4,
      batchSize: 2,
      parallelism: 2,
      stability: {
        enabled: false,
        minReplicates: 100,
        thresholdPercentagePoints: 0.5,
        consecutiveBatches: 2,
      },
      seed: 123,
      ...overrides,
    };
  }

  it('counts deterministic split support', async () => {
    const result = await runPhylogeneticBootstrap(request());
    const splitKey = normalizeSplitKey(['A', 'B'], ['A', 'B', 'C', 'D']);

    expect(result.completedReplicates).toBe(4);
    expect(result.supportBySplit[splitKey]).toBe(100);
  });

  it('uses the selected distance metric when resampling bootstrap trees', async () => {
    const leafIds = ['A', 'B', 'C', 'D'];
    const mixedSignalRequest: Partial<PhyloBootstrapRequest> = {
      leafIds,
      sequences: [
        { id: 'A', sequence: 'AAAA' },
        { id: 'B', sequence: 'AACC' },
        { id: 'C', sequence: 'CCAC' },
        { id: 'D', sequence: 'CCCA' },
      ],
      referenceTree: {
        children: [
          { children: [{ id: 'A' }, { id: 'B' }] },
          { children: [{ id: 'C' }, { id: 'D' }] },
        ],
      },
      replicates: 10000,
      batchSize: 100,
      parallelism: 1,
      seed: 123,
    };
    const splitKey = normalizeSplitKey(['A', 'B'], leafIds);

    const snpResult = await runPhylogeneticBootstrap(request({
      ...mixedSignalRequest,
      metric: 'snps',
    }));
    const tn93Result = await runPhylogeneticBootstrap(request({
      ...mixedSignalRequest,
      metric: 'tn93',
    }));

    expect(snpResult.supportBySplit[splitKey]).toBeCloseTo(69.6, 5);
    expect(tn93Result.supportBySplit[splitKey]).toBeCloseTo(90.09, 5);
  });

  it('stops early when support is stable', async () => {
    const progress: number[] = [];
    const result = await runPhylogeneticBootstrap(
      request({
        replicates: 1000,
        batchSize: 10,
        parallelism: 1,
        stability: {
          enabled: true,
          minReplicates: 100,
          thresholdPercentagePoints: 0.5,
          consecutiveBatches: 2,
        },
      }),
      update => progress.push(update.completedReplicates)
    );

    expect(result.stable).toBeTrue();
    expect(result.stoppedEarly).toBeTrue();
    expect(result.completedReplicates).toBeLessThan(1000);
    expect(progress.length).toBeGreaterThan(0);
  });
});

