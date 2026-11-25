import { useEffect, useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  Users,
  Store,
  Package,
  ShoppingBag,
  Clock3,
  Search,
  RefreshCw,
  Trash2,
  DollarSign,
  ArrowRight,
  Download,
  FileArchive,
  ExternalLink,
  AlertCircle,
} from "lucide-react";

interface AdminUser {
  id: number;
  email: string;
  role: "user" | "seller" | "admin";
  created_at?: number;
}

interface PlatformStats {
  total_users: number;
  total_sellers: number;
  total_admins: number;
  pending_applications: number;
  total_listings: number;
  published_listings: number;
  total_purchases: number;
  total_volume_cents: number;
}

interface SellerApplication {
  id: number;
  user_id: number;
  email: string;
  business_name: string;
  description: string;
  status: "pending" | "approved" | "rejected";
  created_at: number;
  reviewed_at?: number | null;
}

interface AdminListing {
  id: number;
  seller_id: number;
  seller_email: string;
  title: string;
  description: string;
  category: string;
  price_cents: number;
  thumbnail_url: string | null;
  asset_url: string;
  status: "active" | "draft";
  created_at: number;
}

interface AdminPurchase {
  id: number;
  amount_cents: number;
  status: string;
  created_at: number;
  listing_id: number;
  listing_title: string;
  buyer_email: string;
  seller_email: string;
}

interface AdminDownload {
  id: number;
  asset_id: string;
  asset_title: string;
  provider: string | null;
  asset_type: string | null;
  format: string | null;
  resolution: string | null;
  download_type: "redirect" | "zip";
  created_at: number;
  user_email: string;
}

const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paise / 100);

