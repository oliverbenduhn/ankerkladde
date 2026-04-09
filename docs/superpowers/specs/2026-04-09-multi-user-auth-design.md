# Multi-User Authentication — Design Spec

**Date:** 2026-04-09  
**Status:** Approved

## Problem / Context

Zettel is currently a single-user, passwordless app. There is no login, no user table, and no data isolation. The goal is to support multiple named users who each log in with username and password, see only their own data, and cannot register themselves. An admin user can create and delete regular users and reset their passwords, but has no access to their content.

## Summary of Decisions

| Question | Decision |
|---|---|
| Data isolation | Per-user (each user sees only their own items) |
| Existing data | Migrated to a designated main user |
| Admin UI | Simple webpage at `/admin.php` |
| Admin login | Same `/login.php` as regular users, auto-redirect to `/admin.php` |
| Password reset | Admin sets passwords in admin UI (no self-service) |

---

## 1. Database Schema

### New table: `users`

```sql
CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE,
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0 CHECK(is_admin IN (0, 1)),
    created_at    TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
)
```

Passwords stored with PHP `password_hash()` / `PASSWORD_BCRYPT`.

### Migration: `items.user_id`

New additive migration in `db.php::getDatabase()`:

```sql
ALTER TABLE items ADD COLUMN user_id INTEGER REFERENCES users(id)
```

After adding the column, a one-time migration assigns all `NULL` user_id items to a designated main user. `scripts/create-admin.php` offers to create this main user during setup and run the assignment query (`UPDATE items SET user_id = :id WHERE user_id IS NULL`).

**Cascade on user delete:** SQLite's `ALTER TABLE ADD COLUMN` does not support foreign key cascade constraints. When a user is deleted via the admin UI, the PHP code explicitly deletes their items and attachments first, then the user record.

---

## 2. New Files

| File | Purpose |
|---|---|
| `public/login.php` | Login form (username + password), POST to self |
| `public/logout.php` | Destroys session, redirects to `/login.php` |
| `public/admin.php` | Admin UI: list users, create, delete, reset password |
| `scripts/create-admin.php` | CLI bootstrap: creates the first admin user interactively or via env vars |

---

## 3. Changes to Existing Files

### `security.php`

Three new functions:

```php
getCurrentUserId(): ?int   // returns $_SESSION['user_id'] or null
requireAuth(): int         // redirects to /login.php if not logged in; returns user_id
requireAdmin(): int        // requireAuth() + checks is_admin; sends 403 if not admin
```

### `public/index.php`

Add at the top (after `enforceCanonicalRequest()`):
```php
requireAuth(); // redirects to /login.php if not logged in
```

### `public/api.php`

- Add `requireAuth()` call at the start of every action handler (returns `$userId`)
- All SELECT queries: add `AND items.user_id = :user_id`
- All INSERT queries: include `user_id = :user_id`
- All UPDATE/DELETE queries: add `AND user_id = :user_id` to prevent cross-user access

### `public/media.php`

After `requireAuth()`, verify ownership before streaming:
```php
WHERE a.id = :id AND i.user_id = :user_id
```

---

## 4. Login Flow

1. User visits any protected page → `requireAuth()` redirects to `/login.php`
2. User submits username + password
3. Server: `password_verify()` against DB hash
4. On success:
   - `session_regenerate_id(true)` (prevent session fixation)
   - `$_SESSION['user_id'] = $user['id']`
   - `$_SESSION['is_admin'] = (bool)$user['is_admin']`
   - Admin → redirect to `/admin.php`
   - Regular user → redirect to `/index.php` (or originally requested URL)
5. On failure: show error message, no redirect

Logout: `logout.php` calls `session_destroy()` and redirects to `/login.php`.

---

## 5. Admin UI (`/admin.php`)

Accessible only to users with `is_admin = 1`. Layout consistent with the existing app style.

**Features:**
- List all non-admin users (username, created date)
- Create user: form with username + initial password
- Delete user: button with confirmation (cascades items + attachments)
- Reset password: inline form per user
- Admin account cannot be deleted via the UI

**Implementation:** All mutations handled via POST to `admin.php` itself (no API calls needed). CSRF token validated on every POST.

---

## 6. Bootstrapping (First-Time Setup)

```bash
php scripts/create-admin.php
```

- Prompts for admin username and password interactively
- Alternatively reads `EINKAUF_ADMIN_USER` + `EINKAUF_ADMIN_PASS` env vars (for automated deploys)
- Optionally prompts to create a first regular user and assign all existing items to them

This script is idempotent: if an admin already exists, it reports that and exits cleanly.

---

## 7. Security Checklist

- Passwords hashed with `password_hash()` / `PASSWORD_BCRYPT`, never stored in plain text
- `session_regenerate_id(true)` on login
- `user_id` always comes from `$_SESSION`, never from request data
- All item queries filtered by `user_id` — no user can read or write another user's data
- Admin has no access to other users' item content, only user management
- CSRF protection unchanged and still required on all POST requests
- `media.php` checks both attachment existence and user ownership before streaming

---

## 8. Files Changed / Created

| File | Change |
|---|---|
| `db.php` | Add `users` table migration + `items.user_id` migration |
| `security.php` | Add `getCurrentUserId()`, `requireAuth()`, `requireAdmin()` |
| `public/login.php` | **New** — login form |
| `public/logout.php` | **New** — session destroy + redirect |
| `public/admin.php` | **New** — admin user management UI |
| `public/index.php` | Add `requireAuth()` call |
| `public/api.php` | Add auth checks + user_id filtering on all queries |
| `public/media.php` | Add `requireAuth()` + ownership check |
| `scripts/create-admin.php` | **New** — bootstrap admin user |

---

## 9. Verification

1. Run `php scripts/create-admin.php` → admin user created in DB
2. Visit `/` → redirected to `/login.php`
3. Login as admin → redirected to `/admin.php`
4. Create a regular user in admin UI
5. Login as regular user → app loads, items are isolated
6. Verify regular user cannot access `/admin.php` (403)
7. Verify media streaming checks ownership (attempt to load another user's attachment URL → 403)
8. Run `bash scripts/smoke-test.sh` — should still pass
