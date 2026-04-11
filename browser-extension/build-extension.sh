#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

php "${SCRIPT_DIR}/build-preserve-icons.php"
rm -f "${SCRIPT_DIR}"/ankerkladde-extension-v*.zip
php "${SCRIPT_DIR}/build-extension.php"
