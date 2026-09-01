import { describe, expect, it } from "bun:test";
import { hasNulByteInPath } from "./request-path-guard";

describe("hasNulByteInPath", () => {
  it("rejects the scanner requests seen in the logs", () => {
    const seen = [
      "http://wiki.example.com/file%3a///////etc/passwd%00",
      "http://wiki.example.com/file%3a///////etc%5cpasswd%00",
      "http://wiki.example.com/file%3a///////etc/passwd%00.jpg",
      "http://wiki.example.com/file%3a///////etc%2fpasswd%00.jpg",
    ];
    for (const url of seen) {
      expect({ url, rejected: hasNulByteInPath(url) }).toEqual({
        url,
        rejected: true,
      });
    }
  });

  it("rejects a literal NUL byte in the path", () => {
    expect(hasNulByteInPath("http://x/docs/index.html\0.png")).toBe(true);
  });

  it("lets ordinary requests through", () => {
    const fine = [
      "http://x/",
      "http://x/login.html",
      "http://x/docs/assets/app-4f2a.js",
      "http://x/api/v1/public/wiki/organisations",
      "http://x/api/v1/public/wiki/00000000-0000-0000-0000-000000000000/overview",
      // path traversal without a NUL is not this guard's business: the static
      // handler resolves the dot segments and stays inside its root
      "http://x/../../etc/passwd",
      "http://x/Ordner%20mit%20Leerzeichen/Datei%20%C3%A4.pdf",
    ];
    for (const url of fine) {
      expect({ url, rejected: hasNulByteInPath(url) }).toEqual({
        url,
        rejected: false,
      });
    }
  });

  it("ignores the query string", () => {
    expect(hasNulByteInPath("http://x/search?q=%00")).toBe(false);
    expect(hasNulByteInPath("http://x/search#%00")).toBe(false);
    // …but not a NUL before it
    expect(hasNulByteInPath("http://x/file%00?q=1")).toBe(true);
  });

  it("does not treat a double-encoded %00 as a NUL byte", () => {
    // decodes once, to the literal characters "%00" — a legal file name
    expect(hasNulByteInPath("http://x/file%2500.txt")).toBe(false);
  });

  it("survives malformed escape sequences", () => {
    expect(hasNulByteInPath("http://x/file%zz")).toBe(false);
    expect(hasNulByteInPath("http://x/file%")).toBe(false);
    expect(hasNulByteInPath("http://x/file%e0%a4%a")).toBe(false);
  });

  it("handles a URL with no path at all", () => {
    expect(hasNulByteInPath("http://x")).toBe(false);
  });
});
