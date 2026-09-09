import { z } from 'zod';
import { defineTool } from './types.js';

const searchSchema = z.object({
  transactionId: z.string().min(1, 'transactionId is required'),
  service: z.string().optional(),
  level: z.enum(['info', 'warn', 'error']).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const logsTools = [
  defineTool({
    name: 'search_logs',
    description: 'Search system logs for the given transaction around the incident window. Read-only.',
    args: searchSchema,
    risk: 'low',
    async execute(input, ctx) {
      const all = await ctx.db.listSystemLogs(undefined, 200);
      const filtered = all.filter((log) => {
        const txnMatched = !log.metadata?.txn || String(log.metadata.txn) === input.transactionId;
        const serviceMatched = !input.service || log.service === input.service;
        const levelMatched = !input.level || log.level === input.level;
        return txnMatched && serviceMatched && levelMatched;
      });

      const relevant = filtered.sort((a, b) => (new Date(a.created_at!) > new Date(b.created_at!) ? 1 : -1));
      const errors = relevant.filter((l) => l.level === 'error');

      return {
        success: true,
        summary: `${relevant.length} log entr${relevant.length === 1 ? 'y' : 'ies'} (${errors.length} error)` +
          (errors.length ? ` — ${errors[0].message}` : ''),
        data: {
          transactionId: input.transactionId,
          total: relevant.length,
          errors: errors.length,
          entries: relevant.slice(-input.limit).map((l) => ({
            service: l.service,
            level: l.level,
            message: l.message,
            metadata: l.metadata,
            createdAt: l.created_at,
          })),
        },
      };
    },
  }),
];