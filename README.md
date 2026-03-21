# Einkaufsliste

Kleine PHP-Webanwendung für eine mobile-freundliche Einkaufsliste mit SQLite.

## Enthaltene Dateien

- `public/index.php`: Oberfläche zum Verwalten der Einkaufsliste.
- `public/api.php`: JSON-API für Laden, Anlegen, Umschalten, Löschen, Umsortieren und Leeren erledigter Einträge.
- `db.php`: Initialisiert die SQLite-Datenbank außerhalb des Webroots im Ordner `data/`.
- `security.php`: Session- und CSRF-Helfer für die Weboberfläche und API.

## Verbesserungen gegenüber dem Ausgangskonzept

- Datenbank liegt in `data/einkaufsliste.db` statt direkt im Webroot.
- Webserver-Docroot ist `public/`, damit weder `.git` noch die SQLite-Datei ausgeliefert werden.
- Validierung für Eingaben und strukturierte JSON-Fehlerantworten.
- Schreibende API-Aktionen verwenden `POST` statt zustandsverändernder `GET`-Requests.
- Schreibende API-Aktionen verlangen ein CSRF-Token aus der Session.
- Optionales Feld für Mengenangaben.
- Reihenfolge der Einträge per Ziehgriff im Listenmodus verschiebbar.
- Übersicht mit Zähler für offene und erledigte Artikel.
- Mobile-First-Oberfläche mit größeren Touch-Zielen.
- PWA mit gecachter App-Shell, Offline-Fallback-Seite und Update-Hinweis bei neuer Version.

## Voraussetzungen

- PHP 8.1+ mit `pdo_sqlite` / `sqlite3`
- PHP-Erweiterung `mbstring`

## Lokal starten

```bash
php -S 127.0.0.1:8000 -t public
```

Anschließend im Browser öffnen:

- <http://127.0.0.1:8000/>

## Installation auf Linux

Beispiel für Debian/Ubuntu:

```bash
sudo apt update
sudo apt install php php-sqlite3 php-mbstring
```

Beim Deploy muss der Webserver als DocumentRoot auf `.../einkauf/public` zeigen, nicht auf den Projektordner.

Die SQLite-Datei liegt standardmäßig in `.../einkauf/data/einkaufsliste.db`. Optional kann das Datenverzeichnis über `EINKAUF_DATA_DIR` überschrieben werden, z. B. für Tests.

Der Webserver-Prozess braucht Schreibrechte auf das Datenverzeichnis, nicht auf den öffentlichen Webroot.

## Smoke-Test

```bash
bash scripts/smoke-test.sh
bash scripts/test-db-migration.sh
```

## Produktions-Deploy mit Apache

Die App ist für einen dauerhaften Apache-Betrieb vorbereitet:

- Webroot: `/var/www/einkauf/public`
- Datenverzeichnis: `/var/lib/einkauf`
- Apache-Site: `deploy/apache/einkauf.conf`

Deployment aus dem Repo:

```bash
sudo bash scripts/deploy-production.sh
```

Danach läuft die App dauerhaft über den Apache-Dienst auf Port 80 und startet nach Reboots automatisch wieder.
