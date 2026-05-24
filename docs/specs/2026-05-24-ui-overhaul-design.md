# UI Overhaul Design Spec

## Zusammenfassung

Umbau der Ankerkladde-UI von einem vermischten Modus/Ansicht-System zu drei unabhängigen Zustandsachsen: Screen (was ist offen), Mode (Interaktion), Layout (Darstellung). Vereinheitlichung auf einen einzigen Header. Bottom-Up-Umsetzung in sechs Phasen.

## Probleme im aktuellen System

1. **Doppelte Header**: `liste-only` und `shopping-only` Header in `index.php` mit duplizierten und fehlenden Aktionen
2. **Vermischte Konzepte**: `liste`/`einkaufen` als globaler Modus, `grid`/`kanban` als Desktop-Layout — fachlich beides Darstellungsarten derselben Kategorie
3. **Modus-abhängige globale Tools**: Suche, Scanner, Settings können durch `.liste-only`/`.shopping-only` CSS unsichtbar werden
4. **CSS steuert App-Logik**: `[data-mode="einkaufen"] .liste-only { display: none; }` entscheidet über zentrale UI-Zustände
5. **Router-Workarounds**: Suche erzwingt Listenmodus, Scanner wechselt automatisch Kategorie

## Zustandsmodell

Drei unabhängige Achsen:

```js
state.screen = 'list'    // list | search | settings | scanner | note
state.mode = 'edit'      // edit | view
state.layout = 'list'    // list | grid | kanban
```

### Mapping auf bisherige Variablen

**Namenskonflikt:** `state.mode` existiert bereits mit den Werten `'liste'`/`'einkaufen'`. Der neue `state.mode` hat die Werte `'edit'`/`'view'`. In Phase 1 wird der alte `state.mode` durch den neuen ersetzt und alle Stellen, die `'liste'`/`'einkaufen'` prüfen, auf `'edit'`/`'view'` umgestellt.

| Alt | Neu |
|---|---|
| `state.view` | `state.screen` |
| `state.mode` ('liste'/'einkaufen') | `state.mode` ('edit'/'view') |
| `state.desktopLayout` | `state.layout` (jetzt auch mobile) |
| `state.search.open` | `state.screen === 'search'` |
| `scannerState.open` | `state.screen === 'scanner'` |
| `noteEditorId` | bleibt, bestimmt ob `screen === 'note'` |

### Helper-Funktionen

- `setScreen(screen, options)` — wechselt Screen, aktualisiert URL und History
- `setMode(mode)` — toggelt Bearbeiten/Ansehen, aktualisiert URL
- `setLayout(layout)` — wechselt Layout, aktualisiert URL, validiert gegen `getAvailableLayouts()`
- `getAvailableLayouts(categoryType)` — gibt gültige Layouts für den Kategorie-Typ zurück

### Verfügbare Layouts pro Kategorie-Typ

| Typ | Liste | Grid | Kanban |
|---|---|---|---|
| `list_quantity` | ja | ja | — |
| `list_due_date` | ja | ja | ja |
| `notes` | ja | ja | — |
| `images` | ja | ja | — |
| `files` | ja | — | — |
| `links` | ja | ja | — |

`setLayout()` validiert gegen diese Tabelle. Ungültige Layouts fallen auf `list` zurück.

### Modus: Bearbeiten vs. Ansehen

Universell für alle Kategorie-Typen:

- **Bearbeiten (edit)**: Eingabefeld sichtbar, alle CRUD-Aktionen verfügbar, Sortieren/Reorder möglich
- **Ansehen (view)**: Kein Eingabefeld, keine Bearbeitungs-Aktionen (Löschen, Editieren, Sortieren), Abhaken bleibt, typ-spezifische Aktionen bleiben (Download, Klicken, Lightbox)

## URL-Schema

```
/?screen=list&mode=edit&layout=list        (Default)
/?screen=list&mode=view&layout=grid        (Ansehen im Grid)
/?screen=search&q=milch                    (Suche)
/?screen=settings&tab=app                  (Einstellungen)
/?screen=scanner&scanner_action=add        (Scanner)
/?screen=note&note=42&category_id=5        (Notiz-Editor)
```

### Defaults

Alle drei Achsen haben Defaults (`screen=list`, `mode=edit`, `layout=list`). `/?` ohne Parameter zeigt den normalen Zustand.

### Rückwärtskompatibilität

| Alt | Neu |
|---|---|
| `?view=search` | `?screen=search` |
| `?view=settings` | `?screen=settings` |
| `?view=scanner` | `?screen=scanner` |
| `?view=note` | `?screen=note` |

### Persistenz

`mode` und `layout` werden zusätzlich in `localStorage` gespeichert. Beim Laden ohne URL-Parameter werden die gespeicherten Werte verwendet.

## Header-Design

Ein einziger Header ersetzt die bisherigen zwei Header.

### list-Screen

```
┌──────────────────────────────────────────┐
│ 🛒 Einkaufsliste [✏️ Bearb.]   ☰ ▦  🔍 ⚙️ │
└──────────────────────────────────────────┘
```

