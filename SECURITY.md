# Security Policy

## Reporting a vulnerability

Please **do not open a public issue** for security problems.

Report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/symbiosika/wiki/security/advisories/new)
("Security" tab → "Report a vulnerability"). Include:

- what is affected (endpoint, MCP tool, UI view, version from `GET /health`),
- steps to reproduce or a proof of concept,
- the impact you expect (data exposure, privilege escalation, …).

We acknowledge reports as soon as possible, keep you updated while we work on
a fix, and credit you in the advisory unless you prefer otherwise.

## Supported versions

Only the latest release on `main` (and the current state of `develop`)
receives security fixes. The running version of an instance is reported by
`GET /health`.
