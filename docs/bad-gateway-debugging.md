# Narrowing down "502 Bad Gateway"

Sporadic *Bad Gateway* errors in a setup of **reverse proxy → LXC container
(Proxmox) → Docker Compose → app** almost always come from one of three causes — and
from the outside all three look identical:

| Layer | Typical cause | Who reports 502 |
|---|---|---|
| Reverse proxy | Stale upstream IP, keepalive mismatch, timeout too short | Proxy |
| Container / host | Process restarted, OOM kill, Docker restart, network gone | Proxy (app was gone) |
| App | Crash, blocked event loop, very slow response | Proxy (app did not respond) |

**502 *always* comes from the reverse proxy.** The question is never "who sends the error",
but "why did the proxy get no response". That is exactly what the *ops log* is for.

---

## 1. What the app now logs

`backend/src/lib/diagnostics/` writes its own machine-readable line per
event (NDJSON), recognisable by the `[ops]` prefix:

- **to stdout** → `docker compose logs app`
- **additionally to `logs/ops.log`** inside the container (rotated, max. 5 × 2 MB),
  can be disabled with `OPS_LOG_FILE=false`

There are four event types. Each carries a `boot` ID — it changes on
**every** process start and is the single most important field.

### `boot` — the process starts

```json
{"ts":"2026-08-06T10:59:32.336Z","event":"boot","boot":"qpSpuuDDrr","pid":1,
 "runtime":"bun 1.3.11","memory":{"rssMb":42,...}}
```

A `boot` at the time of the 502 means: the app was gone. That already answers
the question "proxy or app" — continue with `shutdown`/`crash`.

### `shutdown` / `crash` — the process ends

```json
{"event":"crash","boot":"qpSpuuDDrr","reason":"unhandledRejection",
 "error":{"message":"…","stack":"…"},"uptimeS":4021,
 "counters":{...},"inflight":2,"inflightRequests":[…]}
```

`reason` tells you **who** ended the process:

| `reason` | Meaning |
|---|---|
| `SIGTERM` | Stopped from outside: `docker restart`, redeploy, LXC shutdown — **or the host's OOM killer** |
| `SIGINT` / `SIGHUP` | Stopped interactively, terminal gone |
| `uncaughtException` | Uncaught exception in the app |
| `unhandledRejection` | Unhandled promise rejection in the app |
| `exit` | Regular exit without a signal |

> **Important:** Bun terminates the process on `uncaughtException` **and** on
> `unhandledRejection` with exit code 1. A single "forgotten" promise in
> a cron tick or job is therefore enough to kill the entire server —
> Docker restarts it immediately because of `restart: unless-stopped`, and **every
> request in that window becomes a 502**. This is by far the most common
> app-side cause and used to be visible only as a lone stack trace in stdout.
> Now it shows up in the ops log with timestamp, stack trace and uptime.

### `heartbeat` — every 30 seconds, even when nothing happens

```json
{"event":"heartbeat","boot":"jR1…","uptimeS":1830,"loopLagMs":3,
 "memory":{"rssMb":512,…},
 "containerMemory":{"source":"cgroup-v2","limitMb":2048,"usedMb":1980,
                    "usedPercent":96.7,"oomKills":0,"limitHits":143},
 "loadavg":[1.2,0.9,0.7],"inflight":2,
 "longRunning":[{"id":"r-…","path":"/api/v1/…","ms":42000}],
 "delta":{"requests":180,"status5xx":0,…},"total":{…}}
```

The heartbeat answers what request logs cannot:

- **Gap in the heartbeat** → the process was gone or frozen. The `boot` ID of the
  next line tells you which: same ID = frozen, new ID = restarted.
- **`loopLagMs`** — how much later a trivial timer actually ran.
  Consistently > 500 ms means: the event loop was blocked by synchronous work
  and during that time **could not accept any connection** — which is exactly what a
  proxy sees as a dead upstream.
- **`containerMemory`** — memory from the *container's* point of view, including the limit.
  `usedPercent` close to 100 and rising `limitHits`/`oomKills` = the container is
  too small or the app is leaking. `oomKills > 0` is proof that the kernel
  did the killing — not that the app crashed.
- **`longRunning`** — requests that have been running for > 10 s and have **not yet
  responded**. If the proxy gives up after 60 s and a request with
  `ms: 60000` shows up here, the app is the slow side. (Measurement stops at the
  response headers: a streamed chat whose headers arrive immediately and whose
  body runs for two minutes does not show up here — for that, `client-aborted` in
  the request log is the signal.)

### `request` / `request-error` — notable requests

Successful, fast requests are **not** logged (otherwise the
interesting lines would drown in static assets). What gets logged:

| `reason` | Meaning |
|---|---|
| `server-error` | Response with status ≥ 500 |
| `slow` | Duration ≥ `OPS_SLOW_REQUEST_MS` (default 3000 ms) |
| `client-aborted` | The client (= the proxy!) cut the connection first |
| `no-response` | Handler returned no response at all |
| `all` | only with `OPS_LOG_ALL_REQUESTS=true` |

