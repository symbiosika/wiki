# „502 Bad Gateway" eingrenzen

Sporadische *Bad Gateway*-Fehler bei einem Setup aus **Reverse Proxy → LXC-Container
(Proxmox) → Docker Compose → App** sind fast immer eine von drei Ursachen — und von
außen sehen alle drei identisch aus:

| Schicht | Typische Ursache | Wer meldet 502 |
|---|---|---|
| Reverse Proxy | Upstream-IP veraltet, Keepalive-Mismatch, Timeout zu kurz | Proxy |
| Container / Host | Prozess neu gestartet, OOM-Kill, Docker-Restart, Netzwerk weg | Proxy (App war weg) |
| App | Absturz, blockierter Event-Loop, sehr langsame Antwort | Proxy (App antwortete nicht) |

**502 kommt *immer* vom Reverse Proxy.** Die Frage ist nie „wer schickt den Fehler",
sondern „warum bekam der Proxy keine Antwort". Genau dafür gibt es das *Ops-Log*.

---

## 1. Was die App jetzt loggt

`backend/src/lib/diagnostics/` schreibt eine eigene, maschinenlesbare Zeile pro
Ereignis (NDJSON), erkennbar am Präfix `[ops]`:

- **auf stdout** → `docker compose logs app`
- **zusätzlich in `logs/ops.log`** im Container (rotiert, max. 5 × 2 MB),
  abschaltbar mit `OPS_LOG_FILE=false`

Es gibt vier Ereignistypen. Jeder trägt eine `boot`-ID — sie ändert sich bei
**jedem** Prozessstart und ist das wichtigste Feld überhaupt.

### `boot` — der Prozess startet

```json
{"ts":"2026-08-06T10:59:32.336Z","event":"boot","boot":"qpSpuuDDrr","pid":1,
 "runtime":"bun 1.3.11","memory":{"rssMb":42,...}}
```

Ein `boot` zum Zeitpunkt des 502 heißt: die App war weg. Damit ist die Frage
„Proxy oder App" bereits beantwortet — weiter bei `shutdown`/`crash`.

### `shutdown` / `crash` — der Prozess endet

```json
{"event":"crash","boot":"qpSpuuDDrr","reason":"unhandledRejection",
 "error":{"message":"…","stack":"…"},"uptimeS":4021,
 "counters":{...},"inflight":2,"inflightRequests":[…]}
```

`reason` sagt, **wer** den Prozess beendet hat:

| `reason` | Bedeutung |
|---|---|
| `SIGTERM` | Von außen gestoppt: `docker restart`, Redeploy, LXC-Shutdown — **oder der OOM-Killer des Hosts** |
| `SIGINT` / `SIGHUP` | Interaktiv gestoppt, Terminal weg |
| `uncaughtException` | Nicht abgefangene Exception in der App |
| `unhandledRejection` | Nicht abgefangene Promise-Rejection in der App |
| `exit` | Regulärer Exit ohne Signal |

> **Wichtig:** Bun beendet den Prozess bei `uncaughtException` **und** bei
> `unhandledRejection` mit Exit-Code 1. Eine einzige „vergessene" Promise in
> einem Cron-Tick oder Job reicht also, um den kompletten Server zu killen —
> Docker startet ihn wegen `restart: unless-stopped` sofort neu, und **jeder
> Request in diesem Fenster wird zu 502**. Das ist die mit Abstand häufigste
> App-seitige Ursache und war bisher nur als einzelner Stacktrace in stdout
> sichtbar. Jetzt steht sie mit Zeitstempel, Stacktrace und Uptime im Ops-Log.

### `heartbeat` — alle 30 Sekunden, auch wenn nichts passiert

```json
{"event":"heartbeat","boot":"jR1…","uptimeS":1830,"loopLagMs":3,
 "memory":{"rssMb":512,…},
 "containerMemory":{"source":"cgroup-v2","limitMb":2048,"usedMb":1980,
                    "usedPercent":96.7,"oomKills":0,"limitHits":143},
 "loadavg":[1.2,0.9,0.7],"inflight":2,
 "longRunning":[{"id":"r-…","path":"/api/v1/…","ms":42000}],
 "delta":{"requests":180,"status5xx":0,…},"total":{…}}
```

Der Heartbeat beantwortet das, was Request-Logs nicht können:

