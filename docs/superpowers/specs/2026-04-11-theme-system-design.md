# Theme-System für Ankerkladde

**Datum:** 2026-04-11
**Status:** Approved

## Überblick

Ankerkladde bekommt ein Theme-System mit 4 auswählbaren Themes. Der Wechsel erfolgt in den Einstellungen. Das aktive Theme wird server-seitig in den User-Preferences gespeichert und beim Seitenrendering ohne Flash angewendet.

## Themes

| Name | `data-theme` | Stil |
|---|---|---|
| Parchment | `parchment` | Warm beige, aktueller Look — wird Default |
| Hafenblau | `hafenblau` | Helles Blau, maritim, frisch |
| Nachtwache | `nachtwache` | Dunkles Nachtblau, dunkle Variante von Hafenblau |
| Pier bei Nacht | `pier` | Fast schwarz mit warmem Messinggold, Serif |

## Architektur

### CSS (`public/style.css`)

Jedes Theme ist ein `[data-theme="X"]`-Block der die bestehenden CSS-Custom-Properties überschreibt:

```css
[data-theme="hafenblau"] {
    --bg:              #dce8f0;
    --surface:         #eaf3f8;
    --border:          #b8d0e0;
    --text-primary:    #0d3a5c;
    --text-secondary:  #3a7090;
    --text-muted:      #7aaac0;
    --accent:          #1a6090;
    --done-bg:         #e0edf5;
    --error:           #c0392b;
    --font-family:     system-ui, -apple-system, sans-serif;
}
/* analog für nachtwache, pier */
```

Zwei neue Variablen werden eingeführt:
- `--font-family` — ermöglicht Serif-Font für "Pier bei Nacht" und "Seekarte"
- `--theme-color` — für den dynamischen `theme-color` Meta-Tag

Der bestehende `body`-Block bekommt `font-family: var(--font-family)`.

### Datenspeicherung (`db.php`)

Neues Feld `theme` in `preferences_json`:

- `getDefaultUserPreferences()`: `'theme' => 'parchment'`
- `normalizeUserPreferences()`: Validierung auf `['parchment', 'hafenblau', 'nachtwache', 'pier']`, Fallback `parchment`

### Seitenrendering (kein FOUC)

PHP setzt `data-theme` direkt beim Rendern auf `<body>`:

```php
<body data-theme="<?= htmlspecialchars($userPreferences['theme']) ?>">
```

Der `theme-color` Meta-Tag wird dynamisch aus einem PHP-Array befüllt:

```php
<?php
$themeColors = [
    'parchment'  => '#f5f0eb',
    'hafenblau'  => '#cfe0ec',
    'nachtwache' => '#162338',
    'pier'       => '#0f1419',
];
$themeColor = $themeColors[$userPreferences['theme']] ?? '#f5f0eb';
?>
<meta name="theme-color" content="<?= $themeColor ?>">
```

Betrifft: `public/index.php`, `public/settings.php`, `public/login.php`, `public/admin.php`.

`public/offline.html` bekommt den Parchment-Wert hardcoded (kein PHP, kein Auth).

`public/manifest.php` und `public/manifest.json`: `manifest.php` wird dynamisch, `manifest.json` bleibt auf Parchment als Fallback.

### Settings-UI (`public/settings.php`)

Neuer Abschnitt "Erscheinungsbild" (vor oder nach bestehenden Einstellungen) mit einer kompakten Liste:

```html
<form method="POST">
  <input type="hidden" name="action" value="theme">
  <!-- je Theme: -->
  <label>
    <span class="theme-dot" style="background: #c8b89a"></span>
    Parchment
    <input type="radio" name="theme" value="parchment" <?= checked ?>>
  </label>
  <!-- ... -->
  <button type="submit">Speichern</button>
</form>
```

Form-Submit → `POST action=theme` → `updateUserPreferences($db, $userId, ['theme' => $validated])` → Redirect (wie alle anderen Settings-Aktionen).

### API (`public/api.php`)

Das `preferences`-Endpoint verarbeitet bereits beliebige Felder via `updateUserPreferences()`. Es muss nur sichergestellt werden, dass `theme` in `normalizeUserPreferences()` validiert wird — dann funktioniert das Speichern automatisch.

### `app.js`

Keine Änderungen. Das Theme ist eine rein server-seitige/CSS-Angelegenheit.

## Dateien die geändert werden

| Datei | Änderung |
|---|---|
| `public/style.css` | 3 neue `[data-theme]`-Blöcke + `--font-family`/`--theme-color` Var, `body` font-family anpassen |
| `db.php` | `theme`-Feld in Default + Normalisierung |
| `public/index.php` | `data-theme` auf `<body>`, dynamischer `theme-color` Meta-Tag |
| `public/settings.php` | Abschnitt "Erscheinungsbild", POST-Handler für `action=theme` |
| `public/login.php` | dynamischer `theme-color` Meta-Tag (kein Auth → Parchment als Default) |
| `public/admin.php` | `data-theme` auf `<body>`, dynamischer `theme-color` Meta-Tag |
| `public/offline.html` | kein PHP → Parchment hardcoded, keine Änderung nötig |
| `public/manifest.php` | dynamischer `theme_color` aus Preferences |

## Out of Scope

- Kein automatischer System-Dark-Mode (`prefers-color-scheme`) — Theme ist explizite Nutzerwahl
- Kein Theme-Wechsel ohne Seitenreload
- Keine Theme-Vorschau in Echtzeit in den Settings
