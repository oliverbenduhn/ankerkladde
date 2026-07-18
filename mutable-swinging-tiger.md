# Parchment-Tagesansicht + Zeichnungen (Spec: `mehr_parchment.md`)

## Kontext

Die getrennten Ansichten „Heute" (Agenda) und „Tagesnotiz" (Journal) werden zu einer datumszentrierten Tagesansicht im Parchment-Stil zusammengeführt; danach folgt als eigener Meilenstein die Excalidraw-Integration (Kategorietyp `drawings` + optionale Tages-Skizze). **Maßgebliche Spezifikation ist `mehr_parchment.md` im Repo-Root** — dieser Plan ergänzt sie um die konkreten Code-Stellen. Bei Widersprüchen gewinnt `mehr_parchment.md`.

Die Datenschicht existiert bereits: `due_time`, `agenda_group` (overdue/scheduled/anytime_today), `daily_notes`-Kategorietyp, Journal-API mit `date`-Param, Badge-API, Journal-History. Excalidraw wird wie TipTap per CDN von esm.sh geladen (Muster: `public/js/tiptap-init.js`, CSP via `sendHtmlPageSecurityHeaders(allowEsmSh: true)`, security.php:462).

## Zielbild (Kurzfassung aus der Spec)

- Kompakter Screen-Header in der Tagesansicht: Kalender links, Segmentleiste Gestern/Heute/Morgen mittig, Einstellungen rechts — alle übrigen Header-Aktionen (Branding, Untertitel, Mode-Chip, Suche, Layout, Tabs, Scanner, Magic, Fortschritt) sind dort ausgeblendet. **Keine zweite Kalender-Schaltfläche**: der globale Kalender-Button öffnet aus anderen Ansichten die Tagesansicht, innerhalb der Tagesansicht öffnet er den nativen Datepicker.
- Große linksbündige Serifen-Datumsüberschrift ohne Jahr.
- Agenda-Karte **dauerhaft zweispaltig** („Ganztägig + ohne Uhrzeit" / „Terminiert") — auch bei 375 px; unter ~420 px nur Dichte reduzieren, nie stapeln. `grid-template-columns: minmax(0, 48fr) minmax(0, 52fr)`, `min-width: 0` an allen Grid-/Flex-Kindern, kein horizontales Scrollen.
- Notiz-Karte: Serifentitel, reduzierter Kartenkopf mit Format-Button (klappt bestehende TipTap-Toolbar auf/zu), Mono-Editor (Zeilenhöhe ~1.55), Speicherstatus nur während/kurz nach dem Speichern bzw. bei Fehlern.
- App-Breite bleibt max. 640 px (`.parchment-view`: `width: 100%; max-width: 640px; padding: 0 10px 24px;`), Kartenabstand 10–12 px, gescrollt wird die Ansicht, nicht die Karten.
- Checkbox optisch 18–20 px, Touch-Ziel ≥ 40×40 px; erledigte Einträge optimistisch markieren, nach erfolgreichem Toggle aus der Agenda entfernen.
- Tokens: `--radius: 14px`, `--font-serif` (Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif), `--font-mono` (ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace). Nur Theme-Tokens, keine fest verdrahteten Farben; Light: Karten über Fläche + sanften Schatten, Dark: sichtbarerer Rand, identische Maße.

## Technische Leitentscheidungen

