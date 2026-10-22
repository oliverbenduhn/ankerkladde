#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ESBUILD="$ROOT_DIR/node_modules/.bin/esbuild"
TARGET="$ROOT_DIR/public/vendor/editors"

mkdir -p "$TARGET/excalidraw-assets"
"$ESBUILD" "$ROOT_DIR/scripts/vendor-src/tiptap.js" \
  --bundle --minify --format=esm --platform=browser --target=es2020 \
  --outfile="$TARGET/tiptap.js"
"$ESBUILD" "$ROOT_DIR/scripts/vendor-src/sketch.js" \
  --bundle --minify --format=esm --platform=browser --target=es2020 \
  --define:process.env.IS_PREACT=false \
  --loader:.woff2=file --asset-names=excalidraw-assets/[name]-[hash] \
  --outfile="$TARGET/sketch.js"

cp -R "$ROOT_DIR"/node_modules/@excalidraw/excalidraw/dist/excalidraw-assets/. "$TARGET/excalidraw-assets/"
node "$ROOT_DIR/scripts/write-vendor-manifest.mjs" "$TARGET"
