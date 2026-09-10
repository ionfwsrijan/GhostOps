import { queueRepo } from '../db/repos/index.js';
import { logger } from '../logger.js';

/**
 * Dispatches the agent for an incident. Hands the incident to the Postgres
 * job queue so runs survive restarts and are deduped by incident.
 */
export const investigationService = {
  async startAgent(incidentId: string): Promise<{ jobId?: string; deduped: boolean }> {
    const dedupe = `agent_run:${incidentId}`;
    const alreadyQueued = await queueRepo.hasLiveJobByDedupe(dedupe);
    const job = await queueRepo.enqueueJob({
      kind: 'agent_run',
      payload: { incidentId },
      dedupe,
      maxAttempts: 5,
    });
    logger.info({ incidentId, jobId: job.id, deduped: alreadyQueued }, 'investigation: agent queued');
    return { jobId: job.id, deduped: alreadyQueued };
  },

  async reconcile(incidentId: string): Promise<void> {
    const active = await queueRepo.queueDepth();
    logger.info({ incidentId, ...active }, 'investigation: reconcile requested');
    await this.startAgent(incidentId);
  },
};