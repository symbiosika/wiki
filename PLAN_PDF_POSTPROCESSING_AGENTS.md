# Plan: Agentic PDF Post-Processing for Knowledge-Text Imports

> Implementation plan for a coding agent. Read the referenced skills before each phase:
> `.claude/skills/build-ai-agents/SKILL.md`, `.claude/skills/backend-app/SKILL.md`,
> `.claude/skills/database-tables/SKILL.md`, `.claude/skills/backend-testing/SKILL.md`,
> `.claude/skills/frontend-app/SKILL.md`.

## Goal

When a PDF (or any file/URL) is imported as a wiki page (`knowledgeText`), an **LLM agent**
cleans up / restructures the parsed markdown **before** it is stored. The agent treats the
parsed text as a **virtual document** and works on it with coding-agent-style tools
(outline, windowed reads, grep, search-and-replace, line-range edits) — so it can handle a
500-page document without ever holding the full text in its context window.

The agentic scaffold is **abstract and reusable**. Concrete post-processors ("agents")
differ only by **name + prompt** (+ optional model/step overrides) and are **managed per
tenant in the UI** (CRUD). Example agent: *"You get a datasheet parsed from PDF with lots of
noise — rework it into clean markdown."*

## Existing building blocks (do not reinvent)

| What | Where |
|---|---|
| Post-processor pipeline (registry + chain runner). Runs after parsing, before storing, on **all** import paths. Selected per import via `usePostProcessors: string[]`. | `backend/framework/src/lib/knowledge/parsing/post-processors.ts` |
| Registration hook at server start (`customPostProcessors`) | `backend/framework/src/index.ts` (~line 116), `backend/framework/src/types.ts` (~line 111) |
| Wiki import (file/URL → markdown → page). Already threads `usePostProcessors` through: file route reads a **comma-separated form field**, URL route a **string array** in the body. | `backend/framework/src/lib/knowledge/knowledge-text-import.ts`, `backend/framework/src/routes/tenant/[tenantId]/knowledge/texts/index.ts` (~lines 215, 252, 294) |
| `GET /tenant/:tenantId/knowledge/post-processors` lists registered processors (global, name/label/description only) | `backend/framework/src/routes/tenant/[tenantId]/knowledge/index.ts` (~line 844) |
| Style reference for a small tool-loop editing agent (`generateText` + tools + `stepCountIs` + `Output.object`, DEV-stub pattern) | `backend/src/lib/knowledge/document-agent.ts` |
| Central LLM access (OpenRouter via `@ai-sdk/openai-compatible`, `STANDARD_AI_MODEL`, `assertOpenRouterConfigured`) | `backend/src/ai/index.ts` |
| App-level DB schema + org-scoped CRUD + routes + management UI pattern to copy | `backend/src/db/schema.ts` (urlImportJobs), `backend/src/lib/url-import/`, `backend/src/routes/tenant/[tenantId]/url-import/`, `frontend/src/views/jobs/` |
| Import dialog to extend | `frontend/src/components/wiki/WikiImportDialog.vue`, store: `frontend/src/stores/wiki.ts` (`importFile`, `importUrl`) |

Important: `backend/framework` is a **git submodule**. Phase 3 has a preferred variant that
touches the framework (small, ~40 lines) and a fallback variant that does not. If you cannot
commit to the framework repo, use the fallback.

---

## Phase 1 — Abstract agentic core: `backend/src/lib/post-processing-agents/`

Pure app code, no DB, no routes yet. Three files + tests.

### 1.1 `virtual-document.ts` — the virtual document (pure, no LLM)

A class holding the working text in memory. All operations are line-oriented and defensive.
This is the piece that makes 500-page documents workable: the agent only ever sees windows.

