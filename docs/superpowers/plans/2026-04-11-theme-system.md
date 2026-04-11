# Theme-System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Vier wählbare Themes (Parchment, Hafenblau, Nachtwache, Pier bei Nacht) via `data-theme`-Attribut auf `<body>`, gespeichert in User-Preferences, auswählbar in den Einstellungen.

**Architecture:** CSS-Custom-Properties in `:root` bleiben als Parchment-Default. Drei neue `[data-theme="X"]`-Blöcke in `style.css` überschreiben sie. PHP setzt `data-theme` beim Rendern direkt auf `<body>` — kein FOUC. Das Theme wird in `preferences_json` gespeichert (neben `mode`, `tabs_hidden` etc.).

**Tech Stack:** PHP 8.1+, Vanilla CSS Custom Properties, SQLite via PDO, kein Build-Tool.

---

## Datei-Übersicht

| Datei | Was ändert sich |
|---|---|
| `public/style.css` | `--font-family` in `:root`, `body` font-family via var, 3 `[data-theme]`-Blöcke, CSS für Settings-UI |
| `db.php` | `theme` in `getDefaultUserPreferences()` + `normalizeUserPreferences()` |
| `public/settings.php` | POST-Handler `action=theme`, neuer HTML-Abschnitt "Erscheinungsbild" |
| `public/index.php` | `data-theme` auf `<body>`, dynamischer `theme-color` Meta-Tag |
| `public/admin.php` | `getUserPreferences` laden, `data-theme` auf `<body>`, dynamischer Meta-Tag |
| `public/login.php` | `theme-color` Meta-Tag auf Parchment-Default (kein Auth, bleibt hardcoded) |
| `public/manifest.php` | `theme_color` und `background_color` dynamisch aus User-Preferences |

---

## Task 1: CSS — Theme-Variablen und -Blöcke

**Files:**
- Modify: `public/style.css:1-30`

- [ ] **Step 1: `--font-family` zu `:root` hinzufügen**

In `public/style.css` den `:root`-Block (Zeile 4–15) um `--font-family` erweitern:

```css
:root {
    --bg:               #f5f0eb;
    --surface:          #fffdf9;
    --border:           #e8e0d5;
    --text-primary:     #2c2416;
    --text-primary-dark: #3d3024;
    --text-secondary:   #7a6350;
    --text-muted:       #b0a090;
    --accent:           #c8b89a;
    --done-bg:          #f0ebe4;
    --error:            #a05030;
    --font-family:      system-ui, -apple-system, sans-serif;
}
```

- [ ] **Step 2: `body` font-family auf Variable umstellen**

In `public/style.css` den `body`-Block (Zeile 23–30) ändern:

```css
body {
    background: var(--bg);
    color: var(--text-primary);
    font-family: var(--font-family);
    font-size: 16px;
    line-height: 1.4;
    -webkit-tap-highlight-color: transparent;
}
```

- [ ] **Step 3: Drei Theme-Blöcke direkt nach `:root` einfügen**

Nach dem `:root`-Block (nach Zeile 15, vor dem `/* RESET & BASE */`-Kommentar) einfügen:

```css
[data-theme="hafenblau"] {
    --bg:                #dce8f0;
    --surface:           #eaf3f8;
    --border:            #b8d0e0;
    --text-primary:      #0d3a5c;
    --text-primary-dark: #0a2e48;
    --text-secondary:    #3a7090;
    --text-muted:        #7aaac0;
    --accent:            #1a6090;
    --done-bg:           #d0e5f0;
    --error:             #c0392b;
    --font-family:       system-ui, -apple-system, sans-serif;
}

[data-theme="nachtwache"] {
    --bg:                #111c2d;
    --surface:           #162338;
    --border:            #1e3550;
    --text-primary:      #cce4f4;
    --text-primary-dark: #e0f0ff;
    --text-secondary:    #4a80a8;
    --text-muted:        #2d5070;
    --accent:            #1a6090;
    --done-bg:           #0d1828;
    --error:             #e05050;
    --font-family:       system-ui, -apple-system, sans-serif;
}

[data-theme="pier"] {
    --bg:                #0f1419;
    --surface:           #181410;
    --border:            #2a2210;
    --text-primary:      #e8d8a8;
    --text-primary-dark: #f0e8c0;
    --text-secondary:    #7a6a3a;
    --text-muted:        #4a3a20;
    --accent:            #c8a84c;
    --done-bg:           #0a0e12;
    --error:             #d05040;
    --font-family:       Georgia, 'Times New Roman', serif;
}
```

