import type { Asset, AssetType, License, SearchQuery } from "./types.js";

export const LICENSES = {
  CC0: {
    name: "CC0",
    url: "https://creativecommons.org/publicdomain/zero/1.0/",
    commercialUse: true,
    attributionRequired: false,
  },
  CC_BY_4: {
    name: "CC-BY-4.0",
    url: "https://creativecommons.org/licenses/by/4.0/",
    commercialUse: true,
    attributionRequired: true,
  },
} satisfies Record<string, License>;

export function assetId(provider: string, nativeId: string): string {
  return `${provider}:${nativeId}`;
}

/** Split `provider:nativeId` (nativeId may itself contain colons). */
export function parseAssetId(id: string): { provider: string; nativeId: string } | null {
  const i = id.indexOf(":");
  if (i <= 0 || i === id.length - 1) return null;
  return { provider: id.slice(0, i), nativeId: id.slice(i + 1) };
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t.length > 0);
}

/** Crude singularisation so "trees" matches "tree" and "boxes" matches "box". */
export function stem(token: string): string {
  if (token.length > 4 && token.endsWith("ies")) return token.slice(0, -3) + "y";
  if (token.length > 4 && /(ses|xes|zes|ches|shes)$/.test(token)) return token.slice(0, -2);
  if (token.length > 3 && token.endsWith("s") && !token.endsWith("ss")) return token.slice(0, -1);
  return token;
}

export interface Matchable {
  title: string;
  tags?: string[];
  categories?: string[];
  description?: string;
}

/**
 * Score how well an item matches a free-text query, 0..1.
 * Title hits weigh most, then tags/categories, then description.
 * Returns 1 for an empty query so browse results are kept.
 */


import { parsePromptDeterministic, type InterpretedPrompt } from "../ai/prompt-interpreter.js";

const SEARCH_STOP_WORDS = new Set([
  "a", "an", "the", "for", "of", "with", "and", "or",
  "in", "on", "to", "me", "please", "show", "find",
  "get", "some", "looking", "want", "need", "give",
  "model", "models", "asset", "assets", "3d", "render",
]);

const ANIMAL_TERMS = new Set([
  "animal", "frog", "mammal", "bird", "reptile",
  "fish", "insect", "wildlife", "dog", "cat",
  "snake", "turtle", "amphibian",
]);

const INCOMPATIBLE_CATEGORIES: [Set<string>, Set<string>][] = [
  // Laptops vs Desktops / Furniture / Chairs / Tables
  [new Set(["laptop", "notebook"]), new Set(["desktop", "table", "chair", "sofa", "bed", "furniture", "building", "vehicle", "car", "plant", "tree"])],
  // Chairs vs Tables / Vehicles
  [new Set(["chair", "seat", "stool", "armchair"]), new Set(["table", "desk", "car", "vehicle", "laptop", "tree"])],
  // Tables vs Chairs / Vehicles / Computers
  [new Set(["table", "desk"]), new Set(["chair", "car", "vehicle", "laptop", "tree", "animal"])],
  // Cars vs Trees / Animals / Furniture / Computers
  [new Set(["car", "automobile", "vehicle", "supercar"]), new Set(["tree", "plant", "animal", "chair", "table", "laptop", "furniture"])],
  // Trees vs Animals / Vehicles / Computers / Furniture
  [new Set(["tree", "plant", "flora", "vegetation"]), new Set(["animal", "frog", "car", "vehicle", "laptop", "table", "chair", "furniture"])],
];

