# Ankerkladde

<p align="center">
  <img src="public/branding/ankerkladde-logo.png" alt="Ankerkladde" width="96">
</p>

Mobile-freundliche PHP-Webanwendung für Einkaufslisten, Todos, Notizen, Bilder, Dateien und Links – gespeichert in SQLite.

**Produktion:** erreichbar unter [ankerkladde.benduhn.de](https://ankerkladde.benduhn.de).

---

## Funktionsübersicht

### Bereiche

Jeder Nutzer verwaltet eigene **Kategorien** – Anzahl, Namen, Icons und Reihenfolge sind frei konfigurierbar. Sechs Typen stehen zur Wahl:

| Typ | Zweites Feld | Besonderheit |
|---|---|---|
| `list_quantity` | Menge (Text) | Einkaufslisten-Stil |
| `list_due_date` | Fälligkeitsdatum | Datepicker, Datumsanzeige im Item |
| `notes` | – | Rich-Text-Editor (TipTap) |
| `images` | – | Bild-Upload, Lightbox-Vorschau |
| `files` | – | Datei-Upload, Download |
| `links` | – | URL, direkt anklickbar |

### Navigation

- **Bottom-Navigation**: bis zu 4 Kategorien direkt sichtbar, weitere über **···-Menü**
- **☰-Button**: blendet die Navigationsleiste aus/ein (Zustand wird gespeichert)
- **Wischgeste** (horizontal) zum Wechseln zwischen Kategorien
- Letzter Bereich und Modus bleiben nach Reload erhalten

### Items

- **Zwei Modi** je Bereich: Bearbeiten (✏️) und Ansicht (👁️)
- **Drag & Drop** zum Umsortieren (Griff links am Item ziehen)
- **Inline-Bearbeitung** direkt in der Liste
- **Anheften** (⚓): Items an den Anfang der Liste heften
- **Erledigte löschen**: Schaltfläche entfernt alle abgehakten Items auf einmal
- **Volltextsuche** über alle Kategorien (FTS5, Mindestlänge 2 Zeichen)

### Bilder & Dateien

| Upload-Weg | Beschreibung |
|---|---|
| Datei-Picker | Klassischer Dialog |
| 📷 Kamera | Öffnet Gerätekamera direkt |
| Drag & Drop | Datei auf die gestrichelte Zone ziehen |
| Zwischenablage | `Strg+V` / `Cmd+V` |

- Klick auf Vorschaubild öffnet Lightbox (kein Tab-Wechsel)
- **Anhang ersetzen**: vorhandene Datei über ✎ im Bearbeiten-Modus tauschen
- Genau ein Anhang pro Item; alter Anhang wird beim Ersetzen oder Löschen vom Dateisystem entfernt

### Notizen-Editor

- **TipTap** (ProseMirror), geladen via CDN (esm.sh)
- Toolbar: H1–H3, Fett, Kursiv, Durchgestrichen, Liste, Zitat, Code, Link, Undo/Redo
- **Auto-Speichern** mit 800 ms Debounce

### PWA & Offline

- **Installierbar** als PWA – Installations-Banner erscheint sowohl auf der Login-Seite als auch in der App
- **Service Worker** cached App-Shell für Offline-Nutzung
- Update-Banner bei neuer Version
- **Share Target**: URLs und Dateien können aus anderen Apps direkt an Ankerkladde weitergegeben werden

### Einstellungen

- Passwort ändern
- Kategorien anlegen, umbenennen, Icon wählen, ausblenden, umsortieren, löschen
- Wischnavigation aktivieren/deaktivieren
- Freier Speicherplatz wird angezeigt
- API-Key und Download-Links für die Browser-Erweiterung

### Nutzer & Admin

- Login mit Benutzername + Passwort, Session-basiert
- Benutzernamen werden beim Anlegen getrimmt und ohne Steuerzeichen gespeichert
- Admins sehen eine separate Verwaltungsseite (`admin.php`) zur Nutzerverwaltung
- CSRF-Schutz auf allen schreibenden Aktionen

---

## Technischer Überblick

### Dateistruktur

| Pfad | Zweck |
|---|---|
| `public/index.php` | HTML-Oberfläche (App-Shell) |
| `public/app.js` | Gesamtes Frontend als Single-File-JavaScript (kein Build-Tool) |
| `public/style.css` | CSS (Design-Tokens, Layout, Komponenten) |
| `public/api.php` | JSON-REST-API |
| `public/media.php` | Sicheres Streamen von Anhängen |
| `public/login.php` | Login-Seite (inkl. PWA-Manifest + Install-Banner) |
| `public/settings.php` | Einstellungen |
| `public/admin.php` | Admin-Nutzerverwaltung |
| `public/sw.js` | Service Worker |
| `public/manifest.php` | Web App Manifest |
| `public/extension-download.php` | Baut Browser-Extension-ZIP on demand für Chrome/Edge oder Firefox |
| `public/.user.ini` | PHP-Upload-Limits (20 MB Bild, 5 GB Datei) |
| `db.php` | SQLite-Init + automatische Migrationen |
| `security.php` | Session, CSRF, kanonische Host-Weiterleitung |

### API-Aktionen

| Action | Methode | Beschreibung |
|---|---|---|
| `categories_list` | GET | Kategorien + Präferenzen des Nutzers |
| `categories_create` | POST | Neue Kategorie anlegen |
| `categories_update` | POST | Kategorie umbenennen / Icon / Sichtbarkeit |
| `categories_reorder` | POST | Reihenfolge per ID-Array |
| `categories_delete` | POST | Leere Kategorie löschen |
| `list` | GET | Items einer Kategorie inkl. Anhang-Metadaten |
| `add` | POST | Neues Item (ohne Datei) |
| `upload` | POST | Neues Item mit Anhang; mit `item_id` → Anhang ersetzen |
| `update` | POST | Name/Menge/Datum eines Items ändern |
| `toggle` | POST | Erledigt-Status umschalten |
| `pin` | POST | Item anheften/lösen |
| `delete` | POST | Item + Anhang löschen |
| `clear` | POST | Alle erledigten Items einer Kategorie löschen |
| `reorder` | POST | Reihenfolge per ID-Array |
| `search` | GET | Volltextsuche (FTS5) über alle Kategorien |
| `preferences` | GET/POST | Nutzer-Präferenzen lesen/schreiben |

Browser-Erweiterung: Der API-Key in den Einstellungen authentifiziert Requests direkt gegen `public/api.php` über den Header `X-API-Key`. Kategorien werden dabei per `category_id` angesprochen.

### Datenbank

SQLite unter `data/einkaufsliste.db` (überschreibbar per `EINKAUF_DATA_DIR`). Schema wird bei jedem Request automatisch migriert – ausschließlich additive `ALTER TABLE`-Migrationen.

**Kerntabellen:** `users`, `categories`, `items`, `attachments`, `items_fts` (FTS5-Volltextindex, per Trigger synchron gehalten)

### Sicherheit

- CSRF-Token per Session, als `X-CSRF-Token`-Header bei jeder schreibenden Anfrage
- Attachment-Pfade werden ausschließlich serverseitig aus DB-Daten gebildet, nie aus Request-Parametern
- Kanonische Host-Weiterleitung auf Produktions-Domain (außer localhost)

---

## Docker

### Schnellstart

```bash
git clone https://github.com/oliverbenduhn/ankerkladde.git
cd ankerkladde
docker compose up -d
```

Danach unter [http://localhost:8083](http://localhost:8083) erreichbar.

Ersten Admin-User anlegen:

```bash
docker exec -it ankerkladde php scripts/create-admin.php
```

### Umgebungsvariablen

| Variable | Standard | Beschreibung |
|---|---|---|
| `EINKAUF_DATA_DIR` | `/data` | Pfad zur SQLite-Datenbank im Container |
| `ANKERKLADDE_CANONICAL_HOST` | `ankerkladde.benduhn.de` | Produktions-Domain (leer lassen für localhost) |
| `EINKAUF_TRUST_PROXY_HEADERS` | – | Auf `true` setzen wenn hinter Reverse Proxy |

### Hinter einem Reverse Proxy

```yaml
environment:
  ANKERKLADDE_CANONICAL_HOST: meine-domain.de
  EINKAUF_TRUST_PROXY_HEADERS: 'true'
```

### Daten-Backup

```bash
docker run --rm -v ankerkladde_data:/data -v $(pwd):/backup alpine tar czf /backup/backup.tar.gz -C /data .
docker run --rm -v ankerkladde_data:/data -v $(pwd):/backup alpine tar xzf /backup/backup.tar.gz -C /data
```

---

## Lokal entwickeln

```bash
# PHP Dev-Server
php -S 127.0.0.1:8000 -t public

# Docker
docker compose up
```

`localhost` gilt als sicherer Kontext – Service Worker und PWA-Installation funktionieren ohne TLS.

### Nutzer anlegen

```bash
php scripts/create-admin.php
php scripts/create-user.php   # EINKAUF_USER / EINKAUF_PASS für nicht-interaktiven Aufruf
```

### Tests

```bash
bash scripts/smoke-test.sh        # Uploads, Streaming, CSRF, Anhang-Ersetzung, Fehlerfälle
bash scripts/test-db-migration.sh # Migrationen auf frischer DB
find . -path './.git' -prune -o -path './.worktrees' -prune -o -path './data' -prune -o -name '*.php' -print | sort | xargs -r -n1 php -l
```

### Browser-Erweiterung

```bash
php browser-extension/build-icons.php    # nur wenn PNG-Icons neu erzeugt werden sollen
php browser-extension/build-extension.php
php browser-extension/build-firefox.php
```

Die Builds erzeugen versionierte ZIP-Dateien direkt im Ordner `browser-extension/`. In der App stehen unter `Einstellungen -> Browser-Extension` zusätzlich direkte Download-Links und der zugehörige API-Key bereit.

---

## Deployment (Produktion)

Läuft auf `web` (Alpine LXC, nginx + PHP-FPM 8.3), erreichbar unter `ankerkladde.benduhn.de` (intern Port 8083, Caddy leitet weiter).

```
Git Push → GitHub Webhook → deploy.sh → git pull + php-fpm reload
```

```bash
# Manuell
ssh ansible@web "sudo /var/www/projects/ankerkladde/deploy.sh"
ssh ansible@web "tail -f /var/log/ankerkladde/deploy.log"
```

### Upload-Limits

| Ebene | Datei | Limit |
|---|---|---|
| nginx | `/etc/nginx/http.d/ankerkladde.conf` | 5200 MB |
| PHP | `public/.user.ini` | 5 GB / 5200 MB |

### Voraussetzungen

- PHP 8.1+ mit `pdo_sqlite` und `mbstring`
- Schreibrechte für den Webserver-Prozess auf `data/` (nicht auf den Webroot)
