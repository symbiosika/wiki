# Framework change — bounds + env config for the generic PDF parser's async flow

**Target repo:** `symbiosika/symbiosika-framework` (the `backend/framework`
submodule). **Not** `symbiosika/wiki`.

> ## STATUS: proposed only — nothing implemented
>
> No code was written. This document is the handoff: it specifies the change so
> it can be implemented in a framework checkout, where it belongs. Nothing in
> the `backend/framework` submodule was modified in the session that produced
> this file.
>
> **Base:** framework `21acf8581dadd13243669c11f3b06ef286c8f346` (the submodule
> pointer of `symbiosika/wiki` at the time of writing). All line numbers below
> refer to that commit.
>
> **Single file affected:** `src/lib/knowledge/parsing/pdf/generic.ts`
> (+ its test `generic.test.ts`).

---

## Why

The generic parser's async flow has no upper bound anywhere. In
`generic.ts:74` (`runAsync`):

- the status loop (`generic.ts:91`) spins `while (!isComplete)` with no attempt
  cap and no deadline, breaking only on `completed` or `failed`;
- the delay between polls is the bare literal `1000` (`generic.ts:110`), with no
  env var behind it;
- none of the three `fetch` calls (job create, status poll, result retrieval)
  carries a `signal`, so none of them can time out.

Consequence: if the parsing service stalls — accepts a connection and then goes
quiet, or parks a job in a non-terminal state — the ingest worker polls forever.
The surrounding `knowledge:ingest` job stays `running` in the database
indefinitely, and there is no reaper: `processJob`
(`src/lib/jobs/index.ts:139`) simply `await`s the handler with no time budget,
and nothing sweeps stale rows.

This matters more now than it did before. Production was previously running the
parser in **sync** mode (`PDF_PARSER_SERVICE_MODE` unset → default `"sync"`,
`generic.ts:23`), which used a single `POST /v1/parse` and never entered this
loop. It has since been switched to `PDF_PARSER_SERVICE_MODE=async`, so the
unbounded loop is now the live code path.

For contrast, the URL parser already does this correctly:
`src/lib/knowledge/parsing/url.ts:33` defines `DEFAULT_FETCH_TIMEOUT_MS =
30_000` and drives it through an `AbortController`.

## Scope decisions (already made — do not widen)

- **Only `generic.ts`.** The identical unbounded poll loops in
  `symbiosika-parse.ts:119` and `llama-api.ts:70` are **deliberately left
  alone**; the behaviour of those services is not known well enough to bound
  them safely. (Noted for the record: `llama-api.ts:69` breaks only on
  `status === "SUCCESS"`, so a LlamaCloud `ERROR` status polls forever. Separate
  concern, separate decision.)
- **No deployment config changes.** `docker-compose.prod.yml` and
  `.env.prod.example` stay untouched. The `PDF_PARSER_SERVICE_*` family is
  already injected via Infisical at runtime (`Dockerfile:35`,
  `.docker/prod-entrypoint.sh`), which is where the new variables go too.

## Proposed environment variables

All optional. Defaults reproduce today's behaviour except that unbounded waits
become bounded, so an existing deployment needs no changes.

| Variable | Default | Meaning |
| --- | --- | --- |
| `PDF_PARSER_SERVICE_POLL_INTERVAL_MS` | `1000` | Wait between two status polls in async mode. This is the value that was hardcoded. |
| `PDF_PARSER_SERVICE_MAX_WAIT_MS` | `900000` (15 min) | Wall-clock budget for one parse. Exceeding it fails the parse, which fails the ingest job. |
| `PDF_PARSER_SERVICE_REQUEST_TIMEOUT_MS` | `30000` | Budget for a single status poll. |

Read lazily at call time, like the three existing getters (`generic.ts:19-23`),
so no rebuild or restart semantics change.

### Why a per-request timeout is needed and not just a deadline

The per-poll timeout is what makes `MAX_WAIT_MS` enforceable. A service that
accepts the TCP connection and then never answers parks the loop *inside* one
`fetch`, and a deadline checked at the top of the loop is never reached. The
deadline alone would not fix the reported failure mode.

Uploads (`POST /v1/jobs`) and the result fetch
(`GET /v1/jobs/{id}/result`) should draw on what remains of the total budget
rather than a fixed per-request value: their duration follows payload size — the
caller's PDF on the way in, every extracted base64 image on the way out — and no
single constant fits both a 3-page memo and a 300-page scan.

## Implementation sketch

Config getters alongside the existing ones (`generic.ts:19-23`):

```ts
const DEFAULT_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MAX_WAIT_MS = 15 * 60_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const getPollIntervalMs = (): number =>
  positiveIntFromEnv("PDF_PARSER_SERVICE_POLL_INTERVAL_MS", DEFAULT_POLL_INTERVAL_MS);
const getMaxWaitMs = (): number =>
  positiveIntFromEnv("PDF_PARSER_SERVICE_MAX_WAIT_MS", DEFAULT_MAX_WAIT_MS);
const getRequestTimeoutMs = (): number =>
  positiveIntFromEnv("PDF_PARSER_SERVICE_REQUEST_TIMEOUT_MS", DEFAULT_REQUEST_TIMEOUT_MS);

/** A missing value is normal; a malformed one is a deployment mistake worth a
 *  log line rather than a crash at parse time. */
const positiveIntFromEnv = (name: string, fallback: number): number => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    log.error(`Ignoring invalid ${name}="${raw}"; falling back to ${fallback}ms`);
    return fallback;
  }
  return Math.floor(value);
};
```

