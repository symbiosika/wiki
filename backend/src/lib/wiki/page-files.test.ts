import { describe, test, expect } from "bun:test";
import {
  attachmentDisposition,
  safeStoredContentType,
  sanitizeFileName,
} from "./page-files";

describe("page file helpers", () => {
  test("content types a browser would render are neutralized", () => {
    expect(safeStoredContentType("text/html")).toBe("application/octet-stream");
    expect(safeStoredContentType("text/html; charset=utf-8")).toBe(
      "application/octet-stream"
    );
    expect(safeStoredContentType("image/svg+xml")).toBe(
      "application/octet-stream"
    );
    expect(safeStoredContentType("application/javascript")).toBe(
      "application/octet-stream"
    );
    expect(safeStoredContentType("")).toBe("application/octet-stream");
  });

  test("ordinary content types are kept", () => {
    expect(safeStoredContentType("application/pdf")).toBe("application/pdf");
    expect(safeStoredContentType("IMAGE/PNG")).toBe("image/png");
  });

  test("file names lose their path and control characters, keep the extension", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Users\\a\\Bericht.pdf")).toBe("Bericht.pdf");
    expect(sanitizeFileName('a"b\nc.txt')).toBe("abc.txt");
    expect(sanitizeFileName("")).toBe("file");
    const long = sanitizeFileName(`${"x".repeat(300)}.docx`);
    expect(long.length).toBe(200);
    expect(long.endsWith(".docx")).toBe(true);
  });

  test("the disposition carries an ascii fallback and the utf-8 name", () => {
    expect(attachmentDisposition("Übersicht März.pdf")).toBe(
      `attachment; filename="_bersicht M_rz.pdf"; filename*=UTF-8''%C3%9Cbersicht%20M%C3%A4rz.pdf`
    );
  });
});
