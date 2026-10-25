# Modulgrenzen und Audit-Verträge

`public/api.php` authentisiert, setzt HTTP-Header und ordnet bekannte Actions
explizit einem Controller zu. SQL, Normalisierung und neue Actions gehören nach
`src/Api/`. Die Controller erhalten Datenbank, Nutzer-ID und Action ausdrücklich;
die Mandanten- und Revisionsprüfungen bleiben im jeweiligen Anwendungsfall.
HTTP, Idempotenz, Remote-Fetch, Rich-Text-Sanitizing, Produktnormalisierung und
Attachment-Validierung haben eigene Module. `npm run test:architecture` verhindert,
dass Actions und SQL wieder im Einstieg landen.

Bei Requests mit Idempotency-Key bleiben Reservierung, Fachmutation und Antwort
in einer SQLite-Transaktion. Innere Transaktionen sind Savepoints. Ein Fehler
beim Antwortschreiben rollt alles zurück; ein Prozessabbruch tut dasselbe über
SQLite. Langsame Remote-Downloads persistieren zuerst nur die Reservierung und
geben die Schreibsperre frei. Erst danach beginnen Mutation und Antwortabschluss
gemeinsam. Der Drei-Stunden-Reclaim gilt ausschließlich für alte Reservierungen
beziehungsweise abgebrochene Vorbereitung, nicht für bereits committete Mutationen.
Dateien bestehender Anhänge werden erst nach dem äußeren Commit entfernt;
Tombstones und persistente Cleanup-Jobs sichern Wiederholung nach einem Absturz.

`public/style.css` bestimmt ausschließlich die Importreihenfolge. Komponenten
liegen unter `public/styles/`; die abschließende Workbench-Schicht behält ihre
bisherige Kaskadenposition. Neue Komponenten erhalten eigene Stylesheets.
Farbliterale gehören in `tokens.css`, `styles/roles.css` oder die expliziten
Theme-Definitionen, Komponenten verwenden semantische Rollen. Statusflächen
werden mit der aktuellen Oberfläche gemischt; dunkle Themes überschreiben
Statusrollen. Die standardisierten Nutri-Score-Farben bleiben unabhängig vom Theme.
`npm run test:design` prüft Komponenten statt nur einen Kommentarstempel.

Alle JS- und Komponenten-CSS-Dateien stehen in `public/app-shell-assets.json`.
Nach neuen Modulen muss diese sortierte Liste ergänzt werden;
`php scripts/check-app-shell.php` zeigt bei Abweichung den erwarteten Inhalt.
Installation, Vendor-Manifest und vollständiger Precache sind verpflichtend.
JS/CSS werden auch in Unterverzeichnissen versioniert aus dem Cache bedient;
lokale Editor-Chunks und Schriften bleiben offline erreichbar.

## Prüfungen

- `php scripts/test-transactions.php`: Savepoints, Commit-/Rollback-Verhalten,
  verzögerte Dateibereinigung und Worker-Abbruch.
- `bash scripts/smoke-test.sh`: HTTP-Verträge einschließlich erzwungenem Fehler
  beim Antwortabschluss, sicherem Retry und Secret-Redaction.
- `npm run test:websocket`: ungültige/abgelaufene Tickets, fremder Origin,
  wirkungslose fremde UID, getrennte Nutzerkanäle, gesperrte Yjs-Räume und Notify-Limits.
- `npm run test:service-worker`: Installationsabbruch ohne Aktivierung sowie
  Offline-Routing für JS, CSS und Vendor-Dateien im Unterverzeichnis.
- `npm run test:ui`: Desktop- und Mobile-Journeys einschließlich Kaltstart ohne
  HTTP-Cache, erstmaliger Offline-Nutzung beider Editoren und späterer Synchronisation.
  Ein englischer Einstellungs-/Navigationsablauf prüft außerdem sichtbare
  Werkzeugnamen und eine übersetzte Validierungsantwort.

UI-Tests wählen einen freien Port; explizite `PLAYWRIGHT_PORT`- und
`PLAYWRIGHT_BASE_URL`-Werte bleiben möglich. Ein Restrennen nach der Portwahl
wird vor jeder Bereinigung der Testdaten abgefangen. Die optionale lokale
Reuse-Konfiguration benötigt einen zuvor gestarteten Server und explizite Basis-URL.

Automatische DOM- und Ergonomieprüfungen ersetzen keine moderierten Erstnutzer-
Tests. Die Aufgaben „Neue Notiz“, „Barcode scannen“ und „Ansicht wechseln“ bleiben
eine sinnvolle externe Validierung; sie sind kein offener Implementierungsfehler.
