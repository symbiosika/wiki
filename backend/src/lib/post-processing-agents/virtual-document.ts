/**
 * Virtual document for agentic post-processing.
 *
 * Holds a working copy of a parsed document (usually PDF→markdown) in memory
 * and exposes line-oriented, defensive operations over it. This is the piece
 * that makes 500-page documents workable: an agent only ever sees *windows*
 * (outline, ranged reads, search hits), never the full text — so the text can
 * be far larger than any context window.
 *
 * All line numbers are 1-based. Every mutation bumps `version` and every result
 * carries the current `version` + `totalLines` so an agent can detect when its
 * view went stale and re-read before editing.
 */

export interface OutlineEntry {
  line: number;
  level: number;
  text: string;
}

export interface DocumentStats {
  totalLines: number;
  totalChars: number;
  approxTokens: number;
  version: number;
}

export interface ReadResult {
  content: string;
  fromLine: number;
  toLine: number;
  totalLines: number;
  version: number;
}

export interface SearchMatch {
  line: number;
  text: string;
  /** context lines around the match, each prefixed with its line number */
  context?: string;
}

export interface SearchResult {
  matches: SearchMatch[];
  totalMatches: number;
  truncated: boolean;
  totalLines: number;
  version: number;
}

export interface EditResult {
  totalLines: number;
  version: number;
}

/** Format a document's content with 1-based, right-padded line numbers. */
export const formatWithLineNumbers = (
  content: string,
  fromLine = 1,
): string => {
  const lines = content.split("\n");
  return lines
    .map(
      (line, idx) =>
        `${(fromLine + idx).toString().padStart(4, " ")}| ${line}`,
    )
    .join("\n");
};

const DEFAULT_READ_LINES = 300;
const HARD_MAX_READ_LINES = 500;
const DEFAULT_MAX_RESULTS = 30;
const DEFAULT_CONTEXT_LINES = 2;

