import { describe, test, expect } from "bun:test";
import { cronMatches, assertValidCron } from "./cron";

// A fixed reference instant. Use local-time getters (matcher uses local time).
// 2026-07-13 is a Monday.
const at = (y: number, mo: number, d: number, h: number, mi: number): Date =>
  new Date(y, mo - 1, d, h, mi, 0, 0);

describe("cronMatches", () => {
  test("every minute (* * * * *)", () => {
    expect(cronMatches("* * * * *", at(2026, 7, 13, 10, 30))).toBe(true);
  });

  test("specific minute + hour", () => {
    expect(cronMatches("30 10 * * *", at(2026, 7, 13, 10, 30))).toBe(true);
    expect(cronMatches("30 10 * * *", at(2026, 7, 13, 10, 31))).toBe(false);
    expect(cronMatches("30 10 * * *", at(2026, 7, 13, 11, 30))).toBe(false);
  });

  test("step values (*/15)", () => {
    expect(cronMatches("*/15 * * * *", at(2026, 7, 13, 10, 0))).toBe(true);
    expect(cronMatches("*/15 * * * *", at(2026, 7, 13, 10, 15))).toBe(true);
    expect(cronMatches("*/15 * * * *", at(2026, 7, 13, 10, 45))).toBe(true);
    expect(cronMatches("*/15 * * * *", at(2026, 7, 13, 10, 20))).toBe(false);
  });

  test("lists and ranges", () => {
    expect(cronMatches("0 9,17 * * *", at(2026, 7, 13, 9, 0))).toBe(true);
    expect(cronMatches("0 9,17 * * *", at(2026, 7, 13, 17, 0))).toBe(true);
    expect(cronMatches("0 9,17 * * *", at(2026, 7, 13, 12, 0))).toBe(false);
    expect(cronMatches("0 9-11 * * *", at(2026, 7, 13, 10, 0))).toBe(true);
    expect(cronMatches("0 9-11 * * *", at(2026, 7, 13, 12, 0))).toBe(false);
  });

  test("day of week (Monday = 1)", () => {
    // 2026-07-13 is Monday
    expect(cronMatches("0 8 * * 1", at(2026, 7, 13, 8, 0))).toBe(true);
    expect(cronMatches("0 8 * * 2", at(2026, 7, 13, 8, 0))).toBe(false);
  });

  test("day of month", () => {
    expect(cronMatches("0 0 1 * *", at(2026, 7, 1, 0, 0))).toBe(true);
    expect(cronMatches("0 0 1 * *", at(2026, 7, 2, 0, 0))).toBe(false);
  });

  test("malformed expressions never match", () => {
    expect(cronMatches("not a cron", at(2026, 7, 13, 10, 30))).toBe(false);
    expect(cronMatches("* * *", at(2026, 7, 13, 10, 30))).toBe(false);
    expect(cronMatches("99 * * * *", at(2026, 7, 13, 10, 30))).toBe(false);
  });
});

describe("assertValidCron", () => {
  test("accepts valid expressions", () => {
    expect(() => assertValidCron("*/5 * * * *")).not.toThrow();
    expect(() => assertValidCron("0 3 * * 0")).not.toThrow();
    expect(() => assertValidCron("0 9,12,18 * * 1-5")).not.toThrow();
  });

  test("rejects wrong field count and out-of-range", () => {
    expect(() => assertValidCron("* * * *")).toThrow();
    expect(() => assertValidCron("60 * * * *")).toThrow();
    expect(() => assertValidCron("* 24 * * *")).toThrow();
  });
});
