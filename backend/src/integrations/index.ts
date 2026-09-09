import { config } from '../config.js';

/**
 * Integration hub — modular adapters for external systems.
 *
 * For the hackathon MVP every integration has a working mock/sandbox
 * implementation that mirrors the real API surface, so the full agent
 * loop runs without external credentials. Flag `enabled=true` in `.env`
 * to point adapters at real systems.
 */

export interface SlackMessage {
  channel: string;
  text: string;
  blocks?: unknown[];
}

export interface SendSlackInput {
  channel: string;
  text: string;
}

export interface JiraTicketInput {
  projectKey: string;
  summary: string;
  description: string;
  priority: string;
}

export interface EmailInput {
  to: string;
  subject: string;
  body: string;
}

export interface N8nTriggerInput {
  workflow: string;
  payload: Record<string, unknown>;
}

export interface IntegrationHub {
  slack: {
    postMessage(input: SendSlackInput): Promise<{ ok: boolean; channel: string; messageId: string }>;
  };
  jira: {
    createTicket(input: JiraTicketInput): Promise<{ key: string; url: string; status: string }>;
  };
  email: {
    send(input: EmailInput): Promise<{ ok: boolean; messageId: string }>;
  };
  n8n: {
    trigger(input: N8nTriggerInput): Promise<{ ok: boolean; executionId: string }>;
  };
}

// ---------------------------------------------------------------
// Mock implementations (deterministic, logged to console)
// ---------------------------------------------------------------

const mockSlack: IntegrationHub['slack'] = {
  async postMessage(input) {
    console.log(`[mock-slack] #${input.channel}: ${input.text.slice(0, 140)}`);
    return { ok: true, channel: input.channel, messageId: `slack-${Date.now()}` };
  },
};

const mockJira: IntegrationHub['jira'] = {
  async createTicket(input) {
    console.log(`[mock-jira] created ${input.projectKey}-${Math.floor(1000 + Math.random() * 9000)}: ${input.summary}`);
    return {
      key: `OPS-${Math.floor(1400 + Math.random() * 900)}`,
      url: 'https://ghostops.atlassian.net/browse/OPS-1234',
      status: 'Open',
    };
  },
};

const mockEmail: IntegrationHub['email'] = {
  async send(input) {
    console.log(`[mock-email] to ${input.to} — ${input.subject}`);
    return { ok: true, messageId: `mail-${Date.now()}` };
  },
};

const mockN8n: IntegrationHub['n8n'] = {
  async trigger(input) {
    console.log(`[mock-n8n] workflow "${input.workflow}" triggered`);
    return { ok: true, executionId: `exe-${Date.now()}` };
  },
};

// ---------------------------------------------------------------
// Real-ish adapters (only when enabled via .env)
// ---------------------------------------------------------------

const realSlack: IntegrationHub['slack'] = {
  async postMessage(input) {
    if (!config.slack.webhookUrl) throw new Error('SLACK_WEBHOOK_URL not configured');
    await fetch(config.slack.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.text, channel: input.channel }),
    });
    return { ok: true, channel: input.channel, messageId: `slack-${Date.now()}` };
  },
};

export function getIntegrationHub(): IntegrationHub {
  return {
    slack: config.slack.enabled ? realSlack : mockSlack,
    jira: mockJira, // real Jira adapter can be swapped in later
    email: mockEmail,
    n8n: config.n8n.enabled ? createN8nAdapter() : mockN8n,
  };
}

function createN8nAdapter(): IntegrationHub['n8n'] {
  return {
    async trigger(input) {
      const url = `${config.n8n.baseUrl}${config.n8n.webhookPath}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow: input.workflow, ...input.payload }),
      });
      if (!res.ok) throw new Error(`n8n webhook failed: ${res.status}`);
      return { ok: true, executionId: `exe-${Date.now()}` };
    },
  };
}