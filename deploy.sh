#!/bin/bash
# Production deploy script — called by the server after git push.
# Adjust APP_ROOT and LOG_FILE to match your server setup.
set -euo pipefail

APP_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="/var/log/ankerkladde/deploy.log"

echo "[$(date)] Deploy gestartet" >> "$LOG_FILE"

git -C "$APP_ROOT" pull origin main >> "$LOG_FILE" 2>&1

# Reload PHP-FPM — adjust service name to match your system:
#   Alpine (OpenRC):  rc-service php-fpm83 reload
#   Debian/Ubuntu:    systemctl reload php8.3-fpm
#   Docker:           no reload needed (handled by the container)
rc-service php-fpm83 reload >> "$LOG_FILE" 2>&1

echo "[$(date)] Deploy abgeschlossen" >> "$LOG_FILE"
