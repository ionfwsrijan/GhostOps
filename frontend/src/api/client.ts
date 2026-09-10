import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_BASE_URL as string) || '/api/v1';

export const api = axios.create({
  baseURL,
  timeout: 15000,
});

export async function get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
  const res = await api.get<T>(path, { params });
  return res.data;
}

export async function post<T>(path: string, body?: unknown, opts?: { headers?: Record<string, string> }): Promise<T> {
  const res = await api.post<T>(path, body ?? {}, opts);
  return res.data;
}

export const endpoints = {
  // ---- auth ----
  me: () => '/auth/me',
  login: () => '/auth/login',
  logout: () => '/auth/logout',
  apiKeys: () => '/auth/api-keys',
  createApiKey: () => '/auth/api-keys',
  revokeApiKey: (id: string) => `/auth/api-keys/${id}/revoke`,
  // ---- ingest ----
  ingest: () => '/',
  // ---- incidents ----
  incidents: () => '/incidents',
  incident: (id: string) => `/incidents/${id}`,
  incidentApprovals: (id: string) => `/incidents/${id}/approvals`,
  reinvestigate: (id: string) => `/incidents/${id}/reinvestigate`,
  stats: () => '/incidents/stats',
  actionDefinitions: () => '/incidents/action-definitions',
  submitAction: (id: string) => `/incidents/${id}/actions`,
  // ---- dashboard aggregates ----
  approvals: (status?: string) => `/approvals${status ? `?status=${status}` : ''}`,
  approvalDecision: (id: string) => `/approvals/${id}`,
  actions: () => '/actions',
  agentStatus: () => '/agent/status',
  agentActivity: () => '/agent/activity',
  audit: () => '/audit',
  // ---- system ----
  meta: () => '/meta',
  health: () => '/health',
  events: () => '/events',
};

export function eventsUrl(incidentId?: string): string {
  const url = `${baseURL}${endpoints.events()}`;
  return incidentId ? `${url}?incidentId=${encodeURIComponent(incidentId)}` : url;
}

export function authBearer(key: string): { headers: { Authorization: string } } {
  return { headers: { Authorization: `Bearer ${key}` } };
}