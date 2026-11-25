import { GoogleGenAI } from "@google/genai";
import { LRUCache } from "lru-cache";
import sharp from "sharp";
import { createHash } from "node:crypto";

export interface InterpretedPrompt {
  rawPrompt?: string;
  searchQuery: string;
  keywords: string[];
  objectType: string;
  appearance: string[];
  style: string[];
  requiredConditions?: string[];
  preferredConditions?: string[];
  negativeConditions?: string[];
  attributes?: {
    colors?: string[];
    materials?: string[];
    features?: string[];
    sizes?: string[];
    shapes?: string[];
  };
  assetType?: string;
  category?: string;
  useCase?: string;
  confidence?: number;
  source?: "deterministic" | "gemini" | "hybrid" | "cached";
}

export interface ImageAnalysisResult {
  mainObject: string;
  category: string;
  style: string;
  dominantColors: string[];
  materialCharacteristics: string;
  environmentUseCase: string;
  descriptiveKeywords: string[];
  searchQuery: string;
  assetType: string;
  confidence: number;
  source: "gemini" | "fallback" | "cached";
}

// Predefined taxonomies for 3D asset prompt understanding

const KNOWN_COLORS = new Set([
  "silver", "black", "white", "red", "green", "blue", "yellow", "orange",
  "purple", "pink", "brown", "gray", "grey", "gold", "golden", "bronze",
  "cyan", "magenta", "teal", "beige", "navy", "maroon", "violet", "dark", "light",
]);

const KNOWN_MATERIALS = new Set([
  "wood", "wooden", "timber", "metal", "metallic", "steel", "iron", "aluminum",
  "aluminium", "copper", "brass", "bronze", "gold", "plastic", "glass", "leather",
  "fabric", "cloth", "cotton", "wool", "silk", "velvet", "concrete", "cement",
  "stone", "marble", "granite", "brick", "ceramic", "porcelain", "rubber",
]);

const KNOWN_STYLES = new Map<string, string[]>([
  ["low-poly", ["low-poly", "lowpoly", "low poly", "flat-shaded", "polygon"]],
  ["realistic", ["realistic", "photorealistic", "hyperrealistic", "pbr", "real-world"]],
  ["futuristic", ["futuristic", "sci-fi", "scifi", "science-fiction", "cyberpunk"]],
  ["gaming", ["gaming", "gamer", "rgb"]],
  ["sports", ["sports", "racing", "race", "supercar"]],
  ["modern", ["modern", "contemporary", "minimalist"]],
  ["stylized", ["stylized", "cartoon", "toon", "anime", "hand-painted", "handpainted"]],
  ["vintage", ["vintage", "retro", "classic", "antique", "old"]],
  ["medieval", ["medieval", "fantasy", "gothic"]],
]);

const COMPOUND_OBJECTS = [
  "gaming laptop", "desktop computer", "sports car", "race car", "dining table",
  "coffee table", "office chair", "gaming chair", "dining chair", "rocking chair",
  "desk lamp", "street light", "pine tree", "oak tree", "palm tree", "tree stump",
  "tree trunk", "tree frog", "alloy wheels", "rgb lighting", "sound effects",
  "texture pack", "character model",
];

const SIMPLE_OBJECT_SYNONYMS: Record<string, string[]> = {
  laptop: ["notebook", "portable computer", "laptop computer", "computer"],
  "gaming laptop": ["laptop", "notebook", "gaming pc", "rig"],
  car: ["automobile", "vehicle", "motor vehicle"],
  "sports car": ["supercar", "race car", "hypercar", "sports vehicle", "car"],
  tree: ["plant", "flora", "vegetation", "foliage", "woodland"],
  "dining table": ["dining table", "table", "dinner table", "furniture"],
  "office chair": ["office chair", "desk chair", "task chair", "swivel chair", "chair"],
  chair: ["seat", "armchair", "seating", "furniture"],
  table: ["desk", "surface", "furniture"],
  computer: ["pc", "workstation"],
  "desktop computer": ["desktop pc", "tower pc", "desktop", "workstation"],
  building: ["architecture", "structure", "house"],
  robot: ["android", "cyborg", "automaton", "mech"],
  character: ["person", "human", "avatar", "figure", "npc"],
  crate: ["box", "container"],
  barrel: ["drum", "keg", "cask"],
  sword: ["blade", "weapon"],
  gun: ["firearm", "weapon", "pistol", "rifle"],
  frog: ["amphibian", "toad"],
};

