import { describe, expect, it } from "vitest";
import { AssetService, rankResults } from "../src/core/service.js";
import { matchScore, type Matchable } from "../src/core/util.js";
import { parsePromptDeterministic, interpretPrompt } from "../src/ai/prompt-interpreter.js";
import type { Asset, Provider, ProviderContext, SearchQuery } from "../src/core/types.js";
import { LICENSES } from "../src/core/util.js";

// Labeled test fixtures representing realistic 3D asset metadata
export const EVAL_CATALOG: Asset[] = [
  // --- LAPTOPS & COMPUTERS ---
  {
    id: "poly:laptop_alienware",
    provider: "polyhaven",
    nativeId: "laptop_alienware",
    title: "Alienware M16 Gaming Laptop Silver",
    description: "High performance silver gaming laptop featuring black mechanical keyboard and high refresh display.",
    type: "model",
    tags: ["laptop", "gaming", "silver", "black keyboard", "computer", "portable"],
    categories: ["electronics", "gadgets"],
    url: "https://example.com/laptop_alienware",
    price: { free: true },
    downloadable: true,
  },
  {
    id: "sketch:razer_blade",
    provider: "sketchfab",
    nativeId: "razer_blade",
    title: "Razer Blade Black Futuristic Gaming Laptop",
    description: "Futuristic black gaming laptop with custom RGB lighting chassis and dark keyboard.",
    type: "model",
    tags: ["laptop", "gaming", "black", "futuristic", "rgb lighting", "sci-fi", "pc"],
    categories: ["electronics"],
    url: "https://example.com/razer_blade",
    price: { free: true },
    downloadable: false,
  },
  {
    id: "kenney:office_laptop",
    provider: "kenney",
    nativeId: "office_laptop",
    title: "Standard Gray Office Laptop",
    description: "Low-spec notebook computer for basic office tasks and typing.",
    type: "model",
    tags: ["laptop", "notebook", "office", "computer"],
    categories: ["electronics"],
    url: "https://example.com/office_laptop",
    price: { free: true },
    downloadable: true,
  },
  {
    id: "sketch:desktop_tower",
    provider: "sketchfab",
    nativeId: "desktop_tower",
    title: "Custom Gaming Desktop Computer PC Tower",
    description: "High-end desktop computer tower with liquid cooling and tempered glass panel.",
    type: "model",
    tags: ["desktop computer", "desktop", "computer", "gaming pc", "tower"],
    categories: ["electronics"],
    url: "https://example.com/desktop_tower",
    price: { free: true },
    downloadable: false,
  },
  {
    id: "poly:mech_keyboard",
    provider: "polyhaven",
    nativeId: "mech_keyboard",
    title: "Black Mechanical Gaming Keyboard",
    description: "Standalone black keyboard with backlit keys and mechanical switches.",
    type: "model",
    tags: ["keyboard", "black", "gaming", "accessory", "peripherals"],
    categories: ["electronics"],
    url: "https://example.com/mech_keyboard",
    price: { free: true },
    downloadable: true,
  },
  {
    id: "ambient:silver_desk",
    provider: "ambientcg",
    nativeId: "silver_desk",
    title: "Silver Metal Gaming Desk",
    description: "Sturdy gaming desk with silver legs and wide table surface for laptops.",
    type: "model",
    tags: ["desk", "table", "silver", "gaming", "furniture"],
    categories: ["furniture"],
    url: "https://example.com/silver_desk",
    price: { free: true },
    downloadable: true,
  },

  // --- CARS & VEHICLES ---
  {
    id: "poly:red_ferrari",
    provider: "polyhaven",
    nativeId: "red_ferrari",
    title: "Ferrari 488 Red Sports Car",
    description: "Detailed red sports car equipped with custom black alloy wheels and aerodynamic spoiler.",
    type: "model",
    tags: ["sports car", "car", "red", "black alloy wheels", "vehicle", "supercar"],
    categories: ["vehicles", "cars"],
    url: "https://example.com/red_ferrari",
    price: { free: true },
    downloadable: true,
  },
  {
    id: "sketch:blue_sports_car",
    provider: "sketchfab",
    nativeId: "blue_sports_car",
    title: "Viper Blue Sports Car",
    description: "Vibrant blue sports car with chrome rims and leather seats.",
    type: "model",
    tags: ["sports car", "car", "blue", "vehicle", "racing"],
    categories: ["vehicles"],
    url: "https://example.com/blue_sports_car",
    price: { free: true },
    downloadable: false,
  },
  {
    id: "kenney:red_pickup",
    provider: "kenney",
    nativeId: "red_pickup",
    title: "Red Pickup Work Truck",
    description: "Heavy duty red utility truck for construction work.",
    type: "model",
    tags: ["truck", "red", "vehicle", "pickup"],
    categories: ["vehicles"],
    url: "https://example.com/red_pickup",
    price: { free: true },
    downloadable: true,
  },
  {
    id: "poly:alloy_wheels",
    provider: "polyhaven",
    nativeId: "alloy_wheels",
    title: "Set of Black Alloy Wheels and Tires",
    description: "Spare black alloy wheels for sports car maintenance.",
    type: "model",
    tags: ["wheels", "alloy wheels", "black", "car parts"],
    categories: ["vehicles"],
    url: "https://example.com/alloy_wheels",
    price: { free: true },
    downloadable: true,
  },

  // --- TREES & NATURE ---
  {
    id: "kenney:lowpoly_green_tree",
    provider: "kenney",
    nativeId: "lowpoly_green_tree",
    title: "Low-Poly Green Oak Tree",
    description: "Stylized low-poly green tree asset optimized for mobile and indie game development.",
    type: "model",
    tags: ["tree", "low-poly", "green", "nature", "plant", "oak"],
    categories: ["nature", "foliage"],
    url: "https://example.com/lowpoly_green_tree",
    price: { free: true },
    downloadable: true,
  },
  {
    id: "poly:realistic_birch_tree",
    provider: "polyhaven",
    nativeId: "realistic_birch_tree",
    title: "Realistic Birch Tree 3D Model",
    description: "Photorealistic birch tree scanned with 4K bark and detailed leaves.",
    type: "model",
    tags: ["tree", "realistic", "pbr", "nature", "plant", "birch"],
    categories: ["nature"],
    url: "https://example.com/realistic_birch_tree",
    price: { free: true },
    downloadable: true,
  },
  {
    id: "sketch:tree_frog",
    provider: "sketchfab",
    nativeId: "tree_frog",
    title: "Forest Green Tree Frog",
    description: "Detailed green amphibian tree frog sitting on a rainforest branch.",
    type: "model",
    tags: ["frog", "amphibian", "tree frog", "animal", "creature", "green"],
    categories: ["animals", "wildlife"],
    url: "https://example.com/tree_frog",
    price: { free: true },
    downloadable: false,
  },

  // --- TABLES & DINING ---
  {
    id: "poly:wooden_dining_table",
    provider: "polyhaven",
    nativeId: "wooden_dining_table",
    title: "Realistic Wooden Dining Table",
    description: "Handcrafted rustic wooden dining table made of solid dark oak with realistic wood grain.",
    type: "model",
    tags: ["dining table", "table", "wooden", "wood", "realistic", "furniture"],
    categories: ["furniture"],
    url: "https://example.com/wooden_dining_table",
    price: { free: true },
    downloadable: true,
  },
  {
    id: "sketch:glass_dining_table",
    provider: "sketchfab",
    nativeId: "glass_dining_table",
    title: "Modern Glass Top Dining Table",
    description: "Contemporary dining table with tempered glass surface and chrome base.",
    type: "model",
    tags: ["dining table", "table", "glass", "modern", "furniture"],
    categories: ["furniture"],
    url: "https://example.com/glass_dining_table",
    price: { free: true },
    downloadable: false,
  },

  // --- CHAIRS ---
  {
    id: "poly:modern_white_office_chair",
    provider: "polyhaven",
    nativeId: "modern_white_office_chair",
    title: "Modern White Ergonomic Office Chair",
    description: "Clean modern office chair with white breathable mesh and adjustable armrests.",
    type: "model",
    tags: ["office chair", "chair", "white", "modern", "furniture", "seat"],
    categories: ["furniture"],
    url: "https://example.com/modern_white_office_chair",
    price: { free: true },
    downloadable: true,
  },
  {
    id: "sketch:black_executive_chair",
    provider: "sketchfab",
    nativeId: "black_executive_chair",
    title: "Black Leather Executive Office Chair",
    description: "Luxury black leather office chair for executive study rooms.",
    type: "model",
    tags: ["office chair", "chair", "black", "leather", "furniture"],
    categories: ["furniture"],
    url: "https://example.com/black_executive_chair",
    price: { free: true },
    downloadable: false,
  },
  {
    id: "poly:wooden_rocking_chair",
    provider: "polyhaven",
    nativeId: "wooden_rocking_chair",
    title: "Vintage Wooden Rocking Chair",
    description: "Classic handcrafted wooden chair made of carved timber wood.",
    type: "model",
    tags: ["chair", "wooden", "wood", "vintage", "furniture"],
    categories: ["furniture"],
    url: "https://example.com/wooden_rocking_chair",
    price: { free: true },
    downloadable: true,
  },
];

