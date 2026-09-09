import { Router } from 'express';

export const n8nRouter = Router();

/**
 * Receives workflow callbacks from n8n (or any webhook producer) and
 * records them against the incident + timeline for auditability.
 */
n8nRouter.post('/webhook', async (req, res) => {
  const payload = (req.body ?? {}) as Record<string, unknown>;
  const workflow = String(payload.workflow ?? 'unknown');
  const incidentId = payload.incidentId ? String(payload.incidentId) : undefined;

  try {
    if (incidentId) {
      const { incidentService } = await import('../services/incidentService.js');
      await incidentService.addTimelineEntry({
        incident_id: incidentId,
        step: 'n8n',
        type: 'system',
        title: `n8n workflow: ${workflow}`,
        description: JSON.stringify(payload)?.slice(0, 400),
        metadata: { workflow, payload },
      });
    }
    res.json({ ok: true, received: { workflow, incidentId } });
  } catch (err) {
    console.error('[n8n] webhook error:', err);
    res.status(500).json({ ok: false, error: (err as Error).message });
  }
});