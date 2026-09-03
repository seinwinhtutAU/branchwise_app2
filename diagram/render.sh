#!/usr/bin/env bash
# Render every .mmd in this folder to PNG and SVG in diagram/out/.
# Usage: npm run diagrams        (from the repo root)
#        ./diagram/render.sh     (directly)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="$here/out"
mkdir -p "$out"

mmdc="$here/../node_modules/.bin/mmdc"
if [ ! -x "$mmdc" ]; then
  echo "mermaid-cli is not installed. Run: npm install" >&2
  exit 1
fi

for f in "$here"/*.mmd; do
  name="$(basename "$f" .mmd)"
  echo "rendering $name"
  # -b white gives a solid background so the image drops cleanly into slides/Word.
  # -s 3 renders at 3x for a sharp PNG on a projector.
  "$mmdc" -i "$f" -o "$out/$name.png" -b white -s 3 -p "$here/puppeteer-config.json" --quiet
  "$mmdc" -i "$f" -o "$out/$name.svg" -b white     -p "$here/puppeteer-config.json" --quiet
done

echo "done — images are in $out"
