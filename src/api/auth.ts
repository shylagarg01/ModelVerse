import { randomBytes, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import argon2 from "argon2";
import { Hono } from "hono";

const databasePath = resolve(process.env.AUTH_DB_PATH ?? "data/modelverse-auth.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

export const db = new DatabaseSync(databasePath);
db.exec("PRAGMA busy_timeout = 10000;");
db.exec(`
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id);
`);

// Migrate existing users table to support approved sellers.
const usersSchema = db.prepare(
  "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'"
).get() as { sql: string } | undefined;

if (usersSchema && !usersSchema.sql.includes("'seller'")) {
  db.exec("PRAGMA foreign_keys = OFF");

  try {
    db.exec("BEGIN IMMEDIATE");

    db.exec(`
      CREATE TABLE users_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user'
          CHECK (role IN ('user', 'seller', 'admin')),
        created_at INTEGER NOT NULL
      );

      INSERT INTO users_new (id, email, password_hash, role, created_at)
      SELECT id, email, password_hash, role, created_at FROM users;

      DROP TABLE users;
      ALTER TABLE users_new RENAME TO users;
    `);

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  } finally {
    db.exec("PRAGMA foreign_keys = ON");
  }
}

// Seller applications
db.exec(`
  CREATE TABLE IF NOT EXISTS seller_applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    business_name TEXT NOT NULL,
    description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending'
      CHECK (status IN ('pending', 'approved', 'rejected')),
    created_at INTEGER NOT NULL,
    reviewed_at INTEGER
  );

  CREATE INDEX IF NOT EXISTS seller_applications_status
  ON seller_applications(status);
`);


const SESSION_COOKIE = "modelverse_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

export type User = {
  id: number;
  email: string;
  role: "user" | "seller" | "admin";
  created_at?: number;
};
function publicUser(row: Record<string, unknown>): User {
  const role = row.role;

  return {
    id: Number(row.id),
    email: String(row.email),
    role: role === "admin" || role === "seller" ? role : "user",
    created_at: row.created_at ? Number(row.created_at) : undefined,
  };
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function cookie(value: string, maxAge: number): string {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}

function readCookie(header: string | undefined): string | undefined {
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const separator = item.indexOf("=");
    if (separator < 0) continue;
    if (item.slice(0, separator).trim() === SESSION_COOKIE) {
      return item.slice(separator + 1).trim();
    }
  }
  return undefined;
}

function findUserForToken(token: string | undefined): User | null {
  if (!token) return null;
  const row = db.prepare(`
    SELECT users.id, users.email, users.role, users.created_at
    FROM sessions JOIN users ON users.id = sessions.user_id
    WHERE sessions.token_hash = ? AND sessions.expires_at > ?
  `).get(hashToken(token), Math.floor(Date.now() / 1000)) as Record<string, unknown> | undefined;

  return row ? publicUser(row) : null;
}

function issueSession(userId: number): string {
  const token = randomBytes(32).toString("base64url");
  const expires = Math.floor(Date.now() / 1000) + SESSION_LIFETIME_SECONDS;
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .run(hashToken(token), userId, expires);
  return token;
}

function validEmail(email: string): boolean {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const authRouter = new Hono();

authRouter.post("/register", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Please send valid JSON." }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid registration details." }, 400);
  }

  const input = body as Record<string, unknown>;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!validEmail(email)) return c.json({ error: "Enter a valid email address." }, 400);
  if (password.length < 12 || password.length > 128) {
    return c.json({ error: "Password must be between 12 and 128 characters." }, 400);
  }

  try {
    const passwordHash = await argon2.hash(password);
    const result = db.prepare(
      "INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, 'user', ?)"
    ).run(email, passwordHash, Math.floor(Date.now() / 1000));

    const userId = Number(result.lastInsertRowid);
    const token = issueSession(userId);
    c.header("Set-Cookie", cookie(token, SESSION_LIFETIME_SECONDS));
    return c.json({ user: { id: userId, email, role: "user" } }, 201);
  } catch (error) {
    if (error instanceof Error && /UNIQUE constraint failed: users.email/.test(error.message)) {
      return c.json({ error: "An account with that email already exists." }, 409);
    }
    throw error;
  }
});