const COMMON_STOP_WORDS = new Set([
  "a", "an", "the", "for", "of", "with", "and", "or", "in", "on", "to",
  "me", "please", "show", "find", "get", "some", "looking", "want", "need",
  "give", "model", "models", "asset", "assets", "3d", "render", "game",
]);

/**
 * Deterministic prompt parser that runs in 0ms, works completely offline,
 * and accurately extracts the search intent.
 */
export function parsePromptDeterministic(rawPrompt: string): InterpretedPrompt {
  const prompt = rawPrompt.trim();
  if (!prompt) {
    return {
      searchQuery: "",
      keywords: [],
      objectType: "",
      appearance: [],
      style: [],
      requiredConditions: [],
      preferredConditions: [],
      negativeConditions: [],
      attributes: { colors: [], materials: [], features: [] },
      confidence: 1,
      source: "deterministic",
    };
  }

  const lower = prompt.toLowerCase();

  // 1. Extract explicit negative exclusions (e.g. "not a desktop computer", "without chair", "except animals")
  const negativeConditions: string[] = [];
  const negativeRegex = /\b(?:not|exclude|excluding|without|except|no)\s+(?:a\s+|an\s+|the\s+)?([a-z0-9\s-]+?)(?=[,.]|\b(?:with|and|but|for|or)\b|$)/gi;
  let negMatch: RegExpExecArray | null;
  while ((negMatch = negativeRegex.exec(lower)) !== null) {
    const rawNeg = negMatch[1]?.trim();
    if (rawNeg && rawNeg.length > 1) {
      negativeConditions.push(rawNeg);
      for (const word of rawNeg.split(/\s+/)) {
        if (word.length > 2 && !COMMON_STOP_WORDS.has(word)) {
          negativeConditions.push(word);
        }
      }
      for (const comp of COMPOUND_OBJECTS) {
        if (rawNeg.includes(comp)) {
          negativeConditions.push(comp);
        }
      }
    }
  }

  // Remove the negative clauses from the text for subsequent positive attribute extraction
  const positiveText = lower.replace(negativeRegex, " ");

  // 2. Extract Styles
  const foundStyles = new Set<string>();
  for (const [canonicalStyle, aliases] of KNOWN_STYLES) {
    for (const alias of aliases) {
      const re = new RegExp(`\\b${alias.replace(/[- ]/g, "[- ]?")}\\b`, "i");
      if (re.test(positiveText)) {
        foundStyles.add(canonicalStyle);
        break;
      }
    }
  }

  // 3. Extract Colors
  const foundColors = new Set<string>();
  for (const color of KNOWN_COLORS) {
    const re = new RegExp(`\\b${color}\\b`, "i");
    if (re.test(positiveText)) {
      foundColors.add(color);
    }
  }

  // 4. Extract Materials
  const foundMaterials = new Set<string>();
  for (const mat of KNOWN_MATERIALS) {
    const re = new RegExp(`\\b${mat}\\b`, "i");
    if (re.test(positiveText)) {
      foundMaterials.add(mat);
    }
  }

  // 5. Extract Features / Parts
  const foundFeatures = new Set<string>();
  const featurePatterns = [
    /\b(?:with\s+)?([a-z]+(?:\s+[a-z]+)?\s+(?:keyboard|wheels|lighting|cushion|drawers|display|monitor|arms|armrests|spoiler|pedals|rims|engine))\b/gi,
    /\b(rgb(?:\s+lighting)?)\b/gi,
    /\b(alloy\s+wheels)\b/gi,
  ];
  for (const pattern of featurePatterns) {
    let fMatch: RegExpExecArray | null;
    while ((fMatch = pattern.exec(positiveText)) !== null) {
      let f = fMatch[1]?.trim();
      if (f) {
        const featureStr = f.replace(/^(?:with\s+|a\s+|an\s+|the\s+)+/i, "").trim();
        if (featureStr && !negativeConditions.some((n) => featureStr.includes(n))) {
          foundFeatures.add(featureStr);
        }
      }
    }
  }

  // 6. Identify Primary Object
  // First check compound objects
  let primaryObject = "";
  for (const comp of COMPOUND_OBJECTS) {
    if (negativeConditions.some((neg) => neg.includes(comp))) continue;
    const re = new RegExp(`\\b${comp.replace(/[- ]/g, "[- ]?")}\\b`, "i");
    if (re.test(positiveText)) {
      primaryObject = comp;
      break;
    }
  }

  // If no compound object found, check known simple objects
  if (!primaryObject) {
    for (const obj of Object.keys(SIMPLE_OBJECT_SYNONYMS)) {
      if (negativeConditions.some((neg) => neg.includes(obj))) continue;
      const re = new RegExp(`\\b${obj}s?\\b`, "i");
      if (re.test(positiveText)) {
        primaryObject = obj;
        break;
      }
    }
  }

  // If still not identified, derive from token heuristic
  if (!primaryObject) {
    const words = positiveText
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !COMMON_STOP_WORDS.has(w) && !foundColors.has(w) && !foundMaterials.has(w) && ![...foundStyles].includes(w));
    if (words.length > 0) {
      primaryObject = words[words.length - 1]!;
    } else {
      primaryObject = prompt.split(/\s+/)[0] ?? prompt;
    }
  }

  // In tree searches, explicitly ensure frog/animal is negative unless specifically requested
  if (primaryObject === "tree" && !positiveText.includes("frog") && !positiveText.includes("animal")) {
    if (!negativeConditions.includes("frog")) negativeConditions.push("frog");
    if (!negativeConditions.includes("animal")) negativeConditions.push("animal");
  }

  // Build targeted provider searchQuery
  // Keep it concise: style (if essential like "low-poly" or "gaming") + primary object, or color + primary object
  let searchQuery = primaryObject;
  const keyStyles = ["low-poly", "gaming", "sports", "futuristic", "realistic", "modern"].filter((s) => foundStyles.has(s));
  const keyColors = [...foundColors];
  const keyMaterials = [...foundMaterials];

  if (keyStyles.includes("gaming") && !searchQuery.includes("gaming")) {
    searchQuery = `gaming ${searchQuery}`;
  } else if (keyStyles.includes("sports") && !searchQuery.includes("sports")) {
    searchQuery = `sports ${searchQuery}`;
  } else if (keyStyles.includes("low-poly") && !searchQuery.includes("low-poly")) {
    searchQuery = `low-poly ${searchQuery}`;
  } else if (keyMaterials.includes("wooden") && !searchQuery.includes("wooden")) {
    searchQuery = `wooden ${searchQuery}`;
  } else if (keyColors.includes("red") && !searchQuery.includes("red") && primaryObject.includes("car")) {
    searchQuery = `red ${searchQuery}`;
  } else if (keyColors.includes("silver") && !searchQuery.includes("silver") && primaryObject.includes("laptop")) {
    searchQuery = `silver ${searchQuery}`;
  } else if (keyStyles.includes("modern") && !searchQuery.includes("modern") && primaryObject.includes("chair")) {
    searchQuery = `modern ${searchQuery}`;
  }

  // Keywords and synonyms
  const synonyms = SIMPLE_OBJECT_SYNONYMS[primaryObject] ?? [];
  const keywords = Array.from(
    new Set([
      searchQuery,
      primaryObject,
      ...synonyms,
      ...foundStyles,
      ...foundColors,
      ...foundMaterials,
      ...foundFeatures,
    ]),
  ).filter((k) => k.length > 0);

  // Appearance includes colors and materials
  const appearance = Array.from(new Set([...foundColors, ...foundMaterials, ...foundFeatures]));
  const stylesList = Array.from(foundStyles);

  const requiredConditions = [primaryObject];
  const preferredConditions = [...appearance, ...stylesList];

  // Filter out any negative words that are actually legitimate synonyms/super-types of the primary object
  // (e.g. if primary object is "laptop", and negative clause was "desktop computer", we exclude "desktop computer" and "desktop", but NOT the base noun "computer")
  const primarySynonyms = new Set([
    primaryObject,
    ...(SIMPLE_OBJECT_SYNONYMS[primaryObject] ?? []),
    ...primaryObject.split(/\s+/),
  ]);
  const filteredNegatives = negativeConditions.filter((neg) => {
    if (primarySynonyms.has(neg)) return false;
    return true;
  });

  return {
    rawPrompt: prompt,
    searchQuery,
    keywords,
    objectType: primaryObject,
    appearance,
    style: stylesList,
    requiredConditions,
    preferredConditions,
    negativeConditions: Array.from(new Set(filteredNegatives)),
    attributes: {
      colors: Array.from(foundColors),
      materials: Array.from(foundMaterials),
      features: Array.from(foundFeatures),
    },
    confidence: 0.95,
    source: "deterministic",
  };
}

