import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { setNonce } from "get-nonce";
import {
  ArrowUpRight,
  Download,
  Filter,
  Loader2,
  Search,
  SlidersHorizontal,
  Sparkles,
  X,
  Box,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  api,
  apiPost,
  getKey,
  safeUrl,
  setKey,
  UnauthorizedError,
  type Asset,
  type Provider,
  type ProviderReport,
  type SearchResponse,
} from "./api";
import { AssetDetail } from "./AssetDetail";

const TYPES: [string, string][] = [
  ["model", "3D Models"],
  ["material", "Materials"],
  ["texture", "Textures"],
  ["hdri", "HDRIs"],
  ["pack", "Packs"],
  ["sprite", "Sprites"],
  ["ui", "UI Kits"],
  ["audio", "Audio"],
];

const SUGGESTIONS = [
  "Low-poly tree",
  "Modern chair",
  "Brick wall",
  "Sunset HDRI",
  "Sci-fi crate",
  "Animated character",
];

const PAGE = 24;

if (typeof document !== "undefined") {
  const nonce = document.querySelector<HTMLMetaElement>('meta[property="csp-nonce"]')?.content;
  if (nonce) setNonce(nonce);
}

interface Filters {
  q: string;
  types: string[];
  free: boolean;
  downloadable: boolean;
  sources: string[] | null;
}

function readUrl(): Filters {
  const p = new URLSearchParams(window.location.search);
  return {
    q: p.get("q") ?? "",
    types: (p.get("type") ?? "").split(",").filter(Boolean),
    free: p.get("free") === "true",
    downloadable: p.get("downloadable") === "true",
    sources: p.get("providers") ? p.get("providers")!.split(",") : null,
  };
}

function toParams(f: Filters, offset = 0): URLSearchParams {
  const p = new URLSearchParams();
  p.set("q", f.q);
  if (f.types.length) p.set("type", f.types.join(","));
  if (f.free) p.set("free", "true");
  if (f.downloadable) p.set("downloadable", "true");
  if (f.sources) p.set("providers", f.sources.join(","));
  if (offset) p.set("offset", String(offset));
  return p;
}

