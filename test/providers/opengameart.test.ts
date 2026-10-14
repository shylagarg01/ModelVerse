import { describe, expect, it } from "vitest";
import { opengameart } from "../../src/providers/opengameart.js";
import { fixtureCtx } from "../helpers.js";

const BASE = "https://opengameart.org/art-search-advanced?keys=";
const routes: [string, string][] = [
  ["keys=tree&field_art_type_tid%5B%5D=10&page=1", "opengameart/search_tree_3d_p2.html"],
  ["keys=tree&field_art_type_tid%5B%5D=10", "opengameart/search_tree_3d.html"],
  ["keys=tree&field_art_type_tid%5B%5D=14&field_art_type_tid%5B%5D=9", "opengameart/search_tree_3d.html"],
  ["keys=&field_art_type_tid%5B%5D=10", "opengameart/census_3d.html"],
  ["keys=&field_art_type_tid%5B%5D=14", "opengameart/census_texture.html"],
  ["keys=&field_art_type_tid%5B%5D=9", "opengameart/census_2d.html"],
  ["/content/nature-kit", "opengameart/nature_kit.html"],
];

describe("opengameart", () => {
  it("parses the server-rendered 3D art listing", async () => {
    const ctx = fixtureCtx(routes);
    const r = await opengameart.search({ query: "tree", types: ["model"], limit: 3 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${BASE}tree&field_art_type_tid%5B%5D=10`]);
    expect(r.assets).toHaveLength(3);
    expect(r.assets[0]).toMatchObject({
      id: "opengameart:palm-tree-v2",
      title: "Palm tree v2",
      type: "model",
      url: "https://opengameart.org/content/palm-tree-v2",
      thumbnailUrl: "https://opengameart.org/sites/default/files/styles/thumbnail/public/preview_52.jpg",
      downloadable: true,
      price: { free: true },
    });
    expect(r.total).toBe(182);
    expect(r.searchUrl).toBe(`${BASE}tree&field_art_type_tid%5B%5D=10`);
  });

  it("maps offsets onto the site's 24-item pages", async () => {
    const ctx = fixtureCtx(routes);
    const r = await opengameart.search({ query: "tree", types: ["model"], limit: 5, offset: 22 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${BASE}tree&field_art_type_tid%5B%5D=10`, `${BASE}tree&field_art_type_tid%5B%5D=10&page=1`]);
    expect(r.assets).toHaveLength(5);
    const page2 = await opengameart.search({ query: "tree", types: ["model"], limit: 1, offset: 24 }, fixtureCtx(routes));
    expect(r.assets[2]!.id).toBe(page2.assets[0]!.id);
  });

  it("filters by type and skips types it does not hold", async () => {
    const ctx = fixtureCtx(routes);
    expect((await opengameart.search({ query: "tree", types: ["hdri"], limit: 3 }, ctx)).assets).toEqual([]);
    expect(ctx.fetch.requests).toEqual([]);
    const both = await opengameart.search({ query: "tree", types: ["texture", "sprite"], limit: 2 }, ctx);
    expect(ctx.fetch.requests).toEqual([`${BASE}tree&field_art_type_tid%5B%5D=14&field_art_type_tid%5B%5D=9`]);
    expect(both.assets).toHaveLength(2);
    expect(opengameart.buildSearchUrl({ query: "grass", types: ["sprite"], limit: 1 })).toBe(`${BASE}grass&field_art_type_tid%5B%5D=9`);
  });

  it("reads licence, author and plain-GET files from a detail page", async () => {
    const d = await opengameart.getAsset!("nature-kit", fixtureCtx(routes));
    expect(d).toMatchObject({
      id: "opengameart:nature-kit",
      title: "Nature Kit",
      type: "model",
      author: "Kenney",
      createdAt: "2018-04-12",
      license: { name: "CC0", attributionRequired: false },
      downloadable: true,
      formats: ["zip"],
    });
    expect(d!.tags).toContain("trees");
    expect(d!.files).toHaveLength(1);
    expect(d!.files[0]).toMatchObject({
      url: "https://opengameart.org/sites/default/files/Nature%20Kit%20%282.1%29.zip",
      filename: "Nature Kit (2.1).zip",
      format: "zip",
      sizeBytes: 10537521,
    });
  });

  it("returns null for unknown or malformed ids", async () => {
    expect(await opengameart.getAsset!("no-such-asset", fixtureCtx(routes))).toBeNull();
    expect(await opengameart.getAsset!("../etc", fixtureCtx(routes))).toBeNull();
  });

  it("counts listings per art type from the result headers", async () => {
    const c = await opengameart.census!(fixtureCtx(routes));
    expect(c.byType).toEqual({ model: 4948, texture: 2237, sprite: 16293 });
    expect(c.total).toBe(4948 + 2237 + 16293);
    expect(c.free).toBe(c.total);
  });
});
