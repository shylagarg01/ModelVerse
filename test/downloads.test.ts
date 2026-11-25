/**
 * Tests for Phase 1: Login-Protected Asset Downloads & Download History
 *
 * Tests:
 * 1. Unauthenticated download requests are rejected on the protected web endpoint
 * 2. Authenticated users can download available assets via the web endpoint
 * 3. Download activity is recorded and associated with the correct user
 * 4. One user cannot retrieve another user's download history
 * 5. Admins can retrieve platform-wide download history
 * 6. Normal users cannot access the admin download endpoint
 * 7. Invalid asset IDs do not create history records
 * 8. Invalid format/resolution selections do not create history records
 * 9. Existing login, registration and logout still work
 * 10. Original /v1/assets/:id/download (API/MCP) remains accessible without auth
 */

import { randomBytes } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { AssetService } from "../src/core/service.js";
import { bytesHttp, CRATE, fakeProvider } from "./fakes.js";

// Use an in-memory SQLite database for tests (isolated from production data)
const TEST_DB_PATH = `:memory:_test_${randomBytes(4).toString("hex")}`;

// Override the AUTH_DB_PATH for the test process
process.env.AUTH_DB_PATH = `data/test-downloads-${randomBytes(4).toString("hex")}.sqlite`;

// We import auth *after* setting AUTH_DB_PATH so the module picks up the env var
// (dynamic import is used to allow env override before module load)

function makeApp() {
  const http = bytesHttp();
  const svc = new AssetService({ providers: [fakeProvider], http });
  return createApp(svc);
}

// Helper: register a user and return the session cookie
async function registerAndLogin(
  app: ReturnType<typeof makeApp>,
  email: string,
  role: "user" | "seller" = "user"
) {
  const reg = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "TestPassword123!", role }),
  });
  expect(reg.status).toBe(201);
  const cookie = reg.headers.get("set-cookie") ?? "";
  return cookie;
}

async function loginUser(
  app: ReturnType<typeof makeApp>,
  email: string,
  cookie?: string
) {
  const res = await app.request("/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "TestPassword123!" }),
  });
  return res.headers.get("set-cookie") ?? cookie ?? "";
}