1. **`'journal'` bleibt kanonischer Screen**, `'today'` wird als Route-Alias normalisiert (initiale URL, History, Popstate einheitlich). Manifest-Shortcuts (`?screen=today`, `?screen=journal&date=today&focus=editor`) und Smoke-Test-Assertions (Zeilen 95–96, 627–628) bleiben gültig.
2. **Zwei parallele API-Calls** (`today&date=…` + `journal&date=…` via `Promise.all`), kein Kombi-Endpoint.
3. **Agenda-Toggle über bestehende Action `toggle`** (api.php:2579) direkt im Agenda-Controller — nicht `handleToggle` (operiert nur auf `state.items` der aktiven Kategorie).
4. **Gestern/Heute/Morgen als absolute Ziele** (serverToday−1/±0/+1, `aria-pressed`); bei freiem Datepicker-Datum ist kein Segment aktiv. Disable-Logik in `updateDateUi` (journal.js:136) entfällt.
5. **Editor-Flush vor Navigation**: vor Datumswechsel und vor Deep-Link (`openSourceItem`, router.js:107) Journal sauber schließen/Save flushen.
6. **WebSocket-Updates** aktualisieren in der Tagesansicht nur die Agenda, nie den Notizinhalt (app-entry.js:162).
7. **Excalidraw-Szenen in neuer additiver Spalte `items.sketch`**, nicht in `content` (FTS indexiert name+content — Szene-JSON würde die Suche verschmutzen). Listen-/Journal-Responses liefern nur `has_sketch`; Szene lazy via `sketch`/`sketch_save`-Actions (Größenlimit 2 MB).
8. **Excalidraw lazy per Dynamic Import** beim ersten Editor-Öffnen (nie beim App-Boot); `window.EXCALIDRAW_ASSET_PATH` auf esm.sh; CSP um `style-src https://esm.sh` + `font-src 'self' https://esm.sh` erweitern. CDN-Ausfall darf die App nicht beschädigen.
9. **Neues `icon-calendar`** (Lucide calendar-days) in `public/ui-sprite.php` (`scripts/check-ui-sprite.js` ausführen).

## Arbeitsweise je Release-Schritt

1. `public/version.php:4` + `public/sw.js:3` (`const VERSION = 'vX.Y.Z'`) erhöhen; **alle** `?v=…`-Imports in `public/js/*.js` synchronisieren (CI: `scripts/check-js-cache-versions.php`).
2. `php -l` auf geänderte PHP-Dateien, Spezialchecks (Sprite-Check, Migrationstest wo relevant), `bash scripts/smoke-test.sh`.
3. Commit + Push `origin main`, Report laut CLAUDE.md, auf „weiter" warten.

---

## Meilenstein A — Parchment-Tagesansicht

### Schritt 1 — Datumsfähige Agenda-API (v5.1.16)

- `public/api.php` `case 'today'` (1989–2053): optionaler `date`-Param via `normalizeJournalDate()` (1651, 422 bei Fehlformat). Ohne Param / `date === serverToday`: unverändert (`due_date <= :today`, Overdue-Faltung). Andere Daten: nur `due_date = :date`, `done = 0`, keine Overdue-Faltung; `agenda_group` relativ zu `$date`; stabile Sortierung nach `due_time`/`sort_order`. Response additiv: `{ today: serverToday, date, items }`.
- `scripts/smoke-test.sh`: ohne Param ≙ `date=<serverToday>`; historisches Datum → nur exakt fällige Items; ungültiges Datum → 422; manuelle `curl`-Prüfung.

### Schritt 2 — Funktionale Komposition im Journal (v5.1.17)

