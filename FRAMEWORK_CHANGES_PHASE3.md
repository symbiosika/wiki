# Framework change — Phase 3.1: dynamic post-processor resolvers

**Target repo:** `symbiosika/symbiosika-framework` (the `backend/framework`
submodule). **Not** `symbiosika/wiki`.

> ## STATUS: implemented + tested locally in this environment
>
> The change below is **already applied and committed in the local
> `backend/framework` submodule** on branch `claude/plan-construction-wd37sk`
> (local commit `f6567693`) and verified — `bun test
> framework/src/lib/knowledge/parsing/post-processors.test.ts` → 15 pass — and
> the wiki app already consumes it end-to-end (37 app tests green).
>
> **Line-precise export:** `framework-phase3-resolver.patch` at the wiki repo
> root is a `git diff` of exactly these changes. Apply it in a clean framework
> checkout with `git apply framework-phase3-resolver.patch` (or `git am` after
> wrapping), review, commit, push.
>
> **⚠️ Submodule pointer reconciliation:** I cannot push to the framework repo
> (session scope is `symbiosika/wiki` only), so the framework commit
> `f6567693` is **local-only**. The wiki submodule pointer currently references
> it. Once you land the framework change upstream (via the patch), the upstream
> commit will have a *different* SHA — then re-point the wiki submodule to that
> SHA:
> ```bash
> cd backend/framework && git fetch origin && git checkout <upstream-sha>
> cd ../.. && git add backend/framework && git commit -m "chore: bump framework to upstream post-processor resolver"
> ```
> (Or push the local commit `f6567693` as-is to preserve the SHA — then no
> re-point is needed.)
>
> The detailed walk-through below documents what the patch does, for review.

**Why:** The wiki app manages per-tenant "post-processing agents" (LLM document
reworkers) that must be selectable on import via `usePostProcessors:
["agent:<uuid>"]`. Today `applyPostProcessors` only consults a static registry,
so the app has to push every tenant agent into that global registry — which
leaks tenant agent UUIDs into the cross-tenant `GET
…/knowledge/post-processors` listing. A **resolver** hook lets the app resolve
`agent:<uuid>` names dynamically instead, keeping tenant agents out of the
global registry entirely.

Scope is small (~40 lines + one test). Everything is additive and backward
compatible — existing static processors keep working unchanged.

---

## 1. `src/lib/knowledge/parsing/post-processors.ts`

Add a resolver type, a registration function, and consult resolvers in
`applyPostProcessors` **before** throwing "not registered".

### 1a. Add the resolver type + registry (near the existing registry)

Just after the existing `postProcessorRegistry` declaration:

```ts
/**
 * A resolver produces a PostProcessor for a name that is NOT in the static
 * registry (e.g. tenant-scoped agents named `agent:<uuid>`). Registered by the
 * consuming app; consulted lazily by applyPostProcessors. First resolver to
 * return a processor wins.
 */
export type PostProcessorResolver = (
  name: string
) => Promise<PostProcessor | undefined> | PostProcessor | undefined;

const postProcessorResolvers: PostProcessorResolver[] = [];

/**
 * Register a dynamic resolver. Called at app start. Resolvers are only consulted
 * for names missing from the static registry, so they never shadow a statically
 * registered processor.
 */
export function registerPostProcessorResolver(
  resolver: PostProcessorResolver
): void {
  postProcessorResolvers.push(resolver);
}
```

### 1b. Consult resolvers in `applyPostProcessors`

Replace the current lookup-or-throw block inside the `for (const name of
processorNames)` loop:

```ts
    // BEFORE:
    const processor = postProcessorRegistry[name];
    if (!processor) {
      throw new Error(`Post processor '${name}' is not registered.`);
    }
```

with:

```ts
    // AFTER:
    let processor = postProcessorRegistry[name];
    if (!processor) {
      for (const resolve of postProcessorResolvers) {
        const resolved = await resolve(name);
        if (resolved) {
          processor = resolved;
          break;
        }
      }
    }
    if (!processor) {
      throw new Error(`Post processor '${name}' is not registered.`);
    }
```

Nothing else in the loop changes — `processor.execute({...})` stays as is.

---

## 2. `src/index.ts` — export the new function + wire config

### 2a. Export (extend the existing post-processors export block, ~line 499)

```ts
export {
  registerPostProcessor,
  registerPostProcessorResolver, // <-- add
  getAllPostProcessors,
  applyPostProcessors,
} from "./lib/knowledge/parsing/post-processors";
export type {
  PostProcessor,
  PostProcessorInput,
  PostProcessorOutput,
  PostProcessorResolver, // <-- add
  ApplyPostProcessorsResult,
} from "./lib/knowledge/parsing/post-processors";
```

### 2b. Import it where `registerPostProcessor` is imported (~line 70)

```ts
import {
  registerPostProcessor,
  registerPostProcessorResolver, // <-- add
} from "./lib/knowledge/parsing/post-processors";
```

### 2c. Wire the config in `defineServer`, right after the `customPostProcessors` block (~line 116-120)

