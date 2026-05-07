# Ankerkladde

<p align="center">
  <img src="public/icons/icon-192.png" alt="Ankerkladde" width="180">
</p>

[Projektvorstellung ansehen →](https://oliverbenduhn.github.io/ankerkladde/vorstellung/)

Mobile-first PHP-Webanwendung und PWA für Einkaufslisten, Todos, Notizen, Bilder, Dateien und Links. Die App speichert ihre Daten in SQLite, läuft ohne großes Framework und bringt für Live-Updates sowie den Notizeditor optional einen separaten WebSocket-Dienst mit.

## Kurzüberblick

- Frei konfigurierbare Kategorien pro Nutzer mit Typen für Einkaufslisten, Aufgaben, Notizen, Bilder, Dateien und Links
- Zwei Arbeitsmodi: `Liste` zum Bearbeiten und `Einkaufen` zum Abhaken unterwegs
- Inline-Bearbeitung, Drag and Drop, Anheften, Sammellöschen erledigter Einträge und Volltextsuche per FTS5
- Bild- und Dateiupload mit Thumbnail-Erzeugung, sicherem Streaming und Austausch vorhandener Anhänge
- Rich-Text-Notizen mit TipTap; Live-Sync im Editor über Yjs/WebSocket
- Barcode-Scanner für Einkaufslisten sowie separate Produktseite mit lokalem Open-Food-Facts-Katalog
- "Magic Bar" mit Google Gemini für freie Eingaben wie "Zutaten für Lasagne", optional mit Spracheingabe im Browser
- Installierbare PWA mit Service Worker, Offline-Seite, Share Target und Update-Reload
- Kuratierte Light- und Dark-Themes mit Vorschaukarten in den Einstellungen
- Browser-Erweiterung für Chrome/Edge und Firefox, authentifiziert über `X-API-Key`

## Was aktuell im Repo steckt

### Produktfunktionen

- Kategorien sind frei anlegbar, umbenennbar, ausblendbar und sortierbar.
- Verfügbare Kategorien-Typen: `list_quantity`, `list_due_date`, `notes`, `images`, `files`, `links`
- Einkaufslisten können Mengen und Barcodes speichern.
- Aufgabenlisten unterstützen Fälligkeitsdaten.
- Links können Metadaten wie Titel und Beschreibung serverseitig nachladen.
- Die Suche durchsucht alle Kategorien eines Nutzers.

### Medien und Uploads

- Genau ein Anhang pro Item
- Bilder und Dateien werden unter `data/uploads/` gespeichert, nicht im Webroot
- Bilder können Thumbnails bekommen, wenn `gd` verfügbar ist
- Bilder werden inline ausgeliefert, Dateien standardmäßig als Download
- In `public/.user.ini` sind hohe Upload-Grenzen für Datei-Workflows vorbereitet

### Notizen und Echtzeit

- Der Notizeditor basiert auf TipTap
- Bei laufendem WebSocket-Dienst werden Notizen über Yjs live synchronisiert
- Änderungen an Listen und Einstellungen können ohne Reload an andere offene Tabs verteilt werden
- Versionsänderungen lösen einen automatischen Reload aus

### Scanner und KI

- Produktscan in der App für Einkaufslisten
- Separate Seite `public/barcode.php` für Produktdetails aus dem lokalen Katalog
- Ohne Produktkatalog funktioniert der Scan trotzdem; unbekannte Codes werden als generischer Artikel angelegt
- Mit hinterlegtem Gemini-Key kann die Magic Bar mehrere Einträge aus Freitext erzeugen
- Derselbe Key kann auch zur Aufbereitung importierter Produktdaten genutzt werden

### PWA, Settings und Erweiterung

- Install-Banner auf Login und App
- Manifest mit Share Target für Links und Dateien
- Einstellungen für Themes, Feature-Toggles, Kategorien, Passwort, KI und Browser-Erweiterung
- Direktdownloads für die Browser-Erweiterung werden in der App on demand als ZIP erzeugt

### Nutzer und Sicherheit

- Session-basierter Login mit Admin- und Normalnutzer-Rollen
- CSRF-Schutz für schreibende Requests
- Kanonische Host-Weiterleitung für produktive Deployments
- Proxy-Header werden nur gezielt vertraut
- Attachment-Pfade werden ausschließlich serverseitig aus Datenbankwerten gebildet
- Link-Metadaten dürfen nur von externen, öffentlichen HTTP(S)-Zielen geladen werden

## Architektur

| Pfad | Zweck |
| --- | --- |
| `public/` | App-Shell, Login, Settings, JSON-API, PWA-Assets |
| `public/js/` | Frontend als ESM-Module |
| `db.php` | SQLite-Initialisierung, Migrationen, Kategorien-, Nutzer- und Produkt-Helper |
| `security.php` | Session, CSRF, Host-/Proxy-Logik, Basis-Pfade |
| `websocket-server/` | Live-Updates, Versionsbroadcasts und Yjs-Räume für Notizen |
| `browser-extension/` | Browser-Erweiterung für Chromium und Firefox |
| `scripts/` | Nutzeranlage, Smoke-Tests, DB-Migrationstests, Open-Food-Facts-Import |
| `tests/ui/` | Playwright-UI-Tests |
| `deploy/` | Apache-/Docker-Konfiguration und Deploy-Helfer |

### Datenhaltung

- Hauptdatenbank: `data/einkaufsliste.db`
- Optionaler Produktkatalog: `data/products.db`
- Schema-Migrationen laufen automatisch beim Start der App bzw. beim ersten Request

## Voraussetzungen

- PHP 8.1+; empfohlen ist die Docker-Variante mit PHP 8.3
- PHP-Erweiterungen: `pdo_sqlite`, `curl`, `mbstring`
- Für Bild-Thumbnails zusätzlich `gd`
- Node.js nur für den WebSocket-Server, Playwright-Tests und Browser-Extension-Workflows

## Schnellstart mit Docker

Die Compose-Konfiguration startet die Web-App und den WebSocket-Dienst zusammen.

```bash
git clone https://github.com/oliverbenduhn/ankerkladde.git
cd ankerkladde
docker compose up -d --build
docker exec -it ankerkladde php scripts/create-admin.php
```

Danach ist die App unter [http://localhost:8083](http://localhost:8083) erreichbar.

Hinweise:

- Die Daten landen per Default in `./data`.
- Apache proxyt `/ws/` auf den WebSocket-Container.
- Der Docker-Stack stellt außerdem `/healthz` bereit.

## Lokal ohne Docker entwickeln

```bash
php -S 127.0.0.1:8000 -t public public/router.php
php scripts/create-admin.php
```

Dann im Browser `http://127.0.0.1:8000/login.php` aufrufen.

Optional kannst du weitere Nutzer anlegen:

```bash
php scripts/create-user.php
```

Nicht-interaktiv funktionieren auch die Umgebungsvariablen:

- `EINKAUF_ADMIN_USER` / `EINKAUF_ADMIN_PASS`
- `EINKAUF_ADMIN_FORCE_PASSWORD_CHANGE`
- `EINKAUF_REGULAR_USER` / `EINKAUF_REGULAR_PASS`
- `EINKAUF_USER` / `EINKAUF_PASS`

Im Docker-Container wird bei einer frischen Installation automatisch ein initialer Admin angelegt, falls noch kein Admin existiert:

- Benutzername: `admin`
- Passwort: `admin1234`
- Beim ersten Login ist ein Passwortwechsel zwingend erforderlich

Optional kannst du die Standardwerte mit `EINKAUF_BOOTSTRAP_ADMIN_USER` und `EINKAUF_BOOTSTRAP_ADMIN_PASS` überschreiben.

Wichtig:

- `localhost` und `127.0.0.1` gelten als Entwicklungsumgebung und werden nicht auf den kanonischen Produktionshost umgeleitet.
- Kamera, PWA-Installation und einige Browser-APIs brauchen HTTPS oder localhost.
- Beim nackten `php -S` ist kein Reverse Proxy für `/ws/` vorhanden. Die App läuft trotzdem, aber Live-Updates und Yjs-Notizen funktionieren erst mit zusätzlichem WebSocket-Setup.

## Wichtige Umgebungsvariablen

| Variable | Standard | Zweck |
| --- | --- | --- |
| `EINKAUF_DATA_DIR` | `./data` bzw. `/data` im Container | Speicherort für SQLite-Dateien und Uploads |
| `ANKERKLADDE_CANONICAL_HOST` | `ankerkladde.benduhn.de` | Produktiver Hostname; leer für freie Hostnamen |
| `ANKERKLADDE_SESSION_LIFETIME_DAYS` | `30` | Dauer, für die Browser-Login und PHP-Session gültig bleiben; `0` nutzt ein Browser-Session-Cookie |
| `EINKAUF_TRUST_PROXY_HEADERS` | automatisch nur lokal vertraut | Aktiviert Vertrauen in `X-Forwarded-*` |
| `WS_NOTIFY_URL` | `http://127.0.0.1:3000/notify` | Ziel für Update-Broadcasts aus `api.php` |
| `WS_HOST` | `127.0.0.1` | Host für WebSocket-Benachrichtigungen aus `settings.php` |
| `WS_PORT` | `3000` | Port für denselben Zweck |
| `EINKAUF_BOOTSTRAP_ADMIN_USER` | `admin` | Standard-Admin für frische Docker-Installationen |
| `EINKAUF_BOOTSTRAP_ADMIN_PASS` | `admin1234` | Initiales Passwort für denselben Admin; Passwortwechsel beim ersten Login bleibt aktiv |

## API in Kurzform

Die JSON-API liegt unter `public/api.php` und wird sowohl vom Frontend als auch von der Browser-Erweiterung genutzt.

| Action | Methode | Zweck |
| --- | --- | --- |
| `categories_list`, `categories_create`, `categories_update`, `categories_reorder`, `categories_delete` | `GET` / `POST` | Kategorien laden und verwalten |
| `list`, `add`, `upload`, `update`, `toggle`, `delete`, `clear`, `reorder`, `pin` | `GET` / `POST` | Items und Anhänge bearbeiten |
| `search` | `GET` | Nutzerweite Volltextsuche |
| `product_lookup`, `product_details` | `GET` | Produktdaten per Barcode laden |
| `fetch_metadata` | `GET` | Titel/Beschreibung/Bild zu einer externen URL holen |
| `preferences` | `GET` / `POST` | Nutzerpräferenzen lesen und speichern |

Die Browser-Erweiterung authentifiziert sich mit `X-API-Key`. Reguläre Browser-Sessions verwenden Session-Cookies und CSRF-Token. Im Docker-Betrieb werden PHP-Session-Dateien unter `/data/sessions` abgelegt und überleben damit Rebuilds oder Container-Neustarts, solange das Daten-Volume erhalten bleibt.

## WebSocket und Live-Sync

Wenn du Live-Updates und kollaborative Notizen nutzen willst, brauchst du den Dienst aus `websocket-server/`.

Mit Docker ist das bereits verdrahtet. Für einen klassischen Apache- oder Nginx-Betrieb brauchst du zusätzlich:

1. den Node-Dienst aus `websocket-server/`
2. einen Reverse Proxy für `/ws/`
3. einen erreichbaren `/notify`-Endpoint für PHP

Die Details stehen in:

- [WEBSOCKET-SETUP.md](WEBSOCKET-SETUP.md)
- [TipTapWebsocket.md](TipTapWebsocket.md)

## Open Food Facts importieren

Der Produktkatalog ist optional. Ohne Import funktioniert die App weiter, nur Produktnamen und Detailseiten bleiben dann begrenzt.

Import:

```bash
bash scripts/update-openfoodfacts.sh
```

Das Skript schreibt in `data/products.db` und kann je nach Datensatz sehr viel Speicherplatz brauchen.

## Browser-Erweiterung

Die Erweiterung kann Seiten, Links, Bilder und Dateien direkt nach Ankerkladde schicken.

Direkt im Repo bauen:

```bash
php browser-extension/build-extension.php
php browser-extension/build-firefox.php
```

Optional für neu erzeugte PNG-Icons:

```bash
php browser-extension/build-icons.php
```

Mehr Details stehen in [browser-extension/README.md](browser-extension/README.md).

## Tests

### Backend und Smoke-Tests

```bash
bash scripts/smoke-test.sh
bash scripts/test-db-migration.sh
php scripts/test-security.php
find . -path './.git' -prune -o -path './.worktrees' -prune -o -path './data' -prune -o -name '*.php' -print | sort | xargs -r -n1 php -l
```

### UI-Tests mit Playwright

```bash
npm install
npm run test:ui:install
npm run test:ui
```

Die UI-Tests starten ihren eigenen PHP-Testserver und legen temporäre Daten unter `.tmp/ui-test-data/` an.

## Deployment-Hinweise

- Die Docker-Variante nutzt `php:8.3-apache` und aktiviert `rewrite`, `headers`, `proxy`, `proxy_http` und `proxy_wstunnel`.
- Upload-Grenzen sind in `public/.user.ini` vorbereitet.
- Die mitgelieferte Apache-Konfiguration verweist den Dokumentenstamm auf `public/`.
- Für PWA, Kamera und installierbare Browser-Erlebnisse sollte die App hinter HTTPS laufen.

## Weiterführende Dateien

- [WEBSOCKET-SETUP.md](WEBSOCKET-SETUP.md)
- [TipTapWebsocket.md](TipTapWebsocket.md)
- [browser-extension/README.md](browser-extension/README.md)
- [public/theme_update.md](public/theme_update.md)
