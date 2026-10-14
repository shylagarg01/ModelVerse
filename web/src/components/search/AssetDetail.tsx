import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bot, Check, Download, FileBox, Loader2, Share2, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { CopyButton } from "@/components/home/AgentSetup";
import { api, formatBytes, getKey, safeUrl, type Asset, type AssetDetails, type FileSelection } from "./api";

export function AssetDetail({ asset, providerName }: { asset: Asset; providerName: string }) {
  const [full, setFull] = useState<AssetDetails | null>(null);
  const [failed, setFailed] = useState(false);
  const [format, setFormat] = useState("");
  const [resolution, setResolution] = useState("");
  const [selection, setSelection] = useState<FileSelection | null>(null);
  const [selError, setSelError] = useState<string>();

  useEffect(() => {
    setFull(null);
    setFailed(false);
    setFormat("");
    setResolution("");
    api<AssetDetails>(`/v1/assets/${encodeURIComponent(asset.id)}`)
      .then(setFull)
      .catch(() => setFailed(true));
  }, [asset.id]);

  const files = useMemo(() => (full?.files ?? []).filter((f) => !f.requiresAuth), [full]);
  const options = useMemo(() => {
    const formats = new Set<string>();
    const resolutions = new Set<string>();
    for (const f of files) {
      formats.add(f.group && f.group !== "maps" && f.group !== f.format ? f.group : f.format);
      if (f.resolution) resolutions.add(f.resolution);
    }
    return { formats: [...formats], resolutions: [...resolutions].sort((a, b) => parseFloat(a) - parseFloat(b)) };
  }, [files]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    if (format) p.set("format", format);
    if (resolution) p.set("resolution", resolution);
    return p.toString() ? `?${p.toString()}` : "";
  }, [format, resolution]);

  const base = `/v1/assets/${encodeURIComponent(asset.id)}`;
  useEffect(() => {
    if (!files.length) return;
    setSelection(null);
    setSelError(undefined);
    api<FileSelection>(`${base}/files${qs}`).then(setSelection).catch((e: Error) => setSelError(e.message));
  }, [base, qs, files.length]);

  const a = full ?? asset;
  const hero = safeUrl(a.thumbnailUrl);
  const source = safeUrl(a.url);
  const key = getKey();
  const downloadHref = `${base}/download${qs}${key ? `${qs ? "&" : "?"}api_key=${encodeURIComponent(key)}` : ""}`;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const curl = `curl -L -o "${asset.id.replace(/[^a-z0-9]+/gi, "-")}.zip" "${origin}${base}/download${qs}"`;
  const agentPrompt = `Use the 3d-assets MCP server: get_asset("${asset.id}")${format ? ` with format ${format}` : ""}${resolution ? ` at ${resolution}` : ""}, download it into ./assets and tell me the licence.`;

  const rows: [string, React.ReactNode][] = [
    ["Price", a.price ? (a.price.free ? "Free" : a.price.amount != null ? `${a.price.amount} ${a.price.currency ?? ""}` : "Paid") : "Unknown"],
    [
      "Licence",
      a.license ? (
        <span>
          {safeUrl(a.license.url) ? (
            <a className="text-primary hover:underline" href={safeUrl(a.license.url)} target="_blank" rel="noopener noreferrer">{a.license.name}</a>
          ) : (
            a.license.name
          )}
          {a.license.commercialUse && " · commercial use OK"}
          {a.license.attributionRequired && " · attribution required"}
        </span>
      ) : undefined,
    ],
    ["Author", a.author],
    ["Formats", a.formats?.join(", ")],
    ["Resolutions", a.resolutions?.join(", ")],
    ["Polygons", a.polyCount?.toLocaleString()],
    ["Animated", a.animated ? "Yes" : undefined],
    ["Rigged", a.rigged ? "Yes" : undefined],
    ["Asset id", <code className="font-mono text-xs">{a.id}</code>],
  ];

  const is3DModel = a.type === "model" || a.formats?.some((f) => f.includes("gltf") || f.includes("glb") || f.includes("blend") || f.includes("fbx") || f.includes("obj"));
  const editorUrl = `/editor?asset=${encodeURIComponent(asset.id)}&title=${encodeURIComponent(a.title)}`;

  return (
    <div className="space-y-6 px-6 pb-12">
      {/* Asset Preview Thumbnail */}
      {hero ? (
        <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-muted">
          <img src={hero} alt={`Preview of ${a.title}`} referrerPolicy="no-referrer" className="aspect-[4/3] w-full object-cover" />
          {is3DModel && (
            <a
              href={editorUrl}
              className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-white shadow-lg backdrop-blur-sm transition hover:opacity-95 hover:scale-105"
            >
              <FileBox className="size-4" />
              <span>Open in 3D Studio</span>
            </a>
          )}
        </div>
      ) : null}

      {/* Main Action Bar */}
      <div className="flex flex-wrap items-center gap-2">
        {is3DModel && (
          <Button asChild className="rounded-xl bg-primary text-white shadow-sm hover:opacity-95">
            <a href={editorUrl}>
              <FileBox className="size-4" />
              <span>Open in 3D Editor</span>
            </a>
          </Button>
        )}
        {source && (
          <Button variant="outline" className="rounded-xl" asChild>
            <a href={source} target="_blank" rel="noopener noreferrer">
              <span>View on {providerName}</span>
              <ArrowUpRight className="size-4" />
            </a>
          </Button>
        )}
        <ShareButton title={a.title} url={`${origin}/search?asset=${encodeURIComponent(asset.id)}`} />
      </div>

      {/* Description */}
      {a.description && <p className="text-sm leading-relaxed text-muted-foreground">{a.description}</p>}

      {/* Metadata Specification Table */}
      <div className="rounded-2xl border border-border/80 bg-card/60 p-4 shadow-xs">
        <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-muted-foreground">Asset Specifications</h4>
        <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-2.5 text-xs sm:text-sm">
          {rows
            .filter(([, v]) => v !== undefined && v !== "")
            .map(([k, v]) => (
              <div key={k} className="contents">
                <dt className="text-muted-foreground font-medium">{k}</dt>
                <dd className="font-semibold text-foreground">{v}</dd>
              </div>
            ))}
        </dl>
      </div>

      {/* Tags */}
      {a.tags.length > 0 && (
        <div>
          <span className="mb-2 block text-xs font-semibold text-muted-foreground">Tags</span>
          <div className="flex flex-wrap gap-1.5">
            {a.tags.slice(0, 14).map((t) => (
              <Badge key={t} variant="secondary" className="rounded-lg text-[11px] font-medium">
                {t}
              </Badge>
            ))}
          </div>
        </div>
      )}

      <Separator />

      {/* Direct Download Options */}
      <section aria-label="Download Options" className="rounded-2xl border border-border/80 bg-card/80 p-5 shadow-xs">
        <div className="flex items-center justify-between mb-3">
          <h3 className="flex items-center gap-2 font-bold text-sm text-foreground">
            <Download className="size-4 text-primary" /> Download Files
          </h3>
          {a.downloadable ? (
            <span className="rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
              Direct Available
            </span>
          ) : (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
              External Source
            </span>
          )}
        </div>

        {!full && !failed && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="size-4 animate-spin text-primary" /> Checking download servers…
          </p>
        )}

        {(failed || (full && !files.length)) && (
          <div className="rounded-xl border border-border/70 bg-muted/40 p-3 text-xs text-muted-foreground">
            <p>Direct download is not mirrored locally for this source asset.</p>
            {source && (
              <a href={source} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex items-center gap-1 font-semibold text-primary hover:underline">
                Download directly on {providerName} <ArrowUpRight className="size-3" />
              </a>
            )}
          </div>
        )}

        {files.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <select
                aria-label="Format"
                value={format}
                onChange={(e) => setFormat(e.target.value)}
                className="h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium focus:border-primary focus:outline-none"
              >
                <option value="">Auto format</option>
                {options.formats.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              {options.resolutions.length > 0 && (
                <select
                  aria-label="Resolution"
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="h-9 rounded-xl border border-border bg-background px-3 text-xs font-medium focus:border-primary focus:outline-none"
                >
                  <option value="">Auto (2k)</option>
                  {options.resolutions.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              )}
              <Button asChild disabled={!selection?.files.length} className="rounded-xl bg-primary text-white shadow-xs">
                <a href={downloadHref}><Download className="size-4" /> Download Zip</a>
              </Button>
              {selection?.totalBytes != null && <span className="text-xs font-mono text-muted-foreground">{formatBytes(selection.totalBytes)}</span>}
            </div>

            <ul className="space-y-1 text-xs text-muted-foreground rounded-lg border border-border/50 bg-background/50 p-2.5">
              {selError && <li className="text-destructive font-medium">{selError}</li>}
              {!selection && !selError && <li>Selecting file bundle…</li>}
              {selection?.files.length === 0 && <li>No files match this combination.</li>}
              {selection?.files.map((f) => (
                <li key={f.url} className="font-mono text-[11px] flex items-center justify-between">
                  <span>{f.filename}</span>
                  <span className="text-muted-foreground/70">
                    {f.resolution ? `${f.resolution} · ` : ""}
                    {f.includes?.length ? `+ ${f.includes.length} companion files` : ""}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[11px] text-muted-foreground">Multi-file assets (e.g. glTF with PBR textures) are bundled into a single ZIP file.</p>
          </div>
        )}
      </section>

      <section aria-label="Use from code or an agent" className="space-y-3">
        <h3 className="flex items-center gap-2 font-medium"><Terminal className="size-4 text-primary" /> Use it from code or an agent</h3>
        <Snippet icon={<Terminal className="size-3.5" />} label="curl" text={curl} />
        <Snippet icon={<Bot className="size-3.5" />} label="Prompt for your agent" text={agentPrompt} />
      </section>
    </div>
  );
}

function Snippet({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  return (
    <div className="rounded-lg bg-[#0d0d12] p-3 text-zinc-100">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-[11px] text-zinc-400">{icon}{label}</span>
        <CopyButton text={text} />
      </div>
      <pre className="whitespace-pre-wrap break-all font-mono text-[12px] leading-relaxed">{text}</pre>
    </div>
  );
}

/** Share link to this asset (`/search?asset=<id>`, which unfurls with its own preview card). */
function ShareButton({ title, url }: { title: string; url: string }) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    if (typeof navigator.share === "function" && window.matchMedia("(pointer: coarse)").matches) {
      await navigator.share({ title, url }).catch(() => undefined);
      return;
    }
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };
  return (
    <Button variant="outline" onClick={() => void share()}>
      {copied ? <Check className="size-4" /> : <Share2 className="size-4" />}
      {copied ? "Link copied" : "Share"}
    </Button>
  );
}