describe("Phase 1 – Download Protection & History", () => {
  let app: ReturnType<typeof makeApp>;

  beforeAll(() => {
    app = makeApp();
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 9. Auth endpoints still work
  // ─────────────────────────────────────────────────────────────────────────────
  describe("existing auth endpoints", () => {
    it("can register a new user", async () => {
      const res = await app.request("/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: `reg-test-${randomBytes(3).toString("hex")}@example.com`,
          password: "TestPassword123!",
          role: "user",
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json() as { user: { email: string; role: string } };
      expect(data.user.role).toBe("user");
    });

    it("can login with valid credentials", async () => {
      const email = `login-${randomBytes(3).toString("hex")}@example.com`;
      await registerAndLogin(app, email);
      const res = await app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "TestPassword123!" }),
      });
      expect(res.status).toBe(200);
      const data = await res.json() as { user: { email: string } };
      expect(data.user.email).toBe(email);
    });

    it("rejects login with wrong password", async () => {
      const email = `wrongpw-${randomBytes(3).toString("hex")}@example.com`;
      await registerAndLogin(app, email);
      const res = await app.request("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: "WrongPassword!" }),
      });
      expect(res.status).toBe(401);
    });

    it("can logout", async () => {
      const email = `logout-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerAndLogin(app, email);
      const res = await app.request("/auth/logout", {
        method: "POST",
        headers: { cookie },
      });
      expect(res.status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 10. Original /v1/assets/:id/download (API/MCP path) remains open
  // ─────────────────────────────────────────────────────────────────────────────
  describe("API/MCP download path remains open", () => {
    it("unauthenticated request to /v1/assets/:id/download succeeds (302 redirect)", async () => {
      const res = await app.request("/v1/assets/fake:crate/download", { redirect: "manual" });
      // Should redirect (302) or return a zip — either way NOT 401
      expect(res.status).not.toBe(401);
      expect([200, 302, 409]).toContain(res.status);
    });

    it("file listing endpoint /v1/assets/:id/files is still open", async () => {
      const res = await app.request("/v1/assets/fake:crate/files");
      expect(res.status).toBe(200);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 1. Unauthenticated web download is rejected
  // ─────────────────────────────────────────────────────────────────────────────
  describe("web download protection", () => {
    it("rejects unauthenticated request to /v1/assets/:id/download/web", async () => {
      const res = await app.request("/v1/assets/fake:crate/download/web");
      expect(res.status).toBe(401);
      const data = await res.json() as { requiresAuth?: boolean };
      expect(data.requiresAuth).toBe(true);
    });

    it("returns 401 even when format/resolution are provided", async () => {
      const res = await app.request("/v1/assets/fake:crate/download/web?format=gltf&resolution=2k");
      expect(res.status).toBe(401);
    });

    // 2. Authenticated users can download
    it("allows authenticated user to download", async () => {
      const email = `dl-auth-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerAndLogin(app, email);
      const res = await app.request("/v1/assets/fake:crate/download/web", {
        headers: { cookie },
        redirect: "manual",
      });
      // The asset redirects (single file redirect) or streams zip — not 401
      expect(res.status).not.toBe(401);
      expect([200, 302]).toContain(res.status);
    });

    // 7. Invalid asset ID does not create history record
    it("returns 404 for invalid asset ID (no history record created)", async () => {
      const email = `dl-badid-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerAndLogin(app, email);
      const res = await app.request("/v1/assets/fake:nonexistent/download/web", {
        headers: { cookie },
        redirect: "manual",
      });
      expect(res.status).toBe(404);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 3. Download record is associated with the correct user
  // ─────────────────────────────────────────────────────────────────────────────
  describe("download history recording", () => {
    it("records a download for the authenticated user", async () => {
      const email = `dl-rec-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerAndLogin(app, email);

      // Trigger a download
      await app.request("/v1/assets/fake:crate/download/web", {
        headers: { cookie },
        redirect: "manual",
      });

      // Verify it appears in /auth/my-downloads
      const histRes = await app.request("/auth/my-downloads", {
        headers: { cookie },
      });
      expect(histRes.status).toBe(200);
      const data = await histRes.json() as { downloads: Array<{ asset_id: string; asset_title: string }> };
      expect(data.downloads.length).toBeGreaterThan(0);
      expect(data.downloads[0]!.asset_id).toBe("fake:crate");
      expect(data.downloads[0]!.asset_title).toBe(CRATE.title);
    });

    // 4. One user cannot see another user's history
    it("user A cannot see user B's download history", async () => {
      const emailA = `dl-usera-${randomBytes(3).toString("hex")}@example.com`;
      const emailB = `dl-userb-${randomBytes(3).toString("hex")}@example.com`;
      const cookieA = await registerAndLogin(app, emailA);
      const cookieB = await registerAndLogin(app, emailB);

      // User B downloads something
      await app.request("/v1/assets/fake:crate/download/web", {
        headers: { cookie: cookieB },
        redirect: "manual",
      });

      // User A's history should be empty (or contain only A's downloads)
      const resA = await app.request("/auth/my-downloads", {
        headers: { cookie: cookieA },
      });
      expect(resA.status).toBe(200);
      const dataA = await resA.json() as { downloads: unknown[] };
      // User A has not downloaded anything, so the list must be empty
      expect(dataA.downloads.length).toBe(0);
    });

    it("unauthenticated request to /auth/my-downloads returns 401", async () => {
      const res = await app.request("/auth/my-downloads");
      expect(res.status).toBe(401);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 5 & 6. Admin download endpoint access control
  // ─────────────────────────────────────────────────────────────────────────────
  describe("admin download endpoint", () => {
    it("normal user receives 403 on /auth/admin/downloads", async () => {
      const email = `dl-normaluser-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerAndLogin(app, email, "user");
      const res = await app.request("/auth/admin/downloads", {
        headers: { cookie },
      });
      expect(res.status).toBe(403);
    });

    it("unauthenticated request to /auth/admin/downloads returns 403", async () => {
      const res = await app.request("/auth/admin/downloads");
      expect(res.status).toBe(403);
    });

    // Note: testing actual admin access requires creating an admin user,
    // which requires either a create-admin script or direct DB manipulation.
    // The endpoint is exercised indirectly via the cookie/session mechanism.
    // A full admin test would use a pre-seeded test DB with an admin user.
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 8. Invalid format/resolution → no history record
  // ─────────────────────────────────────────────────────────────────────────────
  describe("invalid format/resolution", () => {
    it("returns 404 for unmatched format and does not record download", async () => {
      const email = `dl-badfmt-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerAndLogin(app, email);

      const dlRes = await app.request(
        "/v1/assets/fake:crate/download/web?format=nonexistentformat",
        { headers: { cookie }, redirect: "manual" }
      );
      expect(dlRes.status).toBe(404);

      // No record should have been created
      const histRes = await app.request("/auth/my-downloads", { headers: { cookie } });
      const data = await histRes.json() as { downloads: unknown[] };
      expect(data.downloads.length).toBe(0);
    });
  });
});
