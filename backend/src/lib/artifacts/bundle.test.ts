import { describe, test, expect } from "bun:test";
import { zipSync } from "fflate";
import {
  ArtifactBundleError,
  MAX_ARTIFACT_FILES,
  bundleFromEntries,
  bundleFromUpload,
  normaliseArtifactPath,
} from "./bundle";

const enc = new TextEncoder();
const zip = (files: Record<string, string>) =>
  zipSync(
    Object.fromEntries(
      Object.entries(files).map(([path, content]) => [path, enc.encode(content)])
    )
  );

const expectBundleError = (fn: () => unknown, pattern: RegExp) => {
  let error: unknown;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  expect(error).toBeInstanceOf(ArtifactBundleError);
  expect((error as Error).message).toMatch(pattern);
};

describe("artifact bundles", () => {
  test("paths are normalised, anything that could leave the root is refused", () => {
    expect(normaliseArtifactPath("./assets/app.js")).toBe("assets/app.js");
    expect(normaliseArtifactPath("index.html")).toBe("index.html");
    for (const bad of ["/abs.js", "../up.js", "a/../../b.js", "a//b.js", "a\\b.js", "", "a/./b"]) {
      expectBundleError(() => normaliseArtifactPath(bad), /path/i);
    }
  });

  test("a single HTML file becomes index.html", () => {
    const bundle = bundleFromUpload("Dashboard.html", enc.encode("<h1>Hi</h1>"));
    expect(bundle.entryPath).toBe("index.html");
    expect(bundle.files).toHaveLength(1);
    expect(bundle.files[0]!.contentType).toBe("text/html; charset=utf-8");
    expect(bundle.warnings).toEqual([]);
  });

  test("a zipped folder is unpacked, its common folder dropped, junk skipped", () => {
    const bundle = bundleFromUpload(
      "artifact.zip",
      zip({
        "my-artifact/index.html": '<script src="app.js"></script>',
        "my-artifact/app.js": "console.log(1)",
        "my-artifact/data/rows.json": "[]",
        "my-artifact/.DS_Store": "x",
        "__MACOSX/my-artifact/._index.html": "x",
      })
    );
    expect(bundle.entryPath).toBe("index.html");
    expect(bundle.files.map((f) => f.path).sort()).toEqual([
      "app.js",
      "data/rows.json",
      "index.html",
    ]);
    expect(bundle.warnings).toEqual([]);
  });

  test("the only root HTML page is the entry when there is no index.html", () => {
    const bundle = bundleFromEntries([
      { path: "report.html", content: "<p>x</p>" },
      { path: "style.css", content: "p{}" },
    ]);
    expect(bundle.entryPath).toBe("report.html");
  });

  test("no or several root HTML pages without index.html are refused", () => {
    expectBundleError(
      () => bundleFromEntries([{ path: "app.js", content: "1" }]),
      /index\.html/
    );
    expectBundleError(
      () =>
        bundleFromEntries([
          { path: "a.html", content: "a" },
          { path: "b.html", content: "b" },
        ]),
      /index\.html/
    );
  });

  test("unsupported file types are skipped with a warning", () => {
    const bundle = bundleFromEntries([
      { path: "index.html", content: "<p>x</p>" },
      { path: "design.psd", content: "binary" },
    ]);
    expect(bundle.files.map((f) => f.path)).toEqual(["index.html"]);
    expect(bundle.warnings[0]).toContain("design.psd");
  });

  test("absolute references and window.claude are reported, protocol-relative URLs are not", () => {
    const bundle = bundleFromEntries([
      {
        path: "index.html",
        content:
          '<script src="//cdnjs.cloudflare.com/x.js"></script><link href="/style.css">',
      },
      { path: "style.css", content: "body{background:url('/bg.png')}" },
      { path: "app.js", content: "await window.claude.complete('hi')" },
    ]);
    expect(bundle.warnings).toHaveLength(3);
    expect(bundle.warnings.join("\n")).toContain('"index.html" references files by absolute path');
    expect(bundle.warnings.join("\n")).toContain('"style.css" references files by absolute path');
    expect(bundle.warnings.join("\n")).toContain("window.claude");

    const clean = bundleFromEntries([
      { path: "index.html", content: '<script src="https://unpkg.com/x"></script>' },
    ]);
    expect(clean.warnings).toEqual([]);
  });

  test("base64 entries are decoded", () => {
    const bundle = bundleFromEntries([
      { path: "index.html", content: "<img src=dot.png>" },
      { path: "dot.png", content: Buffer.from([1, 2, 3]).toString("base64"), encoding: "base64" },
    ]);
    const png = bundle.files.find((f) => f.path === "dot.png")!;
    expect(Array.from(png.data)).toEqual([1, 2, 3]);
    expect(png.contentType).toBe("image/png");
  });

  test("limits, duplicates and broken uploads are refused", () => {
    const many = Array.from({ length: MAX_ARTIFACT_FILES + 1 }, (_, i) => ({
      path: `f${i}.js`,
      content: "1",
    }));
    expectBundleError(
      () => bundleFromEntries([{ path: "index.html", content: "x" }, ...many]),
      /Too many files/
    );
    expectBundleError(
      () =>
        bundleFromEntries([
          { path: "index.html", content: "x" },
          { path: "./index.html", content: "y" },
        ]),
      /Duplicate/
    );
    expectBundleError(
      () => bundleFromUpload("x.zip", new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2])),
      /ZIP/
    );
    expectBundleError(() => bundleFromUpload("notes.txt", enc.encode("x")), /ZIP/);
    expectBundleError(() => bundleFromUpload("a.html", new Uint8Array()), /empty/);
    expectBundleError(
      () => bundleFromUpload("evil.zip", zip({ "../evil.html": "x" })),
      /path/i
    );
  });
});
