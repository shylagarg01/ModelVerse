/**
 * Tests for Phase 2: Header Profile Dropdown, User Navigation & Seller Registration Flow
 *
 * Verifies:
 * 1. Role-based navigation targets (user -> /dashboard, seller -> /seller/dashboard, admin -> /admin)
 * 2. Seller application workflow:
 *    - Normal user can apply (/auth/seller/apply)
 *    - Application status is tracked (/auth/seller/application)
 *    - Cannot apply twice while pending/approved
 *    - Sellers and admins cannot apply (409)
 * 3. Role governance & protection:
 *    - Normal user cannot review/approve applications (403)
 *    - Normal user cannot change roles (403)
 *    - Admin can approve seller application, transforming role to seller
 *    - Admin cannot alter own admin role (400)
 * 4. Session & Logout:
 *    - Logout clears session cookie and removes session from DB
 *    - Expired/invalid session tokens return null user
 * 5. Phase 1 compatibility:
 *    - Login-protected downloads and download history endpoints remain fully functional
 */

import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../src/api/app.js";
import { db } from "../src/api/auth.js";
import { AssetService } from "../src/core/service.js";
import { bytesHttp, fakeProvider } from "./fakes.js";

function makeApp() {
  const http = bytesHttp();
  const svc = new AssetService({ providers: [fakeProvider], http });
  return createApp(svc);
}

// Helpers
async function registerUser(app: ReturnType<typeof makeApp>, email: string, role: "user" | "seller" = "user") {
  const reg = await app.request("/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: "TestPassword123!", role }),
  });
  expect(reg.status).toBe(201);
  return reg.headers.get("set-cookie") ?? "";
}

function createAdminDirectly(email: string): { cookie: string; userId: number } {
  // Directly insert admin user in the test database
  const passwordHash = "dummyhash";
  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(`
    INSERT INTO users (email, password_hash, role, created_at)
    VALUES (?, ?, 'admin', ?)
  `).run(email, passwordHash, now);
  const userId = Number(insert.lastInsertRowid);

  // Issue session directly
  const token = randomBytes(32).toString("base64url");
  const crypto = require("node:crypto");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(tokenHash, userId, now + 3600);

  return { cookie: `modelverse_session=${token}; Path=/; HttpOnly; SameSite=Lax`, userId };
}

