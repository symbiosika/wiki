#!/usr/bin/env bash
#
# Build the uploadable Teams app package.
#
# Teams expects a flat ZIP — manifest and icons at the root, no directory
# entries — which is why this exists instead of a plain `zip -r`: a package with
# a folder inside is rejected on upload with a generic error.
#
# Usage:  docs/teams-app/pack.sh [output.zip]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-$here/symbiosika-wiki-teams.zip}"

for file in manifest.json color.png outline.png; do
  [ -f "$here/$file" ] || { echo "missing: $file" >&2; exit 1; }
done

# Fail early on a manifest that Teams would reject anyway.
if command -v jq >/dev/null 2>&1; then
  jq -e '.id and .webApplicationInfo.id and .staticTabs[0].contentUrl' \
    "$here/manifest.json" >/dev/null
fi

rm -f "$out"
# -j drops the directory names, which is what makes the ZIP flat.
zip -j -q "$out" "$here/manifest.json" "$here/color.png" "$here/outline.png"

echo "$out"
