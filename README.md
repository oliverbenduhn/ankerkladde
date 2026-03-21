# Einkaufsliste

Kleine PHP-Webanwendung für eine mobile-freundliche Einkaufsliste mit SQLite.

## Enthaltene Dateien

- `index.php`: Oberfläche zum Verwalten der Einkaufsliste.
- `api.php`: JSON-API für Laden, Anlegen, Umschalten, Löschen und Leeren erledigter Einträge.
- `db.php`: Initialisiert die SQLite-Datenbank automatisch im Ordner `data/`.

## Verbesserungen gegenüber dem Ausgangskonzept

- Datenbank liegt in `data/einkaufsliste.db` statt direkt im Webroot.
- Validierung für Eingaben und strukturierte JSON-Fehlerantworten.
- Optionales Feld für Mengenangaben.
- Übersicht mit Zähler für offene und erledigte Artikel.
- Mobile-First-Oberfläche mit größeren Touch-Zielen.

## Voraussetzungen

- PHP 8.1+ mit `pdo_sqlite` / `sqlite3`

## Lokal starten

```bash
php -S 127.0.0.1:8000
```

Anschließend im Browser öffnen:

- <http://127.0.0.1:8000/index.php>

## Installation auf Linux

Beispiel für Debian/Ubuntu:

```bash
sudo apt update
sudo apt install php php-sqlite3
```

Dateien z. B. nach `/var/www/einkauf` kopieren und darauf achten, dass der Webserver-Prozess Schreibrechte auf den Projektordner bzw. den Unterordner `data/` hat.
