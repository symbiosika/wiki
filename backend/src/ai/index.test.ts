import { describe, test, expect } from "bun:test";
import * as v from "valibot";
import { extractJsonObject, parseSchemaJson } from "./index";

// A schema shaped like the judge's call-1 output: number-with-range, enum,
// nested array of objects, arrays of strings — exactly the kind of shape that
// broke `generateObject` on the openai-compatible provider.
const schema = v.object({
  relevance: v.pipe(v.number(), v.minValue(0), v.maxValue(1)),
  saysWikiHasNoAnswer: v.boolean(),
  citedPageTitles: v.array(v.string()),
  claims: v.array(v.string()),
  verdicts: v.array(
    v.object({
      claim: v.string(),
      verdict: v.picklist(["supported", "unsupported", "contradicted"]),
    }),
  ),
})

const valid = {
  relevance: 0.9,
  saysWikiHasNoAnswer: false,
  citedPageTitles: ["Vacation Policy"],
  claims: ["30 days"],
  verdicts: [{ claim: "30 days", verdict: "supported" }],
}

describe("extractJsonObject", () => {
  test("returns bare JSON unchanged", () => {
    const s = '{"a":1}'
    expect(extractJsonObject(s)).toBe(s)
  })

  test("strips ```json fences", () => {
    expect(extractJsonObject('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  test("strips plain ``` fences", () => {
    expect(extractJsonObject('```\n{"a":1}\n```')).toBe('{"a":1}')
  })

  test("drops surrounding prose", () => {
    expect(
      extractJsonObject('Sure, here is the result:\n{"a":1}\nHope that helps!'),
    ).toBe('{"a":1}')
  })
})

describe("parseSchemaJson", () => {
  test("parses a clean object", () => {
    const res = parseSchemaJson(JSON.stringify(valid), schema)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.object.relevance).toBe(0.9)
  })

  test("parses a fenced, prose-wrapped object", () => {
    const text = 'Here you go:\n```json\n' + JSON.stringify(valid) + '\n```'
    const res = parseSchemaJson(text, schema)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.object.verdicts[0]!.verdict).toBe("supported")
  })

  test("fails on invalid JSON", () => {
    const res = parseSchemaJson("not json at all", schema)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.length).toBeGreaterThan(0)
  })

  test("fails on schema mismatch (out-of-range + bad enum)", () => {
    const bad = {
      ...valid,
      relevance: 2, // out of [0,1]
      verdicts: [{ claim: "x", verdict: "maybe" }], // not in picklist
    }
    const res = parseSchemaJson(JSON.stringify(bad), schema)
    expect(res.ok).toBe(false)
  })

  test("fails when a required field is missing", () => {
    const { relevance, ...rest } = valid
    void relevance
    const res = parseSchemaJson(JSON.stringify(rest), schema)
    expect(res.ok).toBe(false)
  })
})