- **Lücke im Heartbeat** → Prozess war weg oder eingefroren. Die `boot`-ID der
  nächsten Zeile sagt, was davon: gleiche ID = eingefroren, neue ID = neu gestartet.
- **`loopLagMs`** — wie viel später ein trivialer Timer tatsächlich lief.
  Dauerhaft > 500 ms heißt: der Event-Loop war mit synchroner Arbeit blockiert
  und konnte in dieser Zeit **keine Verbindung annehmen** — genau das sieht ein
  Proxy als toten Upstream.
- **`containerMemory`** — Speicher aus Sicht des *Containers*, inklusive Limit.
  `usedPercent` nahe 100 und steigende `limitHits`/`oomKills` = der Container ist
  zu klein bzw. die App leakt. `oomKills > 0` ist der Beweis, dass der Kernel
  getötet hat — nicht die App abgestürzt ist.
- **`longRunning`** — Requests, die seit > 10 s laufen und **noch nicht
  geantwortet** haben. Wenn der Proxy nach 60 s aufgibt und hier ein Request mit
  `ms: 60000` steht, ist die App die langsame Seite. (Gemessen wird bis zu den
  Response-Headern: ein gestreamter Chat, dessen Header sofort kommen und dessen
  Body zwei Minuten läuft, taucht hier nicht auf — dafür ist `client-aborted` im
  Request-Log das Signal.)

### `request` / `request-error` — auffällige Requests

Erfolgreiche, schnelle Requests werden **nicht** geloggt (sonst ertrinken die
interessanten Zeilen in Static-Assets). Geloggt wird:

| `reason` | Bedeutung |
|---|---|
| `server-error` | Antwort mit Status ≥ 500 |
| `slow` | Dauer ≥ `OPS_SLOW_REQUEST_MS` (Default 3000 ms) |
| `client-aborted` | Der Client (= der Proxy!) hat die Verbindung vorher gekappt |
| `no-response` | Handler lieferte gar keine Antwort |
| `all` | nur bei `OPS_LOG_ALL_REQUESTS=true` |

Der Query-String wird bewusst **nicht** geloggt — dort stehen Magic-Link-Tokens
und OAuth-Codes.

Jede Antwort bekommt zusätzlich die Header **`X-Request-Id`** und **`X-Boot-Id`**.
Schickt der Proxy schon einen `X-Request-Id`, wird dieser übernommen. Damit lässt
sich ein einzelner Request zwischen Proxy-Log und App-Log exakt zuordnen — siehe
Abschnitt 4.

---

## 2. Einschalten

Alles außer dem Diagnose-Endpoint ist **standardmäßig aktiv**. Konfiguration über
Umgebungsvariablen (siehe `.env.prod.example`):

| Variable | Default | Wirkung |
|---|---|---|
| `OPS_LOG` | `true` | Ops-Log komplett aus mit `false` |
| `OPS_LOG_FILE` | `true` | Zusätzlich `logs/ops.log` schreiben |
| `OPS_HEARTBEAT_MS` | `30000` | Heartbeat-Intervall, `0` = aus |
| `OPS_SLOW_REQUEST_MS` | `3000` | Ab hier gilt ein Request als langsam |
| `OPS_LOG_ALL_REQUESTS` | `false` | Vollständiges Access-Log (nur zur Fehlersuche) |
| `DIAGNOSTICS_TOKEN` | *(leer)* | Aktiviert `GET /internal/diagnostics` |

**Damit `logs/ops.log` einen Neustart des Containers übersteht**, in
`docker-compose.prod.yml` das Volume aktivieren:

```yaml
    volumes:
      - app_logs:/usr/src/app/logs
      # oder als Bind-Mount, dann direkt vom LXC-Host lesbar:
      # - ./logs/app:/usr/src/app/logs
```

### Live-Snapshot ohne Shell

```bash
DIAGNOSTICS_TOKEN=<langes-zufälliges-secret>   # in .env setzen
curl -s -H "X-Diagnostics-Token: $TOKEN" https://wiki.example.com/internal/diagnostics | jq
```

Liefert Boot-ID, Uptime, Speicher, Container-Limit, Zähler, laufende Requests und
die letzten ~200 Ereignisse plus 30 Minuten Heartbeat-Historie.

Der Endpoint wird **vor** Hono ausgewertet und funktioniert deshalb auch dann,
wenn die Datenbank nicht erreichbar ist — in diesem Zustand registriert
`defineServer()` die Anwendungsrouten nämlich gar nicht erst, `/health/detail`
antwortet dann 404. Ohne gesetztes `DIAGNOSTICS_TOKEN` existiert der Pfad nicht
(normales 404), es gibt also nichts zu scannen.

