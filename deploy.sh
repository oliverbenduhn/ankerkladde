#!/bin/bash
set -euo pipefail
cd /var/www/projects/ankerkladde

echo "[$(date)] Deploy gestartet" >> /var/log/ankerkladde/deploy.log

git pull origin main >> /var/log/ankerkladde/deploy.log 2>&1

rc-service php-fpm83 reload >> /var/log/ankerkladde/deploy.log 2>&1

echo "[$(date)] Deploy abgeschlossen" >> /var/log/ankerkladde/deploy.log
