export interface PhyloBootstrapSequence {
  id: string;
  sequence: string;
}

export interface PhyloBootstrapStabilityOptions {
  enabled: boolean;
  minReplicates: number;
  thresholdPercentagePoints: number;
  consecutiveBatches: number;
}

export interface PhyloBootstrapRequest {
  type: 'START';
  jobId: number;
  leafIds: string[];
  sequences: PhyloBootstrapSequence[];
  referenceTree: any;
  metric: string;
  ambiguityStrategy: string;
  ambiguityThreshold: number;
  replicates: number;
  batchSize: number;
  parallelism: number;
  stability: PhyloBootstrapStabilityOptions;
  seed?: number;
}

export interface PhyloBootstrapCancelRequest {
  type: 'CANCEL';
  jobId: number;
}

export type PhyloBootstrapWorkerRequest = PhyloBootstrapRequest | PhyloBootstrapCancelRequest;

export interface PhyloBootstrapProgressResponse {
  type: 'PROGRESS';
  jobId: number;
  completedReplicates: number;
  requestedReplicates: number;
  supportBySplit: Record<string, number>;
  stable: boolean;
  stoppedEarly: boolean;
  maxDeltaPercentagePoints: number | null;
  stableBatchCount: number;
}

export interface PhyloBootstrapResultResponse {
  type: 'RESULT';
  jobId: number;
  completedReplicates: number;
  requestedReplicates: number;
  supportBySplit: Record<string, number>;
  supportCountsBySplit: Record<string, number>;
  referenceSplitLeafIds: Record<string, string[]>;
  stable: boolean;
  stoppedEarly: boolean;
  maxDeltaPercentagePoints: number | null;
  metric: string;
  leafIds: string[];
  updatedAt: number;
}

export interface PhyloBootstrapCancelledResponse {
  type: 'CANCELLED';
  jobId: number;
  completedReplicates: number;
  requestedReplicates: number;
}

export interface PhyloBootstrapErrorResponse {
  type: 'ERROR';
  jobId: number;
  message: string;
}

export type PhyloBootstrapWorkerResponse =
  | PhyloBootstrapProgressResponse
  | PhyloBootstrapResultResponse
  | PhyloBootstrapCancelledResponse
  | PhyloBootstrapErrorResponse;