export function matchScore(item: Matchable, queryOrIntent: string | InterpretedPrompt): number {
  const isIntent = typeof queryOrIntent === "object" && queryOrIntent !== null && "objectType" in queryOrIntent;
  const rawQuery = isIntent
    ? (queryOrIntent as InterpretedPrompt).rawPrompt || (queryOrIntent as InterpretedPrompt).searchQuery || (queryOrIntent as InterpretedPrompt).objectType
    : (queryOrIntent as string);

  if (!rawQuery.trim() && !isIntent) return 1;

  const intent: InterpretedPrompt = isIntent
    ? (queryOrIntent as InterpretedPrompt)
    : parsePromptDeterministic(rawQuery);

  const rawTokens = tokenize(rawQuery)
    .map(stem)
    .filter((t) => !SEARCH_STOP_WORDS.has(t));

  const tokens = [...new Set(rawTokens)];
  if (tokens.length === 0 && !intent.objectType) return 1;

  const titleTokens = tokenize(item.title).map(stem);
  const title = new Set(titleTokens);
  const titleText = item.title.toLowerCase();

  const tagTokens = [...(item.tags ?? []), ...(item.categories ?? [])]
    .flatMap((t) => tokenize(t))
    .map(stem);
  const tags = new Set(tagTokens);

  const descTokens = tokenize(item.description ?? "").map(stem);
  const desc = new Set(descTokens);

  const metadataText = [
    item.title,
    ...(item.tags ?? []),
    ...(item.categories ?? []),
    item.description ?? "",
  ].join(" ").toLowerCase();

  const itemTokens = new Set([...title, ...tags]);
  const itemType = (item as Matchable & { type?: AssetType }).type;

  // 1. Negative conditions / Exclusions check
  const negConditions = intent.negativeConditions ?? [];
  for (const neg of negConditions) {
    const negStemmed = tokenize(neg).map(stem);
    if (negStemmed.length > 0) {
      // If all words of a negative condition appear in title or tags
      const inTitle = negStemmed.every((t) => title.has(t));
      const inTags = negStemmed.every((t) => tags.has(t));
      if (inTitle || inTags) {
        // Severe violation penalty
        return 0.02;
      }
    }
  }

  // Demote animal assets for unrelated searches like "tree"
  const wantsAnimal = tokens.some((t) => ANIMAL_TERMS.has(t)) ||
    (intent.objectType && ANIMAL_TERMS.has(intent.objectType));
  const isAnimal = [...itemTokens].some((t) => ANIMAL_TERMS.has(t));
  if (isAnimal && !wantsAnimal) {
    if (tokens.includes("tree") || intent.objectType === "tree") {
      return 0.05;
    }
  }

  // 2. Primary Object Match
  const primaryObj = intent.objectType.toLowerCase().trim();
  const primaryObjTokens = tokenize(primaryObj).map(stem);
  let primaryScore = 0;

  if (primaryObjTokens.length > 0) {
    // Check exact compound match in title
    if (primaryObj.length > 2 && titleText.includes(primaryObj)) {
      primaryScore = 1.0;
    } else if (primaryObjTokens.every((t) => title.has(t))) {
      primaryScore = 0.95;
    } else if (primaryObjTokens.some((t) => title.has(t))) {
      primaryScore = 0.75;
    } else if (primaryObjTokens.every((t) => tags.has(t))) {
      primaryScore = 0.70;
    } else if (primaryObjTokens.some((t) => tags.has(t))) {
      primaryScore = 0.50;
    } else if (primaryObjTokens.some((t) => desc.has(t))) {
      primaryScore = 0.25;
    } else {
      // Check synonyms
      const syns = intent.keywords.flatMap((k) => tokenize(k)).map(stem);
      if (syns.some((s) => title.has(s))) {
        primaryScore = 0.65;
      } else if (syns.some((s) => tags.has(s))) {
        primaryScore = 0.40;
      }
    }
  } else {
    primaryScore = 1.0;
  }

  // Category mismatch check
  if (primaryScore === 0 && primaryObjTokens.length > 0) {
    // If the asset doesn't match the primary object at all, check if it's an incompatible category
    for (const [targetGroup, incompatibleGroup] of INCOMPATIBLE_CATEGORIES) {
      if (primaryObjTokens.some((t) => targetGroup.has(t))) {
        if ([...itemTokens].some((t) => incompatibleGroup.has(t))) {
          return 0; // Hard rejection for clear category contradiction
        }
      }
    }
  }

  // 3. Token-level baseline overlap
  let tokenHits = 0;
  for (const token of tokens) {
    if (title.has(token)) tokenHits += 1.0;
    else if (tags.has(token)) tokenHits += 0.7;
    else if (desc.has(token)) tokenHits += 0.25;
    else if ([...title].some((w) => token.length >= 4 && w.startsWith(token))) {
      tokenHits += 0.4;
    }
  }
  const tokenRelevance = tokens.length > 0 ? tokenHits / tokens.length : 1;

  // 4. Attribute Verification (Color, Material, Style, Features)
  let attrBonus = 0;
  const colors = intent.attributes?.colors ?? [];
  const materials = intent.attributes?.materials ?? [];
  const styles = intent.style ?? [];
  const features = intent.attributes?.features ?? [];

  // Color check
  for (const col of colors) {
    const colStem = stem(col);
    if (title.has(colStem) || new RegExp(`\\b${col}\\b`, "i").test(titleText)) {
      attrBonus += 0.25;
    } else if (tags.has(colStem)) {
      attrBonus += 0.15;
    } else if (new RegExp(`\\b${col}\\b`, "i").test(metadataText)) {
      attrBonus += 0.08;
    }
  }

  // Check for confirmed color mismatch on primary object
  if (colors.length > 0) {
    const conflictingColors = ["silver", "black", "white", "red", "green", "blue", "yellow", "gold", "orange"].filter((c) => !colors.includes(c));
    for (const cc of conflictingColors) {
      if (title.has(stem(cc)) || new RegExp(`\\b${cc}\\b`, "i").test(titleText)) {
        attrBonus -= 0.15;
        break;
      }
    }
  }

  // Material check
  for (const mat of materials) {
    const matStem = stem(mat);
    if (title.has(matStem) || new RegExp(`\\b${mat}\\b`, "i").test(titleText)) {
      attrBonus += 0.25;
    } else if (tags.has(matStem)) {
      attrBonus += 0.15;
    } else if (new RegExp(`\\b${mat}\\b`, "i").test(metadataText)) {
      attrBonus += 0.08;
    }
  }

  // Style check
  for (const st of styles) {
    const stTokens = tokenize(st).map(stem);
    if (stTokens.every((t) => title.has(t)) || new RegExp(`\\b${st.replace(/[- ]/g, "[- ]?")}\\b`, "i").test(titleText)) {
      attrBonus += 0.20;
    } else if (stTokens.some((t) => tags.has(t)) || new RegExp(`\\b${st.replace(/[- ]/g, "[- ]?")}\\b`, "i").test(metadataText)) {
      attrBonus += 0.12;
    }
  }

  // Features check
  for (const feat of features) {
    const fTokens = tokenize(feat).map(stem).filter((t) => !SEARCH_STOP_WORDS.has(t));
    if (fTokens.length > 0 && fTokens.every((t) => title.has(t) || tags.has(t))) {
      attrBonus += 0.18;
    } else if (fTokens.length > 0 && fTokens.some((t) => tags.has(t) || desc.has(t))) {
      attrBonus += 0.10;
    }
  }

  // 5. Exact Phrase Matching in Title
  let phraseBonus = 0;
  const normalizedTitle = ` ${titleTokens.join(" ")} `;
  const normalizedQuery = ` ${tokens.join(" ")} `;
  if (tokens.length > 1 && normalizedTitle.includes(normalizedQuery)) {
    phraseBonus = 0.30;
  } else if (primaryObjTokens.length > 1 && normalizedTitle.includes(` ${primaryObjTokens.join(" ")} `)) {
    phraseBonus = 0.20;
  }

  // Combine components:
  let relevance = 0;
  if (primaryScore > 0) {
    // Check if title has a direct color conflict with the requested color (e.g. Silver title when Black requested)
    const hasColorConflict = colors.length > 0 &&
      ["silver", "black", "white", "red", "green", "blue", "yellow", "gold", "orange"]
        .filter((c) => !colors.includes(c))
        .some((cc) => title.has(stem(cc)) || new RegExp(`\\b${cc}\\b`, "i").test(titleText));

    if (primaryScore >= 0.95 && tokenRelevance >= 0.95 && !hasColorConflict) {
      // Perfect match on primary object and all requested tokens
      relevance = 1.0;
    } else if (tokens.length > 1) {
      relevance = 0.45 * primaryScore + 0.40 * tokenRelevance + attrBonus + phraseBonus;
      if (hasColorConflict) {
        relevance = Math.min(relevance, 0.65);
      }
    } else {
      relevance = primaryScore;
    }
  } else {
    // No primary object match
    relevance = 0.15 * tokenRelevance;
  }

  // Asset type intent filtering
  const wantsMaterial = /\b(material|materials|paint|shader|pbr|substance)\b/i.test(rawQuery);
  const wantsTexture = /\b(texture|textures|decal|seamless)\b/i.test(rawQuery);
  const wantsModel = /\b(model|models|3d|mesh|vehicle|vehicles|car|cars|tree|trees|character|characters|prop|props|object|objects|chair|chairs|laptop|table)\b/i.test(rawQuery);
  const hasModelIntent = wantsModel && !wantsMaterial && !wantsTexture;

  if (itemType) {
    if (hasModelIntent && (itemType === "material" || itemType === "hdri")) relevance *= 0.2;
    if (hasModelIntent && itemType === "texture") relevance *= 0.3;
    if (wantsMaterial && itemType === "model") relevance *= 0.2;
    if (wantsMaterial && itemType === "other") relevance *= 0.4;
    if (wantsTexture && itemType === "model") relevance *= 0.2;
  }

  return Math.max(0, Math.min(1, relevance));
}



