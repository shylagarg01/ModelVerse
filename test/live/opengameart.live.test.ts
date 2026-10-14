import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { opengameart } from "../../src/providers/opengameart.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("opengameart (live)", () => {
  it("searches 3D art and resolves a plain-GET download", async () => {
    const r = await opengameart.search({ query: "tree", types: ["model"], limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    expect(r.assets[0]).toMatchObject({ provider: "opengameart", type: "model" });

    const d = await opengameart.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d!.license).toBeDefined();
    expect(d!.files.length).toBeGreaterThan(0);
    const res = await ctx.fetch.raw(d!.files[0]!.url, { method: "HEAD" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).not.toMatch(/text\/html/);
  });

  it("counts the catalogue", async () => {
    const c = await opengameart.census!(ctx);
    expect(c.total).toBeGreaterThan(0);
    expect(c.byType.model).toBeGreaterThan(0);
  });
});
