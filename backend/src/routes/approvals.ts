import { Router } from 'express';
import { z } from 'zod';
import { actionService } from '../services/actionService.js';
import { getDatabase } from '../database/index.js';
import { ghostOpsAgent } from '../agents/ghostopsAgent.js';

export const approvalsRouter = Router();

approvalsRouter.get('/', async (req, res, next) => {
  try {
    const status = (req.query.status as string) ?? '';
    const db = getDatabase();
    const approvals = status ? await db.listApprovals(status as never) : await db.listApprovals();
    const incidents = await db.listIncidents(1000);
    const codeById = new Map(incidents.map((i) => [i.id, i.incident_code]));
    res.json({
      approvals: approvals.map((a) => ({
        ...a,
        incident_code: a.incident_id ? codeById.get(a.incident_id) ?? a.incident_id : null,
      })),
    });
  } catch (err) {
    next(err);
  }
});

approvalsRouter.post('/:id/approve', async (req, res, next) => {
  try {
    const parsed = z.object({ reason: z.string().optional() }).parse(req.body ?? {});
    const approval = await actionService.approveApproval(req.params.id, parsed.reason);
    if (approval.incident_id) {
      // Continue the paused agent loop: execute remaining actions + verify.
      setTimeout(() => {
        void ghostOpsAgent.resumeAfterApproval(approval.incident_id!, true).catch((e) => {
          console.error('[approvals] resume failed:', e);
        });
      }, 300);
    }
    res.json({ approval });
  } catch (err) {
    next(err);
  }
});

approvalsRouter.post('/:id/reject', async (req, res, next) => {
  try {
    const parsed = z.object({ reason: z.string().min(1, 'A rejection reason is required') }).parse(req.body ?? {});
    const approval = await actionService.rejectApproval(req.params.id, parsed.reason);
    if (approval.incident_id) {
      setTimeout(() => {
        void ghostOpsAgent.resumeAfterApproval(approval.incident_id!, false).catch((e) => {
          console.error('[approvals] resume failed:', e);
        });
      }, 300);
    }
    res.json({ approval });
  } catch (err) {
    next(err);
  }
});