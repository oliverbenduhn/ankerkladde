# Internationalization (i18n) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Internationalize Ankerkladde with English as the first additional language, using JSON translation files and a `t()` helper function on both PHP and JS sides.

**Architecture:** JSON language files (`lang/de.json`, `lang/en.json`) with flat dot-notation keys. PHP `t()` function loads strings once per request; JS reads from `window.__i18n` rendered inline by PHP. Language preference stored per-user in DB with ENV-based instance default and hardcoded German fallback.

**Tech Stack:** PHP 8.1+, Vanilla JS (ESM), SQLite, JSON

**Spec:** `docs/superpowers/specs/2026-05-07-internationalization-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|---|---|
| `i18n.php` | `t()`, `getAllStrings()`, `getCurrentLanguage()`, `getAvailableLanguages()` |
| `public/js/i18n.js` | JS `t()` function, reads `window.__i18n` |
| `lang/de.json` | All German strings (~150 keys) |
| `lang/en.json` | All English translations |

### Modified Files (key changes)
| File | Change |
|---|---|
| `db.php` | Add `users.language` column migration |
| `security.php` | Add `ANKERKLADDE_DEFAULT_LANGUAGE` ENV |
| `public/index.php` | Render `window.__i18n` block, dynamic `lang` attr, all strings → `t()` |
| `public/login.php` | All strings → `t()` |
| `public/settings.php` | All strings → `t()`, language dropdown, category rename dialog |
| `public/admin.php` | All strings → `t()` |
| `public/api.php` | All error strings → `t()`, add `error_key` field to all `respond()` calls |
| `public/manifest.php` | Dynamic `lang`, translated `name`/`description` |
| `public/js/*.js` | 16 JS files: `import { t }` and replace hardcoded strings |
| `scripts/smoke-test.sh` | Update string assertions for i18n |

---

### Task 1: Create `i18n.php` with `t()` and language resolution

**Files:**
- Create: `i18n.php`
- Modify: `security.php:1-6` (add ENV constant)

- [ ] **Step 1: Create `i18n.php`**

```php
<?php
declare(strict_types=1);

/**
 * Supported language codes. Add entries here when adding a new language.
 */
function getAvailableLanguages(): array
{
    return ['de', 'en'];
}

/**
 * Resolve the active language: user DB field → ENV default → 'de'.
 * Requires an active session (for user lookup) or returns the instance default.
 */
function getCurrentLanguage(): string
{
    // 1. User preference from DB (if logged in)
    $userId = getCurrentUserId();
    if ($userId !== null) {
        static $userLangCache = [];
        if (!isset($userLangCache[$userId])) {
            $db = getDatabase();
            $stmt = $db->prepare('SELECT language FROM users WHERE id = :id');
            $stmt->execute([':id' => $userId]);
            $userLangCache[$userId] = $stmt->fetchColumn() ?: null;
        }
        if ($userLangCache[$userId] !== null && in_array($userLangCache[$userId], getAvailableLanguages(), true)) {
            return $userLangCache[$userId];
        }
    }

    // 2. Instance default from ENV
    if (defined('ANKERKLADDE_DEFAULT_LANGUAGE') && in_array(ANKERKLADDE_DEFAULT_LANGUAGE, getAvailableLanguages(), true)) {
        return ANKERKLADDE_DEFAULT_LANGUAGE;
    }

    // 3. Hardcoded fallback
    return 'de';
}

/**
 * Get the language for an API-key-authenticated user (no session).
 */
function getLanguageForUser(int $userId): string
{
    $db = getDatabase();
    $stmt = $db->prepare('SELECT language FROM users WHERE id = :id');
    $stmt->execute([':id' => $userId]);
    $lang = $stmt->fetchColumn() ?: null;

    if ($lang !== null && in_array($lang, getAvailableLanguages(), true)) {
        return $lang;
    }

    if (defined('ANKERKLADDE_DEFAULT_LANGUAGE') && in_array(ANKERKLADDE_DEFAULT_LANGUAGE, getAvailableLanguages(), true)) {
        return ANKERKLADDE_DEFAULT_LANGUAGE;
    }

    return 'de';
}

/**
 * Load all translation strings for a given language with German fallback.
 */
function loadStrings(string $lang): array
{
    $fallbackFile = __DIR__ . '/lang/de.json';
    $fallback = json_decode(file_get_contents($fallbackFile), true) ?: [];

    if ($lang === 'de') {
        return $fallback;
    }

    $langFile = __DIR__ . '/lang/' . $lang . '.json';
    if (!is_file($langFile)) {
        return $fallback;
    }

    $strings = json_decode(file_get_contents($langFile), true) ?: [];
    return $strings + $fallback;
}

/**
 * Translate a key, with optional placeholder replacement.
 * Placeholders use {name} syntax.
 */
function t(string $key, array $params = []): string
{
    static $strings = null;
    if ($strings === null) {
        $strings = loadStrings(getCurrentLanguage());
    }

    $text = $strings[$key] ?? $key;
    foreach ($params as $k => $v) {
        $text = str_replace('{' . $k . '}', (string) $v, $text);
    }
    return $text;
}

/**
 * Return all loaded strings for the current language (for window.__i18n).
 */
