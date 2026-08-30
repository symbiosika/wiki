import { describe, test, expect } from "bun:test";
import {
  coerceValue,
  validateRecordData,
  formatValue,
  CollectionValueError,
} from "./values";
import {
  mergeIntoBody,
  stripFromBody,
  renderCollectionMarkdown,
} from "./materialize";
import { slugifyFieldKey } from "./store";
import type { CollectionFieldSelect } from "../../db/schema";

/** Minimal field stub — only what the value logic reads. */
const field = (
  over: Partial<CollectionFieldSelect> & Pick<CollectionFieldSelect, "type">,
): CollectionFieldSelect =>
  ({
    id: "f1",
    collectionId: "c1",
    tenantId: "t1",
    key: over.key ?? "k",
    label: over.label ?? "Feld",
    options: {},
    required: false,
    position: 0,
    hidden: false,
    createdAt: "",
    updatedAt: "",
    ...over,
  }) as CollectionFieldSelect;

describe("collection values", () => {
  test("empty string and null collapse to a single empty state", () => {
    const f = field({ type: "text" });
    expect(coerceValue(f, "")).toBe(null);
    expect(coerceValue(f, "   ")).toBe(null);
    expect(coerceValue(f, null)).toBe(null);
    expect(coerceValue(f, undefined)).toBe(null);
  });

  test("numbers accept numeric strings and honour precision", () => {
    expect(coerceValue(field({ type: "number" }), "42.5")).toBe(42.5);
    expect(
      coerceValue(field({ type: "number", options: { precision: 0 } }), "42.6"),
    ).toBe(43);
    expect(() => coerceValue(field({ type: "number" }), "abc")).toThrow(
      CollectionValueError,
    );
  });

  test("dates keep only the day, and reject nonsense", () => {
    const f = field({ type: "date" });
    expect(coerceValue(f, "2026-03-01")).toBe("2026-03-01");
    expect(coerceValue(f, "2026-03-01T10:00:00Z")).toBe("2026-03-01");
    expect(() => coerceValue(f, "01.03.2026")).toThrow(CollectionValueError);
    expect(() => coerceValue(f, "2026-13-45")).toThrow(CollectionValueError);
  });

  test("urls get a scheme when the user omits it", () => {
    const f = field({ type: "url" });
    expect(coerceValue(f, "example.com/x")).toBe("https://example.com/x");
    expect(coerceValue(f, "http://a.test/")).toBe("http://a.test/");
    // a non-web scheme is not a web address
    expect(() => coerceValue(f, "javascript:alert(1)")).toThrow(
      CollectionValueError,
    );
  });

  test("emails are checked loosely but not blindly accepted", () => {
    const f = field({ type: "email" });
    expect(coerceValue(f, " a@b.de ")).toBe("a@b.de");
    expect(() => coerceValue(f, "not-an-email")).toThrow(CollectionValueError);
  });

  test("select values must be one of the configured choices", () => {
    const f = field({
      type: "select",
      options: { choices: [{ value: "aktiv" }, { value: "passiv" }] },
    });
    expect(coerceValue(f, "aktiv")).toBe("aktiv");
    expect(() => coerceValue(f, "ehemalig")).toThrow(CollectionValueError);
  });

  test("multiSelect de-duplicates and keeps an array as its empty state", () => {
    const f = field({
      type: "multiSelect",
      options: { choices: [{ value: "a" }, { value: "b" }] },
    });
    expect(coerceValue(f, ["a", "b", "a"])).toEqual(["a", "b"]);
    expect(coerceValue(f, null)).toEqual([]);
    expect(() => coerceValue(f, ["c"])).toThrow(CollectionValueError);
  });

  test("checkbox is false rather than empty when unset", () => {
    const f = field({ type: "checkbox" });
    expect(coerceValue(f, null)).toBe(false);
    expect(coerceValue(f, "true")).toBe(true);
  });

  test("required is enforced on create but not on an untouched patch", () => {
    const fields = [
      field({ type: "text", key: "name", label: "Name", required: true }),
      field({ type: "text", key: "note", label: "Notiz" }),
    ];

    expect(() => validateRecordData(fields, { note: "x" }, "create")).toThrow(
      CollectionValueError,
    );
    // patching only the optional column must not trip the required check
    expect(validateRecordData(fields, { note: "x" }, "patch")).toEqual({
      note: "x",
    });
  });

  test("unknown keys are dropped, not rejected", () => {
    const fields = [field({ type: "text", key: "name" })];
    expect(
      validateRecordData(fields, { name: "a", gone: "b" }, "create"),
    ).toEqual({ name: "a" });
  });

  test("formatValue renders each type for the markdown mirror", () => {
    expect(formatValue(field({ type: "checkbox" }), true)).toBe("yes");
    expect(formatValue(field({ type: "multiSelect" }), ["a", "b"])).toBe("a, b");
    expect(
      formatValue(field({ type: "number", options: { suffix: "€" } }), 5),
    ).toBe("5 €");
    expect(formatValue(field({ type: "text" }), null)).toBe("");
  });
});

