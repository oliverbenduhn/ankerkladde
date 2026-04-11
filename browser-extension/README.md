# Ankerkladde Extension

Chrome-Erweiterung zum Speichern von Links, Bildern und Dateien direkt nach Ankerkladde.

## Installation

1. In Chrome `chrome://extensions` öffnen.
2. Oben rechts `Entwicklermodus` aktivieren.
3. `Entpackte Erweiterung laden` klicken.
4. Den Ordner `browser-extension/` in diesem Projekt auswählen.

### ZIP bauen

1. Im Projektordner `browser-extension/` öffnen.
2. `./build-extension.sh` ausführen.
3. Die Datei `browser-extension/ankerkladde-extension.zip` entsteht automatisch.

Das Skript erzeugt zuerst die PNG-Icons und baut danach die ZIP-Datei ohne externe `zip`-Abhängigkeit.

## Vorbereitung in Ankerkladde

1. In Ankerkladde anmelden.
2. `Einstellungen` öffnen.
3. Im Abschnitt `Browser-Extension` den API-Key kopieren.

## Einrichtung in der Extension

1. Extension öffnen.
2. `Ankerkladde URL` eintragen.
   Beispiel lokal: `http://127.0.0.1:8000`
   Beispiel Produktion: `https://ankerkladde.benduhn.de`
3. API-Key einfügen.
4. Optional eine Standard-Kategorie wählen.

## Nutzung

### Aktuelle Seite speichern

- Extension öffnen
- `Aktuelle Seite speichern` klicken

Je nach gewählter Kategorie wird der aktuelle Tab gespeichert:

- `links`: URL wird als Link gespeichert
- `notes`: Seitentitel als Titel, URL als Inhalt
- `shopping`: URL wird als Eintrag gespeichert

### Dateien und Bilder speichern

- Dateien oder Bilder auf das Drag-and-Drop-Feld ziehen
- Bilder landen in `images`, andere Dateien in `files`

### API-Key erneuern

- In Ankerkladde unter `Einstellungen` auf `Neu erzeugen` klicken
- Den neuen Key danach in der Extension aktualisieren

## Hinweise

- Die Extension nutzt den Header `X-API-Key`.
- Für API-Key-Requests ist keine Browser-Session in Ankerkladde nötig.
- Nach Änderungen an Dateien der Extension in `chrome://extensions` auf `Neu laden` klicken.
- Das Quellicon liegt unter `browser-extension/icons/icon.svg`.
- PNG-Icons werden mit `browser-extension/build-icons.php` erzeugt.
