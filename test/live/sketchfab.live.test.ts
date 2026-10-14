import { describe, expect, it } from "vitest";
import { createHttpClient } from "../../src/core/http.js";
import { sketchfab } from "../../src/providers/sketchfab.js";

const ctx = { fetch: createHttpClient() };

describe.runIf(process.env.LIVE)("sketchfab (live)", () => {
  it("searches CC0 models, resolves one and counts the catalogue", async () => {
    const r = await sketchfab.search({ query: "tree", limit: 3 }, ctx);
    expect(r.assets.length).toBeGreaterThan(0);
    const d = await sketchfab.getAsset!(r.assets[0]!.nativeId, ctx);
    expect(d?.title).toBeTruthy();

    const c = await sketchfab.census!(ctx);
    expect(c.total).toBeGreaterThan(0);
  });
});
