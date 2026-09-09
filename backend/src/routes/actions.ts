import { Router } from 'express';
import { getDatabase } from '../database/index.js';
import { listActionDefinitions } from '../services/riskEngine.js';

export const actionsRouter = Router();

actionsRouter.get('/', async (_req, res, next) => {
  try {
    const db = getDatabase();
    const actions = await db.listAgentActions(undefined, 200);
    const incidents = await db.listIncidents(300);
    const codeById = new Map(incidents.map((i) => [i.id, i.incident_code]));
    res.json({
      actions: actions.map((a) => ({ ...a, incident_code: codeById.get(a.incident_id) ?? a.incident_id })),
    });
  } catch (err) {
    next(err);
  }
});

actionsRouter.get('/registry', (_req, res) => {
  res.json({ actions: listActionDefinitions() });
});