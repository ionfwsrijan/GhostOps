import { Router } from 'express';
import './system.js';
import authRouter from './auth.js';
import incidentsRouter from './incidents.js';
import dashboardRouter from './dashboard.js';
import opsRouter from './ops.js';
import systemRouter from './system.js';

/** Everything mounted under /api/v1. */
export const v1 = Router();

v1.get('/', (_req, res) => {
  res.json({ name: 'GhostOps API', version: 'v1', docs: '/api/v1/openapi.json' });
});

v1.use('/auth', authRouter);
v1.use('/incidents', incidentsRouter);
v1.use(dashboardRouter); // /approvals, /actions, /agent/status, /agent/activity
v1.use(opsRouter); // openapi.json, docs, webhooks, integrations, outbox, audit
v1.use(systemRouter); // health, ready, metrics, meta, events