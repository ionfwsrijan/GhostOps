import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',

  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  },

  supabase: {
    url: process.env.SUPABASE_URL || '',
    anonKey: process.env.SUPABASE_ANON_KEY || '',
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  },

  n8n: {
    enabled: process.env.N8N_ENABLED === 'true',
    baseUrl: process.env.N8N_BASE_URL || 'http://localhost:5678',
    webhookPath: process.env.N8N_WEBHOOK_PATH || '/webhook/ghostops',
  },

  slack: {
    enabled: process.env.SLACK_ENABLED === 'true',
    webhookUrl: process.env.SLACK_WEBHOOK_URL || '',
  },

  jira: {
    enabled: process.env.JIRA_ENABLED === 'true',
    baseUrl: process.env.JIRA_BASE_URL || '',
    email: process.env.JIRA_EMAIL || '',
    apiToken: process.env.JIRA_API_TOKEN || '',
    projectKey: process.env.JIRA_PROJECT_KEY || 'OPS',
  },

  email: {
    enabled: process.env.EMAIL_ENABLED === 'true',
    smtpHost: process.env.SMTP_HOST || '',
    smtpPort: Number(process.env.SMTP_PORT || 587),
    smtpUser: process.env.SMTP_USER || '',
    smtpPass: process.env.SMTP_PASS || '',
  },

  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
};

export const hasOpenAI = () => Boolean(config.openai.apiKey);
export const hasSupabase = () =>
  Boolean(config.supabase.url && config.supabase.serviceRoleKey);