function getAllStrings(): array
{
    static $strings = null;
    if ($strings === null) {
        $strings = loadStrings(getCurrentLanguage());
    }
    return $strings;
}
```

- [ ] **Step 2: Add ENV constant to `security.php`**

Add after line 6 (`unset($_envCanonicalHost);`):

```php
$_envDefaultLanguage = getenv('ANKERKLADDE_DEFAULT_LANGUAGE');
define('ANKERKLADDE_DEFAULT_LANGUAGE', $_envDefaultLanguage !== false ? (string)$_envDefaultLanguage : 'de');
unset($_envDefaultLanguage);
```

- [ ] **Step 3: Create initial empty `lang/de.json`**

```bash
mkdir -p lang
echo '{}' > lang/de.json
echo '{}' > lang/en.json
```

- [ ] **Step 4: Verify PHP syntax**

Run: `php -l i18n.php && php -l security.php`
Expected: `No syntax errors detected`

- [ ] **Step 5: Commit**

```bash
git add i18n.php security.php lang/de.json lang/en.json
git commit -m "feat(i18n): add translation infrastructure — t(), getCurrentLanguage(), lang files"
```

---

### Task 2: Create `public/js/i18n.js`

**Files:**
- Create: `public/js/i18n.js`

- [ ] **Step 1: Create the JS translation module**

```js
// @ts-check

/** @type {Record<string, string>} */
const strings = window.__i18n || {};

/**
 * Translate a key with optional placeholder replacement.
 * Placeholders use {name} syntax.
 *
 * @param {string} key
 * @param {Record<string, string>} [params]
 * @returns {string}
 */
export function t(key, params = {}) {
    let text = strings[key] ?? key;
    for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, v);
    }
    return text;
}
```

- [ ] **Step 2: Commit**

```bash
git add public/js/i18n.js
git commit -m "feat(i18n): add JS translation module"
```

---

### Task 3: Add `users.language` DB migration

**Files:**
- Modify: `db.php:321-323` (after `must_change_password` migration)

- [ ] **Step 1: Add migration**

After the existing `must_change_password` migration block (line 322), add:

```php
    if (!in_array('language', $userColumnNames, true)) {
        $db->exec('ALTER TABLE users ADD COLUMN language TEXT');
    }
```

Note: `TEXT` without `NOT NULL` / `DEFAULT` — `NULL` means "use instance default".

- [ ] **Step 2: Verify syntax and run migration test**

Run:
```bash
php -l db.php
bash scripts/test-db-migration.sh
```
Expected: No syntax errors, migration test passes.

- [ ] **Step 3: Commit**

```bash
git add db.php
git commit -m "feat(i18n): add users.language column migration"
```

---

### Task 4: Extract PHP strings — `index.php`

This is the largest single file. All hardcoded German strings in `index.php` are replaced with `t()` calls and corresponding keys are added to `lang/de.json`.

**Files:**
- Modify: `public/index.php`
- Modify: `lang/de.json`

- [ ] **Step 1: Add `i18n.php` require and `window.__i18n` block to `index.php`**

At the top of `index.php`, after `require __DIR__ . '/theme.php';` (line 8), add:

```php
require dirname(__DIR__) . '/i18n.php';
```

Replace `<html lang="de">` (line 58) with:

```php
<html lang="<?= htmlspecialchars(getCurrentLanguage(), ENT_QUOTES, 'UTF-8') ?>">
```

After the CSRF token meta tag (line 69), add:

```php
    <meta name="app-language" content="<?= htmlspecialchars(getCurrentLanguage(), ENT_QUOTES, 'UTF-8') ?>">
    <script>window.__i18n = <?= json_encode(getAllStrings(), JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) ?>;window.__lang = <?= json_encode(getCurrentLanguage()) ?>;</script>
```

- [ ] **Step 2: Replace all hardcoded strings in `index.php` with `t()` calls**

Replace every hardcoded German string with its `t()` equivalent. Examples of the pattern:

```php
// Before:
<span>App installieren?</span>
// After:
<span><?= t('ui.install_prompt') ?></span>

// Before:
aria-label="Einstellungen"
// After:
aria-label="<?= t('ui.settings') ?>"

