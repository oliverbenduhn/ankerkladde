# Internationalisierung (i18n) — Design Spec

## Ziel

Ankerkladde internationalisieren, beginnend mit Englisch als zweiter Sprache. Die App ist aktuell vollständig deutsch mit ~150 hardcoded Strings in ~31 Dateien. Es gibt keinen bestehenden i18n-Mechanismus.

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Sprachwahl-Modell | Pro User (DB) + Instanz-Default (ENV) + Fallback Deutsch |
| Sprachdatei-Format | JSON (`lang/de.json`, `lang/en.json`) |
| Key-Stil | Beschreibende Dot-Notation (`ui.save`, `error.file_too_large`) |
| Strings ins Frontend | PHP rendert `window.__i18n` inline im HTML |
| HTML/Manifest/Spracherkennung | Dynamisch aus `getCurrentLanguage()` |
| Kategorienamen | Dialog beim Sprachwechsel bietet Umbenennung der Standard-Kategorien an |
| API Error-Responses | Übersetzter Text + stabiler `error_key` |

## 1. Sprachdateien

```
lang/
  de.json    — Deutsche Strings (Referenz)
  en.json    — Englische Übersetzung
```

Flache JSON-Struktur mit Namespaces:

```json
{
  "ui.save": "Speichern",
  "ui.delete": "Löschen",
  "item.add_placeholder": "Artikel hinzufügen…",
  "error.file_too_large": "Datei ist zu groß (max. {max})",
  "category.delete_confirm": "Kategorie \"{name}\" wirklich löschen?",
  "category.type.notes": "Notizen",
  "category.default.shopping": "Einkauf"
}
```

- **Platzhalter:** `{name}`-Syntax, aufgelöst per String-Replace
- **Fallback-Kette:** User-Sprache → Instanz-Default → Deutsch

## 2. Übersetzungsfunktion `t()`

### PHP (`i18n.php`)

```php
function t(string $key, array $params = []): string {
    static $strings = null;
    if ($strings === null) {
        $lang = getCurrentLanguage();
        $file = __DIR__ . "/lang/{$lang}.json";
        $fallback = __DIR__ . '/lang/de.json';
        $strings = json_decode(file_get_contents($file), true)
                 + json_decode(file_get_contents($fallback), true);
    }
    $text = $strings[$key] ?? $key;
    foreach ($params as $k => $v) {
        $text = str_replace("{{$k}}", $v, $text);
    }
    return $text;
}
```

- Einmal pro Request geladen (static cache)
- Fallback: fehlender Key in gewählter Sprache → deutscher Wert → Key selbst
- `getAllStrings()` — gibt das gesamte gemergte String-Array zurück (für `window.__i18n` Rendering)

### JS (`public/js/i18n.js`)

```js
const strings = window.__i18n || {};

export function t(key, params = {}) {
    let text = strings[key] ?? key;
    for (const [k, v] of Object.entries(params)) {
        text = text.replaceAll(`{${k}}`, v);
    }
    return text;
}
```

- Liest aus `window.__i18n`, das von PHP inline gerendert wird
- Alle JS-Module importieren `t` aus `i18n.js`

## 3. Spracheinstellung & Speicherung

### Datenbank

Neue Spalte (additive Migration):
- `users.language` — `TEXT DEFAULT NULL` — User-Override, `NULL` = Instanz-Default

### Instanz-Default

ENV-Variable `ANKERKLADDE_DEFAULT_LANGUAGE`, fehlt = `'de'`.

### `getCurrentLanguage()`

Auflösungsreihenfolge:
```
users.language (DB) → ANKERKLADDE_DEFAULT_LANGUAGE (ENV) → 'de'
```

## 4. HTML-Shell & Manifest

### `index.php`

- `<html lang="<?= getCurrentLanguage() ?>">`
- Alle statischen Labels, Platzhalter, Aria-Attribute → `t()`-Aufrufe
- Inline-Script-Block:
  ```php
  <script>
  window.__i18n = <?= json_encode(getAllStrings(), JSON_UNESCAPED_UNICODE) ?>;
  window.__lang = <?= json_encode(getCurrentLanguage()) ?>;
  </script>
  ```

