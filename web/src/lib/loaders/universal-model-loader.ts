import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { MTLLoader } from "three/examples/jsm/loaders/MTLLoader.js";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader.js";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { PLYLoader } from "three/examples/jsm/loaders/PLYLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { ThreeMFLoader } from "three/examples/jsm/loaders/3MFLoader.js";
import { USDZLoader } from "three/examples/jsm/loaders/USDZLoader.js";
import { TGALoader } from "three/examples/jsm/loaders/TGALoader.js";
import { unzipSync } from "fflate";

export type SupportedFormat =
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

export interface PreviewDescriptor {
  assetId: string;
  provider: string;
  title: string;
  format: SupportedFormat;
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
  restrictedReason?: {
    code: PreviewErrorCode;
    title: string;
    description: string;
    actionLabel?: string;
    actionUrl?: string;
  };
}

export interface LoadProgressCallback {
  (percent: number, statusText: string): void;
}

export interface UniversalLoadOptions {
  onProgress?: LoadProgressCallback;
  dependencies?: PreviewDependency[];
  useProxy?: boolean;
}

export interface UniversalLoadResult {
  scene: THREE.Group;
  format: string;
  sourceType: "direct" | "archive" | "file";
  cleanup: () => void;
  animations?: THREE.AnimationClip[];
}

/** Check if a URL is external to the current origin */
export function isExternalUrl(url: string): boolean {
  if (!url || !url.startsWith("http")) return false;
  try {
    const parsed = new URL(url, window.location.href);
    return parsed.origin !== window.location.origin;
  } catch {
    return false;
  }
}

/** Wrap an external URL in the ModelVerse preview CORS proxy */
export function proxyUrl(url: string): string {
  if (!url) return "";
  if (isExternalUrl(url)) {
    return `/v1/preview/proxy?url=${encodeURIComponent(url)}`;
  }
  return url;
}

/** Detect 3D format from URL or filename */
export function detectFormat(pathOrUrl: string): SupportedFormat {
  const clean = pathOrUrl.split("?")[0]?.toLowerCase() ?? "";
  if (clean.endsWith(".glb")) return "glb";
  if (clean.endsWith(".gltf")) return "gltf";
  if (clean.endsWith(".obj")) return "obj";
  if (clean.endsWith(".fbx")) return "fbx";
  if (clean.endsWith(".stl")) return "stl";
  if (clean.endsWith(".ply")) return "ply";
  if (clean.endsWith(".dae")) return "dae";
  if (clean.endsWith(".3mf")) return "3mf";
  if (clean.endsWith(".usdz")) return "usdz";
  if (clean.endsWith(".zip")) return "zip";
  return "unsupported";
}

/** Get MIME type for file extensions */
function getMimeType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".tga")) return "image/x-tga";
  if (lower.endsWith(".bin")) return "application/octet-stream";
  if (lower.endsWith(".glb")) return "model/gltf-binary";
  if (lower.endsWith(".gltf")) return "model/gltf+json";
  if (lower.endsWith(".obj")) return "text/plain";
  if (lower.endsWith(".mtl")) return "text/plain";
  if (lower.endsWith(".fbx")) return "application/octet-stream";
  if (lower.endsWith(".stl")) return "application/octet-stream";
  if (lower.endsWith(".ply")) return "application/octet-stream";
  if (lower.endsWith(".dae")) return "text/xml";
  if (lower.endsWith(".3mf")) return "application/vnd.ms-package.3dmanufacturing-3dmodel+xml";
  if (lower.endsWith(".usdz")) return "model/vnd.usdz+zip";
  return "application/octet-stream";
}

/** Normalize loaded model scale, geometry normals, and material double-sidedness */
export function normalizeSceneObject(group: THREE.Group): void {
  // Compute initial bounding box
  const box = new THREE.Box3().setFromObject(group);
  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);

  // Auto-scale if model dimensions are unusually huge or microscopic
  if (maxDim > 20) {
    const scaleFactor = 6 / maxDim;
    group.scale.setScalar(scaleFactor);
  } else if (maxDim < 0.2 && maxDim > 0) {
    const scaleFactor = 2 / maxDim;
    group.scale.setScalar(scaleFactor);
  }

  // Ensure all mesh normals are valid and lighting behaves properly
  group.traverse((child) => {
    if ((child as THREE.Mesh).isMesh) {
      const mesh = child as THREE.Mesh;
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      if (mesh.geometry && !mesh.geometry.attributes.normal) {
        mesh.geometry.computeVertexNormals();
      }

      if (mesh.material) {
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        materials.forEach((mat) => {
          if (mat instanceof THREE.Material) {
            mat.side = THREE.DoubleSide; // Avoid backface culling issues on non-manifold models
          }
        });
      }
    }
  });
}

