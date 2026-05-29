/// <reference lib="webworker" />

import { runPhylogeneticBootstrap } from './phylo-bootstrap-engine';
import type {
  PhyloBootstrapRequest,
  PhyloBootstrapWorkerRequest,
  PhyloBootstrapWorkerResponse,
} from './phylo-bootstrap.types';

const cancelledJobs = new Set<number>();

function postWorkerMessage(message: PhyloBootstrapWorkerResponse): void {
  postMessage(message);
}

async function startBootstrap(request: PhyloBootstrapRequest): Promise<void> {
  try {
    const result = await runPhylogeneticBootstrap(
      request,
      progress => postWorkerMessage({ type: 'PROGRESS', jobId: request.jobId, ...progress }),
      () => cancelledJobs.has(request.jobId)
    );

    if (cancelledJobs.has(request.jobId)) {
      postWorkerMessage({
        type: 'CANCELLED',
        jobId: request.jobId,
        completedReplicates: result.completedReplicates,
        requestedReplicates: result.requestedReplicates,
      });
      cancelledJobs.delete(request.jobId);
      return;
    }

    postWorkerMessage(result);
  } catch (error) {
    postWorkerMessage({
      type: 'ERROR',
      jobId: request.jobId,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

addEventListener('message', ({ data }: MessageEvent<PhyloBootstrapWorkerRequest>) => {
  if (data.type === 'CANCEL') {
    cancelledJobs.add(data.jobId);
    return;
  }

  if (data.type === 'START') {
    cancelledJobs.delete(data.jobId);
    void startBootstrap(data);
  }
});