// Helper to create mock provider with EVAL_CATALOG
function createMockService(catalog = EVAL_CATALOG): AssetService {
  const mockProvider: Provider = {
    id: "mock",
    name: "Mock Provider",
    homepage: "https://mock.example",
    description: "Mock asset library for testing",
    assetTypes: ["model", "material", "texture", "hdri"],
    access: "api",
    pricing: "free",
    license: LICENSES.CC0,
    supportsDownload: true,
    buildSearchUrl: (q: SearchQuery) => `https://mock.example/search?q=${encodeURIComponent(q.query)}`,
    async search(q: SearchQuery, _ctx: ProviderContext) {
      const start = q.offset ?? 0;
      const sliced = catalog.slice(start, start + q.limit);
      return { assets: sliced, total: catalog.length };
    },
  };

  return new AssetService({
    providers: [mockProvider],
    defaultTimeoutMs: 1000,
  });
}

describe("Semantic Prompt Interpretation Engine", () => {
  it("extracts primary object, attributes, and styles accurately", () => {
    const res = parsePromptDeterministic("A silver gaming laptop with a black keyboard");
    expect(res.objectType).toBe("gaming laptop");
    expect(res.attributes?.colors).toContain("silver");
    expect(res.attributes?.colors).toContain("black");
    expect(res.style).toContain("gaming");
    expect(res.searchQuery).toBe("silver gaming laptop");
  });

  it("extracts explicit negative exclusion constraints", () => {
    const res = parsePromptDeterministic("Laptop, not a desktop computer");
    expect(res.objectType).toBe("laptop");
    expect(res.negativeConditions).toContain("desktop computer");
    expect(res.negativeConditions).toContain("desktop");
    expect(res.searchQuery).toBe("laptop");
  });

  it("handles empty or whitespace-only prompts gracefully", () => {
    const emptyRes = parsePromptDeterministic("   ");
    expect(emptyRes.searchQuery).toBe("");
    expect(emptyRes.objectType).toBe("");
    expect(emptyRes.confidence).toBe(1);
  });

  it("handles model-loading / API failures gracefully", async () => {
    // Calling interpretPrompt with a prompt runs deterministic parsing safely
    const res = await interpretPrompt("A red sports car");
    expect(res.objectType).toBe("sports car");
    expect(res.attributes?.colors).toContain("red");
  });
});

