import { Router } from 'express';
import { getDatabase } from '../database/index.js';
import { listToolNames } from '../tools/index.js';

export const agentRouter = Router();

agentRouter.get('/activity', async (_req, res, next) => {
  try {
    const db = getDatabase();
    const actions = await db.listAgentActions(undefined, 200);
    const incidents = await db.listIncidents(200);
    const codeById = new Map(incidents.map((i) => [i.id, i.incident_code]));
    const rows = actions.map((a) => ({
      ...a,
      incident_code: codeById.get(a.incident_id) ?? a.incident_id,
    }));
    res.json({ activity: rows });
  } catch (err) {
    next(err);
  }
});

agentRouter.get('/status', async (_req, res) => {
  res.json({
    status: 'ACTIVE',
    tools: listToolNames(),
    version: '1.0.0',
    uptime: Math.round(process.uptime()),
  });
});