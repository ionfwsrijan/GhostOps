import { Client } from 'pg';
import path from 'path';
import { fileURLToPath } from 'url';
import { runner } from 'node-pg-migrate';
import { testDatabaseUrl } from './testEnv.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../migrations');

const noopLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  debug: () => undefined,
};

/**
 * Rebuilds a dedicated test database from scratch before every vitest run:
 *  - drops + recreates `ghostops_test` on the same Postgres server
 *  - applies all migrations via node-pg-migrate
 *
 * The dev `ghostops` database (used by the compose stack / smoke tools) is
 * never touched.
 */
export default async function globalSetup(): Promise<void> {
  const url = new URL(testDatabaseUrl());
  const dbName = url.pathname.replace(/^\//, '').replace(/[^a-zA-Z0-9_]/g, '_');
  if (!dbName) throw new Error('DATABASE_URL_TEST must include a database name');
  if (dbName === 'ghostops') {
    throw new Error('refusing to run tests against the dev database "ghostops" — set DATABASE_URL_TEST to a dedicated test database');
  }

  const maintenance = new URL(url.toString());
  maintenance.pathname = '/ghostops';

  const admin = new Client({ connectionString: maintenance.toString() });
  try {
    await admin.connect();
  } catch (err) {
    throw new Error(
      `cannot reach the maintenance database to create ${dbName}: ${(err as Error).message}. ` +
        'Start the compose Postgres (`docker compose up -d db`) or export DATABASE_URL_TEST.'
    );
  }
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  await runner({
    databaseUrl: testDatabaseUrl(),
    dir: migrationsDir,
    direction: 'up',
    migrationsTable: 'pgmigrations',
    logger: noopLogger,
  });
}