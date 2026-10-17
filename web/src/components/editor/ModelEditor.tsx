import { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/examples/jsm/loaders/DRACOLoader.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import {
  ArrowLeft,
  Camera,
  Download,
  Grid,
  Info,
  Maximize2,
  Minimize2,
  Palette,
  RotateCcw,
  Sliders,
  Upload,
  Box,
  Check,
  AlertCircle,
} from "lucide-react";
import { api, type Asset, type AssetFile } from "../search/api";

interface MeshEntry {
  id: string;
  name: string;
  mesh: THREE.Mesh;
  originalColor: string;
}

interface PresetModel {
  id: string;
  name: string;
  category: string;
  create: () => THREE.Group;
}

// Built-in procedural models that work completely offline without network latency
function createGeometricPrism(): THREE.Group {
  const group = new THREE.Group();
  group.name = "ModelVerse Prism";

  const geom = new THREE.OctahedronGeometry(1.6, 0);
  const mat = new THREE.MeshStandardMaterial({
    color: "#6366f1",
    roughness: 0.25,
    metalness: 0.8,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = "Prism Body";
  mesh.castShadow = true;
  group.add(mesh);

  const ringGeom = new THREE.TorusGeometry(2.3, 0.08, 16, 64);
  const ringMat = new THREE.MeshStandardMaterial({
    color: "#06b6d4",
    roughness: 0.2,
    metalness: 0.9,
  });
  const ring = new THREE.Mesh(ringGeom, ringMat);
  ring.rotation.x = Math.PI / 2.3;
  ring.name = "Orbital Ring";
  group.add(ring);

  return group;
}

function createModernChair(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Modern Lounge Chair";

  // Seat
  const seatGeom = new THREE.BoxGeometry(2, 0.35, 2);
  const fabricMat = new THREE.MeshStandardMaterial({
    color: "#7c3aed",
    roughness: 0.7,
    metalness: 0.1,
  });
  const seat = new THREE.Mesh(seatGeom, fabricMat);
  seat.position.y = 1.0;
  seat.name = "Seat Cushion";
  seat.castShadow = true;
  group.add(seat);

  // Backrest
  const backGeom = new THREE.BoxGeometry(2, 1.8, 0.35);
  const back = new THREE.Mesh(backGeom, fabricMat);
  back.position.set(0, 2.0, -0.85);
  back.name = "Backrest";
  back.castShadow = true;
  group.add(back);

  // 4 Legs
  const legMat = new THREE.MeshStandardMaterial({
    color: "#334155",
    roughness: 0.3,
    metalness: 0.8,
  });
  const legPositions: [number, number, number][] = [
    [-0.8, 0.5, -0.8],
    [0.8, 0.5, -0.8],
    [-0.8, 0.5, 0.8],
    [0.8, 0.5, 0.8],
  ];
  legPositions.forEach((pos, idx) => {
    const legGeom = new THREE.CylinderGeometry(0.06, 0.09, 1.0, 16);
    const leg = new THREE.Mesh(legGeom, legMat);
    leg.position.set(...pos);
    leg.name = `Leg ${idx + 1}`;
    leg.castShadow = true;
    group.add(leg);
  });

  return group;
}

function createStylizedTree(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Stylized Pine Tree";

  // Trunk
  const trunkGeom = new THREE.CylinderGeometry(0.2, 0.35, 1.8, 8);
  const trunkMat = new THREE.MeshStandardMaterial({
    color: "#78350f",
    roughness: 0.9,
    metalness: 0.05,
  });
  const trunk = new THREE.Mesh(trunkGeom, trunkMat);
  trunk.position.y = 0.9;
  trunk.name = "Tree Trunk";
  trunk.castShadow = true;
  group.add(trunk);

  // Foliage cones
  const foliageMat = new THREE.MeshStandardMaterial({
    color: "#10b981",
    roughness: 0.6,
    metalness: 0.1,
    flatShading: true,
  });

  const layers = [
    { radius: 1.6, height: 1.5, y: 1.9, name: "Lower Foliage" },
    { radius: 1.25, height: 1.3, y: 2.8, name: "Middle Foliage" },
    { radius: 0.85, height: 1.1, y: 3.6, name: "Top Foliage" },
  ];

  layers.forEach((layer) => {
    const coneGeom = new THREE.ConeGeometry(layer.radius, layer.height, 8);
    const cone = new THREE.Mesh(coneGeom, foliageMat);
    cone.position.y = layer.y;
    cone.name = layer.name;
    cone.castShadow = true;
    group.add(cone);
  });

  return group;
}

function createSciFiCrate(): THREE.Group {
  const group = new THREE.Group();
  group.name = "Sci-Fi Cargo Crate";

  // Outer crate body
  const crateGeom = new THREE.BoxGeometry(2, 2, 2);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: "#0f172a",
    roughness: 0.35,
    metalness: 0.75,
  });
  const crate = new THREE.Mesh(crateGeom, bodyMat);
  crate.position.y = 1.0;
  crate.name = "Crate Body";
  crate.castShadow = true;
  group.add(crate);

  // Accent band
  const bandGeom = new THREE.BoxGeometry(2.05, 0.3, 2.05);
  const bandMat = new THREE.MeshStandardMaterial({
    color: "#06b6d4",
    roughness: 0.2,
    metalness: 0.85,
  });
  const band = new THREE.Mesh(bandGeom, bandMat);
  band.position.y = 1.0;
  band.name = "Neon Band";
  group.add(band);

  return group;
}

const PRESETS: PresetModel[] = [
  { id: "prism", name: "Geometric Prism", category: "Abstract", create: createGeometricPrism },
  { id: "chair", name: "Modern Lounge Chair", category: "Furniture", create: createModernChair },
  { id: "tree", name: "Stylized Pine Tree", category: "Nature", create: createStylizedTree },
  { id: "crate", name: "Sci-Fi Cargo Crate", category: "Game Props", create: createSciFiCrate },
];

const COLOR_SWATCHES = [
  "#6366f1", // Indigo
  "#7c3aed", // Violet
  "#06b6d4", // Cyan
  "#3b82f6", // Blue
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#ef4444", // Rose/Red
  "#ec4899", // Pink
  "#f8fafc", // White/Slate
  "#0f172a", // Dark Charcoal
];

export default function ModelEditor() {
  const mountRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const currentModelGroup = useRef<THREE.Group | null>(null);
  const gridHelperRef = useRef<THREE.GridHelper | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [modelName, setModelName] = useState("Geometric Prism");
  const [selectedPreset, setSelectedPreset] = useState("prism");
  const [loading, setLoading] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState("Loading model...");
  const [error, setError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Viewport Settings
  const [showGrid, setShowGrid] = useState(true);
  const [viewportBg, setViewportBg] = useState<"light" | "studio" | "dark">("light");

  // Mesh List & Materials
  const [meshes, setMeshes] = useState<MeshEntry[]>([]);
  const [selectedMeshId, setSelectedMeshId] = useState<string>("all");
  const [currentColor, setCurrentColor] = useState("#6366f1");
  const [roughness, setRoughness] = useState(0.3);
  const [metalness, setMetalness] = useState(0.6);
  const [isWireframe, setIsWireframe] = useState(false);

  // Transform controls
  const [scale, setScale] = useState(1.0);
  const [rotX, setRotX] = useState(0);
  const [rotY, setRotY] = useState(0);
  const [rotZ, setRotZ] = useState(0);

  // Stats
  const [stats, setStats] = useState({
    triangles: 0,
    vertices: 0,
    meshCount: 0,
    dimensions: { x: 0, y: 0, z: 0 },
  });

  const [exporting, setExporting] = useState(false);
  const [exportSuccess, setExportSuccess] = useState(false);

  // 1. Initialize Scene & Three.js Canvas
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Create Scene
    const scene = new THREE.Scene();
    sceneRef.current = scene;
    scene.background = new THREE.Color("#f8fafc");

    // Camera
    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(4, 3, 5);
    cameraRef.current = camera;

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.shadowMap.enabled = true;
    rendererRef.current = renderer;

    container.innerHTML = "";
    container.appendChild(renderer.domElement);

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.maxDistance = 40;
    controls.minDistance = 0.5;
    controlsRef.current = controls;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
    scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight1.position.set(6, 10, 6);
    dirLight1.castShadow = true;
    dirLight1.shadow.mapSize.width = 1024;
    dirLight1.shadow.mapSize.height = 1024;
    scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0xa5b4fc, 0.8);
    dirLight2.position.set(-6, 4, -6);
    scene.add(dirLight2);

    // Ground Grid Helper
    const grid = new THREE.GridHelper(16, 16, 0x6366f1, 0xe2e8f0);
    grid.position.y = 0;
    gridHelperRef.current = grid;
    scene.add(grid);

    // Ground shadow receiver plane
    const planeGeo = new THREE.PlaneGeometry(24, 24);
    const planeMat = new THREE.ShadowMaterial({ opacity: 0.12 });
    const shadowPlane = new THREE.Mesh(planeGeo, planeMat);
    shadowPlane.rotation.x = -Math.PI / 2;
    shadowPlane.position.y = -0.005;
    shadowPlane.receiveShadow = true;
    scene.add(shadowPlane);

    // Animation Loop
    let reqId: number;
    const animate = () => {
      reqId = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    // Resize Handler
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const width = container.clientWidth;
      const height = container.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    return () => {
      cancelAnimationFrame(reqId);
      resizeObserver.disconnect();
      renderer.dispose();
      controls.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // 2. Center and compute statistics for any loaded model group
  const setupModelInScene = useCallback((group: THREE.Group, name: string) => {
    const scene = sceneRef.current;
    if (!scene) return;

    // Remove previous model
    if (currentModelGroup.current) {
      scene.remove(currentModelGroup.current);
    }

    currentModelGroup.current = group;
    scene.add(group);
    setModelName(name);

    // Compute bounding box
    const box = new THREE.Box3().setFromObject(group);
    const size = new THREE.Vector3();
    const center = new THREE.Vector3();
    box.getSize(size);
    box.getCenter(center);

    // Normalize model position so bottom is at y=0 and center at x=0, z=0
    group.position.x -= center.x;
    group.position.y -= box.min.y;
    group.position.z -= center.z;

    // Reset transform state
    setScale(1.0);
    setRotX(0);
    setRotY(0);
    setRotZ(0);

    // Calculate stats & collect meshes
    let triangles = 0;
    let vertices = 0;
    const meshList: MeshEntry[] = [];

    group.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        m.castShadow = true;
        m.receiveShadow = true;

        const geom = m.geometry;
        if (geom) {
          if (geom.index) {
            triangles += geom.index.count / 3;
          } else if (geom.attributes.position) {
            triangles += geom.attributes.position.count / 3;
          }
          if (geom.attributes.position) {
            vertices += geom.attributes.position.count;
          }
        }

        let origColor = "#6366f1";
        if (m.material) {
          const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as any;
          if (mat && mat.color && typeof mat.color.getHexString === "function") {
            origColor = `#${mat.color.getHexString()}`;
          }
        }

        meshList.push({
          id: m.uuid,
          name: m.name || `Mesh ${meshList.length + 1}`,
          mesh: m,
          originalColor: origColor,
        });
      }
    });

    setStats({
      triangles: Math.round(triangles),
      vertices: Math.round(vertices),
      meshCount: meshList.length,
      dimensions: {
        x: parseFloat(size.x.toFixed(2)),
        y: parseFloat(size.y.toFixed(2)),
        z: parseFloat(size.z.toFixed(2)),
      },
    });

    setMeshes(meshList);
    setSelectedMeshId("all");
    if (meshList[0]) {
      setCurrentColor(meshList[0].originalColor);
    }

    // Adjust camera distance to fit model
    if (cameraRef.current && controlsRef.current) {
      const maxDim = Math.max(size.x, size.y, size.z, 1.5);
      const fov = cameraRef.current.fov * (Math.PI / 180);
      const cameraDistance = Math.abs(maxDim / Math.sin(fov / 2)) * 0.9;
      cameraRef.current.position.set(cameraDistance * 0.8, cameraDistance * 0.6, cameraDistance * 0.8);
      controlsRef.current.target.set(0, size.y * 0.4, 0);
      controlsRef.current.update();
    }
  }, []);

  // 3. Load Preset Model
  const loadPreset = useCallback(
    (presetId: string) => {
      const preset = PRESETS.find((p) => p.id === presetId);
      if (!preset) return;
      setError(null);
      setSelectedPreset(presetId);
      const group = preset.create();
      setupModelInScene(group, preset.name);
    },
    [setupModelInScene]
  );

  // 4. Load GLB/GLTF from URL or Blob
  const loadGLBFromUrl = useCallback(
    (url: string, name: string) => {
      setLoading(true);
      setLoadingMessage(`Loading ${name}...`);
      setError(null);

      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath("https://www.gstatic.com/draco/versioned/decoders/1.5.7/");
      const loader = new GLTFLoader();
      loader.setDRACOLoader(dracoLoader);
      loader.load(
        url,
        (gltf) => {
          setupModelInScene(gltf.scene, name);
          setLoading(false);
        },
        (xhr) => {
          if (xhr.total > 0) {
            const percent = Math.round((xhr.loaded / xhr.total) * 100);
            setLoadingMessage(`Downloading: ${percent}%`);
          }
        },
        (err) => {
          console.error("Error loading 3D model:", err);
          setError("Failed to load the 3D model. It may require cross-origin access or direct download.");
          setLoading(false);
        }
      );
    },
    [setupModelInScene]
  );

  // 5. Initial setup: Check URL query parameters (?asset= or ?model=)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const assetId = params.get("asset");
    const modelUrl = params.get("model");
    const titleParam = params.get("title");

    if (modelUrl) {
      loadGLBFromUrl(modelUrl, titleParam || "Custom Model");
      return;
    }

    if (assetId) {
      setLoading(true);
      setLoadingMessage("Fetching asset details...");
      api<Asset>(`/v1/assets/${encodeURIComponent(assetId)}`)
        .then(async (asset) => {
          const title = titleParam || asset.title;
          setModelName(title);

          // Attempt to find direct GLB or glTF file
          try {
            const fileData = await api<{ files: AssetFile[] }>(
              `/v1/assets/${encodeURIComponent(assetId)}/files?format=glb`
            );
            const glbFile = fileData.files.find((f) => f.format === "glb" || f.filename?.endsWith(".glb"));
            if (glbFile && glbFile.url) {
              loadGLBFromUrl(glbFile.url, title);
              return;
            }
          } catch {
            // fallback
          }

          // Use download endpoint
          const directUrl = `/v1/assets/${encodeURIComponent(assetId)}/download?format=glb`;
          loadGLBFromUrl(directUrl, title);
        })
        .catch((e) => {
          console.error(e);
          setError("Could not retrieve model files for this asset. Loading default 3D prism.");
          setLoading(false);
          loadPreset("prism");
        });
      return;
    }

    // Default preset
    loadPreset("prism");
  }, [loadGLBFromUrl, loadPreset]);

  // 6. Handle local file upload (drag & drop or button)
  const handleFileUpload = (file: File) => {
    if (!file.name.match(/\.(glb|gltf)$/i)) {
      setError("Please select a .glb or .gltf file.");
      return;
    }
    const blobUrl = URL.createObjectURL(file);
    const cleanName = file.name.replace(/\.[^/.]+$/, "");
    loadGLBFromUrl(blobUrl, cleanName);
  };

  // 7. Update Material Color, Roughness, Metalness & Wireframe
  const applyMaterialChanges = (
    colorHex: string,
    newRoughness: number,
    newMetalness: number,
    wireframe: boolean
  ) => {
    if (!currentModelGroup.current) return;

    currentModelGroup.current.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const m = child as THREE.Mesh;
        if (selectedMeshId === "all" || m.uuid === selectedMeshId) {
          if (m.material) {
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((matItem) => {
              const mat = matItem as any;
              if (mat && mat.color && typeof mat.color.set === "function") {
                mat.color.set(colorHex);
              }
              if ("roughness" in mat) {
                mat.roughness = newRoughness;
              }
              if ("metalness" in mat) {
                mat.metalness = newMetalness;
              }
              if ("wireframe" in mat) {
                mat.wireframe = wireframe;
              }
              mat.needsUpdate = true;
            });
          }
        }
      }
    });
  };

  // 8. Transform Handlers
  const handleScaleChange = (newScale: number) => {
    setScale(newScale);
    if (currentModelGroup.current) {
      currentModelGroup.current.scale.set(newScale, newScale, newScale);
    }
  };

  const handleRotationChange = (axis: "x" | "y" | "z", degrees: number) => {
    const rad = (degrees * Math.PI) / 180;
    if (axis === "x") {
      setRotX(degrees);
      if (currentModelGroup.current) currentModelGroup.current.rotation.x = rad;
    } else if (axis === "y") {
      setRotY(degrees);
      if (currentModelGroup.current) currentModelGroup.current.rotation.y = rad;
    } else if (axis === "z") {
      setRotZ(degrees);
      if (currentModelGroup.current) currentModelGroup.current.rotation.z = rad;
    }
  };

  const resetTransforms = () => {
    handleScaleChange(1.0);
    handleRotationChange("x", 0);
    handleRotationChange("y", 0);
    handleRotationChange("z", 0);
  };

  const resetCamera = () => {
    if (controlsRef.current && cameraRef.current && currentModelGroup.current) {
      const box = new THREE.Box3().setFromObject(currentModelGroup.current);
      const size = new THREE.Vector3();
      box.getSize(size);
      const maxDim = Math.max(size.x, size.y, size.z, 1.5);
      cameraRef.current.position.set(maxDim * 1.5, maxDim * 1.2, maxDim * 1.5);
      controlsRef.current.target.set(0, size.y * 0.4, 0);
      controlsRef.current.update();
    }
  };

  // 9. Update Viewport Background
  const changeBackground = (mode: "light" | "studio" | "dark") => {
    setViewportBg(mode);
    if (!sceneRef.current) return;
    if (mode === "light") {
      sceneRef.current.background = new THREE.Color("#f8fafc");
      if (gridHelperRef.current) gridHelperRef.current.visible = showGrid;
    } else if (mode === "studio") {
      sceneRef.current.background = new THREE.Color("#1e1b4b");
    } else {
      sceneRef.current.background = new THREE.Color("#09090b");
    }
  };

  // 10. Toggle Grid
  const toggleGrid = () => {
    const next = !showGrid;
    setShowGrid(next);
    if (gridHelperRef.current) {
      gridHelperRef.current.visible = next;
    }
  };

  // 11. Export as GLB
  const exportAsGLB = () => {
    if (!currentModelGroup.current) return;
    setExporting(true);

    const exporter = new GLTFExporter();
    exporter.parse(
      currentModelGroup.current,
      (gltf) => {
        const blob = new Blob([gltf as ArrayBuffer], { type: "model/gltf-binary" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        const cleanName = modelName.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "modelverse-asset";
        a.href = url;
        a.download = `${cleanName}-customized.glb`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setExporting(false);
        setExportSuccess(true);
        setTimeout(() => setExportSuccess(false), 3000);
      },
      (error) => {
        console.error("GLTF export error:", error);
        setError("Error exporting GLB model.");
        setExporting(false);
      },
      { binary: true }
    );
  };

  return (
    <div className={cn("flex flex-col bg-background text-foreground", isFullscreen ? "fixed inset-0 z-50 h-screen" : "min-h-[calc(100vh-3.5rem)]")}>
      {/* Hidden File Input for .glb/.gltf */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".glb,.gltf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFileUpload(file);
        }}
      />

      {/* Top Workspace Toolbar */}
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/80 bg-card px-4 sm:px-6">
        <div className="flex items-center gap-3">
          <a
            href="/search"
            className="inline-flex items-center gap-1.5 rounded-full border border-border/70 px-3 py-1 text-xs font-medium text-muted-foreground transition hover:border-primary/50 hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" />
            <span className="hidden sm:inline">Back to Search</span>
          </a>
          <div className="h-4 w-px bg-border/60" />
          <div className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <Box className="size-4" />
            </span>
            <div>
              <h1 className="line-clamp-1 text-sm font-semibold tracking-tight">{modelName}</h1>
              <p className="text-[11px] text-muted-foreground">3D Interactive Creative Canvas</p>
            </div>
          </div>
        </div>

        {/* Preset Selector & Action Buttons */}
        <div className="flex items-center gap-2">
          {/* Preset Picker */}
          <div className="hidden items-center gap-1.5 md:flex">
            <span className="text-xs text-muted-foreground">Presets:</span>
            <select
              value={selectedPreset}
              onChange={(e) => loadPreset(e.target.value)}
              className="h-8 rounded-lg border border-border bg-background px-2.5 text-xs font-medium focus:border-primary focus:outline-none"
            >
              {PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Upload Button */}
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-foreground transition hover:bg-accent"
            title="Upload local .glb or .gltf file"
          >
            <Upload className="size-3.5 text-primary" />
            <span className="hidden sm:inline">Upload 3D File</span>
          </button>

          {/* Reset View */}
          <button
            type="button"
            onClick={resetCamera}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-medium text-muted-foreground transition hover:bg-accent hover:text-foreground"
            title="Reset camera view"
          >
            <Camera className="size-3.5" />
            <span className="hidden lg:inline">Reset Camera</span>
          </button>

          {/* Export GLB Action */}
          <button
            type="button"
            onClick={exportAsGLB}
            disabled={exporting || loading}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-lg px-3.5 text-xs font-semibold text-white transition shadow-sm",
              exportSuccess ? "bg-emerald-600 hover:bg-emerald-700" : "bg-primary hover:bg-primary/90"
            )}
          >
            {exportSuccess ? <Check className="size-3.5" /> : <Download className="size-3.5" />}
            <span>{exporting ? "Exporting..." : exportSuccess ? "Downloaded!" : "Export GLB"}</span>
          </button>
        </div>
      </header>

      {/* Main Workspace: Canvas (Left/Center) + Properties Panel (Right) */}
      <div className="relative flex flex-1 flex-col overflow-hidden lg:flex-row">
        {/* 3D Canvas Area */}
        <div
          className="relative flex-1 bg-slate-50 dark:bg-zinc-950"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const file = e.dataTransfer.files[0];
            if (file) handleFileUpload(file);
          }}
        >
          {/* WebGL Canvas */}
          <div ref={mountRef} className="size-full cursor-grab active:cursor-grabbing" />

          {/* Floating Canvas Controls Overlay */}
          <div className="absolute left-4 top-4 flex flex-wrap items-center gap-1.5 rounded-xl border border-border/80 bg-background/85 p-1.5 shadow-lg backdrop-blur-md">
            <button
              type="button"
              onClick={toggleGrid}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-xs font-medium transition",
                showGrid ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent"
              )}
              title="Toggle Grid Ground Plane"
            >
              <Grid className="size-4" />
            </button>
            <div className="h-4 w-px bg-border/60" />
            <button
              type="button"
              onClick={() => changeBackground("light")}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-xs font-medium transition",
                viewportBg === "light" ? "bg-primary/15 text-primary font-bold" : "text-muted-foreground hover:bg-accent"
              )}
              title="Studio Bright Background"
            >
              ☀️
            </button>
            <button
              type="button"
              onClick={() => changeBackground("studio")}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-xs font-medium transition",
                viewportBg === "studio" ? "bg-primary/15 text-primary font-bold" : "text-muted-foreground hover:bg-accent"
              )}
              title="Indigo Creative Studio Background"
            >
              🎨
            </button>
            <button
              type="button"
              onClick={() => changeBackground("dark")}
              className={cn(
                "flex size-8 items-center justify-center rounded-lg text-xs font-medium transition",
                viewportBg === "dark" ? "bg-primary/15 text-primary font-bold" : "text-muted-foreground hover:bg-accent"
              )}
              title="Dark Room Background"
            >
              🌙
            </button>
            <div className="h-4 w-px bg-border/60" />
            <button
              type="button"
              onClick={() => setIsFullscreen(!isFullscreen)}
              className="flex size-8 items-center justify-center rounded-lg text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
              title={isFullscreen ? "Exit Fullscreen" : "Fullscreen View"}
            >
              {isFullscreen ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
          </div>

          {/* Quick Help Toast on bottom left of viewport */}
          <div className="pointer-events-none absolute bottom-4 left-4 hidden rounded-lg border border-border/60 bg-background/80 px-3 py-1.5 text-[11px] text-muted-foreground backdrop-blur-sm sm:block">
            Left click + drag to rotate · Right click to pan · Scroll to zoom · Drop .GLB file to load
          </div>

          {/* Loading Indicator */}
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-background/70 backdrop-blur-sm">
              <div className="size-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary" />
              <p className="mt-4 text-sm font-medium text-foreground">{loadingMessage}</p>
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="absolute left-1/2 top-6 -translate-x-1/2 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-xs font-medium text-destructive shadow-lg backdrop-blur">
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4" />
                <span>{error}</span>
                <button
                  type="button"
                  onClick={() => setError(null)}
                  className="ml-2 text-destructive underline hover:opacity-80"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right Properties & Customization Panel */}
        <aside className="w-full shrink-0 border-t border-border/80 bg-card p-5 sm:p-6 lg:w-80 lg:border-l lg:border-t-0 xl:w-96 overflow-y-auto max-h-[45vh] lg:max-h-none">
          <div className="space-y-6">
            {/* Model Title & Mesh Selection */}
            <div>
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <Palette className="size-4 text-primary" /> Material &amp; Appearance
                </h2>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  Interactive
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">Customize colors, surface roughness and wireframe in real time.</p>

              {/* Target Mesh Selection */}
              <div className="mt-3">
                <label className="text-xs font-medium text-muted-foreground">Target Mesh</label>
                <select
                  value={selectedMeshId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedMeshId(id);
                    if (id !== "all") {
                      const entry = meshes.find((m) => m.id === id);
                      if (entry) setCurrentColor(entry.originalColor);
                    }
                  }}
                  className="mt-1 h-9 w-full rounded-xl border border-border bg-background px-3 text-xs font-medium focus:border-primary focus:outline-none"
                >
                  <option value="all">Entire Model (All Meshes)</option>
                  {meshes.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Color Palette & Custom Picker */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Color Palette</label>
              <div className="grid grid-cols-5 gap-2">
                {COLOR_SWATCHES.map((swatch) => (
                  <button
                    key={swatch}
                    type="button"
                    onClick={() => {
                      setCurrentColor(swatch);
                      applyMaterialChanges(swatch, roughness, metalness, isWireframe);
                    }}
                    style={{ backgroundColor: swatch }}
                    className={cn(
                      "flex h-8 items-center justify-center rounded-lg border transition hover:scale-105",
                      currentColor.toLowerCase() === swatch.toLowerCase()
                        ? "border-foreground ring-2 ring-primary ring-offset-2"
                        : "border-black/10 dark:border-white/10"
                    )}
                    title={swatch}
                  >
                    {currentColor.toLowerCase() === swatch.toLowerCase() && (
                      <Check className="size-3.5 text-white mix-blend-difference" />
                    )}
                  </button>
                ))}
              </div>

              {/* Custom Hex Color Picker */}
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="color"
                  value={currentColor}
                  onChange={(e) => {
                    const c = e.target.value;
                    setCurrentColor(c);
                    applyMaterialChanges(c, roughness, metalness, isWireframe);
                  }}
                  className="size-8 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
                />
                <input
                  type="text"
                  value={currentColor}
                  onChange={(e) => {
                    const c = e.target.value;
                    setCurrentColor(c);
                    if (c.match(/^#[0-9a-f]{6}$/i)) {
                      applyMaterialChanges(c, roughness, metalness, isWireframe);
                    }
                  }}
                  className="h-8 flex-1 rounded-lg border border-border bg-background px-2.5 font-mono text-xs focus:border-primary focus:outline-none"
                  placeholder="#6366f1"
                />
              </div>
            </div>

            {/* Roughness & Metalness Sliders */}
            <div className="space-y-3 rounded-xl border border-border/70 bg-accent/30 p-3.5">
              <div>
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-muted-foreground">Roughness</span>
                  <span className="tabular-nums font-mono text-foreground">{Math.round(roughness * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={roughness}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setRoughness(v);
                    applyMaterialChanges(currentColor, v, metalness, isWireframe);
                  }}
                  className="mt-1 w-full accent-primary"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-muted-foreground">Metalness</span>
                  <span className="tabular-nums font-mono text-foreground">{Math.round(metalness * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={metalness}
                  onChange={(e) => {
                    const v = parseFloat(e.target.value);
                    setMetalness(v);
                    applyMaterialChanges(currentColor, roughness, v, isWireframe);
                  }}
                  className="mt-1 w-full accent-primary"
                />
              </div>

              {/* Wireframe toggle */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-xs font-medium text-muted-foreground">Wireframe Mode</span>
                <button
                  type="button"
                  onClick={() => {
                    const next = !isWireframe;
                    setIsWireframe(next);
                    applyMaterialChanges(currentColor, roughness, metalness, next);
                  }}
                  className={cn(
                    "relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none",
                    isWireframe ? "bg-primary" : "bg-muted"
                  )}
                >
                  <span
                    className={cn(
                      "pointer-events-none inline-block size-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out",
                      isWireframe ? "translate-x-4" : "translate-x-0"
                    )}
                  />
                </button>
              </div>
            </div>

            {/* Transform Controls (Scale & Rotation) */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
                  <Sliders className="size-4 text-primary" /> Transform &amp; Scale
                </h3>
                <button
                  type="button"
                  onClick={resetTransforms}
                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                >
                  <RotateCcw className="size-3" /> Reset
                </button>
              </div>

              {/* Scale */}
              <div>
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-muted-foreground">Uniform Scale</span>
                  <span className="tabular-nums font-mono text-foreground">{scale.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="3.0"
                  step="0.05"
                  value={scale}
                  onChange={(e) => handleScaleChange(parseFloat(e.target.value))}
                  className="mt-1 w-full accent-primary"
                />
              </div>

              {/* Rotation X, Y, Z */}
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <span className="block text-[11px] text-muted-foreground">Rot X ({rotX}°)</span>
                  <button
                    type="button"
                    onClick={() => handleRotationChange("x", (rotX + 90) % 360)}
                    className="mt-1 w-full rounded-lg border border-border py-1 text-xs font-medium transition hover:bg-accent"
                  >
                    +90°
                  </button>
                </div>
                <div>
                  <span className="block text-[11px] text-muted-foreground">Rot Y ({rotY}°)</span>
                  <button
                    type="button"
                    onClick={() => handleRotationChange("y", (rotY + 90) % 360)}
                    className="mt-1 w-full rounded-lg border border-border py-1 text-xs font-medium transition hover:bg-accent"
                  >
                    +90°
                  </button>
                </div>
                <div>
                  <span className="block text-[11px] text-muted-foreground">Rot Z ({rotZ}°)</span>
                  <button
                    type="button"
                    onClick={() => handleRotationChange("z", (rotZ + 90) % 360)}
                    className="mt-1 w-full rounded-lg border border-border py-1 text-xs font-medium transition hover:bg-accent"
                  >
                    +90°
                  </button>
                </div>
              </div>
            </div>

            {/* Model Geometry Information */}
            <div className="rounded-xl border border-border/80 bg-card p-4">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                <Info className="size-3.5 text-primary" /> Model Specs
              </h3>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Triangles</dt>
                  <dd className="font-mono font-medium tabular-nums">{stats.triangles.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Vertices</dt>
                  <dd className="font-mono font-medium tabular-nums">{stats.vertices.toLocaleString()}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Mesh Parts</dt>
                  <dd className="font-mono font-medium tabular-nums">{stats.meshCount}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Dimensions</dt>
                  <dd className="font-mono font-medium tabular-nums text-[11px]">
                    {stats.dimensions.x} × {stats.dimensions.y} × {stats.dimensions.z}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Quick Export Button in Sidebar */}
            <button
              type="button"
              onClick={exportAsGLB}
              disabled={exporting || loading}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary py-2.5 text-xs font-semibold text-primary-foreground shadow-md transition hover:opacity-95 disabled:opacity-50"
            >
              <Download className="size-4" />
              <span>{exporting ? "Generating GLB..." : "Export Customized GLB"}</span>
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function cn(...classes: (string | boolean | undefined | null)[]) {
  return classes.filter(Boolean).join(" ");
}
