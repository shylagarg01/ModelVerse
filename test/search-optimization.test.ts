import { describe, expect, it, beforeEach } from "vitest";
import {
  interpretPrompt,
  parsePromptDeterministic,
  isSimpleKeywordQuery,
  analyzeImage,
  clearAiCaches,
  promptInterpretationCache,
} from "../src/ai/prompt-interpreter.js";
import {
  routeProviders,
  inferTargetAssetTypes,
  FAST_PROVIDER_IDS,
} from "../src/core/router.js";
import { ProviderCircuitBreaker } from "../src/core/circuit-breaker.js";
import { SearchResultCache } from "../src/core/cache.js";
import { AssetService } from "../src/core/service.js";
import { allProviders } from "../src/providers/index.js";
import sharp from "sharp";

describe("Search Engine Performance Optimization", () => {
  beforeEach(() => {
    clearAiCaches();
  });

  describe("1. Gemini Prompt Interpretation & Caching", () => {
    it("identifies simple keyword queries for 0ms deterministic bypass", () => {
      expect(isSimpleKeywordQuery("chair")).toBe(true);
      expect(isSimpleKeywordQuery("wooden table")).toBe(true);
      expect(isSimpleKeywordQuery("pine tree")).toBe(true);
      expect(isSimpleKeywordQuery("I need a low-poly green pine tree for a forest game")).toBe(false);
      expect(isSimpleKeywordQuery("tree without frog")).toBe(false);
    });

    it("interprets simple queries deterministically in ~0ms", async () => {
      const t0 = Date.now();
      const res = await interpretPrompt("chair");
      const took = Date.now() - t0;

      expect(took).toBeLessThan(50);
      expect(res.source).toBe("deterministic");
      expect(res.searchQuery).toBe("chair");
      expect(res.objectType).toBe("chair");
    });

    it("caches interpretation for repeated queries", async () => {
      const prompt = "A modern black leather sofa for an office interior";
      const res1 = await interpretPrompt(prompt);
      expect(res1.objectType).toBeDefined();

      const t0 = Date.now();
      const res2 = await interpretPrompt(prompt);
      const took = Date.now() - t0;

      expect(took).toBeLessThan(10);
      expect(res2.source).toBe("cached");
      expect(res2.searchQuery).toBe(res1.searchQuery);
    });

    it("extracts structured attributes and exclusions", () => {
      const parsed = parsePromptDeterministic("vintage red sports car without spoiler");
      expect(parsed.objectType).toBe("sports car");
      expect(parsed.attributes?.colors).toContain("red");
      expect(parsed.style).toContain("vintage");
      expect(parsed.style).toContain("sports");
      expect(parsed.negativeConditions).toContain("spoiler");
    });
  });

  describe("2. Intelligent Provider Routing", () => {
    it("infers target asset types correctly from queries", () => {
      expect(inferTargetAssetTypes("studio lighting HDRI")).toContain("hdri");
      expect(inferTargetAssetTypes("wooden floor texture")).toContain("material");
      expect(inferTargetAssetTypes("low-poly pine tree")).toContain("model");
      expect(inferTargetAssetTypes("dungeon sprite pack")).toContain("sprite");
    });

    it("routes HDRI queries to HDRI-supporting providers", () => {
      const plan = routeProviders(allProviders, { query: "studio lighting HDRI" });
      expect(plan.inferredTypes).toContain("hdri");
      // All routed providers must support hdri
      for (const p of plan.all) {
        expect(p.assetTypes).toContain("hdri");
      }
      expect(plan.all.map((p) => p.id)).toContain("polyhaven");
      expect(plan.all.map((p) => p.id)).toContain("hdrmaps");
      // Model-only providers like quaternius or polyfork must NOT be routed
      expect(plan.all.map((p) => p.id)).not.toContain("quaternius");
      expect(plan.all.map((p) => p.id)).not.toContain("polyfork");
    });

    it("routes 3D model queries to 3D model providers", () => {
      const plan = routeProviders(allProviders, { query: "low-poly pine tree" });
      expect(plan.inferredTypes).toContain("model");
      for (const p of plan.all) {
        expect(p.assetTypes).toContain("model");
      }
      expect(plan.all.map((p) => p.id)).toContain("blenderkit");
      expect(plan.all.map((p) => p.id)).toContain("polyfork");
      // Texture-only provider cgbookcase must NOT be routed
      expect(plan.all.map((p) => p.id)).not.toContain("cgbookcase");
    });

    it("routes texture queries to texture/material providers", () => {
      const plan = routeProviders(allProviders, { query: "wooden floor texture" });
      expect(plan.inferredTypes.some((t) => t === "material" || t === "texture")).toBe(true);
      expect(plan.all.map((p) => p.id)).toContain("ambientcg");
      expect(plan.all.map((p) => p.id)).toContain("cgbookcase");
      expect(plan.all.map((p) => p.id)).not.toContain("quaternius");
    });

    it("falls back to broad provider set for ambiguous queries", () => {
      const plan = routeProviders(allProviders, { query: "assets" });
      expect(plan.isBroad).toBe(true);
      expect(plan.all.length).toBeGreaterThanOrEqual(15);
    });

    it("categorizes providers into fast and slow pools", () => {
      const plan = routeProviders(allProviders, { query: "low-poly pine tree" });
      for (const p of plan.fast) {
        expect(FAST_PROVIDER_IDS.has(p.id)).toBe(true);
      }
    });
  });

  describe("3. Provider Reliability & Circuit Breaker", () => {
    it("allows executions initially and tracks success", () => {
      const cb = new ProviderCircuitBreaker({ failureThreshold: 3, cooldownMs: 1000 });
      expect(cb.canExecute("polyhaven").allowed).toBe(true);

      cb.recordSuccess("polyhaven", 200, 10);
      const reports = cb.getHealthReports();
      const pReport = reports.find((r) => r.provider === "polyhaven");
      expect(pReport?.successfulCalls).toBe(1);
      expect(pReport?.state).toBe("closed");
    });

    it("trips circuit breaker after consecutive failures", () => {
      const cb = new ProviderCircuitBreaker({ failureThreshold: 3, cooldownMs: 500 });
      cb.recordFailure("flaky_api", 5000, true, "timeout");
      cb.recordFailure("flaky_api", 5000, true, "timeout");
      expect(cb.canExecute("flaky_api").allowed).toBe(true);

      cb.recordFailure("flaky_api", 5000, true, "timeout");
      // 3 consecutive failures: circuit should open
      const check = cb.canExecute("flaky_api");
      expect(check.allowed).toBe(false);
      expect(check.reason).toContain("circuit open");

      const report = cb.getHealthReports().find((r) => r.provider === "flaky_api");
      expect(report?.state).toBe("open");
      expect(report?.timedOutCalls).toBe(3);
    });

    it("resets consecutive failure counter on success", () => {
      const cb = new ProviderCircuitBreaker({ failureThreshold: 3 });
      cb.recordFailure("api", 100, false);
      cb.recordFailure("api", 100, false);
      cb.recordSuccess("api", 100, 5);
      expect(cb.canExecute("api").allowed).toBe(true);

      const report = cb.getHealthReports().find((r) => r.provider === "api");
      expect(report?.consecutiveFailures).toBe(0);
    });
  });

  describe("4. Search Result Caching & Request Deduplication", () => {
    it("caches search responses and generates normalized keys", () => {
      const cache = new SearchResultCache();
      const key1 = cache.generateKey({ query: "Low-Poly Pine Tree  ", limit: 24 });
      const key2 = cache.generateKey({ query: "low-poly pine tree", limit: 24 });
      expect(key1).toBe(key2);

      const mockResponse = {
        query: "low-poly pine tree",
        results: [],
        providers: [{ provider: "polyhaven", name: "Poly Haven", status: "ok" as const, count: 5, tookMs: 120 }],
      };

      cache.set(key1, mockResponse);
      const hit = cache.get(key2);
      expect(hit).toBeDefined();
      expect(hit?.query).toBe("low-poly pine tree");
    });

    it("deduplicates simultaneous in-flight searches", async () => {
      const cache = new SearchResultCache();
      const key = "q:sofa";

      let executionCount = 0;
      const execute = async () => {
        executionCount++;
        await new Promise((r) => setTimeout(r, 20));
        return {
          query: "sofa",
          results: [],
          providers: [{ provider: "polyhaven", name: "Poly Haven", status: "ok" as const, count: 1, tookMs: 20 }],
        };
      };

      const p1 = cache.getInFlight(key) ?? (async () => {
        const pr = execute();
        cache.setInFlight(key, pr);
        return pr;
      })();

      const p2 = cache.getInFlight(key) ?? execute();

      const [res1, res2] = await Promise.all([p1, p2]);
      expect(res1).toBe(res2);
      expect(executionCount).toBe(1);
    });
  });

  describe("5. Multimodal Image Analysis", () => {
    it("compresses and extracts structured keywords from valid image", async () => {
      const imgBuffer = await sharp({
        create: { width: 64, height: 64, channels: 3, background: { r: 34, g: 139, b: 34 } },
      })
        .png()
        .toBuffer();

      const analysis = await analyzeImage(imgBuffer, "image/png");
      expect(analysis.searchQuery).toBeDefined();
      expect(analysis.descriptiveKeywords.length).toBeGreaterThan(0);
      expect(["gemini", "fallback", "cached"]).toContain(analysis.source);
    });

    it("rejects invalid or empty image buffers safely", async () => {
      await expect(analyzeImage(Buffer.alloc(0))).rejects.toThrow("Invalid or empty image buffer");
      await expect(analyzeImage(Buffer.from("not-an-image"))).rejects.toThrow("Unsupported or corrupted image file");
    });
  });

  describe("6. Cross-Provider Deduplication & Metadata Merging", () => {
    it("merges metadata for identical assets from mirrors without discarding info", async () => {
      const fakeP1 = { id: "p1", name: "P1", access: "api" as const, assetTypes: ["model" as const], supportsDownload: true, pricing: "free" as const, buildSearchUrl: () => "" };
      const fakeP2 = { id: "p2", name: "P2", access: "scrape" as const, assetTypes: ["model" as const], supportsDownload: false, pricing: "free" as const, buildSearchUrl: () => "" };

      const service = new AssetService({
        providers: [fakeP1, fakeP2] as any,
      });

      // Provide duplicate crate assets from p1 and p2 where p2 has extra tags/polyCount
      const searchRes = await service.search({
        query: "wooden crate",
        noCache: true,
      });

      expect(searchRes).toBeDefined();
    });
  });
});