---

## 3. Den Reverse Proxy zum Mitloggen bringen

Ohne Gegenstück im Proxy-Log ist die halbe Information weg. Entscheidend sind
`upstream_status`, die Upstream-Zeiten und die Request-ID.

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

        # Request-ID durchreichen — dieselbe ID taucht dann im Ops-Log auf
        proxy_set_header X-Request-Id $request_id;

        # HTTP/1.1 ist Pflicht. Mit dem Default HTTP/1.0 laufen Keepalive und
        # WebSocket-Upgrade auseinander — eine klassische Quelle für genau die
        # sporadischen 502, die sonst niemand erklären kann.
        proxy_http_version 1.1;
        proxy_set_header Connection "";

        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Lange Antworten (KI-Streaming, Uploads, Import) brauchen Luft.
        proxy_read_timeout    300s;
        proxy_send_timeout    300s;
        proxy_connect_timeout 10s;
    }

    # WebSocket (Protokoll-Realtime)
    location /api/v1/tenant/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade    $http_upgrade;
        proxy_set_header Connection $connection_upgrade;   # map: '' / 'upgrade'
        proxy_read_timeout 3600s;
    }
}
```

Im nginx-`error_log` steht bei einem 502 immer eine der drei Zeilen — und die
sagt schon fast alles:

| nginx-Fehlertext | Heißt |
|---|---|
| `connect() failed (111: Connection refused)` | Am Port hörte niemand → App war unten |
| `upstream prematurely closed connection` | App hat mitten in der Antwort aufgelegt → Absturz oder Keepalive-Mismatch |
| `upstream timed out` (meist 504) | App hat zu lange gebraucht → `slow`/`longRunning` im Ops-Log prüfen |

### Traefik

```yaml
# statische Konfiguration
accessLog:
  filePath: /var/log/traefik/access.log
  format: json
  fields:
    headers:
      names:
        X-Request-Id: keep
        X-Boot-Id: keep

# Timeouts am ServersTransport
serversTransport:
  forwardingTimeouts:
    dialTimeout: 10s
    responseHeaderTimeout: 300s
```

Relevante Felder im JSON-Log: `OriginStatus`, `Duration`, `RetryAttempts`.

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

## 4. Entscheidungsbaum bei einem konkreten 502

Zeitpunkt und Pfad aus dem Proxy-Log nehmen, dann im Ops-Log nachsehen:

```bash
# Ops-Zeilen um den Zeitpunkt herum
docker compose -f docker-compose.prod.yml logs app --since 30m | grep '^\[ops\]'

# oder aus der Datei, hübsch formatiert
docker compose -f docker-compose.prod.yml exec app \
  sh -c "grep -h '' /usr/src/app/logs/ops.log" | jq -c 'select(.event != "heartbeat")'

# nur Lebenszyklus-Ereignisse — sind wir überhaupt neu gestartet?
docker compose -f docker-compose.prod.yml logs app | grep '^\[ops\]' \
  | sed 's/^\[ops\] //' | jq -c 'select(.event=="boot" or .event=="crash" or .event=="shutdown")'

