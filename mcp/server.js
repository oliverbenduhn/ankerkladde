#!/usr/bin/env node
/**
 * Ankerkladde MCP-Server
 *
 * Konfiguration über Umgebungsvariablen:
 *   ANKERKLADDE_BASE_URL  – API-Basis-URL (Standard: https://anker.benduhn.de)
 *   ANKERKLADDE_API_KEY   – Ankerkladde Bearer-Token (aus Einstellungen → API-Key)
 *   MCP_HTTP_PORT         – Wenn gesetzt: HTTP-Modus auf diesem Port statt stdio
 *
 * Auth (HTTP-Modus): derselbe Bearer-Token wie die Ankerkladde-API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { createServer } from 'http';
import { randomUUID } from 'crypto';

// ── Konfiguration ─────────────────────────────────────────────────────────────

const BASE_URL  = (process.env.ANKERKLADDE_BASE_URL ?? 'https://anker.benduhn.de').replace(/\/$/, '');
const API_KEY   = process.env.ANKERKLADDE_API_KEY ?? '';
const HTTP_PORT = process.env.MCP_HTTP_PORT ? parseInt(process.env.MCP_HTTP_PORT, 10) : null;

if (!API_KEY) {
  process.stderr.write('[ankerkladde-mcp] Fehler: ANKERKLADDE_API_KEY ist nicht gesetzt.\n');
  process.exit(1);
}

// ── API-Hilfsfunktionen ───────────────────────────────────────────────────────

async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params });
  const res = await fetch(`${BASE_URL}/api.php?${qs}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

async function apiPost(action, body = {}) {
  const res = await fetch(`${BASE_URL}/api.php?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

function fmtItem(item) {
  const done = item.done    ? '✅' : '⬜';
  const qty  = item.quantity ? ` (${item.quantity})` : '';
  const cat  = item.category_name ? ` [${item.category_name}]` : '';
  const note = item.content
    ? ` — ${item.content.replace(/<[^>]+>/g, '').trim().slice(0, 80)}`
    : '';
  return `${done} #${item.id} ${item.name}${qty}${cat}${note}`;
}

function fmtItems(items) {
  return items.length ? items.map(fmtItem).join('\n') : '(keine Einträge)';
}

// ── MCP-Server-Factory (wird pro Session instanziiert) ────────────────────────

function createMcpServer() {
  const server = new McpServer({ name: 'ankerkladde', version: '1.0.0' });

  server.tool('list_categories', 'Alle Kategorien der Einkaufsliste abrufen (mit ID)', {}, async () => {
    const data  = await apiGet('categories_list');
    const lines = (data.categories ?? []).map(c => `#${c.id} „${c.name}" (${c.type})`);
    return { content: [{ type: 'text', text: lines.length ? lines.join('\n') : '(keine Kategorien)' }] };
  });

  server.tool(
    'list_items',
    'Einträge einer Kategorie abrufen. Ohne category_id → bevorzugte Kategorie.',
    { category_id: z.number().int().positive().optional().describe('Kategorie-ID (optional)') },
    async ({ category_id }) => {
      const params = category_id ? { category_id: String(category_id) } : {};
      const data   = await apiGet('list', params);
      const header = `Kategorie: ${data.category?.name ?? '?'} (${data.items?.length ?? 0} Einträge)`;
      return { content: [{ type: 'text', text: `${header}\n\n${fmtItems(data.items ?? [])}` }] };
    },
  );

  server.tool(
    'search_items',
    'Volltext-Suche über alle Einträge der Einkaufsliste',
    { q: z.string().min(2).describe('Suchbegriff (mind. 2 Zeichen)') },
    async ({ q }) => {
      const data   = await apiGet('search', { q });
      const header = `${data.items?.length ?? 0} Treffer für „${q}"`;
      return { content: [{ type: 'text', text: `${header}\n\n${fmtItems(data.items ?? [])}` }] };
    },
  );

  server.tool(
    'add_item',
    'Neuen Eintrag zur Einkaufsliste hinzufügen',
    {
      name:        z.string().min(1).describe('Name des Artikels'),
      category_id: z.number().int().positive().optional().describe('Kategorie-ID (optional)'),
      quantity:    z.string().optional().describe('Menge, z.B. „2 kg" oder „3 Stück"'),
      content:     z.string().optional().describe('Freitext-Notiz'),
    },
    async ({ name, category_id, quantity, content }) => {
      const body = { name };
      if (category_id) body.category_id = category_id;
      if (quantity)    body.quantity     = quantity;
      if (content)     body.content      = content;
      const data = await apiPost('add', body);
      return {
        content: [{
          type: 'text',
          text: data.item ? `✅ Hinzugefügt: ${fmtItem(data.item)}` : (data.message ?? 'Hinzugefügt.'),
        }],
      };
    },
  );

  server.tool(
    'toggle_item',
    'Eintrag abhaken (erledigt) oder wieder öffnen',
    {
      id:   z.number().int().positive().describe('ID des Eintrags (aus list_items)'),
      done: z.boolean().describe('true = abhaken, false = wieder öffnen'),
    },
    async ({ id, done }) => {
      await apiPost('toggle', { id, done: done ? 1 : 0 });
      return {
        content: [{
          type: 'text',
          text: done ? `✅ Eintrag #${id} als erledigt markiert.` : `⬜ Eintrag #${id} wieder geöffnet.`,
        }],
      };
    },
  );

  server.tool(
    'delete_item',
    'Einzelnen Eintrag dauerhaft löschen',
    { id: z.number().int().positive().describe('ID des Eintrags (aus list_items)') },
    async ({ id }) => {
      const data = await apiPost('delete', { id });
      return { content: [{ type: 'text', text: data.message ?? `Eintrag #${id} gelöscht.` }] };
    },
  );

  server.tool(
    'clear_checked',
    'Alle erledigten Einträge einer Kategorie löschen',
    { category_id: z.number().int().positive().optional().describe('Kategorie-ID (optional)') },
    async ({ category_id }) => {
      const data = await apiPost('clear', category_id ? { category_id } : {});
      return { content: [{ type: 'text', text: data.message ?? `${data.deleted ?? 0} Einträge gelöscht.` }] };
    },
  );

  return server;
}

// ── Start: stdio oder HTTP ────────────────────────────────────────────────────

if (HTTP_PORT) {
  // HTTP-Modus: StreamableHTTP mit Session-Management
  const sessions = new Map(); // sessionId → transport

  const httpServer = createServer(async (req, res) => {
    // CORS für Claude Code
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Mcp-Session-Id');
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

    // Auth: Bearer-Token muss dem Ankerkladde API-Key entsprechen
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.replace(/^Bearer\s+/i, '').trim();
    if (token !== API_KEY) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Unauthorized' }));
      return;
    }

    // Body lesen
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString('utf-8');
    let body;
    try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }

    // Session-Management
    const sessionId = req.headers['mcp-session-id'];

    if (req.method === 'POST' && !sessionId) {
      // Neue Session
      const newId    = randomUUID();
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => newId });
      const server   = createMcpServer();
      await server.connect(transport);
      sessions.set(newId, transport);
      transport.onclose = () => sessions.delete(newId);
      await transport.handleRequest(req, res, body);
      return;
    }

    if (sessionId && sessions.has(sessionId)) {
      await sessions.get(sessionId).handleRequest(req, res, body);
      return;
    }

    // Unbekannte Session
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Session not found' }));
  });

  httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
    process.stderr.write(`[ankerkladde-mcp] HTTP-Server läuft auf :${HTTP_PORT} → ${BASE_URL}\n`);
  });

} else {
  // stdio-Modus (für lokale Claude Code Instanzen)
  const server    = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[ankerkladde-mcp] stdio-Modus → ${BASE_URL}\n`);
}
