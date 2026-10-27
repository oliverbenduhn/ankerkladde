# Ankerkladde

<p align="center">
  <img src="./assets/readme/hero.png" width="100%" alt="Ankerkladde – mobile Einkaufs-, Todo- und Notizlisten-App">
</p>

<p align="center">
  <a href="https://oliverbenduhn.github.io/ankerkladde/">Projektvorstellung</a> ·
  <a href="https://ankerkladde.benduhn.de">App öffnen</a> ·
  <a href="#schnellstart">Schnellstart</a> ·
  <a href="#api-in-kurzform">API</a> ·
  <a href="#tests">Tests</a>
</p>

**Ankerkladde** ist eine mobile-first PHP-Webanwendung und PWA für Einkaufslisten, Aufgaben, Tagesnotizen, Zeichnungen, Bilder, Dateien und Links. Daten liegen auf deinem Server in SQLite. Das Frontend nutzt Vanilla-JS-ESM, TipTap und Excalidraw; ein optionaler WebSocket-Dienst meldet Änderungen an andere offene Ansichten.

**Aktueller Stand: v5.4.20.** Oberfläche auf Deutsch und Englisch. Details stehen im [Versionsverlauf](changelog.md).

## Was du bekommst

<p align="center">
  <img src="./assets/readme/section-features.png" width="100%" alt="Acht Funktionsbereiche: Listen, Einkaufen, Barcode, Notizen, Bilder, Dateien, Links, Extension">
</p>

- **Frei konfigurierbare Kategorien** pro Nutzer – mit Typen für Einkaufslisten, Aufgaben, Notizen, Bilder, Dateien und Links. Anlegen, umbenennen, sortieren, ausblenden.
- **Zwei Arbeitsmodi** nebeneinander: `Liste` zum Bearbeiten, `Einkaufen` zum schnellen Abhaken unterwegs. Inline-Edit, Drag-and-Drop, Anheften, Sammellöschen, Volltextsuche per FTS5.
- **Medien sauber gehandhabt** – genau ein Anhang pro Item, Uploads unter `data/uploads/` (nie im Webroot), Bilder bekommen Thumbnails wenn `gd` verfügbar ist, Dateien werden gestreamt statt ausgeliefert.
- **Tagesansicht mit Agenda, Tagesnotiz und Tagesskizze** – heute, gestern, morgen oder ein frei gewähltes Datum; inklusive überfälliger Aufgaben am heutigen Tag.
- **Rich-Text-Notizen mit TipTap und Zeichnungen mit Excalidraw** – lokal ausgelieferte Editoren, Autosave, lokale Entwürfe und sichtbare Konfliktauflösung bei paralleler Bearbeitung. Der ungenutzte Yjs-Endpunkt ist deaktiviert.
- **Quick-Add ohne KI**, mit Kategorie, Datum und Priorität. **Barcode-Scanner** mit optionalem Open-Food-Facts-Katalog und **Magic Bar** mit Gemini oder einem OpenAI-kompatiblen Anbieter; KI-Funktionen benötigen einen eigenen Provider-Schlüssel.
- **Installierbare PWA** mit vollständigem App-Shell-Cache, Offline-Bearbeitung nach der ersten Synchronisation, Share Target, vorgemerkten Aktionen und rückgängig machbaren Löschungen.
- **Themes & Erweiterung** – kuratierte Light- und Dark-Themes, plus eine Browser-Erweiterung für Chrome/Edge/Firefox, die sich per `X-API-Key` authentifiziert.

## So sieht es aus

<p align="center">
  <img src="screenshots/desktop-01-einkauf.png" width="92%" alt="Ankerkladde Desktop: Einkaufsliste im Listen-Modus">
</p>

<p align="center">
  <img src="screenshots/desktop-04-notizen-karten.png" width="45%" alt="Notizen als Karten auf dem Desktop">
  <img src="screenshots/desktop-06-bilder.png" width="45%" alt="Bilder-Galerie auf dem Desktop">
  <br>
  <img src="screenshots/desktop-07-links-karten.png" width="45%" alt="Linksammlung als Karten auf dem Desktop">
  <img src="screenshots/theme-desktop-hafenblau.png" width="45%" alt="Theme Hafenblau auf dem Desktop">
</p>

