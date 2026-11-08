// MCP connector for the Cudic AI agent — Streamable HTTP only, which is the
// transport that works from a browser (no stdio). For each configured server
// we run the JSON-RPC handshake, pull tools/list, and expose each tool to the
// model as `mcp_<server>_<tool>`. runTool() routes those calls back here via
// tools/call and we flatten the content blocks to text for the tool result.
//
// Server config lives in AiSettings.mcp as { url, key } entries. Keys ride
// the Authorization header and, like provider keys, never enter publicSettings
// except as presence flags.
export interface McpServer {
  url: string;
  key?: string;
}

interface McpToolEntry {
  server: McpServer;
  serverId: string;
  toolName: string;
  full: string;
  description?: string;
  schema: unknown;
}

// JSON-RPC ids increment per host so every POST is a distinct tracked request.
let rpcId = 0;
const TIMEOUT = 15000;

// Tools per server cap + a schema-byte cap so one sloppy server can't flood
// the model's context (LLM providers reject oversized tool arrays wholesale).
const MAX_TOOLS_PER_SERVER = 20;
const MAX_SCHEMA_BYTES = 4096;

function sanitizeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40);
}

// servers normalized by URL, keyed as `url|key-present`
export function serverKeyOf(s: McpServer): string {
  return s.url.replace(/\/+$/, '') + '|' + (s.key ? '1' : '0');
}

/**
 * Fetch an MCP catalog from one server.
 * Returns the tool entries it exposes; throws on protocol errors.
 * Semantics: initialize, then tools/list (SSE replies parsed defensively).
 */
export async function fetchCatalog(server: McpServer, rawName: string): Promise<McpToolEntry[]> {
  const sid = sanitizeName(rawName);
  const body = {
    jsonrpc: '2.0',
    id: ++rpcId,
    method: 'initialize',
    params: {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'CIDE', version: '1.0' }
    }
  };
  const ready = await rpc(server, body);
  if (ready && ready.error) throw new Error('initialize: ' + describeMcpErr(ready.error));
  // Notification round: no id, no result expected; tolerate servers that
  // answer with empty JSON bodies / 202s.
  try {
    await rpc(server, { jsonrpc: '2.0', method: 'notifications/initialized' });
  } catch { /* notification-only transport differences are not fatal */ }

  const listing = await rpc(server, { jsonrpc: '2.0', id: ++rpcId, method: 'tools/list', params: {} });
  if (listing && listing.error) throw new Error('tools/list: ' + describeMcpErr(listing.error));
  const tools = (listing && listing.result && listing.result.tools) as Record<string, unknown>[] | undefined;
  return (Array.isArray(tools) ? tools.slice(0, MAX_TOOLS_PER_SERVER) : []).map((t) => {
    const name = String(t.name || '').slice(0, 64);
    let schema: unknown = t.inputSchema;
    if (schema === null || schema === undefined) schema = {};
    if (JSON.stringify(schema).length > MAX_SCHEMA_BYTES) {
      schema = { description: 'Tool schema withheld — too large to include in chat (>' + MAX_SCHEMA_BYTES + 'B).' };
    }
    return {
      server: { url: server.url, key: server.key },
      serverId: sid,
      toolName: name,
      full: 'mcp_' + sid + '_' + sanitizeName(name).slice(0, 24),
      description: (typeof t.description === 'string' ? t.description : '').slice(0, 300),
      schema: schema
    };
  }).filter((t) => !!t.toolName);
}

/**
 * Invoke one tool on one server. Content blocks are flattened:
 *  - text: joined raw
 *  - image / resource refs: mentioned inline so the agent knows there was media
 *  - isError: truthy → ok:false
 */
