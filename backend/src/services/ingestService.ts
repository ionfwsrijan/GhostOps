import { incidentRepo } from '../db/repos/index.js';
import { sseManager } from './sseService.js';
import { auditService } from './auditService.js';
import { investigationService } from './investigationService.js';
import { incidentsTotal } from './metrics.js';
import { logger } from '../logger.js';
import { NormalizedIntake } from './integrations/webhooks.js';

export interface IngestInput extends NormalizedIntake {}

/**
 * Single ingestion path for every intake source (API, provider webhooks,
 * payment polling, n8n automation). Resolves the customer, persists the
 * incident + first event, broadcasts it, and enqueues the agent run. No
 * circuit can silently drop a payload: anything reaching here is persisted.
 */
export const ingestService = {
  async ingest(input: IngestInput): Promise<{ incidentId: string; code: string; queued: boolean }> {
    let customerId: string | undefined;
    if (input.customer) {
      customerId = await this.resolveCustomer(input.customer);
    }

    const { incident, event } = await incidentRepo.createIncident({
      title: input.title,
      issue: input.issue,
      severity: input.severity,
      customer_id: customerId,
      transaction_id: input.transactionId,
      affected_service: input.affectedService,
      channel: input.channel,
      source: input.source,
      metadata: input.metadata,
    });

    await auditService.write({
      actor_type: 'system',
      action: 'incident.ingested',
      target_type: 'incident',
      target_id: incident.id,
      metadata: { channel: incident.channel, source: incident.source, transactionId: input.transactionId ?? null },
    });

    incidentsTotal.inc({ channel: incident.channel, severity: incident.severity });
    sseManager.broadcast({ type: 'incident_detected', data: { ...event, incidentCode: incident.incidentCode, status: incident.status, severity: incident.severity } });

    const { deduped } = await investigationService.startAgent(incident.id);
    logger.info({ incidentId: incident.id, code: incident.incidentCode, deduped }, 'ingest: incident created and agent enqueued');
    return { incidentId: incident.id, code: incident.incidentCode, queued: !deduped };
  },

  async resolveCustomer(c: { id?: string; code?: string; name?: string; email?: string; phone?: string; city?: string }): Promise<string | undefined> {
    if (c.id) {
      const byId = await incidentRepo.getCustomerById(c.id);
      if (byId) return byId.id;
      return undefined; // unknown id — don't synthesize identity from an id alone
    }
    if (c.code) {
      const byCode = await incidentRepo.findCustomerByCode(c.code);
      if (byCode) return byCode.id;
    }
    if (c.name || c.email) {
      const created = await incidentRepo.createCustomer({
        customer_code: c.code ?? `cust-${Math.random().toString(36).slice(2, 10)}`,
        name: c.name ?? 'Unknown customer',
        email: c.email,
        phone: c.phone,
        city: c.city,
      });
      return created.id;
    }
    return undefined;
  },
};