<p align="center">
  <img src="screenshots/mobile-02-einkauf.png" height="420" alt="Ankerkladde Mobile: Einkaufsliste">
  &nbsp;&nbsp;
  <img src="screenshots/mobile-04-privat-todos.png" height="420" alt="Ankerkladde Mobile: private Todos">
  &nbsp;&nbsp;
  <img src="screenshots/mobile-06-notizen.png" height="420" alt="Ankerkladde Mobile: Notizen">
  &nbsp;&nbsp;
  <img src="screenshots/mobile-08-bilder.png" height="420" alt="Ankerkladde Mobile: Bilder">
</p>

## Architektur

<p align="center">
  <img src="./assets/readme/workflow.png" width="100%" alt="Drei-Schicht-Diagramm: PWA-Client, PHP-API, SQLite plus optionaler WebSocket-Server">
</p>

| Pfad | Zweck |
| --- | --- |
| `public/` | App-Shell, Login, Settings, JSON-API, PWA-Assets |
| `public/js/` | Frontend als ESM-Module, Komposition über `createXxxController(deps)` |
| `db.php` | SQLite-Init, Auto-Migrationen, Kategorien-, Nutzer- und Produkt-Helper |
| `security.php` | Session, CSRF, kanonischer Host, Proxy-Logik |
| `src/` | `CategoryRepository`, `ItemRepository`, `UserRepository`, `FileHelper`, `ImageHelper`, `SettingsController`, `AiClient` |
| `src/Api/` | Anwendungsfall-Controller, HTTP, Idempotenz, Remote-Fetch und Inhaltsvalidierung |
| `public/styles/` | Komponenten-Styles und semantische Farbrollen |
| `websocket-server/` | Ticket- und Origin-geprüfte Nutzerkanäle, Versionsbroadcasts |
| `browser-extension/` | Chrome/Edge/Firefox-Erweiterung, baut sich on demand als ZIP |
| `scripts/` | Smoke-Tests, DB-Migration, Open-Food-Facts-Import, Helfer |
| `tests/ui/` | Playwright-Suite |

**Daten:** `data/einkaufsliste.db` (Hauptdaten), optional `data/products.db` (Produktkatalog). Schemaänderungen laufen über `php scripts/migrate.php` als Installations-/Deploy-Schritt. Der Webpfad prüft die Schema-Version. Mehr dazu: [Modulgrenzen und Audit-Verträge](docs/architecture-boundaries.md).

## Schnellstart

### Docker

```bash
git clone https://github.com/oliverbenduhn/ankerkladde.git
cd ankerkladde
# Einmal erzeugen und die .env-Datei behalten:
printf 'ANKERKLADDE_WS_SECRET=%s\n' "$(openssl rand -hex 32)" > .env
docker compose up -d --build
docker exec -it ankerkladde php scripts/create-admin.php
```

Anschließend unter <http://localhost:8083> einloggen. Daten landen unter `./data`, Apache proxyt `/ws/` auf den WebSocket-Container, `/healthz` ist mit dabei.

### Lokal ohne Docker

```bash
php scripts/migrate.php
php scripts/create-admin.php
php -S 127.0.0.1:8000 -t public public/router.php
```

Dann `http://127.0.0.1:8000/login.php` aufrufen. Weitere Nutzer per `php scripts/create-user.php` oder über die Umgebungsvariablen `EINKAUF_ADMIN_USER` / `EINKAUF_ADMIN_PASS` bzw. `EINKAUF_REGULAR_USER` / `EINKAUF_REGULAR_PASS`. Im Docker-Container wird bei einer frischen Installation automatisch ein initialer Admin (`admin` / `admin1234`) angelegt – Passwortwechsel beim ersten Login ist Pflicht.

> **Hinweise:** Kamera, PWA-Installation und einige Browser-APIs brauchen HTTPS oder localhost. `localhost` und `127.0.0.1` werden nie auf den kanonischen Produktionshost umgeleitet. Beim nackten `php -S` fehlt der Reverse Proxy für `/ws/`; die App läuft trotzdem, aber ohne Live-Updates (siehe [WEBSOCKET-SETUP.md](WEBSOCKET-SETUP.md)).

## API in Kurzform

JSON-API unter `public/api.php`, genutzt von Web-App und Browser-Erweiterung.

