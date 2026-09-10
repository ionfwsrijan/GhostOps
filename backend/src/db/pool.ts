import pg from 'pg';
import { env } from '../config.js';
import { logger } from '../logger.js';

const { Pool, types: pgTypes } = pg;

// Keep numeric money-ish columns as JS numbers (incident "amount", etc.)
pgTypes.setTypeParser(20, (v: string) => Number(v));
// timestamps come back as Date objects by default for `timestamptz` (type 1184)
pgTypes.setTypeParser(1184, (v: string) => v);

let pool: pg.Pool | null = null;

/** Lazily-created singleton pool. Never silently falls back to anything. */
export function getPool(): pg.Pool {
  if (!pool) {
    if (!env.DATABASE_URL) {
      throw new Error('DATABASE_URL is required — GhostOps no longer ships an in-memory database');
    }
    pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DB_POOL_SIZE,
      statement_timeout: env.DB_STATEMENT_TIMEOUT_MS,
      allowExitOnIdle: true,
      application_name: 'ghostops-backend',
    });
    pool.on('error', (err) => {
      logger.error({ err }, 'unexpected pg pool error');
    });
  }
  return pool;
}

export async function testConnection(client?: pg.PoolClient): Promise<void> {
  const c = client ?? getPool();
  await c.query('SELECT 1');
}

/** Run a callback inside a transaction (begin/commit; rollback on throw). */
export async function withTx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Repositories that need a transaction client accept one through this type. */
export type Tx = pg.PoolClient;

/** A client that can `query` — a pool or a pooled client (used by helpers). */
export type Queryable = pg.Pool | pg.PoolClient;

export function closePool(): Promise<void> {
  const p = pool;
  pool = null;
  return p ? p.end() : Promise.resolve();
}