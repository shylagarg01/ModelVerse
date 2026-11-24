import { useEffect, useState } from "react";
import {
  Store,
  Package,
  PlusCircle,
  DollarSign,
  TrendingUp,
  Edit2,
  Trash2,
  ExternalLink,
  CheckCircle2,
  Info,
  Box,
  ArrowRight,
  ShieldAlert,
} from "lucide-react";

interface UserProfile {
  id: number;
  email: string;
  role: "user" | "seller" | "admin";
}

interface Listing {
  id: number;
  seller_id: number;
  title: string;
  description: string;
  category: string;
  price_cents: number;
  thumbnail_url: string | null;
  asset_url: string;
  status: "active" | "draft";
  created_at: number;
  updated_at: number;
}

interface Sale {
  purchase_id: number;
  amount_cents: number;
  status: string;
  created_at: number;
  listing_id: number;
  title: string;
  buyer_email: string;
}

const CATEGORY_OPTIONS = [
  "3D Models",
  "Textures",
  "Materials",
  "Asset Packs",
  "HDRIs",
  "Characters",
  "Environments",
  "Props",
];

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);

export default function SellerDashboardApp() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [listings, setListings] = useState<Listing[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [activeTab, setActiveTab] = useState<"listings" | "sales" | "profile">("listings");

  // Create / Edit modal state
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formTitle, setFormTitle] = useState("");
  const [formDesc, setFormDesc] = useState("");
  const [formCategory, setFormCategory] = useState("3D Models");
  const [formPriceINR, setFormPriceINR] = useState("499");
  const [formAssetUrl, setFormAssetUrl] = useState("");
  const [formThumbnailUrl, setFormThumbnailUrl] = useState("");
  const [formStatus, setFormStatus] = useState<"active" | "draft">("active");
  const [savingListing, setSavingListing] = useState(false);
  const [formError, setFormError] = useState("");

  async function checkAuthAndLoadData() {
    setLoading(true);
    try {
      const res = await fetch("/auth/me", { credentials: "include" });
      if (!res.ok) throw new Error("Auth check failed");
      const data = await res.json();

      if (!data.user) {
        window.location.href = "/auth/login?redirect=/seller/dashboard";
        return;
      }

      setUser(data.user);

      if (data.user.role === "seller" || data.user.role === "admin") {
        await loadSellerData();
      }
    } catch {
      window.location.href = "/auth/login?redirect=/seller/dashboard";
    } finally {
      setLoading(false);
    }
  }

  async function loadSellerData() {
    try {
      const [lRes, sRes] = await Promise.all([
        fetch("/marketplace-api/my-listings", { credentials: "include" }),
        fetch("/marketplace-api/my-sales", { credentials: "include" }),
      ]);

      if (lRes.ok) {
        const lData = await lRes.json();
        setListings(lData.listings ?? []);
      }
      if (sRes.ok) {
        const sData = await sRes.json();
        setSales(sData.sales ?? []);
      }
    } catch (err) {
      console.error("Error loading seller data:", err);
    }
  }

  useEffect(() => {
    checkAuthAndLoadData();
  }, []);

  function openCreateModal() {
    setEditingId(null);
    setFormTitle("");
    setFormDesc("");
    setFormCategory("3D Models");
    setFormPriceINR("499");
    setFormAssetUrl("");
    setFormThumbnailUrl("");
    setFormStatus("active");
    setFormError("");
    setShowFormModal(true);
  }

  function openEditModal(listing: Listing) {
    setEditingId(listing.id);
    setFormTitle(listing.title);
    setFormDesc(listing.description);
    setFormCategory(listing.category);
    setFormPriceINR((listing.price_cents / 100).toString());
    setFormAssetUrl(listing.asset_url);
    setFormThumbnailUrl(listing.thumbnail_url ?? "");
    setFormStatus(listing.status);
    setFormError("");
    setShowFormModal(true);
  }

  async function handleSaveListing(e: React.FormEvent) {
    e.preventDefault();
    setFormError("");
    setSavingListing(true);

    const priceCents = Math.round(parseFloat(formPriceINR) * 100);
    if (isNaN(priceCents) || priceCents < 0) {
      setFormError("Please enter a valid price in INR.");
      setSavingListing(false);
      return;
    }

    try {
      const payload = {
        title: formTitle.trim(),
        description: formDesc.trim(),
        category: formCategory.trim(),
        price_cents: priceCents,
        asset_url: formAssetUrl.trim(),
        thumbnail_url: formThumbnailUrl.trim() || null,
        status: formStatus,
      };

      let res: Response;
      if (editingId) {
        res = await fetch(`/marketplace-api/listings/${editingId}`, {
          method: "PATCH",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } else {
        res = await fetch("/marketplace-api/listings", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      }

      const data = await res.json();
      if (!res.ok) {
        setFormError(data.error || "Failed to save listing.");
        return;
      }

      setShowFormModal(false);
      await loadSellerData();
    } catch {
      setFormError("Connection error while saving listing.");
    } finally {
      setSavingListing(false);
    }
  }

  async function handleDeleteListing(id: number, title: string) {
    if (!confirm(`Are you sure you want to delete the listing "${title}"?`)) return;

    try {
      const res = await fetch(`/marketplace-api/listings/${id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        setListings((prev) => prev.filter((item) => item.id !== id));
      } else {
        alert("Unable to delete listing.");
      }
    } catch {
      alert("Connection error while deleting listing.");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-3 border-primary border-t-transparent"></div>
          <p className="text-sm text-muted-foreground">Loading Seller Studio...</p>
        </div>
      </div>
    );
  }

  if (!user) return null;

  // Normal user attempting to access seller dashboard
  if (user.role !== "seller" && user.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-3xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">
          Creator Privileges Required
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is currently registered as a standard User. To publish listings and access the Seller Studio, submit a creator application.
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-xs transition hover:opacity-95"
          >
            <span>Apply in User Dashboard</span>
            <ArrowRight size={14} />
          </a>
          <a
            href="/marketplace"
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground hover:bg-accent"
          >
            <span>Back to Marketplace</span>
          </a>
        </div>
      </div>
    );
  }

  const totalEarnings = sales.reduce((acc, s) => acc + s.amount_cents, 0);
  const activeListingsCount = listings.filter((l) => l.status === "active").length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Top Header */}
      <div className="mb-8 flex flex-col justify-between gap-4 rounded-3xl border border-border/80 bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:p-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <Store size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">
                  Seller Studio
                </h1>
                <span className="rounded-full bg-primary/15 px-3 py-0.5 text-xs font-bold uppercase tracking-wide text-primary">
                  {user.role === "admin" ? "Admin Mode" : "Verified Seller"}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Manage your 3D digital catalog, pricing, and recorded orders.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={openCreateModal}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-xs font-bold text-primary-foreground shadow-xs transition hover:opacity-95"
          >
            <PlusCircle size={16} />
            <span>Add 3D Asset</span>
          </button>
          <a
            href="/marketplace"
            className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground shadow-2xs transition hover:bg-accent"
          >
            <ExternalLink size={14} />
            <span>View Marketplace</span>
          </a>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Listings</span>
            <Package size={18} className="text-primary" />
          </div>
          <p className="mt-2 text-2xl font-black text-foreground">{listings.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">{activeListingsCount} active on marketplace</p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Sales</span>
            <TrendingUp size={18} className="text-primary" />
          </div>
          <p className="mt-2 text-2xl font-black text-foreground">{sales.length}</p>
          <p className="mt-1 text-xs text-muted-foreground">Simulated demo checkouts</p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Simulated Earnings</span>
            <DollarSign size={18} className="text-primary" />
          </div>
          <p className="mt-2 text-2xl font-black text-primary">{money(totalEarnings)}</p>
          <p className="mt-1 text-xs text-muted-foreground">From recorded asset checkouts</p>
        </div>

        <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
          <div className="flex items-center justify-between text-muted-foreground">
            <span className="text-xs font-semibold uppercase tracking-wider">Seller Status</span>
            <CheckCircle2 size={18} className="text-primary" />
          </div>
          <p className="mt-2 text-sm font-bold text-foreground">Verified Creator</p>
          <p className="mt-1 text-xs text-muted-foreground">Instant asset delivery</p>
        </div>
      </div>

      {/* Simulated Marketplace Notice Banner */}
      <div className="mb-8 flex items-start gap-3 rounded-2xl border border-primary/20 bg-primary/10 p-4 text-xs text-muted-foreground">
        <Info size={18} className="shrink-0 text-primary mt-0.5" />
        <div>
          <span className="font-bold text-foreground">Simulated Transactions Notice:</span> ModelVerse operates an interactive demo marketplace where buyers test instant asset checkouts without collecting real payment card data. All earnings and orders displayed reflect actual recorded database transactions.
        </div>
      </div>

      {/* Navigation Tabs */}
      <div className="mb-6 flex gap-2 border-b border-border/80 pb-2">
        <button
          onClick={() => setActiveTab("listings")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "listings"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <span>My 3D Listings</span>
          <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px]">
            {listings.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("sales")}
          className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "sales"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <span>Sales &amp; Orders</span>
          <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px]">
            {sales.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("profile")}
          className={`rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "profile"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          Store Profile
        </button>
      </div>

      {/* Tab 1: Listings */}
      {activeTab === "listings" && (
        <div>
          {listings.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center">
              <Box size={40} className="mx-auto text-muted-foreground/60" />
              <h3 className="mt-3 text-lg font-bold text-foreground">No asset listings yet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Publish your first 3D model, material or texture pack to start selling.
              </p>
              <button
                onClick={openCreateModal}
                className="mt-4 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-xs font-bold text-primary-foreground shadow-xs transition hover:opacity-95"
              >
                <PlusCircle size={15} />
                <span>Create First Listing</span>
              </button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {listings.map((item) => (
                <div
                  key={item.id}
                  className="flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-4 shadow-xs"
                >
                  <div>
                    <div className="relative aspect-video overflow-hidden rounded-xl bg-muted">
                      {item.thumbnail_url ? (
                        <img
                          src={item.thumbnail_url}
                          alt={item.title}
                          className="size-full object-cover"
                        />
                      ) : (
                        <div className="flex size-full items-center justify-center text-muted-foreground">
                          <Box size={28} className="text-primary/60" />
                        </div>
                      )}
                      <span
                        className={`absolute left-2.5 top-2.5 rounded-md px-2 py-0.5 text-[10px] font-bold backdrop-blur-sm ${
                          item.status === "active"
                            ? "bg-primary/90 text-primary-foreground"
                            : "bg-muted-foreground/90 text-background"
                        }`}
                      >
                        {item.status.toUpperCase()}
                      </span>
                      <span className="absolute right-2.5 top-2.5 rounded-md bg-background/90 px-2 py-0.5 text-[10px] font-semibold text-foreground backdrop-blur-sm">
                        {item.category}
                      </span>
                    </div>

                    <h4 className="mt-3 truncate text-sm font-bold text-foreground" title={item.title}>
                      {item.title}
                    </h4>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                      {item.description}
                    </p>
                  </div>

                  <div className="mt-4 border-t border-border/60 pt-3">
                    <div className="flex items-center justify-between">
                      <span className="text-base font-extrabold text-primary">
                        {money(item.price_cents)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={() => openEditModal(item)}
                          className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground transition"
                          title="Edit Listing"
                        >
                          <Edit2 size={14} />
                        </button>
                        <button
                          onClick={() => handleDeleteListing(item.id, item.title)}
                          className="rounded-lg border border-destructive/20 p-1.5 text-destructive hover:bg-destructive/10 transition"
                          title="Delete Listing"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Sales */}
      {activeTab === "sales" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-foreground">Recorded Customer Orders</h2>
            <span className="text-xs text-muted-foreground">
              Total sales: <span className="font-bold text-primary">{sales.length}</span>
            </span>
          </div>

          {sales.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center">
              <TrendingUp size={36} className="mx-auto text-muted-foreground/60" />
              <h3 className="mt-3 text-base font-bold text-foreground">No sales yet</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                When users buy your 3D assets in the marketplace, transactions will appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/40 font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3.5">Order ID</th>
                    <th className="p-3.5">Asset Title</th>
                    <th className="p-3.5">Buyer Email</th>
                    <th className="p-3.5">Amount</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {sales.map((s) => (
                    <tr key={s.purchase_id} className="hover:bg-accent/40 transition">
                      <td className="p-3.5 font-mono text-[11px] text-muted-foreground">
                        #{s.purchase_id}
                      </td>
                      <td className="p-3.5 font-semibold text-foreground">{s.title}</td>
                      <td className="p-3.5 text-muted-foreground">{s.buyer_email}</td>
                      <td className="p-3.5 font-bold text-primary">{money(s.amount_cents)}</td>
                      <td className="p-3.5">
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                          {s.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3.5 text-muted-foreground">
                        {new Date(s.created_at * 1000).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Store Profile */}
      {activeTab === "profile" && (
        <div className="mx-auto max-w-2xl rounded-2xl border border-border/80 bg-card p-6 shadow-xs sm:p-8">
          <h2 className="text-lg font-bold text-foreground">Creator Store Profile</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Your public marketplace author credentials.
          </p>

          <div className="mt-6 space-y-4 text-xs">
            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <span className="text-muted-foreground">Creator Contact Email</span>
              <span className="font-semibold text-foreground">{user.email}</span>
            </div>

            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <span className="text-muted-foreground">Account Status</span>
              <span className="inline-flex items-center gap-1 font-bold text-primary">
                <CheckCircle2 size={14} /> Active &amp; Verified
              </span>
            </div>

            <div className="flex items-center justify-between border-b border-border/60 pb-3">
              <span className="text-muted-foreground">Direct Download Fulfillment</span>
              <span className="text-foreground">Enabled via Verified URLs</span>
            </div>

            <div className="flex items-center justify-between pb-1">
              <span className="text-muted-foreground">License Terms</span>
              <span className="text-foreground">Standard Commercial &amp; Editorial</span>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Create / Edit Listing */}
      {showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-3xl border border-border bg-card p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between border-b border-border/60 pb-3">
              <h3 className="text-base font-bold text-foreground">
                {editingId ? "Edit 3D Asset Listing" : "Add New 3D Asset Listing"}
              </h3>
              <button
                onClick={() => setShowFormModal(false)}
                className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                ✕
              </button>
            </div>

            {formError && (
              <div className="mb-4 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                {formError}
              </div>
            )}

            <form onSubmit={handleSaveListing} className="space-y-3.5 text-xs">
              <div>
                <label className="block font-semibold text-foreground">Asset Title *</label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  placeholder="e.g. Stylized Cyberpunk Mech GLTF"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground">Description *</label>
                <textarea
                  required
                  rows={3}
                  maxLength={5000}
                  placeholder="Poly count, included textures, rigging, and format details..."
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-foreground">Category *</label>
                  <select
                    value={formCategory}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                  >
                    {CATEGORY_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-semibold text-foreground">Price (₹ INR) *</label>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    required
                    placeholder="499"
                    value={formPriceINR}
                    onChange={(e) => setFormPriceINR(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-foreground">
                  Asset Download / Storage URL *
                </label>
                <input
                  type="url"
                  required
                  placeholder="https://... (direct download, GLTF file, Google Drive, IPFS, etc.)"
                  value={formAssetUrl}
                  onChange={(e) => setFormAssetUrl(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground">
                  Thumbnail Image URL (Optional)
                </label>
                <input
                  type="url"
                  placeholder="https://... (preview JPG / PNG / WebP)"
                  value={formThumbnailUrl}
                  onChange={(e) => setFormThumbnailUrl(e.target.value)}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                />
              </div>

              <div>
                <label className="block font-semibold text-foreground">Listing Status</label>
                <select
                  value={formStatus}
                  onChange={(e) => setFormStatus(e.target.value as "active" | "draft")}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-foreground outline-none focus:border-primary"
                >
                  <option value="active">Active (Published on Marketplace)</option>
                  <option value="draft">Draft (Hidden)</option>
                </select>
              </div>

              <div className="mt-5 flex justify-end gap-2 border-t border-border/60 pt-3">
                <button
                  type="button"
                  onClick={() => setShowFormModal(false)}
                  className="rounded-xl border border-border px-4 py-2 font-semibold text-foreground hover:bg-accent"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingListing}
                  className="rounded-xl bg-primary px-5 py-2 font-bold text-primary-foreground hover:opacity-95 disabled:opacity-50"
                >
                  {savingListing ? "Saving..." : editingId ? "Save Changes" : "Publish Listing"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