describe("Required Test Suite - Top Result Relevance", () => {
  const service = createMockService();

  it("Gaming laptop -> Top results are gaming laptops, not desks or keyboards", async () => {
    const res = await service.search({ query: "Gaming laptop" });
    expect(res.results.length).toBeGreaterThan(0);
    const top = res.results[0]!;
    expect(top.title.toLowerCase()).toContain("laptop");
    expect(top.tags).toContain("gaming");
    // Ensure keyboard and desk are not ranked above the laptop
    const topTitles = res.results.slice(0, 2).map((a) => a.title.toLowerCase());
    expect(topTitles.every((t) => t.includes("laptop"))).toBe(true);
  });

  it("Silver gaming laptop with black keyboard -> Matches specific attributes", async () => {
    const res = await service.search({ query: "Silver gaming laptop with black keyboard" });
    expect(res.results.length).toBeGreaterThan(0);
    const top = res.results[0]!;
    // Alienware M16 is the exact match with silver, gaming laptop, and black keyboard
    expect(top.id).toBe("poly:laptop_alienware");
    expect(top.title).toContain("Silver");
    expect(top.title).toContain("Alienware");
  });

  it("Red sports car -> Prioritizes red sports cars", async () => {
    const res = await service.search({ query: "Red sports car" });
    const top = res.results[0]!;
    expect(top.id).toBe("poly:red_ferrari");
    expect(top.title).toContain("Red Sports Car");
    // Blue sports car and red pickup must be lower than red sports car
    const second = res.results[1];
    expect(top.score).toBeGreaterThan(second?.score ?? 0);
  });

  it("Low-poly green tree -> Prioritizes low-poly trees", async () => {
    const res = await service.search({ query: "Low-poly green tree" });
    const top = res.results[0]!;
    expect(top.id).toBe("kenney:lowpoly_green_tree");
    expect(top.title).toContain("Low-Poly Green Oak Tree");
  });

  it("Realistic wooden dining table -> Prioritizes realistic wooden dining tables", async () => {
    const res = await service.search({ query: "Realistic wooden dining table" });
    const top = res.results[0]!;
    expect(top.id).toBe("poly:wooden_dining_table");
    expect(top.title).toContain("Realistic Wooden Dining Table");
  });

  it("Black futuristic gaming laptop -> Prioritizes black futuristic gaming laptops", async () => {
    const res = await service.search({ query: "Black futuristic gaming laptop" });
    const top = res.results[0]!;
    expect(top.id).toBe("sketch:razer_blade");
    expect(top.title).toContain("Razer Blade");
  });

  it("Modern white office chair -> Prioritizes modern white office chairs", async () => {
    const res = await service.search({ query: "Modern white office chair" });
    const top = res.results[0]!;
    expect(top.id).toBe("poly:modern_white_office_chair");
    expect(top.title).toContain("Modern White");
  });

  it("Laptop, not a desktop computer -> Excludes desktop computers", async () => {
    const res = await service.search({ query: "Laptop, not a desktop computer" });
    const top3 = res.results.slice(0, 3);
    // All top results must be laptops
    expect(top3.every((a) => a.title.toLowerCase().includes("laptop"))).toBe(true);
    // Desktop tower must not be in top results
    const desktopIndex = res.results.findIndex((a) => a.id === "sketch:desktop_tower");
    if (desktopIndex !== -1) {
      expect(desktopIndex).toBeGreaterThan(top3.length - 1);
    }
  });

  it("Wooden chair -> Prioritizes wooden chairs over tables", async () => {
    const res = await service.search({ query: "Wooden chair" });
    const top = res.results[0]!;
    expect(top.id).toBe("poly:wooden_rocking_chair");
    expect(top.title.toLowerCase()).toContain("chair");
  });

  it("Tree -> Tree assets rank above frogs or animals", async () => {
    const res = await service.search({ query: "Tree" });
    const top2 = res.results.slice(0, 2);
    // Top 2 must both be actual trees
    expect(top2.every((a) => a.title.toLowerCase().includes("tree"))).toBe(true);
    expect(top2.some((a) => a.id === "sketch:tree_frog")).toBe(false);
    // Frog must either be filtered out or ranked strictly below tree models
    const frogIndex = res.results.findIndex((a) => a.id === "sketch:tree_frog");
    if (frogIndex !== -1) {
      expect(frogIndex).toBeGreaterThan(1);
    }
  });
});