```ts
export class VirtualDocument {
  // state: content (string), version (int, incremented on every mutation)

  stats(): { totalLines: number; totalChars: number; approxTokens: number; version: number }

  /** Markdown heading outline: [{ line, level, text }] — the agent's "table of contents". */
  outline(): OutlineEntry[]

  /** Windowed read. Caps maxLines (default 300, hard cap 500). Returns text + range + totalLines + version. */
  readLines(fromLine?: number, maxLines?: number): ReadResult

  /** Literal or regex search with N context lines. Caps results (default 30). Returns matches with line numbers. */
  search(query: string, opts?: { isRegex?: boolean; contextLines?: number; maxResults?: number }): SearchResult

  /** Exact string replacement. oldString must match exactly once unless replaceAll.
      On failure the error says how many occurrences were found (0 or n>1). */
  replaceExact(oldString: string, newString: string, replaceAll?: boolean): { replacements: number }

  /** Replace an inclusive line range with new text (the workhorse for restructuring
      big sections). anchors: expectedFirstLine/expectedLastLine are the exact current
      text of the boundary lines — mismatch throws "stale view, re-read" so the agent
      never edits from outdated line numbers. */
  replaceLines(fromLine: number, toLine: number, newText: string,
               anchors?: { expectedFirstLine?: string; expectedLastLine?: string }): EditResult

  insertLines(afterLine: number, text: string): EditResult   // afterLine 0 = prepend
  deleteLines(fromLine: number, toLine: number,
              anchors?: { expectedFirstLine?: string; expectedLastLine?: string }): EditResult

  getContent(): string
}
```

Details:
- 1-based line numbers everywhere. Reuse/extract `formatWithLineNumbers` from
  `backend/src/lib/knowledge/document-agent.ts` (move it here, re-export from the old spot
  or import from here — do not duplicate).
- Every result carries `version` and the new `totalLines` so the agent can track drift.
- `approxTokens` = `Math.ceil(totalChars / 4)` — good enough for budgeting hints.
- Validate all ranges (throw descriptive errors: the agent reads them and self-corrects).

### 1.2 `tools.ts` — AI-SDK tools over a VirtualDocument

`createVirtualDocumentTools(doc: VirtualDocument, out: AgentOutputSink)` returns the tool set.
Follow the repo tool rules (valibot schemas with `v.description()` on every field, try/catch
in `execute`, return plain strings or `{ success, ... }` — mirror `document-agent.ts` which
returns strings like `OK: …` / `ERROR: …`; keep that convention).

Tools:

| Tool | Maps to | Notes |
|---|---|---|
| `doc_stats` | `stats()` + heading count | cheap orientation call |
| `view_outline` | `outline()` | headings with line numbers; truncate to ~300 entries with a note |
| `read_lines` | `readLines()` | line-numbered output |
| `search_document` | `search()` | literal by default, `isRegex` opt-in |
| `replace_exact` | `replaceExact()` | for small surgical fixes |
| `replace_lines` | `replaceLines()` | for section-scale rewrites; document the anchor params in the description ("copy the exact current first/last line of the range from your last read") |
| `insert_lines` / `delete_lines` | ditto | |
| `set_title` | `out.title = …` | optional better page title |
| `set_meta` | shallow-merge into `out.meta` | structured extraction (e.g. datasheet fields); value: `Record<string, string \| number \| boolean>` |

Every mutating tool response ends with the fresh `version: n, totalLines: m` so the agent
knows numbers moved.

### 1.3 `runner.ts` — the abstract agent runner

```ts
export type RunPostProcessingAgentParams = {
  text: string;
  title?: string;
  /** the per-agent task profile (what the UI-managed agents differ by) */
  instructions: string;
  /** OpenRouter model id override; default AI_MODEL_ID from ../ai */
  modelId?: string;
  maxSteps?: number;          // default 40, hard cap 100
  timeoutMs?: number;         // default 240_000; abort via AbortSignal.timeout
};

export type RunPostProcessingAgentResult = {
  text: string;               // the final virtual-document content
  title?: string;
  meta?: Record<string, unknown>;
  summary: string;            // short natural-language description of what was done
  editCount: number;
  aborted: boolean;           // step/time budget hit — result is best effort
};
```

Implementation notes:
- Copy the shape of `runDocumentAssistant` (`generateText` + tools + `stopWhen: stepCountIs`
  + `experimental_output: Output.object({ summary })`), model from `backend/src/ai`
  (`assertOpenRouterConfigured`, `openrouter.chatModel(modelId ?? AI_MODEL_ID)` — export a
  small `getModel(modelId?)` helper from `backend/src/ai/index.ts`).
