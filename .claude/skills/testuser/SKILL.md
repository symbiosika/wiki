---
name: testuser
description: >
  Create or log in the local test user `testing@env.local` via the magic-link flow.
  Use when you need a JWT token for local development, want to test an authenticated
  endpoint, or when the user says "testuser", "test login", or "get a session token".
compatibility: Requires the server to be running with SMTP_HOST=console.localhost
---

# Testuser — local magic-link login

Creates (first run) or logs in the test user `testing@env.local` without a browser.
Uses the debug email flow: the magic-link token is read directly from `logs/email/`.

## Steps

Run the script and show the full output:

```bash
bash ./.scripts/testuser.sh
```

## What the script does

1. `GET /api/v1/user/send-magic-link?email=testing%40env.local&createUserIfMissing=true`
   — sends the magic link (creates the user on the very first call)
2. Reads the newest `logs/email/*.txt` file and extracts the token from the link URL
3. `GET /api/v1/user/verify-email?token=<TOKEN>`
   — marks the email as verified and returns `{ user, token: "<JWT>" }`

## Expected output

```
========================================
  Testuser: testing@env.local
  Server:   http://localhost:3000/api/v1
========================================

1/3  Sending magic link...
     {"ok":true}

2/3  Reading token from logs/email/ ...
     File: 2026-06-13T11-18-50-000_magic-link-login.txt
     Token: xK9mNpQzRvWy2eA8bL...

3/3  Verifying magic link...

========================================
  Result
========================================
{"user":{"id":"...","email":"testing@env.local",...},"token":"eyJhbGci..."}

========================================
  JWT (Bearer token)
========================================
eyJhbGci...
```

## Error cases

| Error | Cause | Fix |
|-------|-------|-----|
| `server not reachable` | Server not running | Start the server first |
| `no email files found` | Wrong SMTP config | Set `SMTP_HOST=console.localhost` in `.env` |
| `no token found` | Old email file read | Delete stale files in `logs/email/` |
