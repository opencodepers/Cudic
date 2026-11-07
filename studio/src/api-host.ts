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
