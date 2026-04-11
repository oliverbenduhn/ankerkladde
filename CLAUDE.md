# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Ankerkladde** is a mobile-friendly PHP web app for shopping lists, todos, notes, images, files, and links — backed by SQLite. Production: [ankerkladde.benduhn.de](https://ankerkladde.benduhn.de)

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
| `public/login.php` | Login page (incl. PWA install banner) |
| `public/settings.php` | User settings: password, categories, preferences, API key, extension download |
| `public/admin.php` | Admin user management |
| `public/theme.php` | Theme/preference helpers (`getExtendedUserPreferences`, `renderThemeBootScript`) |
| `public/manifest.php` | Web App Manifest (dynamic, uses user icon/color) |
| `public/extension-download.php` | Builds browser extension ZIP on demand (Chrome/Edge or Firefox) |
| `db.php` | SQLite init + auto-migrations on every boot (additive only); category/item DB helpers |
| `security.php` | Session management, CSRF token generation/validation, canonical host enforcement, auth helpers |

### Data Flow

1. `index.php` calls `getCsrfToken()` (starts session, emits token into `<meta>` tag)
2. `app.js` reads the token from DOM and sends it as `X-CSRF-Token` header on every mutating request
3. `api.php` validates the token via `requireCsrfToken()` before any write
4. Attachment file paths are always derived from DB records via `db.php` helpers (`getAttachmentAbsolutePath` etc.) — never from request data

### Database

SQLite at `data/einkaufsliste.db` (overridable via `EINKAUF_DATA_DIR` env var). Schema is created and migrated automatically in `getDatabase()` on every request — migrations are strictly additive `ALTER TABLE ... ADD COLUMN` statements.

Key tables:
- `users` — user accounts (username, password_hash, is_admin, api_key)
- `categories` — user-defined categories (name, type, icon, sort_order, is_hidden, legacy_key)
- `items` — all content (name, quantity, content/rich-text, done, category_id, sort_order, due_date, is_pinned); legacy `section` column kept for migration
- `attachments` — one attachment per item max (UNIQUE on item_id), stores metadata; actual files live in `data/uploads/{images,files}/`
- `items_fts` — FTS5 virtual table for full-text search over name+content, kept in sync via triggers

### Categories

Each user manages their own categories — count, names, icons, and order are freely configurable. Six category types are defined in `db.php` as `CATEGORY_TYPES`:

| Type | Second field | Notes |
|---|---|---|
| `list_quantity` | Quantity (text) | Shopping-list style |
| `list_due_date` | Due date | Datepicker, date shown on item |
| `notes` | — | Rich-text editor (TipTap) |
| `images` | — | Image upload, lightbox preview |
| `files` | — | File upload, download |
| `links` | — | URL, clickable |

`images` and `files` are "attachment types" (`ATTACHMENT_CATEGORY_TYPES` in `db.php`) — they use file upload flow instead of text input. Legacy section keys (`shopping`, `meds`, `todo_private`, `todo_work`, `notes`, `images`, `files`, `links`) are migrated to categories on first access via `migrateLegacyItemsForUser()`.

### Frontend State

`app.js` uses a plain `state` object (no reactive framework). The active category and view mode (`liste`/`einkaufen`) persist in `localStorage` (and via the `preferences` API). Items are also cached in localStorage for offline display. Category type configuration lives in the `TYPE_CONFIG` constant in `app.js`.

The notes section opens a full TipTap rich-text editor (loaded from CDN at esm.sh) with 800 ms debounce auto-save.

### Security Notes

- CSRF: session token validated on every POST from browser sessions; token passed as `X-CSRF-Token` header. API-key authenticated requests skip CSRF (the key itself is the secret).
- Canonical host redirect in `enforceCanonicalRequest()` — non-prod hosts redirect to `ankerkladde.benduhn.de` (bypassed for localhost)
- Attachment file paths built server-side only from DB records, never from user input
- Upload limits: 20 MB images, 5 GB files (set in `public/.user.ini` and nginx config)

### Environment Variables

| Variable | Purpose | Default |
|---|---|---|
| `EINKAUF_DATA_DIR` | Data/DB/uploads directory | `<project-root>/data` |
| `ANKERKLADDE_CANONICAL_HOST` | Production domain for redirect enforcement | `ankerkladde.benduhn.de` |
| `EINKAUF_TRUST_PROXY_HEADERS` | Trust X-Forwarded-* headers | Auto (true if request from 127.0.0.1) |
