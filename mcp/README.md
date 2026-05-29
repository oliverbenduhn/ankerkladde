# Ankerkladde MCP-Server

MCP-Server (Model Context Protocol) für Ankerkladde. Ermöglicht KI-Assistenten wie Claude den direkten Zugriff auf die Einkaufsliste.

## Voraussetzungen

- Node.js ≥ 18
- API-Key aus den Ankerkladde-Einstellungen (Einstellungen → API-Key)

## Installation

```bash
cd mcp
npm install
```

## Konfiguration (Umgebungsvariablen)

| Variable | Pflicht | Beschreibung |
|---|---|---|
| `ANKERKLADDE_API_KEY` | ✅ | Bearer-Token aus den Ankerkladde-Einstellungen |
| `ANKERKLADDE_BASE_URL` | — | API-URL (Standard: `https://anker.benduhn.de`) |

## Claude Code einrichten

In `~/.claude.json` (global) oder `.claude/settings.json` (Projekt):

```json
{
  "mcpServers": {
    "ankerkladde": {
      "command": "node",
      "args": ["/pfad/zu/ankerkladde/mcp/server.js"],
      "env": {
        "ANKERKLADDE_BASE_URL": "https://anker.benduhn.de",
        "ANKERKLADDE_API_KEY": "<dein-api-key>"
      }
    }
  }
}
```

### Intern (Heimnetz)

```json
"ANKERKLADDE_BASE_URL": "http://192.168.50.10:8083"
```

### VPS-Docker (lokal auf dem VPS)

```json
"ANKERKLADDE_BASE_URL": "http://localhost:8082"
```

## Verfügbare Tools

| Tool | Beschreibung |
|---|---|
| `list_categories` | Alle Kategorien abrufen (mit IDs) |
| `list_items` | Einträge einer Kategorie auflisten |
| `search_items` | Volltext-Suche über alle Einträge |
| `add_item` | Neuen Eintrag hinzufügen |
| `toggle_item` | Eintrag abhaken oder wieder öffnen |
| `delete_item` | Eintrag dauerhaft löschen |
| `clear_checked` | Alle erledigten Einträge löschen |
