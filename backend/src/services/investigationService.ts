import { GhostOpsAgent, ghostOpsAgent } from '../agents/ghostopsAgent.js';
import { incidentService } from './incidentService.js';

/**
 * Investigation orchestration service — delegates to the agent and tracks
 * high-level investigation state for API consumers.
 */
export class InvestigationService {
  private agent: GhostOpsAgent;
  private running = new Set<string>();

  constructor(agent: GhostOpsAgent = ghostOpsAgent) {
    this.agent = agent;
  }

  isRunning(incidentId: string): boolean {
    return this.running.has(incidentId);
  }

  /**
   * Trigger (or resume) the autonomous investigation for an incident.
   * Safe to call multiple times.
   */
  async investigate(incidentId: string): Promise<{ status: string }> {
    if (this.running.has(incidentId)) {
      return { status: 'already_running' };
    }
    this.running.add(incidentId);
    try {
      return await this.agent.run(incidentId);
    } finally {
      this.running.delete(incidentId);
    }
  }

  async getInvestigationStatus(incidentId: string) {
    const incident = await incidentService.getIncident(incidentId);
    if (!incident) return null;
    return {
      incident,
      running: this.running.has(incidentId),
      agentState: (incident.metadata?.agentState as string) ?? (incident.status === 'resolved' ? 'resolved' : 'idle'),
      status: incident.status,
    };
  }
}

export const investigationService = new InvestigationService();