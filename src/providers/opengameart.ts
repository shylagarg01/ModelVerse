import * as cheerio from "cheerio";
import type { Asset, AssetDetails, AssetFile, AssetType, License, Provider, ProviderContext, SearchQuery } from "../core/types.js";
import { parseCount } from "../core/census.js";
import {
  LICENSES,
  absoluteUrl,
  cleanText,
  filenameFromUrl,
  formatFromFilename,
  inferType,
  makeAsset,
  uniq,
  wantsType,
} from "../core/util.js";

/**
 * OpenGameArt.org — ~5,000 3D models, ~16,000 2D sprites/tiles and ~2,000 textures made by the
 * community, each under its own free licence (mostly CC0, CC-BY, CC-BY-SA, GPL, OGA-BY).
 *
 * Search is the server-rendered Drupal view `/art-search-advanced?keys=…&field_art_type_tid[]=…`
 * (24 per page, `page` is 0-based, header "Displaying 1 - 24 of N"). Listing cards carry only a
 * title, thumbnail and link, so the licence comes from the detail page, whose files are plain
 * `/sites/default/files/…` links that work with a simple GET.
 */

const SITE = "https://opengameart.org";
const PAGE_SIZE = 24;
const MAX_PAGES = 2;

/** The site's "Art Type" taxonomy ids for the kinds we return. */
const ART_TYPES: { tid: number; type: AssetType; label: string; wants: AssetType[] }[] = [
  { tid: 10, type: "model", label: "3D Art", wants: ["model"] },
  { tid: 14, type: "texture", label: "Texture", wants: ["texture", "material"] },
  { tid: 9, type: "sprite", label: "2D Art", wants: ["sprite"] },
];

const LICENSE_URLS: Record<string, Pick<License, "url" | "attributionRequired">> = {
  CC0: { url: LICENSES.CC0.url, attributionRequired: false },
  "CC-BY 3.0": { url: "https://creativecommons.org/licenses/by/3.0/", attributionRequired: true },
  "CC-BY 4.0": { url: "https://creativecommons.org/licenses/by/4.0/", attributionRequired: true },
  "CC-BY-SA 3.0": { url: "https://creativecommons.org/licenses/by-sa/3.0/", attributionRequired: true },
  "CC-BY-SA 4.0": { url: "https://creativecommons.org/licenses/by-sa/4.0/", attributionRequired: true },
  "GPL 2.0": { url: "https://www.gnu.org/licenses/old-licenses/gpl-2.0.html", attributionRequired: true },
  "GPL 3.0": { url: "https://www.gnu.org/licenses/gpl-3.0.html", attributionRequired: true },
  "OGA-BY 3.0": { url: "https://opengameart.org/content/oga-by-30-faq", attributionRequired: true },
  "OGA-BY 4.0": { url: "https://opengameart.org/content/oga-by-30-faq", attributionRequired: true },
};

interface Card {
  nativeId: string;
  title: string;
  url: string;
  thumbnailUrl?: string;
}

function typesFor(q: SearchQuery) {
  return ART_TYPES.filter((t) => t.wants.some((w) => wantsType(q, w)));
}

function listUrl(query: string, tids: number[], page = 0): string {
  const sp = new URLSearchParams();
  sp.set("keys", query.trim());
  for (const tid of tids) sp.append("field_art_type_tid[]", String(tid));
  if (page > 0) sp.set("page", String(page));
  return `${SITE}/art-search-advanced?${sp.toString()}`;
}

