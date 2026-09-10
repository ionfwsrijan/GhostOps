import { opsRepo } from '../db/repos/index.js';
import { getRequestContext } from '../context.js';

/**
 * Audit helper — merges request context (request id, actor from session/api
 * key, IP) so every write is traceable end-to-end.
 */
export const auditService = {
  async write(entry: Parameters<typeof opsRepo.writeAudit>[0]) {
    const ctx = getRequestContext();
    return opsRepo.writeAudit({
      request_id: ctx?.requestId,
      actor_type: entry.actor_type,
      actor_id: entry.actor_id ?? ctx?.actor?.id,
      actor_email: entry.actor_email ?? ctx?.actor?.email,
      action: entry.action,
      target_type: entry.target_type,
      target_id: entry.target_id,
      before: entry.before,
      after: entry.after,
      ip: entry.ip ?? ctx?.ip,
      metadata: entry.metadata,
    });
  },
};