# UI Overhaul Konzept

## Ausgangslage

Die obere Navigation und die verschiedenen Ansichten sind aktuell zu stark miteinander vermischt. Es gibt zwei Header fuer unterschiedliche Modi, globale Werkzeuge haengen an CSS-Sichtbarkeit, und der Router muss Sonderfaelle ausgleichen. Das fuehrt zu schwer vorhersehbarem Verhalten, etwa wenn ein PWA Shortcut die Suche oeffnet, die App aber noch im Einkaufsmodus ist.

## Aktuelle Probleme

1. **Doppelte Header**

   In `public/index.php` gibt es einen Header fuer `liste-only` und einen fuer `shopping-only`. Manche Aktionen existieren dadurch doppelt, andere nur in einem Modus.

2. **Modus und Ansicht sind vermischt**

   `liste` und `einkaufen` werden als globaler Modus ueber `data-mode` behandelt. `grid` und `kanban` sind dagegen Desktop-Layouts. Fachlich sind alle vier aber Darstellungs- oder Interaktionsarten derselben Kategorie.

3. **Globale Tools sind vom Modus abhaengig**

   Suche, Einstellungen, Magic und Scanner sollten globale Funktionen sein. Aktuell koennen sie durch `.liste-only` oder `.shopping-only` unsichtbar werden, obwohl der Router sie geoeffnet hat.

4. **CSS steuert zu viel App-Logik**

   Regeln wie `[data-mode="einkaufen"] .liste-only { display: none; }` entscheiden ueber zentrale Oberflaechenzustaende. Dadurch entstehen Seiteneffekte, die in JavaScript nicht offensichtlich sind.

5. **Router enthaelt Workarounds**

   Die Router-Logik muss bereits Sonderfaelle behandeln: Suche erzwingt den Listenmodus, Scanner wechselt automatisch auf eine Einkaufsliste. Diese Fixes sind Symptome eines unklaren Zustandsmodells.

## Zielbild

Die App sollte zwei getrennte Konzepte haben:

### Screen

Ein Screen beschreibt, was gerade im Vordergrund offen ist.

- `list`
- `search`
- `settings`
- `scanner`
- `note`
- `todo`

### View Mode

Ein View Mode beschreibt, wie die aktuelle Kategorie dargestellt oder bedient wird.

- `edit`
- `shopping`
- `grid`
- `kanban`

Damit gilt:

- Suche ist ein eigener Screen, kein Anhaengsel des Listenmodus.
- Einstellungen sind ein eigener Screen.
- Scanner ist ein eigener Screen.
- Einkaufen ist eine View der aktuellen Kategorie.
- Grid und Kanban sind ebenfalls Views der aktuellen Kategorie.
- Der Header richtet sich nach Screen und verfuegbaren Aktionen, nicht nach doppelten CSS-Modi.

## UI-Konzept

Es sollte nur noch einen Header geben.

Links:

- App-Logo oder Kategorie-Titel
- aktuelle Kategorie als Untertitel oder Haupttitel

Rechts:

- Suche
- Scanner, nur wenn fuer die aktuelle Kategorie sinnvoll
- Magic, wenn aktiviert
- Einstellungen
- optional ein Mehr-Menue fuer seltene Aktionen

Darunter oder kompakt im Header:

- View Switcher als Segmented Control
- moegliche Optionen: `Bearbeiten`, `Einkaufen`, `Grid`, `Kanban`

Die sichtbaren View-Optionen haengen vom Kategorie-Typ ab:

- `list_quantity`: `Bearbeiten`, `Einkaufen`, optional `Grid`
- `list_due_date`: `Bearbeiten`, `Grid`, `Kanban`
- `notes`: `Bearbeiten`, optional `Grid`
- `images`: `Bearbeiten`, `Grid`
- `files`: `Bearbeiten`
- `links`: `Bearbeiten`, optional `Grid`

Nicht verfuegbare Views sollten gar nicht angezeigt werden. Ein Klick auf Kanban in einer nicht passenden Kategorie sollte nicht still auf Liste zurueckfallen.

## Zustandsmodell

Vorgeschlagenes State-Modell:

```js
state.screen = 'list';
state.viewMode = 'edit';
```