/** Search result pages: `.art-previews-inline` cards plus the "Displaying 1 - 24 of N" header. */
export function parseListing(html: string): { cards: Card[]; total?: number } {
  const $ = cheerio.load(html);
  const cards: Card[] = [];
  $(".view-art .art-previews-inline").each((_, el) => {
    const a = $(el).find(".art-preview-title a").first();
    const href = a.attr("href");
    const m = href ? /^\/content\/([^/?#]+)$/.exec(href) : null;
    if (!m) return;
    cards.push({
      nativeId: m[1]!,
      title: cleanText(a.text()),
      url: absoluteUrl(href, SITE)!,
      thumbnailUrl: absoluteUrl($(el).find("img").first().attr("src"), SITE),
    });
  });
  const total = parseCount($(".view-art .view-header").first().text(), /of\s+([\d,]+)/);
  return { cards, total };
}

function cardToAsset(c: Card, type: AssetType): Asset {
  return makeAsset({
    provider: "opengameart",
    nativeId: c.nativeId,
    title: c.title,
    type,
    tags: [],
    url: c.url,
    thumbnailUrl: c.thumbnailUrl,
    price: { free: true },
    downloadable: true,
  });
}

function meta($: cheerio.CheerioAPI, name: string): string | undefined {
  return $(`meta[name="${name}"]`).attr("content") ?? $(`meta[property="${name}"]`).attr("content") ?? undefined;
}

function toLicense(name: string, href?: string): License {
  if (name === "CC0") return LICENSES.CC0;
  const known = LICENSE_URLS[name];
  return { name: name.replace(/\s+(\d)/, "-$1"), url: known?.url ?? href, commercialUse: true, attributionRequired: known?.attributionRequired ?? true };
}

/** Detail page: dcterms meta tags plus the `field-art-*` blocks (type, tags, licences, files). */
export function parseDetails(html: string, nativeId: string): AssetDetails | null {
  const $ = cheerio.load(html);
  const title = cleanText(meta($, "og:title") ?? meta($, "dcterms.title"));
  const artType = cleanText($(".field-name-field-art-type .field-item").first().text());
  const kind = ART_TYPES.find((t) => t.label === artType);
  // Unknown ids and non-art nodes (forum topics, collections) have no Art Type.
  if (!title || !kind) return null;

  const licenses = $(".field-name-field-art-licenses .license-icon")
    .map((_, el) => toLicense(cleanText($(el).find(".license-name").text()), $(el).find("a").attr("href")))
    .get();
  // When an author offers several licences, report the most permissive (CC0 first, then no-attribution).
  const license = licenses.find((l) => l.name === "CC0") ?? licenses.find((l) => !l.attributionRequired) ?? licenses[0];

  const files: AssetFile[] = [];
  $(".field-name-field-art-files a[href]").each((_, el) => {
    const url = absoluteUrl($(el).attr("href"), SITE);
    if (!url || !url.includes("/sites/default/files/")) return;
    const filename = filenameFromUrl(url);
    const length = /length=(\d+)/.exec($(el).attr("type") ?? "")?.[1];
    files.push({ url, filename, format: formatFromFilename(filename), sizeBytes: length ? Number(length) : undefined, group: "files" });
  });

  const tags = $(".field-name-field-art-tags a").map((_, el) => cleanText($(el).text())).get();
  const date = meta($, "article:published_time") ?? meta($, "dcterms.date");
  const asset = makeAsset({
    provider: "opengameart",
    nativeId,
    title,
    description: cleanText(meta($, "og:description")) || undefined,
    type: kind.type,
    tags,
    url: `${SITE}/content/${nativeId}`,
    thumbnailUrl: meta($, "og:image"),
    author: cleanText(meta($, "dcterms.creator")) || undefined,
    license,
    price: { free: true },
    formats: uniq(files.map((f) => f.format)),
    downloadable: files.length > 0,
    createdAt: date?.slice(0, 10),
  });
  return { ...asset, files };
}

export const opengameart: Provider = {
  id: "opengameart",
  name: "OpenGameArt",
  homepage: SITE,
  description: "Community game art: thousands of free 3D models, textures and 2D sprites/tilesets, each with its own licence (mostly CC0 and CC-BY).",
  assetTypes: ["model", "texture", "sprite"],
  access: "scrape",
  pricing: "free",
  supportsDownload: true,

  async census(ctx) {
    const counts = await Promise.all(
      ART_TYPES.map(async (t) => {
        const total = parseListing(await ctx.fetch.text(listUrl("", [t.tid]), { signal: ctx.signal })).total;
        if (total === undefined) throw new Error(`no result count for ${t.label}`);
        return [t.type, total] as const;
      }),
    );
    const byType = Object.fromEntries(counts) as Partial<Record<AssetType, number>>;
    const total = counts.reduce((sum, [, n]) => sum + n, 0);
    return {
      total,
      free: total,
      byType,
      method: "Result counts of the 3D Art, Texture and 2D Art listings (\"Displaying 1 - 24 of N\")",
    };
  },

  buildSearchUrl(q: SearchQuery) {
    const kinds = typesFor(q);
    return listUrl(q.query, (kinds.length ? kinds : ART_TYPES).map((t) => t.tid));
  },

  async search(q, ctx) {
    const kinds = typesFor(q);
    if (!kinds.length) return { assets: [] };
    const searchUrl = this.buildSearchUrl(q);
    const offset = q.offset ?? 0;
    const first = Math.floor(offset / PAGE_SIZE);
    const last = Math.min(Math.floor((offset + q.limit - 1) / PAGE_SIZE), first + MAX_PAGES - 1);

    const assets: Asset[] = [];
    let total: number | undefined;
    for (let page = first; page <= last; page++) {
      const parsed = parseListing(await ctx.fetch.text(listUrl(q.query, kinds.map((t) => t.tid), page), { signal: ctx.signal }));
      total = parsed.total ?? total;
      // Cards do not say which art type they are: exact for one type, guessed from the title otherwise.
      const type = (c: Card): AssetType => (kinds.length === 1 ? kinds[0]!.type : inferType(c.title, "other"));
      assets.push(...parsed.cards.map((c) => cardToAsset(c, type(c))));
      if (parsed.cards.length < PAGE_SIZE) break;
    }
    const start = offset - first * PAGE_SIZE;
    return { assets: assets.slice(start, start + q.limit), total, searchUrl };
  },

  async getAsset(nativeId, ctx): Promise<AssetDetails | null> {
    if (!/^[a-z0-9][a-z0-9-]*$/i.test(nativeId)) return null;
    let html: string;
    try {
      html = await ctx.fetch.text(`${SITE}/content/${nativeId}`, { signal: ctx.signal });
    } catch (e) {
      if ((e as { status?: number }).status === 404) return null;
      throw e;
    }
    return parseDetails(html, nativeId);
  },
};
