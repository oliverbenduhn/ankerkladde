# Mehr Parchment: kombinierte Tagesansicht und Zeichnungen

## Zielbild

Die bisher getrennten Ansichten „Heute“ und „Tagesnotiz“ werden zu einer gemeinsamen, datumszentrierten Tagesansicht zusammengeführt. Sie soll sich in Aufbau, Proportionen und visueller Hierarchie so eng wie sinnvoll an der Parchment-iOS-App orientieren:

- kompakter Screen-Header mit Kalender links, Gestern/Heute/Morgen in der Mitte und Einstellungen rechts
- große linksbündige Datumsüberschrift in Serifenschrift, ohne Jahr
- Agenda-Karte mit dauerhaft zwei Spalten: „Ganztägig + ohne Uhrzeit“ und „Terminiert“
- Tagesnotiz-Karte darunter mit Serifentitel, reduziertem Kartenkopf und Mono-Editor
- identische Datumsnavigation für Agenda und Tagesnotiz
- auf Mobilgeräten weiterhin zwei Agenda-Spalten wie in der Referenz
- Light- und Dark-Theme mit denselben Größen und Abständen

Die vorhandene Datenschicht wird wiederverwendet: `due_time`, `agenda_group`, `daily_notes`, Journal-API mit `date`, Badge-API und Journal-History sind bereits vorhanden. Für Agenda und Journal bleiben zwei parallele Requests bestehen.

Die Excalidraw-Integration bleibt Bestandteil des Gesamtvorhabens, wird aber als eigener Meilenstein nach der fertigen Parchment-Tagesansicht umgesetzt. So kann die Referenzansicht zuerst visuell abgeschlossen und abgenommen werden.

## Visuelle Leitplanken

### Breite und Grundlayout

- Die bestehende App-Breite von maximal 640 px bleibt die maßgebliche Desktop-/Tablet-Breite.
- Keine wirkungslose 880-px-Innenbreite innerhalb der bereits auf 640 px begrenzten App.
- `.parchment-view` erhält `width: 100%`, `max-width: 640px`, horizontales Padding von etwa 10 px und unteren Abstand.
- Kartenabstand: ungefähr 10–12 px.
- Karten sollen ihren Inhalt vollständig zeigen und keine eigenen vertikalen Scrollbereiche erhalten; gescrollt wird die Tagesansicht.

### Parchment-Screen-Header

In der Tagesansicht wird der normale Ankerkladde-Header visuell zu einer kompakten Parchment-Chrome reduziert:

- links: Kalender-Button; öffnet den nativen Datepicker
- Mitte: Segmentleiste Gestern / Heute / Morgen
- rechts: Einstellungen
- Branding, Kategorieuntertitel, Mode-Chip, Suche, Layout, Tabs, Scanner, Magic und Fortschritt werden in dieser Ansicht ausgeblendet
- keine zweite sichtbare Kalender-Schaltfläche neben der Segmentleiste
- der neue globale Kalender-Button öffnet aus anderen Ansichten die Tagesansicht; innerhalb der Tagesansicht dient er als Datepicker-Auslöser

Für benutzerdefinierte Daten außerhalb Gestern/Heute/Morgen bleibt kein Segment gedrückt. Das gewählte Datum steht weiterhin in der großen Überschrift und im versteckten Date-Input.

### Agenda auf Mobilgeräten

Die zwei Agenda-Spalten werden **nicht** unter 640 px gestapelt. Parchment behält sie auch bei etwa 375 px Bildschirmbreite bei.

- Standard: `grid-template-columns: minmax(0, 48fr) minmax(0, 52fr)`
- vertikaler Spaltentrenner bleibt erhalten
- unter etwa 420 px werden Padding, Spaltengap, Überschriften und Metadaten verkleinert
- lange Namen umbrechen; `min-width: 0` an allen Grid-/Flex-Kindern
- keine horizontale Scrollleiste
- Checkbox optisch 18–20 px, aber Touch-Ziel mindestens 40 × 40 px

### Typografie und Karten

- `--font-serif`: Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, Georgia, serif
- `--font-mono`: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace
- Datums- und Kartenüberschriften: Serifenschrift
- Segmentleiste, Spaltenlabels und Metadaten: System-Sans
- Notizinhalt: Mono, Zeilenhöhe etwa 1.55
- `--radius: 14px` wird in `:root` definiert
- Light-Theme: Karten vor allem über Flächenunterschied und sehr sanften Schatten absetzen; Rand nur subtil
- Dark-Theme: Rand darf sichtbarer sein, Größen und Abstände bleiben identisch
- nur Theme-Tokens verwenden; keine fest verdrahteten Light-/Dark-Farben in Komponenten

