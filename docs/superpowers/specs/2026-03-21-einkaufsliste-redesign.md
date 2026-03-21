# Einkaufsliste Redesign — Design Spec

**Datum:** 2026-03-21
**Status:** Approved

---

## Kontext

Die bestehende App ist funktional und sicher, aber das UI soll komplett neu gestaltet werden: minimaler, moderner, cleaner. Funktionen bleiben identisch. Dazu kommt ein Zwei-Modi-Konzept (Planen vs. Einkaufen) und PWA-Unterstützung für den Offline-Einsatz im Laden.

---

## Designziele

- Minimal, modern, clean — kein visueller Ballast
- Mobile-first: primär auf dem Handy im Laden genutzt
- Zwei klare Modi mit Bottom Navigation
- PWA: installierbar, offline-fähig (Lesen + Abhaken ohne Internet, keine Sync-Queue)

**Einschränkung:** Die App muss immer vom Domain-Root ausgeliefert werden (`/`). Subdirectory-Deployment ist nicht unterstützt, da der Service Worker mit Scope `/` registriert wird.

---

## Farb- und Stilsystem

**Warm Beige Palette:**

| Token | Wert | Verwendung |
|---|---|---|
| `--bg` | `#f5f0eb` | App-Hintergrund |
| `--surface` | `#fffdf9` | Karten, Inputs |
| `--border` | `#e8e0d5` | Rahmen, Trennlinien |
| `--text-primary` | `#2c2416` | Überschriften, Artikelname |
| `--text-secondary` | `#7a6350` | Mengen-Badge |
| `--text-muted` | `#b0a090` | Inaktive Nav-Items, Hinweise |
| `--accent` | `#c8b89a` | Checkbox-Rahmen, Checkmark-Hintergrund |
| `--done-bg` | `#f0ebe4` | Hintergrund erledigter Artikel |

**Typografie:** `system-ui, -apple-system, sans-serif` (Wechsel von der bisherigen `"Avenir Next", "Trebuchet MS"` — bewusste Entscheidung für systemnahe Schrift, keine externe Abhängigkeit).

**Radius:** 10–12px für Karten, 6–8px für Badges
**Touch-Targets:** Mindestgröße 44×44px (Apple HIG / WCAG 2.5.5)

---

## Zwei Modi

### Modus 1: Liste (Hinzufügen)

Aktiv wenn Tab "✏️ Liste" gewählt. Standardmodus beim Start.

**Elemente:**
- App-Titel "Einkaufsliste" oben
- Input-Zeile: Textfeld "Artikel...", Textfeld "Menge" (optional, schmal), Button "+"
- Artikelliste:
  - Offene Artikel oben: Checkbox + Name + Menge-Badge + ×-Button
  - Erledigte Artikel unten (kein Trennheader, nur visueller Abstand ~8px): ausgegraut, durchgestrichen, opacity 0.55, dezenter ×-Button
  - Erledigte können abgehakt/wieder geöffnet werden
- Button "Erledigte löschen" (nur sichtbar wenn ≥1 erledigt)
- Leerzustand: "Noch nichts auf der Liste. Füge oben etwas hinzu."

### Modus 2: Einkaufen

Aktiv wenn Tab "🛒 Einkaufen" gewählt. Für den Einsatz im Laden.

**Elemente:**
- Titel "Einkaufen" + Fortschrittsanzeige oben rechts: Format "X / Y" wobei X = erledigte Anzahl, Y = Gesamtanzahl (z. B. "2 / 5")
- Artikelliste (größere Touch-Targets):
  - Offene Artikel: Checkbox (24px) + Name + Menge-Badge — **kein Delete-Button**
  - Erledigte rutschen nach unten, kein Trennheader, opacity 0.55, durchgestrichen — **kein Delete-Button**
- Kein Input-Bereich, kein "Erledigte löschen"-Button, keine Delete-Buttons (weder auf offenen noch auf erledigten Artikeln)
- Leerzustand: "Alles erledigt 🎉" wenn `items.length > 0 && items.every(i => i.done)`; "Keine Artikel auf der Liste." wenn `items.length === 0`

**Interaktion:** Artikel tippen → Toggle (done/undone). Erledigte Artikel bewegen sich mit Animation nach unten, wieder geöffnete nach oben.

---

## Bottom Navigation

Fest am unteren Rand, über der Home-Bar des Geräts.

```
[ ✏️ Liste ]   [ 🛒 Einkaufen ]
```

- `padding-bottom: env(safe-area-inset-bottom, 8px)` für iPhone-Home-Bar
- Aktiver Tab: `font-weight: 700`, `color: var(--text-primary)`
- Inaktiver Tab: `color: var(--text-muted)`
- `aria-label="Hauptnavigation"` auf `<nav>`, `aria-current="page"` auf aktivem Tab

---

## Mobile Anforderungen

- Viewport: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">` — **kein** `maximum-scale=1.0` (wäre Accessibility-Verletzung WCAG 1.4.4). Das bestehende `maximum-scale=1.0` in `index.php` muss aktiv entfernt werden.
- Safe-area-insets: Bottom-Nav bekommt `padding-bottom: env(safe-area-inset-bottom, 8px)`
- Wenn Tastatur aufgeht: Input-Bereich scrollt in Sicht (kein `height: 100vh` auf Containern)
- Kein Horizontal-Scrolling

---

## PWA

### Service Worker Strategie

**Cache-Name:** `einkauf-v1` (Versionsbump = vollständige Cache-Invalidierung)

