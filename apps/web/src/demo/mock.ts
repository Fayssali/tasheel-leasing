/**
 * Browser-only demonstration (build with VITE_DEMO=1): replaces the API with recorded,
 * fictional responses so the real interface can be explored without a server.
 * Reading works; actions that would change data answer DEMO_READ_ONLY.
 */
import data from './demo-data.json';
import { demoImageSvg } from './image';

type Entry = { status: number; body: unknown };
type Dataset = Record<string, Record<string, Entry>>;

export const DEMO_ROLE_KEY = 'tasheel.demoRole';
export const DEMO_ROLES = ['anon', 'business', 'supplier', 'bank', 'admin'] as const;
export type DemoRole = (typeof DEMO_ROLES)[number];

export function demoRole(): DemoRole {
  try {
    const r = localStorage.getItem(DEMO_ROLE_KEY) as DemoRole | null;
    return r && DEMO_ROLES.includes(r) ? r : 'anon';
  } catch {
    return 'anon';
  }
}

const json = (status: number, body: unknown) =>
  new Response(status === 204 || body == null ? null : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

export function installDemoApi(): void {
  const realFetch = window.fetch.bind(window);
  const d = data as Dataset;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const at = url.indexOf('/api/v1');
    if (at < 0) return realFetch(input, init);
    const path = url.slice(at + '/api/v1'.length);
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    await new Promise((r) => setTimeout(r, 120));

    if (method === 'GET' && /\/images\/[^/]+$/.test(path.split('?')[0] ?? '')) {
      const id = path.split('?')[0]!.split('/').pop()!;
      return new Response(new Blob([demoImageSvg(id)], { type: 'image/svg+xml' }), { status: 200 });
    }
    if (path.startsWith('/auth/logout')) {
      try {
        localStorage.setItem(DEMO_ROLE_KEY, 'anon');
      } catch {
        /* storage unavailable: nothing to clear */
      }
      return json(204, null);
    }

    const role = demoRole();
    const find = (key: string) => d[role]?.[key] ?? d.anon?.[key];
    const entry = find(`${method} ${path}`) ?? find(`${method} ${path.split('?')[0]}`);
    if (entry) return json(entry.status, entry.body);
    return method === 'GET'
      ? json(404, { code: 'DEMO_NOT_AVAILABLE', message: 'Not part of the demonstration data.' })
      : json(403, { code: 'DEMO_READ_ONLY', message: 'The demonstration is read-only.' });
  };
}
