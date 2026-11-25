import { LRUCache } from "lru-cache";
import type { SearchRequest, SearchResponse } from "./service.js";

export interface SearchCacheOptions {
  max?: number;
  ttlMs?: number;
}

export class SearchResultCache {
  private readonly cache: LRUCache<string, SearchResponse>;
  private readonly inFlight = new Map<string, Promise<SearchResponse>>();

  constructor(opts: SearchCacheOptions = {}) {
    this.cache = new LRUCache<string, SearchResponse>({
      max: opts.max ?? 500,
      ttl: opts.ttlMs ?? 1000 * 60 * 5, // 5 minutes TTL
    });
  }

  generateKey(req: SearchRequest): string {
    const normQuery = (req.query || "").trim().toLowerCase().replace(/\s+/g, " ");
    const types = req.types ? [...req.types].sort().join(",") : "";
    const providers = req.providers ? [...req.providers].sort().join(",") : "";
    const free = req.freeOnly ? "1" : "0";
    const downloadable = req.downloadableOnly ? "1" : "0";
    const limit = req.limit ?? 24;
    const offset = req.offset ?? 0;

    return `q:${normQuery}|t:${types}|p:${providers}|f:${free}|d:${downloadable}|l:${limit}|o:${offset}`;
  }

  get(key: string): SearchResponse | undefined {
    const hit = this.cache.get(key);
    if (!hit) return undefined;
    // Return a shallow clone so mutations don't corrupt the cached value
    return {
      query: hit.query,
      types: hit.types,
      results: [...hit.results],
      providers: hit.providers.map((p) => ({ ...p })),
    };
  }

  set(key: string, res: SearchResponse): void {
    // Only cache responses that returned results or completed successfully
    // Avoid caching complete failures or empty responses during outages
    const hasSuccessfulProviders = res.providers.some(
      (p) => p.status === "ok" || p.status === "link",
    );
    if (hasSuccessfulProviders) {
      this.cache.set(key, res);
    }
  }

  getInFlight(key: string): Promise<SearchResponse> | undefined {
    return this.inFlight.get(key);
  }

  setInFlight(key: string, promise: Promise<SearchResponse>): void {
    this.inFlight.set(key, promise);
  }

  deleteInFlight(key: string): void {
    this.inFlight.delete(key);
  }

  invalidate(queryPattern?: string): void {
    if (!queryPattern) {
      this.cache.clear();
      return;
    }
    const lower = queryPattern.toLowerCase();
    for (const key of this.cache.keys()) {
      if (key.includes(lower)) {
        this.cache.delete(key);
      }
    }
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }

  size(): number {
    return this.cache.size;
  }
}
