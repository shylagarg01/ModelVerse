
import { Hono , type Context } from "hono";
import { db, getUserFromCookieHeader } from "./auth.js";

export const marketplaceRouter = new Hono();

db.exec(`
  CREATE TABLE IF NOT EXISTS marketplace_listings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    seller_id INTEGER NOT NULL REFERENCES users(id),
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    category TEXT NOT NULL,
    price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
    thumbnail_url TEXT,
    asset_url TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active'
      CHECK (status IN ('active', 'draft')),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS marketplace_listings_status
  ON marketplace_listings(status);

  CREATE INDEX IF NOT EXISTS marketplace_listings_seller
  ON marketplace_listings(seller_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS marketplace_purchases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    listing_id INTEGER NOT NULL REFERENCES marketplace_listings(id),
    buyer_id INTEGER NOT NULL REFERENCES users(id),
    seller_id INTEGER NOT NULL REFERENCES users(id),
    amount_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'completed'
      CHECK (status IN ('completed', 'refunded')),
    created_at INTEGER NOT NULL,
    UNIQUE (listing_id, buyer_id)
  );

  CREATE INDEX IF NOT EXISTS marketplace_purchases_buyer
  ON marketplace_purchases(buyer_id);

  CREATE INDEX IF NOT EXISTS marketplace_purchases_seller
  ON marketplace_purchases(seller_id);
`);

function currentUser(c: Context) {
  return getUserFromCookieHeader(c.req.header("cookie"));
}

function validUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.trim()) return false;

  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

// Public marketplace browsing and search.
marketplaceRouter.get("/listings", (c) => {
  const search = c.req.query("q")?.trim() ?? "";
  const category = c.req.query("category")?.trim() ?? "";

  const listings = db.prepare(`
    SELECT l.id, l.title, l.description, l.category,
      l.price_cents, l.thumbnail_url, 
      l.created_at, u.email AS seller_email
    FROM marketplace_listings l
    JOIN users u ON u.id = l.seller_id
    WHERE l.status = 'active'
      AND (? = '' OR l.title LIKE ? OR l.description LIKE ?)
      AND (? = '' OR l.category = ?)
    ORDER BY l.created_at DESC
    LIMIT 100
  `).all(
    search, `%${search}%`, `%${search}%`,
    category, category
  );

  return c.json({ listings });
});

// Get one public listing.
marketplaceRouter.get("/listings/:id", (c) => {
  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid listing ID" }, 400);
  }

  const listing = db.prepare(`
    SELECT l.id, l.title, l.description, l.category,
      l.price_cents, l.thumbnail_url, 
      l.created_at, u.email AS seller_email
    FROM marketplace_listings l
    JOIN users u ON u.id = l.seller_id
    WHERE l.id = ? AND l.status = 'active'
  `).get(id);

  if (!listing) return c.json({ error: "Listing not found" }, 404);
  return c.json({ listing });
});

// Seller's own listings.
marketplaceRouter.get("/my-listings", (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "Login required" }, 401);
  if (user.role !== "seller" && user.role !== "admin") {
    return c.json({ error: "Seller account required" }, 403);
  }

  const listings = db.prepare(`
    SELECT * FROM marketplace_listings
    WHERE seller_id = ?
    ORDER BY created_at DESC
  `).all(user.id);

  return c.json({ listings });
});

