import { AsyncLocalStorage } from 'async_hooks';
import crypto from 'crypto';

export interface RequestContext {
  requestId: string;
  method: string;
  path: string;
  ip?: string;
  actor?: { id: string; type: 'user' | 'api' | 'system'; email?: string };
  userRole?: string;
  apiScopes?: string[];
  runId?: string;
  incidentId?: string;
}

export const requestStore = new AsyncLocalStorage<RequestContext>();

export function newRequestId(): string {
  return 'req_' + crypto.randomBytes(8).toString('hex');
}

export function getRequestContext(): RequestContext | undefined {
  return requestStore.getStore();
}

export function childContext(overrides: Partial<RequestContext>): Partial<RequestContext> {
  const base = requestStore.getStore();
  return { ...(base ?? {}), ...overrides };
}