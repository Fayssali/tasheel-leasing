/**
 * API client. The access token lives in memory only (never localStorage); the refresh token
 * is an httpOnly cookie the browser sends to /api/v1/auth. On a 401 the client refreshes once
 * and retries. The active organization is sent as X-Organization-Id on tenant routes.
 */

const BASE = import.meta.env.VITE_API_URL ?? '/api/v1';
const ORG_KEY = 'tasheel.activeOrg';

let accessToken: string | null = null;
let refreshInFlight: Promise<boolean> | null = null;
let onSessionLost: (() => void) | null = null;

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function setSessionLostHandler(handler: () => void): void {
  onSessionLost = handler;
}

export function getActiveOrg(): string | null {
  try {
    return localStorage.getItem(ORG_KEY);
  } catch {
    return null;
  }
}

export function setActiveOrg(id: string | null): void {
  try {
    if (id) localStorage.setItem(ORG_KEY, id);
    else localStorage.removeItem(ORG_KEY);
  } catch {
    /* storage unavailable: the org is then chosen on each load */
  }
}

/** Single shared refresh, so parallel 401s trigger one refresh call. */
export function refreshSession(): Promise<boolean> {
  refreshInFlight ??= fetch(`${BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(async (res) => {
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      const body = (await res.json()) as { accessToken: string };
      accessToken = body.accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | undefined | null>;
  /** Send X-Organization-Id (true = active organization, string = that organization). */
  org?: boolean | string;
}

export async function api<T>(path: string, opts: RequestOptions = {}, retried = false): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') params.set(k, String(v));
  }
  const qs = params.toString();

  const headers: Record<string, string> = { Accept: 'application/json' };
  const isForm = typeof FormData !== 'undefined' && opts.body instanceof FormData;
  if (opts.body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const orgId = typeof opts.org === 'string' ? opts.org : opts.org ? getActiveOrg() : null;
  if (orgId) headers['X-Organization-Id'] = orgId;

  const res = await fetch(`${BASE}${path}${qs ? `?${qs}` : ''}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    body: isForm
      ? (opts.body as FormData)
      : opts.body !== undefined
        ? JSON.stringify(opts.body)
        : undefined,
  });

  if (res.status === 401 && !retried && accessToken && !path.startsWith('/auth/refresh')) {
    if (await refreshSession()) return api<T>(path, opts, true);
    onSessionLost?.();
  }

  if (!res.ok) {
    let body: { code?: string; message?: string | string[] } = {};
    try {
      body = await res.json();
    } catch {
      /* non-JSON error */
    }
    const message = Array.isArray(body.message)
      ? body.message.join(' · ')
      : (body.message ?? res.statusText);
    const code =
      body.code ??
      (res.status === 400
        ? 'VALIDATION_ERROR'
        : res.status === 429
          ? 'TOO_MANY_REQUESTS'
          : `HTTP_${res.status}`);
    throw new ApiError(res.status, code, message, body);
  }

  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/** For fetches that cannot go through api() (e.g. authenticated images rendered from blobs). */
export function getAccessToken(): string | null {
  return accessToken;
}
