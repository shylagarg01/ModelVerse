import { describe, expect, it } from "vitest";
import { sketchfab } from "../../src/providers/sketchfab.js";
import { fixtureCtx } from "../helpers.js";

const routes: [string | RegExp, string][] = [
  ["cursor=8000", "sketchfab/probe.json"],
  ["/v3/models/d9e174d623124d2aa23122683018f6e6", "sketchfab/detail.json"],
  [/search\?.*q=tree/, "sketchfab/search_tree.json"],
];

describe("sketchfab", () => {
  it("maps CC0 search results", async () => {
    const ctx = fixtureCtx(routes);
    const r = await sketchfab.search({ query: "tree", limit: 3 }, ctx);
    expect(r.assets).toHaveLength(3);
    expect(r.assets[1]).toMatchObject({
      id: "sketchfab:d9e174d623124d2aa23122683018f6e6",
      provider: "sketchfab",
      type: "model",
      downloadable: false,
      license: { name: "CC0" },
      price: { free: true },
      formats: ["glb", "gltf", "usdz"],
      polyCount: 497186,
      author: "ffish.asia / floraZia.com",
      categories: ["Nature Plants", "Science Technology"],
    });
    expect(r.assets[1]!.tags).toContain("florazia");
    expect(r.assets[1]!.url).toContain("sketchfab.com/3d-models/");
    expect(r.assets[1]!.thumbnailUrl).toMatch(/^https:\/\/media\.sketchfab\.com\//);
    expect(ctx.fetch.requests).toHaveLength(1);
    expect(ctx.fetch.requests[0]).toContain("license=cc0");
    expect(ctx.fetch.requests[0]).toContain("count=3");
    expect(r.searchUrl).toContain("sketchfab.com/search");
  });

  it("paginates with a cursor and caps the page size", async () => {
    const ctx = fixtureCtx(routes);
    await sketchfab.search({ query: "tree", limit: 100, offset: 48 }, ctx);
    expect(ctx.fetch.requests[0]).toContain("count=24");
    expect(ctx.fetch.requests[0]).toContain("cursor=48");
  });

  it("skips the request when types do not apply", async () => {
    const ctx = fixtureCtx(routes);
    const r = await sketchfab.search({ query: "tree", types: ["hdri"], limit: 5 }, ctx);
    expect(r.assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
  });

  it("returns details without downloadable files", async () => {
    const d = await sketchfab.getAsset!("d9e174d623124d2aa23122683018f6e6", fixtureCtx(routes));
    expect(d).toMatchObject({ title: expect.stringContaining("Silver Tree"), license: { name: "CC0" }, files: [] });
  });

  it("returns null for unknown ids", async () => {
    expect(await sketchfab.getAsset!("nope", fixtureCtx([]))).toBeNull();
    expect(await sketchfab.getAsset!("0".repeat(32), fixtureCtx([]))).toBeNull();
  });

  it("gives a lower-bound census", async () => {
    const ctx = fixtureCtx(routes);
    const c = await sketchfab.census!(ctx);
    expect(c.total).toBe(8003);
    expect(c.atLeast).toBe(true);
    expect(c.byType.model).toBe(c.total);
    expect(ctx.fetch.requests).toHaveLength(1);
  });
});