authRouter.post("/login", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Please send valid JSON." }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid login details." }, 400);
  }

  const input = body as Record<string, unknown>;
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!email || !password || password.length > 128) {
    return c.json({ error: "Invalid email or password." }, 401);
  }

  const row = db.prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as Record<string, unknown> | undefined;

  if (!row || !(await argon2.verify(String(row.password_hash), password))) {
    return c.json({ error: "Invalid email or password." }, 401);
  }

  db.prepare("DELETE FROM sessions WHERE expires_at <= ?")
    .run(Math.floor(Date.now() / 1000));

  const token = issueSession(Number(row.id));
  c.header("Set-Cookie", cookie(token, SESSION_LIFETIME_SECONDS));
  return c.json({ user: publicUser(row) });
});

authRouter.get("/me", (c) => {
  const user = findUserForToken(readCookie(c.req.header("cookie")));
  if (!user) return c.json({ user: null }, 200);
  return c.json({ user });
});

authRouter.post("/logout", (c) => {
  const token = readCookie(c.req.header("cookie"));
  if (token) {
    db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  }
  c.header("Set-Cookie", cookie("", 0));
  return c.json({ ok: true });
});

// Submit or resubmit a seller application.
authRouter.post("/seller/apply", async (c) => {
  const user = findUserForToken(readCookie(c.req.header("cookie")));
  if (!user) return c.json({ error: "Please log in first." }, 401);

  if (user.role === "seller" || user.role === "admin") {
    return c.json({ error: "Your account already has seller access." }, 409);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Please send valid JSON." }, 400);
  }

  if (!body || typeof body !== "object") {
    return c.json({ error: "Invalid application details." }, 400);
  }

  const input = body as Record<string, unknown>;
  const businessName =
    typeof input.businessName === "string" ? input.businessName.trim() : "";
  const description =
    typeof input.description === "string" ? input.description.trim() : "";

  if (!businessName || businessName.length > 100) {
    return c.json({ error: "Business name must be 1–100 characters." }, 400);
  }
  if (!description || description.length > 1000) {
    return c.json({ error: "Description must be 1–1000 characters." }, 400);
  }

  const existing = db.prepare(
    "SELECT id, status FROM seller_applications WHERE user_id = ?"
  ).get(user.id) as { id: number; status: string } | undefined;

  if (existing && existing.status !== "rejected") {
    return c.json({
      error: "You already have a pending or approved application.",
      status: existing.status,
    }, 409);
  }

  const now = Math.floor(Date.now() / 1000);

  if (existing) {
    db.prepare(`
      UPDATE seller_applications
      SET business_name = ?, description = ?, status = 'pending',
          created_at = ?, reviewed_at = NULL
      WHERE user_id = ?
    `).run(businessName, description, now, user.id);
  } else {
    db.prepare(`
      INSERT INTO seller_applications
        (user_id, business_name, description, created_at)
      VALUES (?, ?, ?, ?)
    `).run(user.id, businessName, description, now);
  }

  return c.json({ message: "Seller application submitted.", status: "pending" }, 201);
});

// Check the logged-in user's seller application.
authRouter.get("/seller/application", (c) => {
  const user = findUserForToken(readCookie(c.req.header("cookie")));
  if (!user) return c.json({ error: "Please log in first." }, 401);

  const application = db.prepare(`
    SELECT id, business_name, description, status, created_at, reviewed_at
    FROM seller_applications WHERE user_id = ?
  `).get(user.id);

  return c.json({ application, role: user.role });
});

// Admin: view all seller applications.
authRouter.get("/admin/seller-applications", (c) => {
  const user = findUserForToken(readCookie(c.req.header("cookie")));
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required." }, 403);
  }

  const applications = db.prepare(`
    SELECT seller_applications.id, seller_applications.user_id,
           users.email, seller_applications.business_name,
           seller_applications.description, seller_applications.status,
           seller_applications.created_at, seller_applications.reviewed_at
    FROM seller_applications
    JOIN users ON users.id = seller_applications.user_id
    ORDER BY seller_applications.created_at DESC
  `).all();

  return c.json({ applications });
});