### Agenda-Zeilen

- Checkbox links, Inhalt daneben
- Name oben, Zeit/„Ganztägig“/„Überfällig“ darunter
- Überfällig-Markierung rot
- Uhrzeit mit `font-variant-numeric: tabular-nums`
- Kategorie höchstens als zurückhaltende Zusatzinformation; sie darf nicht stärker als Zeit oder Status wirken
- erledigte Einträge kurz optimistisch markieren, dann nach erfolgreichem Toggle aus der offenen Agenda entfernen
- Klick auf Checkbox toggelt, Klick auf den restlichen Eintrag öffnet das Quell-Item

### Tagesnotiz

Die komplette TipTap-Toolbar bleibt funktional, ist im Grundzustand aber nicht dauerhaft als zwölfteilige Leiste sichtbar.

- Kartenkopf: Titel links, rechts kompakter Format-Button sowie optional eine vorhandene sinnvolle Hauptaktion
- Format-Button klappt die bestehende Toolbar innerhalb der Karte auf und wieder zu
- Editor liegt in einer leicht abgesetzten inneren Fläche
- Speicherstatus wird nur während des Speicherns, bei Erfolg kurzzeitig oder bei Fehlern gezeigt
- der Editor bleibt per Tastatur und Screenreader vollständig bedienbar

## Technische Leitentscheidungen

1. `journal` bleibt der kanonische Screen. `today` wird als Route auf `journal` normalisiert.
2. Agenda und Journal werden über `Promise.all` parallel geladen; kein neuer kombinierter Endpoint.
3. Der Agenda-Toggle verwendet die bestehende API-Action `toggle`, nicht den auf `state.items` zugeschnittenen allgemeinen Handler.
4. Gestern/Heute/Morgen sind absolute Ziele relativ zu `serverToday`, keine relativen Stepper.
5. Bestehende Manifest-Shortcuts bleiben kompatibel: `?screen=today` wird zum Journal-Alias; `?screen=journal&date=today&focus=editor` bleibt erhalten.
6. Vor einem Deep-Link aus der Agenda wird der Journal-Editor geschlossen und ein ausstehender Save geflusht.
7. WebSocket-Updates aktualisieren in der Tagesansicht nur die Agenda, nicht den gerade bearbeiteten Notizinhalt.
8. Excalidraw-Szenen werden getrennt vom durch FTS indexierten `content` in `items.sketch_json` gespeichert und lazy übertragen.

## Arbeitsweise je Release-Schritt

Jeder Schritt ist einzeln testbar und wird vollständig abgeschlossen:

1. Version in `public/version.php` und `public/sw.js` erhöhen.
2. Alle `?v=…`-Imports in `public/js/*.js` synchronisieren.
3. Geänderte PHP-Dateien mit `php -l` prüfen.
4. `scripts/check-js-cache-versions.php` und passende Spezialchecks ausführen.
5. `bash scripts/smoke-test.sh` ausführen.
6. Commit erstellen und zu `origin main` pushen.
7. Ergebnis laut `CLAUDE.md` berichten und auf „weiter“ warten.

---

## Meilenstein A — Parchment-Tagesansicht

### Schritt 1 — Datumsfähige Agenda-API (v5.1.16)

`public/api.php`, Action `today`:

- optionalen `date`-Parameter über `normalizeJournalDate()` akzeptieren
- ohne Parameter unverändertes Heute-Verhalten inklusive überfälliger Items
- für `date === serverToday`: `due_date <= :today`, Überfällige in `overdue` falten
- für andere Daten: ausschließlich `due_date = :date`, `done = 0`; keine historische Überfällig-Faltung
- Sortierung innerhalb der Gruppen stabil nach `due_time` und `sort_order`
- Response additiv als `{ today: serverToday, date, items }`

Smoke-Tests:

- ohne Parameter und mit `date=<serverToday>` liefern äquivalente Items
- festes historisches Datum liefert nur exakt an diesem Tag fällige Items
- ungültiges Datum liefert 422
- manuelle Prüfung per `curl`

### Schritt 2 — Funktionale Komposition im Journal (v5.1.17)

`public/index.php`:

