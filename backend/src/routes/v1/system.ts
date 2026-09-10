import { Router, Request, Response, NextFunction } from 'express';
import { testConnection } from '../../db/repos/index.js';
import { sseManager } from '../../services/sseService.js';
import { metricsSummary } from '../../services/metrics.js';
import { asyncHandler, requireAuth } from '../middleware.js';
import { requestStore } from '../../context.js';
import { worker } from '../../worker.js';
import { queueRepo, opsRepo } from '../../db/repos/index.js';
import { AppError } from '../../errors.js';

const router = Router();

/** Any authenticated actor (session user OR api key) may bypass. */
function anyAuth(_req: Request, _res: Response, next: NextFunction): void {
  const ctx = requestStore.getStore();
  if (ctx?.actor) return next();
  next(new AppError('UNAUTHORIZED', 'Authentication required'));
}

router.get('/health', asyncHandler(async (_req, res) => {
  let postgres = 'ok';
  try {
    await testConnection();
  } catch {
    postgres = 'error';
  }
  res.json({ status: postgres === 'ok' ? 'ok' : 'degraded', uptimeSeconds: Math.round(process.uptime()), timestamp: new Date().toISOString(), dependencies: { postgres } });
}));

router.get('/ready', asyncHandler(async (_req, res) => {
  try {
    await testConnection();
  } catch {
    res.status(503).json({ status: 'not_ready', reason: 'database-unreachable' });
    return;
  }
  res.json({ status: 'ready' });
}));

router.get('/metrics', anyAuth, asyncHandler(async (_req, res) => {
  res.setHeader('content-type', 'text/plain; version=0.0.4');
  res.send(await metricsSummary());
}));

router.get('/meta', anyAuth, asyncHandler(async (_req, res) => {
  const [depth, integrations] = await Promise.all([
    queueRepo.queueDepth(),
    opsRepo.listIntegrations(),
  ]);
  res.json({
    env: process.env.NODE_ENV ?? 'development',
    workerInstance: worker.instanceId,
    queue: depth,
    integrations: integrations.map((i) => ({ provider: i.provider, enabled: i.enabled, status: i.status })),
    timestamp: new Date().toISOString(),
  });
}));

// Server-Sent Events stream for the dashboard (session cookie auth).
router.get('/events', requireAuth(), (req, res) => {
  const params = new URL(req.url, 'http://localhost').searchParams;
  const incidentId = params.get('incidentId') ?? undefined;
  const id = sseManager.connect(res, { incidentId });
  res.write(`data: ${JSON.stringify({ type: 'connected', data: { clientId: id } })}\n\n`);
  req.on('close', () => undefined);
});

export default router;