/**
 * Universal model loader: handles GLB, GLTF, OBJ (+MTL), FBX (+TGA), STL, PLY,
 * Collada (DAE), 3MF, USDZ, and ZIP archives with automatic dependency mapping.
 */
export class UniversalModelLoader {
  private dracoLoader?: DRACOLoader;
  private tgaLoader?: TGALoader;

  private getDracoLoader(): DRACOLoader {
    if (!this.dracoLoader) {
      this.dracoLoader = new DRACOLoader();
      this.dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
    }
    return this.dracoLoader;
  }

  /**
   * Load model from a preview descriptor returned by /v1/assets/:id/preview
   */
  async loadFromDescriptor(
    descriptor: PreviewDescriptor,
    options?: UniversalLoadOptions
  ): Promise<UniversalLoadResult> {
    if (descriptor.previewMode === "restricted") {
      throw new Error(descriptor.restrictedReason?.description || "Asset is restricted from direct 3D preview.");
    }

    if (descriptor.previewMode === "archive" && descriptor.archive?.url) {
      options?.onProgress?.(10, "Fetching model archive...");
      const finalArchiveUrl = proxyUrl(descriptor.archive.url);
      const res = await fetch(finalArchiveUrl);
      if (!res.ok) throw new Error(`Failed to download archive: ${res.statusText}`);
      const arrayBuffer = await res.arrayBuffer();
      return this.loadFromZipBuffer(arrayBuffer, options);
    }

    if (descriptor.modelUrl) {
      const format = descriptor.format === "unsupported" ? detectFormat(descriptor.modelUrl) : descriptor.format;
      return this.loadFromUrl(descriptor.modelUrl, format, {
        ...options,
        dependencies: descriptor.dependencies,
      });
    }

    throw new Error("Preview descriptor contains no loadable model URL or archive.");
  }

  /**
   * Load model from a direct URL with optional companion dependencies
   */
  async loadFromUrl(
    url: string,
    format?: SupportedFormat,
    options?: UniversalLoadOptions
  ): Promise<UniversalLoadResult> {
    const resolvedFormat = format && format !== "unsupported" ? format : detectFormat(url);
    const finalUrl = proxyUrl(url);

    if (resolvedFormat === "zip") {
      options?.onProgress?.(10, "Downloading ZIP bundle...");
      const res = await fetch(finalUrl);
      if (!res.ok) throw new Error(`Failed to download zip: ${res.statusText}`);
      const arrayBuffer = await res.arrayBuffer();
      return this.loadFromZipBuffer(arrayBuffer, options);
    }

    // Set up loading manager for relative dependencies (textures, mtl, bin)
    const cleanupUrls: string[] = [];
    const manager = new THREE.LoadingManager();

    if (options?.dependencies && options.dependencies.length > 0) {
      manager.setURLModifier((requestedUrl) => {
        const reqName = requestedUrl.split("/").pop()?.split("?")[0]?.toLowerCase();
        const matched = options.dependencies?.find((dep) => {
          const depName = dep.path.split("/").pop()?.toLowerCase();
          return depName === reqName || dep.path.toLowerCase() === requestedUrl.toLowerCase();
        });
        if (matched) {
          return proxyUrl(matched.url);
        }
        return proxyUrl(requestedUrl);
      });
    } else {
      manager.setURLModifier((requestedUrl) => proxyUrl(requestedUrl));
    }

    options?.onProgress?.(30, `Loading ${resolvedFormat.toUpperCase()} model...`);

    const result = await this.dispatchLoader(finalUrl, resolvedFormat, manager, options);
    normalizeSceneObject(result.scene);

    return {
      scene: result.scene,
      format: resolvedFormat,
      sourceType: "direct",
      animations: result.animations,
      cleanup: () => {
        cleanupUrls.forEach((u) => URL.revokeObjectURL(u));
      },
    };
  }

  /**
   * Load model from local File (e.g. drag & drop or file picker)
   */
  async loadFromFile(file: File, options?: UniversalLoadOptions): Promise<UniversalLoadResult> {
    const format = detectFormat(file.name);
    options?.onProgress?.(10, `Reading ${file.name}...`);

    if (format === "zip") {
      const buffer = await file.arrayBuffer();
      return this.loadFromZipBuffer(buffer, options);
    }

    const blobUrl = URL.createObjectURL(file);
    const cleanupUrls: string[] = [blobUrl];
    const manager = new THREE.LoadingManager();

    try {
      options?.onProgress?.(40, `Parsing ${format.toUpperCase()}...`);
      const result = await this.dispatchLoader(blobUrl, format, manager, options);
      normalizeSceneObject(result.scene);
      return {
        scene: result.scene,
        format,
        sourceType: "file",
        animations: result.animations,
        cleanup: () => {
          cleanupUrls.forEach((u) => URL.revokeObjectURL(u));
        },
      };
    } catch (err) {
      cleanupUrls.forEach((u) => URL.revokeObjectURL(u));
      throw err;
    }
  }

