import type {
  Athlete,
  Audience,
  Brief,
  Decision,
  SessionInfo,
  Update,
} from '../shared/types.js';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    headers: init.body ? { 'content-type': 'application/json' } : undefined,
    ...init,
  });
  if (!res.ok) {
    let code = 'error';
    let message = `Request failed (${res.status}).`;
    try {
      const body = (await res.json()) as { error?: string; message?: string };
      code = body.error ?? code;
      message = body.message ?? message;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export interface DemoUser {
  id: string;
  name: string;
  title: string;
  orgId: string;
  orgName: string;
  permissions: string[];
  audiences: string[];
}

export interface AppBootstrap {
  demoMode: boolean;
  aiProviderKind: 'mock' | 'azure';
  aiProviderLabel: string;
  teamsSso: boolean;
  demoUsers: DemoUser[];
}

export interface Notification {
  id: string;
  kind: string;
  text: string;
  audienceId: string;
}

export interface StaffRef {
  id: string;
  name: string;
  title: string;
  department: string;
}

export const api = {
  bootstrap: () => req<AppBootstrap>('/api/config'),
  session: () => req<SessionInfo>('/api/session'),
  signIn: (userId: string) =>
    req<{ ok: true }>('/api/session', { method: 'POST', body: JSON.stringify({ userId }) }),
  signOut: () => req<{ ok: true }>('/api/session', { method: 'DELETE' }),

  athletes: () => req<Athlete[]>('/api/athletes'),
  staff: () => req<StaffRef[]>('/api/staff'),
  audiences: () => req<Audience[]>('/api/audiences'),

  updates: (params: { audienceId?: string; athleteId?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.audienceId) q.set('audienceId', params.audienceId);
    if (params.athleteId) q.set('athleteId', params.athleteId);
    const s = q.toString();
    return req<Update[]>(`/api/updates${s ? `?${s}` : ''}`);
  },
  update: (id: string) => req<Update>(`/api/updates/${id}`),
  createUpdate: (payload: unknown) =>
    req<Update>('/api/updates', { method: 'POST', body: JSON.stringify(payload) }),
  reviseUpdate: (id: string, body: string, note: string) =>
    req<Update>(`/api/updates/${id}/revisions`, { method: 'POST', body: JSON.stringify({ body, note }) }),
  withdrawUpdate: (id: string) =>
    req<{ update: Update; invalidatedBriefIds: string[] }>(`/api/updates/${id}/withdraw`, { method: 'POST' }),

  briefs: (audienceId?: string) =>
    req<Brief[]>(`/api/briefs${audienceId ? `?audienceId=${encodeURIComponent(audienceId)}` : ''}`),
  brief: (id: string) => req<Brief>(`/api/briefs/${id}`),
  generateBrief: (audienceId: string, date?: string) =>
    req<Brief>('/api/briefs', { method: 'POST', body: JSON.stringify({ audienceId, date }) }),
  reviewItem: (briefId: string, itemId: string, action: string, note?: string | null) =>
    req<Brief>(`/api/briefs/${briefId}/items/${itemId}/review`, {
      method: 'POST',
      body: JSON.stringify({ action, note: note ?? null }),
    }),
  approveBrief: (briefId: string) =>
    req<Brief>(`/api/briefs/${briefId}/approve`, { method: 'POST', body: JSON.stringify({}) }),
  exportUrl: (briefId: string) => `/api/briefs/${briefId}/export`,

  decisions: () => req<Decision[]>('/api/decisions'),
  createDecision: (payload: unknown) =>
    req<Decision>('/api/decisions', { method: 'POST', body: JSON.stringify(payload) }),
  patchDecision: (id: string, payload: unknown) =>
    req<Decision>(`/api/decisions/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  search: (q: string) => req<{ query: string; results: Update[] }>(`/api/search?q=${encodeURIComponent(q)}`),
  notifications: () => req<Notification[]>('/api/notifications'),
};
