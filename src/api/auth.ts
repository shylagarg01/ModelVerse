import { randomBytes, createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import argon2 from "argon2";
import { Hono } from "hono";

const databasePath = resolve(process.env.AUTH_DB_PATH ?? "data/modelverse-auth.sqlite");
mkdirSync(dirname(databasePath), { recursive: true });

const db = new DatabaseSync(databasePath);
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

const SESSION_COOKIE = "modelverse_session";
const SESSION_LIFETIME_SECONDS = 60 * 60 * 24 * 7;

type User = {
  id: number;
  email: string;
  role: "user" | "admin";
};

function publicUser(row: Record<string, unknown>): User {
  return {
    id: Number(row.id),
    email: String(row.email),
    role: row.role === "admin" ? "admin" : "user",
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
    SELECT users.id, users.email, users.role
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

export function requireUser(token: string | undefined): User | null {
  return findUserForToken(token);
}

export function requireAdmin(token: string | undefined): User | null {
  const user = findUserForToken(token);
  return user?.role === "admin" ? user : null;
}

