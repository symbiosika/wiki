# Framework change — one bucket for page images

**Target repo:** `symbiosika/symbiosika-framework` (the `backend/framework`
submodule). **Not** `symbiosika/wiki`.

> ## STATUS: merged upstream, submodule bumped
>
> Merged as symbiosika/symbiosika-framework#130. The wiki submodule points at
> `77c1012` (framework `develop` including the merge), and the follow-up in
> `backend/src/lib/url-import/runner.ts` is in place, so nothing here is
> outstanding. Kept as the record of why the parser gained the option.

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

## Wiki app side

- `backend/src/lib/wiki/images.ts` resolves the bucket from the page's own
  reference and reads `PARSED_IMAGES_BUCKET` from the framework rather than
  keeping its own copy of the name.
- `backend/src/lib/wiki/image-bucket-migration.ts` moves the images existing
  imports already put in the parser bucket.
- `backend/src/lib/url-import/runner.ts` passes
  `imageBucket: KNOWLEDGE_FILES_BUCKET` for scheduled URL imports, which call
  `urlToMarkdown` directly instead of going through the importer. Landed
  together with the submodule bump — before it, the option did not exist and a
  wiki PR referencing it would not have typechecked.
