import { describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { AssetService } from "../src/core/service.js";
import {
  detectFormat,
  isAllowedPreviewUrl,
  resolveAssetPreview,
} from "../src/core/preview-resolver.js";
import type { AssetDetails, Provider } from "../src/core/types.js";
import { bytesHttp, CRATE, fakeProvider } from "./fakes.js";

const OBJ_ASSET: AssetDetails = {
  id: "fake:car",
  provider: "fake",
  nativeId: "car",
  title: "Sports Car",
  type: "model",
  tags: ["car", "vehicle"],
  url: "https://fake.example/car",
  license: { name: "CC0" },
  price: { free: true },
  downloadable: true,
  files: [
    {
      url: "https://cdn.fake.example/car.obj",
      filename: "car.obj",
      format: "obj",
      includes: [
        { path: "car.mtl", url: "https://cdn.fake.example/car.mtl", sizeBytes: 100 },
        { path: "textures/body.png", url: "https://cdn.fake.example/textures/body.png", sizeBytes: 500 },
      ],
    },
  ],
};

const ZIP_ASSET: AssetDetails = {
  id: "fake:castle",
  provider: "fake",
  nativeId: "castle",
  title: "Medieval Castle Kit",
  type: "model",
  tags: ["castle"],
  url: "https://fake.example/castle",
  license: { name: "CC0" },
  price: { free: true },
  downloadable: true,
  files: [
    {
      url: "https://cdn.fake.example/castle_bundle.zip",
      filename: "castle_bundle.zip",
      format: "zip",
      sizeBytes: 10240,
    },
  ],
};

const BLEND_ONLY_ASSET: AssetDetails = {
  id: "fake:character",
  provider: "fake",
  nativeId: "character",
  title: "Sculpted Character",
  type: "model",
  tags: ["character"],
  url: "https://fake.example/character",
  license: { name: "CC-BY" },
  price: { free: true },
  downloadable: true,
  files: [
    {
      url: "https://cdn.fake.example/character.blend",
      filename: "character.blend",
      format: "blend",
    },
  ],
};

const RESTRICTED_PROVIDER_ASSET: AssetDetails = {
  id: "fab:alien",
  provider: "fab",
  nativeId: "alien",
  title: "Sci-Fi Alien Warrior",
  type: "model",
  tags: ["alien"],
  url: "https://www.fab.com/listings/alien-warrior",
  license: { name: "Standard License" },
  price: { free: false, amount: 25, currency: "USD" },
  downloadable: false,
  files: [],
};

const testProvider: Provider = {
  ...fakeProvider,
  getAsset: async (id) => {
    if (id === "crate") return CRATE;
    if (id === "car") return OBJ_ASSET;
    if (id === "castle") return ZIP_ASSET;
    if (id === "character") return BLEND_ONLY_ASSET;
    return null;
  },
};

const restrictedFabProvider: Provider = {
  id: "fab",
  name: "Fab",
  homepage: "https://www.fab.com",
  description: "Epic Games Fab marketplace",
  assetTypes: ["model"],
  access: "link",
  pricing: "paid",
  supportsDownload: false,
  buildSearchUrl: (q) => `https://www.fab.com/search?q=${encodeURIComponent(q.query)}`,
  search: async () => ({ assets: [] }),
  getAsset: async (id) => {
    if (id === "alien") return RESTRICTED_PROVIDER_ASSET;
    return null;
  },
};

describe("3D Preview Resolver Unit Tests", () => {
  it("detects formats correctly from filenames and URLs", () => {
    expect(detectFormat("model.glb")).toBe("glb");
    expect(detectFormat("https://cdn.example.com/asset.gltf?token=123")).toBe("gltf");
    expect(detectFormat("path/to/mesh.obj")).toBe("obj");
    expect(detectFormat("scene.fbx")).toBe("fbx");
    expect(detectFormat("print.stl")).toBe("stl");
    expect(detectFormat("scan.ply")).toBe("ply");
    expect(detectFormat("scene.dae")).toBe("dae");
    expect(detectFormat("part.3mf")).toBe("3mf");
    expect(detectFormat("apple.usdz")).toBe("usdz");
    expect(detectFormat("archive.zip")).toBe("zip");
    expect(detectFormat("project.blend")).toBe("unsupported");
    expect(detectFormat("scene.max")).toBe("unsupported");
    expect(detectFormat("document.pdf")).toBe("unsupported");
  });

  it("validates allowed preview URLs against SSRF and whitelist", () => {
    // Allowed external provider CDNs
    expect(isAllowedPreviewUrl("https://raw.githubusercontent.com/user/repo/model.glb")).toBe(true);
    expect(isAllowedPreviewUrl("https://media.githubusercontent.com/media/user/repo/model.glb")).toBe(true);
    expect(isAllowedPreviewUrl("https://dl.polyhaven.org/file/ph-assets/models/crate.glb")).toBe(true);
    expect(isAllowedPreviewUrl("https://opengameart.org/sites/default/files/model.zip")).toBe(true);

    // Disallowed local and internal hosts (SSRF prevention)
    expect(isAllowedPreviewUrl("http://localhost:8787/secret")).toBe(false);
    expect(isAllowedPreviewUrl("http://127.0.0.1:8080/data")).toBe(false);
    expect(isAllowedPreviewUrl("http://169.254.169.254/latest/meta-data")).toBe(false);
    expect(isAllowedPreviewUrl("http://192.168.1.1/admin")).toBe(false);
    expect(isAllowedPreviewUrl("http://10.0.0.5/api")).toBe(false);

    // Disallowed non-HTTP schemes
    expect(isAllowedPreviewUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedPreviewUrl("data:text/plain;base64,AAAA")).toBe(false);
    expect(isAllowedPreviewUrl("ftp://ftp.example.com/file")).toBe(false);
  });

  it("resolves direct GLTF asset with companion dependencies", async () => {
    const http = bytesHttp();
    const service = new AssetService({ providers: [testProvider], http });
    const descriptor = await resolveAssetPreview(service, "fake:crate");

    expect(descriptor.format).toBe("gltf");
    expect(descriptor.previewMode).toBe("direct");
    expect(descriptor.modelUrl).toContain("crate_1k.gltf");
    expect(descriptor.dependencies.length).toBeGreaterThan(0);
    expect(descriptor.dependencies[0]?.path).toBe("textures/crate_diff_1k.jpg");
    expect(descriptor.canDownload).toBe(true);
  });

  it("resolves OBJ asset with MTL companion dependencies", async () => {
    const http = bytesHttp();
    const service = new AssetService({ providers: [testProvider], http });
    const descriptor = await resolveAssetPreview(service, "fake:car");

    expect(descriptor.format).toBe("obj");
    expect(descriptor.previewMode).toBe("direct");
    expect(descriptor.modelUrl).toContain("car.obj");
    expect(descriptor.dependencies).toHaveLength(2);
    expect(descriptor.dependencies.some((d) => d.path === "car.mtl")).toBe(true);
  });

  it("resolves archive mode for ZIP bundles", async () => {
    const http = bytesHttp();
    const service = new AssetService({ providers: [testProvider], http });
    const descriptor = await resolveAssetPreview(service, "fake:castle");

    expect(descriptor.format).toBe("zip");
    expect(descriptor.previewMode).toBe("archive");
    expect(descriptor.archive?.url).toContain("castle_bundle.zip");
  });

  it("classifies proprietary raw project formats as restricted with informative guidance", async () => {
    const http = bytesHttp();
    const service = new AssetService({ providers: [testProvider], http });
    const descriptor = await resolveAssetPreview(service, "fake:character");

    expect(descriptor.previewMode).toBe("restricted");
    expect(descriptor.restrictedReason?.code).toBe("UNSUPPORTED_FORMAT");
    expect(descriptor.restrictedReason?.description).toContain("Blender");
    expect(descriptor.canDownload).toBe(true);
  });

  it("classifies external marketplace assets as restricted without false technical errors", async () => {
    const http = bytesHttp();
    const service = new AssetService({ providers: [restrictedFabProvider], http });
    const descriptor = await resolveAssetPreview(service, "fab:alien");

    expect(descriptor.previewMode).toBe("restricted");
    expect(descriptor.restrictedReason?.code).toBe("LICENSE_RESTRICTED");
    expect(descriptor.restrictedReason?.title).toContain("Provider");
    expect(descriptor.restrictedReason?.actionUrl).toBe("https://www.fab.com/listings/alien-warrior");
    expect(descriptor.canDownload).toBe(false);
  });
});

describe("3D Preview HTTP API Endpoints", () => {
  function makeTestApp() {
    const http = bytesHttp();
    const service = new AssetService({
      providers: [testProvider, restrictedFabProvider],
      http,
    });
    return createApp(service);
  }

  it("GET /v1/assets/:id/preview returns 200 with descriptor", async () => {
    const app = makeTestApp();
    const res = await app.request("/v1/assets/fake:crate/preview");
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.assetId).toBe("fake:crate");
    expect(body.format).toBe("gltf");
    expect(body.previewMode).toBe("direct");
  });

  it("GET /v1/assets/:id/preview returns 404 for unknown asset", async () => {
    const app = makeTestApp();
    const res = await app.request("/v1/assets/fake:unknown-12345/preview");
    expect(res.status).toBe(404);
  });

  it("GET /v1/preview/proxy blocks disallowed target URLs", async () => {
    const app = makeTestApp();
    // Missing URL
    const res1 = await app.request("/v1/preview/proxy");
    expect(res1.status).toBe(400);

    // SSRF attempt to localhost
    const res2 = await app.request("/v1/preview/proxy?url=http://127.0.0.1:8787/v1/stats");
    expect(res2.status).toBe(403);
  });

  it("OPTIONS /v1/preview/proxy handles CORS preflight", async () => {
    const app = makeTestApp();
    const res = await app.request("/v1/preview/proxy", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
