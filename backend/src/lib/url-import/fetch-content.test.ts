/**
 * Regression test for the URL-import content router.
 *
 * The bug: download links (e.g. WP Download Manager `?wpdmdl=` URLs) stream a
 * PDF, and the old pipeline fed those raw bytes straight into Readability,
 * crashing with "null is not an object (evaluating '...tagName')" (or silently
 * importing binary garbage). The router must instead classify by content and
 * never take the HTML/Readability path for a PDF or other binary payload.
 *
 * Needs SSRF_ALLOW_PRIVATE_TARGETS=true so the local test server is reachable.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { importUrlContent } from "./fetch-content";

const PORT = 7813;
const base = `http://127.0.0.1:${PORT}`;
const ctx = { tenantId: "test-tenant" };

// Minimal-but-real PDF byte stream, served as application/pdf.
const PDF_BYTES = new TextEncoder().encode(
  "%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
);

let server: ReturnType<typeof Bun.serve> | null = null;

beforeAll(() => {
  process.env.SSRF_ALLOW_PRIVATE_TARGETS = "true";
  server = Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    fetch: (req) => {
      const path = new URL(req.url).pathname;
      if (path === "/doc.pdf" || path === "/download") {
        return new Response(PDF_BYTES, {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Disposition": 'attachment;filename="produktflyer.pdf"',
          },
        });
      }
      if (path === "/image") {
        return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), {
          headers: { "Content-Type": "image/png" },
        });
      }
      if (path === "/page") {
        return new Response(
          "<html><head><title>Doc Title</title></head><body><article><h1>Heading</h1><p>Imported body text goes here.</p></article></body></html>",
          { headers: { "Content-Type": "text/html" } }
        );
      }
      return new Response("not found", { status: 404 });
    },
  });
});

afterAll(() => {
  server?.stop(true);
});

describe("importUrlContent", () => {
  test("routes PDF downloads to the PDF parser, never to Readability", async () => {
    // No PDF parser service is configured in the test env, so the PDF branch
    // throws a PDF-parser error. The point of the test is that it is NOT the
    // old Readability crash — the bytes reached the PDF path, not the HTML one.
    let error: unknown;
    try {
      await importUrlContent(`${base}/download`, ctx);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toContain("tagName");
    expect(message.toLowerCase()).toContain("pdf");
  });

  test("rejects non-HTML/non-PDF binaries with a clear error", async () => {
    let error: unknown;
    try {
      await importUrlContent(`${base}/image`, ctx);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).not.toContain("tagName");
    expect(message).toContain("Unsupported content type");
  });

  test("still converts real HTML pages to markdown", async () => {
    const result = await importUrlContent(`${base}/page`, ctx);
    expect(result.title).toBe("Doc Title");
    expect(result.markdown).toContain("Heading");
    expect(result.markdown).toContain("Imported body text");
  });
});