describe("collection materialization", () => {
  const fields = [
    field({ type: "text", key: "name", label: "Name" }),
    field({ type: "text", key: "note", label: "Notiz" }),
  ];
  const records = [
    { data: { name: "Anna", note: "a | b" } },
    { data: { name: "Bert", note: "zwei\nZeilen" } },
  ] as any;

  test("renders a markdown table and escapes cell content", () => {
    const md = renderCollectionMarkdown(fields, records, 2);
    expect(md).toContain("| Name | Notiz |");
    expect(md).toContain("| --- | --- |");
    // a pipe inside a value must not create a new column
    expect(md).toContain("a \\| b");
    // a newline inside a value must not break the row
    expect(md).toContain("zwei Zeilen");
  });

  test("says so when the table is longer than the mirror", () => {
    const md = renderCollectionMarkdown(fields, records, 900);
    expect(md).toContain("2 of 900 entries shown");
  });

  test("hidden columns stay out of the mirror", () => {
    const md = renderCollectionMarkdown(
      [fields[0]!, field({ type: "text", key: "note", label: "Notiz", hidden: true })],
      records,
      2,
    );
    expect(md).toContain("| Name |");
    expect(md).not.toContain("Notiz");
  });

  test("prose around the generated block survives a re-render", () => {
    const first = mergeIntoBody("Intro-Text.", "| A |\n| --- |");
    expect(first).toContain("Intro-Text.");

    const second = mergeIntoBody(first, "| B |\n| --- |");
    expect(second).toContain("Intro-Text.");
    expect(second).toContain("| B |");
    // the old table is replaced, not appended a second time
    expect(second).not.toContain("| A |");
    expect(second.match(/collection:begin/g)).toHaveLength(1);
  });

  test("stripping removes the block and leaves the prose", () => {
    const body = mergeIntoBody("Nur Text.", "| A |\n| --- |");
    const stripped = stripFromBody(body);
    expect(stripped).toBe("Nur Text.");
    // stripping a body that never had a block is a no-op
    expect(stripFromBody("Nur Text.")).toBe("Nur Text.");
  });

  test("a cell containing the block markers cannot corrupt the merge", () => {
    const evil = [
      { data: { name: "x", note: "<!-- collection:end --> kaputt" } },
    ] as any;
    const md = renderCollectionMarkdown(fields, evil, 1);
    expect(md).not.toContain("<!--");
    expect(md).not.toContain("-->");

    // the round trip stays stable: re-render replaces, never duplicates
    const first = mergeIntoBody("Prosa.", md);
    const second = mergeIntoBody(first, md);
    expect(second.match(/<!-- collection:begin -->/g)).toHaveLength(1);
    expect(second.match(/<!-- collection:end -->/g)).toHaveLength(1);
    // the table itself appears once, not appended twice
    expect(second.match(/kaputt/g)).toHaveLength(1);
  });
});

describe("slugifyFieldKey", () => {
  test("transliterates German umlauts instead of just stripping accents", () => {
    expect(slugifyFieldKey("Beiträge", [])).toBe("beitraege");
    expect(slugifyFieldKey("Größe", [])).toBe("groesse");
    expect(slugifyFieldKey("Übung", [])).toBe("uebung");
    // a decomposed "a" + combining diaeresis is treated like a typed "ä"
    expect(slugifyFieldKey("Beiträge", [])).toBe("beitraege");
    // other accents still fall back to their base letter
    expect(slugifyFieldKey("Café", [])).toBe("cafe");
  });

  test('"id" is reserved for the record id', () => {
    expect(slugifyFieldKey("ID", [])).toBe("id_2");
  });

  test("collisions get a numeric suffix", () => {
    expect(slugifyFieldKey("Name", ["name"])).toBe("name_2");
    expect(slugifyFieldKey("Name", ["name", "name_2"])).toBe("name_3");
  });
});