export async function callTool(
  server: McpServer,
  toolName: string,
  args: Record<string, unknown>
): Promise<{ ok: boolean; text: string }> {
  const listing = await rpc(server, {
    jsonrpc: '2.0',
    id: ++rpcId,
    method: 'tools/call',
    params: { name: toolName, arguments: args }
  });
  if (listing && listing.error) return { ok: false, text: 'tools/call error: ' + describeMcpErr(listing.error) };
  const r = (listing && listing.result) as
    | { content?: unknown; isError?: boolean; structuredContent?: unknown }
    | undefined;
  const blocks = Array.isArray(r?.content) ? r!.content : [];
  const parts: string[] = [];
  for (const b of blocks as Record<string, unknown>[]) {
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text);
    else if (b.type === 'image') {
      // Downstream models don't see MCP images in this transport; note it so
      // the model reasons in context rather than assuming silence.
      parts.push('[image returned but not rendered]');
    } else if (b.type === 'resource') {
      parts.push(JSON.stringify(b).slice(0, 2000));
    }
  }
  if (parts.length === 0 && r && r.structuredContent != null) {
    try { parts.push(JSON.stringify(r.structuredContent).slice(0, 8000)); } catch { /* skip */ }
  }
  const text = parts.join('\n').slice(0, 30000);
  return { ok: !(r as { isError?: boolean })?.isError, text: text || '(empty tool result)' };
}

function describeMcpErr(err: unknown): string {
  if (err && typeof err === 'object') {
    const o = err as { message?: unknown; data?: unknown };
    const msg = typeof o.message === 'string' ? o.message : '';
    return (msg + (o.data !== undefined ? ' ' + JSON.stringify(o.data).slice(0, 200) : '')).trim() || JSON.stringify(o).slice(0, 200);
  }
  return String(err);
}

async function rpc(server: McpServer, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), TIMEOUT);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'MCP-Protocol-Version': '2025-03-26'
    };
    if (server.key) headers['Authorization'] = 'Bearer ' + server.key;
    const res = await fetch(server.url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    const ctype = (res.headers.get('content-type') || '');
    // SSE bodies arrive when the server elected streaming; harvest the
    // data: lines that parse as JSON-RPC responses.
    if (ctype.indexOf('text/event-stream') !== -1) {
      const text = await res.text();
      for (const chunk of text.split('\n')) {
        if (chunk.startsWith('data:')) {
          try {
            const j = JSON.parse(chunk.slice(5).trim()) as Record<string, unknown>;
            if (j.result !== undefined || j.error !== undefined) {
              if (j.result !== undefined) return j as Record<string, unknown>;
              // error-only SSE — surface it as an error record
              return { error: j.error || new Error('unknown SSE error') } as unknown as Record<string, unknown>;
            }
          } catch { /* keep scanning */ }
        }
      }
      return null;
    }
    const text = await res.text();
    if (!res.ok && !text) throw new Error('HTTP ' + res.status);
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      if (j.result !== undefined || j.error !== undefined) return j;
      return null; // reply not RPC-shaped (e.g. bare string on some servers)
    } catch {
      if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + text.slice(0, 120));
      return null;
    }
  } finally {
    window.clearTimeout(timer);
  }
}

/**
 * Aggregate catalogs for a servers list (bounded to 6 servers to keep the
 * model's system prompt from swelling) and produce lookup maps:
 *   tools: full name → entry (drop-in for TOOL_DEFS spread)
 *   servers: serverKeyOf → entry (for tools/call dispatch)
 */
export async function aggregateCatalog(servers: McpServer[]): Promise<{
  tools: McpToolEntry[];
  errors: { url: string; error: string }[];
}> {
  const fresh: McpToolEntry[] = [];
  const errors: { url: string; error: string }[] = [];
  for (const [i, s] of servers.slice(0, 6).entries()) {
    const name = 's' + (i + 1);
    try {
      fresh.push(...(await fetchCatalog(s, name)));
    } catch (e) {
      errors.push({ url: s.url, error: (e as Error).message || String(e) });
    }
  }
  return { tools: fresh, errors };
}