// Admin: approve or reject a pending seller application.
authRouter.post("/admin/seller-applications/:id/review", async (c) => {
  const user = findUserForToken(readCookie(c.req.header("cookie")));
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required." }, 403);
  }

  const applicationId = Number(c.req.param("id"));
  if (!Number.isSafeInteger(applicationId) || applicationId <= 0) {
    return c.json({ error: "Invalid application ID." }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Please send valid JSON." }, 400);
  }

  const status = body && typeof body === "object"
    ? (body as Record<string, unknown>).status
    : undefined;

  if (status !== "approved" && status !== "rejected") {
    return c.json({ error: "Status must be approved or rejected." }, 400);
  }

  const application = db.prepare(`
    SELECT user_id, status FROM seller_applications WHERE id = ?
  `).get(applicationId) as { user_id: number; status: string } | undefined;

  if (!application) {
    return c.json({ error: "Application not found." }, 404);
  }
  if (application.status !== "pending") {
    return c.json({ error: "This application has already been reviewed." }, 409);
  }

  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      UPDATE seller_applications
      SET status = ?, reviewed_at = ?
      WHERE id = ? AND status = 'pending'
    `).run(status, Math.floor(Date.now() / 1000), applicationId);

    if (status === "approved") {
      db.prepare("UPDATE users SET role = 'seller' WHERE id = ?")
        .run(application.user_id);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return c.json({ message: `Seller application ${status}.`, status });
});

// Admin: view platform stats.
authRouter.get("/admin/stats", (c) => {
  const user = findUserForToken(readCookie(c.req.header("cookie")));
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required." }, 403);
  }

  const totalUsers = (db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
  const totalSellers = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'seller'").get() as { count: number }).count;
  const totalAdmins = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'admin'").get() as { count: number }).count;
  const pendingApps = (db.prepare("SELECT COUNT(*) AS count FROM seller_applications WHERE status = 'pending'").get() as { count: number }).count;
  const totalListings = (db.prepare("SELECT COUNT(*) AS count FROM marketplace_listings").get() as { count: number }).count;
  const publishedListings = (db.prepare("SELECT COUNT(*) AS count FROM marketplace_listings WHERE status = 'active'").get() as { count: number }).count;
  const purchasesRow = db.prepare("SELECT COUNT(*) AS count, COALESCE(SUM(amount_cents), 0) AS volume FROM marketplace_purchases").get() as { count: number; volume: number };

  return c.json({
    stats: {
      total_users: totalUsers,
      total_sellers: totalSellers,
      total_admins: totalAdmins,
      pending_applications: pendingApps,
      total_listings: totalListings,
      published_listings: publishedListings,
      total_purchases: purchasesRow.count,
      total_volume_cents: purchasesRow.volume,
    }
  });
});

// Admin: view all registered users.
authRouter.get("/admin/users", (c) => {
  const user = findUserForToken(readCookie(c.req.header("cookie")));
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required." }, 403);
  }

  const search = c.req.query("q")?.trim() ?? "";
  const users = db.prepare(`
    SELECT id, email, role, created_at
    FROM users
    WHERE (? = '' OR email LIKE ?)
    ORDER BY created_at DESC
    LIMIT 200
  `).all(search, `%${search}%`);

  return c.json({ users });
});

// Admin: update a user's role with protection against self-demotion.
authRouter.patch("/admin/users/:id/role", async (c) => {
  const user = findUserForToken(readCookie(c.req.header("cookie")));
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required." }, 403);
  }

  const targetId = Number(c.req.param("id"));
  if (!Number.isSafeInteger(targetId) || targetId <= 0) {
    return c.json({ error: "Invalid user ID." }, 400);
  }

  if (user.id === targetId) {
    return c.json({ error: "For security, you cannot alter your own admin role." }, 400);
  }

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Please send valid JSON." }, 400);
  }

  const role = body && typeof body === "object" ? (body as Record<string, unknown>).role : undefined;
  if (role !== "user" && role !== "seller" && role !== "admin") {
    return c.json({ error: "Role must be 'user', 'seller', or 'admin'." }, 400);
  }

  const target = db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(targetId) as Record<string, unknown> | undefined;
  if (!target) {
    return c.json({ error: "User not found." }, 404);
  }

  db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, targetId);

  return c.json({ success: true, message: `User role updated to ${role}.` });
});

export function requireUser(token: string | undefined): User | null {
  return findUserForToken(token);
}
export function getUserFromCookieHeader(header: string | undefined): User | null {
  return findUserForToken(readCookie(header));
}
export function requireAdmin(token: string | undefined): User | null {
  const user = findUserForToken(token);
  return user?.role === "admin" ? user : null;
}

export function requireSeller(token: string | undefined): User | null {
  const user = findUserForToken(token);
  return user?.role === "seller" || user?.role === "admin" ? user : null;
}