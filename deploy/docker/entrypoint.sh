#!/bin/sh
# Korrigiert Rechte auf dem Daten-Volume beim Container-Start.
# Nötig weil Docker-Volumes bei der ersten Initialisierung root-owned sein können
# und der chown im Dockerfile nur das Image-Layer betrifft, nicht das gemountete Volume.
chown -R www-data:www-data "${EINKAUF_DATA_DIR:-/data}"
exec "$@"
