import { assertPublicUrl, safeRelative } from "./download.js";
import type { AssetDetails, AssetFile, HttpClient, License } from "./types.js";
import type { AssetService } from "./service.js";

export type PreviewFormat =
  | "glb"
  | "gltf"
  | "obj"
  | "fbx"
  | "stl"
  | "ply"
  | "dae"
  | "3mf"
  | "usdz"
  | "zip"
  | "unsupported";

export type PreviewMode = "direct" | "archive" | "restricted";

export type PreviewErrorCode =
  | "FILE_NOT_FOUND"
  | "UNSUPPORTED_FORMAT"
  | "LICENSE_RESTRICTED"
  | "AUTH_REQUIRED"
  | "MISSING_DEPENDENCY"
  | "FILE_TOO_LARGE"
  | "PROVIDER_UNAVAILABLE"
  | "UNKNOWN_ERROR";

export interface PreviewDependency {
  path: string;
  url: string;
  sizeBytes?: number;
}

export interface PreviewRestrictedReason {
  code: PreviewErrorCode;
  title: string;
  description: string;
  actionLabel?: string;
  actionUrl?: string;
}

export interface PreviewDescriptor {
  assetId: string;
  provider: string;
  title: string;
  format: PreviewFormat;
  previewMode: PreviewMode;
  modelUrl?: string;
  dependencies: PreviewDependency[];
  archive?: {
    url: string;
    totalSizeBytes?: number;
  };
  canDownload: boolean;
  downloadUrl?: string;
  externalUrl?: string;
  license?: License;
  error?: string;
  errorCode?: PreviewErrorCode;
  restrictedReason?: PreviewRestrictedReason;
}

/**
 * Trusted domains for preview proxying (prevents SSRF and open proxy abuse).
 */
const TRUSTED_DOMAINS: (string | RegExp)[] = [
  /(?:^|\.)polyhaven\.(com|org)$/i,
  /(?:^|\.)ambientcg\.com$/i,
  /(?:^|\.)cgbookcase\.com$/i,
  /(?:^|\.)sharetextures\.com$/i,
  /(?:^|\.)blenderkit\.com$/i,
  /(?:^|\.)blendkit\.com$/i,
  /(?:^|\.)fab\.com$/i,
  /(?:^|\.)kenney\.nl$/i,
  /(?:^|\.)poliigon\.com$/i,
  /(?:^|\.)quaternius\.com$/i,
  /(?:^|\.)polyfork\.dev$/i,
  /(?:^|\.)3dassets\.dev$/i,
  /(?:^|\.)sketchfab\.com$/i,
  /(?:^|\.)3dtextures\.me$/i,
  /(?:^|\.)freestylized\.com$/i,
  /(?:^|\.)3dtexel\.com$/i,
  /(?:^|\.)texturecan\.com$/i,
  /(?:^|\.)opengameart\.org$/i,
  /(?:^|\.)textures\.com$/i,
  /(?:^|\.)hdrmaps\.com$/i,
  /(?:^|\.)hdri-hub\.com$/i,
  /(?:^|\.)cgtrader\.com$/i,
  /(?:^|\.)turbosquid\.com$/i,
  /(?:^|\.)itch\.io$/i,
  /(?:^|\.)itch\.zone$/i,
  /(?:^|\.)github\.com$/i,
  /(?:^|\.)githubusercontent\.com$/i,
  /(?:^|\.)googleusercontent\.com$/i,
  /(?:^|\.)googleapis\.com$/i,
  /(?:^|\.)cloudflare-ipfs\.com$/i,
  /(?:^|\.)ipfs\.io$/i,
];

export function isAllowedPreviewUrl(urlString: string): boolean {
  try {
    const u = assertPublicUrl(urlString);
    const host = u.hostname.toLowerCase();
    return TRUSTED_DOMAINS.some((pattern) =>
      typeof pattern === "string" ? host === pattern : pattern.test(host),
    );
  } catch {
    return false;
  }
}

export function buildProxiedUrl(targetUrl: string): string {
  return `/v1/preview/proxy?url=${encodeURIComponent(targetUrl)}`;
}

