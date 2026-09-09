import { DatabaseAdapter } from './adapter.js';
import { MemoryAdapter } from './memoryAdapter.js';
import { SupabaseAdapter } from './supabaseAdapter.js';
import { config } from '../config.js';

/**
 * Lightweight wrapper re-exporting adapters for legacy imports.
 * Prefer `getDatabase()` from `./index.js` in application code.
 */
export type { DatabaseAdapter };

export function createAdapter(): DatabaseAdapter {
  if (config.supabase.url && config.supabase.serviceRoleKey) {
    return new SupabaseAdapter();
  }
  return new MemoryAdapter();
}