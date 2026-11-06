#!/usr/bin/env node
/**
 * Cudic MCP server — exposes Cudic projects to any MCP client over stdio.
 *
 *   CUDIC_API_KEY=cudic_... node cli/cudic-mcp.mjs
 *
 * MCP clients (Claude Desktop, Cursor, Cline, …) launch the command and speak
 * newline-delimited JSON-RPC 2.0 on stdin/stdout. No dependencies: Node 18+.
 * Credentials are the same as the CLI — CUDIC_API_KEY (durable, scoped) is
 * the intended one; CUDIC_TOKEN or ~/.cudic/config.json also work.
 *
 * Example client config:
 *   { "mcpServers": { "cudic": {
 *       "command": "node",
 *       "args": ["/path/to/cli/cudic-mcp.mjs"],
 *       "env": { "CUDIC_API_KEY": "cudic_..." } } } }
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';

const API = (process.env.CUDIC_API || 'https://glox-o7rr.onrender.com').replace(/\/+$/, '');
const HOME = process.env.CUDIC_HOME || path.join(os.homedir(), '.cudic');

function cred() {
  if (process.env.CUDIC_API_KEY) return process.env.CUDIC_API_KEY.trim();
  if (process.env.CUDIC_TOKEN) return process.env.CUDIC_TOKEN.trim();
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(HOME, 'config.json'), 'utf8'));
    return cfg.api_key || cfg.access_token || null;
  } catch { return null; }
}

async function api(pathname, opts = {}) {
  const token = cred();
  if (!token) {
    throw new Error('No Cudic credential. Set CUDIC_API_KEY (make one with `cudic key create`) or CUDIC_TOKEN.');
  }
  const res = await fetch(API + pathname, {
    method: opts.method || 'GET',
    headers: {
      Authorization: 'Bearer ' + token,
      ...(opts.body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error((data && (data.error || data.message)) || ('HTTP ' + res.status));
  return data;
}

const TOOLS = [
  {
    name: 'cudic_list_projects',
    description: "List the account's Cudic projects (id, title, published, updated_at).",
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'cudic_get_game',
    description: 'Read one Cudic game: title, description, tags and its text files (path → source).',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Game id' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'cudic_push_project',
    description: 'Create a project (no id) or save files to an existing one (id). Returns the game row.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Existing game id; omit to create' },
        title: { type: 'string' },
        description: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        files: { type: 'object', description: 'path → file contents' },
      },
      required: ['files'],
      additionalProperties: false,
    },
  },
  {
    name: 'cudic_publish_project',
    description: 'Publish a project so it appears in the gallery at /g/<id>.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'cudic_search',
    description: 'Search published Cudic games by title/description, optionally filtered by tag.',
    inputSchema: {
      type: 'object',
      properties: { q: { type: 'string' }, tag: { type: 'string' } },
      required: ['q'],
      additionalProperties: false,
    },
  },
];

async function callTool(name, args) {
  if (name === 'cudic_list_projects') {
    const d = await api('/api/games/mine');
    return (d && d.games) || [];
  }
  if (name === 'cudic_get_game') {
    if (!args.id) throw new Error('id is required');
    const d = await api('/api/games/' + encodeURIComponent(args.id));
    if (!d || !d.game) throw new Error('game not found');
    let files = d.game.files;
    if (typeof files === 'string') { try { files = JSON.parse(files); } catch { files = {}; } }
    return {
      id: d.game.id,
      title: d.game.title,
      description: d.game.description,
      tags: d.game.tags,
      published: d.game.published,
      files: files || {},
    };
  }
  if (name === 'cudic_push_project') {
    if (!args.files || typeof args.files !== 'object') throw new Error('files is required');
    const body = { files: args.files };
    if (args.title) body.title = args.title;
    if (args.description) body.description = args.description;
    if (args.tags) body.tags = args.tags;
    if (args.id) {
      const d = await api('/api/games/' + encodeURIComponent(args.id), { method: 'PUT', body });
      return d.game;
    }
    body.title = args.title || 'Untitled project';
    const d = await api('/api/games', { method: 'POST', body });
    return d.game;
  }
  if (name === 'cudic_publish_project') {
    if (!args.id) throw new Error('id is required');
    const body = { published: true };
    if (args.tags) body.tags = args.tags;
    const d = await api('/api/games/' + encodeURIComponent(args.id), { method: 'PUT', body });
    return d.game;
  }
  if (name === 'cudic_search') {
    const qs = new URLSearchParams({ q: String(args.q || '') });
    if (args.tag) qs.set('tag', String(args.tag));
    const d = await api('/api/games?' + qs.toString());
    return ((d && d.games) || []).map((g) => ({
      id: g.id, title: g.title, description: g.description, tags: g.tags, plays: g.play_count,
    }));
  }
  throw new Error('unknown tool: ' + name);
}

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Cudic MCP server (stdio).\n\nSet CUDIC_API_KEY=cudic_... and point an MCP client at this file.\nTools: ' + TOOLS.map((t) => t.name).join(', '));
  process.exit(0);
}

const send = (obj) => process.stdout.write(JSON.stringify(obj) + '\n');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', async (line) => {
  const text = line.trim();
  if (!text) return;
  let msg;
  try { msg = JSON.parse(text); } catch { return; }
  if (msg.id === undefined) return; // notifications (initialized, cancelled, …)
  try {
    if (msg.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          protocolVersion: (msg.params && msg.params.protocolVersion) || '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'cudic', version: '1.0.0' },
        },
      });
      return;
    }
    if (msg.method === 'ping') { send({ jsonrpc: '2.0', id: msg.id, result: {} }); return; }
    if (msg.method === 'tools/list') { send({ jsonrpc: '2.0', id: msg.id, result: { tools: TOOLS } }); return; }
    if (msg.method === 'tools/call') {
      const name = msg.params && msg.params.name;
      const args = (msg.params && msg.params.arguments) || {};
      try {
        const out = await callTool(name, args);
        send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] } });
      } catch (e) {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: 'Error: ' + ((e && e.message) || e) }], isError: true },
        });
      }
      return;
    }
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found: ' + msg.method } });
  } catch (e) {
    send({ jsonrpc: '2.0', id: msg.id, error: { code: -32603, message: (e && e.message) || 'internal error' } });
  }
});