/** Filter + rank a local catalogue (used by providers that fetch a full list). */
export function filterLocal<T extends Matchable & { type: AssetType }>(
  items: T[],
  q: SearchQuery,
  minScore = 0.34,
): T[] {
  const typed = items.filter((i) => typeMatches(i.type, q.types));
  if (!q.query.trim()) return typed;
  return typed
    .map((item) => ({ item, s: matchScore(item, q.query) }))
    .filter((x) => x.s >= minScore)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.item);
}

export function paginate<T>(items: T[], q: SearchQuery): T[] {
  const offset = q.offset ?? 0;
  return items.slice(offset, offset + q.limit);
}

/** Types that users usually mean interchangeably. */
const RELATED_TYPES: Partial<Record<AssetType, AssetType[]>> = {
  texture: ["material"],
  material: ["texture"],
};

/** Does an asset of `type` satisfy the requested `types` filter? */
export function typeMatches(type: AssetType, types?: AssetType[]): boolean {
  if (!types?.length) return true;
  return types.some((t) => t === type || RELATED_TYPES[t]?.includes(type));
}

/** Does the query want any of these types? Used to skip whole catalogue sections. */
export function wantsType(q: SearchQuery, ...types: AssetType[]): boolean {
  return types.some((t) => typeMatches(t, q.types));
}