A `fetch` wrapper, because the raw abort reason (`"The operation timed out."`,
a `DOMException` named `TimeoutError` — verified on Bun 1.3.11) names neither
the call nor the budget, and that string is what lands in `job.error`:

```ts
const fetchWithBudget = async (
  url: string,
  init: RequestInit,
  budgetMs: number,
  what: string
): Promise<Response> => {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(budgetMs) });
  } catch (e) {
    const name = (e as Error)?.name;
    if (name === "TimeoutError" || name === "AbortError") {
      throw new Error(`${what} timed out after ${budgetMs}ms`);
    }
    throw e;
  }
};
```

`runAsync` (`generic.ts:74-123`) gains a deadline, reads each env value once per
parse, and routes all three calls through the wrapper:

```ts
const pollIntervalMs = getPollIntervalMs();
const requestTimeoutMs = getRequestTimeoutMs();
const totalBudgetMs = getMaxWaitMs();
const deadline = Date.now() + totalBudgetMs;
// Clamped: AbortSignal.timeout() throws on a negative value.
const remainingMs = () => Math.max(1, deadline - Date.now());

// create: shares the total budget (upload size is the caller's PDF)
const createRes = await fetchWithBudget(
  `${getBaseUrl()}/v1/jobs`,
  { method: "POST", headers: authHeaders(), body: form },
  remainingMs(),
  "Job creation"
);
// … unchanged !createRes.ok handling, jobId extraction …

let lastStatus = "pending";
while (!isComplete) {
  if (Date.now() >= deadline) {
    throw new Error(
      `PDF parsing timed out after ${totalBudgetMs}ms ` +
        `(job ${jobId} last reported "${lastStatus}")`
    );
  }
  const statusRes = await fetchWithBudget(
    `${getBaseUrl()}/v1/jobs/${jobId}`,
    { headers: authHeaders() },
    Math.min(requestTimeoutMs, remainingMs()),
    `Status check for job ${jobId}`
  );
  // … unchanged !statusRes.ok / completed / failed handling …
  else {
    lastStatus = status.status;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(pollIntervalMs, remainingMs()))
    );
  }
}

// result: the parse itself is already paid for, so don't throw the work away on
// a budget that expired while the job was finishing — floor it at one request.
const resultRes = await fetchWithBudget(
  `${getBaseUrl()}/v1/jobs/${jobId}/result`,
  { headers: authHeaders() },
  Math.max(remainingMs(), requestTimeoutMs),
  "Result retrieval"
);
```

### Open question for the implementer: the sync path

`runSync` (`generic.ts:61-72`) is *also* unbounded — one `POST /v1/parse` with
no `signal`, holding a connection open for the entire parse. Giving it
`signal: AbortSignal.timeout(getMaxWaitMs())` is a one-line change and closes
the same gap for anyone who flips back to `sync`.

It was deliberately excluded from the agreed scope, since production is on
`async` now and the aim was to keep the change to the live path. Worth a
decision when implementing rather than silently inheriting: a >15 min sync parse
that hangs today would fail after the change. Both behaviours are defensible;
the default is tunable either way.

## Test plan

`src/lib/knowledge/parsing/pdf/generic.test.ts` already stands up a fake service
implementing the wire contract (`generic.test.ts:102-165`) and resets
`PDF_PARSER_SERVICE_MODE` in `afterEach` (`generic.test.ts:177`). Extend it:

1. **Loop gives up at the deadline.** Add a mock flag that keeps a job in
   `processing` (mirroring the existing `failNextParse` / `nextResultBody`
   pattern), set `MAX_WAIT_MS` ≈ 150 and `POLL_INTERVAL_MS` ≈ 10, assert the
   rejection mentions the timeout and the last status.
2. **Poll interval is honoured.** Complete a job on the third poll with
   `POLL_INTERVAL_MS = 20`; assert 3 status hits and elapsed ≥ 40 ms.
3. **A hanging status poll is cut off.** Mock flag that sleeps on the status
   route; `REQUEST_TIMEOUT_MS = 50` with a comfortable `MAX_WAIT_MS`; assert the
   "Status check … timed out" error. This is the regression test for the actual
   reported failure mode.
4. **Malformed env falls back.** `MAX_WAIT_MS = "abc"` still parses
   successfully (default applies, no immediate abort).

Every new test must delete its env vars in `afterEach` — the suite shares one
process, and the existing `"async mode runs create -> poll -> result"` test
(`generic.test.ts:306`) already relies on that cleanup.

**No existing test needs changing.** The fake service returns `completed` on the
first status poll by design (`generic.test.ts:95-96`), so the poll delay never
elapses and the default interval is never waited on.

## Not part of this change

Two related findings from the same investigation, recorded so they are not lost,
both explicitly out of scope:

- **Bun's inbound socket timeout.** `src/index.ts:587` sets `idleTimeout: 255`,
  which is Bun's hard maximum — `Bun.serve` rejects 256 or higher with
  `"Bun.serve expects idleTimeout to be 255 or less"` (verified on Bun 1.3.11).
  Only `0` (disabled) goes higher; per-request `server.timeout(request, n)`
  accepts values above 255 and is not truncated. Irrelevant while imports are
  enqueued as jobs and the HTTP request returns immediately.
- **No stale-job reaper.** A `knowledge:ingest` job that dies mid-flight stays
  `running` forever (`src/lib/jobs/index.ts:139`). The bounds above stop the
  parser from *causing* that, but do not clean up rows already stuck.
