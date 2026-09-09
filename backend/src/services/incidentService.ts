import { getDatabase, DatabaseAdapter } from '../database/index.js';
import { Incident, IncidentStatus, IncidentCreateInput, TimelineAddInput } from '../database/types.js';
import { sseManager } from './sseService.js';

export class IncidentService {
  private db: DatabaseAdapter;

  constructor(db: DatabaseAdapter = getDatabase()) {
    this.db = db;
  }

  async createIncidentFromComplaint(input: IncidentCreateInput): Promise<Incident> {
    const incident = await this.db.createIncident(input);
    await this.db.addTimeline({
      incident_id: incident.id,
      step: 'detected',
      type: 'info',
      title: 'Incident detected',
      description: `Complaint received via ${incident.channel ?? 'support_email'}: "${input.issue}"`,
      metadata: { source: input.channel ?? 'support_email' },
    });
    this.emit(incident.id, 'incident_detected', { incident: incident });
    return incident;
  }

  async getIncident(id: string): Promise<Incident | null> {
    return this.db.getIncident(id);
  }

  async getIncidentDetail(id: string) {
    const incident = await this.db.getIncident(id);
    if (!incident) return null;
    const [timeline, actions, customer, payment, booking] = await Promise.all([
      this.db.listTimeline(id),
      this.db.listAgentActions(id),
      incident.customer_id ? this.db.getCustomerById(incident.customer_id) : Promise.resolve(null),
      incident.transaction_id ? this.db.getPaymentByTransaction(incident.transaction_id) : Promise.resolve(null),
      incident.transaction_id ? this.db.getBookingByTransaction(incident.transaction_id) : Promise.resolve(null),
    ]);
    return { incident, timeline, actions, customer, payment, booking };
  }

  async listIncidents(limit = 50): Promise<Incident[]> {
    return this.db.listIncidents(limit);
  }

  async setStatus(id: string, status: IncidentStatus): Promise<Incident | null> {
    const incident = await this.db.updateIncident(id, { status });
    if (incident) {
      this.emit(id, 'incident_status', { incident });
      await this.db.addTimeline({
        incident_id: id,
        step: status,
        type: status === 'resolved' ? 'success' : status === 'failed' ? 'error' : 'system',
        title: `Status: ${status.replace(/_/g, ' ')}`,
      });
    }
    return incident;
  }

  /**
   * Share a status badge publish of state (used after AI phases).
   */
  async updatePartial(id: string, patch: Partial<Incident>): Promise<Incident | null> {
    const incident = await this.db.updateIncident(id, patch);
    if (incident) this.emit(id, 'incident_update', { incident });
    return incident;
  }

  async addTimelineEntry(input: TimelineAddInput) {
    const entry = await this.db.addTimeline(input);
    this.emit(input.incident_id, 'timeline_event', { entry: entry });
    return entry;
  }

  emit(incidentId: string, type: string, data: unknown) {
    sseManager.sendToIncident(incidentId, { type, data });
    sseManager.broadcast({ type, data, incidentId });
  }
}

// convenience instance
export const incidentService = new IncidentService();