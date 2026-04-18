#!/bin/sh
# Korrigiert Rechte auf dem Daten-Volume beim Container-Start.
# Nötig weil Docker-Volumes bei der ersten Initialisierung root-owned sein können
# und der chown im Dockerfile nur das Image-Layer betrifft, nicht das gemountete Volume.
chown -R www-data:www-data "${EINKAUF_DATA_DIR:-/data}"

BOOTSTRAP_ADMIN_USER="${EINKAUF_BOOTSTRAP_ADMIN_USER:-admin}"
BOOTSTRAP_ADMIN_PASS="${EINKAUF_BOOTSTRAP_ADMIN_PASS:-admin1234}"

export BOOTSTRAP_ADMIN_USER
export BOOTSTRAP_ADMIN_PASS
su -s /bin/sh www-data -c 'cd /var/www/html && EINKAUF_ADMIN_USER="$BOOTSTRAP_ADMIN_USER" EINKAUF_ADMIN_PASS="$BOOTSTRAP_ADMIN_PASS" EINKAUF_ADMIN_FORCE_PASSWORD_CHANGE="true" php scripts/create-admin.php' >/dev/null 2>&1 || true

exec "$@"
