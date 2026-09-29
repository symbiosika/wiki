#!/usr/bin/env bash
# Fails a pull request that changes the app without bumping its version.
# Rules: AGENTS.md → "Versioning". Usage: check-version-bump.sh <base-ref>
set -euo pipefail

BASE="${1:-origin/develop}"
VERSION_FILE="backend/package.json"
# what ships in the image — docs, plans, workflows and tests alone need no bump
APP_PATHS='^(backend/(src|drizzle-sql)/|backend/framework$|backend/package\.json$|frontend/src/|frontend-public/src/|Dockerfile$)'

version_of() { sed -n 's/^  "version": "\([^"]*\)".*/\1/p' | head -1; }

changed=$(git diff --name-only "$BASE"...HEAD | grep -E "$APP_PATHS" | grep -vE '\.(test|spec)\.ts$' || true)
if [ -z "$changed" ]; then
  echo "No app code changed — no version bump needed."
  exit 0
fi

base_version=$(git show "$BASE:$VERSION_FILE" | version_of)
head_version=$(version_of < "$VERSION_FILE")
echo "base: ${base_version:-<none>}  head: ${head_version:-<none>}"

if [ -z "$head_version" ]; then
  echo "::error file=$VERSION_FILE::no \"version\" field in $VERSION_FILE"
  exit 1
fi
if ! [[ "$head_version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "::error file=$VERSION_FILE::version \"$head_version\" is not MAJOR.MINOR.PATCH"
  exit 1
fi
if [ -n "$base_version" ]; then
  highest=$(printf '%s\n%s\n' "$base_version" "$head_version" | sort -V | tail -1)
  if [ "$head_version" = "$base_version" ] || [ "$highest" != "$head_version" ]; then
    echo "::error file=$VERSION_FILE::app code changed but the version was not raised above $base_version — bump it (AGENTS.md → Versioning). Changed:"
    echo "$changed"
    exit 1
  fi
fi
if ! grep -q "^## \[$head_version\]" CHANGELOG.md; then
  echo "::error file=CHANGELOG.md::no \"## [$head_version]\" entry in CHANGELOG.md"
  exit 1
fi
echo "Version $head_version — ok."
