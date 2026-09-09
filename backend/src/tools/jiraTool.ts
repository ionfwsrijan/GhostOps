import { z } from 'zod';
import { defineTool } from './types.js';

const createSchema = z.object({
  incidentCode: z.string().min(1, 'incidentCode is required'),
  title: z.string().min(1, 'title is required'),
  description: z.string().optional(),
  priority: z.enum(['low', 'medium', 'high', 'critical']).default('high'),
});

export const jiraTools = [
  defineTool({
    name: 'jira_create_ticket',
    description: 'Create an engineering follow-up ticket in Jira for the platform team.',
    args: createSchema,
    risk: 'low',
    async execute(input, ctx) {
      const ticket = await ctx.db.createTicket({
        ticket_code: `OPS-${Math.floor(1400 + Math.random() * 900)}`,
        incident_id: ctx.incidentId,
        integration: 'jira',
        title: input.title,
        status: 'open',
        priority: input.priority,
        url: 'https://ghostops.atlassian.net/browse/OPS',
      });
      await ctx.integrations.jira.createTicket({
        projectKey: 'OPS',
        summary: input.title,
        description: input.description ?? `Auto-created by GhostOps for ${input.incidentCode}`,
        priority: input.priority,
      });
      return {
        success: true,
        summary: `Ticket ${ticket.ticket_code} created`,
        data: { ticketCode: ticket.ticket_code, url: ticket.url },
      };
    },
  }),
];