// Where the backend actually is, and who is asking.
//
// These three lived in project.ts, which github.ts may not import: project.ts
// already imports github.ts, and a cycle between them makes module evaluation
// order matter. Studio is served from the static site, where /api/* is a plain
// 404 — so the connected-repo calls cannot guess a relative path either. One
// module both sides can depend on keeps a single answer to "which host".

const LOCAL = ['localhost', '127.0.0.1'];

/** The signed-in user's Supabase access token, or null when there is none. */
export function getToken(): string | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k != null && k.startsWith('sb-') && k.endsWith('-auth-token')) {
        const s = JSON.parse(localStorage.getItem(k) ?? 'null');
        if (s?.access_token != null) return s.access_token as string;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

interface SessionEntry {
  key: string;
  value: Record<string, unknown>;
}

function sessionEntry(): SessionEntry | null {
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k == null || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      const v = JSON.parse(localStorage.getItem(k) ?? 'null');
      if (v != null && typeof v === 'object') return { key: k, value: v as Record<string, unknown> };
    }
  } catch {
    // ignore
  }
  return null;
}

/** Supabase URL + anon key, straight from the same config.js the pages load. */
async function authCfg(): Promise<{ url: string; anon: string } | null> {
  try {
    const t = await (await fetch('/config.js')).text();
    const u = /SUPABASE_URL\s*=\s*'([^']+)'/.exec(t);
    const a = /SUPABASE_ANON_KEY\s*=\s*'([^']+)'/.exec(t);
    if (u == null || a == null) return null;
    return { url: u[1], anon: a[1] };
  } catch {
    return null;
  }
}

let refreshed: { token: string; at: number } | null = null;

/**
 * A token the server will still accept.
 *
 * `getToken` hands back whatever localStorage holds, and a Supabase access
 * token expires an hour after sign-in — so a tab left open (or a machine woken
 * up later) sent a valid-looking JWT that the server rejected with "Sign in
 * required." while the page still showed the account signed in. This refreshes
 * once with the stored refresh token and writes the new session back, which is
 * also what keeps the next request fast.
 */
export async function liveToken(): Promise<string | null> {
  const entry = sessionEntry();
  if (entry == null) return getToken();
  const tok = typeof entry.value.access_token === 'string' ? entry.value.access_token : '';
  const exp = Number(entry.value.expires_at) || 0;
  const now = Math.floor(Date.now() / 1000);
  if (tok !== '' && (exp === 0 || exp - now > 60)) return tok;
  if (refreshed != null && Date.now() - refreshed.at < 30_000) return refreshed.token;
  const rt = typeof entry.value.refresh_token === 'string' ? entry.value.refresh_token : '';
  const cfg = await authCfg();
  if (rt === '' || cfg == null) return tok === '' ? null : tok;
  try {
    const res = await fetch(cfg.url + '/auth/v1/token?grant_type=refresh_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: cfg.anon },
      body: JSON.stringify({ refresh_token: rt })
    });
    if (!res.ok) return tok === '' ? null : tok;
    const d = (await res.json()) as Record<string, unknown> | null;
    if (d == null || typeof d.access_token !== 'string') return tok === '' ? null : tok;
    try {
      localStorage.setItem(entry.key, JSON.stringify({ ...entry.value, ...d }));
    } catch {
      // private mode — the request still has a fresh token
    }
    refreshed = { token: d.access_token, at: Date.now() };
    return d.access_token;
  } catch {
    return tok === '' ? null : tok;
  }
}

/** '' for same-origin (local dev), otherwise the deployed API host. */
export async function apiBase(): Promise<string> {
  try {
    // Mirror config.js: local dev talks to the local backend (same host)
    // so new endpoints work before they deploy.
    if (LOCAL.includes(location.hostname)) return '';
    const t = await (await fetch('/config.js')).text();
    // NOTE: match the wss:// URL anywhere — config.js computes WS_URL with
    // a ternary, so `WS_URL = '...'` never literally appears in the file.
    const m = t.match(/(wss?:\/\/[^'"]+)/);
    if (m != null) return m[1].replace(/^wss?:\/\//, 'https://');
  } catch {
    // same-origin fallback
  }
  return '';
}

export function headers(json: boolean): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['Content-Type'] = 'application/json';
  const t = getToken();
  if (t != null) h['Authorization'] = 'Bearer ' + t;
  try {
    const seat = localStorage.getItem('cudic_seat');
    if (seat != null) h['X-Seat'] = seat;
  } catch {
    // ignore
  }
  return h;
}