**Strategie pro Resource:**

| Resource | Strategie | Begründung |
|---|---|---|
| `style.css`, `app.js`, Icons, `manifest.json` | Cache-first, dann Network | Statische Assets, selten geändert |
| `index.php` (HTML-Shell) | **Network-first**, Fallback auf Cache | CSRF-Token ist session-gebunden — Cache-first würde abgelaufene Token liefern und alle POST-Anfragen mit 403 scheitern lassen |
| `api.php` GET | Network-first, Fallback auf geklonten Cache-Response | Im Laden aktuelle Liste anzeigen. **Wichtig:** Da `api.php` `Cache-Control: no-store` setzt, muss der SW die Response vor dem Cachen klonen (`response.clone()`), sonst ist der Cache-Eintrag leer. |
| `api.php` POST | Pass-through, kein Caching, kein Intercept | Failure propagiert direkt zu `app.js`. Der SW darf POST-Fehler nicht abfangen oder cachen. |

**Activate-Event:** Löscht alle Caches die nicht dem aktuellen Cache-Namen entsprechen. `skipWaiting()` und `clients.claim()` werden aufgerufen, damit neue Service Worker sofort aktiv werden.

### Offline-Verhalten

**Lesen:** Liste wird aus Cache geliefert (letzter Stand beim letzten Online-Besuch).

**Abhaken (Toggle) offline:**
- Nutzer tippt auf Artikel → optimistisches UI-Update (Checkbox springt sofort)
- API-Request schlägt fehl (kein Netz)
- **Checkbox wird auf Ausgangszustand zurückgesetzt**
- Kurze Fehlermeldung: "Offline — Änderung konnte nicht gespeichert werden"
- Kein Absturz, kein weißer Screen

**Hinzufügen/Löschen offline:** Schlägt fehl, Fehlermeldung wird angezeigt. Kein Silent-Fail.

### Manifest

`public/manifest.json`:
```json
{
  "name": "Einkaufsliste",
  "short_name": "Einkauf",
  "lang": "de",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#f5f0eb",
  "theme_color": "#f5f0eb",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

### Icons

Quelle: einfaches SVG (Einkaufswagen-Symbol, Farbe `#2c2416` auf `#f5f0eb`). **Die PNG-Dateien (`icon-192.png`, `icon-512.png`) werden als Binary-Assets ins Repository committed**; `icon.svg` ist die editierbare Quelle. Generierung mit `rsvg-convert` oder `Inkscape` CLI — oder beliebigem Online-Konverter.

### Meta-Tags in index.php

```html
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#f5f0eb">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="/manifest.json">
<meta name="csrf-token" content="...">  <!-- unverändert, bleibt sole Token-Quelle -->
```

**Wichtig:** Das `<meta name="csrf-token">` bleibt der einzige Mechanismus zur Token-Lieferung ans Frontend. Format und Position dürfen nicht verändert werden (Smoke-Tests parsen dieses Tag).

---

## Animationen

- Artikel hinzufügen: fade-in + slide-down
- Artikel erledigen / wieder öffnen: FLIP-Animation (First/Last/Invert/Play) für Position. Ein `innerHTML`-Ersatz für bereits sichtbare Items ist nicht akzeptabel — er produziert keinen smooth Übergang. Implementierung: DOM-Node im `<ul>` an neue Position verschieben, dann `transform` Transition (300ms) anwenden. FLIP gilt in beiden Modi.
- Artikel löschen: fade-out + height collapse
- Modus-Wechsel: Input-Bereich fade-in/out
- `prefers-reduced-motion: reduce` → alle Animationen deaktiviert

---

## Accessibility

- `<nav aria-label="Hauptnavigation">` für Bottom Nav
- `aria-current="page"` auf aktivem Tab
- `aria-live="polite"` für Status-/Fehlermeldungen (wie bisher)
- `aria-label` auf Checkboxen und Delete-Buttons (wie bisher)
- Keine `maximum-scale=1.0` im Viewport-Meta (Zoom-Freiheit erhalten)

---

## Dateistruktur

```
public/
├── index.php          # Überarbeitet: nur HTML-Shell + Meta-Tags
├── style.css          # NEU: gesamtes CSS (Warm Beige, Layout, Animationen)
├── app.js             # NEU: JS-Logik (API-Calls, Mode-Switching, DOM-Updates, FLIP)
├── sw.js              # NEU: Service Worker
├── manifest.json      # NEU: PWA Manifest
└── icons/
    ├── icon.svg       # NEU: Quell-Icon
    ├── icon-192.png   # NEU: App-Icon
    └── icon-512.png   # NEU: App-Icon
```

**Unverändert:** `db.php`, `security.php`, `api.php`, `deploy/`, `scripts/`

---

## Verifikation

1. `php -S 127.0.0.1:8000 -t public` starten
2. App öffnen — beide Modi testen: Artikel hinzufügen, abhaken, löschen, "Erledigte löschen"
3. Artikel erledigen → beobachten dass FLIP-Animation nach unten smooth läuft
4. DevTools → Application → Manifest: PWA-Manifest korrekt geladen
5. DevTools → Application → Service Workers: registriert, Status "activated"
6. DevTools → Network → Offline aktivieren:
   - Liste sichtbar aus Cache
   - Abhak-Versuch → Checkbox revertiert, Offline-Meldung erscheint
7. Auf iOS/Android: "Zum Home-Bildschirm hinzufügen" → startet standalone ohne Browser-UI
8. `scripts/smoke-test.sh` — alle API-Tests grün