const MODEL_FORMAT_PREFERENCE: PreviewFormat[] = [
  "glb",
  "gltf",
  "obj",
  "fbx",
  "stl",
  "ply",
  "dae",
  "3mf",
  "usdz",
  "zip",
];

export function detectFormat(f: AssetFile | string): PreviewFormat {
  if (typeof f === "string") {
    const clean = f.split("?")[0]!.toLowerCase();
    for (const fmt of MODEL_FORMAT_PREFERENCE) {
      if (clean.endsWith(`.${fmt}`)) return fmt;
    }
    return "unsupported";
  }

  const norm = (f.format || "").toLowerCase().replace(/^\./, "");
  if (norm === "glb") return "glb";
  if (norm === "gltf") return "gltf";
  if (norm === "obj") return "obj";
  if (norm === "fbx") return "fbx";
  if (norm === "stl") return "stl";
  if (norm === "ply") return "ply";
  if (norm === "dae" || norm === "collada") return "dae";
  if (norm === "3mf") return "3mf";
  if (norm === "usdz" || norm === "usd") return "usdz";
  if (norm === "zip") return "zip";

  const fn = (f.filename || "").toLowerCase();
  for (const fmt of MODEL_FORMAT_PREFERENCE) {
    if (fn.endsWith(`.${fmt}`)) return fmt;
  }

  return "unsupported";
}

/**
 * Universal Asset Resolver:
 * Takes an asset ID, validates files and provider capabilities,
 * selects the optimal 3D model candidate, and returns a normalized descriptor.
 */
