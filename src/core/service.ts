import { createHttpClient } from "./http.js";
import type {
  Asset,
  AssetDetails,
  AssetType,
  HttpClient,
  Provider,
  ProviderContext,
  ProviderInfo,
} from "./types.js";
import { matchScore, parseAssetId } from "./util.js";
import { parsePromptDeterministic, type InterpretedPrompt } from "../ai/prompt-interpreter.js";

export interface SearchRequest {
  query: string;
  types?: AssetType[];
  /** Restrict to these provider ids. */
  providers?: string[];
  freeOnly?: boolean;
  /** Only return assets this server can download directly. */
  downloadableOnly?: boolean;
  /** Total results to return across providers. */
  limit?: number;
  /** Per-provider result offset (for paging deeper into every source). */
  offset?: number;
  /** Per-provider timeout. */
  timeoutMs?: number;
}

export type ProviderStatus = "ok" | "error" | "timeout" | "skipped" | "link";

export interface ProviderSearchReport {
  provider: string;
  name: string;
  status: ProviderStatus;
  count: number;
  total?: number;
  searchUrl?: string;
  error?: string;
  tookMs: number;
}

export interface SearchResponse {
  query: string;
  types?: AssetType[];
  results: Asset[];
  providers: ProviderSearchReport[];
}

export interface AssetServiceOptions {
  providers: Provider[];
  http?: HttpClient;
  defaultTimeoutMs?: number;
}

const DEFAULT_LIMIT = 24;
const MAX_LIMIT = 100;

/** Small boost for sources whose metadata and downloads we trust most. */
const ACCESS_WEIGHT = { api: 1, scrape: 0.8, link: 0 } as const;

export class AssetService {
  readonly http: HttpClient;
  private readonly providers = new Map<string, Provider>();
  private readonly defaultTimeoutMs: number;

  constructor(opts: AssetServiceOptions) {
    this.http = opts.http ?? createHttpClient();
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? Number(process.env.ASSET_SERVER_PROVIDER_TIMEOUT_MS ?? 12_000);
    for (const p of opts.providers) this.providers.set(p.id, p);
  }

  listProviders(): (ProviderInfo & { enabled: boolean })[] {
    return [...this.providers.values()].map((p) => ({
      id: p.id,
      name: p.name,
      homepage: p.homepage,
      description: p.description,
      assetTypes: p.assetTypes,
      access: p.access,
      pricing: p.pricing,
      license: p.license,
      apiKeyEnv: p.apiKeyEnv,
      supportsDownload: p.supportsDownload,
      enabled: p.isEnabled?.() ?? true,
    }));
  }

  getProvider(id: string): Provider | undefined {
    return this.providers.get(id);
  }