// Before:
placeholder="Artikel..."
// After:
placeholder="<?= t('item.input_placeholder') ?>"
```

Full list of keys to extract (all ~55 strings from index.php):

| Key | German value |
|---|---|
| `ui.install_prompt` | App installieren? |
| `ui.install` | Installieren |
| `ui.close` | Schließen |
| `ui.update_available` | Neue Version verfügbar. |
| `ui.reload` | Neu laden |
| `ui.title_list` | Listen |
| `ui.show_conflicts` | Konflikte anzeigen |
| `ui.toggle_tabs` | Kategorienleiste ein-/ausblenden |
| `ui.scan_product` | Produktinfos per Scan öffnen |
| `ui.search` | Suchen |
| `ui.ai_assistant` | KI-Assistent |
| `ui.settings` | Einstellungen |
| `ui.desktop_view` | Desktop-Ansicht |
| `ui.view_list` | Listenansicht |
| `ui.view_grid` | Kästchenansicht |
| `ui.view_kanban` | Kanban-Ansicht |
| `ui.start_shopping` | Einkaufs-Modus starten |
| `ui.search_all` | In allen Bereichen suchen… |
| `ui.voice_input` | Spracheingabe |
| `ui.magic_placeholder` | KI-Befehl (z.B. 'Zutaten für Lasagne') |
| `ui.magic_submit` | KI ausführen |
| `ui.title_shopping` | Einkaufen |
| `ui.scan_barcode` | Barcode scannen |
| `ui.edit_list` | Liste bearbeiten |
| `item.input_placeholder` | Artikel... |
| `item.link_description` | Beschreibung optional |
| `item.upload_file` | Datei wählen |
| `item.upload_url` | Von URL laden |
| `item.choose_file` | Datei wählen |
| `item.take_photo` | Foto aufnehmen |
| `item.no_file_selected` | Keine Datei ausgewählt |
| `item.url_placeholder` | https://example.com/datei.pdf |
| `item.url_label` | Datei-URL |
| `item.quantity` | Menge |
| `item.add` | Artikel hinzufügen |
| `item.drop_image` | Bild hierher ziehen oder aus Zwischenablage einfügen |
| `item.list_label` | Ankerkladde |
| `item.clear_done` | Erledigte löschen |
| `ui.select_category` | Bereich wählen |
| `conflict.title` | Konflikte |
| `conflict.subtitle` | Diese Einträge konnten nicht gespeichert werden. |
| `conflict.discard_all` | Alle verwerfen |
| `scanner.title` | Barcode scannen |
| `scanner.preparing` | Kamera wird vorbereitet… |
| `scanner.close` | Scanner schließen |
| `scanner.manual_input` | Barcode manuell eingeben |
| `scanner.submit` | Barcode übernehmen |
| `editor.back` | Zurück |
| `editor.title_placeholder` | Titel... |
| `editor.formatting` | Formatierung |
| `todo.back` | Zurück |
| `todo.title_placeholder` | Aufgabe... |
| `todo.due_date` | Fälligkeitsdatum |
| `todo.status` | Status |
| `todo.status_open` | Offen |
| `todo.status_in_progress` | In Arbeit |
| `todo.status_waiting` | Wartet |
| `todo.status_done` | Erledigt |
| `todo.notes_placeholder` | Notizen zur Aufgabe... |

Also extract the toolbar button titles (H1, H2, H3, Bold, Italic, Strike, etc.) — these are formatting names that may stay in English across languages or get translated.

- [ ] **Step 3: Add all extracted keys to `lang/de.json`**

Update `lang/de.json` with all keys from Step 2 plus all keys from subsequent tasks (the file will be built up incrementally).

- [ ] **Step 4: Verify syntax**

Run: `php -l public/index.php`
Expected: `No syntax errors detected`

- [ ] **Step 5: Commit**

```bash
git add public/index.php lang/de.json
git commit -m "feat(i18n): extract index.php strings to translation keys"
```

---

### Task 5: Extract PHP strings — `login.php`

**Files:**
- Modify: `public/login.php`
- Modify: `lang/de.json`

- [ ] **Step 1: Add `i18n.php` require to `login.php`**

After the existing `require` statements, add:

```php
require dirname(__DIR__) . '/i18n.php';
```

Replace `<html lang="de">` with dynamic `<html lang="<?= htmlspecialchars(getCurrentLanguage(), ENT_QUOTES, 'UTF-8') ?>">`.

- [ ] **Step 2: Replace all hardcoded strings**

Keys to extract:

| Key | German value |
|---|---|
| `login.title` | Anmelden — Ankerkladde |
| `login.heading` | Ankerkladde |
| `login.username` | Benutzername |
| `login.password` | Passwort |
| `login.submit` | Anmelden |
| `login.invalid_csrf` | Ungültiges Sicherheits-Token. Bitte Seite neu laden. |
| `login.credentials_required` | Benutzername und Passwort sind erforderlich. |
| `login.invalid_credentials` | Ungültige Anmeldedaten. |

The install banner strings (`ui.install_prompt`, `ui.install`, `ui.close`) are already defined in Task 4.

- [ ] **Step 3: Add new keys to `lang/de.json`**

- [ ] **Step 4: Verify syntax**

Run: `php -l public/login.php`

- [ ] **Step 5: Commit**

```bash
git add public/login.php lang/de.json
git commit -m "feat(i18n): extract login.php strings to translation keys"
```

---

### Task 6: Extract PHP strings — `api.php`

This file has ~50+ error messages. Every `respond()` call gets both `t()` and `error_key`.

**Files:**
- Modify: `public/api.php`
- Modify: `lang/de.json`

- [ ] **Step 1: Add `i18n.php` require to `api.php`**

After the existing `require` statements at the top, add:

```php
require dirname(__DIR__) . '/i18n.php';
```

- [ ] **Step 2: Modify `respond()` function to support `error_key`**

The current `respond()` function at line 51 sends the payload as-is. No change needed to `respond()` itself — the `error_key` is added to each call site.

Pattern change for every error response:

```php
// Before:
respond(422, ['error' => 'Bitte wähle eine Datei aus.']);