// Application-level in-memory LRU caches
export const promptInterpretationCache = new LRUCache<string, InterpretedPrompt>({
  max: 500,
  ttl: 1000 * 60 * 60, // 1 hour TTL
});

export const imageAnalysisCache = new LRUCache<string, ImageAnalysisResult>({
  max: 200,
  ttl: 1000 * 60 * 60 * 2, // 2 hours TTL
});

const inFlightPrompts = new Map<string, Promise<InterpretedPrompt>>();
const inFlightImages = new Map<string, Promise<ImageAnalysisResult>>();

export function clearAiCaches(): void {
  promptInterpretationCache.clear();
  imageAnalysisCache.clear();
  inFlightPrompts.clear();
  inFlightImages.clear();
}

/**
 * Identify straightforward keyword searches that don't need Gemini round-trips.
 * (e.g. "chair", "pine tree", "sofa", "oak wood")
 */
export function isSimpleKeywordQuery(prompt: string): boolean {
  const trimmed = prompt.trim();
  if (!trimmed) return true;
  const words = trimmed.split(/\s+/);
  // Multi-word conversational prompts or prompts with operators/questions require AI
  if (words.length > 3) return false;
  if (/\b(?:not|without|except|no|need|want|for|with|like|looking|please|find|show|give|exclude|excluding|search)\b/i.test(trimmed)) {
    return false;
  }
  return true;
}

function getAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

const PRIMARY_GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const FALLBACK_GEMINI_MODEL = "gemini-3.8-flash";

/**
 * Interpret user prompt using hybrid understanding:
 * 1. Fast deterministic parsing as reliable foundation.
 * 2. Caching & in-flight deduplication.
 * 3. Gemini enrichment if configured, with graceful fallback on ANY failure.
 */
export async function interpretPrompt(prompt: string): Promise<InterpretedPrompt> {
  const raw = prompt.trim();
  if (!raw) return parsePromptDeterministic(raw);

  const cacheKey = raw.toLowerCase().replace(/\s+/g, " ");

  // 1. Check interpretation cache
  const cached = promptInterpretationCache.get(cacheKey);
  if (cached) {
    return { ...cached, source: "cached" };
  }

  // 2. In-flight request deduplication
  const inFlight = inFlightPrompts.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const execution = (async (): Promise<InterpretedPrompt> => {
    const base = parsePromptDeterministic(raw);

    // 3. Skip Gemini for straightforward keyword queries (0ms latency optimization)
    if (isSimpleKeywordQuery(raw)) {
      promptInterpretationCache.set(cacheKey, base);
      return base;
    }

    // If no Gemini client is available, return deterministic result
    const client = getAIClient();
    if (!client) {
      promptInterpretationCache.set(cacheKey, base);
      return base;
    }

    try {
      const callModel = async (modelName: string) => {
        return client.models.generateContent({
          model: modelName,
          contents: [
            {
              role: "user",
              parts: [
                {
                  text: `Analyze this 3D asset search request.
Return ONLY a JSON object with:
- assetType: "3d-model" | "material" | "texture" | "hdri" | "game-asset"
- category: general category (e.g. "nature", "furniture", "architecture", "vehicle", "character", "environment")
- searchQuery: concise search phrase (1-3 words) for asset providers
- keywords: array of relevant synonyms and search terms
- objectType: the primary subject
- appearance: array of visual attributes (colors, materials)
- style: array of styles (e.g. "low-poly", "realistic", "pbr", "stylized")
- colors: array of colors
- useCase: brief target application or context
- negativeConditions: terms user explicitly wants to exclude

User request: ${raw}`,
                },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                assetType: { type: "STRING" },
                category: { type: "STRING" },
                searchQuery: { type: "STRING" },
                keywords: { type: "ARRAY", items: { type: "STRING" } },
                objectType: { type: "STRING" },
                appearance: { type: "ARRAY", items: { type: "STRING" } },
                style: { type: "ARRAY", items: { type: "STRING" } },
                colors: { type: "ARRAY", items: { type: "STRING" } },
                useCase: { type: "STRING" },
                negativeConditions: { type: "ARRAY", items: { type: "STRING" } },
              },
              required: [
                "searchQuery",
                "keywords",
                "objectType",
                "appearance",
                "style",
              ],
            },
          },
        });
      };

      const callWithTimeout = async (modelName: string, ms = 3000) => {
        let timeoutId: any;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Gemini timeout for ${modelName}`)), ms);
        });
        try {
          return await Promise.race([callModel(modelName), timeoutPromise]);
        } finally {
          clearTimeout(timeoutId);
        }
      };

      let response;
      try {
        response = await callWithTimeout(PRIMARY_GEMINI_MODEL, 3000);
      } catch {
        try {
          response = await callWithTimeout(FALLBACK_GEMINI_MODEL, 3000);
        } catch {
          promptInterpretationCache.set(cacheKey, base);
          return base;
        }
      }

      const text = response.text;
      if (!text) {
        promptInterpretationCache.set(cacheKey, base);
        return base;
      }

      const parsed = JSON.parse(text) as Record<string, any>;

      const mergedColors = Array.from(new Set([...(parsed.colors ?? []), ...(base.attributes?.colors ?? [])]));
      const mergedMaterials = base.attributes?.materials ?? [];
      const mergedFeatures = base.attributes?.features ?? [];

      const result: InterpretedPrompt = {
        rawPrompt: raw,
        searchQuery: parsed.searchQuery?.trim() || base.searchQuery,
        keywords: Array.from(new Set([...(parsed.keywords ?? []), ...base.keywords])),
        objectType: parsed.objectType?.toLowerCase().trim() || base.objectType,
        appearance: Array.from(new Set([...(parsed.appearance ?? []), ...base.appearance])),
        style: Array.from(new Set([...(parsed.style ?? []), ...base.style])),
        requiredConditions: base.requiredConditions,
        preferredConditions: Array.from(new Set([...(base.preferredConditions ?? []), ...(parsed.appearance ?? [])])),
        negativeConditions: Array.from(new Set([...(parsed.negativeConditions ?? []), ...(base.negativeConditions ?? [])])),
        attributes: {
          colors: mergedColors,
          materials: mergedMaterials,
          features: mergedFeatures,
        },
        assetType: parsed.assetType,
        category: parsed.category,
        useCase: parsed.useCase,
        confidence: 0.98,
        source: "hybrid",
      };

      promptInterpretationCache.set(cacheKey, result);
      return result;
    } catch {
      // Graceful fallback to deterministic parsing: do not fail search when external service has an issue
      promptInterpretationCache.set(cacheKey, base);
      return base;
    } finally {
      inFlightPrompts.delete(cacheKey);
    }
  })();

  inFlightPrompts.set(cacheKey, execution);
  return execution;
}

/**
 * Optimize image-based search using Gemini multimodal analysis:
 * 1. Validates and compresses/resizes image with Sharp (max 512x512 JPEG).
 * 2. Caches classification by image fingerprint.
 * 3. Extracts structured keywords, category, colors, and search terms.
 */
export async function analyzeImage(
  imageBuffer: Buffer,
  mimeType: string = "image/jpeg",
): Promise<ImageAnalysisResult> {
  if (!imageBuffer || imageBuffer.length === 0) {
    throw new Error("Invalid or empty image buffer");
  }

  // 1. Resize and compress image to max 512x512 JPEG to minimize payload and latency
  let optimizedBuffer: Buffer;
  try {
    optimizedBuffer = await sharp(imageBuffer)
      .resize(512, 512, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80 })
      .toBuffer();
  } catch (err) {
    throw new Error(`Unsupported or corrupted image file: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 2. Compute image fingerprint for caching
  const imageHash = createHash("sha256").update(optimizedBuffer).digest("hex");
  const cached = imageAnalysisCache.get(imageHash);
  if (cached) {
    return { ...cached, source: "cached" };
  }

  const inFlight = inFlightImages.get(imageHash);
  if (inFlight) {
    return inFlight;
  }

  const execution = (async (): Promise<ImageAnalysisResult> => {
    const client = getAIClient();
    if (!client) {
      // Fallback if no Gemini key available
      const fallbackResult: ImageAnalysisResult = {
        mainObject: "3d-asset",
        category: "general",
        style: "realistic",
        dominantColors: [],
        materialCharacteristics: "standard",
        environmentUseCase: "general 3d scene",
        descriptiveKeywords: ["3d model", "asset"],
        searchQuery: "3d model",
        assetType: "model",
        confidence: 0.5,
        source: "fallback",
      };
      imageAnalysisCache.set(imageHash, fallbackResult);
      return fallbackResult;
    }

    try {
      const base64Data = optimizedBuffer.toString("base64");
      const callImageModel = async (modelName: string) => {
        return client.models.generateContent({
          model: modelName,
          contents: [
            {
              role: "user",
              parts: [
                {
                  inlineData: {
                    mimeType: "image/jpeg",
                    data: base64Data,
                  },
                },
                {
                  text: `Analyze this image for searching 3D digital assets (models, textures, materials, HDRIs).
Return ONLY a JSON object with:
- mainObject: primary subject depicted (e.g. "pine tree", "wooden chair", "concrete wall")
- category: asset category (e.g. "nature", "furniture", "architecture", "vehicle", "material", "environment")
- style: visual style (e.g. "low-poly", "photorealistic", "stylized", "pbr", "cartoon")
- dominantColors: array of primary colors
- materialCharacteristics: description of surface / texture / materials
- environmentUseCase: context or use-case (e.g. "game environment", "architectural visualization", "lighting")
- descriptiveKeywords: array of 4-8 search terms for asset repositories
- searchQuery: concise search query (1-3 words) for 3D asset libraries
- assetType: inferred type ("model" | "material" | "texture" | "hdri")`,
                },
              ],
            },
          ],
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: "OBJECT",
              properties: {
                mainObject: { type: "STRING" },
                category: { type: "STRING" },
                style: { type: "STRING" },
                dominantColors: { type: "ARRAY", items: { type: "STRING" } },
                materialCharacteristics: { type: "STRING" },
                environmentUseCase: { type: "STRING" },
                descriptiveKeywords: { type: "ARRAY", items: { type: "STRING" } },
                searchQuery: { type: "STRING" },
                assetType: { type: "STRING" },
              },
              required: [
                "mainObject",
                "category",
                "style",
                "descriptiveKeywords",
                "searchQuery",
                "assetType",
              ],
            },
          },
        });
      };

      const callWithTimeout = async (modelName: string, ms = 4000) => {
        let timeoutId: any;
        const timeoutPromise = new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`Gemini timeout for ${modelName}`)), ms);
        });
        try {
          return await Promise.race([callImageModel(modelName), timeoutPromise]);
        } finally {
          clearTimeout(timeoutId);
        }
      };

      let response;
      try {
        response = await callWithTimeout(PRIMARY_GEMINI_MODEL, 4000);
      } catch {
        try {
          response = await callWithTimeout(FALLBACK_GEMINI_MODEL, 4000);
        } catch {
          throw new Error("Both vision models failed");
        }
      }

      const text = response.text;
      if (!text) {
        throw new Error("Empty response from Gemini vision model");
      }

      const parsed = JSON.parse(text) as Record<string, any>;
      const result: ImageAnalysisResult = {
        mainObject: parsed.mainObject || "3d asset",
        category: parsed.category || "general",
        style: parsed.style || "realistic",
        dominantColors: Array.isArray(parsed.dominantColors) ? parsed.dominantColors : [],
        materialCharacteristics: parsed.materialCharacteristics || "",
        environmentUseCase: parsed.environmentUseCase || "",
        descriptiveKeywords: Array.isArray(parsed.descriptiveKeywords) ? parsed.descriptiveKeywords : [parsed.mainObject],
        searchQuery: parsed.searchQuery || parsed.mainObject || "3d model",
        assetType: parsed.assetType || "model",
        confidence: 0.95,
        source: "gemini",
      };

      imageAnalysisCache.set(imageHash, result);
      return result;
    } catch {
      // Safe fallback if vision API fails
      const fallbackResult: ImageAnalysisResult = {
        mainObject: "3d-asset",
        category: "general",
        style: "realistic",
        dominantColors: [],
        materialCharacteristics: "standard",
        environmentUseCase: "game asset",
        descriptiveKeywords: ["3d model", "asset"],
        searchQuery: "3d model",
        assetType: "model",
        confidence: 0.5,
        source: "fallback",
      };
      imageAnalysisCache.set(imageHash, fallbackResult);
      return fallbackResult;
    } finally {
      inFlightImages.delete(imageHash);
    }
  })();

  inFlightImages.set(imageHash, execution);
  return execution;
}
