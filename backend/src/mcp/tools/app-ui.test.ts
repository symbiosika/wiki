import { describe, test, expect } from "bun:test";
import {
  parseImageRef,
  appResources,
  appUiTools,
  PAGE_VIEW_RESOURCE_URI,
  IMAGE_VIEW_RESOURCE_URI,
} from "./app-ui";

const UUID = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";

const toolByName = (name: string) =>
  appUiTools.find((tool) => tool.name === name);

describe("parseImageRef()", () => {
  test("accepts a bare filename", () => {
    expect(parseImageRef(`${UUID}.png`)).toBe(`${UUID}.png`);
  });

  test("accepts the full API path from the page content", () => {
    expect(
      parseImageRef(`/api/v1/tenant/t1/files/db/knowledge/${UUID}.webp`),
    ).toBe(`${UUID}.webp`);
  });

  test("accepts a full URL with query string", () => {
    expect(
      parseImageRef(
        `https://wiki.example.com/api/v1/tenant/t1/files/db/knowledge/${UUID}.jpg?x=1`,
      ),
    ).toBe(`${UUID}.jpg`);
  });

  test("rejects traversal and non-uuid names", () => {
    expect(parseImageRef("../../etc/passwd")).toBeNull();
    expect(parseImageRef("evil.png")).toBeNull();
    expect(parseImageRef(`${UUID}`)).toBeNull(); // no extension
    expect(parseImageRef(`${UUID}.png/../secret`)).toBeNull();
  });
});

describe("MCP Apps registration", () => {
  test("view_page carries the ui resource linkage (modern + legacy key)", () => {
    const tool = toolByName("view_page");
    expect(tool).toBeDefined();
    expect((tool!._meta as any)?.ui?.resourceUri).toBe(PAGE_VIEW_RESOURCE_URI);
    expect((tool!._meta as any)?.["ui/resourceUri"]).toBe(
      PAGE_VIEW_RESOURCE_URI,
    );
  });

  test("get_page_image is registered without a ui view of its own", () => {
    const tool = toolByName("get_page_image");
    expect(tool).toBeDefined();
    expect(tool!._meta).toBeUndefined();
  });

  test("view_image and view_page_images link to the image view", () => {
    for (const name of ["view_image", "view_page_images"]) {
      const tool = toolByName(name);
      expect(tool).toBeDefined();
      expect((tool!._meta as any)?.ui?.resourceUri).toBe(
        IMAGE_VIEW_RESOURCE_URI,
      );
      expect((tool!._meta as any)?.["ui/resourceUri"]).toBe(
        IMAGE_VIEW_RESOURCE_URI,
      );
    }
  });

  test("the image-view resource serves self-contained HTML", async () => {
    const resource = appResources.find(
      (r) => r.uri === IMAGE_VIEW_RESOURCE_URI,
    );
    expect(resource).toBeDefined();
    expect(resource!.mimeType).toBe("text/html;profile=mcp-app");

    const contents = await resource!.read({} as any);
    const html = (Array.isArray(contents) ? contents[0]! : contents)
      .text as string;
    expect(html).toContain("callServerTool");
    expect(html).toContain("requestDisplayMode");
    expect(html).not.toContain('src="http');
  }, 60_000);

  test("the page-view resource serves self-contained HTML with the app mime type", async () => {
    const resource = appResources.find((r) => r.uri === PAGE_VIEW_RESOURCE_URI);
    expect(resource).toBeDefined();
    expect(resource!.mimeType).toBe("text/html;profile=mcp-app");

    const contents = await resource!.read({} as any);
    const content = Array.isArray(contents) ? contents[0]! : contents;
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    const html = content.text as string;
    // bundled app is inlined, no external references left
    expect(html).toContain("callServerTool");
    expect(html).not.toContain('src="http');
    expect(html).not.toContain("</script></script>");
  }, 60_000);
});
