# Versionsverlauf

Alle nennenswerten Änderungen an Ankerkladde werden hier zusammengefasst.

Aktuelle Version: `4.2.27`

## 4.2.27 - 2026-04-19

### Barrierefreiheit

- Einstellungen melden Status- und Fehlermeldungen jetzt per `role="alert"` an Screenreader.
- Admin-Formulare haben ARIA-Labels fuer vorher unbeschriftete Eingabefelder erhalten.
- Login-Fehler werden fuer Screenreader angekuendigt und betroffene Felder als ungueltig markiert.
- Weitere Eingabefelder mit fehlenden sichtbaren Labels wurden mit ARIA-Beschriftungen ergaenzt.

### Sicherheit

- Content-Security-Policy und `X-Frame-Options` werden fuer HTML-Seiten gesetzt.
- Erste Sicherheitsdokumentation fuer den Sentinel-Agenten wurde angelegt.

### Wartung und Performance

- `fetchRemoteHtml` wurde vereinfacht und besser wartbar gemacht.
- `ensureDefaultCategories` wurde performanter umgesetzt.
- Palette-UX-Agent fuer Micro-UX- und Accessibility-Verbesserungen wurde hinzugefuegt.

## 4.2.x - 2026-04-18

### Offline und Synchronisierung

- Offline-Queue fuer Hinzufuegen, Abhaken und Loeschen von Eintraegen eingefuehrt.
- Manueller Sync-Button und Polling-Fallback fuer Offline-zu-Online-Wechsel ergaenzt.
- Netzwerkfehler werden robuster behandelt, inklusive Schutz vor unbehandelten Promise-Fehlern.
- Loeschaktionen zeigen schneller Feedback und koennen fehlgeschlagene API-Aufrufe nachtraeglich synchronisieren.

### Admin und Produkte

- Admin-Oberflaeche fuer Produktverwaltung ueberarbeitet.
- Produktdatenbank-Status zeigt aussagekraeftigere Zusammenfassungen.
- Produktnormalisierung und KI-gestuetzte Datenaufbereitung wurden ergaenzt.

### Einstellungen und Themes

- Theme-Auswahl wurde durch Vorschaukarten ersetzt.
- Themes werden dynamisch geladen und Theme-Schaltflaechen passend gestylt.
- Automodus zeigt die ausgewaehlten Light-/Dark-Farben direkt am Punkt an.
- Regenbogen-Theme wurde ueberarbeitet; alte `grauton`-Keys werden migriert.
- Einstellungsseiten speichern Panel- und Tab-Zustand besser.
- Kategorien und Items werden nach dem Schliessen der Einstellungen neu geladen.

### Nutzer und Zugang

- Passwortwechselpflicht fuer Nutzer eingefuehrt.
- Footer-Jahr auf 2026 aktualisiert.

### Tests und Struktur

- Playwright-UI-Testsetup mit ersten Tests fuer Theme-Einstellungen hinzugefuegt.
- Code-Struktur an mehreren Stellen fuer Lesbarkeit und Wartbarkeit refaktoriert.
- README klarer strukturiert.
- Vorstellung per HTML-Preview vorbereitet.

## 4.2.5 - 2026-04-17

### Scanner, Suche und KI

- Produkt- und Einkaufslisten-Scanner sowie Feature-Toggles fuer Scanner und Magic Button eingefuehrt.
- Suchbutton und Schliessen-Button in App-Eventhandler integriert.
- Magic Bar mit Google-Gemini-Anbindung ausgebaut.
- Spracheingabe fuer Magic- und KI-Funktionen ergaenzt.
- Unterstuetzung fuer mehrere Gemini-Modelle und API-Key-Pruefung hinzugefuegt.
- Magic-Ausgaben zeigen bessere Toast-Meldungen und behandeln Kategorien sauberer.

### Produktkatalog

- Produktkatalog in eine separate `products.db` ausgelagert.
- Migration des Produktkatalogs liest zeilenweise statt per `fetchAll`, um Speicherverbrauch zu senken.

### Browser-Erweiterung

- Erweiterung auf Version `4.2.3` gebracht.
- Logo-Klick, Sonderzeichenbehandlung und Bild-Upload verbessert.
- Kontextmenue fuer Dateien, Firefox-Fix und Theme-Unterstuetzung ergaenzt.

### Fehlerbehebungen

- Offline-Modus repariert.
- Magic-Controller korrekt in den App-Start eingebunden.
- AI-Request-Handling und Fehlermeldungen verbessert.
- Klassen und Versionsangaben fuer Magic Bar, `main.js` und Service Worker aktualisiert.