- [ ] **Step 4: CSS für die Settings-Theme-Liste ans Ende von `style.css` anhängen**

```css
/* ===========================================
   THEME SELECTOR (settings)
   =========================================== */
.theme-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
}

.theme-list label {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
    transition: background 0.12s ease;
}

.theme-list label:hover { background: rgba(0,0,0,0.04); }

.theme-dot {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    border: 1.5px solid rgba(0,0,0,0.12);
    flex-shrink: 0;
}

.theme-list input[type="radio"] {
    margin-left: auto;
    width: 18px;
    height: 18px;
    accent-color: var(--accent);
    cursor: pointer;
}
```

- [ ] **Step 5: Visuell prüfen**

Dev-Server starten:
```bash
php -S 127.0.0.1:8000 -t public
```

Im Browser `http://127.0.0.1:8000` öffnen. Manuell `data-theme="hafenblau"` auf `<body>` im DevTools setzen — App muss blau werden. `data-theme="nachtwache"` → dunkelblau. `data-theme="pier"` → schwarz/gold mit Serif.

- [ ] **Step 6: Commit**

```bash
git add public/style.css
git commit -m "feat: add theme CSS variables and [data-theme] blocks"
```

---

## Task 2: Preferences — Theme in DB-Schicht verankern

**Files:**
- Modify: `db.php:361-399`

- [ ] **Step 1: `theme` in `getDefaultUserPreferences()` eintragen**

In `db.php`, Funktion `getDefaultUserPreferences()` (Zeile 361–370):

```php
function getDefaultUserPreferences(): array
{
    return [
        'mode' => 'liste',
        'tabs_hidden' => false,
        'category_swipe_enabled' => true,
        'last_category_id' => null,
        'install_banner_dismissed' => false,
        'theme' => 'parchment',
    ];
}
```

- [ ] **Step 2: `theme` in `normalizeUserPreferences()` validieren**

In `db.php`, Funktion `normalizeUserPreferences()` (Zeile 372–399), vor dem `return $normalized;` einfügen:

```php
    $validThemes = ['parchment', 'hafenblau', 'nachtwache', 'pier'];
    if (isset($preferences['theme']) && in_array($preferences['theme'], $validThemes, true)) {
        $normalized['theme'] = $preferences['theme'];
    }
```

- [ ] **Step 3: Prüfen dass `normalizeUserPreferences` das theme-Feld korrekt durchreicht**

Kurz manuell verifizieren: PHP-Script im Terminal:
```bash
php -r "
require 'db.php';
\$result = normalizeUserPreferences(['theme' => 'hafenblau']);
var_dump(\$result['theme']);  // string(9) \"hafenblau\"
\$invalid = normalizeUserPreferences(['theme' => 'invalid']);
var_dump(\$invalid['theme']); // string(9) \"parchment\"
"
```

Erwartete Ausgabe:
```
string(9) "hafenblau"
string(9) "parchment"
```

- [ ] **Step 4: Commit**

```bash
git add db.php
git commit -m "feat: add theme preference to user preferences"
```

---

## Task 3: Settings — POST-Handler und Theme-UI

**Files:**
- Modify: `public/settings.php:90-248` (POST-Handler-Block), `public/settings.php:256+` (HTML)

- [ ] **Step 1: POST-Handler für `action=theme` in `settings.php` einfügen**

In `public/settings.php`, direkt vor der Zeile `} elseif ($action === 'save_app_preferences') {` (Zeile 242), folgenden Block einfügen:

```php
        } elseif ($action === 'save_theme') {
            $validThemes = ['parchment', 'hafenblau', 'nachtwache', 'pier'];
            $newTheme = (string) ($_POST['theme'] ?? 'parchment');
            if (!in_array($newTheme, $validThemes, true)) {
                $newTheme = 'parchment';
            }
            updateUserPreferences($db, $userId, ['theme' => $newTheme]);
            $flash = 'Theme gespeichert.';
```

- [ ] **Step 2: HTML-Abschnitt "Erscheinungsbild" in `settings.php` einfügen**

In `public/settings.php`, den bestehenden `save_app_preferences`-Abschnitt suchen. Direkt **davor** (vor dessen `<section>`-Tag) den neuen Abschnitt einfügen.

Zuerst die Stelle finden:
```bash
grep -n "save_app_preferences\|Anzeige" public/settings.php | head -10
```

