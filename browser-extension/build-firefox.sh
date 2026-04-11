#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
OUTPUT_DIR="${SCRIPT_DIR}/dist"

rm -rf "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}"
mkdir -p "${OUTPUT_DIR}/icons"

cp "${SCRIPT_DIR}/manifest-firefox.json" "${OUTPUT_DIR}/manifest.json"
cp "${SCRIPT_DIR}/popup.html" "${OUTPUT_DIR}/popup.html"
cp "${SCRIPT_DIR}/popup.js" "${OUTPUT_DIR}/popup.js"
cp "${SCRIPT_DIR}/background.js" "${OUTPUT_DIR}/background.js"
cp "${SCRIPT_DIR}/icon.png" "${OUTPUT_DIR}/icon.png"
cp "${SCRIPT_DIR}/icons/"*.png "${OUTPUT_DIR}/icons/"

cd "${OUTPUT_DIR}"
zip -r "${SCRIPT_DIR}/ankerkladde-extension-firefox.zip" .

printf 'Firefox-ZIP erstellt: %s\n' "${SCRIPT_DIR}/ankerkladde-extension-firefox.zip"