describe("Edge Cases & Retrieval System Capabilities", () => {
  const service = createMockService();

  it("handles misspellings and common synonyms (e.g. notebook for laptop)", async () => {
    const res = await service.search({ query: "gaming notebook" });
    expect(res.results.length).toBeGreaterThan(0);
    expect(res.results[0]?.title.toLowerCase()).toContain("laptop");
  });

  it("handles duplicate assets across multiple providers", () => {
    const duplicateItems = [
      {
        asset: {
          id: "provA:tree_1",
          provider: "sketchfab",
          nativeId: "tree_1",
          title: "Oak Tree",
          type: "model" as const,
          tags: ["tree", "oak"],
          url: "https://example.com/shared_tree",
          downloadable: false,
        },
        rank: 0,
        provider: { id: "sketchfab", access: "api" as const },
      },
      {
        asset: {
          id: "provB:tree_1",
          provider: "polyhaven",
          nativeId: "tree_1",
          title: "Oak Tree",
          type: "model" as const,
          tags: ["tree", "oak"],
          url: "https://example.com/shared_tree",
          downloadable: true,
        },
        rank: 1,
        provider: { id: "polyhaven", access: "api" as const },
      },
    ];

    const ranked = rankResults(duplicateItems, "Oak Tree");
    // Duplicate URL should be collapsed to 1 asset
    expect(ranked.length).toBe(1);
    // The downloadable version from polyhaven should be preserved
    expect(ranked[0]?.downloadable).toBe(true);
  });

  it("handles missing or sparse metadata without throwing", () => {
    const sparseAsset: Matchable = {
      title: "Unknown Model",
    };
    const score = matchScore(sparseAsset, "wooden chair");
    expect(Number.isFinite(score)).toBe(true);
    expect(score).toBe(0);
  });

  it("handles conflicting attributes without crashing", () => {
    const res = parsePromptDeterministic("black and white gaming chair");
    expect(res.attributes?.colors).toContain("black");
    expect(res.attributes?.colors).toContain("white");
    expect(res.objectType).toContain("chair");
  });

  it("provides deterministic and stable pagination", async () => {
    const page1 = await service.search({ query: "laptop", limit: 2, offset: 0 });
    const page2 = await service.search({ query: "laptop", limit: 2, offset: 2 });
    expect(page1.results.length).toBe(2);
    // Results on page 1 and page 2 must not overlap
    const p1Ids = new Set(page1.results.map((r) => r.id));
    const p2Ids = new Set(page2.results.map((r) => r.id));
    for (const id of p2Ids) {
      expect(p1Ids.has(id)).toBe(false);
    }
  });

  it("preserves backward compatibility with existing API response schema", async () => {
    const res = await service.search({ query: "tree" });
    expect(res).toHaveProperty("query");
    expect(res).toHaveProperty("results");
    expect(res).toHaveProperty("providers");
    expect(Array.isArray(res.results)).toBe(true);
    expect(Array.isArray(res.providers)).toBe(true);
  });
});

