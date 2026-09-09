import { z } from 'zod';
import { defineTool } from './types.js';

const notifySchema = z.object({
  recipient: z.string().email('recipient email required'),
  subject: z.string().min(1, 'subject is required'),
  body: z.string().min(1, 'body is required'),
  channel: z.enum(['email', 'sms']).default('email'),
});

export const notificationTools = [
  defineTool({
    name: 'notify_customer',
    description: 'Send a status update to the affected customer (email or SMS).',
    args: notifySchema,
    risk: 'low',
    async execute(input, ctx) {
      const result = await ctx.integrations.email.send({
        to: input.recipient,
        subject: input.subject,
        body: input.body,
      });
      await ctx.db.createNotification({
        incident_id: ctx.incidentId,
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject,
        message: input.body,
        status: 'sent',
      });
      return {
        success: true,
        summary: `Notification sent to ${input.recipient}`,
        data: { messageId: result.messageId, channel: input.channel },
      };
    },
  }),
];