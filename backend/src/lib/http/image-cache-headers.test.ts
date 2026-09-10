import { describe, expect, it } from "bun:test";
import {
  IMMUTABLE_PRIVATE_IMAGE_CACHE_CONTROL,
  imageCacheControlFor,
  withImageCacheHeaders,
} from "./image-cache-headers";

const TENANT = "11111111-2222-3333-4444-555555555555";
const FILE = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const knowledgeImage = `http://wiki.local/api/v1/tenant/${TENANT}/files/db/knowledge/${FILE}.png`;
const parsedImage = `http://wiki.local/api/v1/tenant/${TENANT}/files/db/images/${FILE}.jpeg`;

const imageResponse = (headers: Record<string, string> = {}) =>
  new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { "Content-Type": "image/png", ...headers },
  });

describe("imageCacheControlFor", () => {
  it("caches a page image from either page-image bucket", () => {
    for (const url of [knowledgeImage, parsedImage]) {
      expect({
        url,
        header: imageCacheControlFor(new Request(url), imageResponse()),
      }).toEqual({ url, header: IMMUTABLE_PRIVATE_IMAGE_CACHE_CONTROL });
    }
  });

  it("is case-insensitive about the path and the content type", () => {
    const upper = knowledgeImage
      .toUpperCase()
      .replace("HTTP://WIKI.LOCAL", "http://wiki.local");
    expect(
      imageCacheControlFor(
        new Request(upper),
        imageResponse({ "Content-Type": "IMAGE/PNG" }),
      ),
    ).toBe(IMMUTABLE_PRIVATE_IMAGE_CACHE_CONTROL);
  });

  it("leaves other buckets of the file route alone", () => {
    const attachment = `http://wiki.local/api/v1/tenant/${TENANT}/files/db/chat/${FILE}.png`;
    expect(
      imageCacheControlFor(new Request(attachment), imageResponse()),
    ).toBeNull();
  });

  it("leaves local-disk files and other routes alone", () => {
    const paths = [
      `http://wiki.local/api/v1/tenant/${TENANT}/files/local/knowledge/${FILE}.png`,
      `http://wiki.local/api/v1/tenant/${TENANT}/files/db/knowledge/${FILE}/info`,
      `http://wiki.local/api/v1/tenant/${TENANT}/organisation-logo`,
      `http://wiki.local/api/v1/tenant/${TENANT}/files/db/knowledge/not-a-uuid.png`,
    ];
    for (const url of paths) {
      expect({
        url,
        header: imageCacheControlFor(new Request(url), imageResponse()),
      }).toEqual({ url, header: null });
    }
  });

  it("only touches successful, complete answers to reads", () => {
    const notFound = new Response("{}", {
      status: 404,
      headers: { "Content-Type": "application/json" },
    });
    expect(
      imageCacheControlFor(new Request(knowledgeImage), notFound),
    ).toBeNull();

    const partial = new Response(new Uint8Array([1]), {
      status: 206,
      headers: { "Content-Type": "image/png" },
    });
    expect(
      imageCacheControlFor(new Request(knowledgeImage), partial),
    ).toBeNull();

    expect(
      imageCacheControlFor(
        new Request(knowledgeImage, { method: "DELETE" }),
        imageResponse(),
      ),
    ).toBeNull();
  });

  it("does not cache a body that is not an image", () => {
    const pdf = imageResponse({ "Content-Type": "application/pdf" });
    expect(imageCacheControlFor(new Request(knowledgeImage), pdf)).toBeNull();
  });

  it("never overrules a policy the server already set", () => {
    const own = imageResponse({ "Cache-Control": "no-store" });
    expect(imageCacheControlFor(new Request(knowledgeImage), own)).toBeNull();
  });
});

describe("withImageCacheHeaders", () => {
  it("adds the header to a page image and keeps body and other headers", async () => {
    const fetch = withImageCacheHeaders(async () =>
      imageResponse({ "Content-Length": "3", "Accept-Ranges": "bytes" }),
    );
    const response = await fetch(new Request(knowledgeImage));

    expect(response?.status).toBe(200);
    expect(response?.headers.get("Cache-Control")).toBe(
      IMMUTABLE_PRIVATE_IMAGE_CACHE_CONTROL,
    );
    expect(response?.headers.get("Content-Type")).toBe("image/png");
    expect(response?.headers.get("Accept-Ranges")).toBe("bytes");
    expect(new Uint8Array(await response!.arrayBuffer())).toEqual(
      new Uint8Array([1, 2, 3]),
    );
  });

  it("returns every other response untouched, by identity", async () => {
    const original = new Response("ok", { status: 200 });
    const fetch = withImageCacheHeaders(async () => original);
    expect(
      await fetch(new Request("http://wiki.local/api/v1/public/app-info")),
    ).toBe(original);
  });

  it("passes a missing response (a websocket upgrade) straight through", async () => {
    const fetch = withImageCacheHeaders(() => undefined);
    expect(await fetch(new Request(knowledgeImage))).toBeUndefined();
  });

  it("hands the extra fetch arguments on to the inner handler", async () => {
    let seen: unknown[] = [];
    const fetch = withImageCacheHeaders((_request, ...rest) => {
      seen = rest;
      return undefined;
    });
    const server = { name: "bun" };
    await fetch(new Request(knowledgeImage), server);
    expect(seen).toEqual([server]);
  });
});