- **Links:** Kategorie-Icon + Titel + Modus-Chip
- **Rechts:** Layout-Icons (gefiltert nach Kategorie-Typ) + Suche + Scanner (wenn sinnvoll) + Magic (wenn aktiviert) + Settings
- **Modus-Chip:** Tap toggelt direkt zwischen "Bearb." und "Ansehen"
- **Layout-Icons:** Nur gültige Layouts für den aktuellen Kategorie-Typ

### Andere Screens

| Screen | Links | Rechts |
|---|---|---|
| `search` | ← Zurück + Suchfeld | Abbrechen |
| `settings` | ← Zurück + "Einstellungen" | — |
| `scanner` | ← Zurück + "Scanner" | — |
| `note` | ← Zurück + Notiz-Titel | Aktionen |

### Magic

Overlay über dem aktuellen Screen. Header bleibt unverändert. Kein eigener Screen.

## CSS-Strategie

### Entfernen

- `[data-mode="einkaufen"] .liste-only { display: none; }`
- `[data-mode="liste"] .shopping-only { display: none; }`
- Alle `.liste-only` und `.shopping-only` Klassen aus HTML

### Neue Data-Attribute

```html
<div class="app" data-screen="list" data-mode="edit" data-layout="list">
```

### Neue Selektoren

```css
/* Screen-spezifisch */
.app[data-screen="search"] .header-list { display: none; }
.app[data-screen="search"] .header-search { display: flex; }

/* Modus-spezifisch */
.app[data-mode="view"] .edit-only { display: none; }
.app[data-mode="edit"] .view-only { display: none; }

/* Layout-spezifisch */
.app[data-layout="grid"] .items-container { /* grid styles */ }
.app[data-layout="kanban"] .items-container { /* kanban styles */ }
```

### Prinzip

CSS steuert nur Darstellung (sichtbar/unsichtbar, Layout), nie Logik. JS-Helper setzen Data-Attribute, CSS reagiert darauf. `.edit-only`/`.view-only` ersetzen `.liste-only`/`.shopping-only`.

## Verhalten der globalen Aktionen

### Suche

- Öffnet `screen=search`, unabhängig von `mode`/`layout`
- `mode` und `layout` bleiben im State erhalten
- Schließen kehrt zum vorherigen Screen zurück
- Kein erzwungener Modus-Wechsel mehr

### Scanner

- Öffnet `screen=scanner`
- Wenn aktuelle Kategorie kein `list_quantity`-Typ: wechselt zur ersten sichtbaren `list_quantity`-Kategorie
- Wenn keine existiert: Fehlermeldung mit Handlungsvorschlag
- Schließen: zurück zur (ggf. gewechselten) Kategorie

### Settings

- Öffnet `screen=settings`
- Eigener Header mit Zurück-Button
- Zurück kehrt zum vorherigen Screen zurück

### Magic

- Overlay über dem aktuellen Screen
- Header, `screen`, `mode`, `layout` bleiben unverändert
- Schließen entfernt Overlay, kein State-Wechsel

### Note-Editor

- Öffnet `screen=note` mit `noteEditorId`
- Eigener Header mit Zurück + Notiz-Titel
- Auto-Save mit Debounce wie bisher
- Zurück kehrt zur Kategorie zurück

## Umsetzungsphasen (Bottom-Up)

### Phase 1: State-Modell einführen

- `state.screen`, `state.mode`, `state.layout` einführen
- Helper-Funktionen implementieren
- Bestehende Variablen auf neue mappen
- Alte Variablen als Getter/Aliase behalten

### Phase 2: Router normalisieren

- URL-Parsing auf `screen`/`mode`/`layout` umstellen
- Alte URL-Parameter akzeptieren und normalisieren
- History-State auf drei Achsen umstellen
- Router-Workarounds entfernen

### Phase 3: Header vereinheitlichen

- Einen Header in `index.php` bauen
- Screen-spezifische Header-Varianten
- Beide alten Header entfernen
- `.liste-only`/`.shopping-only` aus HTML entfernen

### Phase 4: View-Controls bauen

- Modus-Chip (Tap toggelt edit/view)
- Layout-Icons (gefiltert nach `getAvailableLayouts`)
- Alten Modus-Toggle und Desktop-Layout-Switcher entfernen

### Phase 5: CSS aufräumen

- Alte `[data-mode]`-Regeln durch neue ersetzen
- `.liste-only`/`.shopping-only` durch `.edit-only`/`.view-only` ersetzen
- Layout-Styles unter `[data-layout]` konsolidieren

### Phase 6: Testen und PWA

- PWA-Shortcuts auf neue URL-Parameter umstellen
- Alle Screens aus jedem Zustand testen
- Rücknavigation testen
- Alte URLs testen (Rückwärtskompatibilität)

Jede Phase ist ein eigenständig testbares Inkrement.

## Erfolgskriterien

- Es gibt nur noch einen Header
- Suche, Scanner, Settings und Magic sind unabhängig vom aktuellen Mode/Layout nutzbar
- Drei unabhängige Zustandsachsen: Screen, Mode, Layout
- Nicht verfügbare Layouts werden nicht angezeigt
- Der Router braucht keine UI-Sichtbarkeits-Workarounds mehr
- PWA-Shortcuts funktionieren aus jedem App-Zustand
- Alte URLs funktionieren weiterhin