/** Escape a string for safe use inside a RegExp. */
const escapeRegExp = (s: string): string =>
  s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export class VirtualDocument {
  private lines: string[];
  private _version = 0;

  constructor(content: string) {
    // Normalise line endings; keep a stable array representation internally.
    this.lines = (content ?? "").replace(/\r\n?/g, "\n").split("\n");
  }

  get version(): number {
    return this._version;
  }

  private get totalLines(): number {
    return this.lines.length;
  }

  private get totalChars(): number {
    return this.lines.join("\n").length;
  }

  /** Cheap orientation call: sizes + version. */
  stats(): DocumentStats {
    const totalChars = this.totalChars;
    return {
      totalLines: this.totalLines,
      totalChars,
      approxTokens: Math.ceil(totalChars / 4),
      version: this._version,
    };
  }

  /**
   * Markdown heading outline — the agent's table of contents. Headings inside
   * fenced code blocks are ignored so `# comment` lines in code don't pollute
   * the structure.
   */
  outline(): OutlineEntry[] {
    const entries: OutlineEntry[] = [];
    let inFence = false;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i]!;
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      const m = /^(#{1,6})\s+(.*)$/.exec(line);
      if (m) {
        entries.push({
          line: i + 1,
          level: m[1]!.length,
          text: m[2]!.trim(),
        });
      }
    }
    return entries;
  }

  /**
   * Windowed read. `fromLine` is 1-based (default 1). `maxLines` is capped at
   * {@link HARD_MAX_READ_LINES}. Returns the raw slice text plus the range.
   */
  readLines(fromLine = 1, maxLines = DEFAULT_READ_LINES): ReadResult {
    const total = this.totalLines;
    if (!Number.isFinite(fromLine) || fromLine < 1) fromLine = 1;
    if (fromLine > total) {
      throw new Error(
        `fromLine ${fromLine} is past the end of the document (totalLines: ${total}).`,
      );
    }
    let count = Math.floor(maxLines);
    if (!Number.isFinite(count) || count < 1) count = DEFAULT_READ_LINES;
    if (count > HARD_MAX_READ_LINES) count = HARD_MAX_READ_LINES;

    const from = fromLine;
    const to = Math.min(total, from + count - 1);
    const content = this.lines.slice(from - 1, to).join("\n");
    return {
      content,
      fromLine: from,
      toLine: to,
      totalLines: total,
      version: this._version,
    };
  }

  /**
   * Literal (default) or regex search with N context lines around each hit.
   * Results are capped (default {@link DEFAULT_MAX_RESULTS}); `truncated` says
   * whether more matches exist.
   */
  search(
    query: string,
    opts: {
      isRegex?: boolean;
      contextLines?: number;
      maxResults?: number;
    } = {},
  ): SearchResult {
    if (typeof query !== "string" || query.length === 0) {
      throw new Error("search query must be a non-empty string.");
    }
    const contextLines = Math.max(
      0,
      Math.floor(opts.contextLines ?? DEFAULT_CONTEXT_LINES),
    );
    const maxResults = Math.max(
      1,
      Math.floor(opts.maxResults ?? DEFAULT_MAX_RESULTS),
    );

    let regex: RegExp;
    try {
      regex = opts.isRegex
        ? new RegExp(query)
        : new RegExp(escapeRegExp(query));
    } catch (e) {
      throw new Error(`Invalid regex: ${(e as Error).message}`);
    }

    const matches: SearchMatch[] = [];
    let totalMatches = 0;
    for (let i = 0; i < this.lines.length; i++) {
      if (!regex.test(this.lines[i]!)) continue;
      totalMatches += 1;
      if (matches.length >= maxResults) continue;
      const from = Math.max(0, i - contextLines);
      const to = Math.min(this.lines.length - 1, i + contextLines);
      const context =
        contextLines > 0
          ? formatWithLineNumbers(
              this.lines.slice(from, to + 1).join("\n"),
              from + 1,
            )
          : undefined;
      matches.push({ line: i + 1, text: this.lines[i]!, context });
    }

    return {
      matches,
      totalMatches,
      truncated: totalMatches > matches.length,
      totalLines: this.totalLines,
      version: this._version,
    };
  }

  /**
   * Exact string replacement. `oldString` must occur exactly once unless
   * `replaceAll` is set. On failure the error states how many occurrences were
   * found (0 or n>1) so the agent can widen its context and retry.
   */
  replaceExact(
    oldString: string,
    newString: string,
    replaceAll = false,
  ): { replacements: number; totalLines: number; version: number } {
    if (typeof oldString !== "string" || oldString.length === 0) {
      throw new Error("oldString must be a non-empty string.");
    }
    const content = this.lines.join("\n");
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) {
      throw new Error(
        `oldString not found (0 occurrences). Re-read the relevant lines and copy the exact current text.`,
      );
    }
    if (occurrences > 1 && !replaceAll) {
      throw new Error(
        `oldString is not unique (${occurrences} occurrences). Include more surrounding context, or pass replaceAll.`,
      );
    }
    const next = replaceAll
      ? content.split(oldString).join(newString)
      : content.replace(oldString, newString);
    this.setContent(next);
    return {
      replacements: replaceAll ? occurrences : 1,
      totalLines: this.totalLines,
      version: this._version,
    };
  }

  /**
   * Replace an inclusive 1-based line range with new text — the workhorse for
   * section-scale restructuring. `anchors` (the exact current text of the first
   * and/or last line of the range) guard against editing from a stale view: a
   * mismatch throws "stale view, re-read" so the agent never edits from
   * outdated line numbers.
   */
  replaceLines(
    fromLine: number,
    toLine: number,
    newText: string,
    anchors?: { expectedFirstLine?: string; expectedLastLine?: string },
  ): EditResult {
    this.assertRange(fromLine, toLine);
    this.assertAnchors(fromLine, toLine, anchors);
    const before = this.lines.slice(0, fromLine - 1);
    const after = this.lines.slice(toLine);
    const inserted = newText.replace(/\r\n?/g, "\n").split("\n");
    this.lines = [...before, ...inserted, ...after];
    this._version += 1;
    return { totalLines: this.totalLines, version: this._version };
  }

  /** Insert text after the given 1-based line. `afterLine` 0 = prepend. */
  insertLines(afterLine: number, text: string): EditResult {
    const total = this.totalLines;
    if (!Number.isFinite(afterLine) || afterLine < 0 || afterLine > total) {
      throw new Error(
        `afterLine ${afterLine} out of range (0..${total}).`,
      );
    }
    const inserted = text.replace(/\r\n?/g, "\n").split("\n");
    const before = this.lines.slice(0, afterLine);
    const after = this.lines.slice(afterLine);
    this.lines = [...before, ...inserted, ...after];
    this._version += 1;
    return { totalLines: this.totalLines, version: this._version };
  }

  /** Delete an inclusive 1-based line range. */
  deleteLines(
    fromLine: number,
    toLine: number,
    anchors?: { expectedFirstLine?: string; expectedLastLine?: string },
  ): EditResult {
    this.assertRange(fromLine, toLine);
    this.assertAnchors(fromLine, toLine, anchors);
    const before = this.lines.slice(0, fromLine - 1);
    const after = this.lines.slice(toLine);
    this.lines = [...before, ...after];
    // never let the document become a zero-length array with no lines
    if (this.lines.length === 0) this.lines = [""];
    this._version += 1;
    return { totalLines: this.totalLines, version: this._version };
  }

  getContent(): string {
    return this.lines.join("\n");
  }

  // ---- internals ------------------------------------------------------------

  private setContent(content: string): void {
    this.lines = content.replace(/\r\n?/g, "\n").split("\n");
    this._version += 1;
  }

  private assertRange(fromLine: number, toLine: number): void {
    const total = this.totalLines;
    if (!Number.isInteger(fromLine) || !Number.isInteger(toLine)) {
      throw new Error("fromLine and toLine must be integers.");
    }
    if (fromLine < 1 || fromLine > total) {
      throw new Error(
        `fromLine ${fromLine} out of range (1..${total}).`,
      );
    }
    if (toLine < fromLine || toLine > total) {
      throw new Error(
        `toLine ${toLine} out of range (${fromLine}..${total}).`,
      );
    }
  }

  private assertAnchors(
    fromLine: number,
    toLine: number,
    anchors?: { expectedFirstLine?: string; expectedLastLine?: string },
  ): void {
    if (!anchors) return;
    if (
      anchors.expectedFirstLine !== undefined &&
      this.lines[fromLine - 1] !== anchors.expectedFirstLine
    ) {
      throw new Error(
        `stale view, re-read: line ${fromLine} is now "${this.lines[fromLine - 1]}", ` +
          `not "${anchors.expectedFirstLine}". Re-read the range before editing.`,
      );
    }
    if (
      anchors.expectedLastLine !== undefined &&
      this.lines[toLine - 1] !== anchors.expectedLastLine
    ) {
      throw new Error(
        `stale view, re-read: line ${toLine} is now "${this.lines[toLine - 1]}", ` +
          `not "${anchors.expectedLastLine}". Re-read the range before editing.`,
      );
    }
  }
}