export async function resolveAssetPreview(
  service: AssetService,
  assetId: string,
): Promise<PreviewDescriptor> {
  let asset: AssetDetails | null = null;
  try {
    asset = await service.getAsset(assetId);
  } catch (err: any) {
    if (err?.message?.includes("does not support asset details")) {
      const providerId = assetId.split(":")[0] || "";
      return {
        assetId,
        provider: providerId,
        title: assetId,
        format: "unsupported",
        previewMode: "restricted",
        errorCode: "LICENSE_RESTRICTED",
        error:
          "Preview unavailable. This provider restricts direct online preview of this asset. You can view or download the model on the source site if permitted by its licence.",
        canDownload: false,
        dependencies: [],
      };
    }
    return {
      assetId,
      provider: assetId.split(":")[0] || "",
      title: assetId,
      format: "unsupported",
      previewMode: "restricted",
      errorCode: "FILE_NOT_FOUND",
      error: "The requested 3D asset could not be found or retrieved from the provider.",
      canDownload: false,
      dependencies: [],
    };
  }

  if (!asset) {
    return {
      assetId,
      provider: assetId.split(":")[0] || "",
      title: assetId,
      format: "unsupported",
      previewMode: "restricted",
      errorCode: "FILE_NOT_FOUND",
      error: "The requested 3D asset could not be found.",
      canDownload: false,
      dependencies: [],
    };
  }

  const baseDescriptor: Partial<PreviewDescriptor> = {
    assetId: asset.id,
    provider: asset.provider,
    title: asset.title,
    externalUrl: asset.url,
    license: asset.license,
    canDownload: asset.downloadable && asset.files.length > 0,
    downloadUrl: `/v1/assets/${encodeURIComponent(asset.id)}/download`,
  };

  // 1. Providers that restrict direct automated downloads (access: "link" like Fab, Poliigon, TurboSquid)
  const providerInfo = service.getProvider(asset.provider);
  if (providerInfo?.access === "link" || !asset.downloadable || asset.files.length === 0) {
    const isLinkProvider = providerInfo?.access === "link";
    return {
      ...baseDescriptor,
      format: "unsupported",
      previewMode: "restricted",
      errorCode: "LICENSE_RESTRICTED",
      error: isLinkProvider
        ? `Preview unavailable. This asset is hosted on ${providerInfo?.name || asset.provider}, which requires viewing or purchasing directly on the provider's marketplace.`
        : "Preview unavailable. This provider restricts direct online preview of this asset. You can view or download the model on the source site if permitted by its licence.",
      restrictedReason: {
        code: "LICENSE_RESTRICTED",
        title: isLinkProvider ? `${providerInfo?.name || asset.provider} Provider Notice` : "Licence & Provider Restriction",
        description: isLinkProvider
          ? `This model is hosted on ${providerInfo?.name || asset.provider}, which restricts third-party in-browser rendering. You can view or acquire the asset directly on the provider's page.`
          : "Direct 3D in-browser preview is restricted by the provider's licensing terms. You can visit the source page to view or download it.",
        actionLabel: "View on Provider Page",
        actionUrl: asset.url,
      },
      canDownload: false,
      dependencies: [],
    } as PreviewDescriptor;
  }

  // 2. Scan files for supported 3D model formats
  const candidateFiles = asset.files.filter((f) => !f.requiresAuth);
  if (candidateFiles.length === 0) {
    return {
      ...baseDescriptor,
      format: "unsupported",
      previewMode: "restricted",
      errorCode: "AUTH_REQUIRED",
      error: "Preview unavailable. This asset requires an authenticated creator account on the source provider.",
      restrictedReason: {
        code: "AUTH_REQUIRED",
        title: "Provider Authentication Required",
        description: "This asset requires authentication or login on the source provider's website before files can be accessed.",
        actionLabel: "Open Provider Page",
        actionUrl: asset.url,
      },
      canDownload: false,
      dependencies: [],
    } as PreviewDescriptor;
  }

  // Find the highest-priority supported model file
  let chosenFile: AssetFile | null = null;
  let chosenFormat: PreviewFormat = "unsupported";

  for (const fmt of MODEL_FORMAT_PREFERENCE) {
    const match = candidateFiles.find((f) => detectFormat(f) === fmt);
    if (match) {
      chosenFile = match;
      chosenFormat = fmt;
      break;
    }
  }

  if (!chosenFile || chosenFormat === "unsupported") {
    // Only raw formats like .blend or non-model files are available
    const proprietaryFile = asset.files.find((f) => /\.(blend|max|c4d|ma|mb|hip|zpr)$/i.test(f.filename || f.url || ""));
    const ext = proprietaryFile?.filename?.split(".").pop()?.toUpperCase() || "native 3D project";
    return {
      ...baseDescriptor,
      format: "unsupported",
      previewMode: "restricted",
      errorCode: "UNSUPPORTED_FORMAT",
      error:
        `Preview unavailable. This model uses a proprietary ${ext} format (such as a raw .blend or project archive) that ModelVerse Studio cannot currently process in the browser. You can still download the original file.`,
      restrictedReason: {
        code: "UNSUPPORTED_FORMAT",
        title: `Proprietary ${ext} Format`,
        description: `This asset is provided as a native ${ext} project file (e.g. Blender or 3ds Max). ModelVerse 3D Studio supports standard interchange formats (GLB, glTF, OBJ, FBX, STL, PLY, DAE, 3MF, USDZ). You can download the original file to open in your native 3D software.`,
        actionLabel: "Download Original File",
        actionUrl: baseDescriptor.downloadUrl,
      },
      dependencies: [],
    } as PreviewDescriptor;
  }

  // 3. Handle ZIP archives
  if (chosenFormat === "zip") {
    return {
      ...baseDescriptor,
      format: "zip",
      previewMode: "archive",
      modelUrl: buildProxiedUrl(chosenFile.url),
      archive: {
        url: buildProxiedUrl(chosenFile.url),
        totalSizeBytes: chosenFile.sizeBytes,
      },
      dependencies: [],
    } as PreviewDescriptor;
  }

  // 4. Handle direct model files (GLB, GLTF, OBJ, FBX, STL, PLY, DAE, 3MF, USDZ)
  const dependencies: PreviewDependency[] = [];
  if (chosenFile.includes && chosenFile.includes.length > 0) {
    for (const inc of chosenFile.includes) {
      try {
        dependencies.push({
          path: safeRelative(inc.path),
          url: buildProxiedUrl(inc.url),
          sizeBytes: inc.sizeBytes,
        });
      } catch {
        // Skip malformed paths
      }
    }
  }

  return {
    ...baseDescriptor,
    format: chosenFormat,
    previewMode: "direct",
    modelUrl: buildProxiedUrl(chosenFile.url),
    dependencies,
  } as PreviewDescriptor;
}
