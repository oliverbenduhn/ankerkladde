#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${ROOT_DIR}/data/openfoodfacts"

mkdir -p "${DATA_DIR}"

download_and_import() {
    local dataset="$1"
    local url="$2"
    local target_file="$3"
    local truncate_flag="${4:-}"

    echo "Lade ${dataset} herunter..."
    curl -L --fail --output "${target_file}" "${url}"

    echo "Importiere ${dataset}..."
    if [[ -n "${truncate_flag}" ]]; then
        php "${ROOT_DIR}/scripts/import-openfoodfacts.php" --truncate --dataset="${dataset}" "${target_file}"
    else
        php "${ROOT_DIR}/scripts/import-openfoodfacts.php" --dataset="${dataset}" "${target_file}"
    fi
}

download_and_import \
    "food" \
    "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz" \
    "${DATA_DIR}/en.openfoodfacts.org.products.csv.gz" \
    "truncate"

download_and_import \
    "beauty" \
    "https://static.openbeautyfacts.org/data/en.openbeautyfacts.org.products.csv.gz" \
    "${DATA_DIR}/en.openbeautyfacts.org.products.csv.gz"

download_and_import \
    "petfood" \
    "https://static.openpetfoodfacts.org/data/en.openpetfoodfacts.org.products.csv.gz" \
    "${DATA_DIR}/en.openpetfoodfacts.org.products.csv.gz"

download_and_import \
    "products" \
    "https://static.openproductsfacts.org/data/en.openproductsfacts.org.products.csv.gz" \
    "${DATA_DIR}/en.openproductsfacts.org.products.csv.gz"

echo "Fertig. Alle Open-Facts-Kataloge wurden aktualisiert."
