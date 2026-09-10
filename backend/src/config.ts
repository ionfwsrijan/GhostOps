import dotenv from 'dotenv';
import path from 'path';
import crypto from 'crypto';
import { z } from 'zod';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

/**
 * Runtime configuration — every value is validated at boot. The process will
 * not start with an invalid or missing *required*  value; optional values
 * degrade deliberately (visible in /health and /meta) instead of silently
 * pretending to work.
 */
/**
 * Parse an env boolean correctly. `z.coerce.boolean()` treats any non-empty
 * string (including "false"/"0") as `true` — this preserves intent and
 * supports unset → fallback, "1"/"true"/"yes"/"on" → true, else false.
 */
function preBool(fallback = false): z.ZodEffects<z.ZodBoolean, boolean, unknown> {
  return z.preprocess((v) => {
    if (v === undefined || v === null || v === '') return fallback;
    if (typeof v === 'boolean') return v;
    return !['false', '0', 'no', 'off'].includes(String(v).trim().toLowerCase());
  }, z.boolean());
}

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  LOG_PRETTY: preBool(),

  // DATABASE (required — there is no in-memory fallback anymore)
  DATABASE_URL: z.string().url().refine((u) => u.startsWith('postgres://') || u.startsWith('postgresql://'), 'DATABASE_URL must be a postgres:// URL'),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),
  DB_STATEMENT_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(10_000),
  DB_HARD_CONNECTIONS: preBool(),

  // Auth
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 chars').default('dev-only-session-secret-change-me-0123456789'),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(14),
  COOKIE_SECURE: preBool(),

  // Secrets at rest for integration credentials
  INTEGRATIONS_ENCRYPTION_KEY: z.string().min(32, 'INTEGRATIONS_ENCRYPTION_KEY must be at least 32 chars').default('dev-only-encryption-key-0123456789abcdef'),

  // API + origin
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  TRUST_PROXY: preBool(),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),

  // Agent engine
  AGENT_CYCLE_BUDGET_MS: z.coerce.number().int().positive().default(10 * 60_000),
  AGENT_STEP_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
  AGENT_MAX_CONCURRENT_RUNS: z.coerce.number().int().positive().default(3),
  AGENT_JOB_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  AGENT_STEP_DELAY_MS: z.coerce.number().int().nonnegative().default(450),
  APPROVAL_TTL_HOURS: z.coerce.number().int().positive().default(24),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1_000),

  // AI (optional; heuristic fallback when absent — logged at boot)
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),

  // Integrations (optional; health reports disconnected when absent)
  SLACK_ENABLED: preBool(),
  SLACK_WEBHOOK_URL: z.string().default(''),
  JIRA_ENABLED: preBool(),
  JIRA_BASE_URL: z.string().default(''),
  JIRA_EMAIL: z.string().default(''),
  JIRA_API_TOKEN: z.string().default(''),
  JIRA_PROJECT_KEY: z.string().default('OPS'),
  EMAIL_ENABLED: preBool(),
  SMTP_HOST: z.string().default(''),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_USER: z.string().default(''),
  SMTP_PASS: z.string().default(''),
  N8N_ENABLED: preBool(),
  N8N_BASE_URL: z.string().default(''),
  N8N_WEBHOOK_PATH: z.string().default('/webhook/ghostops'),

  // Provider intake (payment provider polling)
  PAYMENT_PROVIDER_API_URL: z.string().default(''),
  PAYMENT_PROVIDER_API_KEY: z.string().default(''),

  // Provider webhook HMAC secrets (empty string = endpoint refuses).
  // Secure by default: without a secret the /webhooks/* endpoints return
  // INTEGRATION_NOT_CONFIGURED instead of trusting anonymous callers.
  PAYMENT_WEBHOOK_SECRET: z.string().default(''),
  BOOKING_WEBHOOK_SECRET: z.string().default(''),
  MONITORING_WEBHOOK_SECRET: z.string().default(''),
  SUPPORT_WEBHOOK_SECRET: z.string().default(''),
});

export type Env = z.infer<typeof EnvSchema>;

function loadEnv(): Env {
  const parsed = EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  • ${i.path.join('.')}: ${i.message}`);
    // eslint-disable-next-line no-console
    console.error('[config] invalid or missing environment:\n' + issues.join('\n'));
    throw new Error('Configuration error — refusing to boot');
  }
  return parsed.data;
}

export const env: Env = loadEnv();

export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** CORS origins the API will accept credentials from. */
export const corsOrigins = env.CORS_ORIGIN.split(',').map((s) => s.trim()).filter(Boolean);

export function hasOpenAI(): boolean {
  return env.OPENAI_API_KEY.length > 0;
}

export function integrationEnabled(kind: 'slack' | 'jira' | 'email' | 'n8n'): boolean {
  switch (kind) {
    case 'slack':
      return env.SLACK_ENABLED && env.SLACK_WEBHOOK_URL.length > 0;
    case 'jira':
      return env.JIRA_ENABLED && env.JIRA_BASE_URL.length > 0 && env.JIRA_EMAIL.length > 0 && env.JIRA_API_TOKEN.length > 0;
    case 'email':
      return env.EMAIL_ENABLED && env.SMTP_HOST.length > 0 && env.SMTP_USER.length > 0 && env.SMTP_PASS.length > 0;
    case 'n8n':
      return env.N8N_ENABLED && env.N8N_BASE_URL.length > 0;
    default:
      return false;
  }
}

/**
 * Secrets module — AES-256-GCM at-rest encryption for integration
 * credentials stored in the `integrations` table.
 */
const ALGO = 'aes-256-gcm';

function encryptionKey(): Buffer {
  const raw = Buffer.from(env.INTEGRATIONS_ENCRYPTION_KEY, 'utf8');
  if (raw.length < 32) throw new Error('INTEGRATIONS_ENCRYPTION_KEY too short');
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(plain: string): string {
  const key = encryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString('base64'), enc.toString('base64'), tag.toString('base64')].join('.');
}

export function decryptSecret(payload: string): string {
  const key = encryptionKey();
  const [ivB64, dataB64, tagB64] = payload.split('.');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]);
  return dec.toString('utf8');
}

/** Deterministic token hashing for opaque session/api-key tokens. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** Constant-time comparison for HMAC / token verification. */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}