// Create a listing.
marketplaceRouter.post("/listings", async (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "Login required" }, 401);
  if (user.role !== "seller" && user.role !== "admin") {
    return c.json({ error: "Approved seller account required" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const { title, description, category, price_cents, thumbnail_url, asset_url } = body;

  if (
    typeof title !== "string" || !title.trim() || title.length > 120 ||
    typeof description !== "string" || !description.trim() || description.length > 5000 ||
    typeof category !== "string" || !category.trim() || category.length > 60 ||
    !Number.isSafeInteger(price_cents) || (price_cents as number) < 0 ||
    !validUrl(asset_url) ||
    (thumbnail_url != null && thumbnail_url !== "" && !validUrl(thumbnail_url))
  ) {
    return c.json({ error: "Please provide valid listing details and URLs" }, 400);
  }

  const now = Math.floor(Date.now() / 1000);
  const result = db.prepare(`
    INSERT INTO marketplace_listings
      (seller_id, title, description, category, price_cents,
       thumbnail_url, asset_url, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    user.id, title.trim(), description.trim(), category.trim(),
    price_cents as number,
    typeof thumbnail_url === "string" && thumbnail_url ? thumbnail_url : null,
    asset_url, now, now
  );

  return c.json({ success: true, id: Number(result.lastInsertRowid) }, 201);
});

// Update a seller's own listing.
marketplaceRouter.patch("/listings/:id", async (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "Login required" }, 401);
  if (user.role !== "seller" && user.role !== "admin") {
    return c.json({ error: "Seller account required" }, 403);
  }

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid listing ID" }, 400);
  }

  const existing = db.prepare(
    "SELECT * FROM marketplace_listings WHERE id = ?"
  ).get(id) as Record<string, unknown> | undefined;

  if (!existing) return c.json({ error: "Listing not found" }, 404);
  if (existing.seller_id !== user.id && user.role !== "admin") {
    return c.json({ error: "You cannot edit this listing" }, 403);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const title = body.title ?? existing.title;
  const description = body.description ?? existing.description;
  const category = body.category ?? existing.category;
  const price = body.price_cents ?? existing.price_cents;
  const assetUrl = body.asset_url ?? existing.asset_url;
  const thumbnail = body.thumbnail_url === undefined
    ? existing.thumbnail_url
    : body.thumbnail_url;

  if (
    typeof title !== "string" || !title.trim() || title.length > 120 ||
    typeof description !== "string" || !description.trim() || description.length > 5000 ||
    typeof category !== "string" || !category.trim() || category.length > 60 ||
    !Number.isSafeInteger(price) || (price as number) < 0 ||
    !validUrl(assetUrl) ||
    (thumbnail != null && thumbnail !== "" && !validUrl(thumbnail))
  ) {
    return c.json({ error: "Invalid listing details" }, 400);
  }

  db.prepare(`
    UPDATE marketplace_listings
    SET title = ?, description = ?, category = ?, price_cents = ?,
        asset_url = ?, thumbnail_url = ?, updated_at = ?
    WHERE id = ?
  `).run(
    title.trim(), description.trim(), category.trim(), price as number,
    assetUrl,
    typeof thumbnail === "string" && thumbnail ? thumbnail : null,
    Math.floor(Date.now() / 1000), id
  );

  return c.json({ success: true });
});

// Delete a seller's own listing.
marketplaceRouter.delete("/listings/:id", (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "Login required" }, 401);
  if (user.role !== "seller" && user.role !== "admin") {
    return c.json({ error: "Seller account required" }, 403);
  }

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid listing ID" }, 400);
  }

  const existing = db.prepare(
    "SELECT seller_id FROM marketplace_listings WHERE id = ?"
  ).get(id) as { seller_id: number } | undefined;

  if (!existing) return c.json({ error: "Listing not found" }, 404);
  if (existing.seller_id !== user.id && user.role !== "admin") {
    return c.json({ error: "You cannot delete this listing" }, 403);
  }

  db.prepare("DELETE FROM marketplace_listings WHERE id = ?").run(id);
  return c.json({ success: true });
});


// Simulated checkout. No real payment is collected.
marketplaceRouter.post("/checkout/:id", (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "Login required" }, 401);

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid listing ID" }, 400);
  }

  const listing = db.prepare(`
    SELECT id, seller_id, price_cents
    FROM marketplace_listings
    WHERE id = ? AND status = 'active'
  `).get(id) as {
    id: number;
    seller_id: number;
    price_cents: number;
  } | undefined;

  if (!listing) return c.json({ error: "Listing not found" }, 404);

  if (listing.seller_id === user.id) {
    return c.json({ error: "You cannot purchase your own listing" }, 403);
  }

  try {
    const result = db.prepare(`
      INSERT INTO marketplace_purchases
        (listing_id, buyer_id, seller_id, amount_cents, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(
      listing.id,
      user.id,
      listing.seller_id,
      listing.price_cents,
      Math.floor(Date.now() / 1000)
    );

    return c.json({
      success: true,
      simulated: true,
      purchase_id: Number(result.lastInsertRowid),
      message: "Demo purchase recorded successfully. No payment was collected."
    }, 201);
  } catch (error) {
    if (String(error).includes("UNIQUE constraint failed")) {
      return c.json({ error: "You have already purchased this listing" }, 409);
    }
    throw error;
  }
});

// Buyer's purchase history.
marketplaceRouter.get("/my-purchases", (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "Login required" }, 401);

  const purchases = db.prepare(`
    SELECT p.id AS purchase_id, p.amount_cents, p.status,
      p.created_at, l.id AS listing_id, l.title,
      l.thumbnail_url, l.asset_url,
      u.email AS seller_email
    FROM marketplace_purchases p
    JOIN marketplace_listings l ON l.id = p.listing_id
    JOIN users u ON u.id = p.seller_id
    WHERE p.buyer_id = ?
    ORDER BY p.created_at DESC
  `).all(user.id);

  return c.json({ purchases });
});

