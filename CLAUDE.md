# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Zettel** is a mobile-friendly PHP web app for shopping lists, todos, notes, images, files, and links — backed by SQLite. Production: [ankerkladde.benduhn.de](https://ankerkladde.benduhn.de)

No build tool. No framework. Vanilla JS frontend, PHP 8.1+ backend.

## Commands

### Local Development

```bash
# Start dev server
php -S 127.0.0.1:8000 -t public

# Docker (alternative)
docker compose up
```

### Tests

```bash
# Full smoke test (uploads, media streaming, CSRF, attachment replacement, error cases)
bash scripts/smoke-test.sh

# DB migration test (runs migrations on a fresh DB)
bash scripts/test-db-migration.sh
```

Both scripts spin up their own `php -S` instances with isolated temp data dirs via `EINKAUF_DATA_DIR`. CI (self-hosted runner) runs both on push to `main`.

### Deploy (Production)

```bash
# Manual deploy via SSH
ssh ansible@web "sudo /var/www/projects/ankerkladde/deploy.sh"

# Deploy logs
ssh ansible@web "tail -f /var/log/ankerkladde/deploy.log"
```

Production deploy: Git push → GitHub Webhook → `deploy.sh` → `git pull` + PHP-FPM reload.

## Architecture

### File Map

| File | Role |
|---|---|
| `public/index.php` | HTML shell — renders tabs, form, meta tags (CSRF token, base path) |
| `public/api.php` | JSON REST API — all reads/writes go through here |
| `public/media.php` | Secure streaming of attachment files (never serves from webroot) |
| `public/app.js` | Entire frontend (~2000 lines), no bundler, no framework |
| `public/sw.js` | Service Worker — caches app shell, offline page, handles share targets |
| `db.php` | SQLite init + auto-migrations on every boot (additive only) |
| `security.php` | Session management, CSRF token generation/validation, canonical host enforcement |

### Data Flow

1. `index.php` calls `getCsrfToken()` (starts session, emits token into `<meta>` tag)
2. `app.js` reads the token from DOM and sends it as `X-CSRF-Token` header on every mutating request
3. `api.php` validates the token via `requireCsrfToken()` before any write
4. All file I/O goes through `db.php` helper functions — file paths are never derived from request data

### Database

SQLite at `data/einkaufsliste.db` (overridable via `EINKAUF_DATA_DIR` env var). Schema is created and migrated automatically in `getDatabase()` on every request — migrations are strictly additive `ALTER TABLE ... ADD COLUMN` statements.

Key tables:
- `items` — all content (name, quantity, content/rich-text, done, section, sort_order, due_date, is_pinned)
- `attachments` — one attachment per item max (UNIQUE on item_id), stores metadata; actual files live in `data/uploads/{images,files}/`
- `items_fts` — FTS5 virtual table for full-text search over name+content, kept in sync via triggers

### Sections

Eight sections defined in `app.js` `SECTIONS` constant and validated in `api.php` `VALID_SECTIONS`:
`shopping`, `meds`, `todo_private`, `todo_work`, `notes`, `images`, `files`, `links`

`images` and `files` are "attachment sections" (`ATTACHMENT_SECTIONS` in both PHP and JS) — they use file upload flow instead of text input.

### Frontend State

`app.js` uses a plain `state` object (no reactive framework). Sections and view modes (`liste`/`einkaufen`) persist in `localStorage`. Items are also cached in localStorage for offline display.

The notes section opens a full TipTap rich-text editor (loaded from CDN at esm.sh) with 800 ms debounce auto-save.

### Security Notes

- CSRF: session token validated on every POST; token passed as `X-CSRF-Token` header
- Canonical host redirect in `enforceCanonicalRequest()` — non-prod hosts redirect to `ankerkladde.benduhn.de` (bypassed for localhost)
- Attachment file paths built server-side only from DB records, never from user input
- Upload limits: 20 MB images, 5 GB files (set in `public/.user.ini` and nginx config)

### Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `EINKAUF_DATA_DIR` | Data/DB/uploads directory | `<project-root>/data` |
| `EINKAUF_TRUST_PROXY_HEADERS` | Trust X-Forwarded-* headers | Auto (true if request from 127.0.0.1) |
