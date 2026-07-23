import { describe, test, expect } from "bun:test";
import { McpServer } from "@modelcontextprotocol/server";
import {
  parseImageRef,
  PAGE_VIEW_RESOURCE_URI,
  IMAGE_VIEW_RESOURCE_URI,
} from "./app-ui.ts";
import { registerAllTools } from "./index.ts";

const UUID = "0a1b2c3d-4e5f-6a7b-8c9d-0e1f2a3b4c5d";

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
      parseImageRef(`https://wiki.example.com/api/v1/tenant/t1/files/db/knowledge/${UUID}.jpg?x=1`),
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
  const mcp = new McpServer({ name: "t", version: "0" }, {});
  registerAllTools(mcp);
  const internals = mcp as any;

  test("view_page carries the ui resource linkage (modern + legacy key)", () => {
    const tool = internals._registeredTools["view_page"];
    expect(tool).toBeDefined();
    expect(tool._meta?.ui?.resourceUri).toBe(PAGE_VIEW_RESOURCE_URI);
    expect(tool._meta?.["ui/resourceUri"]).toBe(PAGE_VIEW_RESOURCE_URI);
  });

  test("get_page_image is registered without a ui view of its own", () => {
    const tool = internals._registeredTools["get_page_image"];
    expect(tool).toBeDefined();
    expect(tool._meta?.ui).toBeUndefined();
  });

  test("view_image and view_page_images link to the image view", () => {
    for (const name of ["view_image", "view_page_images"]) {
      const tool = internals._registeredTools[name];
      expect(tool).toBeDefined();
      expect(tool._meta?.ui?.resourceUri).toBe(IMAGE_VIEW_RESOURCE_URI);
      expect(tool._meta?.["ui/resourceUri"]).toBe(IMAGE_VIEW_RESOURCE_URI);
    }
  });

  test("the image-view resource serves self-contained HTML", async () => {
    const resource = internals._registeredResources[IMAGE_VIEW_RESOURCE_URI];
    expect(resource).toBeDefined();
    expect(resource.metadata.mimeType).toBe("text/html;profile=mcp-app");

    const result = await resource.readCallback(
      new URL(IMAGE_VIEW_RESOURCE_URI),
      {} as any,
    );
    const html = result.contents[0]!.text as string;
    expect(html).toContain("callServerTool");
    expect(html).toContain("requestDisplayMode");
    expect(html).not.toContain('src="http');
  }, 60_000);

  test("the page-view resource serves self-contained HTML with the app mime type", async () => {
    const resource = internals._registeredResources[PAGE_VIEW_RESOURCE_URI];
    expect(resource).toBeDefined();
    expect(resource.metadata.mimeType).toBe("text/html;profile=mcp-app");

    const result = await resource.readCallback(
      new URL(PAGE_VIEW_RESOURCE_URI),
      {} as any,
    );
    const content = result.contents[0]!;
    expect(content.mimeType).toBe("text/html;profile=mcp-app");
    const html = content.text as string;
    // bundled app is inlined, no external references left
    expect(html).toContain("callServerTool");
    expect(html).not.toContain('src="http');
    expect(html).not.toContain("</script></script>");
  }, 60_000);
});
