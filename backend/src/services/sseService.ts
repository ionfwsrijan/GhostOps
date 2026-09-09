import { Response } from 'express';

export interface SSEEvent {
  type: string;
  incidentId?: string;
  data?: unknown;
}

type Client = {
  id: string;
  res: Response;
  filters?: {
    incidentId?: string;
  };
};

class SSEManager {
  private clients = new Map<string, Client>();

  /**
   * Register a new SSE client. Returns its id.
   */
  connect(res: Response, opts?: { incidentId?: string }): string {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');

    const id = `sse-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.clients.set(id, { id, res, filters: opts });

    // heartbeat to keep connection alive and detect dead clients
    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        this.clients.delete(id);
      }
    }, 15000);

    res.on('close', () => {
      clearInterval(heartbeat);
      this.clients.delete(id);
    });

    return id;
  }

  /**
   * Send an event to clients, optionally filtered by incident.
   */
  broadcast(event: SSEEvent) {
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of this.clients.values()) {
      const matched = !event.incidentId || !client.filters?.incidentId || client.filters.incidentId === event.incidentId;
      if (!matched) continue;
      try {
        client.res.write(payload);
      } catch {
        this.clients.delete(client.id);
      }
    }
  }

  /**
   * Send an event only to clients subscribed to a specific incident.
   */
  sendToIncident(incidentId: string, event: Omit<SSEEvent, 'incidentId'>) {
    this.broadcast({ ...event, incidentId });
  }

  disconnectAll() {
    for (const client of this.clients.values()) {
      try {
        client.res.end();
      } catch {
        // ignore
      }
    }
    this.clients.clear();
  }
}

export const sseManager = new SSEManager();