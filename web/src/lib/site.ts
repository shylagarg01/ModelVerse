import integrations from "@/data/integrations.json";
import organization from "@/data/organization.json";
import providers from "@/data/providers.json";

export const SITE = {
  name: "ModelVerse",
  shortName: "ModelVerse",
  url: (import.meta.env.SITE as string | undefined)?.replace(/\/$/, "") ?? "https://3d.shep.bot",
  tagline: "Your next 3D creation starts here",
  homeTitle: "ModelVerse · 3D Asset Discovery & Creative Workspace",
  description:
    `Discover, preview, and customize 3D models, textures, materials and HDRIs from ${providers.length} sources across the web — all in one creative workspace.`,
  repo: "https://github.com/arielshad/3d-asset-server",
  image: "/og.png",
  locale: "en_US",
};

/** Who runs the site. Fill `email` / `address` in organization.json to publish them. */
export const ORG = organization as {
  name: string;
  url: string;
  contactUrl: string;
  issuesUrl: string;
  securityUrl: string;
  email: string | null;
  address: { streetAddress?: string; addressLocality?: string; postalCode?: string; addressRegion?: string; addressCountry: string } | null;
};

export type Provider = (typeof providers)[number];
export const PROVIDERS: Provider[] = providers;
export const SOURCE_COUNT = PROVIDERS.length;
export const DIRECT_DOWNLOAD_COUNT = PROVIDERS.filter((p) => p.supportsDownload).length;
export const CC0_COUNT = PROVIDERS.filter((p) => p.license?.startsWith("CC0")).length;

/** Sources by date added, newest first (from integrations/registry.json). */
export const INTEGRATIONS = integrations.integrations;

/** Share-card path for a route: "/" -> /og/home.png, "/docs/api" -> /og/docs-api.png. */
export function ogImagePath(route: string): string {
  const slug = route === "/" ? "home" : route.replace(/^\/+|\/+$/g, "").replace(/\//g, "-");
  return `/og/${slug}.png`;
}

export const MCP_URL = `${SITE.url}/mcp`;

export const NAV = [
  { href: "/search", label: "Explore Assets" },
  { href: "/editor", label: "3D Editor" },
  { href: "/docs/sources", label: "Sources" },
  { href: "/docs", label: "Documentation" },
  { href: "/assets", label: "Collections" },
  { href: "/stats", label: "Stats" },
];

export const DOCS_NAV = [
  {
    title: "Get started",
    items: [
      { href: "/docs", label: "Quick start" },
      { href: "/docs/mcp", label: "Coding agents & MCP" },
      { href: "/docs/api", label: "REST API guide" },
      { href: "/docs/api/reference", label: "API reference" },
      { href: "/docs/api/playground", label: "API playground" },
      { href: "/docs/cli", label: "CLI" },
    ],
  },
  {
    title: "Reference",
    items: [
      { href: "/docs/sources", label: "Sources & licences" },
      { href: "/docs/api/versioning", label: "Versioning & rate limits" },
      { href: "/docs/self-hosting", label: "Self-hosting" },
      { href: "/AGENTS.md", label: "AGENTS.md (for agents)" },
      { href: "/llms.txt", label: "llms.txt" },
    ],
  },
];