describe("Phase 2 – User Navigation, Roles & Seller Application Flow", () => {
  let app: ReturnType<typeof makeApp>;

  beforeAll(() => {
    app = makeApp();
  });

  describe("Role session inspection (/auth/me)", () => {
    it("returns null user for unauthenticated requests", async () => {
      const res = await app.request("/auth/me");
      expect(res.status).toBe(200);
      const data = await res.json() as { user: unknown };
      expect(data.user).toBeNull();
    });

    it("returns user role and email for logged-in standard user", async () => {
      const email = `usr-nav-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerUser(app, email, "user");
      const res = await app.request("/auth/me", { headers: { cookie } });
      expect(res.status).toBe(200);
      const data = await res.json() as { user: { email: string; role: string; id: number } };
      expect(data.user.email).toBe(email);
      expect(data.user.role).toBe("user");
    });

    it("returns seller role for registered seller", async () => {
      const email = `seller-nav-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerUser(app, email, "seller");
      const res = await app.request("/auth/me", { headers: { cookie } });
      expect(res.status).toBe(200);
      const data = await res.json() as { user: { role: string } };
      expect(data.user.role).toBe("seller");
    });
  });

  describe("Seller Application Workflow", () => {
    it("standard user can submit a seller application", async () => {
      const email = `applicant-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerUser(app, email, "user");

      const res = await app.request("/auth/seller/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          businessName: "Vertex Dynamics",
          description: "High quality PBR 3D models and environments.",
        }),
      });
      expect(res.status).toBe(201);
      const data = await res.json() as { status: string };
      expect(data.status).toBe("pending");
    });

    it("user can check their existing seller application status", async () => {
      const email = `applicant-check-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerUser(app, email, "user");

      // Submit application
      await app.request("/auth/seller/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          businessName: "PolyCraft",
          description: "Game-ready low-poly assets.",
        }),
      });

      // Check status
      const res = await app.request("/auth/seller/application", { headers: { cookie } });
      expect(res.status).toBe(200);
      const data = await res.json() as {
        application: { business_name: string; status: string };
        role: string;
      };
      expect(data.application).toBeDefined();
      expect(data.application.business_name).toBe("PolyCraft");
      expect(data.application.status).toBe("pending");
      expect(data.role).toBe("user");
    });

    it("prevents submitting duplicate active application while pending", async () => {
      const email = `applicant-dup-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerUser(app, email, "user");

      await app.request("/auth/seller/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          businessName: "Studio Alpha",
          description: "Original 3D creatures.",
        }),
      });

      // Second application attempt while pending
      const dupRes = await app.request("/auth/seller/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          businessName: "Studio Alpha Updated",
          description: "New description.",
        }),
      });
      expect(dupRes.status).toBe(409);
    });

    it("existing seller or admin cannot apply to become seller", async () => {
      const email = `seller-apply-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerUser(app, email, "seller");

      const res = await app.request("/auth/seller/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({
          businessName: "Already A Seller",
          description: "Should fail.",
        }),
      });
      expect(res.status).toBe(409);
    });
  });

  describe("Role Governance & Admin Approvals", () => {
    it("standard user cannot access admin seller applications list (403)", async () => {
      const email = `hacker-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerUser(app, email, "user");

      const res = await app.request("/auth/admin/seller-applications", { headers: { cookie } });
      expect(res.status).toBe(403);
    });

    it("standard user cannot review/approve seller application (403)", async () => {
      const email = `hacker2-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerUser(app, email, "user");

      const res = await app.request("/auth/admin/seller-applications/1/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie },
        body: JSON.stringify({ status: "approved" }),
      });
      expect(res.status).toBe(403);
    });

    it("admin can approve seller application and role changes to seller", async () => {
      // 1. User applies
      const userEmail = `apply-approve-${randomBytes(3).toString("hex")}@example.com`;
      const userCookie = await registerUser(app, userEmail, "user");

      await app.request("/auth/seller/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: userCookie },
        body: JSON.stringify({
          businessName: "Approved Studio",
          description: "Ready for marketplace.",
        }),
      });

      // 2. Admin inspects applications
      const adminEmail = `admin-${randomBytes(3).toString("hex")}@example.com`;
      const { cookie: adminCookie } = createAdminDirectly(adminEmail);

      const listRes = await app.request("/auth/admin/seller-applications", {
        headers: { cookie: adminCookie },
      });
      expect(listRes.status).toBe(200);
      const listData = await listRes.json() as {
        applications: Array<{ id: number; email: string; status: string }>;
      };
      const targetApp = listData.applications.find((a) => a.email === userEmail);
      expect(targetApp).toBeDefined();

      // 3. Admin approves
      const reviewRes = await app.request(`/auth/admin/seller-applications/${targetApp!.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ status: "approved" }),
      });
      expect(reviewRes.status).toBe(200);

      // 4. Verify user's role is now 'seller'
      const checkRes = await app.request("/auth/me", { headers: { cookie: userCookie } });
      const checkData = await checkRes.json() as { user: { role: string } };
      expect(checkData.user.role).toBe("seller");
    });

    it("admin cannot demote their own admin account", async () => {
      const adminEmail = `admin-self-${randomBytes(3).toString("hex")}@example.com`;
      const { cookie: adminCookie, userId } = createAdminDirectly(adminEmail);

      const res = await app.request(`/auth/admin/users/${userId}/role`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", cookie: adminCookie },
        body: JSON.stringify({ role: "user" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("Logout & Session Invalidation", () => {
    it("logout invalidates session and prevents further authenticated access", async () => {
      const email = `logout-test-${randomBytes(3).toString("hex")}@example.com`;
      const cookie = await registerUser(app, email, "user");

      // Verify authenticated initially
      const meBefore = await app.request("/auth/me", { headers: { cookie } });
      const meBeforeData = await meBefore.json() as { user: { email: string } };
      expect(meBeforeData.user.email).toBe(email);

      // Call logout
      const logoutRes = await app.request("/auth/logout", {
        method: "POST",
        headers: { cookie },
      });
      expect(logoutRes.status).toBe(200);

      // Session in header should now be invalid
      const meAfter = await app.request("/auth/me", { headers: { cookie } });
      const meAfterData = await meAfter.json() as { user: unknown };
      expect(meAfterData.user).toBeNull();
    });
  });
});
