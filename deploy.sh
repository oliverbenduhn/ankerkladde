#!/bin/bash
set -euo pipefail
cd /var/www/projects/einkauf

echo "[$(date)] Deploy gestartet" >> /var/log/einkauf/deploy.log

git pull origin main >> /var/log/einkauf/deploy.log 2>&1

rc-service php-fpm83 reload >> /var/log/einkauf/deploy.log 2>&1

echo "[$(date)] Deploy abgeschlossen" >> /var/log/einkauf/deploy.log