- **System prompt = fixed scaffold + injected task profile.** The scaffold encodes the
  method, the task profile encodes the intent:

  ```
  You are a document post-processing agent. A document was parsed from an external
  source (usually PDF→markdown) and is loaded as a virtual document you edit via tools.

  METHOD
  1. Orient: call doc_stats and view_outline first. Never ask for the full text of a
     large document; work through it in windows.
  2. Plan top-down: fix global noise first (repeated headers/footers, page numbers,
     broken hyphenation) via search_document + replace_exact(replaceAll) — then
     restructure section by section with read_lines + replace_lines.
  3. After each replace_lines, line numbers change. Trust the returned totalLines and
     re-read before the next range edit. Use the anchor parameters.
  4. Keep the result clean GitHub-flavored markdown with a sensible heading hierarchy
     (# / ## used for top-level sections — the importer splits blocks at these).
  5. Preserve ALL substantive information unless the task profile says otherwise.
     You clean and restructure; you do not summarize away content.
  6. Optionally set a better title (set_title) and structured metadata (set_meta).
  7. Finish by returning a one/two-sentence summary of what you changed.

  TASK PROFILE (what this specific agent is for):
  <instructions>
  ```
- On LLM/tool-loop failure: do **not** lose the import — catch, log, and return the
  document's *current* state with `aborted: true` and the error in `summary`. The caller
  decides (see 3.3) whether to fall back to the unprocessed text.
- `DEV_STUB`: honor `POSTPROCESSING_DEV_STUB=true` → skip the LLM, uppercase the first line
  or prepend a marker, return deterministically (mirrors `PROTOCOL_DEV_STUB`; needed for
  route tests without keys).

### 1.4 Tests (bun test, see backend-testing skill)

- `virtual-document.test.ts`: window caps, outline (incl. headings inside code fences are
  ignored), search caps + regex, replaceExact uniqueness errors (0 and >1), range
  validation, anchor mismatch ("stale"), version increments, 1-based edges (first/last line).
- `tools.test.ts`: call each tool's `execute` directly against a doc; assert `OK:`/`ERROR:`
  strings and that `set_meta` merges.
- `runner.test.ts`: DEV_STUB path only (no network).

---

## Phase 2 — Tenant-managed agent configs (DB + lib + routes)

### 2.1 Schema (`backend/src/db/schema.ts`, follow the urlImportJobs pattern + database-tables skill)

Table `post_processing_agents` (via `pgBaseTable`):

| column | type | notes |
|---|---|---|
| id | uuid pk default gen_random_uuid() | |
| organisationId | uuid not null | index |
| name | text not null | display name, unique per org (`uniqueIndex` on (organisationId, name)) |
| description | text | shown in pickers |
| prompt | text not null | the task profile |
| modelId | text | optional OpenRouter model override |
| maxSteps | integer | optional override |
| enabled | boolean not null default true | |
| createdBy | uuid | |
| createdAt / updatedAt | timestamp mode string, defaultNow | |

Plus `createSelectSchema/createInsertSchema/createUpdateSchema` valibot exports and
`$inferSelect/$inferInsert` types. Generate the migration per the database-tables skill.

### 2.2 Lib (`backend/src/lib/post-processing-agents/store.ts`)

Org-scoped CRUD: `listAgents(tenantId)`, `getAgentById(tenantId, id)`, `createAgent`,
`updateAgent`, `deleteAgent` — every read/write filters by `organisationId` (never trust the
id alone). Validate `prompt` non-empty, `maxSteps` within 1..100.

### 2.3 Routes (`backend/src/routes/tenant/[tenantId]/post-processing-agents/index.ts`)

Mirror the url-import routes (validators, `describeRoute`, HTTPException handling,
permission middleware — use the same middlewares/permission level the url-import job routes
use for their write endpoints; read endpoints for all tenant members so the import dialog
can list agents):