// Seller's sales history.
marketplaceRouter.get("/my-sales", (c) => {
  const user = currentUser(c);
  if (!user) return c.json({ error: "Login required" }, 401);
  if (user.role !== "seller" && user.role !== "admin") {
    return c.json({ error: "Seller account required" }, 403);
  }

  const sales = db.prepare(`
    SELECT p.id AS purchase_id, p.amount_cents, p.status,
      p.created_at, l.id AS listing_id, l.title,
      u.email AS buyer_email
    FROM marketplace_purchases p
    JOIN marketplace_listings l ON l.id = p.listing_id
    JOIN users u ON u.id = p.buyer_id
    WHERE p.seller_id = ?
    ORDER BY p.created_at DESC
  `).all(user.id);

  return c.json({ sales });
});

// Admin: view all marketplace listings across all sellers.
marketplaceRouter.get("/admin/listings", (c) => {
  const user = currentUser(c);
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const listings = db.prepare(`
    SELECT l.*, u.email AS seller_email
    FROM marketplace_listings l
    JOIN users u ON u.id = l.seller_id
    ORDER BY l.created_at DESC
  `).all();

  return c.json({ listings });
});

// Admin: moderate listing status (active or draft).
marketplaceRouter.patch("/admin/listings/:id/status", async (c) => {
  const user = currentUser(c);
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid listing ID" }, 400);
  }

  let body: Record<string, unknown>;
  try {
    body = await c.req.json() as Record<string, unknown>;
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const status = body.status;
  if (status !== "active" && status !== "draft") {
    return c.json({ error: "Status must be 'active' or 'draft'" }, 400);
  }

  db.prepare(`
    UPDATE marketplace_listings
    SET status = ?, updated_at = ?
    WHERE id = ?
  `).run(status, Math.floor(Date.now() / 1000), id);

  return c.json({ success: true, status });
});

// Admin: remove/delete any marketplace listing.
marketplaceRouter.delete("/admin/listings/:id", (c) => {
  const user = currentUser(c);
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const id = Number(c.req.param("id"));
  if (!Number.isInteger(id) || id < 1) {
    return c.json({ error: "Invalid listing ID" }, 400);
  }

  db.prepare("DELETE FROM marketplace_listings WHERE id = ?").run(id);
  return c.json({ success: true });
});

// Admin: view all platform purchases.
marketplaceRouter.get("/admin/purchases", (c) => {
  const user = currentUser(c);
  if (!user || user.role !== "admin") {
    return c.json({ error: "Admin access required" }, 403);
  }

  const purchases = db.prepare(`
    SELECT p.id, p.amount_cents, p.status, p.created_at,
      l.title AS listing_title, l.id AS listing_id,
      buyer.email AS buyer_email,
      seller.email AS seller_email
    FROM marketplace_purchases p
    JOIN marketplace_listings l ON l.id = p.listing_id
    JOIN users buyer ON buyer.id = p.buyer_id
    JOIN users seller ON seller.id = p.seller_id
    ORDER BY p.created_at DESC
  `).all();

  return c.json({ purchases });
});