export default function AdminDashboardApp() {
  const [currentUser, setCurrentUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [activeTab, setActiveTab] = useState<"applications" | "users" | "listings" | "purchases" | "downloads">("applications");

  // Data sets
  const [applications, setApplications] = useState<SellerApplication[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [listings, setListings] = useState<AdminListing[]>([]);
  const [purchases, setPurchases] = useState<AdminPurchase[]>([]);
  const [adminDownloads, setAdminDownloads] = useState<AdminDownload[]>([]);
  const [downloadsTotal, setDownloadsTotal] = useState(0);
  const [downloadsLoading, setDownloadsLoading] = useState(false);
  const [downloadsError, setDownloadsError] = useState<string | null>(null);
  const [downloadSearch, setDownloadSearch] = useState("");
  const [downloadProvider, setDownloadProvider] = useState("");

  // Search & Filter
  const [userSearch, setUserSearch] = useState("");
  const [appFilter, setAppFilter] = useState<"all" | "pending" | "approved" | "rejected">("pending");
  const [actionMessage, setActionMessage] = useState<{ text: string; error?: boolean } | null>(null);

  async function checkAuthAndLoadData() {
    setLoading(true);
    try {
      const res = await fetch("/auth/me", { credentials: "include" });
      if (!res.ok) throw new Error("Auth failed");
      const data = await res.json();

      if (!data.user) {
        window.location.href = "/auth/login?redirect=/admin";
        return;
      }

      setCurrentUser(data.user);

      if (data.user.role === "admin") {
        await refreshAllData();
      }
    } catch {
      window.location.href = "/auth/login?redirect=/admin";
    } finally {
      setLoading(false);
    }
  }

  async function refreshAllData() {
    try {
      const [statsRes, appsRes, usersRes, listingsRes, purchasesRes] = await Promise.all([
        fetch("/auth/admin/stats", { credentials: "include" }),
        fetch("/auth/admin/seller-applications", { credentials: "include" }),
        fetch("/auth/admin/users", { credentials: "include" }),
        fetch("/marketplace-api/admin/listings", { credentials: "include" }),
        fetch("/marketplace-api/admin/purchases", { credentials: "include" }),
      ]);

      if (statsRes.ok) {
        const s = await statsRes.json();
        setStats(s.stats);
      }
      if (appsRes.ok) {
        const a = await appsRes.json();
        setApplications(a.applications ?? []);
      }
      if (usersRes.ok) {
        const u = await usersRes.json();
        setUsers(u.users ?? []);
      }
      if (listingsRes.ok) {
        const l = await listingsRes.json();
        setListings(l.listings ?? []);
      }
      if (purchasesRes.ok) {
        const p = await purchasesRes.json();
        setPurchases(p.purchases ?? []);
      }
    } catch (err) {
      console.error("Error refreshing admin data:", err);
    }
  }

  async function loadAdminDownloads(q = downloadSearch, provider = downloadProvider) {
    setDownloadsLoading(true);
    setDownloadsError(null);
    try {
      const params = new URLSearchParams({ limit: "100" });
      if (q) params.set("q", q);
      if (provider) params.set("provider", provider);
      const res = await fetch(`/auth/admin/downloads?${params.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to load download activity.");
      const data = await res.json();
      setAdminDownloads(data.downloads ?? []);
      setDownloadsTotal(data.total ?? 0);
    } catch (err) {
      setDownloadsError(err instanceof Error ? err.message : "Failed to load download activity.");
    } finally {
      setDownloadsLoading(false);
    }
  }

  useEffect(() => {
    checkAuthAndLoadData();
  }, []);

  // Load downloads lazily when that tab is first opened
  useEffect(() => {
    if (activeTab === "downloads" && adminDownloads.length === 0 && !downloadsLoading && !downloadsError) {
      void loadAdminDownloads();
    }
  }, [activeTab]);

  // Review Application
  async function handleReviewApplication(appId: number, status: "approved" | "rejected") {
    setActionMessage(null);
    try {
      const res = await fetch(`/auth/admin/seller-applications/${appId}/review`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });

      const data = await res.json();
      if (!res.ok) {
        setActionMessage({ text: data.error || "Review action failed", error: true });
        return;
      }

      setActionMessage({ text: `Application ${status} successfully.`, error: false });
      await refreshAllData();
    } catch {
      setActionMessage({ text: "Error submitting review action.", error: true });
    }
  }

  // Change User Role
  async function handleChangeRole(userId: number, newRole: "user" | "seller" | "admin") {
    setActionMessage(null);
    try {
      const res = await fetch(`/auth/admin/users/${userId}/role`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });

      const data = await res.json();
      if (!res.ok) {
        setActionMessage({ text: data.error || "Role update failed", error: true });
        return;
      }

      setActionMessage({ text: `User role updated to ${newRole}.`, error: false });
      setUsers((prev) =>
        prev.map((u) => (u.id === userId ? { ...u, role: newRole } : u))
      );
      await refreshAllData();
    } catch {
      setActionMessage({ text: "Error changing user role.", error: true });
    }
  }

  // Toggle Listing Status
  async function handleToggleListingStatus(listingId: number, currentStatus: "active" | "draft") {
    const nextStatus = currentStatus === "active" ? "draft" : "active";
    try {
      const res = await fetch(`/marketplace-api/admin/listings/${listingId}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
      });

      if (res.ok) {
        setListings((prev) =>
          prev.map((l) => (l.id === listingId ? { ...l, status: nextStatus } : l))
        );
      }
    } catch {
      alert("Error updating listing status.");
    }
  }

  // Delete Listing
  async function handleDeleteListing(listingId: number, title: string) {
    if (!confirm(`Delete listing "${title}" from the platform?`)) return;

    try {
      const res = await fetch(`/marketplace-api/admin/listings/${listingId}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (res.ok) {
        setListings((prev) => prev.filter((l) => l.id !== listingId));
      }
    } catch {
      alert("Error deleting listing.");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="size-8 animate-spin rounded-full border-3 border-primary border-t-transparent"></div>
          <p className="text-sm text-muted-foreground">Loading Admin Control Center...</p>
        </div>
      </div>
    );
  }

  if (!currentUser) return null;

  if (currentUser.role !== "admin") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-20 text-center">
        <div className="mx-auto mb-4 flex size-16 items-center justify-center rounded-3xl border border-destructive/30 bg-destructive/10 text-destructive">
          <ShieldAlert size={32} />
        </div>
        <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">
          403 — Unauthorized
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Administrator privileges are required to access this area. Your account role is "{currentUser.role}".
        </p>
        <div className="mt-6 flex justify-center gap-3">
          <a
            href="/dashboard"
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground shadow-xs transition hover:opacity-95"
          >
            <span>Return to Your Dashboard</span>
            <ArrowRight size={14} />
          </a>
        </div>
      </div>
    );
  }

  const filteredApps = applications.filter((a) => {
    if (appFilter === "all") return true;
    return a.status === appFilter;
  });

  const filteredUsers = users.filter((u) =>
    userSearch ? u.email.toLowerCase().includes(userSearch.toLowerCase()) : true
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      {/* Top Admin Header */}
      <div className="mb-8 flex flex-col justify-between gap-4 rounded-3xl border border-border/80 bg-card p-6 shadow-sm sm:flex-row sm:items-center sm:p-8">
        <div>
          <div className="flex items-center gap-3">
            <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ShieldCheck size={26} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-black tracking-tight text-foreground sm:text-3xl">
                  Admin Control Center
                </h1>
                <span className="rounded-full bg-primary/15 px-3 py-0.5 text-xs font-bold uppercase tracking-wide text-primary">
                  Master Authority
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Live moderation, seller approval gateway, user permissions, and marketplace governance.
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2.5">
          <button
            onClick={() => refreshAllData()}
            className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground shadow-2xs transition hover:bg-accent"
          >
            <RefreshCw size={14} />
            <span>Refresh Data</span>
          </button>
        </div>
      </div>

      {/* Action Notification */}
      {actionMessage && (
        <div
          className={`mb-6 rounded-2xl border p-4 text-xs font-semibold ${
            actionMessage.error
              ? "border-destructive/30 bg-destructive/10 text-destructive"
              : "border-primary/30 bg-primary/10 text-primary"
          }`}
        >
          {actionMessage.text}
        </div>
      )}

      {/* Platform Statistics */}
      {stats && (
        <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-semibold uppercase tracking-wider">Registered Users</span>
              <Users size={18} className="text-primary" />
            </div>
            <p className="mt-2 text-2xl font-black text-foreground">{stats.total_users}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.total_sellers} sellers · {stats.total_admins} admins
            </p>
          </div>

          <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-semibold uppercase tracking-wider">Pending Sellers</span>
              <Clock3 size={18} className="text-amber-500" />
            </div>
            <p className="mt-2 text-2xl font-black text-amber-600 dark:text-amber-400">
              {stats.pending_applications}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">Awaiting your approval</p>
          </div>

          <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-semibold uppercase tracking-wider">Marketplace Listings</span>
              <Package size={18} className="text-primary" />
            </div>
            <p className="mt-2 text-2xl font-black text-foreground">{stats.total_listings}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {stats.published_listings} active published
            </p>
          </div>

          <div className="rounded-2xl border border-border/80 bg-card p-5 shadow-xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-semibold uppercase tracking-wider">Simulated Volume</span>
              <DollarSign size={18} className="text-primary" />
            </div>
            <p className="mt-2 text-2xl font-black text-primary">
              {money(stats.total_volume_cents)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{stats.total_purchases} total orders</p>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-2 border-b border-border/80 pb-2 overflow-x-auto">
        <button
          onClick={() => setActiveTab("applications")}
          className={`flex items-center gap-2 shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "applications"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Store size={15} />
          <span>Seller Applications</span>
          {stats && stats.pending_applications > 0 && (
            <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] text-white">
              {stats.pending_applications}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab("users")}
          className={`flex items-center gap-2 shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "users"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Users size={15} />
          <span>User Management</span>
          <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px]">
            {users.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("listings")}
          className={`flex items-center gap-2 shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "listings"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Package size={15} />
          <span>Listing Moderation</span>
          <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px]">
            {listings.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("purchases")}
          className={`flex items-center gap-2 shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "purchases"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <ShoppingBag size={15} />
          <span>Platform Purchases</span>
          <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px]">
            {purchases.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab("downloads")}
          className={`flex items-center gap-2 shrink-0 rounded-xl px-4 py-2.5 text-xs font-bold transition ${
            activeTab === "downloads"
              ? "bg-primary text-primary-foreground shadow-xs"
              : "text-muted-foreground hover:bg-accent hover:text-foreground"
          }`}
        >
          <Download size={15} />
          <span>Download Activity</span>
          {downloadsTotal > 0 && (
            <span className="rounded-full bg-primary-foreground/20 px-2 py-0.5 text-[10px]">
              {downloadsTotal}
            </span>
          )}
        </button>
      </div>

      {/* Tab 1: Seller Applications */}
      {activeTab === "applications" && (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <h2 className="text-base font-bold text-foreground">Creator Onboarding Requests</h2>

            {/* Filter buttons */}
            <div className="flex gap-1.5">
              {(["pending", "approved", "rejected", "all"] as const).map((filter) => (
                <button
                  key={filter}
                  onClick={() => setAppFilter(filter)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-bold capitalize transition ${
                    appFilter === filter
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-muted-foreground hover:bg-accent"
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>

          {filteredApps.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center">
              <Store size={36} className="mx-auto text-muted-foreground/60" />
              <h3 className="mt-3 text-base font-bold text-foreground">
                No {appFilter !== "all" ? appFilter : ""} applications found
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Seller requests submitted by users will appear here for review.
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {filteredApps.map((app) => (
                <div
                  key={app.id}
                  className="flex flex-col justify-between rounded-2xl border border-border/80 bg-card p-5 shadow-xs"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-foreground">{app.business_name}</h4>
                        <p className="text-xs text-muted-foreground">{app.email}</p>
                      </div>

                      <span
                        className={`rounded-md px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${
                          app.status === "approved"
                            ? "bg-primary/10 text-primary"
                            : app.status === "rejected"
                            ? "bg-destructive/10 text-destructive"
                            : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                        }`}
                      >
                        {app.status}
                      </span>
                    </div>

                    <div className="mt-3 rounded-xl border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-foreground">
                      <span className="font-semibold text-muted-foreground">Asset Proposal:</span>
                      <p className="mt-1">{app.description}</p>
                    </div>

                    <p className="mt-3 text-[11px] text-muted-foreground">
                      Submitted on: {new Date(app.created_at * 1000).toLocaleString()}
                    </p>
                  </div>

                  {app.status === "pending" && (
                    <div className="mt-4 flex gap-2 border-t border-border/60 pt-3">
                      <button
                        onClick={() => handleReviewApplication(app.id, "approved")}
                        className="flex-1 rounded-xl bg-primary px-3 py-2 text-xs font-bold text-primary-foreground hover:opacity-95 transition"
                      >
                        Approve Seller
                      </button>
                      <button
                        onClick={() => handleReviewApplication(app.id, "rejected")}
                        className="rounded-xl border border-destructive/30 px-3 py-2 text-xs font-semibold text-destructive hover:bg-destructive/10 transition"
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: User Management */}
      {activeTab === "users" && (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <h2 className="text-base font-bold text-foreground">Registered User Directory</h2>

            <div className="relative max-w-xs">
              <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by email..."
                value={userSearch}
                onChange={(e) => setUserSearch(e.target.value)}
                className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border bg-muted/40 font-bold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="p-3.5">User ID</th>
                  <th className="p-3.5">Email</th>
                  <th className="p-3.5">Role</th>
                  <th className="p-3.5">Registered</th>
                  <th className="p-3.5 text-right">Role Governance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {filteredUsers.map((u) => {
                  const isCurrentAdmin = u.id === currentUser.id;
                  return (
                    <tr key={u.id} className="hover:bg-accent/40 transition">
                      <td className="p-3.5 font-mono text-[11px] text-muted-foreground">#{u.id}</td>
                      <td className="p-3.5 font-semibold text-foreground">
                        {u.email}
                        {isCurrentAdmin && (
                          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                            You
                          </span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                            u.role === "admin"
                              ? "bg-primary/20 text-primary"
                              : u.role === "seller"
                              ? "bg-emerald-500/20 text-emerald-600 dark:text-emerald-400"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {u.role}
                        </span>
                      </td>
                      <td className="p-3.5 text-muted-foreground">
                        {u.created_at ? new Date(u.created_at * 1000).toLocaleDateString() : "—"}
                      </td>
                      <td className="p-3.5 text-right">
                        {isCurrentAdmin ? (
                          <span className="text-[11px] italic text-muted-foreground">
                            (Protected Session)
                          </span>
                        ) : (
                          <select
                            value={u.role}
                            onChange={(e) =>
                              handleChangeRole(u.id, e.target.value as "user" | "seller" | "admin")
                            }
                            className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs text-foreground outline-none focus:border-primary"
                          >
                            <option value="user">User</option>
                            <option value="seller">Seller</option>
                            <option value="admin">Admin</option>
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Tab 3: Marketplace Moderation */}
      {activeTab === "listings" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">All Creator 3D Listings</h2>
            <span className="text-xs text-muted-foreground">Total: {listings.length}</span>
          </div>

          {listings.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center">
              <Package size={36} className="mx-auto text-muted-foreground/60" />
              <h3 className="mt-3 text-base font-bold text-foreground">No listings to moderate</h3>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/40 font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3.5">ID</th>
                    <th className="p-3.5">Asset Title</th>
                    <th className="p-3.5">Seller</th>
                    <th className="p-3.5">Category</th>
                    <th className="p-3.5">Price</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {listings.map((item) => (
                    <tr key={item.id} className="hover:bg-accent/40 transition">
                      <td className="p-3.5 font-mono text-[11px] text-muted-foreground">#{item.id}</td>
                      <td className="p-3.5 font-semibold text-foreground">{item.title}</td>
                      <td className="p-3.5 text-muted-foreground">{item.seller_email}</td>
                      <td className="p-3.5 text-muted-foreground">{item.category}</td>
                      <td className="p-3.5 font-bold text-primary">{money(item.price_cents)}</td>
                      <td className="p-3.5">
                        <span
                          className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                            item.status === "active"
                              ? "bg-primary/10 text-primary"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {item.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3.5 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => handleToggleListingStatus(item.id, item.status)}
                            className="rounded-lg border border-border px-2.5 py-1 text-xs font-semibold hover:bg-accent transition"
                            title={item.status === "active" ? "Unpublish" : "Publish"}
                          >
                            {item.status === "active" ? "Unpublish" : "Publish"}
                          </button>
                          <button
                            onClick={() => handleDeleteListing(item.id, item.title)}
                            className="rounded-lg border border-destructive/20 p-1 text-destructive hover:bg-destructive/10 transition"
                            title="Delete Listing"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab 4: Platform Purchases */}
      {activeTab === "purchases" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-foreground">Platform Transaction Ledger</h2>
            <span className="text-xs text-muted-foreground">Total: {purchases.length} orders</span>
          </div>

          {purchases.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center">
              <ShoppingBag size={36} className="mx-auto text-muted-foreground/60" />
              <h3 className="mt-3 text-base font-bold text-foreground">No purchases recorded yet</h3>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/40 font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3.5">Order ID</th>
                    <th className="p-3.5">Asset Title</th>
                    <th className="p-3.5">Buyer</th>
                    <th className="p-3.5">Seller</th>
                    <th className="p-3.5">Amount</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {purchases.map((p) => (
                    <tr key={p.id} className="hover:bg-accent/40 transition">
                      <td className="p-3.5 font-mono text-[11px] text-muted-foreground">#{p.id}</td>
                      <td className="p-3.5 font-semibold text-foreground">{p.listing_title}</td>
                      <td className="p-3.5 text-muted-foreground">{p.buyer_email}</td>
                      <td className="p-3.5 text-muted-foreground">{p.seller_email}</td>
                      <td className="p-3.5 font-bold text-primary">{money(p.amount_cents)}</td>
                      <td className="p-3.5">
                        <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[10px] font-bold text-primary">
                          {p.status.toUpperCase()}
                        </span>
                      </td>
                      <td className="p-3.5 text-muted-foreground">
                        {new Date(p.created_at * 1000).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {/* Tab 5: Download Activity */}
      {activeTab === "downloads" && (
        <div className="space-y-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <h2 className="text-base font-bold text-foreground">Platform Download Activity</h2>
              <p className="text-xs text-muted-foreground">
                All asset downloads initiated through ModelVerse.{downloadsTotal > 0 && ` ${downloadsTotal} total records.`}
              </p>
            </div>
            <button
              onClick={() => loadAdminDownloads()}
              disabled={downloadsLoading}
              className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-foreground shadow-2xs transition hover:bg-accent disabled:opacity-50"
            >
              <RefreshCw size={14} className={downloadsLoading ? "animate-spin" : ""} />
              <span>Refresh</span>
            </button>
          </div>

          {/* Search & Filter */}
          <div className="flex flex-wrap gap-2">
            <div className="relative flex-1 min-w-[200px]">
              <Search size={14} className="absolute left-3 top-3 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by user email or asset name..."
                value={downloadSearch}
                onChange={(e) => setDownloadSearch(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void loadAdminDownloads(downloadSearch, downloadProvider); }}
                className="w-full rounded-xl border border-border bg-background py-2 pl-9 pr-3 text-xs text-foreground outline-none focus:border-primary"
              />
            </div>
            <input
              type="text"
              placeholder="Filter by provider..."
              value={downloadProvider}
              onChange={(e) => setDownloadProvider(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void loadAdminDownloads(downloadSearch, downloadProvider); }}
              className="rounded-xl border border-border bg-background py-2 px-3 text-xs text-foreground outline-none focus:border-primary w-40"
            />
            <button
              onClick={() => void loadAdminDownloads(downloadSearch, downloadProvider)}
              className="rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:opacity-95 transition"
            >
              Search
            </button>
          </div>

          {/* Loading */}
          {downloadsLoading && (
            <div className="flex items-center justify-center rounded-2xl border border-border bg-card p-12">
              <div className="flex flex-col items-center gap-3">
                <div className="size-8 animate-spin rounded-full border-3 border-primary border-t-transparent"></div>
                <p className="text-sm text-muted-foreground">Loading download activity…</p>
              </div>
            </div>
          )}

          {/* Error */}
          {downloadsError && !downloadsLoading && (
            <div className="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-center">
              <AlertCircle size={32} className="mx-auto text-destructive" />
              <h3 className="mt-2 text-sm font-bold text-foreground">Failed to load download activity</h3>
              <p className="mt-1 text-xs text-muted-foreground">{downloadsError}</p>
            </div>
          )}

          {/* Empty */}
          {!downloadsLoading && !downloadsError && adminDownloads.length === 0 && (
            <div className="rounded-3xl border border-dashed border-border bg-card p-12 text-center">
              <Download size={36} className="mx-auto text-muted-foreground/60" />
              <h3 className="mt-3 text-base font-bold text-foreground">No download records found</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                Downloads initiated by users on ModelVerse will appear here.
              </p>
            </div>
          )}

          {/* Table */}
          {!downloadsLoading && !downloadsError && adminDownloads.length > 0 && (
            <div className="overflow-hidden rounded-2xl border border-border/80 bg-card">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-border bg-muted/40 font-bold uppercase tracking-wider text-muted-foreground">
                  <tr>
                    <th className="p-3.5">ID</th>
                    <th className="p-3.5">User Email</th>
                    <th className="p-3.5">Asset</th>
                    <th className="p-3.5">Provider</th>
                    <th className="p-3.5">Type</th>
                    <th className="p-3.5">Format</th>
                    <th className="p-3.5">Resolution</th>
                    <th className="p-3.5">Kind</th>
                    <th className="p-3.5">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {adminDownloads.map((d) => (
                    <tr key={d.id} className="hover:bg-accent/40 transition">
                      <td className="p-3.5 font-mono text-[11px] text-muted-foreground">#{d.id}</td>
                      <td className="p-3.5 text-muted-foreground">{d.user_email}</td>
                      <td className="p-3.5">
                        <span className="font-semibold text-foreground line-clamp-1">{d.asset_title}</span>
                        <span className="block font-mono text-[10px] text-muted-foreground">{d.asset_id}</span>
                      </td>
                      <td className="p-3.5 text-muted-foreground capitalize">{d.provider ?? "—"}</td>
                      <td className="p-3.5 text-muted-foreground capitalize">{d.asset_type ?? "—"}</td>
                      <td className="p-3.5 text-muted-foreground font-mono">{d.format ?? "auto"}</td>
                      <td className="p-3.5 text-muted-foreground font-mono">{d.resolution ?? "auto"}</td>
                      <td className="p-3.5">
                        <span className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                          d.download_type === "zip"
                            ? "bg-primary/10 text-primary"
                            : "bg-muted text-muted-foreground"
                        }`}>
                          {d.download_type === "zip" ? <FileArchive size={10} /> : <ExternalLink size={10} />}
                          {d.download_type === "zip" ? "ZIP" : "Redirect"}
                        </span>
                      </td>
                      <td className="p-3.5 text-muted-foreground">
                        {new Date(d.created_at * 1000).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

    </div>
  );
}