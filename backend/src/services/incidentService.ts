import { incidentRepo, opsRepo, engineRepo } from '../db/repos/index.js';

/** Thin service layer over the incidents repos (kept for route ergonomics). */
export const incidentService = {
  create(input: Parameters<typeof incidentRepo.createIncident>[0]) {
    return incidentRepo.createIncident(input);
  },
  get(id: string) {
    return incidentRepo.getIncident(id);
  },
  list(filter?: Parameters<typeof incidentRepo.listIncidents>[0]) {
    return incidentRepo.listIncidents(filter);
  },
  events(id: string, limit?: number) {
    return incidentRepo.listEvents(id, limit);
  },
  stats() {
    return incidentRepo.incidentStats();
  },

  /** Aggregate everything the frontend detail page needs in one call. */
  async withFacts(id: string) {
    const incident = await incidentRepo.getIncident(id);
    if (!incident) return null;
    const [events, actions, approvals, runs] = await Promise.all([
      incidentRepo.listEvents(id),
      engineRepo.listActions(id),
      engineRepo.listApprovals(undefined, 20),
      engineRepo.listRuns(id),
    ]);
    return {
      incident,
      events,
      actions,
      approvals: approvals.filter((a) => a.incidentId === id),
      runs,
    };
  },

  async cancel(id: string, userId?: string): Promise<boolean> {
    const incident = await incidentRepo.getIncident(id);
    if (!incident) return false;
    await incidentRepo.updateIncident(id, { status: 'cancelled' });
    await opsRepo.writeAudit({ actor_type: 'user', actor_id: userId, action: 'incident.cancelled', target_type: 'incident', target_id: id });
    return true;
  },
};