export type ComputeWorkerTask =
  | 'align'
  | 'consensus'
  | 'ambiguityCounts'
  | 'links'
  | 'linksBackground'
  | 'tree'
  | 'directionality'
  | 'mst'
  | 'nn'
  | 'triangulation'
  | 'parseFasta';

export type Tn93LinkComputationPhase = 'all' | 'foreground' | 'background';

export interface ComputeWorkerRequest<T = any> {
  jobId: number;
  task: ComputeWorkerTask;
  payload: T;
}