| Action | Methode | Zweck |
| --- | --- | --- |
| `categories_list`, `categories_create`, `categories_update`, `categories_reorder`, `categories_delete` | `GET` / `POST` | Kategorien verwalten |
| `list`, `add`, `upload`, `update`, `toggle`, `delete`, `clear`, `reorder`, `pin` | `GET` / `POST` | Items und Anhänge bearbeiten |
| `search` | `GET` | Nutzerweite Volltextsuche (FTS5) |
| `quick_add` | `POST` | Freitext deterministisch in Kategorie, Datum und Priorität aufteilen |
| `today`, `journal`, `journal_save` | `GET` / `POST` | Agenda und revisionsgesicherte Tagesnotizen |
| `sketch_load`, `sketch_save`, `sketch_save_daily` | `GET` / `POST` | Zeichnungen und Tagesskizzen |
| `undo_delete`, `finalize_delete` | `POST` | Löschungen wiederherstellen oder abschließen |
| `product_lookup`, `product_details` | `GET` | Produktdaten per Barcode |
| `fetch_metadata` | `GET` | Titel/Beschreibung/Bild einer externen URL |
| `preferences` | `GET` / `POST` | Nutzerpräferenzen |

Browser-Sessions verwenden Session-Cookie + `X-CSRF-Token`. Die Browser-Erweiterung authentifiziert sich per `X-API-Key`. Im Docker-Stack überleben PHP-Sessions Container-Neustarts, solange das Volume bleibt.

## Voraussetzungen

- PHP 8.1+ (empfohlen 8.3, Docker nutzt `php:8.3-apache`)
- Erweiterungen: `pdo_sqlite`, `curl`, `mbstring`, `sodium`; für Bild-Thumbnails zusätzlich `gd`
- Node.js für WebSocket-Server, Playwright-UI-Tests und den lokalen Editor-Vendor-Build; die gebündelten Editoren liegen bereits im Repository

## Wichtige Umgebungsvariablen

| Variable | Standard | Zweck |
| --- | --- | --- |
| `EINKAUF_DATA_DIR` | `./data` bzw. `/data` im Container | Speicherort für SQLite-Dateien und Uploads |
| `ANKERKLADDE_CANONICAL_HOST` | `ankerkladde.benduhn.de` | Produktiver Hostname; leer lassen für freie Hosts |
| `ANKERKLADDE_SESSION_LIFETIME_DAYS` | `30` | Login-/Session-Gültigkeit; `0` = Browser-Session |
| `EINKAUF_TRUST_PROXY_HEADERS` | auto (nur lokal) | `X-Forwarded-*` vertrauen |
| `WS_NOTIFY_URL` | `http://127.0.0.1:3000/notify` | Update-Broadcast-Ziel aus `api.php` |
| `WS_HOST` / `WS_PORT` | `127.0.0.1` / `3000` | WebSocket-Broadcast aus `settings.php` |
| `ANKERKLADDE_WS_SECRET` | kein Standard | Pflicht für Live-Updates; gemeinsames starkes Zufallssecret für PHP und WebSocket-Dienst |
| `ANKERKLADDE_ALLOW_PRIVATE_AI_ENDPOINTS` | `false` | Erlaubt bewusst private HTTP(S)-Ziele für lokale AI-Proxys; niemals unbedacht in Mehrbenutzer-Installationen aktivieren |
| `ANKERKLADDE_AUTO_MIGRATE` | `false` im Web, automatisch in CLI | Erlaubt Schema-Migrationen im Request-Pfad; produktiv stattdessen `php scripts/migrate.php` ausführen |
| `ANKERKLADDE_SECRET_KEY` | automatisch erzeugte Datei in `EINKAUF_DATA_DIR` | Optionaler externer Instanzschlüssel für verschlüsselte Provider-Secrets; als Base64 oder starke Passphrase |
| `EINKAUF_BOOTSTRAP_ADMIN_USER` / `_PASS` | `admin` / `admin1234` | Initialer Admin für frische Docker-Installationen |

## WebSocket und Live-Sync

Live-Updates brauchen den Node-Dienst aus `websocket-server/` und ein identisches `ANKERKLADDE_WS_SECRET` in PHP und Node. Browser erhalten nur kurzlebige Tickets, die an Nutzer und App-Origin gebunden sind. Der WebSocket-Handshake prüft zusätzlich den `Origin`-Header; Reverse Proxies müssen ihn unverändert weiterleiten. `/notify` akzeptiert ausschließlich das gemeinsame Secret. Mit Docker ist der Dienst verdrahtet; setze das Secret vor `docker compose up`. Für Apache/Nginx brauchst du zusätzlich den Reverse Proxy für `/ws/` und einen erreichbaren `/notify`-Endpoint. Der bisher ungeschützte Yjs-Endpunkt ist deaktiviert. Details: [WEBSOCKET-SETUP.md](WEBSOCKET-SETUP.md).

