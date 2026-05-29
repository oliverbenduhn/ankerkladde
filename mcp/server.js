#!/usr/bin/env node
/**
 * Ankerkladde MCP-Server
 *
 * Konfiguration über Umgebungsvariablen:
 *   ANKERKLADDE_BASE_URL  – API-Basis-URL, z.B. https://anker.benduhn.de
 *                           oder http://localhost:8082 (VPS-intern)
 *   ANKERKLADDE_API_KEY   – Bearer-Token aus den Ankerkladde-Einstellungen
 *
 * Starten (stdio-Transport für Claude Code):
 *   ANKERKLADDE_BASE_URL=https://anker.benduhn.de \
 *   ANKERKLADDE_API_KEY=<key> \
 *   node /pfad/zu/mcp/server.js
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ── Konfiguration ─────────────────────────────────────────────────────────────

const BASE_URL = (process.env.ANKERKLADDE_BASE_URL ?? 'https://anker.benduhn.de').replace(/\/$/, '');
const API_KEY  = process.env.ANKERKLADDE_API_KEY ?? '';

if (!API_KEY) {
  process.stderr.write('[ankerkladde-mcp] Fehler: ANKERKLADDE_API_KEY ist nicht gesetzt.\n');
  process.exit(1);
}

// ── API-Hilfsfunktion ─────────────────────────────────────────────────────────

async function apiGet(action, params = {}) {
  const qs = new URLSearchParams({ action, ...params });
  const res = await fetch(`${BASE_URL}/api.php?${qs}`, {
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      Accept: 'application/json',
    },
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

/** Formatiert ein Item-Objekt kompakt als lesbaren String. */
function fmtItem(item) {
  const done  = item.done   ? '✅' : '⬜';
  const qty   = item.quantity ? ` (${item.quantity})` : '';
  const cat   = item.category_name ? ` [${item.category_name}]` : '';
  const note  = item.content ? ` — ${item.content.replace(/<[^>]+>/g, '').trim().slice(0, 80)}` : '';
  return `${done} #${item.id} ${item.name}${qty}${cat}${note}`;
}

function fmtItems(items) {
  if (!items.length) return '(keine Einträge)';
  return items.map(fmtItem).join('\n');
}

// ── MCP-Server ────────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'ankerkladde',
  version: '1.0.0',
});

// ── Tool: list_categories ─────────────────────────────────────────────────────

server.tool(
  'list_categories',
  'Alle Kategorien der Einkaufsliste abrufen (mit ID für weitere Aufrufe)',
  {},
  async () => {
    const data = await apiGet('categories_list');
    const lines = (data.categories ?? []).map(c =>
      `#${c.id} „${c.name}" (Typ: ${c.type})`
    );
    return {
      content: [{ type: 'text', text: lines.length ? lines.join('\n') : '(keine Kategorien)' }],
    };
  },
);

// ── Tool: list_items ──────────────────────────────────────────────────────────

server.tool(
  'list_items',
  'Einträge einer Einkaufslisten-Kategorie abrufen. Ohne category_id wird die zuletzt genutzte Kategorie verwendet.',
  {
    category_id: z.number().int().positive().optional()
      .describe('Kategorie-ID (optional – leer lässt die App die bevorzugte Kategorie wählen)'),
  },
  async ({ category_id }) => {
    const params = category_id ? { category_id: String(category_id) } : {};
    const data = await apiGet('list', params);
    const header = `Kategorie: ${data.category?.name ?? '?'} (${data.items?.length ?? 0} Einträge)`;
    return {
      content: [{ type: 'text', text: `${header}\n\n${fmtItems(data.items ?? [])}` }],
    };
  },
);

// ── Tool: search_items ────────────────────────────────────────────────────────

server.tool(
  'search_items',
  'Volltext-Suche über alle Einträge der Einkaufsliste',
  {
    q: z.string().min(2).describe('Suchbegriff (mind. 2 Zeichen)'),
  },
  async ({ q }) => {
    const data = await apiGet('search', { q });
    const header = `${data.items?.length ?? 0} Treffer für „${q}"`;
    return {
      content: [{ type: 'text', text: `${header}\n\n${fmtItems(data.items ?? [])}` }],
    };
  },
);

// ── Tool: add_item ────────────────────────────────────────────────────────────

server.tool(
  'add_item',
  'Neuen Eintrag zur Einkaufsliste hinzufügen',
  {
    name:        z.string().min(1).describe('Name des Artikels'),
    category_id: z.number().int().positive().optional()
      .describe('Kategorie-ID (optional – ohne Angabe: bevorzugte Kategorie)'),
    quantity:    z.string().optional().describe('Menge, z.B. „2 kg" oder „3 Stück"'),
    content:     z.string().optional().describe('Freitext-Notiz zum Eintrag'),
  },
  async ({ name, category_id, quantity, content }) => {
    const body = { name };
    if (category_id) body.category_id = category_id;
    if (quantity)    body.quantity     = quantity;
    if (content)     body.content      = content;
    const data = await apiPost('add', body);
    const item = data.item;
    return {
      content: [{
        type: 'text',
        text: item
          ? `✅ Hinzugefügt: ${fmtItem(item)}`
          : (data.message ?? 'Hinzugefügt.'),
      }],
    };
  },
);

// ── Tool: toggle_item ─────────────────────────────────────────────────────────

server.tool(
  'toggle_item',
  'Eintrag abhaken (erledigt) oder wieder öffnen',
  {
    id:   z.number().int().positive().describe('ID des Eintrags (aus list_items)'),
    done: z.boolean().describe('true = erledigt/abhaken, false = wieder öffnen'),
  },
  async ({ id, done }) => {
    await apiPost('toggle', { id, done: done ? 1 : 0 });
    return {
      content: [{
        type: 'text',
        text: done
          ? `✅ Eintrag #${id} als erledigt markiert.`
          : `⬜ Eintrag #${id} wieder geöffnet.`,
      }],
    };
  },
);

// ── Tool: delete_item ─────────────────────────────────────────────────────────

server.tool(
  'delete_item',
  'Einzelnen Eintrag dauerhaft löschen',
  {
    id: z.number().int().positive().describe('ID des Eintrags (aus list_items)'),
  },
  async ({ id }) => {
    const data = await apiPost('delete', { id });
    return {
      content: [{ type: 'text', text: data.message ?? `Eintrag #${id} gelöscht.` }],
    };
  },
);

// ── Tool: clear_checked ───────────────────────────────────────────────────────

server.tool(
  'clear_checked',
  'Alle erledigten (abgehakten) Einträge einer Kategorie löschen',
  {
    category_id: z.number().int().positive().optional()
      .describe('Kategorie-ID (optional – ohne Angabe: bevorzugte Kategorie)'),
  },
  async ({ category_id }) => {
    const body = category_id ? { category_id } : {};
    const data = await apiPost('clear', body);
    return {
      content: [{
        type: 'text',
        text: data.message ?? `${data.deleted ?? 0} erledigte Einträge gelöscht.`,
      }],
    };
  },
);

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write(`[ankerkladde-mcp] Verbunden mit ${BASE_URL}\n`);
