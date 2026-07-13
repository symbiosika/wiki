/**
 * AI-SDK tools over a {@link VirtualDocument}.
 *
 * These give a language model coding-agent-style access to a parsed document:
 * outline, windowed reads, search, and surgical / section-scale edits — plus
 * two side-channel tools to set a better title and structured metadata. The
 * tool set is created per run over a single document + output sink, so there is
 * no shared mutable state between concurrent imports.
 *
 * Convention (mirrors ../knowledge/document-agent.ts): every tool returns a
 * plain string, prefixed `OK:` / `ERROR:`. Mutating tools end their `OK:` line
 * with the fresh `version` + `totalLines` so the model knows line numbers moved.
 */
import * as v from "valibot";
import { tool } from "ai";
import { valibotSchema } from "@ai-sdk/valibot";
import { formatWithLineNumbers, type VirtualDocument } from "./virtual-document";

/** Collects the non-text outputs an agent can set while editing. */
export interface AgentOutputSink {
  title?: string;
  meta: Record<string, unknown>;
}

const MAX_OUTLINE_ENTRIES = 300;

/** Trailing marker appended to every mutating tool response. */
const drift = (r: { version: number; totalLines: number }): string =>
  ` (version: ${r.version}, totalLines: ${r.totalLines})`;

export const createVirtualDocumentTools = (
  doc: VirtualDocument,
  out: AgentOutputSink,
) => {
  const doc_stats = tool({
    description:
      "Cheap orientation call. Returns total lines, total characters, an " +
      "approximate token count, the current version, and the number of " +
      "markdown headings. Call this first.",
    inputSchema: valibotSchema(v.object({})),
    execute: async () => {
      try {
        const s = doc.stats();
        const headings = doc.outline().length;
        return `OK: totalLines=${s.totalLines}, totalChars=${s.totalChars}, approxTokens=${s.approxTokens}, headings=${headings}, version=${s.version}`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const view_outline = tool({
    description:
      "List the markdown heading outline (the table of contents) with line " +
      "numbers. Use it to navigate a large document before reading windows.",
    inputSchema: valibotSchema(v.object({})),
    execute: async () => {
      try {
        const entries = doc.outline();
        if (entries.length === 0) return "OK: (no headings found)";
        const shown = entries.slice(0, MAX_OUTLINE_ENTRIES);
        const body = shown
          .map(
            (e) =>
              `${e.line.toString().padStart(5, " ")}| ${"#".repeat(e.level)} ${e.text}`,
          )
          .join("\n");
        const note =
          entries.length > shown.length
            ? `\n… ${entries.length - shown.length} more headings not shown`
            : "";
        return `OK:\n${body}${note}`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const read_lines = tool({
    description:
      "Read a window of the document with line numbers. fromLine is 1-based " +
      "(default 1); maxLines defaults to 300 and is hard-capped at 500. Never " +
      "try to read the whole document at once — work in windows.",
    inputSchema: valibotSchema(
      v.object({
        fromLine: v.optional(
          v.pipe(v.number(), v.description("1-based first line to read")),
        ),
        maxLines: v.optional(
          v.pipe(
            v.number(),
            v.description("how many lines to read (max 500)"),
          ),
        ),
      }),
    ),
    execute: async ({ fromLine, maxLines }) => {
      try {
        const r = doc.readLines(fromLine, maxLines);
        const body = formatWithLineNumbers(r.content, r.fromLine);
        return `OK: lines ${r.fromLine}-${r.toLine} of ${r.totalLines} (version: ${r.version})\n${body}`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const search_document = tool({
    description:
      "Search the document. Literal substring match by default; set isRegex " +
      "to treat the query as a JavaScript regular expression. Returns matching " +
      "line numbers with surrounding context. Results are capped (default 30).",
    inputSchema: valibotSchema(
      v.object({
        query: v.pipe(
          v.string(),
          v.minLength(1),
          v.description("text (or regex) to search for"),
        ),
        isRegex: v.optional(
          v.pipe(
            v.boolean(),
            v.description("treat query as a regular expression"),
          ),
        ),
        contextLines: v.optional(
          v.pipe(
            v.number(),
            v.description("context lines around each hit (default 2)"),
          ),
        ),
        maxResults: v.optional(
          v.pipe(
            v.number(),
            v.description("max matches to return (default 30)"),
          ),
        ),
      }),
    ),
    execute: async ({ query, isRegex, contextLines, maxResults }) => {
      try {
        const r = doc.search(query, { isRegex, contextLines, maxResults });
        if (r.matches.length === 0) return "OK: no matches.";
        const body = r.matches
          .map((m) => m.context ?? `${m.line.toString().padStart(4, " ")}| ${m.text}`)
          .join("\n---\n");
        const note = r.truncated
          ? `\n(showing ${r.matches.length} of ${r.totalMatches} matches)`
          : "";
        return `OK: ${r.totalMatches} match(es).${note}\n${body}`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const replace_exact = tool({
    description:
      "Surgical fix via exact string replacement. oldString must occur exactly " +
      "once (include enough surrounding context) unless replaceAll is true — " +
      "replaceAll is ideal for removing a repeated header/footer everywhere. " +
      "If it reports 0 or multiple occurrences, re-read and copy the exact text.",
    inputSchema: valibotSchema(
      v.object({
        oldString: v.pipe(
          v.string(),
          v.minLength(1),
          v.description("exact current text to replace"),
        ),
        newString: v.pipe(
          v.string(),
          v.description("replacement text (may be empty to delete)"),
        ),
        replaceAll: v.optional(
          v.pipe(
            v.boolean(),
            v.description("replace every occurrence instead of exactly one"),
          ),
        ),
      }),
    ),
    execute: async ({ oldString, newString, replaceAll }) => {
      try {
        const r = doc.replaceExact(oldString, newString, replaceAll);
        return `OK: replaced ${r.replacements} occurrence(s).${drift(r)}`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const replace_lines = tool({
    description:
      "Replace an inclusive 1-based line range with new text — the workhorse " +
      "for section-scale rewrites. IMPORTANT: line numbers change after every " +
      "edit. Pass expectedFirstLine/expectedLastLine with the exact current " +
      "text of the range's first and last lines (copy them from your last " +
      "read_lines); if they no longer match you get a 'stale view' error and " +
      "must re-read before editing.",
    inputSchema: valibotSchema(
      v.object({
        fromLine: v.pipe(
          v.number(),
          v.description("1-based first line of the range (inclusive)"),
        ),
        toLine: v.pipe(
          v.number(),
          v.description("1-based last line of the range (inclusive)"),
        ),
        newText: v.pipe(
          v.string(),
          v.description("text that replaces the range (may contain newlines)"),
        ),
        expectedFirstLine: v.optional(
          v.pipe(
            v.string(),
            v.description("exact current text of fromLine (anchor)"),
          ),
        ),
        expectedLastLine: v.optional(
          v.pipe(
            v.string(),
            v.description("exact current text of toLine (anchor)"),
          ),
        ),
      }),
    ),
    execute: async ({
      fromLine,
      toLine,
      newText,
      expectedFirstLine,
      expectedLastLine,
    }) => {
      try {
        const r = doc.replaceLines(fromLine, toLine, newText, {
          expectedFirstLine,
          expectedLastLine,
        });
        return `OK: replaced lines ${fromLine}-${toLine}.${drift(r)}`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const insert_lines = tool({
    description:
      "Insert text after a 1-based line number. Use afterLine 0 to prepend at " +
      "the very top of the document.",
    inputSchema: valibotSchema(
      v.object({
        afterLine: v.pipe(
          v.number(),
          v.description("insert after this line (0 = prepend)"),
        ),
        text: v.pipe(
          v.string(),
          v.description("text to insert (may contain newlines)"),
        ),
      }),
    ),
    execute: async ({ afterLine, text }) => {
      try {
        const r = doc.insertLines(afterLine, text);
        return `OK: inserted after line ${afterLine}.${drift(r)}`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const delete_lines = tool({
    description:
      "Delete an inclusive 1-based line range. Supports the same " +
      "expectedFirstLine/expectedLastLine anchors as replace_lines to guard " +
      "against editing from a stale view.",
    inputSchema: valibotSchema(
      v.object({
        fromLine: v.pipe(
          v.number(),
          v.description("1-based first line to delete (inclusive)"),
        ),
        toLine: v.pipe(
          v.number(),
          v.description("1-based last line to delete (inclusive)"),
        ),
        expectedFirstLine: v.optional(
          v.pipe(
            v.string(),
            v.description("exact current text of fromLine (anchor)"),
          ),
        ),
        expectedLastLine: v.optional(
          v.pipe(
            v.string(),
            v.description("exact current text of toLine (anchor)"),
          ),
        ),
      }),
    ),
    execute: async ({
      fromLine,
      toLine,
      expectedFirstLine,
      expectedLastLine,
    }) => {
      try {
        const r = doc.deleteLines(fromLine, toLine, {
          expectedFirstLine,
          expectedLastLine,
        });
        return `OK: deleted lines ${fromLine}-${toLine}.${drift(r)}`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const set_title = tool({
    description:
      "Set a better page title for the document (optional). Use when the parsed " +
      "title is missing or poor and a clear one is derivable from the content.",
    inputSchema: valibotSchema(
      v.object({
        title: v.pipe(
          v.string(),
          v.minLength(1),
          v.description("the new title"),
        ),
      }),
    ),
    execute: async ({ title }) => {
      try {
        out.title = title;
        return `OK: title set.`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  const set_meta = tool({
    description:
      "Record structured metadata extracted from the document (e.g. datasheet " +
      "fields). Shallow-merged into the page meta; call multiple times to add " +
      "more keys. Values must be strings, numbers, or booleans.",
    inputSchema: valibotSchema(
      v.object({
        values: v.pipe(
          v.record(
            v.string(),
            v.union([v.string(), v.number(), v.boolean()]),
          ),
          v.description("key/value pairs to merge into the page meta"),
        ),
      }),
    ),
    execute: async ({ values }) => {
      try {
        Object.assign(out.meta, values);
        const keys = Object.keys(values);
        return `OK: merged ${keys.length} meta key(s): ${keys.join(", ")}`;
      } catch (e) {
        return `ERROR: ${(e as Error).message}`;
      }
    },
  });

  return {
    doc_stats,
    view_outline,
    read_lines,
    search_document,
    replace_exact,
    replace_lines,
    insert_lines,
    delete_lines,
    set_title,
    set_meta,
  };
};
