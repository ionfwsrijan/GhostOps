import { Router } from 'express';
import { z } from 'zod';
import { incidentRepo, engineRepo, queueRepo } from '../../db/repos/index.js';
import { AppError, fromZod } from '../../errors.js';
import { requestStore } from '../../context.js';
import { asyncHandler, requireAuth, requireApiKey, requireRole } from '../middleware.js';
import { ingestService } from '../../services/ingestService.js';
import { incidentService } from '../../services/incidentService.js';
import { actionService } from '../../services/actionService.js';
import { auditService } from '../../services/auditService.js';
import { investigationService } from '../../services/investigationService.js';
import { listActionDefinitions } from '../../services/riskEngine.js';

const router = Router();

const ingestSchema = z.object({
  title: z.string().min(1).max(300),
  issue: z.string().min(1),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  transactionId: z.string().optional(),
  customer: z.object({ id: z.string().optional(), code: z.string().optional(), name: z.string().optional(), email: z.string().email().optional(), phone: z.string().optional(), city: z.string().optional() }).optional(),
  affectedService: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

// ---- Intake (machine API key with `ingest` scope) -----------------------------

router.post('/', requireApiKey('ingest'), asyncHandler(async (req, res) => {
  const body = ingestSchema.safeParse(req.body);
  if (!body.success) throw fromZod(body.error);
  const result = await ingestService.ingest({
    channel: 'api',
    source: 'external',
    title: body.data.title,
    issue: body.data.issue,
    severity: body.data.severity ?? 'medium',
    transactionId: body.data.transactionId,
    affectedService: body.data.affectedService,
    customer: body.data.customer,
    metadata: body.data.metadata ?? {},
  });
  res.status(201).json({ incidentId: result.incidentId, code: result.code, queued: result.queued });
}));

// ---- Dashboard (session auth) ---------------------------------------------------

router.get('/stats', requireAuth(), asyncHandler(async (_req, res) => {
  res.json(await incidentRepo.incidentStats());
}));

router.get('/action-definitions', requireAuth(), asyncHandler(async (_req, res) => {
  res.json({ actionDefinitions: listActionDefinitions() });
}));

router.get('/', requireAuth(), asyncHandler(async (req, res) => {
  const status = z.enum(['detected', 'investigating', 'action_required', 'awaiting_approval', 'resolving', 'resolved', 'failed', 'cancelled']).optional().parse(req.query.status);
  const severity = z.enum(['critical', 'high', 'medium', 'low']).optional().parse(req.query.severity);
  const q = typeof req.query.q === 'string' ? req.query.q : undefined;
  const limit = z.coerce.number().int().min(1).max(200).default(50).parse(req.query.limit ?? '50');
  const offset = z.coerce.number().int().min(0).default(0).parse(req.query.offset ?? '0');
  const page = await incidentRepo.listIncidents({ status, severity, q, limit, offset });
  res.json(page);
}));

router.get('/:id', requireAuth(), asyncHandler(async (req, res) => {
  const facts = await incidentService.withFacts(req.params.id);
  if (!facts) throw new AppError('NOT_FOUND', 'incident');
  res.json(facts);
}));

router.post('/:id/reinvestigate', requireAuth(), requireRole('admin', 'operator', 'readonly'), asyncHandler(async (req, res) => {
  const incident = await incidentRepo.getIncident(req.params.id);
  if (!incident) throw new AppError('NOT_FOUND', 'incident');
  const { deduped } = await investigationService.startAgent(incident.id);
  await auditService.write({ actor_type: 'user', action: 'incident.reinvestigated', target_type: 'incident', target_id: incident.id });
  res.json({ ok: true, queued: !deduped });
}));

router.post('/:id/cancel', requireAuth(), requireRole('admin', 'operator'), asyncHandler(async (req, res) => {
  const ctx = requestStore.getStore();
  const ok = await incidentService.cancel(req.params.id, ctx?.actor?.id);
  if (!ok) throw new AppError('NOT_FOUND', 'incident');
  res.json({ ok });
}));

// ---- Actions (agent + manual) ----------------------------------------------------

router.get('/:id/actions', requireAuth(), asyncHandler(async (req, res) => {
  res.json({ actions: await engineRepo.listActions(req.params.id) });
}));

router.post('/:id/actions', requireAuth(), requireRole('admin', 'operator'), asyncHandler(async (req, res) => {
  const body = z.object({ actionKey: z.string(), params: z.record(z.unknown()).optional(), confidence: z.number().min(0).max(1).default(0.9), reasoning: z.string().optional() }).safeParse(req.body);
  if (!body.success) throw fromZod(body.error);
  const incident = await incidentRepo.getIncident(req.params.id);
  if (!incident) throw new AppError('NOT_FOUND', 'incident');
  const count = (await engineRepo.listActions(incident.id)).length;
  const result = await actionService.submitRecommendedAction({
    incident_id: incident.id,
    actionKey: body.data.actionKey,
    params: body.data.params,
    confidence: body.data.confidence,
    reasoning: body.data.reasoning,
    plan_index: count,
  });
  await auditService.write({ actor_type: 'user', action: 'action.submitted', target_type: 'incident', target_id: incident.id, after: { actionKey: body.data.actionKey, mode: result.mode } });
  res.status(result.mode === 'unknown' ? 422 : 201).json(result);
}));

// ---- Approvals -------------------------------------------------------------------

router.get('/:id/approvals', requireAuth(), asyncHandler(async (req, res) => {
  const all = await engineRepo.listApprovals();
  res.json({ approvals: all.filter((a) => a.incidentId === req.params.id) });
}));

router.post('/approvals/:approvalId', requireAuth(), requireRole('admin', 'operator'), asyncHandler(async (req, res) => {
  const body = z.object({ decision: z.enum(['approved', 'rejected']), reason: z.string().optional() }).safeParse(req.body);
  if (!body.success) throw fromZod(body.error);
  const ctx = requestStore.getStore();
  const actor = ctx?.actor;
  if (!actor || actor.type !== 'user') throw new AppError('UNAUTHORIZED', 'Approvals require a signed-in user');
  const result = await actionService.decide({ approvalId: req.params.approvalId, approval: body.data.decision, userId: actor.id, reason: body.data.reason });
  if (!result.ok) throw new AppError(result.error === 'approval not found' ? 'NOT_FOUND' : 'CONFLICT', result.error ?? '');
  await auditService.write({ actor_type: 'user', action: 'approval.decided', target_type: 'approval', target_id: req.params.approvalId, after: { decision: body.data.decision } });
  res.json({ ok: true });
}));

// ---- Reconcile job ---------------------------------------------------------------

router.post('/reconcile', requireAuth(), requireRole('admin'), asyncHandler(async (req, res) => {
  const body = z.object({ incidentId: z.string().optional() }).safeParse(req.body);
  if (body.success && body.data.incidentId) {
    await queueRepo.enqueueJob({ kind: 'reconcile_incident', payload: { incidentId: body.data.incidentId }, dedupe: `reconcile:${body.data.incidentId}` });
  }
  res.json({ ok: true });
}));

export default router;