export default function SearchApp() {
  const [filters, setFilters] = useState<Filters>({
    q: "",
    types: [],
    free: false,
    downloadable: false,
    sources: null,
  });
  const [draft, setDraft] = useState("");
  const [providers, setProviders] = useState<Provider[]>([]);
  const [results, setResults] = useState<Asset[]>([]);
  const [reports, setReports] = useState<ProviderReport[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [needKey, setNeedKey] = useState(false);
  const [canMore, setCanMore] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<Asset | null>(null);
  const offset = useRef(0);
  const aiQuery = useRef<string | null>(null);
  const firstRun = useRef(true);
  const seen = useRef(new Set<string>());
  const inputRef = useRef<HTMLInputElement>(null);

  const providerName = useCallback((id: string) => providers.find((p) => p.id === id)?.name ?? id, [providers]);

  
const run = useCallback(async (f: Filters, append: boolean) => {
  if (!append) {
    offset.current = 0;
    seen.current = new Set();
    aiQuery.current = null;
    setResults([]);
    setReports([]);
  }

  setLoading(true);
  setError(undefined);
  setSearched(true);

  const qs = toParams(f);
  const shared = new URLSearchParams(window.location.search).get("asset");
  if (shared) qs.set("asset", shared);
  window.history.replaceState(null, "", `/search?${qs.toString()}`);

  if (!firstRun.current) {
    document.title = f.q
      ? `“${f.q}”: 3D assets · ModelVerse`
      : "Search free 3D models, textures & HDRIs · ModelVerse";
  }
  firstRun.current = false;

  try {
    // Preserve the user's complete prompt so backend hybrid retrieval understands full intent
    const searchFilters = {
      ...f,
      q: f.q.trim(),
    };

    const params = toParams(searchFilters, offset.current);
    params.set("limit", String(PAGE));

    const res = await api<SearchResponse>(`/v1/search?${params.toString()}`);
    const fresh = res.results.filter(
      (a) => !seen.current.has(a.id) && seen.current.add(a.id),
    );

    setResults((prev) => (append ? [...prev, ...fresh] : fresh));
    setReports(res.providers);
    setCanMore(
      fresh.length > 0 &&
        res.providers.some((r) => r.status === "ok" && r.count >= PAGE),
    );
    offset.current += PAGE;
  } catch (e) {
    if (e instanceof UnauthorizedError) setNeedKey(true);
    setError(e instanceof Error ? e.message : String(e));
  } finally {
    setLoading(false);
  }
}, []);


  const openAsset = useCallback((a: Asset | null) => {
    setSelected(a);
    const url = new URL(window.location.href);
    if (a) url.searchParams.set("asset", a.id);
    else url.searchParams.delete("asset");
    window.history.replaceState(null, "", url.pathname + url.search);
  }, []);

  useEffect(() => {
    const f = readUrl();
    setFilters(f);
    setDraft(f.q);
    const shared = new URLSearchParams(window.location.search).get("asset");
    api<{ providers: Provider[] }>("/v1/providers")
      .then((r) => setProviders(r.providers))
      .catch((e) => e instanceof UnauthorizedError && setNeedKey(true));
    if (f.q || f.types.length) void run(f, false);
    else if (!shared) inputRef.current?.focus();
    if (shared) {
      api<Asset>(`/v1/assets/${encodeURIComponent(shared)}`)
        .then((a) => openAsset(a))
        .catch(() => undefined);
    }
  }, [run, openAsset]);

  const update = (patch: Partial<Filters>, rerun = true) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (rerun && (next.q || next.types.length)) void run(next, false);
  };

  const clearAllFilters = () => {
    setDraft("");
    const reset: Filters = { q: "", types: [], free: false, downloadable: false, sources: null };
    setFilters(reset);
    setResults([]);
    setSearched(false);
    window.history.replaceState(null, "", "/search");
  };

  const hasActiveFilters = Boolean(
    filters.q || filters.types.length > 0 || filters.free || filters.downloadable || filters.sources
  );

  const okReports = useMemo(() => reports.filter((r) => r.status !== "skipped"), [reports]);
  const sourceLabel = filters.sources ? `${filters.sources.length} of ${providers.length} sources` : "All Sources";

  return (
    <div className="mx-auto max-w-7xl px-4 pb-28 sm:px-6">
      {/* Sticky Filter & Search Control Panel */}
      <div className="sticky top-16 z-30 -mx-4 border-b border-border/80 bg-background/90 px-4 pb-5 pt-6 backdrop-blur-xl transition-all sm:-mx-6 sm:px-6 shadow-xs">
        {/* Main Search Input */}
        <form
          role="search"
          onSubmit={(e) => {
            e.preventDefault();
            update({ q: draft.trim() });
          }}
          className="flex items-center gap-2"
        >
          <div className="relative flex-1 group">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4.5 -translate-y-1/2 text-muted-foreground transition group-focus-within:text-primary" />
            <Input
              ref={inputRef}
              type="search"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Search 3D models, textures, materials, HDRIs..."
              aria-label="Search 3D assets"
              className="h-12 rounded-2xl border-2 border-border/80 bg-card pl-11 pr-10 text-base shadow-xs focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 transition-all"
            />
            {draft && (
              <button
                type="button"
                onClick={() => {
                  setDraft("");
                  inputRef.current?.focus();
                }}
                className="absolute right-3.5 top-1/2 -translate-y-1/2 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Clear search input"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <Button
            type="submit"
            size="lg"
            className="h-12 rounded-2xl bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-95 hover:shadow-md hover:shadow-primary/20 active:scale-[0.98]"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 className="size-4 animate-spin mr-1.5" aria-hidden="true" />
                <span>Searching…</span>
              </>
            ) : (
              "Search"
            )}
          </Button>
        </form>

        {/* Filter Controls Row */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-y-3 gap-x-4">
          {/* Asset Type Pills */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Asset categories">
            <button
              type="button"
              onClick={() => update({ types: [] })}
              className={cn(
                "rounded-full px-3.5 py-1 text-xs font-semibold transition shadow-xs",
                filters.types.length === 0
                  ? "bg-foreground text-background"
                  : "border border-border/80 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              )}
            >
              All Types
            </button>
            {TYPES.map(([id, label]) => {
              const on = filters.types.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  onClick={() =>
                    update({
                      types: on ? filters.types.filter((t) => t !== id) : [...filters.types, id],
                    })
                  }
                  className={cn(
                    "rounded-full px-3.5 py-1 text-xs font-semibold transition shadow-xs",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "border border-border/80 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {/* Quick Filter Toggles & Source Picker */}
          <div className="flex flex-wrap items-center gap-4">
            <Switch
              label="Free only"
              labelClassName="text-xs font-medium text-foreground cursor-pointer"
              checked={filters.free}
              onCheckedChange={(v) => update({ free: v })}
            />
            <Switch
              label="Direct download"
              labelClassName="text-xs font-medium text-foreground cursor-pointer"
              checked={filters.downloadable}
              onCheckedChange={(v) => update({ downloadable: v })}
            />

            {/* Sources Popover */}
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="h-8 gap-1.5 rounded-full border-border/80 text-xs font-medium bg-card">
                  <SlidersHorizontal className="size-3.5 text-primary" /> {sourceLabel}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80 rounded-2xl p-4 shadow-xl border-border">
                <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
                  <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Supported Sources</p>
                  <button
                    type="button"
                    className="text-xs font-medium text-primary hover:underline"
                    onClick={() => update({ sources: null })}
                  >
                    Select All
                  </button>
                </div>
                <div className="grid max-h-72 grid-cols-1 gap-1 overflow-y-auto pr-1">
                  {providers.map((p) => {
                    const on = !filters.sources || filters.sources.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-2.5 rounded-xl px-2 py-1.5 text-xs hover:bg-accent transition"
                        title={p.description}
                      >
                        <Checkbox
                          checked={on}
                          onCheckedChange={(v) => {
                            const current = filters.sources ?? providers.map((x) => x.id);
                            const next = v ? [...current, p.id] : current.filter((x) => x !== p.id);
                            update({ sources: next.length === providers.length ? null : next }, false);
                          }}
                        />
                        <span className="flex-1 font-medium">{p.name}</span>
                        {p.supportsDownload && (
                          <span className="rounded bg-emerald-500/10 px-1 py-0.2 text-[9px] font-bold text-emerald-600 dark:text-emerald-400">
                            Direct
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
                <Button
                  size="sm"
                  className="mt-3 w-full rounded-xl bg-primary text-xs font-semibold"
                  onClick={() => void run(filters, false)}
                >
                  Apply Filters
                </Button>
              </PopoverContent>
            </Popover>

            {/* Clear All Filters Button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition"
              >
                <RotateCcw className="size-3" />
                <span>Reset</span>
              </button>
            )}
          </div>
        </div>

        {needKey && (
          <form
            className="mt-3 flex flex-wrap items-center gap-2 rounded-xl border border-warning/40 bg-warning/10 p-3 text-xs"
            onSubmit={(e) => {
              e.preventDefault();
              const v = new FormData(e.currentTarget).get("key");
              setKey(String(v ?? ""));
              setNeedKey(false);
              void run(filters, false);
            }}
          >
            <span className="font-medium text-warning-foreground">Authentication required:</span>
            <Input name="key" type="password" defaultValue={getKey()} className="h-8 w-56 rounded-lg text-xs" placeholder="Paste your API key" />
            <Button size="sm" type="submit" className="rounded-lg h-8 text-xs">Save</Button>
          </form>
        )}
      </div>

      {/* Source Reports / Response Badges */}
      {okReports.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-1.5 text-xs" aria-label="Sources queried">
          <span className="text-[11px] font-medium text-muted-foreground mr-1">Results from:</span>
          {okReports.map((r) => {
            const url = r.status !== "ok" ? safeUrl(r.searchUrl) : undefined;
            const cls = cn(
              "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] transition",
              r.status === "ok" && "border-border/80 bg-card text-muted-foreground",
              (r.status === "error" || r.status === "timeout") && "border-destructive/30 bg-destructive/10 text-destructive",
              r.status === "link" && "border-primary/30 text-primary hover:bg-primary/10"
            );
            const body = (
              <>
                <span>{r.name}</span>
                {r.status === "ok" ? (
                  <span className="rounded-full bg-muted px-1.5 text-[10px] font-bold text-foreground">{r.count}</span>
                ) : r.status === "link" ? (
                  <ArrowUpRight className="size-3" />
                ) : (
                  ` ${r.status}`
                )}
              </>
            );
            return url ? (
              <a key={r.provider} href={url} target="_blank" rel="noopener noreferrer" className={cls} title={r.error ?? `Search directly on ${r.name}`}>
                {body}
              </a>
            ) : (
              <span key={r.provider} className={cls} title={r.error ?? `${r.tookMs} ms`}>
                {body}
              </span>
            );
          })}
        </div>
      )}

      {/* Error Banner */}
      {error && (
        <div className="mt-8 rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive shadow-sm">
          <p className="font-semibold">Search unavailable</p>
          <p className="mt-1 text-xs opacity-90">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void run(filters, false)}
            className="mt-3 rounded-xl border-destructive/30 text-destructive hover:bg-destructive/10"
          >
            Retry Search
          </Button>
        </div>
      )}

      {/* Results Asset Grid */}
      <div className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-3 sm:gap-5 lg:grid-cols-4 xl:grid-cols-5">
        {results.map((a) => (
          <ResultCard
            key={a.id}
            asset={a}
            providerName={providerName(a.provider)}
            onOpen={() => openAsset(a)}
          />
        ))}

        {/* Loading Skeletons */}
        {loading &&
          Array.from({ length: results.length ? 5 : 15 }).map((_, i) => (
            <div key={`s${i}`} className="overflow-hidden rounded-2xl border border-border/70 bg-card p-0 shadow-xs">
              <Skeleton className="aspect-[4/3] w-full rounded-none" />
              <div className="space-y-2.5 p-4">
                <Skeleton className="h-4 w-4/5 rounded-md" />
                <div className="flex gap-1.5">
                  <Skeleton className="h-4 w-12 rounded-md" />
                  <Skeleton className="h-4 w-16 rounded-md" />
                </div>
              </div>
            </div>
          ))}
      </div>

      {/* Empty State: No results found */}
      {!loading && !error && searched && results.length === 0 && (
        <div className="mt-20 mx-auto max-w-md text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-muted/60 text-muted-foreground">
            <Filter className="size-7 opacity-60" />
          </div>
          <h3 className="mt-4 text-lg font-bold text-foreground">No sufficiently relevant results found</h3>
          <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
            We couldn't verify sufficiently matching assets for your exact prompt. Try broadening your keywords or removing some filters.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setDraft(s);
                  update({ q: s, types: [] });
                }}
                className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-foreground hover:border-primary transition"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Initial State before any search */}
      {!searched && (
        <div className="mt-24 mx-auto max-w-xl text-center">
          <div className="mx-auto flex size-16 items-center justify-center rounded-3xl bg-gradient-to-tr from-primary/20 via-primary/5 to-brand-2/20 text-primary shadow-lg shadow-primary/10">
            <Sparkles className="size-8" />
          </div>
          <h2 className="mt-6 text-2xl font-extrabold tracking-tight text-foreground">
            Search 22+ Repositories in One Place
          </h2>
          <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
            Enter a prompt, model name, or texture type above to search millions of CC0 and free assets from Poly Haven, Kenney, ambientCG, BlenderKit, and more.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            <span className="text-xs text-muted-foreground font-medium self-center mr-1">Popular searches:</span>
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setDraft(s);
                  update({ q: s });
                }}
                className="rounded-full border border-border/80 bg-card px-3.5 py-1 text-xs font-semibold text-foreground hover:border-primary/50 hover:bg-accent transition shadow-xs"
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Load More Button */}
      {canMore && !loading && (
        <div className="mt-12 text-center">
          <Button
            variant="outline"
            onClick={() => void run(filters, true)}
            className="rounded-2xl border-border px-8 py-2.5 text-sm font-semibold hover:bg-accent"
          >
            Load More Assets
          </Button>
        </div>
      )}

      {/* Asset Detail Drawer Sheet */}
      <Sheet open={Boolean(selected)} onOpenChange={(o) => !o && openAsset(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl rounded-l-3xl border-l border-border bg-background p-0 shadow-2xl">
          {selected && (
            <>
              <SheetHeader className="px-6 pt-6 pb-2">
                <SheetDescription className="text-xs font-semibold uppercase tracking-wider text-primary">
                  {providerName(selected.provider)} · {selected.type}
                </SheetDescription>
                <SheetTitle className="text-2xl font-extrabold text-foreground">{selected.title}</SheetTitle>
              </SheetHeader>
              <AssetDetail asset={selected} providerName={providerName(selected.provider)} />
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function ResultCard({
  asset: a,
  providerName,
  onOpen,
}: {
  asset: Asset;
  providerName: string;
  onOpen: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const src = safeUrl(a.thumbnailUrl);
  const isModel = a.type === "model";
  const editorUrl = `/editor?asset=${encodeURIComponent(a.id)}&title=${encodeURIComponent(a.title)}`;

  return (
    <div className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/80 bg-card text-left shadow-xs transition-all duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5">
      {/* Thumbnail */}
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {src && !broken ? (
          <img
            src={src}
            alt={a.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
            className="size-full object-cover transition-transform duration-500 group-hover:scale-105"
          />
        ) : (
          <div className="flex size-full items-center justify-center font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {a.type}
          </div>
        )}

        {/* Top Badges */}
        <div className="absolute left-2.5 top-2.5 flex flex-wrap gap-1">
          <span className="rounded-md bg-black/60 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-white backdrop-blur-md">
            {a.type}
          </span>
        </div>

        {a.downloadable && (
          <span className="absolute right-2.5 top-2.5 inline-flex items-center gap-1 rounded-md bg-emerald-600/90 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-xs backdrop-blur-sm">
            <Download className="size-2.5" /> Direct
          </span>
        )}

        {/* Hover Action Overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 transition-opacity duration-200 group-hover:opacity-100 flex items-center justify-center gap-1.5 p-2">
          {isModel && (
            <a
              href={editorUrl}
              onClick={(e) => e.stopPropagation()}
              className="rounded-xl bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-md hover:bg-primary/90 transition flex items-center gap-1"
            >
              <Box className="size-3.5" />
              <span>3D Studio</span>
            </a>
          )}
          <button
            type="button"
            onClick={onOpen}
            className="rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow-md hover:bg-zinc-100 transition"
          >
            Inspect
          </button>
        </div>
      </div>

      {/* Meta Content */}
      <div
        onClick={onOpen}
        className="flex flex-1 flex-col justify-between p-3.5 cursor-pointer"
      >
        <div>
          <h4 className="line-clamp-1 text-xs font-bold leading-snug text-foreground group-hover:text-primary transition" title={a.title}>
            {a.title}
          </h4>
          <p className="mt-1 text-[11px] text-muted-foreground line-clamp-1">{providerName}</p>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-1 pt-2 border-t border-border/50 text-[10px]">
          {a.price && (
            <span
              className={cn(
                "rounded px-1.5 py-0.2 font-semibold",
                a.price.free
                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
              )}
            >
              {a.price.free ? "Free" : "Paid"}
            </span>
          )}
          {a.license && (
            <span className="rounded bg-muted px-1.5 py-0.2 font-mono text-muted-foreground">
              {a.license.name}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
