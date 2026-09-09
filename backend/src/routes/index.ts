import { Router, Request, Response } from 'express';
import { sseManager } from '../services/sseService.js';
import { incidentsRouter } from './incidents.js';
import { agentRouter } from './agent.js';
import { actionsRouter } from './actions.js';
import { approvalsRouter } from './approvals.js';
import { simulateRouter } from './simulate.js';
import { n8nRouter } from './n8n.js';
import { config, hasOpenAI, hasSupabase } from '../config.js';

export function setupRoutes(app: import('express').Application) {
  const router = Router();

  router.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'ghostops-backend',
      ai: { available: hasOpenAI(), model: config.openai.model },
      database: { adapter: hasSupabase() ? 'supabase' : 'memory' },
      time: new Date().toISOString(),
    });
  });

  router.get('/meta', (_req, res) => {
    res.json({
      names: ['GhostOps AI'],
      version: '1.0.0',
      capabilities: {
        autonomousLoop: true,
        humanInTheLoop: true,
        realtime: true,
        llm: hasOpenAI(),
        database: hasSupabase() ? 'supabase-postgres' : 'in-memory-seeded',
        n8nEnabled: config.n8n.enabled,
      },
    });
  });

  // SSE: real-time event stream (also per-incident via ?incidentId=)
  router.get('/events', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders();

    const incidentId = typeof req.query.incidentId === 'string' ? req.query.incidentId : undefined;

    sseManager.connect(res, { incidentId: incidentId || undefined });

    res.write(`data: ${JSON.stringify({ type: 'connected', db: hasSupabase() ? 'supabase' : 'memory' })}\n\n`);

    const ping = setInterval(() => {
      try {
        res.write(`: ping\n\n`);
      } catch {
        clearInterval(ping);
      }
    }, 25000);

    req.on('close', () => {
      clearInterval(ping);
      res.end();
    });
  });

  router.use('/incidents', incidentsRouter);
  router.use('/agent', agentRouter);
  router.use('/actions', actionsRouter);
  router.use('/approvals', approvalsRouter);
  router.use('/simulate', simulateRouter);
  router.use('/n8n', n8nRouter);

  app.use('/api', router);
}