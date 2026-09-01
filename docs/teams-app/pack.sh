#!/usr/bin/env bash
#
# Build the uploadable Teams app package.
#
# Two things Teams is unhelpfully strict about, both of which cost a round trip
# through the admin UI to discover:
#
#  1. The ZIP must be flat — manifest and icons at the root, no directory
#     entries. A package with a folder inside is rejected with a generic error.
#  2. The manifest schema sets `additionalProperties: false`. One unknown key
#     (e.g. `packageName`, which is not part of v1.17) fails the upload with
#     "Das App-Manifest aus Ihrem App-Paket konnte nicht analysiert werden."
#
# So the manifest is checked here first. The check is deliberately shallow: it
# compares the top-level keys against the v1.17 property list and verifies the
# required ones are present. It is not a schema validator — it catches the
# unknown-key and missing-key mistakes that are easy to make by hand, and Teams
# still has the last word.
#
# Usage:  docs/teams-app/pack.sh [output.zip]
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
out="${1:-$here/symbiosika-wiki-teams.zip}"

for file in manifest.json color.png outline.png; do
  [ -f "$here/$file" ] || { echo "missing: $file" >&2; exit 1; }
done

# Top-level properties of the v1.17 manifest schema
# (https://developer.microsoft.com/json-schemas/teams/v1.17/MicrosoftTeams.schema.json).
ALLOWED='["$schema","accentColor","activities","authorization","bots","composeExtensions","configurableProperties","configurableTabs","connectors","dashboardCards","defaultBlockUntilAdminAction","defaultGroupCapability","defaultInstallScope","description","developer","devicePermissions","extensions","graphConnector","icons","id","isFullScreen","localizationInfo","manifestVersion","meetingExtensionDefinition","name","permissions","publisherDocsUrl","showLoadingIndicator","staticTabs","subscriptionOffer","supportedChannelTypes","validDomains","version","webApplicationInfo"]'
REQUIRED='["manifestVersion","version","id","developer","name","description","icons","accentColor"]'

if command -v jq >/dev/null 2>&1; then
  unknown=$(jq -r --argjson allowed "$ALLOWED" \
    '[keys[] | select(. as $k | $allowed | index($k) | not)] | join(", ")' \
    "$here/manifest.json")
  if [ -n "$unknown" ]; then
    echo "manifest: unknown top-level key(s) for schema v1.17: $unknown" >&2
    echo "  Teams rejects these — the schema does not allow additional properties." >&2
    exit 1
  fi

  missing=$(jq -r --argjson required "$REQUIRED" \
    '. as $m | [$required[] | select($m[.] == null)] | join(", ")' \
    "$here/manifest.json")
  if [ -n "$missing" ]; then
    echo "manifest: missing required key(s): $missing" >&2
    exit 1
  fi

  # The tab has to point somewhere, and SSO needs the Entra app.
  jq -e '.staticTabs[0].contentUrl and .webApplicationInfo.id and .webApplicationInfo.resource' \
    "$here/manifest.json" >/dev/null \
    || { echo "manifest: staticTabs[0].contentUrl or webApplicationInfo is incomplete" >&2; exit 1; }
else
  echo "note: jq not found — skipping the manifest check" >&2
fi

rm -f "$out"
# -j drops the directory names, which is what makes the ZIP flat.
zip -j -q "$out" "$here/manifest.json" "$here/color.png" "$here/outline.png"

echo "$out"
