import { createClient } from '@supabase/supabase-js';
import { config, hasSupabase } from '../config.js';
import { DatabaseAdapter } from './adapter.js';
import { SupabaseAdapter } from './supabaseAdapter.js';
import { MemoryAdapter } from './memoryAdapter.js';

export type { DatabaseAdapter };
export type * from './types.js';

/**
 * Creates a Supabase client (anon key) usable from the server.
 * Tools that need service-level access get the adapter instead.
 */
export function createSupabaseClient() {
  if (!config.supabase.url || !config.supabase.anonKey) {
    throw new Error('Supabase credentials missing');
  }
  return createClient(config.supabase.url, config.supabase.anonKey);
}

let _adapter: DatabaseAdapter | null = null;

/**
 * Returns the active database adapter. Prefers Supabase when credentials
 * are configured; otherwise transparently falls back to an in-memory store
 * seeded with realistic demo data so the app runs anywhere.
 */
export function getDatabase(): DatabaseAdapter {
  if (_adapter) return _adapter;
  if (hasSupabase()) {
    try {
      _adapter = new SupabaseAdapter();
      console.log('[ghostops] using Supabase PostgreSQL adapter');
    } catch (err) {
      console.warn('[ghostops] Supabase unavailable, falling back to in-memory store:', (err as Error).message);
      _adapter = new MemoryAdapter();
    }
  } else {
    console.log('[ghostops] using in-memory adapter (set SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY for PostgreSQL)');
    _adapter = new MemoryAdapter();
  }
  return _adapter;
}

export function resetDatabaseForTests() {
  _adapter = null;
}