// After:
respond(422, ['error' => t('error.file_required'), 'error_key' => 'error.file_required']);
```

- [ ] **Step 3: Replace all error strings with `t()` calls and add `error_key`**

Keys to extract (all error messages from `api.php`):

| Key | German value |
|---|---|
| `error.method_not_allowed` | Nur {method} ist für diese Aktion erlaubt. |
| `error.invalid_csrf` | Ungültiges Sicherheits-Token. |
| `error.file_required` | Bitte wähle eine Datei aus. |
| `error.multiple_files` | Mehrere Dateien pro Request werden nicht unterstützt. |
| `error.invalid_upload` | Ungültiger Upload. |
| `error.image_too_large` | Bilder dürfen maximal {max} groß sein. |
| `error.image_type_invalid` | Nur JPG, PNG, WebP und GIF sind als Bilder erlaubt. |
| `error.image_corrupt` | Die hochgeladene Datei ist kein gültiges Bild. |
| `error.file_too_large` | Dateien dürfen maximal {max} groß sein. |
| `error.url_not_allowed` | URL ist nicht erlaubt. |
| `error.category_not_found` | Kategorie nicht gefunden. |
| `error.invalid_category` | Ungültige Kategorie. |
| `error.category_name_required` | Bitte gib einen Kategorienamen ein. |
| `error.invalid_category_type` | Ungültiger Kategorietyp. |
| `error.no_changes` | Keine Änderungen übergeben. |
| `error.invalid_order` | Ungültige Reihenfolge. |
| `error.order_mismatch_categories` | Reihenfolge passt nicht zu den vorhandenen Kategorien. |
| `error.category_not_empty` | Kategorie kann nur gelöscht werden, wenn sie leer ist. |
| `error.item_name_required` | Bitte gib einen Artikelnamen ein. |
| `error.item_not_found` | Artikel nicht gefunden. |
| `error.invalid_status_params` | Ungültige Parameter für den Statuswechsel. |
| `error.invalid_id` | Ungültige ID. |
| `error.invalid_move` | Ungültige Verschiebe-Anfrage. |
| `error.move_type_mismatch` | Artikel können nur in gleichartige Kategorien verschoben werden. |
| `error.order_mismatch_items` | Reihenfolge passt nicht zur aktuellen Liste. |
| `error.invalid_params` | Ungültige Parameter. |
| `error.invalid_barcode` | Ungültiger Barcode. |
| `error.product_not_found` | Produkt nicht gefunden. |
| `error.invalid_url` | Ungültige URL. |
| `error.url_external_only` | Nur externe HTTP(S)-Links sind erlaubt. |
| `error.unknown_action` | Unbekannte Aktion. |
| `error.server_error` | Serverfehler. |
| `error.curl_init_failed` | cURL konnte nicht initialisiert werden. |
| `error.page_unreachable` | Seite nicht abrufbar. |
| `error.not_html` | Ziel liefert kein HTML. |

Also translate the `uploadedFileErrorMessage()` function's error messages (PHP upload error codes).

- [ ] **Step 4: Add all keys to `lang/de.json`**

- [ ] **Step 5: Verify syntax**

Run: `php -l public/api.php`

- [ ] **Step 6: Commit**

```bash
git add public/api.php lang/de.json
git commit -m "feat(i18n): extract api.php error strings, add error_key to all responses"
```

---

### Task 7: Extract PHP strings — `settings.php` and `SettingsController.php`

**Files:**
- Modify: `public/settings.php`
- Modify: `src/SettingsController.php`
- Modify: `lang/de.json`

- [ ] **Step 1: Add `i18n.php` require to `settings.php`**

After the existing `require` statements, add:

```php
require dirname(__DIR__) . '/i18n.php';
```

Replace `<html lang="de">` with dynamic lang attribute.

- [ ] **Step 2: Replace all hardcoded strings in `settings.php` template**

Keys to extract (sample — full list from settings.php, ~30 strings):

| Key | German value |
|---|---|
| `settings.password_change_required` | Beim ersten Login musst du dein Passwort ändern, bevor du die App weiter nutzen kannst. |
| `settings.appearance` | Erscheinungsbild |
| `settings.appearance_hint` | Änderungen werden sofort auf diesem Gerät übernommen. |
| `settings.theme_auto` | Auto |
| `settings.theme_light` | Hell |
| `settings.theme_dark` | Dunkel |
| `settings.light_theme` | Light Theme |
| `settings.light_theme_hint` | Empfohlen: **Hafenblau** · Warm: **Pergament** |
| `settings.dark_theme` | Dark Theme |
| `settings.dark_theme_hint` | Empfohlen: **Nachtwache** · Editorial: **Pier** |
| `settings.features` | Funktionen |
| `settings.categories` | Kategorien |
| `settings.categories_hint` | Neue Kategorien werden direkt angelegt. Bestehende Kategorien speicherst du pro Zeile. |
| `settings.magic_button` | Magic Button anzeigen |
| `settings.device_setting_hint` | Diese Einstellung gilt nur auf diesem Gerät. |
| `settings.swipe_enabled` | Wischgeste für Kategorien aktivieren |

- [ ] **Step 3: Replace flash messages in `SettingsController.php`**

Add `require_once __DIR__ . '/../i18n.php';` at the top of `SettingsController.php` and replace all hardcoded flash messages with `t()` calls.

- [ ] **Step 4: Add all keys to `lang/de.json`**

- [ ] **Step 5: Verify syntax**

Run:
```bash
php -l public/settings.php
php -l src/SettingsController.php
```

- [ ] **Step 6: Commit**

```bash
git add public/settings.php src/SettingsController.php lang/de.json
git commit -m "feat(i18n): extract settings.php and SettingsController strings"
```

---

### Task 8: Extract PHP strings — `admin.php`

**Files:**
- Modify: `public/admin.php`
- Modify: `lang/de.json`

- [ ] **Step 1: Add `i18n.php` require and dynamic lang**

- [ ] **Step 2: Replace all hardcoded strings (~40 strings)**

Keys to extract (sample):

| Key | German value |
|---|---|
| `admin.title` | Nutzerverwaltung |
| `admin.logout` | Abmelden |
| `admin.upload_limits` | Upload-Grenzen |
| `admin.images` | Bilder |
| `admin.mb_per_image` | MB pro Bild-Upload |
| `admin.files` | Dateien |
| `admin.mb_per_file` | MB pro Datei-Upload |
| `admin.url_import` | URL-Import |
| `admin.mb_per_download` | MB pro serverseitigem Download |
| `admin.upload_limit_notice` | Die tatsächliche Obergrenze kann zusätzlich durch PHP- oder Webserver-Limits begrenzt sein. |
| `admin.save` | Speichern |
| `admin.create_user` | Nutzer anlegen |
| `admin.username_placeholder` | Benutzername |
| `admin.password_placeholder` | Passwort (min. 8 Zeichen) |
| `admin.force_change` | Wechsel erzwingen |
| `admin.create` | Anlegen |
| `admin.users` | Nutzer |
| `admin.no_users` | Noch keine regulären Nutzer vorhanden. |
| `admin.password_change_pending` | Passwortwechsel offen |
| `admin.set_password` | Setzen |
| `admin.release` | Freigeben |
| `admin.delete` | Löschen |
| `admin.product_db` | Produktdatenbank |
| `admin.total` | Gesamt |
| `admin.last_update` | Letztes Update |
| `admin.unknown` | Unbekannt |
| `admin.db_size` | DB-Größe |
| `admin.imported` | Importiert |
| `admin.empty` | Leer |
| `admin.download_import` | Herunterladen & importieren |
| `admin.confirm_clear_db` | Produktdatenbank wirklich leeren? |
| `admin.clear_db` | Produktdatenbank leeren |

Plus all flash/error messages from the POST handling section.

- [ ] **Step 3: Add all keys to `lang/de.json`**

- [ ] **Step 4: Verify syntax**

Run: `php -l public/admin.php`

- [ ] **Step 5: Commit**

```bash
git add public/admin.php lang/de.json
git commit -m "feat(i18n): extract admin.php strings"
```

---

### Task 9: Extract PHP strings — `manifest.php`, `security.php`, remaining PHP files

**Files:**
- Modify: `public/manifest.php`
- Modify: `security.php`
- Modify: `lang/de.json`

- [ ] **Step 1: Update `manifest.php`**

Add require for `i18n.php`. Replace hardcoded values:

```php
// Before:
'name' => 'Ankerkladde',
'short_name' => 'Ankerkladde',
'description' => 'Mobile Kladde für Listen, Notizen, Bilder, Dateien und Links.',
'lang' => 'de',

