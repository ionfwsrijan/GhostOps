import { Router, Request, Response } from 'express';
import { sseManager } from '../services/sseService.js';

export function setupRoutes(app: import('express').Application) {
  const router = Router();

  // Health check
  router.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'ghostops-backend' });
  });

  // SSE: real-time event stream
  router.get('/events', (req: Request, res: Response) => {
    const incidentId = req.query.incidentId as string | undefined;
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    res.write(`data: ${JSON.stringify({ type: 'connected' })}\n\n`);

    sseManager.connect(res, incidentId ? { incidentId } : undefined);

    req.on('close', () => res.end());

    // Send a ping every 25 seconds to keep the connection alive
    const ping = setInterval(() => {
      res.write(`: ping\n\n`);
    }, 25000);

    req.on('close', () => clearInterval(ping));
  });

  app.use('/api', router);
}