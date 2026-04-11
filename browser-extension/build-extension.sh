#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_ZIP="${SCRIPT_DIR}/ankerkladde-extension.zip"

php "${SCRIPT_DIR}/build-icons.php"
rm -f "${OUTPUT_ZIP}"
php "${SCRIPT_DIR}/build-extension.php"
