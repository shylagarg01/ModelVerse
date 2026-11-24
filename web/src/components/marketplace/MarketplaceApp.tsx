import { useEffect, useState } from "react";
import {
  Search,
  ShoppingBag,
  Box,
  Layers3,
  Image,
  Package,
  Sparkles,
  ArrowUpRight,
  RefreshCw,
  Tag,
  User,
  CheckCircle2,
} from "lucide-react";

interface Listing {
  id: number;
  title: string;
  description: string;
  category: string;
  price_cents: number;
  thumbnail_url: string | null;
  created_at: number;
  seller_email: string;
}

interface CurrentUser {
  id: number;
  email: string;
  role: "user" | "seller" | "admin";
}

const CATEGORIES = [
  { name: "All Assets", icon: Layers3 },
  { name: "3D Models", icon: Box },
  { name: "Textures", icon: Image },
  { name: "Materials", icon: Sparkles },
  { name: "Asset Packs", icon: Package },
];

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);

export default function MarketplaceApp() {
  const [listings, setListings] = useState<Listing[]>([]);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All Assets");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [purchasedListingIds, setPurchasedListingIds] = useState<Set<number>>(new Set());
  const [checkingOutId, setCheckingOutId] = useState<number | null>(null);
  const [checkoutSuccess, setCheckoutSuccess] = useState<{ title: string; price_cents: number } | null>(null);

  async function loadUserAndPurchases() {
    try {
      const res = await fetch("/auth/me", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setCurrentUser(data.user);
          try {
            const pRes = await fetch("/marketplace-api/my-purchases", { credentials: "include" });
            if (pRes.ok) {
              const pData = await pRes.json();
              const ids = new Set<number>((pData.purchases ?? []).map((p: { listing_id: number }) => p.listing_id));
              setPurchasedListingIds(ids);
            }
          } catch {
            // Ignore purchases load fail
          }
        }
      }
    } catch {
      // Unauthenticated
    }
  }

  async function loadListings(query = search, selected = category) {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();

      if (query.trim()) params.set("q", query.trim());
      if (selected !== "All Assets") params.set("category", selected);

      const response = await fetch(
        `/marketplace-api/listings?${params.toString()}`
      );

      if (!response.ok) {
        throw new Error("Unable to load marketplace listings.");
      }

      const data = await response.json();
      setListings(data.listings ?? []);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Something went wrong."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadUserAndPurchases();
    loadListings("", "All Assets");
  }, []);

  function handleSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    loadListings(search, category);
  }

  function selectCategory(value: string) {
    setCategory(value);
    loadListings(search, value);
  }

  async function handleCheckout(listing: Listing) {
    if (!currentUser) {
      window.location.href = "/auth/login?redirect=/marketplace";
      return;
    }

    if (currentUser.email === listing.seller_email) {
      alert("You cannot purchase your own asset listing.");
      return;
    }

    setCheckingOutId(listing.id);
    try {
      const res = await fetch(`/marketplace-api/checkout/${listing.id}`, {
        method: "POST",
        credentials: "include",
      });

      const data = await res.json();
      if (!res.ok) {
        alert(data.error || "Checkout failed");
        return;
      }

      setPurchasedListingIds((prev) => new Set([...prev, listing.id]));
      setCheckoutSuccess({
        title: listing.title,
        price_cents: listing.price_cents,
      });
    } catch {
      alert("Connection error during checkout.");
    } finally {
      setCheckingOutId(null);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      {/* Hero Section */}
      <section className="relative isolate overflow-hidden border-b border-border/80 pb-16 pt-12 sm:pb-20 sm:pt-16">
        <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_70%_20%,color-mix(in_oklch,var(--color-primary)_12%,transparent),transparent_60%)]" />

        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-semibold text-primary">
              <Sparkles size={14} />
              <span>ModelVerse Creator Marketplace</span>
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight sm:text-5xl lg:text-6xl text-foreground">
              Discover authentic digital assets <br className="hidden sm:inline" />
              <span className="text-primary dark:text-[#C5F467]">from 3D creators.</span>
            </h1>

            <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
              Explore game-ready 3D models, stylized textures, and modular kits crafted by independent artists with instant delivery and commercial licenses.
            </p>

            <form
              onSubmit={handleSearch}
              className="mt-8 flex max-w-2xl items-center gap-2 rounded-2xl border-2 border-border/80 bg-card p-2 shadow-xl shadow-primary/5 transition-all focus-within:border-primary focus-within:shadow-2xl focus-within:shadow-primary/10"
            >
              <Search className="ml-3 shrink-0 text-muted-foreground" size={20} />

              <input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search marketplace models, textures, asset kits..."
                className="min-w-0 flex-1 bg-transparent py-2.5 text-sm font-normal text-foreground outline-none placeholder:text-muted-foreground/60"
              />

              <button
                type="submit"
                className="rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-95"
              >
                Search
              </button>
            </form>

            <div className="mt-5 flex flex-wrap gap-4 text-xs font-medium text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <Box size={14} className="text-primary" />
                3D Models &amp; Meshes
              </span>
              <span className="flex items-center gap-1.5">
                <Layers3 size={14} className="text-primary" />
                Direct Creator Support
              </span>
              <span className="flex items-center gap-1.5">
                <ShoppingBag size={14} className="text-primary" />
                Transparent Licensing
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <span className="rounded-full bg-primary/10 border border-primary/20 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
              Directory
            </span>
            <h2 className="mt-2 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              Marketplace Listings
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Verified assets uploaded and priced by creators.
            </p>
          </div>

          <button
            onClick={() => loadListings()}
            disabled={loading}
            className="inline-flex items-center gap-2 self-start rounded-xl border border-border bg-card px-4 py-2 text-xs font-semibold text-foreground transition hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw size={14} className={loading ? "animate-spin text-primary" : ""} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Categories Bar */}
        <div className="mb-8 flex gap-2 overflow-x-auto pb-2" role="group" aria-label="Marketplace categories">
          {CATEGORIES.map(({ name, icon: Icon }) => (
            <button
              key={name}
              onClick={() => selectCategory(name)}
              className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-semibold transition ${
                category === name
                  ? "border-primary bg-primary text-primary-foreground shadow-xs"
                  : "border-border/80 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
              }`}
            >
              <Icon size={15} />
              <span>{name}</span>
            </button>
          ))}
        </div>

        {/* Results Header */}
        <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3 text-xs">
          <span className="font-semibold text-foreground">
            {category} {search ? `matching "${search}"` : ""}
          </span>
          <span className="text-muted-foreground font-medium">
            {loading ? "Searching..." : `${listings.length} ${listings.length === 1 ? "product" : "products"}`}
          </span>
        </div>

        {/* Error State */}
        {error && (
          <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-5 text-sm text-destructive shadow-xs">
            <p className="font-semibold">Unable to load marketplace listings</p>
            <p className="mt-1 text-xs opacity-90">{error}</p>
            <button
              onClick={() => loadListings()}
              className="mt-3 inline-flex items-center gap-1 rounded-lg border border-destructive/30 px-3 py-1 text-xs font-semibold hover:bg-destructive/10 transition"
            >
              Retry
            </button>
          </div>
        )}

        {/* Loading Skeletons */}
        {loading && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="animate-pulse overflow-hidden rounded-2xl border border-border/80 bg-card"
              >
                <div className="aspect-[4/3] bg-muted" />
                <div className="space-y-3 p-5">
                  <div className="h-4 w-3/4 rounded bg-muted" />
                  <div className="h-3 w-full rounded bg-muted" />
                  <div className="h-5 w-1/3 rounded bg-muted" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Listings Grid */}
        {!loading && !error && listings.length > 0 && (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {listings.map((listing) => {
              const isOwner = currentUser?.email === listing.seller_email;
              const isPurchased = purchasedListingIds.has(listing.id);

              return (
                <article
                  key={listing.id}
                  className="group flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card transition duration-300 hover:-translate-y-1 hover:border-primary/50 hover:shadow-xl hover:shadow-primary/5"
                >
                  <div>
                    <div className="relative aspect-[4/3] overflow-hidden bg-muted">
                      {listing.thumbnail_url ? (
                        <img
                          src={listing.thumbnail_url}
                          alt={listing.title}
                          loading="lazy"
                          className="size-full object-cover transition duration-500 group-hover:scale-105"
                        />
                      ) : (
                        <div className="flex size-full flex-col items-center justify-center gap-2 text-muted-foreground">
                          <Box size={38} strokeWidth={1.5} className="text-primary/60" />
                          <span className="font-mono text-[11px] uppercase tracking-wider">{listing.category}</span>
                        </div>
                      )}

                      <span className="absolute left-3 top-3 rounded-lg border border-border/80 bg-background/90 px-2.5 py-1 text-[11px] font-semibold backdrop-blur-md">
                        {listing.category}
                      </span>
                    </div>

                    <div className="p-5">
                      <h3 className="truncate text-base font-bold text-foreground group-hover:text-primary transition" title={listing.title}>
                        {listing.title}
                      </h3>

                      <p className="mt-2 line-clamp-2 min-h-10 text-xs leading-relaxed text-muted-foreground">
                        {listing.description}
                      </p>
                    </div>
                  </div>

                  <div className="border-t border-border/60 p-5 pt-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Price</span>
                        <p className="mt-0.5 text-lg font-extrabold text-primary">
                          {money(listing.price_cents)}
                        </p>
                      </div>

                      <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-muted/60 px-2.5 py-1 text-xs font-medium text-foreground">
                        <Tag size={12} className="text-primary" />
                        <span>Instant Access</span>
                      </span>
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2.5 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-1 truncate max-w-44" title={listing.seller_email}>
                        <User size={12} />
                        <span className="truncate">{listing.seller_email}</span>
                      </span>
                      <span className="font-mono text-[10px]">
                        {new Date(listing.created_at).toLocaleDateString()}
                      </span>
                    </div>

                    {/* Interactive Checkout Action */}
                    <div className="mt-3.5 border-t border-border/40 pt-3">
                      {isPurchased ? (
                        <a
                          href="/dashboard"
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary/15 py-2 text-xs font-bold text-primary transition hover:bg-primary/20"
                        >
                          <CheckCircle2 size={14} />
                          <span>Owned in Dashboard →</span>
                        </a>
                      ) : isOwner ? (
                        <a
                          href="/seller/dashboard"
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-xs font-semibold text-muted-foreground hover:bg-accent"
                        >
                          <span>Your Asset (Edit)</span>
                        </a>
                      ) : (
                        <button
                          onClick={() => handleCheckout(listing)}
                          disabled={checkingOutId === listing.id}
                          className="inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2 text-xs font-bold text-primary-foreground shadow-xs transition hover:opacity-95 disabled:opacity-50"
                        >
                          <ShoppingBag size={14} />
                          <span>{checkingOutId === listing.id ? "Processing..." : "Buy Asset (Demo)"}</span>
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        {/* Empty State */}
        {!loading && !error && listings.length === 0 && (
          <div className="rounded-3xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
            <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShoppingBag size={28} />
            </div>

            <h3 className="text-xl font-bold text-foreground">
              No marketplace listings in this category yet
            </h3>

            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Creators are regularly publishing new 3D models and textures. Check back soon or reset your category filters.
            </p>

            <button
              onClick={() => {
                setSearch("");
                setCategory("All Assets");
                loadListings("", "All Assets");
              }}
              className="mt-6 rounded-xl bg-primary px-6 py-2.5 text-xs font-semibold text-primary-foreground shadow-sm transition hover:opacity-95"
            >
              View all listings
            </button>
          </div>
        )}
      </section>

      {/* Seller Onboarding CTA Banner */}
      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl border border-primary/20 bg-card p-8 shadow-xl sm:p-12">
          <div className="pointer-events-none absolute -right-16 -top-16 size-72 rounded-full bg-primary/10 blur-3xl" />

          <div className="relative max-w-2xl">
            <div className="mb-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
              <Sparkles size={14} />
              <span>For 3D Creators &amp; Artists</span>
            </div>

            <h2 className="text-2xl font-extrabold sm:text-4xl text-foreground">
              Monetize your 3D creations on ModelVerse.
            </h2>

            <p className="mt-3 text-sm leading-relaxed text-muted-foreground sm:text-base">
              Publish your original 3D models, textures, materials, and game kits. Set your own pricing, reach an active creative audience, and manage your inventory with ease.
            </p>

            <div className="mt-7 flex flex-wrap gap-3">
              <a
                href={
                  currentUser?.role === "seller"
                    ? "/seller/dashboard"
                    : currentUser
                    ? "/dashboard"
                    : "/auth/register"
                }
                className="inline-flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/15 transition hover:opacity-95"
              >
                <span>
                  {currentUser?.role === "seller"
                    ? "Open Seller Studio"
                    : currentUser
                    ? "Apply for Seller Account"
                    : "Become a Seller"}
                </span>
                <ArrowUpRight size={16} />
              </a>

              {!currentUser && (
                <a
                  href="/auth/login?redirect=/marketplace"
                  className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground shadow-xs transition hover:bg-accent"
                >
                  <span>Seller Login</span>
                </a>
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Simulated Checkout Success Modal */}
      {checkoutSuccess && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl border border-primary/30 bg-card p-6 shadow-2xl text-center">
            <div className="mx-auto mb-3 flex size-14 items-center justify-center rounded-2xl bg-primary/15 text-primary">
              <Sparkles size={28} />
            </div>
            <h3 className="text-xl font-bold text-foreground">
              Simulated Purchase Recorded!
            </h3>
            <p className="mt-1 text-sm font-semibold text-primary">
              {checkoutSuccess.title}
            </p>
            <div className="my-4 rounded-xl border border-primary/20 bg-primary/10 p-3 text-xs text-muted-foreground text-left leading-relaxed">
              <span className="font-semibold text-foreground">Demo Transaction:</span> No payment card was charged. The simulated order was logged in the database and instant asset access has been added to your dashboard.
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setCheckoutSuccess(null)}
                className="flex-1 rounded-xl border border-border py-2.5 text-xs font-semibold text-foreground hover:bg-accent"
              >
                Continue Browsing
              </button>
              <a
                href="/dashboard"
                className="flex-1 rounded-xl bg-primary py-2.5 text-xs font-bold text-primary-foreground hover:opacity-95 transition"
              >
                Go to Dashboard →
              </a>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