Dann den neuen Abschnitt einfügen, direkt vor dem bestehenden `<section>` mit `save_app_preferences`:

```php
    <section class="settings-section">
        <form method="post" action="<?= htmlspecialchars(appPath('settings.php'), ENT_QUOTES, 'UTF-8') ?>" class="settings-form">
            <input type="hidden" name="csrf_token" value="<?= htmlspecialchars($csrfToken, ENT_QUOTES, 'UTF-8') ?>">
            <input type="hidden" name="action" value="save_theme">
            <div class="settings-block">
                <h2>Erscheinungsbild</h2>
                <div class="theme-list">
                    <label>
                        <span class="theme-dot" style="background:#c8b89a;"></span>
                        Parchment
                        <input type="radio" name="theme" value="parchment" <?= $preferences['theme'] === 'parchment' ? 'checked' : '' ?>>
                    </label>
                    <label>
                        <span class="theme-dot" style="background:#1a6090;"></span>
                        Hafenblau
                        <input type="radio" name="theme" value="hafenblau" <?= $preferences['theme'] === 'hafenblau' ? 'checked' : '' ?>>
                    </label>
                    <label>
                        <span class="theme-dot" style="background:#162338; border-color:rgba(255,255,255,0.15);"></span>
                        Nachtwache
                        <input type="radio" name="theme" value="nachtwache" <?= $preferences['theme'] === 'nachtwache' ? 'checked' : '' ?>>
                    </label>
                    <label>
                        <span class="theme-dot" style="background:#0f1419; border-color:rgba(255,255,255,0.15);"></span>
                        Pier bei Nacht
                        <input type="radio" name="theme" value="pier" <?= $preferences['theme'] === 'pier' ? 'checked' : '' ?>>
                    </label>
                </div>
            </div>
            <div class="settings-actions">
                <button type="submit" class="settings-save">Speichern</button>
            </div>
        </form>
    </section>
```

- [ ] **Step 3: Im Browser testen**

`http://127.0.0.1:8000/settings.php` aufrufen. Abschnitt "Erscheinungsbild" muss sichtbar sein mit 4 Radio-Buttons. "Hafenblau" auswählen, "Speichern" klicken → Flash "Theme gespeichert." erscheint, Radio-Button bleibt auf Hafenblau.

- [ ] **Step 4: Commit**

```bash
git add public/settings.php
git commit -m "feat: add theme selector to settings page"
```

---

## Task 4: index.php — `data-theme` auf Body + dynamischer Meta-Tag

**Files:**
- Modify: `public/index.php:47`, `public/index.php:58`

- [ ] **Step 1: `theme-color` Meta-Tag dynamisch machen**

In `public/index.php`, Zeile 47, ersetzen:

```php
    <meta name="theme-color" content="#f5f0eb">
```

durch:

```php
<?php
$themeColors = [
    'parchment'  => '#f5f0eb',
    'hafenblau'  => '#cfe0ec',
    'nachtwache' => '#162338',
    'pier'       => '#0f1419',
];
$themeColor = $themeColors[$userPreferences['theme'] ?? 'parchment'] ?? '#f5f0eb';
?>
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
```

- [ ] **Step 2: `data-theme` auf `<body>` setzen**

In `public/index.php`, Zeile 58, ersetzen:

```php
<body>
```

durch:

```php
<body data-theme="<?= htmlspecialchars($userPreferences['theme'] ?? 'parchment', ENT_QUOTES, 'UTF-8') ?>">
```

- [ ] **Step 3: Im Browser testen**

Dev-Server läuft. Als Nutzer mit Theme "hafenblau" einloggen (vorher in Settings gesetzt). `http://127.0.0.1:8000` öffnen → App muss sofort blau erscheinen, kein weißer Blitz. DevTools → Elements → `<body data-theme="hafenblau">` muss sichtbar sein.

- [ ] **Step 4: Commit**

```bash
git add public/index.php
git commit -m "feat: apply theme on body and dynamic theme-color in index.php"
```

---

## Task 5: settings.php + admin.php — `data-theme` und Meta-Tag

**Files:**
- Modify: `public/settings.php:262`, `public/settings.php:266`
- Modify: `public/admin.php:8-11`, `public/admin.php:170`, `public/admin.php:174`

- [ ] **Step 1: `theme-color` und `data-theme` in `settings.php`**

In `public/settings.php`, Zeile 262, ersetzen:

```php
    <meta name="theme-color" content="#f5f0eb">
```

durch:

```php
<?php
$themeColors = [
    'parchment'  => '#f5f0eb',
    'hafenblau'  => '#cfe0ec',
    'nachtwache' => '#162338',
    'pier'       => '#0f1419',
];
$themeColor = $themeColors[$preferences['theme'] ?? 'parchment'] ?? '#f5f0eb';
?>
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
```

In `public/settings.php`, Zeile 266, ersetzen:

```php
<body class="settings-page">
```

durch:

```php
<body class="settings-page" data-theme="<?= htmlspecialchars($preferences['theme'] ?? 'parchment', ENT_QUOTES, 'UTF-8') ?>">
```

- [ ] **Step 2: `data-theme` und Meta-Tag in `admin.php`**

In `public/admin.php`, nach Zeile 11 (`$db = getDatabase();`) einfügen:

```php
$adminPreferences = getUserPreferences($db, $currentUserId);
```

Dann Zeile 170 ersetzen:

```php
    <meta name="theme-color" content="#f5f0eb">
```

durch:

```php
<?php
$themeColors = [
    'parchment'  => '#f5f0eb',
    'hafenblau'  => '#cfe0ec',
    'nachtwache' => '#162338',
    'pier'       => '#0f1419',
];
$themeColor = $themeColors[$adminPreferences['theme'] ?? 'parchment'] ?? '#f5f0eb';
?>
    <meta name="theme-color" content="<?= htmlspecialchars($themeColor, ENT_QUOTES, 'UTF-8') ?>">
```

Dann Zeile 174 ersetzen:

```php
<body>
```

durch:

```php
<body data-theme="<?= htmlspecialchars($adminPreferences['theme'] ?? 'parchment', ENT_QUOTES, 'UTF-8') ?>">
```

- [ ] **Step 3: Settings-Seite im Browser prüfen**

`http://127.0.0.1:8000/settings.php` mit Theme "pier" aufrufen → Settings-Seite muss dunkel/golden sein, nicht Parchment.

- [ ] **Step 4: Commit**

```bash
git add public/settings.php public/admin.php
git commit -m "feat: apply theme in settings.php and admin.php"
```

---

## Task 6: manifest.php — dynamischer `theme_color`

**Files:**
- Modify: `public/manifest.php`

- [ ] **Step 1: User-Preferences in manifest.php laden**

`manifest.php` läuft ohne Auth-Check — es gibt keinen eingeloggten Nutzer. Das Manifest wird vom Browser einmalig gecacht. Der `theme_color` im Manifest ist für den Splash-Screen beim Installieren relevant, nicht für die laufende App.

Ansatz: Parchment als festen Default im Manifest belassen. Der `theme-color` Meta-Tag in den PHP-Seiten ist für den Browser-Chrome zuständig und wird bereits in Tasks 4+5 dynamisch gesetzt.

In `public/manifest.php` sind **keine Änderungen nötig** — `#f5f0eb` bleibt als Manifest-Default.

- [ ] **Step 2: Rauchtest**

```bash
bash scripts/smoke-test.sh
```

Erwartete Ausgabe: alle Tests grün, keine Fehler.

- [ ] **Step 3: Commit (nur wenn smoke-test.sh Änderungen entdeckt hat)**

Falls doch eine Anpassung nötig war:
```bash
git add public/manifest.php
git commit -m "chore: update manifest theme_color handling"
```

---

## Task 7: Abschluss — Smoke-Test und Deploy

- [ ] **Step 1: Vollständigen Smoke-Test ausführen**

```bash
bash scripts/smoke-test.sh
```

Alle Tests müssen grün durchlaufen.

- [ ] **Step 2: DB-Migrations-Test ausführen**

```bash
bash scripts/test-db-migration.sh
```

Erwartet: kein Fehler.

- [ ] **Step 3: Manueller End-to-End-Test**

1. Login → `http://127.0.0.1:8000`
2. Einstellungen öffnen → "Erscheinungsbild" Abschnitt sichtbar
3. "Hafenblau" wählen → Speichern → Flash "Theme gespeichert."
4. Zurück zur App → App ist blau, kein weißer Blitz
5. Seite neu laden → Theme bleibt blau
6. "Pier bei Nacht" wählen → App ist dunkel/golden, Schrift ist Serif
7. "Nachtwache" → App ist dunkelblau
8. "Parchment" → zurück zum Original

- [ ] **Step 4: Deploy**

```bash
ssh ansible@web "sudo /var/www/projects/ankerkladde/deploy.sh"
```
