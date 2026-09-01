# Framework change — a description per image (issue #160)

**Target repo:** `symbiosika/symbiosika-framework` (the `backend/framework`
submodule). **Not** `symbiosika/wiki`.

> ## STATUS: implemented + tested locally in this environment
>
> The change is **applied in the local `backend/framework` submodule working
> tree** and verified:
> `bun test src/lib/knowledge/image-descriptions.test.ts
> src/lib/knowledge/materialize-blocks.test.ts
> src/lib/knowledge/parsing/pdf/generic.test.ts` → 15 + 17 + 19 pass, framework
> `tsc --noEmit` clean.
>
> **Line-precise export:** `framework-image-descriptions.patch` at the wiki repo
> root is a `git diff` of exactly these changes (7 modified files, 2 new files).
> Apply it in a clean framework checkout:
> ```bash
> cd backend/framework
> git checkout -b claude/image-descriptions
> git apply ../../framework-image-descriptions.patch
> bun test src/lib/knowledge/image-descriptions.test.ts \
>          src/lib/knowledge/materialize-blocks.test.ts \
>          src/lib/knowledge/parsing/pdf/generic.test.ts
> git add -A && git commit -m "feat(knowledge): carry a description per image into the page text"
> git push -u origin claude/image-descriptions
> ```
>
> **⚠️ Submodule pointer:** I cannot push to the framework repo (session scope
> is `symbiosika/wiki` only), so the wiki submodule pointer is **left
> untouched** (still at the current upstream SHA). After you land the framework
> commit upstream, bump the pointer:
> ```bash
> cd backend/framework && git fetch origin && git checkout <new-sha>
> cd ../.. && git add backend/framework \
>   && git commit -m "chore: bump framework to the image descriptions change"
> ```

**Why:** an image is a dead end for everything that only reads text. An AI
client, the full-text index and the embedding of a chunk all see
`![name.png](/files/db/knowledge/<uuid>.png)` — a path, and at best a file name
as the alt text. A page whose knowledge sits in a schematic or a screenshot is
therefore unanswerable, and the uuid path is pure noise in the embedding on top
of that. This change gives an image an optional description and carries it
**into the page text**, which is the only place that reaches search, chunking,
embeddings, every read path and the export at once.

**Design guarantee:** an image **without** a description materializes
byte-for-byte as before. The new Turndown rule replicates Turndown's own image
rule (including its `cleanAttribute` newline handling) and only appends
anything when `data-description` is present. That matters because the
materialized text feeds the content hash: a cosmetic difference would re-embed
every page that contains a picture.

Everything is additive and backwards compatible: pages without descriptions are
unchanged, `ParsedPageImage.description` is optional, and no existing signature
changed.

---

## The format

The description lives in three places and means the same thing in all of them
(the same arrangement as `[[wikilinks]]`, see `src/lib/knowledge/wikilinks.ts`):

| where | form |
|---|---|
| html block (block editor, source of truth a human edits) | `<img src="…" data-description="…">` |
| markdown / plain text, the materialized `text` cache, an agent's write | `<image-description src="…">…</image-description>` on the line below the image |
| a parsing service's result | `pages[].images[].description` (spec §3) |

Two constraints keep those in sync, both enforced by
`normalizeImageDescription`:

1. **One line.** A description has to survive as an html attribute, as one
   markdown line, and inside a chunk that may be cut at any blank line. Every
   whitespace run — newlines included — collapses to a single space.
2. **The `src` is part of the marker.** A chunk can begin below the image its
   description belongs to, so positional association alone would lose it.

---

## Files

### New — `src/lib/knowledge/image-descriptions.ts`
The format itself, DB-free and pure: `IMAGE_DESCRIPTION_PATTERN`,
`IMAGE_DESCRIPTION_ATTRIBUTE`, `normalizeImageDescription`,
`imageDescriptionMarker`, `containsImageDescription`,
`extractImageDescriptions`, `stripImageDescriptions`. The module header is the
reference for the format; the wiki app's `backend/src/lib/wiki/image-descriptions.ts`
holds the reading half and is kept in sync by hand (a deliberate duplicate, so
the app does not depend on an unreleased framework symbol).

### New — `src/lib/knowledge/image-descriptions.test.ts`
15 tests: normalization, marker building and escaping, extraction (including
what an agent types by hand, adjacent markers, a repeated image), stripping.

### `src/lib/knowledge/materialize-blocks.ts`
A `wikiImage` Turndown rule, plus a local `cleanAttribute` (Turndown does not
export its own). With a description it emits the image line and the marker
below it; without one, output is identical to Turndown's default rule.

### `src/lib/knowledge/materialize-blocks.test.ts`
7 tests, the first of which pins the unchanged output for an image without a
description (that is the regression that would cost a full re-embedding).

### `src/lib/knowledge/parsing/pdf/images.ts`
`ParsedPageImage.description` (optional) and `resolveImageReferences` appends
the marker below the rewritten reference when the service reported one. The
failure path is untouched: a reference whose image could not be persisted is
still stripped, description or not.

### `src/lib/knowledge/parsing/pdf/generic.ts`
`RawImage.description` so a description in the service response reaches
`resolveImageReferences`. The Mistral parsers are unchanged — the OCR API has no
such field.

### `src/lib/knowledge/parsing/pdf/generic.test.ts`
2 tests: a reported description is written below the image (and collapsed to one
line); nothing is added when the service reports none.

### `docs/framework/18_PDF_Parser_Generic_Microservice_Spec.md`
`pages[].images[].description` documented in §3 with the example response, plus
what distinguishes it from folding recognised content into the page `text` via
`parse_images_in_doc` (that prose loses the link to the individual picture; a
`description` stays attached to one image).

### `docs/framework/19_PDF_Parser_Generic_Framework_Integration.md`
`RawImage` and the image-resolving step in the integration walk-through.

---

## What the wiki app already does with it

Landed in `symbiosika/wiki` on `claude/issue-160-mc1ojw` and independent of the
submodule bump (no new framework imports, so the app builds against the current
SHA):

- the block editor stores `data-description` on the image, shows it as a folded
  caption in reading and editing mode, and folds an `<image-description>` marker
  from a markdown block / an agent write / an import back onto its image
- the MCP tools annotate **every** page-content read path with
  `embeddedImages[{ref, alt, description}]`, search snippets collapse an image
  to `[image: <description>]`, and the page/gallery views show the description
  as a caption
- the public documentation site renders the marker as a folded caption

**Until the framework commit lands**, a description entered in the editor is
stored in the block html but does **not** reach the materialized `text` — so
search, embeddings and the MCP annotation stay empty for it. Nothing breaks; the
feature is simply inert on the text side. Descriptions written directly into the
text (an agent, an import) work either way.