- `#journalView` zur `.parchment-view` umbauen
- vorhandene IDs behalten, damit die Journal-Logik schrittweise migriert werden kann
- kompakten Tages-Header mit Kalender, Segmentleiste und Einstellungen vorbereiten
- nativen Datepicker versteckt im DOM behalten
- Datumsüberschrift unterhalb des Headers
- Agenda-Karte mit `#agendaUntimedList`, `#agendaScheduledList` und `#agendaAddBtn`
- Notiz-Karte mit Kartenkopf, `#journalSaveStatus`, einklappbarer `#journalToolbar` und `#journalEditorBody`

`public/ui-sprite.php`:

- neues `icon-calendar` auf Basis von Lucide `calendar-days`
- Sprite-Check ausführen

`public/js/ui.js`:

- neue DOM-Referenzen für Agenda, Kalenderbutton und Format-Toggle exportieren

`public/js/today-view.js`:

- Controller zu `loadAgenda(date)`, `renderAgenda()` und `refreshTodayBadge()` umbauen
- linke Spalte enthält `overdue` und `anytime_today`
- rechte Spalte enthält `scheduled`
- kompaktes Zeilenmarkup mit Checkbox-Touchziel, Name und Metadaten
- optimistischer Toggle; bei API-Fehler Zustand zurückrollen und Fehler anzeigen
- danach Agenda neu laden, Kategoriecache invalidieren und Badge aktualisieren
- Quell-Item über den restlichen Zeilenbereich öffnen

`public/js/journal.js`:

- Notiz und Agenda parallel laden
- Datumsüberschrift ohne Jahr formatieren
- Segmentzustand über `aria-pressed` setzen
- Segmentbuttons immer auf `serverToday - 1`, `serverToday`, `serverToday + 1` führen
- bei einem anderen gewählten Datum sind alle drei Segmente inaktiv
- Kalenderbutton öffnet `showPicker()` mit Fallback auf Fokus/Klick für Browser ohne Unterstützung
- Editor-Save vor Datumswechsel und Deep-Link flushen

`public/js/router.js` und `public/js/app-runtime.js`:

- Agenda-Abhängigkeiten verdrahten
- vor `openSourceItem()` das Journal sauber schließen

Funktionsprüfung:

- Agenda und Notiz erscheinen gemeinsam
- alle drei Segmente wechseln beide Bereiche
- freies Datum über Datepicker funktioniert
- Toggle navigiert nicht
- Item-Tap deep-linkt und hebt das Item hervor
- ausstehende Notizänderungen gehen beim Wechsel nicht verloren

### Schritt 3 — Routing, Tabs und Zugänge konsolidieren (v5.1.18)

`public/js/navigation.js`:

- `today` vor der Whitelist-Prüfung zu `journal` normalisieren
- Alias in initialer URL, History und Popstate einheitlich behandeln

`public/js/router.js`:

- separaten Today-Screen und dessen Open-/Close-Branches entfernen
- Journal als einzige Tagesansicht verwenden

`public/js/tabs-view.js`:

- Today-Tab entfernen
- `daily_notes` nur aus der sichtbaren Tab-Leiste filtern, nicht aus Move-Zielen oder den zugrunde liegenden Kategorien

`public/index.php` und `public/js/app-events.js`:

- alten `todayNoteBtn` entfernen
- Kalenderbutton als globalen Einstieg zur Tagesansicht ergänzen
- innerhalb der Tagesansicht denselben sichtbaren Button als Datepicker-Auslöser behandeln

`public/js/app-runtime.js`, `items-actions-add.js`, `app-init.js`, `app-entry.js`, `app-ui.js`:

- Today-spezifische Controlleraufrufe entfernen
- Badge separat über `refreshTodayBadge()` laden
- Quick-Add in der Tagesansicht lädt anschließend die Agenda des aktiven Datums
- WebSocket-Update lädt nur die Agenda neu
- Journal-Header blendet nicht passende globale Aktionen aus

`lang/de.json` und `lang/en.json`:

- Agenda-, Notiz-, Spalten-, Format- und Datepicker-Texte ergänzen
- bestehende passende Today-/Journal-Texte weiterverwenden

Routingprüfung:

- kein Heute- und kein Tagesnotizen-Tab
- Kalenderbutton öffnet die Tagesansicht
- `?screen=today` funktioniert als Alias
- Journal-Manifest-Shortcut fokussiert weiter den Editor
- Back/Forward und Reload erhalten Datum und Screen

### Schritt 4 — Parchment-Chrome und exaktes Styling (v5.1.19)

`public/style.css`:

