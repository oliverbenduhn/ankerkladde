#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="/var/www/einkauf"
DATA_ROOT="/var/lib/einkauf"
SITE_NAME="einkauf.conf"
SITE_SOURCE="$ROOT_DIR/deploy/apache/$SITE_NAME"
SITE_TARGET="/etc/apache2/sites-available/$SITE_NAME"

if [[ "${EUID}" -ne 0 ]]; then
    echo "Dieses Skript muss mit sudo oder als root laufen." >&2
    exit 1
fi

install -d -m 0755 "$APP_ROOT" "$APP_ROOT/public" "$APP_ROOT/public/icons" "$APP_ROOT/scripts" "$APP_ROOT/deploy/apache"
install -d -m 0775 -o www-data -g www-data "$DATA_ROOT"

install -m 0644 "$ROOT_DIR/db.php" "$APP_ROOT/db.php"
install -m 0644 "$ROOT_DIR/security.php" "$APP_ROOT/security.php"
install -m 0644 "$ROOT_DIR/README.md" "$APP_ROOT/README.md"
install -m 0644 "$ROOT_DIR/.gitignore" "$APP_ROOT/.gitignore"
install -m 0644 "$ROOT_DIR/.gitkeep" "$APP_ROOT/.gitkeep"
install -m 0644 "$ROOT_DIR/public/index.php" "$APP_ROOT/public/index.php"
install -m 0644 "$ROOT_DIR/public/api.php" "$APP_ROOT/public/api.php"
install -m 0644 "$ROOT_DIR/public/style.css" "$APP_ROOT/public/style.css"
install -m 0644 "$ROOT_DIR/public/app.js" "$APP_ROOT/public/app.js"
install -m 0644 "$ROOT_DIR/public/sw.js" "$APP_ROOT/public/sw.js"
install -m 0644 "$ROOT_DIR/public/manifest.json" "$APP_ROOT/public/manifest.json"
install -m 0644 "$ROOT_DIR/public/icons/icon.svg" "$APP_ROOT/public/icons/icon.svg"
install -m 0644 "$ROOT_DIR/public/icons/icon-192.png" "$APP_ROOT/public/icons/icon-192.png"
install -m 0644 "$ROOT_DIR/public/icons/icon-512.png" "$APP_ROOT/public/icons/icon-512.png"
install -m 0755 "$ROOT_DIR/scripts/smoke-test.sh" "$APP_ROOT/scripts/smoke-test.sh"
install -m 0644 "$ROOT_DIR/deploy/apache/$SITE_NAME" "$APP_ROOT/deploy/apache/$SITE_NAME"
install -m 0644 "$SITE_SOURCE" "$SITE_TARGET"

chown -R root:root "$APP_ROOT"

if [[ -f "$ROOT_DIR/data/einkaufsliste.db" && ! -f "$DATA_ROOT/einkaufsliste.db" ]]; then
    install -m 0664 -o www-data -g www-data "$ROOT_DIR/data/einkaufsliste.db" "$DATA_ROOT/einkaufsliste.db"
fi

if [[ -f "$DATA_ROOT/einkaufsliste.db" ]]; then
    chown www-data:www-data "$DATA_ROOT/einkaufsliste.db"
    chmod 0664 "$DATA_ROOT/einkaufsliste.db"
fi

a2dissite 000-default.conf >/dev/null 2>&1 || true
a2ensite "$SITE_NAME" >/dev/null
apache2ctl configtest
systemctl enable apache2 >/dev/null
systemctl restart apache2