// After:
'name' => t('app.name'),
'short_name' => t('app.short_name'),
'description' => t('app.description'),
'lang' => getCurrentLanguage(),
```

Keys:

| Key | German value |
|---|---|
| `app.name` | Ankerkladde |
| `app.short_name` | Ankerkladde |
| `app.description` | Mobile Kladde für Listen, Notizen, Bilder, Dateien und Links. |

- [ ] **Step 2: Update `security.php`**

Replace the hardcoded error in `requireAdmin()` (line 333):

```php
// Before:
echo 'Kein Zugriff.';
// After:
echo t('error.access_denied');
```

And the error in `ensureDirectoryExists()` (line 57):

```php
// Before:
throw new RuntimeException(sprintf('Verzeichnis konnte nicht erstellt werden: %s', $path));
// After:
throw new RuntimeException(sprintf('Directory could not be created: %s', $path));
```

Note: Internal exception messages (not shown to users) stay in English — only user-facing strings get translated.

Add `require_once __DIR__ . '/i18n.php';` after the existing constants at the top of `security.php`.

- [ ] **Step 3: Add keys to `lang/de.json`**

- [ ] **Step 4: Verify syntax**

Run:
```bash
php -l public/manifest.php
php -l security.php
```

- [ ] **Step 5: Commit**

```bash
git add public/manifest.php security.php lang/de.json
git commit -m "feat(i18n): extract manifest and security strings"
```

---

### Task 10: Extract JS strings — all 16 frontend modules

**Files:**
- Modify: `public/js/items-view.js`
- Modify: `public/js/lightbox.js`
- Modify: `public/js/item-menu.js`
- Modify: `public/js/items-actions-upload.js`
- Modify: `public/js/app-ui.js`
- Modify: `public/js/app-events-forms.js`
- Modify: `public/js/items-actions-utils.js`
- Modify: `public/js/scanner.js`
- Modify: `public/js/items-actions-add.js`
- Modify: `public/js/settings-forms.js`
- Modify: `public/js/settings-ui.js`
- Modify: `public/js/items-actions-update.js`
- Modify: `public/js/magic.js`
- Modify: `public/js/app-events.js`
- Modify: `public/js/editor.js`
- Modify: `public/js/offline-queue.js`
- Modify: `lang/de.json`

- [ ] **Step 1: Add `import { t } from './i18n.js';` to each of the 16 files**

Each file that contains German strings gets the import added at the top, among the existing imports.

- [ ] **Step 2: Replace all hardcoded German strings with `t()` calls**

Pattern:

```js
// Before:
showMessage('Artikel gelöscht.');
// After:
showMessage(t('msg.item_deleted'));