- `--radius`, `--font-serif` und `--font-mono` definieren
- undefinierte `var(--text)` und `var(--bg-elevated)` durch vorhandene Tokens ersetzen
- tote Today-Screen-Regeln entfernen
- normale Header-Inhalte in `.app.journal-view` ausblenden und Parchment-Chrome darstellen
- Segmentleiste als kompakte Pill-Leiste umsetzen
- Datum groß, linksbündig und in Serifenschrift
- Karten mit 14 px Radius, subtiler Theme-Fläche, feinem Rand und sanftem Schatten
- Agenda dauerhaft zweispaltig, einschließlich 375 px Viewport
- unter 420 px nur Dichte reduzieren, nicht stapeln
- Checkbox-Touchfläche von der sichtbaren Kreisgröße trennen
- Metadaten unter dem Namen anordnen
- Notizeditor in Mono, Kartenkopf und Datum in Serif
- Toolbar einklappbar gestalten
- `.list-area` beziehungsweise `.parchment-view` als einzigen Scrollcontainer sicherstellen

Richtwerte:

```css
.parchment-view {
    width: 100%;
    max-width: 640px;
    margin: 0 auto;
    padding: 0 10px 24px;
}

.agenda-columns {
    display: grid;
    grid-template-columns: minmax(0, 48fr) minmax(0, 52fr);
}
```

Visuelle Abnahme:

- Referenzvergleich bei 375 × 812 und 640 × 900
- zwei Spalten ohne horizontales Scrollen bei 375 px
- Segmentleiste bleibt vollständig in einer Zeile
- Datum ohne Jahr
- keine dauerhaft sichtbare Volltoolbar
- identische Maße in Light und Dark
- lange deutsche und englische Itemnamen geprüft
- leere linke, leere rechte und komplett leere Agenda geprüft
- vorhandene Stellen mit `var(--radius)` visuell kontrolliert

### Schritt 5 — Agenda-Quick-Add und Abschluss (v5.1.20)

`public/js/app-events.js`:

- Plus im Agenda-Kartenkopf öffnet die bestehende Quick-Add-Eingabe und fokussiert `itemInput`

`public/style.css`:

- Eingabe in `.app.journal-view.quick-add-open` sichtbar machen
- als kompakte, zur Karte gehörende Fläche gestalten

`public/js/items-actions-add.js`:

- nach erfolgreichem Add `quick-add-open` entfernen
- Agenda für `state.journalDate` aktualisieren
- bei Fehler Eingabe geöffnet und Inhalt erhalten lassen

Aufräumen:

- tote `.today-*`-Klassen und ungenutzte i18n-Keys entfernen
- `changelog.md` aktualisieren

Endabnahme Meilenstein A:

- `Zahnarzt morgen 8:00` erscheint beim Wechsel auf Morgen rechts in „Terminiert“
- Ganztagesaufgabe erscheint links
- Badge zählt weiterhin die offenen Heute-Items
- Deep-Link, Toggle, Datepicker, Back/Forward und Autosave funktionieren
- Screenshotvergleich in Light, Dark, 375 px und 640 px dokumentieren

---

## Meilenstein B — Zeichnungen mit Excalidraw

Dieser Meilenstein beginnt erst nach der visuellen Abnahme der Parchment-Tagesansicht. Die Zeichnungen dürfen deren Initial-Load nicht vergrößern.

### Schritt 6 — Schema und Sketch-API (v5.1.21)

`db.php`:

- neue Migrationsstufe für `items.sketch_json TEXT NOT NULL DEFAULT ''`
- `categories`-CHECK um `drawings` erweitern; SQLite-Tabelle nach vorhandenem Migrationsmuster sicher rebuilden
- frisches Schema und Upgrade bestehender Datenbanken unterstützen

`src/Constants.php`:

- `drawings` zu `CATEGORY_TYPES` hinzufügen

`public/api.php`:

- Listen- und Journal-Responses liefern nur `has_sketch`, niemals die Szene
- GET-Action `sketch` mit Ownership-Prüfung
- POST-Action `sketch_save` mit CSRF, Ownership, JSON-Prüfung und 2-MB-Limit
- leere Szene eindeutig behandeln; `has_sketch` soll nur echte gespeicherte Zeichnungen signalisieren

Tests:

- Migration auf frischer und bestehender DB
- Save-/Load-Roundtrip
- fremdes Item nicht les- oder schreibbar
- ungültiges JSON und Größenlimit
- Szeneninhalt taucht nicht in FTS-Suchergebnissen auf