  /**
   * Unpack a ZIP archive in memory and resolve its primary model with textures/materials
   */
  async loadFromZipBuffer(
    buffer: ArrayBuffer,
    options?: UniversalLoadOptions
  ): Promise<UniversalLoadResult> {
    options?.onProgress?.(30, "Unpacking archive entries...");

    const unzipped = unzipSync(new Uint8Array(buffer));
    const cleanupUrls: string[] = [];

    // Map all files in the archive to in-memory Blob URLs
    const blobMap = new Map<string, string>();
    const filesByLower = new Map<string, string>();

    const rankOrder: Record<string, number> = {
      glb: 10,
      gltf: 9,
      obj: 8,
      fbx: 7,
      stl: 6,
      ply: 5,
      dae: 4,
      "3mf": 3,
      usdz: 2,
    };

    interface ModelCandidate {
      path: string;
      format: SupportedFormat;
      rank: number;
      size: number;
    }

    const candidates: ModelCandidate[] = [];

    for (const [filename, data] of Object.entries(unzipped)) {
      // Skip Mac OS metadata directories and hidden files
      if (filename.includes("__MACOSX/") || filename.split("/").pop()?.startsWith(".")) {
        continue;
      }

      const mime = getMimeType(filename);
      const blob = new Blob([data], { type: mime });
      const blobUrl = URL.createObjectURL(blob);
      cleanupUrls.push(blobUrl);

      const normPath = filename.replace(/\\/g, "/");
      const lowerPath = normPath.toLowerCase();
      const baseName = lowerPath.split("/").pop() ?? lowerPath;

      blobMap.set(normPath, blobUrl);
      blobMap.set(lowerPath, blobUrl);
      blobMap.set(baseName, blobUrl);
      filesByLower.set(lowerPath, normPath);

      const ext = detectFormat(filename);
      if (ext in rankOrder) {
        candidates.push({
          path: normPath,
          format: ext,
          rank: rankOrder[ext] ?? 0,
          size: data.byteLength,
        });
      }
    }

    if (candidates.length === 0) {
      cleanupUrls.forEach((u) => URL.revokeObjectURL(u));
      throw new Error("No supported 3D model files found inside the ZIP archive.");
    }

    // Sort candidates: highest format rank first, then root path, then largest file
    candidates.sort((a, b) => {
      if (b.rank !== a.rank) return b.rank - a.rank;
      const depthA = a.path.split("/").length;
      const depthB = b.path.split("/").length;
      if (depthA !== depthB) return depthA - depthB;
      return b.size - a.size;
    });

    const primary = candidates[0]!;
    options?.onProgress?.(50, `Loading ${primary.path}...`);

    // LoadingManager with in-memory URL modifier
    const manager = new THREE.LoadingManager();
    manager.setURLModifier((url) => {
      // 1. Direct blob URL
      if (url.startsWith("blob:")) return url;

      // 2. Path normalization
      const cleanUrl = url.split("?")[0]!;
      const lower = cleanUrl.replace(/\\/g, "/").toLowerCase();
      const base = lower.split("/").pop() ?? lower;

      if (blobMap.has(lower)) return blobMap.get(lower)!;
      if (blobMap.has(base)) return blobMap.get(base)!;

      // 3. Resolve relative to primary model directory
      const modelDir = primary.path.includes("/") ? primary.path.substring(0, primary.path.lastIndexOf("/") + 1) : "";
      const relCandidate = `${modelDir}${cleanUrl}`.toLowerCase();
      if (blobMap.has(relCandidate)) return blobMap.get(relCandidate)!;

      return url;
    });

    const primaryBlobUrl = blobMap.get(primary.path.toLowerCase())!;

    try {
      let scene: THREE.Group;
      let animations: THREE.AnimationClip[] | undefined;

      // Special handling for OBJ + MTL in ZIP archives
      if (primary.format === "obj") {
        // Look for corresponding .mtl in candidates or archive files
        const mtlCandidate = Object.keys(unzipped).find(
          (f) => f.toLowerCase().endsWith(".mtl") && !f.includes("__MACOSX/")
        );

        if (mtlCandidate) {
          const mtlBlobUrl = blobMap.get(mtlCandidate.toLowerCase());
          if (mtlBlobUrl) {
            options?.onProgress?.(65, "Applying material definitions...");
            const mtlLoader = new MTLLoader(manager);
            const materials = await new Promise<MTLLoader.MaterialCreator>((resolve, reject) => {
              mtlLoader.load(mtlBlobUrl, resolve, undefined, reject);
            });
            materials.preload();

            const objLoader = new OBJLoader(manager);
            objLoader.setMaterials(materials);
            scene = await new Promise<THREE.Group>((resolve, reject) => {
              objLoader.load(primaryBlobUrl, resolve, undefined, reject);
            });
          } else {
            const objLoader = new OBJLoader(manager);
            scene = await new Promise<THREE.Group>((resolve, reject) => {
              objLoader.load(primaryBlobUrl, resolve, undefined, reject);
            });
          }
        } else {
          const objLoader = new OBJLoader(manager);
          scene = await new Promise<THREE.Group>((resolve, reject) => {
            objLoader.load(primaryBlobUrl, resolve, undefined, reject);
          });
        }
      } else {
        const dispatched = await this.dispatchLoader(primaryBlobUrl, primary.format, manager, options);
        scene = dispatched.scene;
        animations = dispatched.animations;
      }

      normalizeSceneObject(scene);
      options?.onProgress?.(100, "Model ready");

      return {
        scene,
        format: primary.format,
        sourceType: "archive",
        animations,
        cleanup: () => {
          cleanupUrls.forEach((u) => URL.revokeObjectURL(u));
        },
      };
    } catch (err) {
      cleanupUrls.forEach((u) => URL.revokeObjectURL(u));
      throw err;
    }
  }

