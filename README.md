# Zettel (Einkaufsliste)

Mobile-freundliche PHP-Webanwendung für Listen, Todos, Notizen, Bilder, Dateien und Links – gespeichert in SQLite.

**Produktion:** [zettel.benduhn.de](https://zettel.benduhn.de)

## Bereiche

| Bereich | Besonderheit |
|---|---|
| 🛒 Einkauf | Name + Menge |
| 💊 Medizin | Name + Menge |
| ✅ Privat | Name + Datum (date-picker) |
| 💼 Arbeit | Name + Datum (date-picker) |
| 📝 Notizen | Rich-Text-Editor (TipTap) mit Überschriften, Listen, Code, Links |
| 🖼️ Bilder | Upload per Datei-Picker, Kamera (📷), Drag & Drop oder Zwischenablage; Lightbox-Vorschau, Download |
| 📁 Dateien | Upload per Datei-Picker, Drag & Drop oder Zwischenablage; Download |
| 🔗 Links | URL – direkt anklickbar, öffnet neuen Tab |

## Funktionen

- **Zwei Modi** pro Bereich: Bearbeiten (✏️) und Ansicht (👁️) – Modus bleibt nach Reload erhalten
- **Symbolleiste** ein-/ausblendbar über ☰ (Zustand wird gespeichert)
- Letzter Bereich und letzter Modus werden in `localStorage` gespeichert
- Artikel per **Drag & Drop** umsortieren
- Inline-Bearbeitung direkt in der Liste
- **Attachment-Ersetzung**: vorhandenes Bild oder Datei über den ✎-Button im Edit-Modus ersetzen
- Neueste Einträge in Bilder und Dateien erscheinen zuerst
- **Offline-fähig** (PWA): gecachte App-Shell, Update-Banner bei neuer Version
- CSRF-Schutz für alle schreibenden Aktionen
- Automatische DB-Migration bei neuen Spalten

## Bild-Upload (Bilder-Bereich)

Vier Upload-Wege stehen nebeneinander:

| Weg | Beschreibung |
|---|---|
| Datei-Picker | Klassischer Datei-Dialog |
| 📷 Kamera | Öffnet direkt die Gerätekamera (Smartphone); Foto wird sofort hochgeladen |
| Drag & Drop | Bild auf die gestrichelte Zone ziehen |
| Zwischenablage | `Strg+V` / `Cmd+V` – fügt ein kopiertes Bild ein |

Klick auf ein Vorschaubild öffnet eine Lightbox innerhalb der App (kein Tab-Wechsel, PWA-freundlich).

## Notizen-Editor

Der Notizen-Tab öffnet für jede Notiz einen vollwertigen Rich-Text-Editor:

- **TipTap** (ProseMirror-basiert), geladen via CDN (esm.sh)
- Toolbar: H1, H2, H3, Fett, Kursiv, Durchgestrichen, Listen, Zitat, Code, Link, Undo/Redo
- Auto-Speichern mit 800 ms Debounce
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

- `data/uploads/images` – Bild-Anhänge (Sektion `images`)
- `data/uploads/files` – Datei-Anhänge (Sektion `files`)

Genau ein Anhang pro Item (DB-Constraint `UNIQUE` auf `item_id`). Beim Ersetzen wird die alte Datei gelöscht, beim Item-Delete ebenso.

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

Dateisystempfade werden nicht aus Request-Daten abgeleitet. Vorhandene Dateien können über `public/media.php?item_id=<id>` gestreamt werden. Bilder werden standardmäßig inline ausgeliefert, mit `?download=1` als Datei-Download.

## API-Endpunkte

| Action | Methode | Beschreibung |
|---|---|---|
| `list` | GET | Items einer Section inkl. Attachment-Metadaten |
| `add` | POST | Neues Item (ohne Datei) |
| `upload` | POST | Neues Item mit Attachment; mit `item_id` → Attachment ersetzen |
| `update` | POST | Name/Menge eines Items ändern |
| `toggle` | POST | Erledigt-Status umschalten |
| `delete` | POST | Item und zugehörigen Anhang löschen |
| `clear` | POST | Alle erledigten Items einer Section löschen |
| `reorder` | POST | Reihenfolge per ID-Array festlegen |

## Dateien

| Pfad | Zweck |
|---|---|
| `public/index.php` | HTML-Oberfläche |
| `public/api.php` | JSON-API |
| `public/media.php` | Sicheres Streamen von Attachments |
| `public/app.js` | Vanilla-JS-Frontend (kein Build-Tool) |
| `public/style.css` | CSS (Design-Tokens, Layout, Komponenten) |
| `public/sw.js` | Service Worker (Offline-Cache) |
| `public/.user.ini` | PHP-Upload-Limits (20 MB Bild, 5 GB Datei) |
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

Der Smoke-Test prüft u. a.: Multipart-Uploads für `images` und `files`, Abruf über `media.php`, Attachment-Ersetzung (Ein-Attachment-Regel), Fehlerfälle für ungültige Bilder und fehlende Uploads, Datei-Entfernung beim Item-Delete.

## Deployment (Produktion)

Der produktive Deploy läuft auf `web` (Alpine LXC, nginx + PHP-FPM 8.3) via GitHub Webhook:

```
Git Push auf main → Webhook → deploy.sh → git pull + php-fpm reload
```

**Webhook-Endpunkt:** `https://hook-copy.benduhn.de/hooks/einkauf-deploy`

```bash
# Manuell auslösen
ssh ansible@web "sudo /var/www/projects/einkauf/deploy.sh"

# Logs
ssh ansible@web "tail -f /var/log/einkauf/deploy.log"
```

Die App ist unter `zettel.benduhn.de` erreichbar (intern: Port 8083, Caddy leitet weiter).

PWA-Features (Service Worker, Installationsdialog) erfordern **HTTPS**.

### Infrastruktur-Limits

Upload-Limits werden auf zwei Ebenen gesetzt:

| Ebene | Konfiguration | Wert |
|---|---|---|
| nginx | `client_max_body_size` in `/etc/nginx/http.d/einkauf.conf` | 5200m |
| PHP | `upload_max_filesize` / `post_max_size` in `public/.user.ini` | 5G / 5200M |

### Berechtigungen

Der Webserver-Prozess benötigt Schreibrechte auf `data/`, nicht auf den Webroot.
Die SQLite-Datei liegt standardmäßig in `data/einkaufsliste.db`, Uploads in `data/uploads/`.
Optional kann das Datenverzeichnis über `EINKAUF_DATA_DIR` überschrieben werden (z. B. für Tests).

## Docker (lokale Entwicklung)

```bash
docker compose up
```

Konfiguration: `Dockerfile`, `docker-compose.yml`, `deploy/docker/einkauf.conf`.