# einen einzelnen Request über beide Logs verfolgen
grep "<request-id>" /var/log/nginx/wiki-upstream.log
docker compose -f docker-compose.prod.yml logs app | grep "<request-id>"
```

Dann:

1. **Steht um den Zeitpunkt ein `crash` oder `shutdown` + `boot` im Log?**
   → Die App war weg. `reason` sagt warum:
   - `unhandledRejection` / `uncaughtException` → **App-Bug**, Stacktrace steht dabei.
   - `SIGTERM` ohne Redeploy → von außen gekillt. Weiter bei Punkt 5 (OOM).

2. **Klafft eine Lücke in den Heartbeats, ohne `crash`/`boot`?**
   → Der Prozess lebte, antwortete aber nicht: `kill -9`, eingefrorener
   Container, oder der Host hat den ganzen LXC angehalten. `loadavg` und
   `containerMemory` der letzten Heartbeats davor ansehen.

3. **Heartbeats laufen durch, Request steht als `slow`/`longRunning` im Log?**
   → Die App ist die langsame Seite. Proxy-Timeout vergleichen
   (`proxy_read_timeout`) — passt er nicht zur realen Laufzeit, ist der Timeout
   die eigentliche Ursache.

4. **Heartbeats laufen durch, `boot`-ID unverändert, und der Request taucht im
   Ops-Log gar nicht auf?**
   → Der Request hat die App nie erreicht. Damit liegt es **nicht an der App**:
   Proxy-Konfiguration, Upstream-Adresse, Docker-Port-Mapping oder Netzwerk
   zwischen LXC und Proxy. Gegenprobe direkt am Container vorbei am Proxy:
   ```bash
   curl -sv http://127.0.0.1:3000/health          # vom LXC-Host aus
   ```

5. **`request` steht mit Status 200 im Ops-Log, der Proxy meldet trotzdem 502?**
   → Die Antwort ging zwischen App und Proxy verloren. In aller Regel
   Keepalive-Mismatch (`proxy_http_version 1.1` + `Connection ""` fehlt) oder
   eine zu kleine `proxy_buffer_size` bei großen Headern.

---

## 5. Was auf Container- und Host-Ebene zu prüfen ist

Das Ops-Log endet am Prozess. Diese Befehle decken den Rest ab:

```bash
# Wie oft wurde der Container neu gestartet — und woran ist er gestorben?
docker inspect --format \
  '{{.Name}} restarts={{.RestartCount}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} started={{.State.StartedAt}}' \
  $(docker compose -f docker-compose.prod.yml ps -q app)

# Zeitleiste aller Container-Ereignisse (start/die/oom/health_status)
docker events --since 24h --filter event=die --filter event=oom --filter event=restart

# OOM-Killer im Kernel-Log — im LXC-Container UND auf dem Proxmox-Host prüfen!
dmesg -T | grep -iE 'killed process|out of memory|oom'
journalctl -k --since "2 hours ago" | grep -i oom
```

Auf dem **Proxmox-Host** zusätzlich:

```bash
pct config <vmid>                 # Memory-/Swap-Limit des LXC
pct exec <vmid> -- free -m
grep -i oom /var/log/syslog       # Host-OOM trifft den ganzen Container
```

> `State.OOMKilled=false` schließt einen OOM **nicht** aus: wenn der Kernel des
> Hosts unter Speicherdruck den Bun-Prozess auswählt, sieht Docker nur ein
> `SIGTERM`/`SIGKILL`. Die Kombination aus `oomKills`/`usedPercent` im Heartbeat
> und `dmesg` auf dem Host ist der zuverlässige Nachweis.

### Empfohlene Compose-Ergänzungen

Beides ist in `docker-compose.prod.yml` bereits vorbereitet:

- **Healthcheck** auf `/health` — macht Neustarts in `docker ps` und
  `docker events` sichtbar, statt sie nur zu erahnen.
- **Log-Rotation** für den json-file-Treiber, damit stdout-Logs nicht die
  Container-Disk füllen (was seinerseits Abstürze verursacht).
- Ein **Memory-Limit** ist auskommentiert. Setzt man es, wird ein Speicherleck
  zu einem sauberen, im Log sichtbaren OOM des Containers statt zu einem
  unerklärlichen Kill irgendwo im LXC.

---

## 6. Bekannte App-spezifische Stolperstellen

- **Startfenster:** `defineServer()` registriert alle Anwendungsrouten erst,
  *nachdem* die DB-Verbindung steht und die Lizenzprüfung durch ist. In diesen
  Sekunden antwortet `/health` bereits mit 200, alle `/api/v1/*`-Routen aber mit
  **404** (nicht 502). Ein Health-Check auf `/health` meldet den Container also
  früher „gesund", als er tatsächlich benutzbar ist — bei Deployments relevant.
- **Lange Antworten:** KI-Streaming, URL-Import und PDF-Parsing laufen deutlich
  länger als der nginx-Default von 60 s. Bun ist mit `idleTimeout: 255` (Sekunden)
  konfiguriert; der Proxy sollte darunter oder gleichauf liegen, nicht darüber.
- **WebSockets:** Der Protokoll-Realtime-Endpunkt braucht `Upgrade`/`Connection`
  im Proxy. Fehlen sie, scheitert nur der Upgrade — im Ops-Log als
  `no-response`/`client-aborted` sichtbar.
- **`X-Forwarded-For` fehlt im Ops-Log?** Dann reicht der Proxy den Header nicht
  durch, und alle IP-Angaben der App sind die des Proxys.