```ts
  /**
   * Register all custom knowledge post processors
   */
  if (config.customPostProcessors) {
    config.customPostProcessors.forEach((processor) => {
      registerPostProcessor(processor);
    });
  }

  // ADD THIS:
  /**
   * Register all custom post-processor resolvers (dynamic name → processor,
   * e.g. tenant-scoped `agent:<uuid>` processors resolved from the DB).
   */
  if (config.customPostProcessorResolvers) {
    config.customPostProcessorResolvers.forEach((resolver) => {
      registerPostProcessorResolver(resolver);
    });
  }
```

---

## 3. `src/types.ts` — add the config field

Import the type (extend the existing import at ~line 8):

```ts
import type {
  PostProcessor,
  PostProcessorResolver, // <-- add
} from "./lib/knowledge/parsing/post-processors";
```

Add the field to `ServerSpecificConfig`, right after `customPostProcessors`
(~line 117):

```ts
  customPostProcessors?: PostProcessor[];

  /**
   * Dynamic resolvers for post-processor names missing from the static
   * registry (e.g. tenant-scoped `agent:<uuid>` processors resolved from the
   * DB at import time). Consulted in order; first non-undefined wins.
   */
  customPostProcessorResolvers?: PostProcessorResolver[];
```

---

## 4. Test — `src/lib/knowledge/parsing/post-processors.test.ts`

Add these cases (the file already exists; append inside the top-level
`describe`). The registry is a module global that rejects duplicate names, so
keep names unique.

```ts
import {
  registerPostProcessorResolver, // add to the existing import
} from "./post-processors";

it("consults a resolver when a name is not in the static registry", async () => {
  registerPostProcessorResolver((name) =>
    name === "dynamic:foo"
      ? {
          name,
          label: "Dynamic",
          description: "",
          execute: async ({ text }) => ({ text: `${text}!` }),
        }
      : undefined
  );

  const result = await applyPostProcessors(
    baseInput({ text: "hi" }),
    ["dynamic:foo"]
  );
  expect(result.text).toBe("hi!");
});

it("still throws when neither registry nor any resolver knows the name", async () => {
  let threw = false;
  try {
    await applyPostProcessors(baseInput(), ["nope:unknown"]);
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
});

it("prefers a statically registered processor over resolvers", async () => {
  registerPostProcessor({
    name: "static-wins",
    label: "Static",
    description: "",
    execute: async ({ text }) => ({ text: "STATIC" }),
  });
  registerPostProcessorResolver((name) =>
    name === "static-wins"
      ? {
          name,
          label: "R",
          description: "",
          execute: async () => ({ text: "RESOLVER" }),
        }
      : undefined
  );

  const result = await applyPostProcessors(baseInput(), ["static-wins"]);
  expect(result.text).toBe("STATIC");
});
```

Run: `bun test src/lib/knowledge/parsing/post-processors.test.ts` from
`backend/` (the framework path alias resolves there). All green expected.

---

## 5. Commit + push (framework repo)

The submodule is at a detached HEAD. Create/checkout a branch, commit, push:

```bash
cd backend/framework
git checkout -B claude/plan-construction-wd37sk   # or your preferred branch
git add src/lib/knowledge/parsing/post-processors.ts \
        src/lib/knowledge/parsing/post-processors.test.ts \
        src/index.ts src/types.ts
git commit -m "feat(post-processors): dynamic resolver hook for lazy processor lookup"
git push -u origin claude/plan-construction-wd37sk
```

Then note the new framework commit SHA — the wiki side needs it to bump the
submodule pointer (see below).

---

## 6. App-side switch — ALREADY DONE in this environment

On the `symbiosika/wiki` side this is **already implemented** (it works against
the local framework commit above): `backend/src/index.ts` passes
`customPostProcessorResolvers: [agentPostProcessorResolver]`, and
`agentPostProcessorResolver` in
`backend/src/lib/post-processing-agents/processor.ts` resolves any
`agent:<uuid>` name to a tenant-safe `buildAgentPostProcessor(id)`. The old
static-registration helpers (boot + register-on-create) were removed. Tenant
agent UUIDs no longer appear in the global `GET …/knowledge/post-processors`
listing — the whole point of 3.1.

For reference, the switch consisted of:

1. **A single resolver** in `backend/src/index.ts` —
   `customPostProcessorResolvers: [agentPostProcessorResolver]`.
2. **`agentPostProcessorResolver`** in
   `backend/src/lib/post-processing-agents/processor.ts` — matches
   `agent:<uuid>` and returns `buildAgentPostProcessor(id)`, which is fully
   tenant-safe (loads the agent scoped to `input.context.tenantId`).
3. Removed the now-unused static-registration helpers
   (`registerAgentPostProcessor` / `registerAllAgentPostProcessorsAtBoot`) and
   their boot/create call sites; `processor.test.ts` registers the resolver.

The only outstanding item is the **submodule pointer reconciliation** in the
STATUS box at the top — once the framework commit exists upstream.