  async search(req: SearchRequest): Promise<SearchResponse> {
    const limit = Math.min(Math.max(req.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const types = req.types?.length ? req.types : undefined;
    const wanted = req.providers?.length ? new Set(req.providers) : undefined;
    const unknown = req.providers?.filter((p) => !this.providers.has(p)) ?? [];
    if (unknown.length) throw new UnknownProviderError(unknown);

    const rawQuery = req.query.trim();
    const intent = parsePromptDeterministic(rawQuery);
    // For candidate retrieval: use intent.searchQuery if the prompt specifies negative clauses or complex wording
    const providerQuery = (intent.negativeConditions && intent.negativeConditions.length > 0 && intent.searchQuery)
      ? intent.searchQuery
      : (intent.searchQuery || rawQuery);

    // Ask each source for a full page so the merged ranking has enough to choose from.
    const perProvider = Math.min(limit, 50);
    const q = { query: providerQuery, types, freeOnly: req.freeOnly, limit: perProvider, offset: req.offset };

    const reports: ProviderSearchReport[] = [];
    const ranked: { asset: Asset; rank: number; provider: Provider }[] = [];

    await Promise.all(
      [...this.providers.values()].map(async (p) => {
        const started = Date.now();
        const base = { provider: p.id, name: p.name, count: 0 };
        const skip = (reason: string): void => {
          reports.push({ ...base, status: "skipped", error: reason, tookMs: 0 });
        };
        if (wanted && !wanted.has(p.id)) return;
        if (p.isEnabled && !p.isEnabled()) return skip(`disabled (set ${p.apiKeyEnv ?? "its API key"})`);
        if (types && !types.some((t) => p.assetTypes.includes(t))) return skip("does not carry the requested types");
        if (req.downloadableOnly && !p.supportsDownload) return skip("no direct downloads");
        if (req.freeOnly && p.pricing === "paid") return skip("paid only");

        const searchUrl = p.buildSearchUrl(q);
        const signal = AbortSignal.timeout(timeoutMs);
        const ctx: ProviderContext = { fetch: this.http, signal };
        try {
          const res = await withTimeout(p.search(q, ctx), timeoutMs, signal);
          let assets = res.assets;
          if (req.downloadableOnly) assets = assets.filter((a) => a.downloadable);
          if (req.freeOnly) assets = assets.filter((a) => a.price?.free !== false);
          assets.forEach((asset, rank) => ranked.push({ asset, rank, provider: p }));
          reports.push({
            ...base,
            status: p.access === "link" ? "link" : "ok",
            count: assets.length,
            total: res.total,
            searchUrl: res.searchUrl ?? searchUrl,
            tookMs: Date.now() - started,
          });
        } catch (e) {
          const timedOut = signal.aborted || e instanceof TimeoutError;
          reports.push({
            ...base,
            status: timedOut ? "timeout" : "error",
            error: timedOut ? `timed out after ${timeoutMs}ms` : errorMessage(e),
            searchUrl,
            tookMs: Date.now() - started,
          });
        }
      }),
    );

    const results = rankResults(ranked, intent).slice(0, limit);
    const order = [...this.providers.keys()];
    reports.sort((a, b) => order.indexOf(a.provider) - order.indexOf(b.provider));
    return { query: rawQuery, types, results, providers: reports };
  }

  async getAsset(id: string): Promise<AssetDetails | null> {
    const parsed = parseAssetId(id);
    if (!parsed) throw new InvalidAssetIdError(id);
    const p = this.providers.get(parsed.provider);
    if (!p) throw new UnknownProviderError([parsed.provider]);
    if (!p.getAsset) throw new UnsupportedError(`${p.name} does not support asset details; open the source site instead.`);
    const signal = AbortSignal.timeout(this.defaultTimeoutMs * 2);
    return p.getAsset(parsed.nativeId, { fetch: this.http, signal });
  }
}

/**
 * Deduplicate identical assets returned across multiple providers or mirrors.
 */
function deduplicateAssets(
  items: { asset: Asset; rank: number; provider: Pick<Provider, "id" | "access"> }[],
): { asset: Asset; rank: number; provider: Pick<Provider, "id" | "access"> }[] {
  const seen = new Map<string, { asset: Asset; rank: number; provider: Pick<Provider, "id" | "access"> }>();
  for (const item of items) {
    const normTitle = item.asset.title.toLowerCase().replace(/[^a-z0-9]/g, "");
    const authorKey = (item.asset.author ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
    // Key by URL if available, else content fingerprint
    const key = item.asset.url && !item.asset.url.includes("search")
      ? `url:${item.asset.url}`
      : `content:${item.asset.type}:${normTitle}:${authorKey}`;

    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, item);
    } else {
      // Prefer directly downloadable or higher access weight
      if (!existing.asset.downloadable && item.asset.downloadable) {
        seen.set(key, item);
      } else if (ACCESS_WEIGHT[item.provider.access] > ACCESS_WEIGHT[existing.provider.access]) {
        seen.set(key, item);
      }
    }
  }
  return Array.from(seen.values());
}

/**
 * Merge per-provider results into one relevant, deduped, and balanced list.
 * Relevance score is dominant (0.85) based on semantic prompt intent.
 * Secondary signals (source rank, direct download, access reliability) act as tie-breakers.
 * Controlled diversity prevents a single provider from drowning out variety without promoting irrelevant assets.
 */
export function rankResults(
  items: { asset: Asset; rank: number; provider: Pick<Provider, "id" | "access"> }[],
  queryOrIntent: string | InterpretedPrompt,
): Asset[] {
  const isIntent = typeof queryOrIntent === "object" && queryOrIntent !== null && "objectType" in queryOrIntent;
  const intent: InterpretedPrompt = isIntent
    ? (queryOrIntent as InterpretedPrompt)
    : parsePromptDeterministic(typeof queryOrIntent === "string" ? queryOrIntent : "");

  const deduped = deduplicateAssets(items);

  const scored = deduped.map(({ asset, rank, provider }) => {
    const relevance = matchScore(asset, intent);
    const sourceRank = 1 / (1 + rank * 0.15);

    // Relevance is dominant: 0.85 weight
    // Secondary signals only act as tie-breakers among relevant assets
    const secondary =
      0.08 * sourceRank +
      0.03 * ACCESS_WEIGHT[provider.access] +
      0.02 * (asset.price?.free ? 1 : 0) +
      0.02 * (asset.downloadable ? 1 : 0);

    // If relevance is 0 or near zero, do not allow secondary signals to make it look relevant
    const score = relevance > 0.05
      ? 0.85 * relevance + secondary
      : relevance * 0.5;

    return { asset, provider: provider.id, score, relevance };
  });

  // Sort primarily by score, tie-break by relevance
  scored.sort((a, b) => b.score - a.score || b.relevance - a.relevance);

  const seenPerProvider = new Map<string, number>();
  const diversified = scored.map((result) => {
    const count = seenPerProvider.get(result.provider) ?? 0;
    seenPerProvider.set(result.provider, count + 1);

    // Controlled diversity penalty (0.99^count) that does NOT overpower primary relevance
    return {
      ...result,
      score: result.score * Math.pow(0.99, count),
    };
  });

  diversified.sort((a, b) => b.score - a.score || b.relevance - a.relevance);

  // Candidate filtering: if we have relevant results, prune clearly irrelevant noise (relevance < 0.10)
  const hasStrongHits = diversified.some((r) => r.relevance >= 0.25);
  const candidates = hasStrongHits
    ? diversified.filter((r) => r.relevance >= 0.10)
    : diversified;

  return candidates.map(({ asset, score }) => ({
    ...asset,
    score: round(score),
  }));
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

class TimeoutError extends Error {}

function withTimeout<T>(p: Promise<T>, ms: number, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new TimeoutError(`timed out after ${ms}ms`));
    if (signal.aborted) return onAbort();
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export class UnknownProviderError extends Error {
  constructor(readonly ids: string[]) {
    super(`Unknown provider(s): ${ids.join(", ")}`);
    this.name = "UnknownProviderError";
  }
}

export class InvalidAssetIdError extends Error {
  constructor(id: string) {
    super(`Invalid asset id "${id}". Expected "<provider>:<id>", e.g. "polyhaven:ArmChair_01".`);
    this.name = "InvalidAssetIdError";
  }
}

export class UnsupportedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedError";
  }
}
