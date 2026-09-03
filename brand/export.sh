#!/usr/bin/env bash
# Export the BranchWise logo SVGs to PNG (transparent background) in brand/png/.
# Usage: npm run brand      (from the repo root)
#        ./brand/export.sh
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
chrome="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
[ -x "$chrome" ] || { echo "Google Chrome not found at $chrome" >&2; exit 1; }
mkdir -p "$here/png"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# shot <svg file> <output png> <css width> <css height> <scale>
shot () {
  local svg="$1" out="$2" w="$3" h="$4" s="$5"
  cat > "$tmp/page.html" <<HTML
<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent}
img{display:block;width:${w}px;height:${h}px}</style>
<img src="file://$here/$svg">
HTML
  "$chrome" --headless=new --disable-gpu --hide-scrollbars \
    --default-background-color=00000000 --force-device-scale-factor="$s" \
    --window-size="$w,$h" --screenshot="$here/png/$out" "file://$tmp/page.html" 2>/dev/null
  echo "  png/$out"
}

echo "exporting…"
shot branchwise-lockup.svg      lockup.png        288 64  6   # 1728 x 384
shot branchwise-lockup-dark.svg lockup-dark.png   288 64  6
shot branchwise-mark.svg        mark.png          64  64  16  # 1024 square
shot branchwise-mark-white.svg  mark-white.png    64  64  16
for size in 1024 512 256 128 64 32; do
  shot branchwise-icon.svg "icon-$size.png" "$size" "$size" 1
done
# macOS variant: same mark, inset to Apple's icon grid so it doesn't sit larger in the
# Dock than every other app.
for size in 1024 512; do
  shot branchwise-icon-macos.svg "icon-macos-$size.png" "$size" "$size" 1
done
echo "done — see $here/png"