- `GET    …/post-processing-agents` — list (all members)
- `POST   …/post-processing-agents` — create
- `GET    …/post-processing-agents/:id`
- `PUT    …/post-processing-agents/:id`
- `DELETE …/post-processing-agents/:id`
- `POST   …/post-processing-agents/:id/test-run` — body `{ text: string }` (cap input at
  ~100 kB), runs the runner with this agent's prompt, returns
  `{ text, summary, editCount, aborted }` **without persisting anything**. This powers
  prompt iteration in the UI.

Register in `backend/src/index.ts` inside `customHonoAppsWithAuth` (next to
`defineUrlImportRoutes`).

### 2.4 Route tests

`index.test.ts` with `initTests()`/`testFetcher`: CRUD round-trip, org scoping (agent of
tenant A invisible/404 for tenant B), test-run with `POSTPROCESSING_DEV_STUB=true`.

---

## Phase 3 — Bridge into the framework post-processor pipeline

Agents must be selectable wherever `usePostProcessors` already works. Convention:
**processor name = `agent:<uuid>`**.

### 3.1 Preferred: dynamic resolver in the framework (small submodule change)

In `backend/framework/src/lib/knowledge/parsing/post-processors.ts`:

```ts
export type PostProcessorResolver =
  (name: string) => Promise<PostProcessor | undefined> | PostProcessor | undefined;

export function registerPostProcessorResolver(resolver: PostProcessorResolver): void
```

`applyPostProcessors`: when a name is not in the static registry, ask the resolvers (first
non-undefined wins); only then throw "not registered". Export the new function from
`backend/framework/src/index.ts`. Add a framework unit test next to
`post-processors.test.ts`. Optionally add `customPostProcessorResolvers?: PostProcessorResolver[]`
to `ServerSpecificConfig` in `types.ts` and wire it in `defineServer` (right after
`customPostProcessors`).

This keeps tenant agents **out of the global registry** (no cross-tenant leakage via the
global `GET …/knowledge/post-processors` listing) and needs no registry mutation on CRUD.

> The framework is a submodule — this needs a commit in the framework repo and a submodule
> pointer bump here. If that is out of scope for you, use 3.2 instead.

### 3.2 Fallback: dynamic registration, no framework change

At app boot (in `backend/src/index.ts`, after `defineServer`), load all agents and
`registerPostProcessor({ name: "agent:<id>", label: "Custom agent", description: "", execute })`;
also register on create (name is id-based → no duplicate-name conflicts). `execute` must
**re-load the config from the DB on every run** (so prompt updates need no re-registration
and deleted/disabled agents fail cleanly). Keep label/description generic — the global
listing endpoint is cross-tenant.

### 3.3 The agent post-processor itself (`backend/src/lib/post-processing-agents/processor.ts`)

`buildAgentPostProcessor(agentId)` → `PostProcessor` whose `execute`:

1. Loads the agent by id **scoped to `input.context.tenantId`** — mismatch or disabled →
   throw (this is the security boundary: a foreign tenant must not be able to run or even
   probe another tenant's agent).
2. Runs `runPostProcessingAgent({ text: input.text, title: input.title, instructions: agent.prompt, modelId, maxSteps })`.
3. Returns `{ text, title, meta }`. **Omit `pages`** — an agentic rewrite invalidates the
   page mapping by design (the pipeline handles that; see the comment in
   `post-processors.ts`). If the run `aborted` without a single edit, return the input text
   unchanged so the import still succeeds.
4. Merge `{ postProcessing: { agentId, agentName, summary, editCount, aborted } }` into
   `meta` so the resulting wiki page records what happened.

Test: register (or resolve) a stubbed agent, call `applyPostProcessors(input, ["agent:<id>"])`,
assert text/meta/tenant-mismatch-throws.

---

## Phase 4 — Frontend: manage agents + use them on import

Follow the frontend-app skill (Volt components, auto-imports, Fetcher, i18n **de + en** in
`frontend/src/locales/`).

### 4.1 Management UI

- New view `frontend/src/views/manage/post-processing-agents.vue`, route
  `/:tenantId/manage/post-processing-agents` in `frontend/src/router/index.ts`
  (name e.g. `PostProcessingAgents`).
- Add a tab in `frontend/src/components/manage/ManageTabs.vue`
  (note its `isActive` strips a trailing `s` via `replace(/s$/,'')` — pick the route name so
  highlighting works, or fix `isActive` to exact-match prefixes).
- List (DataTable: name, description, enabled, updatedAt) + create/edit dialog:
  name, description, **prompt as large textarea** (monospace), optional model id,
  optional maxSteps, enabled switch.
- **Test-run panel** in the edit dialog: textarea for sample input (or "load from file"),
  run button → calls `POST …/:id/test-run`, shows result markdown next to the input
  (simple two-pane before/after; render with the existing `marked` dependency or as plain
  `<pre>` — keep it simple) plus the agent's `summary`. Show a spinner + note that runs can
  take a while.

### 4.2 Import dialog

- `frontend/src/components/wiki/WikiImportDialog.vue`: add a Select
  "Post-processing" (i18n: de "KI-Nachbearbeitung") with options: *None* (default) + all
  **enabled** agents of the tenant (fetched from the new list endpoint on dialog open).
- `frontend/src/stores/wiki.ts`: extend `WikiImportOptions` with `postProcessorNames?: string[]`;
  `importFile` appends the form field `usePostProcessors` as a **comma-separated string**
  (that is what the framework file route parses); `importUrl` sends it as a **string array**
  in the JSON body.
- The processing step of the dialog already shows an indeterminate bar; extend the hint text
  ("AI post-processing can take several minutes for large documents").

---

## Phase 5 — Hardening & limits (part of v1, not optional)

- **Input size guard** in the processor: if `approxTokens` of the input exceeds a limit
  (env `POSTPROCESSING_MAX_INPUT_TOKENS`, default ~400k ≈ 1.6 MB text), skip the agent run,
  return input unchanged and record `meta.postProcessing.skipped = "too_large"`.
- **HTTP timeout risk**: the import routes are synchronous. v1 mitigates via
  `timeoutMs`/`maxSteps` budgets + best-effort abort (runner returns current state). Keep
  budgets so a typical run stays well under the proxy/server timeout.
- **Concurrency**: the runner is stateless; no locking needed (each import gets its own
  VirtualDocument). No shared mutable state in the tool closures.
- Log one structured line per run (agentId, tenant, inputChars, steps, editCount, duration,
  aborted) via the app's existing logging style.

## Phase 6 (optional follow-up, do NOT block v1) — async imports

For truly huge PDFs move the *import + agent run* into the durable job queue (the framework
`jobHandlers` mechanism `backend/src/lib/url-import/runner.ts` already uses): import
endpoint enqueues, UI polls/receives the page id when done. Design it, but only after v1
works end-to-end.

---

## Suggested commit sequence

1. Phase 1 (core + tests) — self-contained, no schema changes.
2. Phase 2 (schema + migration + lib + routes + tests).
3. Phase 3 (bridge; framework submodule bump if variant 3.1).
4. Phase 4 (frontend manage UI + import dialog + i18n).
5. Phase 5 (guards/logging) — can be folded into 1–3 where natural.

## Acceptance criteria

- [ ] Unit tests: VirtualDocument, tools, runner-stub, bridge, routes — all green
      (`bun test` in `backend/`).
- [ ] An admin creates an agent "Datasheet cleanup" (name + prompt) in the manage UI,
      test-runs it against pasted sample text, sees before/after.
- [ ] Importing a PDF via the wiki import dialog with that agent selected produces a page
      whose markdown was rewritten by the agent, with `meta.postProcessing` recorded.
- [ ] Selecting *None* behaves exactly as today (no regression on existing imports).
- [ ] Tenant B cannot list, edit, or execute (via `usePostProcessors: ["agent:<id>"]`)
      tenant A's agents.
- [ ] With `POSTPROCESSING_DEV_STUB=true` the whole flow works without an OpenRouter key.

## Explicit non-goals (v1)

- No streaming/progress UI for agent runs (spinner + hint only).
- No page-mapping (`pages`) preservation through agentic rewrites.
- No versioned prompt history for agents.
- No reuse of the core by the existing document assistant (possible later refactor —
  `document-agent.ts` stays untouched except for sharing `formatWithLineNumbers`).
