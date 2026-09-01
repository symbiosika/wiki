# Framework change — one bucket for page images

**Target repo:** `symbiosika/symbiosika-framework` (the `backend/framework`
submodule). **Not** `symbiosika/wiki`.

> ## STATUS: implemented, pushed as a branch, PR open
>
> Branch `claude/parser-image-bucket` in the framework repo (commit
> `795f8b0`), based on `origin/develop`. `framework-parser-image-bucket.patch`
> at this repo's root is the same change as a `git diff` for review or for
> applying by hand (`git apply framework-parser-image-bucket.patch`).
>
> Verified locally: `bun test src/lib/knowledge/parsing/pdf/generic.test.ts
> src/lib/knowledge/parsing/pdf/mistral-ocr.test.ts` → 23 pass, and
> `bun run test:local src/lib/knowledge/knowledge-text-import.test.ts
> src/lib/knowledge/knowledge-text-files.test.ts src/lib/knowledge/parsing`
> → 67 pass, 2 fail. Both failures are pre-existing and unrelated (two
> embedding tests in `knowledge-text-import.test.ts` time out without AI
> keys; they fail the same way with these changes stashed).
> `typecheck` and `typecheck:strict` are clean.
>
> **⚠️ Submodule pointer:** the wiki submodule still points at
> `bad2602` (current `develop`). Once the framework PR is merged, bump it:
> ```bash
> cd backend/framework && git fetch origin && git checkout <merged-sha>
> cd ../.. && git add backend/framework
> git commit -m "chore: bump framework to the parser image bucket change"
> ```

## Why

Images a parsing service extracts from a document (PDF import, and a URL that
serves a PDF) were stored in a fixed `"images"` bucket. Page images uploaded in
the block editor live in `"knowledge"`. So a wiki page could reference pictures
in two different buckets, and everything the page does for its files only ever
looked at one of them:

- `syncKnowledgeTextFileReferences` never linked the extracted images to the
  page, so they had no reference rows, no managed expiry, and deleting the page
  left them behind forever.
- The page-scoped image endpoints — the ones that let MCP/OAuth clients with
  `knowledge:read` but without `files:read` read a page's images — resolved
  only the `"knowledge"` bucket. Every image on an imported page answered 404
  ("not referenced by this page"), even though the wiki UI displayed it fine
  via the generic files endpoint.

The wiki app fixes the reading half on its side (it now resolves the bucket
from the page's own reference, and ships a one-time migration for existing
pages). This change fixes the writing half, so new imports stop recreating the
split.

## What changes

`saveBase64ImageToStorage` and `resolveImageReferences` take the target bucket,
threaded through as `PdfParserOptions.imageBucket`:

```
parseFile / urlToMarkdown  →  parsePdfFileAsMardown  →  parser  →  images.ts
```

- `parsing/pdf/images.ts`: new `PARSED_IMAGES_BUCKET` export ("images") as the
  default, plus the `bucket` parameter on both functions.
- `parsing/pdf/types.ts`: `PdfParserOptions.imageBucket`.
- `parsing/pdf/generic.ts`, `mistral-ocr.ts`, `mistral-openrouter.ts`: forward
  the option (these three are the parsers that persist images).
- `parsing/index.ts` (`parseFile`) and `parsing/url.ts` (`urlToMarkdown`): pass
  the option through.
- `knowledge-text-import.ts`: the knowledge page importer passes
  `KNOWLEDGE_FILES_BUCKET` for both its file and its URL entry point.

**The default is unchanged.** Every caller that does not pass `imageBucket`
keeps writing to `"images"` exactly as before, so no other consumer of the
framework is affected.

## Tests

- `parsing/pdf/mistral-ocr.test.ts`: the requested bucket is used; without one
  the parsed-images bucket is.
- `parsing/pdf/generic.test.ts`: the same at the parser, plus one test through
  the public `parseFile` entry point (the path the importer takes), so the
  option is covered over the whole chain rather than at the doorstep.

## Follow-up in the wiki app (after the bump)

`backend/src/lib/url-import/runner.ts` calls `urlToMarkdown` directly for
scheduled URL imports and should pass `imageBucket: KNOWLEDGE_FILES_BUCKET`
too. It is deliberately **not** in the wiki PR: the option does not exist until
this framework change is merged and the submodule pointer is bumped, and a wiki
PR that references it would not typecheck in CI. Small change, one line — do it
in the same commit as the bump.