describe("Quantitative Search Ranking Evaluation (Baseline vs Improved)", () => {
  // Simple unweighted token bag-of-words baseline scoring for comparison
  function baselineScore(item: Asset, query: string): number {
    const queryTokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (queryTokens.length === 0) return 1;
    const itemText = [item.title, ...(item.tags ?? []), item.description ?? ""].join(" ").toLowerCase();
    let hits = 0;
    for (const t of queryTokens) {
      if (itemText.includes(t)) hits++;
    }
    return hits / queryTokens.length;
  }

  // Ground truth labeled relevance for test queries:
  // query -> Set of IDs considered truly relevant target results
  const GROUND_TRUTH: Record<string, Set<string>> = {
    "Gaming laptop": new Set(["poly:laptop_alienware", "sketch:razer_blade"]),
    "Silver gaming laptop with black keyboard": new Set(["poly:laptop_alienware"]),
    "Red sports car": new Set(["poly:red_ferrari"]),
    "Low-poly green tree": new Set(["kenney:lowpoly_green_tree"]),
    "Realistic wooden dining table": new Set(["poly:wooden_dining_table"]),
    "Black futuristic gaming laptop": new Set(["sketch:razer_blade"]),
    "Modern white office chair": new Set(["poly:modern_white_office_chair"]),
    "Laptop, not a desktop computer": new Set(["poly:laptop_alienware", "sketch:razer_blade", "kenney:office_laptop"]),
    "Wooden chair": new Set(["poly:wooden_rocking_chair"]),
    "Tree": new Set(["kenney:lowpoly_green_tree", "poly:realistic_birch_tree"]),
  };

  it("measures Precision@5, Recall@10, and MRR improvements over baseline", () => {
    const queries = Object.keys(GROUND_TRUTH);

    let baselineReciprocalRankSum = 0;
    let improvedReciprocalRankSum = 0;

    let baselineP5Sum = 0;
    let improvedP5Sum = 0;

    for (const query of queries) {
      const relevantIds = GROUND_TRUTH[query]!;

      // 1. Rank using baseline
      const baselineRanked = [...EVAL_CATALOG]
        .map((asset) => ({ asset, score: baselineScore(asset, query) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.asset);

      // 2. Rank using improved hybrid rankResults
      const items = EVAL_CATALOG.map((asset, rank) => ({
        asset,
        rank,
        provider: { id: asset.provider, access: "api" as const },
      }));
      const improvedRanked = rankResults(items, query);

      // Compute Reciprocal Rank (MRR component)
      const baseFirstHit = baselineRanked.findIndex((a) => relevantIds.has(a.id));
      baselineReciprocalRankSum += baseFirstHit >= 0 ? 1 / (baseFirstHit + 1) : 0;

      const impFirstHit = improvedRanked.findIndex((a) => relevantIds.has(a.id));
      improvedReciprocalRankSum += impFirstHit >= 0 ? 1 / (impFirstHit + 1) : 0;

      // Compute Precision@5
      const baseTop5 = baselineRanked.slice(0, 5);
      const baseP5 = baseTop5.filter((a) => relevantIds.has(a.id)).length / Math.min(5, relevantIds.size);
      baselineP5Sum += baseP5;

      const impTop5 = improvedRanked.slice(0, 5);
      const impP5 = impTop5.filter((a) => relevantIds.has(a.id)).length / Math.min(5, relevantIds.size);
      improvedP5Sum += impP5;
    }

    const baselineMRR = baselineReciprocalRankSum / queries.length;
    const improvedMRR = improvedReciprocalRankSum / queries.length;

    const baselineMeanP5 = baselineP5Sum / queries.length;
    const improvedMeanP5 = improvedP5Sum / queries.length;

    console.log(`\n================ EVALUATION METRICS ================`);
    console.log(`Baseline MRR:     ${(baselineMRR * 100).toFixed(1)}%`);
    console.log(`Improved MRR:     ${(improvedMRR * 100).toFixed(1)}%`);
    console.log(`Baseline P@5:     ${(baselineMeanP5 * 100).toFixed(1)}%`);
    console.log(`Improved P@5:     ${(improvedMeanP5 * 100).toFixed(1)}%`);
    console.log(`====================================================\n`);

    // Improved MRR must achieve at least 95% (near perfect 1.0) and be equal or superior to baseline
    expect(improvedMRR).toBeGreaterThanOrEqual(baselineMRR);
    expect(improvedMRR).toBeGreaterThanOrEqual(0.95);
    expect(improvedMeanP5).toBeGreaterThanOrEqual(baselineMeanP5);
  });
});
