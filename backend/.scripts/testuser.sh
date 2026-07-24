#!/usr/bin/env bash
# End-to-end testuser login via magic link (local dev only).
# Requires SMTP_HOST=console.localhost so emails land in logs/email/.
#
# Usage: bash ./.scripts/testuser.sh [base-url]
#   e.g. bash ./.scripts/testuser.sh http://localhost:3000
set -euo pipefail

BASE_URL="${1:-${BASE_URL:-http://localhost:3000}}"
API_BASE="${API_BASE_PATH:-/api/v1}"
EMAIL="testing@env.local"
ENCODED_EMAIL="${EMAIL/@/%40}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_EMAIL_DIR="$SCRIPT_DIR/../logs/email"

echo ""
echo "========================================"
echo "  Testuser: $EMAIL"
echo "  Server:   $BASE_URL$API_BASE"
echo "========================================"
echo ""

# 1. Send magic link — creates user if not yet registered
echo "1/3  Sending magic link..."
SEND_RESULT=$(curl -sf \
  "$BASE_URL$API_BASE/user/send-magic-link?email=$ENCODED_EMAIL&createUserIfMissing=true" \
  || { echo "ERROR: server not reachable at $BASE_URL"; exit 1; })
echo "     $SEND_RESULT"

# Give the logger a moment to flush the email file
sleep 0.3

# 2. Read the newest email file written by the debug logger
echo ""
echo "2/3  Reading token from $LOG_EMAIL_DIR ..."
LATEST=$(ls -t "$LOG_EMAIL_DIR"/*.txt 2>/dev/null | head -1 || true)
if [[ -z "$LATEST" ]]; then
  echo "ERROR: no email files found in $LOG_EMAIL_DIR"
  echo "       Make sure SMTP_HOST=console.localhost is set in your .env"
  exit 1
fi
echo "     File: $(basename "$LATEST")"

TOKEN=$(grep -oE 'token=[A-Za-z0-9_-]+' "$LATEST" | head -1 | cut -d= -f2 || true)
if [[ -z "$TOKEN" ]]; then
  echo "ERROR: no token found in email file — content:"
  cat "$LATEST"
  exit 1
fi
echo "     Token: $TOKEN"

# 3. Verify the magic link → receive JWT + mark email as verified
echo ""
echo "3/3  Verifying magic link..."
RESULT=$(curl -sf "$BASE_URL$API_BASE/user/verify-email?token=$TOKEN" \
  || { echo "ERROR: verify-email failed"; exit 1; })

echo ""
echo "========================================"
echo "  Result"
echo "========================================"
echo "$RESULT"
echo ""

# Print just the JWT for easy copy-paste
JWT=$(echo "$RESULT" | grep -oE '"token":"[^"]*"' | cut -d'"' -f4 || true)
if [[ -n "$JWT" ]]; then
  echo "========================================"
  echo "  JWT (Bearer token)"
  echo "========================================"
  echo "$JWT"
  echo ""
fi