- `public/index.php` (#journalView, 197–222): Umbau zu `.parchment-view`, **bestehende IDs behalten** (journalPreviousBtn/TodayBtn/NextBtn/DatePicker/DateHeading/Toolbar/EditorBody/SaveStatus). Kompakter Tages-Header (Kalender, Segmentleiste, Einstellungen) vorbereitet; nativer Datepicker versteckt im DOM; Datumsüberschrift darunter; Agenda-Karte mit `#agendaUntimedList`/`#agendaScheduledList`/`#agendaAddBtn`; Notiz-Karte mit Kartenkopf, `#journalSaveStatus`, einklappbarer `#journalToolbar` (Format-Toggle-Button) und `#journalEditorBody`.
- `public/ui-sprite.php`: `icon-calendar` (Lucide calendar-days) + Sprite-Check.
- `public/js/ui.js`: neue Refs (Agenda-Listen, `agendaAddBtn`, Kalender-Button, Format-Toggle).
- `public/js/today-view.js`: Controller → `{loadAgenda(date), renderAgenda(), refreshTodayBadge()}`. Links `overdue` (rotes „seit …"-Label) + `anytime_today`, rechts `scheduled` (Uhrzeit, `tabular-nums`). Zeile: Checkbox links (Touch-Ziel ≥40 px), Name oben, Zeit/„Ganztägig"/„Überfällig" darunter, Kategorie nur zurückhaltend. Optimistischer Toggle → bei Erfolg Eintrag entfernen, Agenda neu laden, `invalidateCategoryCache(category_id)`, Badge aktualisieren; bei Fehler zurückrollen + Meldung. Rest-Klick → `openSourceItem`. `refreshTodayBadge()`: nur `api('today')` → `navigator.setAppBadge`.
- `public/js/journal.js`: `openDay` (144) lädt Notiz + Agenda parallel; `formatDateHeading` (32) ohne `year`; Segmente absolut mit `aria-pressed` (freies Datum → keins aktiv); Kalender-Button → `showPicker()` mit Fallback (Fokus/Klick); Save-Flush vor Datumswechsel und Deep-Link.
- `public/js/router.js` / `app-runtime.js`: Agenda-Deps verdrahten (151–156, 183–188); `openSourceItem` (107) schließt vorher das Journal (`closeJournalScreen`).
- Alter `'today'`-Screen bleibt in diesem Schritt unangetastet → isoliert testbar.

**Test:** Agenda + Notiz gemeinsam; alle drei Segmente und freies Datepicker-Datum wechseln beide Bereiche; Toggle navigiert nicht; Item-Tap deep-linkt mit Highlight; ausstehende Notizänderungen gehen beim Wechsel nicht verloren.

### Schritt 3 — Routing, Tabs und Zugänge konsolidieren (v5.1.18)

- `public/js/navigation.js`: `'today'` → `'journal'` **vor** der Whitelist-Prüfung (9) normalisieren; Alias einheitlich in `readInitialRouteFromUrl` (173), History, Popstate.
- `public/js/router.js`: `openToday`/`closeToday` (74–95) + Today-Branches in `applyViewState` (14), `getCurrentRouteState` (193), `applyRouteState` (241), `selectCategory` (121) entfernen.
- `public/js/tabs-view.js`: `makeTodayTab` (67–84, Aufruf 218) entfernen; `daily_notes` nur aus der sichtbaren Tab-Leiste filtern — NICHT aus `getVisibleCategories` (items.js:49, wird für Move-Ziele genutzt).
- `public/index.php` / `app-events.js`: `#todayNoteBtn` (122, Handler 87–91) entfernen; globaler `#dayViewBtn` (`header-icon-btn`, `icon('calendar')`) — außerhalb der Tagesansicht `openJournalWithNavigation(state.serverToday || 'today', null)` (app-runtime.js:190), innerhalb Datepicker-Auslöser.
- `app-runtime.js` (onTodaySelect 222 raus; loadToday-Aufrufe 130/165/206/367 → `refreshTodayBadge`/`loadAgenda`), `items-actions-add.js:94` (Quick-Add-Branch → `'journal'`, Reload → `loadAgenda(state.journalDate)`), `app-init.js:40` (→ `refreshTodayBadge()`), `app-entry.js:162` (WS → nur `loadAgenda`), `app-ui.js` `updateHeaders` (Today-Branch 284–302 raus, Journal-Branch übernimmt Quick-Add-Setup; Z. 195/197 anpassen).
- `lang/de.json`/`en.json`: Agenda-, Notiz-, Spalten- („Ganztägig + ohne Uhrzeit"/„Terminiert"), Format- und Datepicker-Texte; vorhandene `today.*`/`journal.*`-Keys weiternutzen.

**Test:** Kein Heute-/Tagesnotizen-Tab; Kalender-Button öffnet Tagesansicht; `?screen=today`-Alias funktioniert; Journal-Manifest-Shortcut fokussiert weiter den Editor; Back/Forward + Reload erhalten Datum und Screen; Badge stimmt; smoke-test grün.

### Schritt 4 — Parchment-Chrome und exaktes Styling (v5.1.19)

`public/style.css` (nur CSS + Tokens):

- `:root`: `--radius: 14px`, `--font-serif`, `--font-mono` (Stacks siehe Zielbild). Undefinierte `var(--text)` (3436/3459) / `var(--bg-elevated)` (1477) durch `--text-primary`/`--surface` ersetzen; tote Today-Regeln (2680–2698) entfernen.
- `.app.journal-view`: normale Header-Inhalte ausblenden, kompakte Parchment-Chrome (Kalender | Segmentleiste als Pill | Einstellungen); Segmentleiste bleibt einzeilig.
- `.parchment-date-heading`: Serif, `clamp(1.6rem, 5vw, 2.2rem)`, fett, linksbündig, ohne Jahr.
- `.parchment-card`: `border-radius: var(--radius)`, subtile Theme-Fläche, feiner Rand, sanfter Schatten (Light: Fläche+Schatten, Dark: Rand sichtbarer); Kartenabstand 10–12 px; Kartentitel in Serif; keine Karten-internen Scrollbereiche.
- `.parchment-view { width: 100%; max-width: 640px; margin: 0 auto; padding: 0 10px 24px; }` — einziger Scrollcontainer bleibt `.list-area`/`.parchment-view`.
- `.agenda-columns { display: grid; grid-template-columns: minmax(0, 48fr) minmax(0, 52fr); }` mit vertikalem Trenner — **dauerhaft zweispaltig**, auch bei 375 px; unter ~420 px Padding/Gap/Schriftgrößen reduzieren; `min-width: 0` überall, Namen umbrechen, kein horizontales Scrollen. Spaltenlabels uppercase in System-Sans (`--text-muted`).
- `.agenda-check`: sichtbar 18–20 px Kreis, Touch-Ziel ≥ 40×40 px (Padding/Pseudo-Element); done → gefüllt `--accent`; Überfällig rot (`--error`); Zeit `tabular-nums`.
- Notiz-Karte: Editor Mono, Zeilenhöhe ~1.55, leicht abgesetzte innere Fläche; Toolbar einklappbar (`.toolbar-open`-Klasse via Format-Button); Speicherstatus nur bei Aktivität/Fehler sichtbar.
- Nach `--radius`-Definition alle bisherigen `var(--radius)`-Stellen (1819, 2726, 3434, 3473, 5172, 5212) visuell prüfen.

**Visuelle Abnahme:** Referenzvergleich bei 375×812 und 640×900; zwei Spalten ohne horizontales Scrollen bei 375 px; Segmentleiste einzeilig; Datum ohne Jahr; keine dauerhafte Volltoolbar; identische Maße Light/Dark; lange Itemnamen; leere linke/rechte/komplett leere Agenda; `var(--radius)`-Stellen.

### Schritt 5 — Agenda-Quick-Add und Abschluss Meilenstein A (v5.1.20)

- `app-events.js`: `#agendaAddBtn` öffnet Quick-Add (`quick-add-open` auf appEl), fokussiert `itemInput`.
- `style.css`: Eingabe in `.app.journal-view.quick-add-open` sichtbar, als kompakte zur Karte gehörende Fläche.
- `items-actions-add.js`: nach erfolgreichem Add `quick-add-open` entfernen + `loadAgenda(state.journalDate)`; bei Fehler Eingabe offen und Inhalt erhalten.
- Aufräumen: tote `.today-*`-Klassen, ungenutzte i18n-Keys, `changelog.md`.

**Endabnahme A:** `Zahnarzt morgen 8:00` erscheint beim Wechsel auf Morgen rechts unter „Terminiert"; Ganztagesaufgabe links; Badge zählt offene Heute-Items; Deep-Link, Toggle, Datepicker, Back/Forward, Autosave; Screenshotvergleich Light/Dark bei 375 px und 640 px dokumentieren.

---

## Meilenstein B — Zeichnungen mit Excalidraw

Beginnt erst nach visueller Abnahme von Meilenstein A. Darf den Initial-Load der Tagesansicht nicht vergrößern.

### Schritt 6 — Schema und Sketch-API (v5.1.21)

- `db.php`: neue Migrationsstufe (`schema_version = 2`, Muster `migrateParchmentSchema` db.php:56 — FK off, Transaktion, `foreign_key_check`): `ALTER TABLE items ADD COLUMN sketch TEXT NOT NULL DEFAULT ''`; `categories`-Rebuild mit CHECK inkl. `'drawings'` (wie beim `daily_notes`-Rebuild db.php:89–111); frisches CREATE TABLE (467) ebenfalls erweitern.
- `src/Constants.php:4`: `'drawings'` in `CATEGORY_TYPES` (Kategorie-CRUD-Validierung zieht daraus).
- `public/api.php`: `formatListItem` (1616) + `formatJournalItem` (1663) liefern nur `has_sketch` (nur echte gespeicherte Zeichnungen, leere Szene ≠ Skizze); GET `sketch` (item_id, Ownership); POST `sketch_save` (CSRF, Ownership, `json_decode`-Prüfung, 2-MB-Limit).
- Tests: `scripts/test-db-migration.sh` (frisch + Upgrade); smoke-test: Roundtrip, fremdes Item → 404/403, ungültiges JSON/Größenlimit → 422; Szeneninhalt taucht nicht in FTS-Suche auf.

### Schritt 7 — Zeichnungen-Kategorie und Vollbildeditor (v5.1.22)

- `security.php` (462): bei `allowEsmSh` zusätzlich `style-src https://esm.sh` und neue Direktive `font-src 'self' https://esm.sh`.
- Neu `public/js/excalidraw-init.js`: React/React-DOM/Excalidraw mit gepinnten kompatiblen Versionen von esm.sh, `window.EXCALIDRAW_ASSET_PATH`, `window.ExcalidrawLib = { Excalidraw, createRoot, serializeAsJSON, exportToSvg, restore }`, Ready-Event; CSS erst beim ersten Öffnen dynamisch als `<link>`; Datei wird per `import()` erst beim ersten Editor-Öffnen geladen.
- Neu `public/js/sketch-editor.js`: Vollbild-Overlay (Muster lightbox.js); Szene erst beim Öffnen laden (`api('sketch&item_id=…')`); onChange 800 ms debounced → `sketch_save`; Save-Status + robuste Fehlermeldung; beim Schließen Flush, dann React-Root unmounten; Offline-/CDN-Fehler beeinträchtigen die App nicht.
- Integration: `drawings` in `TYPE_CONFIG` (state.js) + Kategorie-Typauswahl (settings.php); `items-view.js`: Tap auf Zeichnungs-Item öffnet Sketch-Editor; `items-actions-add.js`: neues Zeichnungs-Item öffnet direkt leere Szene; sw.js: neue JS-Dateien precachen (CDN-Assets nicht); `lang/de.json`/`en.json`.
- Tests: Kategorie anlegen → zeichnen → Autosave → Reload; sofortiges Schließen bei ausstehendem Save; Offline-Öffnen mit verständlicher Meldung; sehr große/ungültige/leere Szenen.

### Schritt 8 — Optionale Tages-Skizze (v5.1.23)

Minimal-invasiv ins Parchment-Layout:

- **Ohne Skizze keine dauerhafte dritte Karte** — nur kleiner Stift-Button im Kopf der Notiz-Karte („Skizze hinzufügen"). Existiert eine Skizze, erscheint darunter eine dritte, **einklappbare** Parchment-Karte mit kompakter Vorschau.
- Backend: `journal`-Response (api.php:2055) liefert `has_sketch` + Item-ID; erster Sketch-Save an einem Tag ohne Journal-Item nutzt serverseitig dasselbe Get-or-create wie `journal_save` (Insert-Logik als Helper extrahieren) — **kein** künstlicher leerer Notizinhalt vom Client.
- Frontend (`journal.js`): Datumwechsel aktualisiert `has_sketch`; Initialansicht lädt keine Excalidraw-Bibliothek; vorhandene Skizze zeigt statischen „Skizze öffnen"-Platzhalter (oder separat gespeicherte Vorschau); `exportToSvg` nur, wenn Excalidraw ohnehin schon geladen; nach Editor-Schließen Status + Vorschau refreshen.
- `style.css`: `.sketch-card` im `.parchment-card`-Look, Vorschau kompakt (max-height ~240 px, overflow hidden), einklappbar.
- Tests: Skizze für Heute erstellen/schließen/erneut öffnen; Gestern/Morgen unabhängige Skizzen; Tag ohne Skizze zeigt nur die kleine Aktion; Reload ohne Excalidraw-Bundle; Zeichnung bleibt außerhalb der FTS-Suche.

---

## Definition of Done (gesamt)

- Tagesansicht wirkt bei 375 px und 640 px erkennbar wie die Parchment-Referenz; Agenda bleibt mobil zweispaltig.
- Screen-Header der Tagesansicht besteht im Wesentlichen aus Kalender, Segmentleiste, Einstellungen.
- Agenda, Tagesnotiz und optionale Skizze wechseln atomar auf dasselbe Datum.
- Today-/Daily-Notes-Tabs entfernt, URLs und Manifest-Shortcuts kompatibel.
- Autosave wird vor Navigation zuverlässig geflusht; Toggle, Deep-Link, Quick-Add, Badge funktionieren.
- Excalidraw wird nicht beim App-Boot geladen; CDN-Ausfall beschädigt die App nicht; Szene-JSON weder in Listenresponses noch in FTS.
- Smoke-Test, Migrationstest, Cache-Version-Check und Syntaxchecks grün.
