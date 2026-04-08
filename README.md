# Zettel (Einkaufsliste)

Mobile-freundliche PHP-Webanwendung für Listen, Todos, Notizen und Links – gespeichert in SQLite.

**Produktion:** [zettel.benduhn.de](https://zettel.benduhn.de)

## Bereiche

| Bereich | Besonderheit |
|---|---|
| 🛒 Einkauf | Name + Menge |
| 💊 Medizin | Name + Menge |
| ✅ Privat | Name + Datum (date-picker) |
| 💼 Arbeit | Name + Datum (date-picker) |
| 📝 Notizen | Rich-Text-Editor (TipTap) mit Überschriften, Listen, Code, Links |
| 🖼️ Bilder | Name |
| 📁 Dateien | Name |
| 🔗 Links | URL – direkt anklickbar, öffnet neuen Tab |

## Funktionen

- **Zwei Modi** pro Bereich: Bearbeiten (✏️) und Ansicht (👁️)
- **Symbolleiste** ein-/ausblendbar über ☰ (Zustand wird gespeichert)
- Artikel per **Drag & Drop** umsortieren
- Inline-Bearbeitung direkt in der Liste
- **Offline-fähig** (PWA): gecachte App-Shell, Update-Banner bei neuer Version
- CSRF-Schutz für alle schreibenden Aktionen
- Automatische DB-Migration bei neuen Spalten
- Persistente Uploads für Bilder und Dateien mit Storage außerhalb des Webroots

## Notizen-Editor

Der Notizen-Tab öffnet für jede Notiz einen vollwertigen Rich-Text-Editor:

- **TipTap** (ProseMirror-basiert), geladen via CDN (esm.sh)
- Toolbar: H1, H2, H3, Fett, Kursiv, Durchgestrichen, Listen, Zitat, Code, Link, Undo/Redo
- Auto-Speichern mit 800 ms Debounce
- Kein Bild-Upload
- Inhalt gespeichert als HTML im `content`-Feld der `items`-Tabelle

## Datenbankschema

```sql
CREATE TABLE items (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    name       TEXT    NOT NULL,
    quantity   TEXT    NOT NULL DEFAULT '',   -- Menge oder ISO-Datum (Todos)
    content    TEXT    NOT NULL DEFAULT '',   -- Rich-Text-Inhalt (Notizen)
    done       INTEGER NOT NULL DEFAULT 0,
    section    TEXT    NOT NULL DEFAULT 'shopping',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Migrationen werden beim ersten Request automatisch angewendet (`db.php`).

### Attachments und Storage

Uploads werden außerhalb des Webroots unter `data/uploads/` gespeichert:

- `data/uploads/images` für Bild-Anhänge von Items aus der Sektion `images`
- `data/uploads/files` für Datei-Anhänge von Items aus der Sektion `files`

Die Metadaten liegen in einer separaten Tabelle mit genau einem Anhang pro Item:

```sql
CREATE TABLE attachments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    item_id         INTEGER NOT NULL UNIQUE REFERENCES items(id) ON DELETE CASCADE,
    storage_section TEXT    NOT NULL CHECK(storage_section IN ('images', 'files')),
    stored_name     TEXT    NOT NULL,
    original_name   TEXT    NOT NULL DEFAULT '',
    media_type      TEXT    NOT NULL DEFAULT 'application/octet-stream',
    size_bytes      INTEGER NOT NULL DEFAULT 0,
    created_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at      TEXT    NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

Dateisystempfade werden nicht aus Request-Daten abgeleitet. Die App speichert nur validierte Metadaten in SQLite und berechnet daraus serverseitig feste Pfade. Vorhandene Dateien können über `public/media.php?item_id=<id>` anhand der Item-ID gestreamt werden. Bilder werden standardmäßig inline ausgeliefert, mit `download=1` aber als Download.

## Dateien

| Pfad | Zweck |
|---|---|
| `public/index.php` | HTML-Oberfläche |
| `public/api.php` | JSON-API (list, add, upload, update, toggle, delete, clear, reorder) |
| `public/media.php` | Sicheres Streamen vorhandener Attachments anhand der Item-ID |
| `public/app.js` | Vanilla-JS-Frontend (kein Build-Tool) |
| `public/style.css` | CSS (Design-Tokens, Layout, Komponenten) |
| `public/sw.js` | Service Worker (Offline-Cache) |
| `db.php` | Datenbankinitialisierung + automatische Migrationen |
| `security.php` | Session- und CSRF-Helfer |

## Voraussetzungen

- PHP 8.1+ mit `pdo_sqlite` und `mbstring`

## Lokal starten

```bash
php -S 127.0.0.1:8000 -t public
```

`localhost` gilt als sicherer Kontext – Service Worker und PWA-Installation funktionieren lokal ohne TLS.

## Smoke-Test

```bash
bash scripts/smoke-test.sh
bash scripts/test-db-migration.sh
```

`scripts/smoke-test.sh` startet weiterhin nur einen lokalen `php -S`-Server, prüft jetzt aber zusätzlich echte Multipart-Uploads für `images` und `files`, den Abruf über `media.php`, Fehlerfälle für ungültige Bilder und fehlende Uploads/Dateien sowie das Entfernen der gespeicherten Datei beim Löschen eines Items.

## Deployment (Produktion)

Der produktive Deploy läuft auf `web` (Alpine LXC, nginx + PHP-FPM 8.3) via GitHub Webhook:

```
Git Push auf main → Webhook → deploy.sh → git pull + php-fpm reload
```

**Webhook-Endpunkt:** `https://hook-copy.benduhn.de/hooks/einkauf-deploy`

Das `deploy.sh` im Repo-Root führt den Deploy durch:

```bash
# Manuell auslösen
ssh ansible@web "sudo /var/www/projects/einkauf/deploy.sh"

# Logs
ssh ansible@web "tail -f /var/log/einkauf/deploy.log"
```

Die App ist unter `zettel.benduhn.de` erreichbar (intern: Port 8083, Caddy leitet weiter).

PWA-Features (Service Worker, Installationsdialog) erfordern **HTTPS**.

### Berechtigungen

Der Webserver-Prozess (`einkauf`-User) benötigt Schreibrechte auf `data/`, nicht auf den Webroot.
Die SQLite-Datei liegt standardmäßig in `data/einkaufsliste.db`, Uploads in `data/uploads/`. Optional kann das Datenverzeichnis über `EINKAUF_DATA_DIR` überschrieben werden, z. B. für Tests.

## Docker (lokale Entwicklung)

Für lokale Tests steht Docker Compose bereit:

```bash
docker compose up
```

Die Konfiguration befindet sich in `Dockerfile`, `docker-compose.yml` und `deploy/docker/einkauf.conf`.

## Legacy: Apache

```bash
sudo bash scripts/deploy-production.sh
```

Webroot: `/var/www/einkauf/public`, Datenverzeichnis: `/var/lib/einkauf`.