### Schritt 7 — Zeichnungen-Kategorie und Vollbildeditor (v5.1.22)

`security.php`:

- für `allowEsmSh` `style-src https://esm.sh` ergänzen
- `font-src 'self' https://esm.sh` ergänzen

`public/js/excalidraw-init.js`:

- React, React DOM und Excalidraw mit fest gepinnten kompatiblen Versionen dynamisch von esm.sh importieren
- `window.EXCALIDRAW_ASSET_PATH` setzen
- benötigte Funktionen über `window.ExcalidrawLib` bereitstellen
- Ready-Event auslösen
- CSS nur beim ersten Öffnen dynamisch ergänzen

`public/js/sketch-editor.js`:

- Vollbildoverlay nach dem Lightbox-Muster
- Szene erst beim Öffnen laden
- Änderung 800 ms debouncen
- Save-Status und robuste Fehlermeldung anzeigen
- beim Schließen ausstehenden Save flushen, danach React-Root unmounten
- Offline-/CDN-Fehler dürfen die restliche App nicht beeinträchtigen

Frontendintegration:

- `drawings` in `TYPE_CONFIG` und Einstellungen ergänzen
- Item-Tap öffnet Sketch-Editor
- neues Zeichnungs-Item öffnet direkt eine leere Szene
- neue JS-Dateien im Service Worker precachen; CDN-Assets nicht als App-Shell behandeln
- deutsche und englische Texte ergänzen

Tests:

- Kategorie anlegen, Zeichnung erstellen, autosaven und neu laden
- sofortiges Schließen während ausstehendem Save
- Offline-Öffnen mit verständlicher Fehlermeldung
- sehr große, ungültige und leere Szenen

### Schritt 8 — Optionale Tages-Skizze (v5.1.23)

Die Tages-Skizze verändert das Parchment-Grundlayout nur minimal:

- ohne vorhandene Skizze keine dauerhaft große dritte Karte
- ein kleiner Stift-Button im Kopf der Tagesnotiz bietet „Skizze hinzufügen“ an
- sobald eine Skizze existiert, darf darunter eine dritte Parchment-Karte mit kompakter Vorschau erscheinen
- die Karte kann eingeklappt werden, damit Agenda und Notiz die visuelle Hauptrolle behalten

Backend:

- Journal-Response liefert `has_sketch` und die Item-ID
- für einen Tag ohne Journal-Item wird beim ersten Sketch-Save serverseitig dasselbe Get-or-create-Verhalten wie beim Journal-Save verwendet
- kein künstlicher leerer Notizinhalt vom Client nur zur Erzeugung einer Item-ID

Frontend:

- Datumwechsel aktualisiert auch `has_sketch`
- Initialansicht lädt keine Excalidraw-Bibliothek
- vorhandene Skizze zeigt zunächst einen statischen „Skizze öffnen“-Platzhalter oder eine server-/clientseitig separat gespeicherte Vorschau
- `exportToSvg` darf erst verwendet werden, nachdem Excalidraw ohnehin geladen wurde
- nach Schließen des Editors Status und Vorschau aktualisieren

Tests:

- Skizze für Heute erstellen, schließen und erneut öffnen
- Gestern/Morgen besitzen unabhängige Skizzen
- Tag ohne Skizze zeigt nur die kleine Aktion, keine leere Großkarte
- Reload lädt die Parchment-Ansicht ohne Excalidraw-Bundle
- vorhandene Zeichnung bleibt außerhalb der FTS-Suche

## Gesamte Definition of Done

- Die Tagesansicht wirkt bei 375 px und 640 px erkennbar wie die Parchment-Referenz.
- Agenda bleibt bei Mobilbreite zweispaltig.
- Der Screen-Header besteht in dieser Ansicht im Wesentlichen aus Kalender, Segmentleiste und Einstellungen.
- Agenda, Tagesnotiz und optionale Skizze wechseln atomar auf dasselbe Datum.
- Today- und Daily-Notes-Tabs sind entfernt, URLs und Manifest-Shortcuts bleiben kompatibel.
- Autosave wird vor Navigation zuverlässig geflusht.
- Agenda-Toggle, Deep-Link, Quick-Add und Badge funktionieren.
- Excalidraw wird nicht beim App-Boot geladen und ein CDN-Ausfall beschädigt die App nicht.
- Szene-JSON wird weder in Listenresponses ausgeliefert noch durch FTS indexiert.
- Smoke-Test, Migrationstest, Cache-Version-Check und relevante Syntaxchecks sind grün.