// Before:
aria-label: 'Schließen'
// After:
aria-label: t('ui.close')
```

Keys to extract from JS files:

| Key | German value | Source file |
|---|---|---|
| `msg.attachment_unavailable` | Anhang nicht verfügbar | items-view.js |
| `msg.no_notes_yet` | Noch keine Notizen. Titel eingeben und + drücken. | items-view.js |
| `msg.list_empty` | Noch nichts auf der Liste. Füge oben etwas hinzu. | items-view.js |
| `msg.no_entries` | Keine Einträge vorhanden. | items-view.js |
| `ui.back` | Zurück | item-menu.js |
| `ui.open_note` | Notiz öffnen | item-menu.js |
| `ui.unpin` | Lösen | item-menu.js |
| `ui.pin` | Anheften | item-menu.js |
| `ui.delete` | Löschen | item-menu.js |
| `error.select_image` | Bitte wähle ein Bild aus. | items-actions-upload.js |
| `error.select_file` | Bitte wähle eine Datei aus. | items-actions-upload.js |
| `error.invalid_url` | Ungültige URL. | items-actions-upload.js |
| `msg.url_loading` | Datei wird von URL geladen... Das kann bei großen Dateien dauern. | items-actions-upload.js |
| `item.no_file_selected` | Keine Datei ausgewählt | app-ui.js |
| `item.choose_image` | Bild wählen | app-ui.js |
| `item.choose_file` | Datei wählen | app-ui.js |
| `item.drop_image` | Bild hierher ziehen oder aus Zwischenablage einfügen | app-ui.js |
| `item.drop_file` | Datei hierher ziehen oder aus Zwischenablage einfügen | app-ui.js |
| `msg.delete_failed` | Löschen fehlgeschlagen. | app-events-forms.js, app-events.js |
| `msg.category_deleted_remote` | Diese Kategorie wurde auf einem anderen Gerät gelöscht. Ich habe die Liste aktualisiert. | items-actions-utils.js |
| `scanner.check_item` | Eintrag abhaken | scanner.js |
| `scanner.add_item` | Artikel hinzufügen | scanner.js |
| `scanner.hint_shopping` | Barcode scannt offene Einträge der aktuellen Liste und hakt sie ab. | scanner.js |
| `scanner.camera_active` | Kamera aktiv. Auf iPad/iPhone erkennt WebKit Barcodes nicht immer zuverlässig... | scanner.js |
| `scanner.shopping_only` | Barcode-Scan ist nur in Einkaufslisten verfügbar. | scanner.js |
| `scanner.disabled` | Die Scanfunktion für die Einkaufsliste ist in den Einstellungen deaktiviert. | scanner.js |
| `scanner.not_during_search` | Scanner ist während Suche oder Notizbearbeitung nicht verfügbar. | scanner.js |
| `scanner.needs_https` | Kamera-Scan braucht HTTPS oder localhost. Manueller Barcode-Eintrag bleibt verfügbar. | scanner.js |
| `scanner.not_supported` | Automatischer Barcode-Scan wird in diesem Browser nicht unterstützt... | scanner.js |
| `msg.item_added` | Artikel hinzugefügt. | items-actions-add.js |
| `msg.theme_saved` | Theme für dieses Gerät gespeichert. | settings-forms.js |
| `msg.setting_saved` | Einstellung für dieses Gerät gespeichert. | settings-forms.js |
| `error.invalid_key` | Ungültiger Key | settings-ui.js |
| `msg.item_deleted` | Artikel gelöscht. | items-actions-update.js |
| `msg.edit_draft_stale` | Der Bearbeitungsentwurf passte nicht mehr zu diesem Eintrag. Bitte erneut öffnen. | items-actions-update.js |
| `msg.speech_not_supported` | Spracherkennung wird von diesem Browser nicht unterstützt. | magic.js |
| `msg.listening` | Höre zu... | magic.js |
| `msg.note_deleted` | Notiz wurde gelöscht | editor.js |
| `error.offline_too_large` | Dieser Eintrag ist zu groß für die Offline-Synchronisation. | offline-queue.js |
| `error.offline_storage_full` | Der Offline-Speicher ist voll. Bitte synchronisiere oder lösche alte Offline-Einträge. | offline-queue.js |

- [ ] **Step 3: Add all JS keys to `lang/de.json`**

- [ ] **Step 4: Verify no syntax errors in the modified JS files**

Run: `node --check public/js/i18n.js` (ESM syntax check for one file — the rest will be verified by loading the app)

- [ ] **Step 5: Commit**

```bash
git add public/js/*.js lang/de.json
git commit -m "feat(i18n): extract all JS module strings to translation keys"
```

---

### Task 11: Complete `lang/de.json` and create `lang/en.json`

**Files:**
- Verify: `lang/de.json` (should be complete after Tasks 4-10)
- Create: `lang/en.json`

- [ ] **Step 1: Verify `lang/de.json` is complete**

Check that all keys from Tasks 4-10 are present. The file should have ~150 keys organized by namespace.

- [ ] **Step 2: Add `category.default.*` keys for category rename feature**

Add to `lang/de.json`:

```json
{
  "category.default.shopping": "Einkauf",
  "category.default.medication": "Medikamente",
  "category.default.todo_private": "To-Do Privat",
  "category.default.todo_work": "To-Do Arbeit",
  "category.default.notes": "Notizen",
  "category.default.images": "Bilder",
  "category.default.files": "Dateien",
  "category.default.links": "Links"
}
```

- [ ] **Step 3: Create `lang/en.json` with all translations**

Translate every key from `de.json` to English. The file must have the exact same keys. Example excerpt:

```json
{
  "app.name": "Ankerkladde",
  "app.short_name": "Ankerkladde",
  "app.description": "Mobile notebook for lists, notes, images, files, and links.",

  "ui.install_prompt": "Install app?",
  "ui.install": "Install",
  "ui.close": "Close",
  "ui.update_available": "New version available.",
  "ui.reload": "Reload",
  "ui.title_list": "Lists",
  "ui.settings": "Settings",
  "ui.search": "Search",
  "ui.back": "Back",
  "ui.delete": "Delete",
  "ui.save": "Save",

  "item.input_placeholder": "Item...",
  "item.add": "Add item",
  "item.quantity": "Quantity",
  "item.clear_done": "Clear completed",

  "error.file_required": "Please select a file.",
  "error.invalid_csrf": "Invalid security token.",
  "error.item_not_found": "Item not found.",
  "error.category_not_found": "Category not found.",

  "msg.item_added": "Item added.",
  "msg.item_deleted": "Item deleted.",
  "msg.delete_failed": "Delete failed.",

  "login.username": "Username",
  "login.password": "Password",
  "login.submit": "Sign in",
  "login.invalid_credentials": "Invalid credentials.",

  "category.default.shopping": "Shopping",
  "category.default.medication": "Medication",
  "category.default.todo_private": "To-Do Personal",
  "category.default.todo_work": "To-Do Work",
  "category.default.notes": "Notes",
  "category.default.images": "Images",
  "category.default.files": "Files",
  "category.default.links": "Links"
}
```

(Full file contains all ~150+ keys — the complete translation.)

- [ ] **Step 4: Validate both JSON files**

Run:
```bash
php -r "json_decode(file_get_contents('lang/de.json'), true, 512, JSON_THROW_ON_ERROR); echo 'de.json OK\n';"
php -r "json_decode(file_get_contents('lang/en.json'), true, 512, JSON_THROW_ON_ERROR); echo 'en.json OK\n';"
```

- [ ] **Step 5: Verify key parity**

Run:
```bash
php -r "\$de = array_keys(json_decode(file_get_contents('lang/de.json'), true)); \$en = array_keys(json_decode(file_get_contents('lang/en.json'), true)); \$missing = array_diff(\$de, \$en); if (\$missing) { echo 'Missing in en.json: ' . implode(', ', \$missing) . PHP_EOL; exit(1); } echo 'All keys present in both files.\n';"
```
Expected: `All keys present in both files.`

- [ ] **Step 6: Commit**

```bash
git add lang/de.json lang/en.json
git commit -m "feat(i18n): complete German strings and add English translations"
```

---

### Task 12: Settings UI — Language dropdown

**Files:**
- Modify: `public/settings.php`
- Modify: `src/SettingsController.php`
- Modify: `lang/de.json`
- Modify: `lang/en.json`

- [ ] **Step 1: Add language dropdown to settings.php**

Add a new section in settings.php (before the appearance section). The dropdown shows available languages:

```php
<details class="settings-group" open>
    <summary><?= t('settings.language') ?></summary>
    <div class="settings-content">
        <form method="post" action="<?= htmlspecialchars(appPath('settings.php' . ($isEmbedded ? '?embed=1&tab=app' : '')), ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_language">
            <label class="settings-label">
                <select name="language" class="settings-select" onchange="this.form.submit()">
                    <?php foreach (getAvailableLanguages() as $langCode): ?>
                        <option value="<?= $langCode ?>" <?= $langCode === getCurrentLanguage() ? 'selected' : '' ?>>
                            <?= t('language.' . $langCode) ?>
                        </option>
                    <?php endforeach; ?>
                </select>
            </label>
        </form>
    </div>
</details>
```

New keys:

| Key | de | en |
|---|---|---|
| `settings.language` | Sprache | Language |
| `language.de` | Deutsch | Deutsch |
| `language.en` | English | English |

- [ ] **Step 2: Handle `save_language` action in `SettingsController.php`**

Add a new case in the POST handler:

```php
case 'save_language':
    $newLang = $_POST['language'] ?? '';
    if (!in_array($newLang, getAvailableLanguages(), true)) {
        return ['flash' => t('error.invalid_params'), 'flashType' => 'err', 'aiKeyStatus' => null, 'aiKeyStatusType' => 'ok'];
    }
    $oldLang = getCurrentLanguage();
    $stmt = $this->db->prepare('UPDATE users SET language = :lang WHERE id = :id');
    $stmt->execute([':lang' => $newLang, ':id' => $this->userId]);
    
    // Check if category rename dialog should show
    if ($oldLang !== $newLang) {
        $_SESSION['i18n_rename_from'] = $oldLang;
        $_SESSION['i18n_rename_to'] = $newLang;
    }
    
    return ['flash' => t('settings.language_saved'), 'flashType' => 'ok', 'aiKeyStatus' => null, 'aiKeyStatusType' => 'ok'];
```

New key:

| Key | de | en |
|---|---|---|
| `settings.language_saved` | Sprache geändert. | Language changed. |

- [ ] **Step 3: Verify syntax**

Run:
```bash
php -l public/settings.php
php -l src/SettingsController.php
```

- [ ] **Step 4: Commit**

```bash
git add public/settings.php src/SettingsController.php lang/de.json lang/en.json
git commit -m "feat(i18n): add language dropdown to settings"
```

---

### Task 13: Category rename dialog after language switch

**Files:**
- Modify: `public/settings.php`
- Modify: `lang/de.json`
- Modify: `lang/en.json`

- [ ] **Step 1: Add rename dialog to settings.php**

After the flash message section, check for the session flag and render the dialog:

```php
<?php
$renameFrom = $_SESSION['i18n_rename_from'] ?? null;
$renameTo = $_SESSION['i18n_rename_to'] ?? null;
unset($_SESSION['i18n_rename_from'], $_SESSION['i18n_rename_to']);

if ($renameFrom !== null && $renameTo !== null):
    $oldStrings = loadStrings($renameFrom);
    $newStrings = loadStrings($renameTo);
    $categories = getCategoriesForUser($db, $userId);
    $renameSuggestions = [];

    // Find categories whose names match a default name in the old language
    $defaultKeys = array_filter(array_keys($oldStrings), fn($k) => str_starts_with($k, 'category.default.'));
    foreach ($categories as $cat) {
        foreach ($defaultKeys as $key) {
            if ($cat['name'] === $oldStrings[$key] && isset($newStrings[$key]) && $newStrings[$key] !== $oldStrings[$key]) {
                $renameSuggestions[] = [
                    'id' => $cat['id'],
                    'old_name' => $cat['name'],
                    'new_name' => $newStrings[$key],
                ];
                break;
            }
        }
    }

    if (!empty($renameSuggestions)):
?>
<div class="rename-dialog card">
    <h3><?= t('settings.rename_categories_title') ?></h3>
    <form method="post" action="<?= htmlspecialchars(appPath('settings.php' . ($isEmbedded ? '?embed=1&tab=app' : '')), ENT_QUOTES, 'UTF-8') ?>">
        <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
        <input type="hidden" name="action" value="rename_categories">
        <?php foreach ($renameSuggestions as $suggestion): ?>
        <label class="rename-row">
            <input type="checkbox" name="rename[<?= $suggestion['id'] ?>]" value="<?= htmlspecialchars($suggestion['new_name'], ENT_QUOTES, 'UTF-8') ?>" checked>
            <span class="rename-old"><?= htmlspecialchars($suggestion['old_name'], ENT_QUOTES, 'UTF-8') ?></span>
            <span class="rename-arrow">→</span>
            <span class="rename-new"><?= htmlspecialchars($suggestion['new_name'], ENT_QUOTES, 'UTF-8') ?></span>
        </label>
        <?php endforeach; ?>
        <button type="submit" class="btn"><?= t('settings.rename_categories_submit') ?></button>
    </form>
</div>
<?php
    endif;
endif;
?>
```

New keys:

| Key | de | en |
|---|---|---|
| `settings.rename_categories_title` | Möchtest du die Standard-Kategorien umbenennen? | Rename default categories? |
| `settings.rename_categories_submit` | Umbenennen | Rename |

- [ ] **Step 2: Handle `rename_categories` action in `SettingsController.php`**

```php
case 'rename_categories':
    $renames = $_POST['rename'] ?? [];
    if (!is_array($renames)) {
        return ['flash' => t('error.invalid_params'), 'flashType' => 'err', 'aiKeyStatus' => null, 'aiKeyStatusType' => 'ok'];
    }
    $stmt = $this->db->prepare('UPDATE categories SET name = :name WHERE id = :id AND user_id = :uid');
    $count = 0;
    foreach ($renames as $catId => $newName) {
        $stmt->execute([':name' => $newName, ':id' => (int) $catId, ':uid' => $this->userId]);
        $count += $stmt->rowCount();
    }
    return [
        'flash' => t('settings.categories_renamed', ['count' => (string) $count]),
        'flashType' => 'ok',
        'aiKeyStatus' => null,
        'aiKeyStatusType' => 'ok',
    ];
```

New key:

| Key | de | en |
|---|---|---|
| `settings.categories_renamed` | {count} Kategorien umbenannt. | {count} categories renamed. |

- [ ] **Step 3: Verify syntax**

Run:
```bash
php -l public/settings.php
php -l src/SettingsController.php
```

- [ ] **Step 4: Commit**

```bash
git add public/settings.php src/SettingsController.php lang/de.json lang/en.json
git commit -m "feat(i18n): add category rename dialog after language switch"
```

---

### Task 14: Update `magic.js` speech recognition language

**Files:**
- Modify: `public/js/magic.js`

- [ ] **Step 1: Change hardcoded `de-DE` to dynamic language**

The speech recognition language should come from `window.__lang`:

```js
// Before:
recognition.lang = 'de-DE';

// After:
const langMap = { de: 'de-DE', en: 'en-US' };
recognition.lang = langMap[window.__lang] || 'de-DE';
```

- [ ] **Step 2: Commit**

```bash
git add public/js/magic.js
git commit -m "feat(i18n): make speech recognition language dynamic"
```

---

### Task 15: Update smoke tests

**Files:**
- Modify: `scripts/smoke-test.sh`

- [ ] **Step 1: Update string assertions**

The smoke test checks for specific German strings in HTTP responses. Since the test environment has no user language set and the ENV default is `de`, all responses will still be German. However, some strings have changed from literal text to `t()` output.

The test assertions that check for specific German text in responses should still work as-is, because `t()` returns the German text by default. Verify this by running:

Run: `bash scripts/smoke-test.sh`
Expected: All tests pass.

- [ ] **Step 2: If any assertions fail, update them**

If a string changed slightly during extraction (e.g., punctuation), update the grep pattern in the smoke test to match the new string from `lang/de.json`.

- [ ] **Step 3: Add a basic language switching test (optional but recommended)**

Add a test that sets a user's language to `en` and verifies the API returns English error messages:

```bash
echo "=== i18n: English error message ==="
# Set user language to English
LANG_BODY=$(curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -d "action=save_language&language=en" \
    "http://127.0.0.1:$PORT/settings.php")

# Verify an error message comes back in English
EN_ERROR_BODY=$(curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -X POST \
    "http://127.0.0.1:$PORT/api.php?action=nonexistent" 2>/dev/null || true)
echo "$EN_ERROR_BODY" | grep -q 'Unknown action' || die "English error message not returned"

# Reset language back to German
curl -fsS -b "$COOKIE_JAR" -c "$COOKIE_JAR" \
    -H "X-CSRF-Token: $CSRF_TOKEN" \
    -d "action=save_language&language=de" \
    "http://127.0.0.1:$PORT/settings.php" >/dev/null
echo "OK"
```

- [ ] **Step 4: Run full smoke test**

Run: `bash scripts/smoke-test.sh`
Expected: All tests pass, including the new i18n test.

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-test.sh
git commit -m "test(i18n): update smoke tests for internationalization"
```

---

### Task 16: Version bump, final verification, and push

**Files:**
- Modify: `public/version.php`

- [ ] **Step 1: Bump version**

Update the version string in `public/version.php` to the next patch version.

- [ ] **Step 2: Run full test suite**

```bash
php -l i18n.php
php -l public/index.php
php -l public/login.php
php -l public/api.php
php -l public/settings.php
php -l public/admin.php
php -l public/manifest.php
php -l security.php
php -l src/SettingsController.php
bash scripts/smoke-test.sh
bash scripts/test-db-migration.sh
php scripts/test-security.php
```

All must pass.

- [ ] **Step 3: Validate JSON files**

```bash
php -r "json_decode(file_get_contents('lang/de.json'), true, 512, JSON_THROW_ON_ERROR); echo \"de.json OK\n\";"
php -r "json_decode(file_get_contents('lang/en.json'), true, 512, JSON_THROW_ON_ERROR); echo \"en.json OK\n\";"
php -r "\$de = array_keys(json_decode(file_get_contents('lang/de.json'), true)); \$en = array_keys(json_decode(file_get_contents('lang/en.json'), true)); \$d = array_diff(\$de, \$en); if (\$d) { echo 'MISSING: ' . implode(', ', \$d) . PHP_EOL; exit(1); } echo \"Key parity OK\n\";"
```

- [ ] **Step 4: Commit version bump**

```bash
git add public/version.php
git commit -m "chore: bump version for i18n release"
```

- [ ] **Step 5: Push**

```bash
git push origin main
```
