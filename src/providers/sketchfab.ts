import type { Asset, AssetDetails, Provider, SearchQuery } from "../core/types.js";
import { LICENSES, cleanText, makeAsset, qs, wantsType } from "../core/util.js";

/**
 * Sketchfab: the largest community 3D model library. We search only its CC0 (public domain)
 * models through the public Data API `GET /v3/search?type=models&license=cc0`, which needs no key.
 *
 * Downloading a model needs a Sketchfab login (an OAuth/API token), so files are never returned
 * (`supportsDownload: false`); results link to the model page. The search API has no total and
 * reports no total, so the census probes a deep page and is a lower bound.
 */

const SITE = "https://sketchfab.com";
const API = "https://api.sketchfab.com/v3";
const MAX_PAGE_SIZE = 24;
/** The CC0 library holds more models than this (found by probing deep cursors). */
const CENSUS_FLOOR = 8000;

interface SfModel {
  uid: string;
  name?: string;
  description?: string;
  viewerUrl?: string;
  publishedAt?: string;
  createdAt?: string;
  faceCount?: number;
  animationCount?: number;
  isAgeRestricted?: boolean;
  tags?: { name: string }[];
  categories?: { name: string }[];
  thumbnails?: { images?: { url: string; width: number }[] };
  user?: { username?: string; displayName?: string };
  archives?: Record<string, unknown>;
  license?: { label?: string };
}

interface SfSearch {
  results?: SfModel[];
}

function titleCase(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** The smallest thumbnail that is at least 512 px wide, else the largest. */
function thumbnail(m: SfModel): string | undefined {
  const images = [...(m.thumbnails?.images ?? [])].sort((a, b) => a.width - b.width);
  return (images.find((i) => i.width >= 512) ?? images.at(-1))?.url;
}

function toAsset(m: SfModel): Asset {
  const description = cleanText((m.description ?? "").replace(/[*_#`>]/g, ""));
  const formats = Object.keys(m.archives ?? {}).filter((f) => f !== "source");
  return makeAsset({
    provider: "sketchfab",
    nativeId: m.uid,
    title: cleanText(m.name) || m.uid,
    description: description ? description.slice(0, 300) : undefined,
    type: "model",
    tags: (m.tags ?? []).map((t) => t.name),
    categories: (m.categories ?? []).map((c) => titleCase(c.name)),
    url: m.viewerUrl || `${SITE}/3d-models/${m.uid}`,
    thumbnailUrl: thumbnail(m),
    author: m.user?.displayName || m.user?.username,
    license: LICENSES.CC0,
    price: { free: true },
    formats: formats.length ? formats : undefined,
    polyCount: m.faceCount || undefined,
    animated: m.animationCount === undefined ? undefined : m.animationCount > 0,
    downloadable: false,
    createdAt: m.publishedAt || m.createdAt,
  });
}

export const sketchfab: Provider = {
  id: "sketchfab",
  name: "Sketchfab",
  homepage: SITE,
  description:
    "Huge community library of 3D models (scans, props, characters, scenes); we search its CC0 public-domain models. Downloads need a Sketchfab login.",
  assetTypes: ["model"],
  access: "api",
  pricing: "free",
  license: LICENSES.CC0,
  supportsDownload: false,

  async census(ctx) {
    const probe = await ctx.fetch.json<SfSearch>(
      `${API}/search${qs({ type: "models", license: "cc0", count: MAX_PAGE_SIZE, cursor: CENSUS_FLOOR })}`,
      { cacheTtlMs: 60 * 60_000, signal: ctx.signal },
    );
    const total = CENSUS_FLOOR + (probe.results?.length ?? 0);
    return {
      total,
      atLeast: true,
      free: total,
      byType: { model: total },
      method: "Sketchfab Data API: CC0 model search probed past 8,000 hits (the API reports no total), so a lower bound",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    return `${SITE}/search${qs({ q: q.query.trim(), type: "models", features: "downloadable", licenses: "7c23a1ba438d4306920229c12afcb5f9" })}`;
  },

  async search(q, ctx) {
    if (!wantsType(q, "model")) return { assets: [] };
    const limit = Math.max(1, Math.min(q.limit, MAX_PAGE_SIZE));
    const offset = q.offset ?? 0;
    const query = q.query.trim();
    const res = await ctx.fetch.json<SfSearch>(
      `${API}/search${qs({
        type: "models",
        license: "cc0",
        q: query,
        sort_by: query ? undefined : "-likeCount",
        count: limit,
        cursor: offset || undefined,
      })}`,
      { cacheTtlMs: 10 * 60_000, signal: ctx.signal },
    );
    const assets = (res.results ?? []).filter((m) => m.uid && !m.isAgeRestricted).map(toAsset);
    return { assets, searchUrl: this.buildSearchUrl(q) };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    if (!/^[0-9a-f]{32}$/i.test(nativeId)) return null;
    let m: SfModel;
    try {
      m = await ctx.fetch.json<SfModel>(`${API}/models/${nativeId}`, { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    if (!m?.uid || m.isAgeRestricted) return null;
    if (m.license?.label && !/cc0/i.test(m.license.label)) return null;
    return { ...toAsset(m), files: [] };
  },
};
