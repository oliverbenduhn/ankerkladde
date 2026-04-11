# Ankerkladde Extension

<p align="center">
  <img src="../public/branding/ankerkladde-logo.png" alt="Ankerkladde" width="140">
</p>

Browser-Erweiterung zum Speichern von Links, Bildern und Dateien direkt nach Ankerkladde.

## Unterstützte Browser

- **Chrome** - Diese Extension
- **Edge** - Die gleiche Chrome-Extension funktioniert auch (Edge basiert auf Chromium)
- **Firefox** - Separate Firefox-Version (`ankerkladde-extension-firefox.zip`)

## Installation

### Chrome / Edge

1. In Chrome/Edge `chrome://extensions` öffnen.
2. Oben rechts `Entwicklermodus` aktivieren.
3. `Entpackte Erweiterung laden` klicken.
4. Den Ordner `browser-extension/` in diesem Projekt auswählen.

### Firefox

1. In Firefox `about:addons` öffnen.
2. Das Zahnrad-Symbol klicken → `Add-on aus Datei installieren`.
3. Die Datei `browser-extension/ankerkladde-extension-firefox.zip` auswählen.

### ZIP bauen

1. Im Projektordner `browser-extension/` öffnen.
2. Falls nötig: `php build-icons.php` ausführen, um die PNG-Icons neu zu erzeugen.
3. `php build-extension.php` ausführen für Chrome/Edge.
4. `php build-firefox.php` ausführen für Firefox.
5. Die ZIP-Dateien entstehen automatisch als `ankerkladde-extension-v<version>.zip` und `ankerkladde-extension-v<version>-firefox.zip`.

Die PHP-Build-Skripte bauen die ZIP-Dateien ohne externe `zip`-Abhängigkeit. Die Versionsnummer wird aus dem jeweiligen Manifest übernommen.

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
- `list_quantity` / `list_due_date`: Seitentitel wird als Eintrag gespeichert

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
- Die Standard-Kategorieauswahl in der Extension arbeitet mit echten `category_id`-Werten, nicht mehr mit alten Bereichsschlüsseln wie `shopping` oder `notes`.
