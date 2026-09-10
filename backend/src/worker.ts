import os from 'os';
import crypto from 'crypto';
import { engineRepo, incidentRepo, queueRepo } from './db/repos/index.js';
import { JobRow, OutboxRow } from './db/types.js';
import { agentRunner } from './agents/agentRunner.js';
import { dispatchOutbox } from './services/integrations/delivery.js';
import { env } from './config.js';
import { logger } from './logger.js';
import { sseManager } from './services/sseService.js';
import { outboxDelivered, outboxFailed, queueDepthGauge, integrationHealthGauge } from './services/metrics.js';

const instanceId = `ghostops-${os.hostname()}-${process.pid}-${crypto.randomBytes(3).toString('hex')}`;

/**
 * Postgres-backed job worker. Polls the `jobs` and `outbox` tables using
 * SKIP LOCKED so multiple instances never process the same work twice.
 * Survives restarts: jobs stay in the queue until done or exhausted.
 */
export class Worker {
  private timer: NodeJS.Timeout | null = null;
  private reclaimTimer: NodeJS.Timeout | null = null;
  private ticking = false;
  private claiming = false;

  get instanceId(): string {
    return instanceId;
  }

  start(): void {
    this.timer = setInterval(() => void this.tick(), env.WORKER_POLL_INTERVAL_MS);
    this.timer.unref?.();
    this.reclaimTimer = setInterval(() => void this.reclaim(), 30_000);
    this.reclaimTimer.unref?.();
    logger.info({ instanceId, pollMs: env.WORKER_POLL_INTERVAL_MS }, 'worker: started');
    void this.tick();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.reclaimTimer) clearInterval(this.reclaimTimer);
    this.timer = null;
    this.reclaimTimer = null;
  }

  async reclaim(): Promise<void> {
    if (this.claiming || this.ticking) return;
    this.claiming = true;
    try {
      const reclaimed = await queueRepo.reclaimStale(instanceId, 60_000, 25);
      if (reclaimed.length) logger.info({ n: reclaimed.length }, 'worker: reclaimed stale job leases');
    } catch (err) {
      logger.warn({ err }, 'worker: reclaim failed');
    } finally {
      this.claiming = false;
    }
  }

  async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      const jobs = await queueRepo.claimJobs(instanceId, 5);
      for (const job of jobs) {
        void this.processJob(job)
          .then(() => queueRepo.completeJob(job.id))
          .catch(async (err) => {
            logger.warn({ jobId: job.id, kind: job.kind, err }, 'worker: job failed');
            await queueRepo.failJob(job.id, (err as Error).message, job.maxAttempts);
          });
      }

      const outbox = await queueRepo.claimOutbox(instanceId, 10);
      for (const item of outbox) {
        void this.processOutbox(item);
      }

      const depth = await queueRepo.queueDepth();
      queueDepthGauge.set({ state: 'pending' }, depth.pending);
      queueDepthGauge.set({ state: 'failed' }, depth.failed);
      const integrations = await (await import('./db/repos/index.js')).opsRepo.listIntegrations();
      for (const i of integrations) {
        integrationHealthGauge.set({ integration: i.provider }, i.status === 'healthy' ? 1 : 0);
      }
      // Reap expired approvals and fail incidents stuck awaiting them.
      await this.expireApprovals(() => {});
    } catch (err) {
      logger.warn({ err }, 'worker: tick failed');
    } finally {
      this.ticking = false;
    }
  }

  async expireApprovals(cb: () => void): Promise<void> {
    const expired = await engineRepo.expireStaleApprovals();
    for (const approvalId of expired) {
      const approval = await engineRepo.getApproval(approvalId);
      if (!approval) continue;
      await incidentRepo.updateIncident(approval.incidentId, { status: 'failed' });
      const incident = await incidentRepo.getIncident(approval.incidentId);
      const run = await engineRepo.getActiveRun(approval.incidentId);
      if (run) await engineRepo.updateRunState(run.id, 'failed', { error: 'approval expired', completedAt: new Date().toISOString() });
      if (incident) {
        await incidentRepo.logEvent(approval.incidentId, { step: 'approval_expired', type: 'error', title: `Approval expired: ${approval.actionKey}`, description: 'No human decision within the TTL — incident failed and escalated.', metadata: { approvalId }, actor_type: 'system' });
        sseManager.broadcast({ type: 'incident_update', incidentId: approval.incidentId, data: { status: 'failed', reason: 'approval expired' } });
      }
      logger.warn({ approvalId, incidentId: approval.incidentId }, 'worker: approval expired, incident failed');
    }
    if (expired.length) cb();
  }

  async processJob(job: JobRow): Promise<void> {
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    switch (job.kind) {
      case 'agent_run':
        await agentRunner.run(String(payload.incidentId ?? ''), { jobId: job.id });
        break;
      case 'agent_resume': {
        const incidentId = String(payload.incidentId ?? '');
        const approval = payload.approval === 'approved';
        const userId = String(payload.userId ?? 'system');
        await agentRunner.continueAfterApproval(incidentId, userId, approval);
        break;
      }
      case 'approval_expiry':
        // Handled by the expiry sweep in tick(); nothing else needed.
        break;
      case 'reconcile_incident': {
        const incidentId = String(payload.incidentId ?? '');
        const run = await engineRepo.getActiveRun(incidentId);
        if (!run) await agentRunner.run(incidentId, { jobId: job.id });
        break;
      }
      default:
        throw new Error(`unknown job kind ${job.kind}`);
    }
  }

  async processOutbox(o: OutboxRow): Promise<void> {
    const result = await dispatchOutbox(o);
    if (result.ok) {
      await queueRepo.completeOutbox(o.id, result.ref);
      outboxDelivered.inc({ integration: o.integration });
      logger.info({ outboxId: o.id, integration: o.integration, ref: result.ref }, 'outbox: delivered');
    } else if (result.skipped) {
      await queueRepo.skipOutbox(o.id, result.error ?? 'not configured');
      logger.info({ outboxId: o.id, integration: o.integration }, 'outbox: skipped (not configured)');
    } else {
      const updated = await queueRepo.failOutbox(o.id, result.error ?? 'unknown delivery error');
      outboxFailed.inc({ integration: o.integration });
      logger.warn({ outboxId: o.id, integration: o.integration, error: result.error }, 'outbox: delivery failed');
      if (!updated || updated.status === 'failed') {
        // escalation: surface a real failed integration on the incident timeline
        if (o.incidentId) {
          await incidentRepo.logEvent(o.incidentId, { step: 'integration_failed', type: 'error', title: `Outbound ${o.integration} failed permanently`, description: result.error, metadata: { outboxId: o.id, integration: o.integration }, actor_type: 'system' }).catch(() => undefined);
        }
      }
    }
  }
}

export const worker = new Worker();