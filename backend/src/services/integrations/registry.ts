import { opsRepo } from '../../db/repos/index.js';
import { env, integrationEnabled } from '../../config.js';
import { IntegrationProvider } from '../../db/types.js';
import { logger } from '../../logger.js';

/**
 * Integration registry — mirrors the rendered state of each outbound channel
 * so the API and UI can render configuration/health without leaking secrets.
 * Credentials themselves stay in the environment (never shipped back).
 */
const PROVIDERS: Array<{ provider: IntegrationProvider; name: string; publicConfig: Record<string, unknown> }> = [
  { provider: 'slack', name: 'Slack', publicConfig: { method: 'incoming_webhook' } },
  { provider: 'jira', name: 'Jira', publicConfig: { method: 'api_token' } },
  { provider: 'email', name: 'Email (SMTP)', publicConfig: { method: 'smtp_auth', host: env.SMTP_HOST } },
  { provider: 'n8n', name: 'n8n workflow', publicConfig: { method: 'webhook', baseUrl: env.N8N_BASE_URL, path: env.N8N_WEBHOOK_PATH } },
];

export const integrationProviderOf = (p: string): IntegrationProvider | null =>
  PROVIDERS.some((x) => x.provider === p) ? (p as IntegrationProvider) : null;

export const integrationsService = {
  async syncFromEnv(): Promise<void> {
    for (const { provider, name, publicConfig } of PROVIDERS) {
      await opsRepo.ensureIntegration(provider, name);
      const enabled = integrationEnabled(provider);
      await opsRepo.updateIntegration(provider, {
        enabled,
        config: publicConfig,
        status: enabled ? 'healthy' : 'not_configured',
        last_health_check_at: new Date().toISOString(),
        last_health_error: enabled ? null : 'Missing environment configuration',
      });
    }
    logger.info({ integrations: PROVIDERS.map((p) => p.provider) }, 'integrations: registered from env');
  },

  async list() {
    return opsRepo.listIntegrations();
  },

  async healthCheck(): Promise<void> {
    for (const { provider } of PROVIDERS) {
      const enabled = integrationEnabled(provider);
      await opsRepo.updateIntegration(provider, {
        status: enabled ? 'healthy' : 'not_configured',
        last_health_check_at: new Date().toISOString(),
        last_health_error: enabled ? null : 'Missing environment configuration',
      });
    }
  },
};