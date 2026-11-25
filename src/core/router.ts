import type { AssetType, Provider } from "./types.js";
import type { InterpretedPrompt } from "../ai/prompt-interpreter.js";

export interface ProviderRoutePlan {
  all: Provider[];
  fast: Provider[];
  slow: Provider[];
  inferredTypes: AssetType[];
  isBroad: boolean;
}

/**
 * Fast providers have low network latency or reliable API endpoints.
 * Slow providers are web scrapers or high-latency mirror repositories.
 */
export const FAST_PROVIDER_IDS = new Set<string>([
  "polyhaven",
  "ambientcg",
  "cgbookcase",
  "blenderkit",
  "polyfork",
  "threedassets",
  "threedtextures",
  "freestylized",
  "hdrmaps",
  "fab",
  "poliigon",
  "turbosquid",
]);

export const SLOW_PROVIDER_IDS = new Set<string>([
  "sharetextures",
  "kenney",
  "quaternius",
  "texturecan",
  "opengameart",
  "texturescom",
  "hdrihub",
  "cgtrader",
  "itchio",
  "sketchfab",
  "threedtexel",
]);

export interface ProviderTimeouts {
  fastMs: number;
  slowMs: number;
}

export const DEFAULT_TIMEOUTS: ProviderTimeouts = {
  fastMs: 3_500,
  slowMs: 5_500,
};

/**
 * Infer target asset types from raw query text and interpreted prompt intent.
 */
export function inferTargetAssetTypes(
  query: string,
  intent?: InterpretedPrompt,
  explicitTypes?: AssetType[],
): AssetType[] {
  if (explicitTypes && explicitTypes.length > 0) {
    return explicitTypes;
  }

  const types = new Set<AssetType>();
  const lower = query.toLowerCase();

  // 1. HDRI detection
  if (
    /\b(?:hdri|hdris|panorama|panoramas|sky|skies|skydome|studio lighting|sunset hdri|night sky|envmap)\b/i.test(lower) ||
    intent?.assetType === "hdri" ||
    intent?.category === "hdri"
  ) {
    types.add("hdri");
  }

  // 2. Texture & Material detection
  if (
    /\b(?:texture|textures|material|materials|pbr|floor|flooring|wood|wooden|brick|bricks|marble|concrete|tile|tiles|fabric|leather|stone|surface|seamless|albedo|roughness|normal map)\b/i.test(lower) ||
    intent?.assetType === "texture" ||
    intent?.assetType === "material" ||
    intent?.category === "texture" ||
    intent?.category === "material"
  ) {
    types.add("material");
    types.add("texture");
  }

  // 3. 3D Model detection
  if (
    /\b(?:model|models|3d model|mesh|tree|trees|chair|chairs|sofa|sofas|table|furniture|car|cars|vehicle|character|avatar|robot|weapon|sword|gun|shield|prop|building|house|low-poly|lowpoly|polygon|gltf|fbx|obj|blend)\b/i.test(lower) ||
    intent?.assetType === "model" ||
    intent?.assetType === "3d-model" ||
    intent?.objectType
  ) {
    types.add("model");
  }

  // 4. Game assets, sprites, audio, UI
  if (
    /\b(?:sprite|sprites|pixel art|ui kit|ui|hud|sound|audio|sfx|music|font|game pack|dungeon|sci-fi pack)\b/i.test(lower) ||
    intent?.assetType === "game-asset"
  ) {
    types.add("sprite");
    types.add("ui");
    types.add("audio");
    types.add("pack");
  }

  return Array.from(types);
}

/**
 * Intelligently routes search queries to the most relevant providers.
 * - Respects explicit provider and type filters.
 * - Targets specialized providers according to asset category.
 * - Divides chosen providers into fast and slow pools for concurrent execution.
 * - Falls back to broader provider selection for ambiguous queries.
 */
export function routeProviders(
  allProviders: Provider[],
  opts: {
    query: string;
    intent?: InterpretedPrompt;
    explicitTypes?: AssetType[];
    explicitProviders?: string[];
    freeOnly?: boolean;
    downloadableOnly?: boolean;
  },
): ProviderRoutePlan {
  // 1. If explicit providers requested by caller, strictly route to them
  if (opts.explicitProviders && opts.explicitProviders.length > 0) {
    const wanted = new Set(opts.explicitProviders);
    const selected = allProviders.filter((p) => wanted.has(p.id));
    const fast = selected.filter((p) => FAST_PROVIDER_IDS.has(p.id));
    const slow = selected.filter((p) => !FAST_PROVIDER_IDS.has(p.id));
    return {
      all: selected,
      fast,
      slow,
      inferredTypes: opts.explicitTypes ?? [],
      isBroad: false,
    };
  }

  // 2. Infer target asset types
  const inferredTypes = inferTargetAssetTypes(opts.query, opts.intent, opts.explicitTypes);
  const isBroad = inferredTypes.length === 0;

  // 3. Filter providers matching capabilities
  const eligible = allProviders.filter((p) => {
    if (p.isEnabled && !p.isEnabled()) return false;
    if (opts.downloadableOnly && !p.supportsDownload) return false;
    if (opts.freeOnly && p.pricing === "paid") return false;
    if (opts.explicitTypes && opts.explicitTypes.length > 0) {
      if (!opts.explicitTypes.some((t) => p.assetTypes.includes(t))) return false;
    }
    return true;
  });

  // 4. Targeted provider selection based on query semantics
  let selected: Provider[];

  if (isBroad) {
    // Ambiguous query: search all eligible providers
    selected = eligible;
  } else {
    // Relevant provider selection
    selected = eligible.filter((p) => {
      // Must support at least one of the inferred types
      return inferredTypes.some((t) => p.assetTypes.includes(t));
    });

    // Ensure we have a healthy pool of providers (at least 3 if available)
    if (selected.length < 3) {
      selected = eligible;
    }
  }

  const fast = selected.filter((p) => FAST_PROVIDER_IDS.has(p.id));
  const slow = selected.filter((p) => !FAST_PROVIDER_IDS.has(p.id));

  return {
    all: selected,
    fast,
    slow,
    inferredTypes,
    isBroad,
  };
}