  /**
   * Internal dispatcher for format-specific Three.js loaders
   */
  private async dispatchLoader(
    url: string,
    format: SupportedFormat,
    manager: THREE.LoadingManager,
    options?: UniversalLoadOptions
  ): Promise<{ scene: THREE.Group; animations?: THREE.AnimationClip[] }> {
    switch (format) {
      case "glb":
      case "gltf": {
        const loader = new GLTFLoader(manager);
        loader.setDRACOLoader(this.getDracoLoader());
        return new Promise((resolve, reject) => {
          loader.load(
            url,
            (gltf) => {
              resolve({ scene: gltf.scene, animations: gltf.animations });
            },
            (xhr) => {
              if (xhr.total > 0) {
                const percent = Math.round((xhr.loaded / xhr.total) * 100);
                options?.onProgress?.(percent, `Downloading: ${percent}%`);
              }
            },
            reject
          );
        });
      }

      case "obj": {
        const loader = new OBJLoader(manager);
        return new Promise((resolve, reject) => {
          loader.load(
            url,
            (group) => {
              resolve({ scene: group });
            },
            undefined,
            reject
          );
        });
      }

      case "fbx": {
        if (!this.tgaLoader) this.tgaLoader = new TGALoader(manager);
        manager.addHandler(/\.tga$/i, this.tgaLoader);

        const loader = new FBXLoader(manager);
        return new Promise((resolve, reject) => {
          loader.load(
            url,
            (group) => {
              resolve({ scene: group, animations: group.animations });
            },
            undefined,
            reject
          );
        });
      }

      case "stl": {
        const loader = new STLLoader(manager);
        return new Promise((resolve, reject) => {
          loader.load(
            url,
            (geometry) => {
              geometry.computeVertexNormals();
              const material = new THREE.MeshStandardMaterial({
                color: "#547A24",
                roughness: 0.4,
                metalness: 0.3,
              });
              const mesh = new THREE.Mesh(geometry, material);
              const group = new THREE.Group();
              group.add(mesh);
              resolve({ scene: group });
            },
            undefined,
            reject
          );
        });
      }

      case "ply": {
        const loader = new PLYLoader(manager);
        return new Promise((resolve, reject) => {
          loader.load(
            url,
            (geometry) => {
              geometry.computeVertexNormals();
              const hasColors = Boolean(geometry.attributes.color);
              const material = new THREE.MeshStandardMaterial({
                color: hasColors ? 0xffffff : "#547A24",
                vertexColors: hasColors,
                roughness: 0.4,
                metalness: 0.2,
              });
              const mesh = new THREE.Mesh(geometry, material);
              const group = new THREE.Group();
              group.add(mesh);
              resolve({ scene: group });
            },
            undefined,
            reject
          );
        });
      }

      case "dae": {
        const loader = new ColladaLoader(manager);
        return new Promise((resolve, reject) => {
          loader.load(
            url,
            (collada) => {
              const group = new THREE.Group();
              if (collada && collada.scene) {
                group.add(collada.scene);
              }
              resolve({ scene: group });
            },
            undefined,
            reject
          );
        });
      }

      case "3mf": {
        const loader = new ThreeMFLoader(manager);
        return new Promise((resolve, reject) => {
          loader.load(
            url,
            (group) => {
              resolve({ scene: group });
            },
            undefined,
            reject
          );
        });
      }

      case "usdz": {
        const loader = new USDZLoader(manager);
        return new Promise((resolve, reject) => {
          loader.load(
            url,
            (group) => {
              resolve({ scene: group });
            },
            undefined,
            reject
          );
        });
      }

      default:
        throw new Error(`Unsupported model format: ${format}`);
    }
  }
}

export const universalLoader = new UniversalModelLoader();
