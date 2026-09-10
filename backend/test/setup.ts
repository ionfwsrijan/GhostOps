/**
 * Runs before every test file (before any app module is imported) so the
 * config schema validates against a safe, deterministic test environment.
 */
import { testDatabaseUrl } from './testEnv.js';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = testDatabaseUrl();
process.env.LOG_LEVEL = 'silent';
process.env.LOG_PRETTY = 'false';
process.env.COOKIE_SECURE = 'false';
process.env.AGENT_STEP_DELAY_MS = '0';
process.env.APPROVAL_TTL_HOURS = '24';
process.env.SESSION_SECRET = 'test-session-secret-0123456789-abcdefghijklmnop';
process.env.PAYMENT_WEBHOOK_SECRET = 'payment_test_secret';
process.env.BOOKING_WEBHOOK_SECRET = 'booking_test_secret';
process.env.MONITORING_WEBHOOK_SECRET = 'monitoring_test_secret';
process.env.SUPPORT_WEBHOOK_SECRET = 'support_test_secret';