The query string is deliberately **not** logged — it contains magic-link tokens
and OAuth codes.

Every response additionally gets the headers **`X-Request-Id`** and **`X-Boot-Id`**.
If the proxy already sends an `X-Request-Id`, that one is reused. This lets
you match a single request exactly between the proxy log and the app log — see
section 4.

---

## 2. Enabling it

Everything except the diagnostics endpoint is **active by default**. Configuration via
environment variables (see `.env.prod.example`):

| Variable | Default | Effect |
|---|---|---|
| `OPS_LOG` | `true` | Turn the ops log off completely with `false` |
| `OPS_LOG_FILE` | `true` | Additionally write `logs/ops.log` |
| `OPS_HEARTBEAT_MS` | `30000` | Heartbeat interval, `0` = off |
| `OPS_SLOW_REQUEST_MS` | `3000` | Threshold above which a request counts as slow |
| `OPS_LOG_ALL_REQUESTS` | `false` | Full access log (for troubleshooting only) |
| `DIAGNOSTICS_TOKEN` | *(empty)* | Enables `GET /internal/diagnostics` |

**For `logs/ops.log` to survive a container restart**, enable the volume in
`docker-compose.prod.yml`:

```yaml
    volumes:
      - app_logs:/usr/src/app/logs
      # or as a bind mount, then directly readable from the LXC host:
      # - ./logs/app:/usr/src/app/logs
```

### Live snapshot without a shell

```bash
DIAGNOSTICS_TOKEN=<long-random-secret>   # set in .env
curl -s -H "X-Diagnostics-Token: $TOKEN" https://wiki.example.com/internal/diagnostics | jq
```

Returns boot ID, uptime, memory, container limit, counters, running requests and
the last ~200 events plus 30 minutes of heartbeat history.

The endpoint is evaluated **before** Hono and therefore works even when
the database is unreachable — in that state `defineServer()` does not
register the application routes at all, and `/health/detail`
then responds with 404. Without `DIAGNOSTICS_TOKEN` set, the path does not exist
(plain 404), so there is nothing to scan.

---

## 3. Getting the reverse proxy to log along

Without a counterpart in the proxy log, half of the information is missing. What matters is
`upstream_status`, the upstream timings and the request ID.

### nginx

```nginx
log_format upstream '$time_iso8601 $status ureq=$request_id '
                    'ustatus=$upstream_status uaddr=$upstream_addr '
                    'uconn=$upstream_connect_time uheader=$upstream_header_time '
                    'uresp=$upstream_response_time rt=$request_time '
                    '"$request" ubootid=$upstream_http_x_boot_id';

server {
    access_log /var/log/nginx/wiki-upstream.log upstream;
    error_log  /var/log/nginx/wiki-error.log warn;

    location / {
        proxy_pass http://127.0.0.1:3000;

        # Pass the request ID through — the same ID then shows up in the ops log
        proxy_set_header X-Request-Id $request_id;

        # HTTP/1.1 is mandatory. With the default HTTP/1.0, keepalive and
        # WebSocket upgrade get out of sync — a classic source of exactly the
        # sporadic 502s that nobody can otherwise explain.
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Long responses (AI streaming, uploads, import) need headroom.
        proxy_read_timeout    300s;
        proxy_send_timeout    300s;
        proxy_connect_timeout 10s;
    }

    # WebSocket (protocol realtime)
    location /api/v1/tenant/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;   # map: '' / 'upgrade'
        proxy_read_timeout 3600s;
    }
}
```

For a 502, the nginx `error_log` always contains one of three lines — and that
line already tells you almost everything:

| nginx error text | Means |
|---|---|
| `connect() failed (111: Connection refused)` | Nobody was listening on the port → app was down |
| `upstream prematurely closed connection` | App hung up in the middle of the response → crash or keepalive mismatch |
| `upstream timed out` (usually 504) | App took too long → check `slow`/`longRunning` in the ops log |

### Traefik

```yaml
# static configuration
accessLog:
  filePath: /var/log/traefik/access.log
  format: json
  fields:
    headers:
      names:
        X-Request-Id: keep
        X-Boot-Id: keep

# timeouts on the ServersTransport
serversTransport:
  forwardingTimeouts:
    dialTimeout: 10s
    responseHeaderTimeout: 300s
```

Relevant fields in the JSON log: `OriginStatus`, `Duration`, `RetryAttempts`.

### Caddy

```caddyfile
wiki.example.com {
    log {
        output file /var/log/caddy/wiki.log
        format json
    }
    reverse_proxy 127.0.0.1:3000 {
        header_up X-Request-Id {http.request.uuid}
        transport http {
            dial_timeout 10s
            read_timeout 300s
        }
    }
}
```

---

## 4. Decision tree for a specific 502

Take the time and path from the proxy log, then look them up in the ops log:

```bash
# ops lines around that point in time
docker compose -f docker-compose.prod.yml logs app --since 30m | grep '^\[ops\]'

# or from the file, nicely formatted
docker compose -f docker-compose.prod.yml exec app \
  sh -c "grep -h '' /usr/src/app/logs/ops.log" | jq -c 'select(.event != "heartbeat")'

# lifecycle events only — did we restart at all?
docker compose -f docker-compose.prod.yml logs app | grep '^\[ops\]' \
  | sed 's/^\[ops\] //' | jq -c 'select(.event=="boot" or .event=="crash" or .event=="shutdown")'

# follow a single request across both logs
grep "<request-id>" /var/log/nginx/wiki-upstream.log
docker compose -f docker-compose.prod.yml logs app | grep "<request-id>"
```

Then:

1. **Is there a `crash` or `shutdown` + `boot` in the log around that time?**
   → The app was gone. `reason` tells you why:
   - `unhandledRejection` / `uncaughtException` → **app bug**, the stack trace is included.
   - `SIGTERM` without a redeploy → killed from outside. Continue with item 5 (OOM).

2. **Is there a gap in the heartbeats, without `crash`/`boot`?**
   → The process was alive but did not respond: `kill -9`, frozen
   container, or the host paused the entire LXC. Look at `loadavg` and
   `containerMemory` of the last heartbeats before it.

3. **Heartbeats keep running, request shows up as `slow`/`longRunning` in the log?**
   → The app is the slow side. Compare the proxy timeout
   (`proxy_read_timeout`) — if it does not match the real runtime, the timeout
   is the actual cause.

4. **Heartbeats keep running, `boot` ID unchanged, and the request does not appear
   in the ops log at all?**
   → The request never reached the app. So it is **not the app's fault**:
   proxy configuration, upstream address, Docker port mapping or the network
   between LXC and proxy. Cross-check directly against the container, bypassing the proxy:
   ```bash
   curl -sv http://127.0.0.1:3000/health          # from the LXC host
   ```

5. **`request` shows up with status 200 in the ops log, but the proxy still reports 502?**
   → The response got lost between app and proxy. As a rule this is a
   keepalive mismatch (`proxy_http_version 1.1` + `Connection ""` missing) or
   a `proxy_buffer_size` that is too small for large headers.

---

## 5. What to check at the container and host level

The ops log ends at the process. These commands cover the rest:

```bash
# How often was the container restarted — and what did it die of?
docker inspect --format \
  '{{.Name}} restarts={{.RestartCount}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} started={{.State.StartedAt}}' \
  $(docker compose -f docker-compose.prod.yml ps -q app)

# Timeline of all container events (start/die/oom/health_status)
docker events --since 24h --filter event=die --filter event=oom --filter event=restart

# OOM killer in the kernel log — check inside the LXC container AND on the Proxmox host!
dmesg -T | grep -iE 'killed process|out of memory|oom'
journalctl -k --since "2 hours ago" | grep -i oom
```

Additionally on the **Proxmox host**:

```bash
pct config <vmid>                 # memory/swap limit of the LXC
pct exec <vmid> -- free -m
grep -i oom /var/log/syslog       # a host OOM hits the whole container
```

> `State.OOMKilled=false` does **not** rule out an OOM: if the host's kernel
> picks the Bun process under memory pressure, Docker only sees a
> `SIGTERM`/`SIGKILL`. The combination of `oomKills`/`usedPercent` in the heartbeat
> and `dmesg` on the host is the reliable proof.

### Recommended Compose additions

Both are already prepared in `docker-compose.prod.yml`:

- **Healthcheck** on `/health` — makes restarts visible in `docker ps` and
  `docker events` instead of leaving you to guess at them.
- **Log rotation** for the json-file driver, so stdout logs do not fill up the
  container disk (which in turn causes crashes).
- A **memory limit** is commented out. If you set it, a memory leak
  turns into a clean OOM of the container that is visible in the log, instead of an
  inexplicable kill somewhere in the LXC.

---

## 6. Known app-specific pitfalls

- **Startup window:** `defineServer()` only registers all application routes
  *after* the DB connection is up and the license check has passed. During these
  seconds `/health` already responds with 200, but all `/api/v1/*` routes with
  **404** (not 502). A health check on `/health` therefore reports the container as "healthy"
  earlier than it is actually usable — relevant for deployments.
- **Long responses:** AI streaming, URL import and PDF parsing run considerably
  longer than the nginx default of 60 s. Bun is configured with `idleTimeout: 255` (seconds);
  the proxy should be below or equal to that, not above it.
- **WebSockets:** The protocol realtime endpoint needs `Upgrade`/`Connection`
  in the proxy. If they are missing, only the upgrade fails — visible in the ops log as
  `no-response`/`client-aborted`.
- **`X-Forwarded-For` missing from the ops log?** Then the proxy is not passing the header
  through, and all IP information in the app is that of the proxy.
