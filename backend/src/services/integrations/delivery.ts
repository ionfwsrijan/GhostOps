import nodemailer from 'nodemailer';
import { env } from '../../config.js';
import { OutboxRow } from '../../db/types.js';
import { logger } from '../../logger.js';

export interface DeliveryResult {
  ok: boolean;
  ref?: string;
  error?: string;
  skipped?: boolean;
}

/**
 * Outbound dispatchers. Each knows its own transport and returns an opaque
 * provider ref on success so the outbox can record exactly-once delivery.
 */
export async function dispatchOutbox(o: OutboxRow): Promise<DeliveryResult> {
  switch (o.integration) {
    case 'slack':
      return dispatchSlack(o);
    case 'jira':
      return dispatchJira(o);
    case 'email':
      return dispatchEmail(o);
    case 'n8n':
      return dispatchN8n(o);
    default:
      return { ok: false, error: `unknown integration ${o.integration}` };
  }
}

async function dispatchSlack(o: OutboxRow): Promise<DeliveryResult> {
  if (!env.SLACK_WEBHOOK_URL) return { ok: false, skipped: true, error: 'SLACK_WEBHOOK_URL not configured' };
  const { channel, text } = (o.payload ?? {}) as { channel?: string; text?: string };
  const res = await fetch(env.SLACK_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ channel: channel ?? 'on-call', text: text ?? 'GhostOps update' }),
  });
  if (!res.ok) return { ok: false, error: `slack http ${res.status}: ${await res.text()}` };
  return { ok: true, ref: `slack:${res.status}` };
}

async function dispatchJira(o: OutboxRow): Promise<DeliveryResult> {
  if (!env.JIRA_BASE_URL || !env.JIRA_EMAIL || !env.JIRA_API_TOKEN) return { ok: false, skipped: true, error: 'JIRA not configured' };
  const { summary, description } = (o.payload ?? {}) as { summary?: string; description?: string };
  const res = await fetch(`${env.JIRA_BASE_URL.replace(/\/$/, '')}/rest/api/3/issue`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Basic ${Buffer.from(`${env.JIRA_EMAIL}:${env.JIRA_API_TOKEN}`).toString('base64')}`,
    },
    body: JSON.stringify({
      fields: {
        project: { key: env.JIRA_PROJECT_KEY },
        summary: summary ?? 'GhostOps follow-up',
        description: description ?? '',
        issuetype: { name: 'Task' },
      },
    }),
  });
  if (!res.ok) return { ok: false, error: `jira http ${res.status}: ${await res.text()}` };
  const body = (await res.json().catch(() => null)) as { key?: string } | null;
  return { ok: true, ref: body?.key ?? `jira:${res.status}` };
}

async function dispatchEmail(o: OutboxRow): Promise<DeliveryResult> {
  if (!env.SMTP_HOST || !env.SMTP_USER || !env.SMTP_PASS) return { ok: false, skipped: true, error: 'SMTP not configured' };
  const payload = o.payload as { to?: string; subject?: string; message?: string };
  if (!payload.to) return { ok: false, error: 'no recipient on file' };
  const transport = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
  });
  const info = await transport.sendMail({
    from: env.SMTP_USER,
    to: payload.to,
    subject: payload.subject ?? 'GhostOps update',
    text: payload.message ?? '',
  });
  return { ok: true, ref: info.messageId };
}

async function dispatchN8n(o: OutboxRow): Promise<DeliveryResult> {
  if (!env.N8N_BASE_URL) return { ok: false, skipped: true, error: 'N8N not configured' };
  const url = `${env.N8N_BASE_URL.replace(/\/$/, '')}${env.N8N_WEBHOOK_PATH.startsWith('/') ? '' : '/'}${env.N8N_WEBHOOK_PATH}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ eventType: o.eventType, payload: o.payload }),
  });
  if (!res.ok) return { ok: false, error: `n8n http ${res.status}` };
  return { ok: true, ref: `n8n:${res.status}` };
}

export async function dispatchAllQuiet() {
  logger.debug('outbox: no dispatcher loop here — see worker.ts');
}