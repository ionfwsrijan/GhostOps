import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { env, corsOrigins, isTest } from './config.js';
import { logger } from './logger.js';
import { getPool, closePool, testConnection } from './db/pool.js';
import { authRepo } from './db/repos/auth.js';
import { apiRouter } from './routes/index.js';
import { withRequestContext, cookieMiddleware, metricsMiddleware, resolveActor, notFoundHandler, errorHandler } from './routes/middleware.js';
import { sseManager } from './services/sseService.js';
import { integrationsService } from './services/integrations/registry.js';
import { paymentPoller } from './services/integrations/polling.js';
import { worker } from './worker.js';

async function ensureSchema(): Promise<void> {
  const { rows } = await getPool().query<{ t: string | null }>(`SELECT to_regclass('public.incidents') AS t`);
  if (!rows[0].t) {
    logger.error('database schema missing — run migrations first:  cd backend && npm run migrate');
    process.exit(1);
  }
  logger.info('schema: migrations present');
}

async function seedAdminIfEmpty(): Promise<void> {
  const users = await authRepo.listUsers();
  if (users.length > 0) {
    logger.info(`auth: ${users.length} user(s) present — skipping bootstrap`);
    return;
  }
  const email = process.env.ADMIN_EMAIL ?? 'admin@ghostops.local';
  const password = process.env.ADMIN_INITIAL_PASSWORD ?? `gh${crypto.randomBytes(6).toString('hex')}`;
  const hash = await bcrypt.hash(password, 10);
  await authRepo.createUser({ email, password_hash: hash, name: 'Admin', role: 'admin' });
  if (!process.env.ADMIN_INITIAL_PASSWORD) {
    logger.warn(`auth: created bootstrap admin ${email} with temporary password ${password} — change it immediately`);
  } else {
    logger.info(`auth: created bootstrap admin ${email}`);
  }
}

function buildApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  app.use(cors({ origin: corsOrigins, credentials: true }));
  app.use(withRequestContext());
  app.use(metricsMiddleware());
  app.use(cookieMiddleware);
  // Webhooks must see the exact request bytes to verify HMAC signatures —
  // mount the raw parser at the prefix so it runs before express.json.
  app.use('/api/v1/webhooks', express.raw({ type: () => true, limit: '512kb' }));
  app.use(express.json({ limit: '256kb' }));

  app.use(resolveActor);
  app.use(apiRouter);

  app.get('/', (_req, res) => {
    res.json({ name: 'GhostOps AI', docs: '/api/v1/openapi.json', health: '/api/v1/health' });
  });

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

async function boot(): Promise<void> {
  logger.info({ env: env.NODE_ENV, port: env.PORT }, 'GhostOps booting');
  try {
    await testConnection();
  } catch (err) {
    logger.error({ err }, 'cannot reach postgres — refusing to boot');
    process.exit(1);
  }
  await ensureSchema();
  await seedAdminIfEmpty();

  await integrationsService.syncFromEnv();
  paymentPoller.start();
  worker.start();

  const app = buildApp();
  const server = app.listen(env.PORT, () => {
    logger.info({ url: `http://localhost:${env.PORT}` }, 'GhostOps listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    paymentPoller.stop();
    worker.stop();
    sseManager.disconnectAll();
    server.close(async () => {
      await closePool();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

if (!isTest) {
  boot().catch((err) => {
    logger.error({ err }, 'fatal boot error');
    process.exit(1);
  });
}

export { buildApp, ensureSchema };