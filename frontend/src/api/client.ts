import axios from 'axios';

const baseURL = (import.meta.env.VITE_API_BASE_URL as string) || '/api';

export const api = axios.create({
  baseURL,
  timeout: 15000,
});

export async function get<T>(path: string): Promise<T> {
  const res = await api.get<T>(path);
  return res.data;
}

export async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await api.post<T>(path, body ?? {});
  return res.data;
}

export const endpoints = {
  incidents: () => '/incidents',
  incident: (id: string) => `/incidents/${id}`,
  timeline: (id: string) => `/incidents/${id}/timeline`,
  investigate: (id: string) => `/incidents/${id}/investigate`,
  verify: (id: string) => `/incidents/${id}/verify`,
  submitAction: (id: string) => `/incidents/${id}/actions`,
  stats: () => '/incidents/stats',
  activity: () => '/agent/activity',
  agentStatus: () => '/agent/status',
  actions: () => '/actions',
  actionRegistry: () => '/actions/registry',
  approvals: (status?: string) => `/approvals${status ? `?status=${status}` : ''}`,
  approve: (id: string) => `/approvals/${id}/approve`,
  reject: (id: string) => `/approvals/${id}/reject`,
  scenarios: () => '/simulate/scenarios',
  simulate: () => '/simulate/run',
  meta: () => '/meta',
  health: () => '/health',
  events: () => '/events',
};

export function eventsUrl(incidentId?: string): string {
  const url = `${baseURL}${endpoints.events()}`;
  return incidentId ? `${url}?incidentId=${encodeURIComponent(incidentId)}` : url;
}