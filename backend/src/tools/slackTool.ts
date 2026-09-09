import { z } from 'zod';
import { defineTool } from './types.js';

const postSchema = z.object({
  channel: z.enum(['on-call', 'incidents', 'engineering', 'support']).default('incidents'),
  text: z.string().min(1, 'text is required'),
  incidentCode: z.string().optional(),
});

export const slackTools = [
  defineTool({
    name: 'slack_post_message',
    description: 'Post a message to a Slack channel.',
    args: postSchema,
    risk: 'low',
    async execute(input, ctx) {
      const result = await ctx.integrations.slack.postMessage({
        channel: input.channel,
        text: input.incidentCode ? `[${input.incidentCode}] ${input.text}` : input.text,
      });
      await ctx.db.createNotification({
        incident_id: ctx.incidentId,
        channel: 'slack',
        recipient: `#${input.channel}`,
        subject: input.incidentCode ?? '',
        message: input.text,
        status: 'sent',
      });
      return {
        success: true,
        summary: `Message posted to #${input.channel}`,
        data: { messageId: result.messageId, channel: input.channel },
      };
    },
  }),
];