`screen` ersetzt die aktuelle Mischung aus `state.view`, `state.search.open`, `scannerState.open`, `noteEditorId` und Settings-Sonderlogik perspektivisch durch ein einheitliches Modell.

`viewMode` ersetzt den globalen `state.mode` und `state.desktopLayout` als einheitliche Kategorieansicht.

## Routing

Die URL sollte Screen und View Mode ausdruecken koennen:

```text
/?screen=list&view=edit
/?screen=list&view=shopping
/?screen=search
/?screen=settings&tab=app
/?screen=scanner&action=add
```

Rueckwaertskompatibel kann der bestehende Parameter `view` zunaechst weiter gelesen werden:

```text
/?view=search
/?view=settings
/?view=scanner
```

Intern sollte der Router aber auf `screen` und `viewMode` normalisieren.

## Verhalten der globalen Aktionen

### Suche

- Suche oeffnet immer den `search` Screen.
- Der View Mode der Kategorie bleibt erhalten, beeinflusst aber die Sichtbarkeit des Suchfelds nicht.
- Beim Schliessen kehrt die App zur vorherigen Kategorieansicht zurueck.

### Scanner

- Scanner oeffnet immer den `scanner` Screen.
- Wenn die aktuelle Kategorie keine Barcode-/Einkaufsliste ist, wechselt die App zur ersten sichtbaren Einkaufsliste.
- Wenn keine Einkaufsliste existiert, zeigt die App eine klare Meldung mit Handlungsvorschlag.

### Einstellungen

- Einstellungen oeffnen den `settings` Screen.
- Der Header bleibt konsistent, zeigt aber nur Zurueck/Schliessen und relevante Settings-Aktionen.

### Magic

- Magic sollte entweder als eigener Screen oder als globales Overlay definiert werden.
- Es darf nicht von `edit` oder `shopping` CSS-Klassen abhaengen.

## Umbauplan

### Phase 1: Zustand klaeren

- `state.screen` einfuehren.
- `state.viewMode` einfuehren.
- Bestehende Werte (`state.view`, `state.mode`, `state.desktopLayout`, `state.search.open`) vorerst darauf abbilden.
- Kleine Helper ergaenzen:

```js
setScreen(screen, options)
setViewMode(viewMode)
getAvailableViewModes(category)
```

### Phase 2: Header vereinheitlichen

- Die beiden Header in `public/index.php` durch einen Header ersetzen.
- Doppelte Buttons entfernen.
- Sichtbarkeit der Buttons aus State und Kategorie-Typ ableiten.
- `.liste-only` und `.shopping-only` nur noch temporaer fuer Altbereiche behalten.

### Phase 3: View Switcher bauen

- Modus-Button und Desktop-Layout-Switcher durch einen gemeinsamen View Switcher ersetzen.
- Nur gueltige Views fuer die aktuelle Kategorie anzeigen.
- View-Wechsel zentral ueber `setViewMode()` laufen lassen.

### Phase 4: Router normalisieren

- Initiale URL auf `{ screen, viewMode }` normalisieren.
- History-State ebenfalls darauf umstellen.
- Alte URLs weiterhin akzeptieren.

### Phase 5: CSS vereinfachen

- `[data-mode="einkaufen"] .liste-only` und `[data-mode="liste"] .shopping-only` entfernen.
- Stattdessen gezielte Klassen verwenden:

```css
.app[data-screen="search"] { ... }
.app[data-view-mode="shopping"] { ... }
.app[data-view-mode="kanban"] { ... }
```

### Phase 6: Tests und PWA Shortcuts

- PWA Shortcuts testen:
  - Barcode scannen
  - Einstellungen
  - Suche
- Direktaufrufe per URL testen.
- Wechsel zwischen Kategorien und Views testen.
- Ruecknavigation ueber Browser/PWA Back testen.

## Erfolgskriterien

- Es gibt nur noch einen Header.
- Suche, Scanner, Settings und Magic sind unabhaengig vom aktuellen View Mode nutzbar.
- Alle Ansichten werden ueber ein einheitliches View-Konzept gesteuert.
- Nicht verfuegbare Views werden nicht angezeigt.
- Der Router braucht keine UI-Sichtbarkeits-Workarounds mehr.
- PWA Shortcuts verhalten sich aus jedem App-Zustand gleich.
