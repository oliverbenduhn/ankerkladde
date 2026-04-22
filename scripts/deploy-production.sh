#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_ROOT="/var/www/ankerkladde"
DATA_ROOT="/var/lib/ankerkladde"
SITE_NAME="ankerkladde.conf"
SITE_SOURCE="$ROOT_DIR/deploy/apache/$SITE_NAME"
SITE_TARGET="/etc/apache2/sites-available/$SITE_NAME"

if [[ "${EUID}" -ne 0 ]]; then
    echo "Dieses Skript muss mit sudo oder als root laufen." >&2
    exit 1
fi

install -d -m 0755 "$APP_ROOT" "$APP_ROOT/public" "$APP_ROOT/public/icons" "$APP_ROOT/public/icons/categories" "$APP_ROOT/public/branding" "$APP_ROOT/scripts" "$APP_ROOT/deploy/apache"
install -d -m 0775 -o www-data -g www-data "$DATA_ROOT"

install -m 0644 "$ROOT_DIR/db.php" "$APP_ROOT/db.php"
install -m 0644 "$ROOT_DIR/security.php" "$APP_ROOT/security.php"
install -m 0644 "$ROOT_DIR/README.md" "$APP_ROOT/README.md"
install -m 0644 "$ROOT_DIR/.gitignore" "$APP_ROOT/.gitignore"
install -m 0644 "$ROOT_DIR/.gitkeep" "$APP_ROOT/.gitkeep"

while IFS= read -r publicFile; do
    relativePath="${publicFile#$ROOT_DIR/public/}"
    install -m 0644 "$publicFile" "$APP_ROOT/public/$relativePath"
done < <(find "$ROOT_DIR/public" -maxdepth 1 -type f \( -name '*.php' -o -name '*.js' -o -name '*.css' -o -name '*.json' -o -name '*.html' \) | sort)

while IFS= read -r assetFile; do
    relativePath="${assetFile#$ROOT_DIR/public/}"
    install -d -m 0755 "$APP_ROOT/public/$(dirname "$relativePath")"
    install -m 0644 "$assetFile" "$APP_ROOT/public/$relativePath"
done < <(find "$ROOT_DIR/public/js" "$ROOT_DIR/public/vendor" -type f | sort)

install -m 0644 "$ROOT_DIR/public/branding/ankerkladde-logo.png" "$APP_ROOT/public/branding/ankerkladde-logo.png"
while IFS= read -r iconFile; do
    relativePath="${iconFile#$ROOT_DIR/public/icons/}"
    install -d -m 0755 "$APP_ROOT/public/icons/$(dirname "$relativePath")"
    install -m 0644 "$iconFile" "$APP_ROOT/public/icons/$relativePath"
done < <(find "$ROOT_DIR/public/icons" -type f \( -name '*.svg' -o -name '*.png' \) | sort)
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
