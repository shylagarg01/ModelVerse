import { useEffect, useState } from "react";
import {
  User as UserIcon,
  ShoppingBag,
  Package,
  Sparkles,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Clock3,
  Box,
  Compass,
  ArrowUpRight,
} from "lucide-react";

interface UserProfile {
  id: number;
  email: string;
  role: "user" | "seller" | "admin";
  created_at?: number;
}

interface Purchase {
  purchase_id: number;
  amount_cents: number;
  status: string;
  created_at: number;
  listing_id: number;
  title: string;
  thumbnail_url: string | null;
  asset_url: string;
  seller_email: string;
}

interface SellerApplication {
  id: number;
  business_name: string;
  description: string;
  status: "pending" | "approved" | "rejected";
  created_at: number;
  reviewed_at?: number | null;
}

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);

export default function UserDashboardApp() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [application, setApplication] = useState<SellerApplication | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "purchases" | "seller_app">("overview");

  // Seller application form state
  const [businessName, setBusinessName] = useState("");
  const [appDescription, setAppDescription] = useState("");
  const [submittingApp, setSubmittingApp] = useState(false);
  const [appMessage, setAppMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function checkAuthAndLoadData() {
    setLoading(true);
    try {
      const res = await fetch("/auth/me", { credentials: "include" });
      if (!res.ok) throw new Error("Auth check failed");
      const data = await res.json();

      if (!data.user) {
        window.location.href = "/auth/login?redirect=/dashboard";
        return;
      }
      setUser(data.user);

      // Load purchases
      try {
        const pRes = await fetch("/marketplace-api/my-purchases", { credentials: "include" });
        if (pRes.ok) {
          const pData = await pRes.json();
          setPurchases(pData.purchases ?? []);
        }
      } catch (err) {
        console.error("Error loading purchases:", err);
      }

      // Load seller application status
      try {
        const sRes = await fetch("/auth/seller/application", { credentials: "include" });
        if (sRes.ok) {
          const sData = await sRes.json();
          setApplication(sData.application ?? null);
        }
      } catch (err) {
        console.error("Error loading seller application:", err);
      }
    } catch {
      window.location.href = "/auth/login?redirect=/dashboard";
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    checkAuthAndLoadData();
  }, []);

  async function handleApplySeller(e: React.FormEvent) {
    e.preventDefault();
    setSubmittingApp(true);
    setAppMessage(null);

    try {
      const res = await fetch("/auth/seller/apply", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessName: businessName.trim(),
          description: appDescription.trim(),
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setAppMessage({ text: data.error || "Failed to submit application.", error: true });
        return;
      }

      setAppMessage({ text: "Your seller application has been submitted successfully for admin review!", error: false });
      setApplication({
        id: Date.now(),
        business_name: businessName,
        description: appDescription,
        status: "pending",
        created_at: Math.floor(Date.now() / 1000),
      });
      setBusinessName("");
      setAppDescription("");
    } catch {
      setAppMessage({ text: "Could not submit application. Check your connection.", error: true });
    } finally {
      setSubmittingApp(false);
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-3 border-primary border-t-transparent"></div>
          <p className="text-sm text-muted-foreground">Loading your dashboard...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  const totalSpent = purchases.reduce((acc, p) => acc + p.amount_cents, 0);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Top Welcome Header */}
      <div className="mb-8 flex flex-col justify-between gap-4 rounded-3xl border border-border/80 bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:p-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <UserIcon size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">
                  User Dashboard
                </h1>
                <span className="rounded-full bg-primary/15 px-3 py-0.5 text-xs font-bold uppercase tracking-wide text-primary">
                  {user.role}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Signed in as <span className="font-semibold text-foreground">{user.email}</span>
              </p>
            </div>
          </div>
        </div>

        {/* Role Quick Links */}
        <div className="flex flex-wrap items-center gap-2.5">
          {user.role === "seller" && (
            <a
              href="/seller/dashboard"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-xs transition hover:opacity-95"
            >
              <span>Go to Seller Studio</span>
              <ArrowRight size={14} />
            </a>
          )}
          {user.role === "admin" && (
            <a
              href="/admin"
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-xs transition hover:opacity-95"
            >
              <ShieldCheck size={16} />
              <span>Admin Panel</span>
              <ArrowRight size={14} />
            </a>
          )}
          <a
            href="/marketplace"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground shadow-2xs transition hover:bg-accent"
          >
            <ShoppingBag size={14} className="text-primary" />
            <span>Marketplace</span>
          </a>
          <a
            href="/search"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground shadow-2xs transition hover:bg-accent"
          >
            <Compass size={14} className="text-primary" />
            <span>Free 3D Assets</span>
          </a>
        </div>
      </div>

      {/* Stats Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Purchases</span>
            <Package size={18} className="text-primary" />
          </div>
          <p className="mt-2 text-2xl font-black text-foreground">{purchases.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">Digital 3D assets in your library</p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Simulated Spend</span>
            <ShoppingBag size={18} className="text-primary" />
          </div>
          <p className="mt-2 text-2xl font-black text-primary">{money(totalSpent)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Recorded in demo checkout</p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Creator Status</span>
            <Sparkles size={18} className="text-primary" />
          </div>
          <div className="mt-2 flex items-center gap-2">
            {user.role === "seller" ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-primary">
                <CheckCircle2 size={16} /> Approved Seller
              </span>
            ) : application?.status === "pending" ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-amber-600 dark:text-amber-400">
                <Clock3 size={16} /> Pending Review
              </span>
            ) : application?.status === "rejected" ? (
              <span className="inline-flex items-center gap-1.5 text-sm font-bold text-destructive">
                <AlertCircle size={16} /> Rejected (Can Reapply)
              </span>
            ) : (
              <span className="text-sm font-bold text-muted-foreground">Standard User</span>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {user.role === "seller"
              ? "Can publish & sell assets"
              : "Apply below to monetize 3D assets"}
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-border/80 pb-2">
        <button
          onClick={() => setActiveTab("overview")}
          className={`rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "overview"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          Overview &amp; Shortcuts
        </button>

        <button
          onClick={() => setActiveTab("purchases")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "purchases"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <span>Purchase History</span>
          {purchases.length > 0 && (
            <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px]">
              {purchases.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("seller_app")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "seller_app"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <span>Become a Seller</span>
          {application?.status === "pending" && (
            <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-[10px] text-amber-600 dark:text-amber-400">
              Pending
            </span>
          )}
        </button>
      </div>

      {/* Tab 1: Overview */}
      {activeTab === "overview" && (
        <div className="grid gap-6 md:grid-cols-2">
          {/* Account Profile Details */}
          <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
            <h2 className="text-base font-bold text-foreground">Account Information</h2>
            <p className="mt-1 text-xs text-muted-foreground">Your verified ModelVerse profile details.</p>

            <div className="mt-5 space-y-3.5 text-sm">
              <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                <span className="text-muted-foreground">Account Email</span>
                <span className="font-semibold text-foreground">{user.email}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                <span className="text-muted-foreground">Assigned Role</span>
                <span className="font-semibold capitalize text-primary">{user.role}</span>
              </div>
              <div className="flex items-center justify-between border-b border-border/60 pb-2.5">
                <span className="text-muted-foreground">User ID</span>
                <span className="font-mono text-xs text-muted-foreground">#{user.id}</span>
              </div>
              {user.created_at && (
                <div className="flex items-center justify-between pb-1">
                  <span className="text-muted-foreground">Registered</span>
                  <span className="text-xs text-foreground">
                    {new Date(user.created_at * 1000).toLocaleDateString()}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Quick Platform Actions */}
          <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs">
            <h2 className="text-base font-bold text-foreground">Quick Shortcuts</h2>
            <p className="mt-1 text-xs text-muted-foreground">Jump directly to your favorite creative tools.</p>

            <div className="mt-5 grid gap-2.5">
              <a
                href="/search"
                className="group flex items-center justify-between rounded-xl border border-border p-3.5 transition hover:border-primary/50 hover:bg-accent"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Compass size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-foreground group-hover:text-primary transition">
                      Explore Free 3D Assets
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Search models, textures, materials and HDRIs
                    </p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-muted-foreground group-hover:text-primary transition" />
              </a>

              <a
                href="/editor"
                className="group flex items-center justify-between rounded-xl border border-border p-3.5 transition hover:border-primary/50 hover:bg-accent"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Box size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-foreground group-hover:text-primary transition">
                      Open 3D Browser Studio
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Inspect, light, transform, and render 3D assets in WebGL
                    </p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-muted-foreground group-hover:text-primary transition" />
              </a>

              <a
                href="/marketplace"
                className="group flex items-center justify-between rounded-xl border border-border p-3.5 transition hover:border-primary/50 hover:bg-accent"
              >
                <div className="flex items-center gap-3">
                  <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <ShoppingBag size={18} />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-foreground group-hover:text-primary transition">
                      Creator Marketplace
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      Discover original models, stylized kits and direct downloads
                    </p>
                  </div>
                </div>
                <ArrowRight size={16} className="text-muted-foreground group-hover:text-primary transition" />
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Purchase History */}
      {activeTab === "purchases" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-bold text-foreground">Your Purchased 3D Assets</h2>
              <p className="text-xs text-muted-foreground">
                Assets acquired via the ModelVerse simulated marketplace. Instant access guaranteed.
              </p>
            </div>
            <a
              href="/marketplace"
              className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow-xs transition hover:opacity-95"
            >
              <ShoppingBag size={14} />
              <span>Browse Marketplace</span>
            </a>
          </div>

          {purchases.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card p-12 text-center">
              <Package size={36} className="mx-auto text-muted-foreground/60" />
              <h3 className="mt-3 text-base font-bold text-foreground">No purchases yet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                You haven't purchased any assets yet. Visit the creator marketplace to test simulated checkouts.
              </p>
              <a
                href="/marketplace"
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-xs transition hover:opacity-95"
              >
                <span>Explore Marketplace</span>
                <ArrowRight size={14} />
              </a>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {purchases.map((p) => (
                <div
                  key={p.purchase_id}
                  className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-4 shadow-xs"
                >
                  <div>
                    <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
                      {p.thumbnail_url ? (
                        <img
                          src={p.thumbnail_url}
                          alt={p.title}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <Box size={28} className="text-primary/60" />
                        </div>
                      )}
                      <span className="absolute right-2.5 top-2.5 rounded-md bg-background/90 px-2 py-0.5 text-[10px] font-bold text-primary backdrop-blur-sm">
                        Purchased
                      </span>
                    </div>

                    <h4 className="mt-3 truncate text-sm font-bold text-foreground" title={p.title}>
                      {p.title}
                    </h4>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Seller: <span className="text-foreground">{p.seller_email}</span>
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      Date: {new Date(p.created_at * 1000).toLocaleDateString()}
                    </p>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-border/60 pt-3">
                    <span className="font-bold text-primary">{money(p.amount_cents)}</span>
                    <a
                      href={p.asset_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg bg-primary/10 border border-primary/20 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20 transition"
                    >
                      <span>Access Asset</span>
                      <ExternalLink size={12} />
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Seller Application */}
      {activeTab === "seller_app" && (
        <div className="mx-auto max-w-2xl">
          {user.role === "seller" || user.role === "admin" ? (
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-6 text-center">
              <CheckCircle2 size={40} className="mx-auto text-primary" />
              <h3 className="mt-3 text-lg font-bold text-foreground">
                You are an approved creator!
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Your account has full seller privileges. You can publish, edit, and manage 3D asset listings.
              </p>
              <a
                href="/seller/dashboard"
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-xs transition hover:opacity-95"
              >
                <span>Open Seller Studio</span>
                <ArrowRight size={14} />
              </a>
            </div>
          ) : application?.status === "pending" ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-6 text-center">
              <Clock3 size={40} className="mx-auto text-amber-600 dark:text-amber-400" />
              <h3 className="mt-3 text-lg font-bold text-foreground">
                Seller Application Under Review
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Your application for <span className="font-semibold text-foreground">{application.business_name}</span> is currently being evaluated by administrators.
              </p>
              <div className="mt-4 rounded-xl border border-amber-500/20 bg-card p-4 text-left text-xs">
                <span className="font-semibold text-muted-foreground">Submitted proposal:</span>
                <p className="mt-1 text-foreground">{application.description}</p>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Applied on: {new Date(application.created_at * 1000).toLocaleString()}
                </p>
              </div>
            </div>
          ) : (
            <div className="rounded-2xl border border-border/80 bg-card p-6 shadow-xs sm:p-8">
              <div className="mb-6">
                <h3 className="text-xl font-bold text-foreground">Apply to Become a Creator</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Publish original 3D models, textures, materials, and game kits on ModelVerse.
                </p>
                {application?.status === "rejected" && (
                  <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                    Your previous application was not accepted. You may review your information and re-apply below.
                  </div>
                )}
              </div>

              {appMessage && (
                <div
                  className={`mb-4 rounded-xl border p-3 text-xs font-semibold ${
                    appMessage.error
                      ? "border-destructive/30 bg-destructive/10 text-destructive"
                      : "border-primary/30 bg-primary/10 text-primary"
                  }`}
                >
                  {appMessage.text}
                </div>
              )}

              <form onSubmit={handleApplySeller} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-foreground">
                    Business / Studio / Creator Name
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    placeholder="e.g. PolyCraft Studios"
                    value={businessName}
                    onChange={(e) => setBusinessName(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs text-foreground outline-none focus:border-primary"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-foreground">
                    Creator Profile &amp; Asset Types
                  </label>
                  <textarea
                    required
                    rows={4}
                    maxLength={1000}
                    placeholder="Describe the 3D assets you intend to sell (e.g. low-poly game models, PBR textures, modular dungeon kits)..."
                    value={appDescription}
                    onChange={(e) => setAppDescription(e.target.value)}
                    className="mt-1.5 w-full rounded-xl border border-border bg-background px-3.5 py-2.5 text-xs text-foreground outline-none focus:border-primary"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submittingApp}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-xs font-bold text-primary-foreground shadow-xs transition hover:opacity-95 disabled:opacity-50"
                >
                  {submittingApp ? "Submitting Application..." : "Submit Seller Application"}
                  <ArrowUpRight size={14} />
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