### Weitere PHP-Seiten

`login.php`, `settings.php`, `admin.php` — `i18n.php` einbinden, Strings durch `t()` ersetzen.

### `manifest.php`

`"lang"` und `"name"` dynamisch aus `getCurrentLanguage()`.

### `sw.js`

Liest aus gecachtem HTML (bereits übersetzt). Eigene Fallback-Texte als Konstanten, aktualisiert per Versionsbump.

## 5. API-Responses

### Fehlermeldungen

```php
// vorher
json_response(['error' => 'Datei ist zu groß'], 413);

// nachher
json_response([
    'error' => t('error.file_too_large', ['max' => '20 MB']),
    'error_key' => 'error.file_too_large'
], 413);
```

- Übersetzter Text für die Anzeige
- Stabiler `error_key` für programmatische Auswertung

### API-Key-Requests (ohne Session)

Sprache aus `users.language` des API-Key-Besitzers. Fallback: Instanz-Default → Deutsch.

## 6. Kategorien-Umbenennung beim Sprachwechsel

### Ablauf

1. User ändert Sprache in Settings
2. Dialog erscheint: "Möchtest du die Standard-Kategorien umbenennen?"
3. Liste aller Kategorien, deren Name einem `category.default.*`-Wert der bisherigen Sprache entspricht
4. Daneben der vorgeschlagene Name in der neuen Sprache
5. Checkboxen (Standard: an) — User kann einzelne ausschließen
6. "Umbenennen"-Button → Batch-Update

### Erkennung

`category.default.*`-Namespace in den Sprachdateien enthält Default-Kategorienamen pro Sprache. Vergleich des aktuellen Namens mit allen Werten der bisherigen Sprache.

### Timing

Nur direkt nach Sprachwechsel in Settings — nicht bei jedem Login.

## 7. Umsetzungsreihenfolge

| Schritt | Was | Ergebnis |
|---|---|---|
| 1 | Infrastruktur — `i18n.php`, `public/js/i18n.js`, `lang/de.json` (leer), `getCurrentLanguage()` | `t()` funktioniert, gibt Keys zurück |
| 2 | DB-Migration — `users.language` Spalte | Spracheinstellung speicherbar |
| 3 | Strings extrahieren — ~150 Strings aus PHP/JS in `lang/de.json`, Code → `t()`-Aufrufe | App läuft wie vorher, über `t()` |
| 4 | `lang/en.json` erstellen — alle Keys übersetzen | Englische Version komplett |
| 5 | Settings-UI — Sprach-Dropdown, Kategorien-Umbenennungs-Dialog | User kann Sprache wechseln |
| 6 | HTML/Manifest dynamisch — `lang`-Attribut, Manifest, Spracherkennung | Alles reagiert auf Sprachwahl |
| 7 | API Error-Keys — `error_key` zu allen Fehler-Responses | Stabile Fehler-Identifikation |
| 8 | Smoke-Tests anpassen — i18n-Strings, Sprachparameter testen | CI bleibt grün |

## 8. Betroffene Dateien (Übersicht)

### Neue Dateien
- `i18n.php` — Übersetzungsfunktionen
- `public/js/i18n.js` — Frontend-Übersetzungsfunktion
- `lang/de.json` — Deutsche Strings
- `lang/en.json` — Englische Strings

### Geänderte Dateien (Haupt)
- `db.php` — Migration für `users.language`, `getCurrentLanguage()`
- `public/index.php` — `t()`-Aufrufe, `window.__i18n` Block, dynamisches `lang`
- `public/api.php` — `t()`-Aufrufe, `error_key` Feld
- `public/login.php` — `t()`-Aufrufe
- `public/settings.php` — `t()`-Aufrufe, Sprach-Dropdown, Umbenennungs-Dialog
- `public/admin.php` — `t()`-Aufrufe
- `public/manifest.php` — dynamisches `lang`, übersetzte Namen
- `public/js/*.js` — alle Module: `import { t }`, hardcoded Strings ersetzen

### Umgebung
- `ANKERKLADDE_DEFAULT_LANGUAGE` — neue ENV-Variable (optional)
