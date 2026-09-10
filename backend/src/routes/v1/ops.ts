import { Router, Response, Request } from 'express';
import { z } from 'zod';
import { opsRepo, queueRepo } from '../../db/repos/index.js';
import { AppError } from '../../errors.js';
import { asyncHandler, requireAuth, requireRole } from '../middleware.js';
import { integrationsService } from '../../services/integrations/registry.js';
import { verifySignature, normalizeBody, WEBHOOK_PROVIDERS } from '../../services/integrations/webhooks.js';
import { ingestService } from '../../services/ingestService.js';
import { auditService } from '../../services/auditService.js';
import { openapi } from './openapi.js';

const router = Router();

// ---- Integrations (health + config surface) --------------------------------------

router.get('/integrations', requireAuth(), asyncHandler(async (_req, res) => {
  res.json({ integrations: await integrationsService.list() });
}));

router.post('/integrations/health-check', requireAuth(), requireRole('admin', 'operator'), asyncHandler(async (_req, res) => {
  await integrationsService.healthCheck();
  await auditService.write({ actor_type: 'user', action: 'integrations.health_checked' });
  res.json({ integrations: await integrationsService.list() });
}));

// ---- Inbound webhooks (HMAC-gated; raw body preserved for the audit trail) -------
// Raw body parsing happens globally for the /api/v1/webhooks prefix (see index.ts)
// so HMAC verification sees the exact request bytes.

function webhookHandler(provider: (typeof WEBHOOK_PROVIDERS)[number]) {
  return asyncHandler(async (req: Request, res: Response) => {
    await handleWebhookRaw(provider, req, res);
  });
}

async function handleWebhookRaw(provider: (typeof WEBHOOK_PROVIDERS)[number], req: Request, res: Response): Promise<void> {
  const raw = req.body as Buffer | undefined;
  const bodyText = raw ? raw.toString('utf8') : '';
  const parsedJson = parseJsonLoose(bodyText);

  const signatureHeader = req.headers['x-ghostops-signature'] ?? req.headers['x-signature'];
  const check = verifySignature(provider, raw ?? Buffer.alloc(0), typeof signatureHeader === 'string' ? signatureHeader : undefined);
  const rawAudit = parsedJson ?? { unparsed: bodyText.slice(0, 200_000) };
  if (!check.ok) {
    await opsRepo.recordWebhookIngest({ provider, signature_verified: false, auth_method: 'hmac', raw: rawAudit, source_ip: req.ip, error: check.error });
    throw new AppError('INTEGRATION_NOT_CONFIGURED', check.error, { details: { provider } });
  }

  const intake = normalizeBody(provider, parsedJson);
  const result = await ingestService.ingest(intake);
  await opsRepo.recordWebhookIngest({ provider, signature_verified: true, auth_method: 'hmac', raw: rawAudit, source_ip: req.ip, incident_id: result.incidentId });
  await auditService.write({ actor_type: 'system', action: 'webhook.accepted', target_type: 'incident', target_id: result.incidentId, metadata: { provider, eventType: (parsedJson?.event as string) ?? 'unknown' } });
  res.status(201).json({ accepted: true, incidentId: result.incidentId, code: result.code });
}

router.post('/webhooks/payment', webhookHandler('payment'));
router.post('/webhooks/booking', webhookHandler('booking'));
router.post('/webhooks/monitoring', webhookHandler('monitoring'));
router.post('/webhooks/support', webhookHandler('support'));

// ---- Outbox (manual visibility + retry) -------------------------------------------

router.get('/outbox', requireAuth(), requireRole('admin', 'operator'), asyncHandler(async (req, res) => {
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const limit = z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit ?? '100');
  res.json({ outbox: await queueRepo.listOutbox({ status, limit }) });
}));

// ---- Audit log ----------------------------------------------------------------------

router.get('/audit', requireAuth(), requireRole('admin', 'operator'), asyncHandler(async (req, res) => {
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  const actorType = typeof req.query.actorType === 'string' ? req.query.actorType : undefined;
  const limit = z.coerce.number().int().min(1).max(500).default(100).parse(req.query.limit ?? '100');
  const offset = z.coerce.number().int().min(0).default(0).parse(req.query.offset ?? '0');
  const page = await opsRepo.listAudit({ action, actorType, limit, offset });
  res.json(page);
}));

// ---- OpenAPI documentation ------------------------------------------------------------

router.get('/openapi.json', asyncHandler(async (_req, res) => {
  res.json(openapi);
}));

router.get('/docs', asyncHandler(async (_req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>GhostOps API</title></head>
<body style="font-family:system-ui;margin:2rem"><h1>GhostOps API v1</h1>
<p>Interactive docs use <code>http://localhost:4000/api/v1/openapi.json</code>. Point swagger-ui at that URL.</p>
<a href="/api/v1/openapi.json">openapi.json</a></body></html>`);
}));

function parseJsonLoose(text: string): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export default router;