Provider-API-Schlüssel werden mit libsodium verschlüsselt. Ohne `ANKERKLADDE_SECRET_KEY` erzeugt `php scripts/migrate.php` einmalig `EINKAUF_DATA_DIR/.secret-key`. Diese Datei gehört zwingend zusammen mit der Datenbank ins Backup; ohne sie können gespeicherte Provider-Schlüssel nicht wiederhergestellt werden. Ankerkladde-API-Schlüssel werden nur gehasht gespeichert und nach Erzeugung genau einmal vollständig angezeigt.

## Open Food Facts importieren

Optional – die App läuft auch ohne Produktkatalog, nur Produktnamen und Detailseiten sind dann begrenzt.

```bash
bash scripts/update-openfoodfacts.sh
```

Das Skript schreibt nach `data/products.db` und braucht je nach Datensatz viel Speicherplatz.

## Browser-Erweiterung

Die Erweiterung schickt Seiten, Links, Bilder und Dateien direkt nach Ankerkladde.

```bash
php browser-extension/build-extension.php        # Chromium-Variante
php browser-extension/build-firefox.php          # Firefox-Variante
php browser-extension/build-icons.php            # optional, frische PNG-Icons
```

Mehr in [browser-extension/README.md](browser-extension/README.md).

## Sicherheit (Kurzfassung)

- Session-basierter Login mit Admin-/Normalnutzer-Rollen, CSRF-Schutz auf jedem schreibenden Request
- Kanonische Host-Weiterleitung für Produktion, Proxy-Header werden nur gezielt vertraut
- Attachment-Pfade werden ausschließlich serverseitig aus DB-Werten gebildet, nie aus Request-Daten
- `fetch_metadata` lädt nur externe öffentliche HTTP(S)-Ziele, nie aus dem LAN/Loopback
- Browser-Erweiterung nutzt API-Keys, nie Session-Cookies
- API-Keys werden gehasht, Provider-Schlüssel mit libsodium verschlüsselt gespeichert; Provider-Secrets fehlen in HTML- und API-Präferenzen
- Revisionsprüfung, atomare Idempotenz und Konfliktansichten schützen Schreibvorgänge und Wiederholungen
- Persistente Login-Limits und kurzlebige WebSocket-Tickets mit Origin-Prüfung sichern die Zugänge ab

## Tests

```bash
bash scripts/smoke-test.sh
bash scripts/test-db-migration.sh
php scripts/test-security.php
php scripts/test-transactions.php
npm run test:architecture
npm run test:design
npm run test:service-worker
find . -path './.git' -prune -o -path './.worktrees' -prune -o -path './data' -prune -o -name '*.php' -print | sort | xargs -r -n1 php -l
```

UI-Smoke-Tests mit Playwright:

```bash
npm install
npm run test:ui:install
npm run test:ui
```

Die UI-Suite wählt einen freien Port, startet ihren eigenen PHP-Testserver und legt temporäre Daten unter `.tmp/ui-test-data-<Port>/` an. Sie prüft Desktop und Mobile, inklusive Offline-Editoren und englischer Navigation. Weitere Prüfungen sind in den [Audit-Verträgen](docs/architecture-boundaries.md) beschrieben.

## Deployment

- Docker-Stack nutzt `php:8.3-apache` mit `rewrite`, `headers`, `proxy`, `proxy_http`, `proxy_wstunnel`
- Upload-Grenzen liegen in `public/.user.ini`
- Mitgelieferte Apache-Konfiguration setzt das DocumentRoot auf `public/`
- Für PWA, Kamera und installierbare Browser-Erlebnisse hinter HTTPS laufen lassen

## Weiterführende Dateien

- [WEBSOCKET-SETUP.md](WEBSOCKET-SETUP.md)
- [TipTapWebsocket.md](TipTapWebsocket.md)
- [browser-extension/README.md](browser-extension/README.md)
- [public/theme_update.md](public/theme_update.md)