const TYPE_KEYWORDS: [AssetType, RegExp][] = [
  ["hdri", /\b(hdri|hdr|skybox|sky ?dome|panorama|environment map)\b/i],
  // Strong 3D signals win over "...with textures" in titles like "Low Poly Trees with Textures".
  ["model", /\b(3d|low[- ]?poly|mesh(es)?|glb|gltf|fbx|obj|rigged|models?)\b/i],
  ["material", /\b(material|materials|pbr|substance|sbsar|shader)\b/i],
  ["texture", /\b(texture|textures|seamless|tileable|decal|decals|atlas)\b/i],
  ["audio", /\b(audio|sounds?|sfx|music|soundtrack)\b/i],
  ["font", /\b(fonts?|typeface)\b/i],
  ["ui", /\b(ui|gui|interface|hud|icons?|buttons?)\b/i],
  ["sprite", /\b(sprites?|2d|pixel|tileset|tilemap|tiles)\b/i],
  ["model", /\b(character|characters|props?|blend)\b/i],
];

/** Best-effort asset type from free text (title/tags/category). */
export function inferType(text: string, fallback: AssetType = "other"): AssetType {
  for (const [type, re] of TYPE_KEYWORDS) if (re.test(text)) return type;
  return fallback;
}

const KNOWN_FORMATS = new Set([
  "glb", "gltf", "fbx", "obj", "blend", "usd", "usdz", "usdc", "dae", "stl", "3ds", "max", "c4d", "ma", "mb",
  "png", "jpg", "jpeg", "tif", "tiff", "exr", "hdr", "webp", "tga", "psd",
  "zip", "rar", "7z", "sbsar", "mtlx", "wav", "ogg", "mp3", "ttf", "otf",
]);

export function formatFromFilename(name: string): string {
  const clean = name.split(/[?#]/)[0] ?? name;
  const ext = clean.includes(".") ? clean.slice(clean.lastIndexOf(".") + 1).toLowerCase() : "";
  return ext === "jpeg" ? "jpg" : ext;
}

export function isKnownFormat(ext: string): boolean {
  return KNOWN_FORMATS.has(ext.toLowerCase());
}

export function filenameFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname;
    return decodeURIComponent(p.slice(p.lastIndexOf("/") + 1)) || "download";
  } catch {
    return "download";
  }
}

export function absoluteUrl(href: string | undefined, base: string): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

export function cleanText(s: string | undefined | null): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

export function uniq<T>(xs: Iterable<T>): T[] {
  return [...new Set(xs)];
}

/** Drop undefined keys so JSON output stays compact. */
export function compact<T extends object>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

export function makeAsset(a: Omit<Asset, "id"> & { id?: string }): Asset {
  return compact({ ...a, id: a.id ?? assetId(a.provider, a.nativeId), tags: uniq(a.tags.map((t) => t.toLowerCase())) });
}

export function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== "") sp.set(k, String(v));
  const s = sp.toString();
  return s ? `?${s}` : "";
}
