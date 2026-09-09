import { Router } from 'express';
import { z } from 'zod';
import { incidentService } from '../services/incidentService.js';
import { getDatabase } from '../database/index.js';
import { investigationService } from '../services/investigationService.js';
import { verificationService } from '../services/verificationService.js';
import { getActionDefinition } from '../services/riskEngine.js';

export const incidentsRouter = Router();

const createSchema = z.object({
  title: z.string().min(1),
  issue: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  customer_code: z.string().optional(),
  transaction_id: z.string().optional(),
  affected_service: z.string().optional(),
  channel: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  investigate: z.boolean().optional(),
});

incidentsRouter.get('/', async (_req, res, next) => {
  try {
    const incidents = await incidentService.listIncidents(100);
    res.json({ incidents });
  } catch (err) {
    next(err);
  }
});

incidentsRouter.post('/', async (req, res, next) => {
  try {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid incident', issues: parsed.error.issues });

    const incident = await incidentService.createIncidentFromComplaint(parsed.data);
    if (parsed.data.investigate) {
      res.status(201).json({ incident, investigation: { started: true } });
      void investigationService.investigate(incident.id);
    } else {
      res.status(201).json({ incident });
    }
  } catch (err) {
    next(err);
  }
});

incidentsRouter.get('/stats', async (_req, res, next) => {
  try {
    const db = getDatabase();
    const analytics = await db.analytics();
    const incidents = await incidentService.listIncidents(50);
    res.json({ ...analytics, incidents });
  } catch (err) {
    next(err);
  }
});

incidentsRouter.get('/:id', async (req, res, next) => {
  try {
    const detail = await incidentService.getIncidentDetail(req.params.id);
    if (!detail) return res.status(404).json({ error: 'Incident not found' });
    const investigation = await investigationService.getInvestigationStatus(req.params.id);
    const allowedActions = Object.keys({
      verify_payment: 1,
      check_booking: 1,
      inspect_logs: 1,
      retry_booking: 1,
      update_booking_status: 1,
      create_jira_ticket: 1,
      send_slack_notification: 1,
      send_customer_notification: 1,
      collect_diagnostics: 1,
      refund_customer: 1,
      cancel_booking: 1,
    }).map((k) => ({
      key: k,
      label: getActionDefinition(k).label,
      risk: getActionDefinition(k).risk,
    }));
    res.json({ ...detail, investigation, allowedActions });
  } catch (err) {
    next(err);
  }
});

incidentsRouter.get('/:id/timeline', async (req, res, next) => {
  try {
    const db = getDatabase();
    const timeline = await db.listTimeline(req.params.id);
    res.json({ timeline });
  } catch (err) {
    next(err);
  }
});

incidentsRouter.post('/:id/investigate', async (req, res, next) => {
  try {
    const status = res.json({
      started: true,
      status: await investigationService.investigate(req.params.id),
    });
    return status;
  } catch (err) {
    next(err);
  }
});

incidentsRouter.post('/:id/verify', async (req, res, next) => {
  try {
    const result = await verificationService.verify(req.params.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

incidentsRouter.post('/:id/actions', async (req, res, next) => {
  try {
    const schema = z.object({
      actionKey: z.string().min(1),
      params: z.record(z.unknown()).optional(),
      confidence: z.number().min(0).max(1).optional(),
      reasoning: z.string().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid action', issues: parsed.error.issues });
    const { actionService } = await import('../services/actionService.js');
    const result = await actionService.submitRecommendedAction(req.params.id, {
      actionKey: parsed.data.actionKey,
      params: parsed.data.params ?? {},
      confidence: parsed.data.confidence ?? 0.9,
      reasoning: parsed.data.reasoning ?? 'Manually requested from the action center',
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});