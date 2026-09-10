import { Router } from 'express';
import { engineRepo, queueRepo } from '../../db/repos/index.js';
import { listActionDefinitions } from '../../services/riskEngine.js';
import { worker } from '../../worker.js';
import { asyncHandler, requireAuth } from '../middleware.js';

/**
 * Dashboard aggregates consumed by the React SPA. Split from the incidents
 * router so top-level /approvals and /actions never collide with /:id params.
 */
const router = Router();

function liveStatus() {
  return {
    status: 'running',
    instance: worker.instanceId,
    uptimeSeconds: Math.round(process.uptime()),
    tools: listActionDefinitions().map((d) => d.label),
  };
}

async function queueSummary() {
  return queueRepo.queueDepth();
}

router.get('/approvals', requireAuth(), asyncHandler(async (req, res) => {
  const status = ['pending', 'approved', 'rejected', 'expired'].includes(String(req.query.status))
    ? (String(req.query.status) as 'pending' | 'approved' | 'rejected' | 'expired')
    : undefined;
  res.json({ approvals: await engineRepo.listApprovals(status, 200) });
}));

router.get('/actions', requireAuth(), asyncHandler(async (_req, res) => {
  res.json({ actions: await engineRepo.listAllActions(200) });
}));

router.get('/agent/status', requireAuth(), asyncHandler(async (_req, res) => {
  const [status, queue] = await Promise.all([liveStatus(), queueSummary()]);
  res.json({ ...status, queue });
}));

router.get('/agent/activity', requireAuth(), asyncHandler(async (_req, res) => {
  res.json({ activity: await engineRepo.listAllActions(200) });
}));

export default router;