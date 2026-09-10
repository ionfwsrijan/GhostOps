import client from 'prom-client';
import { env } from '../config.js';

export const registry = new client.Registry();
registry.setDefaultLabels({ app: 'ghostops-backend', node: process.env.HOSTNAME ?? 'local' });
client.collectDefaultMetrics({ register: registry, prefix: 'ghostops_' });

const httpRequests = new client.Counter({
  name: 'ghostops_http_requests_total',
  help: 'Total HTTP requests by route and status',
  labelNames: ['route', 'method', 'status'],
  registers: [registry],
});
const httpDuration = new client.Histogram({
  name: 'ghostops_http_request_duration_seconds',
  help: 'HTTP request latency',
  labelNames: ['route', 'method'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});
export const incidentsTotal = new client.Counter({
  name: 'ghostops_incidents_total',
  help: 'Total incidents ingested',
  labelNames: ['channel', 'severity'],
  registers: [registry],
});
export const incidentsResolved = new client.Counter({
  name: 'ghostops_incidents_resolved_total',
  help: 'Incidents resolved by the agent',
  labelNames: ['auto'],
  registers: [registry],
});
export const agentRunsStarted = new client.Counter({
  name: 'ghostops_agent_runs_started_total',
  help: 'Agent runs started',
  labelNames: ['incidentId'],
  registers: [registry],
});
export const approvalsRequested = new client.Counter({
  name: 'ghostops_approvals_requested_total',
  help: 'Human approvals requested',
  registers: [registry],
});
export const outboxDelivered = new client.Counter({
  name: 'ghostops_outbox_delivered_total',
  help: 'Outbox messages delivered',
  labelNames: ['integration'],
  registers: [registry],
});
export const outboxFailed = new client.Counter({
  name: 'ghostops_outbox_failed_total',
  help: 'Outbox messages failed',
  labelNames: ['integration'],
  registers: [registry],
});
export const queueDepthGauge = new client.Gauge({
  name: 'ghostops_queue_depth',
  help: 'Pending + failed job queue depth',
  labelNames: ['state'],
  registers: [registry],
});
export const integrationHealthGauge = new client.Gauge({
  name: 'ghostops_integration_health',
  help: 'Integration configured/healthy state',
  labelNames: ['integration'],
  registers: [registry],
});

export function recordHttp(route: string, method: string, status: number, durationMs: number) {
  httpRequests.inc({ route, method, status: String(status) });
  httpDuration.observe({ route, method }, durationMs / 1000);
}

export async function metricsSummary() {
  return registry.metrics();
}

/** Mirrors `heroku`-style buffered metrics endpoint shape for /api/v1/meta. */
export async function metaInfo() {
  return {
    env: env.NODE_ENV,
    version: process.env.npm_package_version ?? 'dev',
    integrations: {
      openai: process.env.OPENAI_API_KEY ? true : false,
      slack: process.env.SLACK_WEBHOOK_URL ? true : false,
      jira: process.env.JIRA_BASE_URL ? true : false,
      email: process.env.SMTP_HOST ? true : false,
      n8n: process.env.N8N_BASE_URL ? true : false,
      paymentProvider: process.env.PAYMENT_PROVIDER_API_URL ? true : false,
      database: true,
    },
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  };
}