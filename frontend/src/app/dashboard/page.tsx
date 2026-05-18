"use client";

import { useMemo, useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSidebar } from "@/context/SidebarContext";
import { DollarSign, Users, FileText, Landmark, Waypoints, Hash, BarChart3, ChevronDown, Check, Globe, TrendingUp, Building2, Radio, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { DynamicChart } from "@/components/DynamicChart";
import { DateFilter, DateRange, CustomDateRange, filterByDateRange, dateRangeToBounds } from "@/components/DateFilter";
import { useDashboard } from "@/lib/queries";
import { toast } from "sonner";

function fmt(n: number): string {
  return n.toLocaleString("en-PH", { maximumFractionDigits: 0 });
}
function fmtAmt(n: number): string {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Classify touchpoint into channel type
function channelType(tp: string): string {
  const u = tp.toUpperCase().trim();
  if (u.startsWith("IB ") || u === "IB CALL" || u === "IB EMAIL" || u === "IB SMS" || u === "IB VIBER" || u === "IB FIELD" || u === "IB WALKIN" || u === "IB WHATSAPP" || u === "IB VISIT" || u === "IB DEBIT" || u === "IB REPO AI" || u === "IB SKIPTRACE") return "Inbound";
  if (u.startsWith("OB ") || u === "OB CALL" || u === "OB EMAIL" || u === "OB SMS" || u === "OB VIBER" || u === "OB FIELD" || u === "OB WALKIN" || u === "OB DEBIT" || u === "OB REPO AI" || u === "OB SKIPTRACE" || u === "OB PAIDLIST") return "Outbound";
  if (u === "GHOST PAYMENT") return "Ghost Payment";
  if (u === "NO TOUCHPOINT") return "No Touchpoint";
  // Bare touchpoints (no IB/OB prefix) — CALL, EMAIL, SMS, VIBER, FIELD, WALKIN,
  // DEBIT, DIGITAL, VISIT, WHATSAPP, SKIPTRACE, VIBER, REPO AI, FINNONE, WALKIN, etc.
  return "With Touchpoint";
}

// ── Module-level constants (shared by sub-components) ────────────────────────
const _paginationBtnClass = "px-2.5 py-1.5 text-sm font-medium rounded-md border bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-800 dark:text-gray-100 hover:bg-[#5B66E2]/5 hover:border-[#5B66E2] hover:text-[#5B66E2] dark:hover:bg-[#5B66E2]/20 dark:hover:border-[#5B66E2] dark:hover:text-[#8B96F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

// ── Sub-components defined at module level so React doesn't recreate their
//    identity on every DashboardPage render (avoids unnecessary unmount/remount).
function MetricCard({ label, value, icon: Icon, iconBg, info }: { label: string; value: string; icon: React.ElementType; iconBg: string; info?: string }) {
  return (
    <Card className="p-5 bg-card border-border hover:shadow-lg hover:scale-[1.01] transition-all duration-300 cursor-default">
      <div className="flex items-start justify-between mb-2">
        <div>
          <span className="text-sm font-semibold text-gray-900 dark:text-white block">{label}</span>
          {info && <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{info}</p>}
        </div>
        <div className={`p-2 ${iconBg} rounded-lg flex-shrink-0`}><Icon className="w-4 h-4 text-white" /></div>
      </div>
      <div className="text-2xl font-bold text-gray-900 dark:text-white truncate">{value}</div>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card className="p-5 bg-card border-border">
      <div className="flex items-center justify-between mb-3"><Skeleton className="h-3 w-28" /><Skeleton className="h-8 w-8 rounded-lg" /></div>
      <Skeleton className="h-7 w-32 mt-1" />
    </Card>
  );
}

function ChartSkeleton({ type, height }: { type: "line" | "bar" | "barh" | "donut" | "pie"; height: number }) {
  if (type === "line") {
    const h = height;
    return (
      <div className="animate-pulse w-full overflow-hidden rounded-xl" style={{ height }}>
        <svg width="100%" height="100%" viewBox={`0 0 400 ${h}`} preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
          {[0.2, 0.45, 0.7].map((r) => (
            <line key={r} x1="36" y1={h * r} x2="396" y2={h * r} stroke="currentColor" strokeWidth="1" className="text-gray-200 dark:text-gray-700" strokeDasharray="4 4" />
          ))}
          <polygon points={`36,${h * 0.88} 36,${h * 0.6} 100,${h * 0.42} 155,${h * 0.52} 210,${h * 0.28} 270,${h * 0.38} 330,${h * 0.18} 396,${h * 0.33} 396,${h * 0.88}`} fill="currentColor" className="text-gray-100 dark:text-gray-800" />
          <polyline points={`36,${h * 0.6} 100,${h * 0.42} 155,${h * 0.52} 210,${h * 0.28} 270,${h * 0.38} 330,${h * 0.18} 396,${h * 0.33}`} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-300 dark:text-gray-600" />
        </svg>
      </div>
    );
  }
  if (type === "bar") {
    const barHeights = [0.55, 0.8, 0.45, 0.7, 0.6, 0.9, 0.5];
    const n = barHeights.length, bw = 34;
    const spacing = (360 - n * bw) / (n + 1);
    const h = height;
    return (
      <div className="animate-pulse w-full overflow-hidden rounded-xl" style={{ height }}>
        <svg width="100%" height="100%" viewBox={`0 0 400 ${h}`} preserveAspectRatio="none">
          {barHeights.map((r, i) => { const bh = h * 0.82 * r; const x = 40 + spacing * (i + 1) + bw * i; return <rect key={i} x={x} y={h * 0.88 - bh} width={bw} height={bh} rx="4" fill="currentColor" className="text-gray-200 dark:text-gray-700" />; })}
          <rect x="38" y={h * 0.88} width="360" height="2" rx="1" fill="currentColor" className="text-gray-200 dark:text-gray-700" />
        </svg>
      </div>
    );
  }
  if (type === "barh") {
    const widths = [0.82, 0.65, 0.9, 0.5, 0.72, 0.58, 0.78];
    const h = height;
    const rowH = Math.min(20, (h * 0.8) / widths.length - 4);
    const gap = (h * 0.9) / widths.length;
    return (
      <div className="animate-pulse w-full overflow-hidden rounded-xl" style={{ height }}>
        <svg width="100%" height="100%" viewBox={`0 0 400 ${h}`} preserveAspectRatio="none">
          {widths.map((r, i) => { const y = h * 0.05 + gap * i + (gap - rowH) / 2; return <rect key={i} x="68" y={y} width={310 * r} height={rowH} rx="4" fill="currentColor" className="text-gray-200 dark:text-gray-700" />; })}
        </svg>
      </div>
    );
  }
  const size = Math.min(height * 0.85, 180);
  const outerR = size / 2 - 2;
  const strokeW = type === "donut" ? outerR * 0.38 : 0;
  const circleR = type === "donut" ? outerR - strokeW / 2 : outerR;
  return (
    <div className="animate-pulse w-full flex items-center justify-center" style={{ height }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {type === "pie" ? (
          <circle cx={size / 2} cy={size / 2} r={outerR} fill="currentColor" className="text-gray-200 dark:text-gray-700" />
        ) : (
          <circle cx={size / 2} cy={size / 2} r={circleR} fill="none" stroke="currentColor" strokeWidth={strokeW} className="text-gray-200 dark:text-gray-700" />
        )}
      </svg>
    </div>
  );
}

function Pagination({ page, setPage, total, rowsPerPage }: { page: number; setPage: (p: number) => void; total: number; rowsPerPage: number }) {
  const totalPages = Math.max(1, Math.ceil(total / rowsPerPage));
  if (totalPages <= 1) return null;
  const pages: number[] = [];
  let start = Math.max(1, page - 2); const end = Math.min(totalPages, start + 4); start = Math.max(1, end - 4);
  for (let i = start; i <= end; i++) pages.push(i);
  const fmtN = (n: number) => n.toLocaleString("en-PH", { maximumFractionDigits: 0 });
  return (
    <div className="px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-700">
      <p className="text-sm text-gray-500 dark:text-gray-400">Showing {fmtN((page - 1) * rowsPerPage + 1)}–{fmtN(Math.min(page * rowsPerPage, total))} of {fmtN(total)}</p>
      <div className="flex items-center gap-1">
        <button onClick={() => setPage(1)} disabled={page === 1} className={_paginationBtnClass}>First</button>
        <button onClick={() => setPage(Math.max(1, page - 1))} disabled={page === 1} className={_paginationBtnClass}>Prev</button>
        {pages.map((pg) => <button key={pg} onClick={() => setPage(pg)} className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${pg === page ? "bg-[#4a55d1] text-white border-[#4a55d1] shadow-sm" : _paginationBtnClass}`}>{pg}</button>)}
        <button onClick={() => setPage(Math.min(totalPages, page + 1))} disabled={page === totalPages} className={_paginationBtnClass}>Next</button>
        <button onClick={() => setPage(totalPages)} disabled={page === totalPages} className={_paginationBtnClass}>Last</button>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { data, sessionId, setSessionId, sessionValidated } = useData();
  const { token, user } = useAuth();
  const router = useRouter();
  const { setIsCollapsed } = useSidebar();
  const [activeTab, setActiveTab] = useState<"summary" | "portfolio" | "channels">("summary");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [customRange, setCustomRange] = useState<CustomDateRange | undefined>(undefined);
  const dateBounds = useMemo(() => dateRangeToBounds(dateRange, customRange), [dateRange, customRange]);
  const { data: apiSummary, isLoading: apiLoading, isFetching: apiFetching, error: apiError } = useDashboard(token, sessionId, sessionValidated, dateBounds.date_from, dateBounds.date_to);
  // isFetching is true during background refreshes; isLoading is true only when
  // there is no cached data yet. Use showSkeleton to prevent skeleton flash on
  // re-navigation when data is already in the TanStack Query cache.
  const showSkeleton = apiLoading && !apiSummary;
  const [dateFilterLoading, setDateFilterLoading] = useState(false);
  useEffect(() => { if (!apiFetching) setDateFilterLoading(false); }, [apiFetching]);

  const handleUploadNav = () => {
    setIsCollapsed(true);
    router.push("/upload");
  };

  // Auto-clear stale session only on 404 (session genuinely deleted). Ignore 500s — they are transient server errors.
  // Guard: only clear if sessionId is still set to avoid redundant clears from multiple pages.
  useEffect(() => {
    if (sessionId && apiError && (apiError.message.includes("404") || apiError.message.includes("Not Found"))) {
      setSessionId(null);
      toast("Session expired", {
        description: "Your uploaded data was cleared after 1 hour of inactivity. Please upload a new file.",
        duration: 8000,
      });
    }
  }, [apiError, sessionId, setSessionId]);

  // Portfolio tab filters
  const [selectedEnvironments, setSelectedEnvironments] = useState<Set<string>>(new Set());
  const [envDropdownOpen, setEnvDropdownOpen] = useState(false);
  const envDropdownRef = useRef<HTMLDivElement>(null);
  const [selectedBanks, setSelectedBanks] = useState<Set<string>>(new Set());
  const [bankDropdownOpen, setBankDropdownOpen] = useState(false);
  const bankDropdownRef = useRef<HTMLDivElement>(null);
  const [portfolioBankTopN, setPortfolioBankTopN] = useState<number | "all">(20);
  const [portfolioBankPage, setPortfolioBankPage] = useState(1);

  // Channels tab filters
  const [selectedTouchpoints, setSelectedTouchpoints] = useState<Set<string>>(new Set());
  const [tpDropdownOpen, setTpDropdownOpen] = useState(false);
  const tpDropdownRef = useRef<HTMLDivElement>(null);

  const bankRowsPerPage = 15;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tpDropdownRef.current && !tpDropdownRef.current.contains(e.target as Node)) setTpDropdownOpen(false);
      if (envDropdownRef.current && !envDropdownRef.current.contains(e.target as Node)) setEnvDropdownOpen(false);
      if (bankDropdownRef.current && !bankDropdownRef.current.contains(e.target as Node)) setBankDropdownOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Base filtered payments (date filter applies to all tabs)
  const payments = useMemo(() => {
    if (!data) return [];
    return filterByDateRange(data.payments, dateRange, (p) => p.paymentDate, customRange);
  }, [data, dateRange, customRange]);

  const dataStartDate = useMemo(() => {
    if (!data || data.payments.length === 0) return undefined;
    const dates = data.payments.map((p) => p.paymentDate).filter(Boolean).sort();
    if (!dates.length) return undefined;
    const [y, m, d] = dates[0].split("-").map(Number);
    return new Date(y, m - 1, d);
  }, [data]);

  const isFiltered = dateRange !== "all";

  // ── Core analytics (used by Summary + Portfolio) ──
  const rawFa = useMemo(() => {
    // Prefer in-memory data (live, reflects sheets edits/deletes immediately)
    if (payments.length > 0) {
      const bankMap = new Map<string, { amounts: number[]; paymentCount: number; accounts: Set<string> }>();
      const tpMap = new Map<string, { count: number; amounts: number[] }>();
      const allAccounts = new Set<string>();
      const sc = (nums: number[]) => nums.reduce((s, n) => s + Math.round(n * 100), 0) / 100;
      for (const p of payments) {
        allAccounts.add(p.account);
        if (!bankMap.has(p.bank)) bankMap.set(p.bank, { amounts: [], paymentCount: 0, accounts: new Set() });
        const b = bankMap.get(p.bank)!; b.amounts.push(p.paymentAmount); b.paymentCount++; b.accounts.add(p.account);
        if (!tpMap.has(p.touchpoint)) tpMap.set(p.touchpoint, { count: 0, amounts: [] });
        const t = tpMap.get(p.touchpoint)!; t.count++; t.amounts.push(p.paymentAmount);
      }
      const totalAmount = sc(payments.map((p) => p.paymentAmount));
      const bankAnalytics = Array.from(bankMap.entries())
        .map(([bank, d]) => { const bt = sc(d.amounts); return { bank, accountCount: d.accounts.size, totalAmount: bt, debtorSum: d.paymentCount, percentage: totalAmount > 0 ? (bt / totalAmount) * 100 : 0, paymentCount: d.paymentCount }; })
        .sort((a, b) => b.totalAmount - a.totalAmount);
      const touchpointAnalytics = Array.from(tpMap.entries())
        .map(([touchpoint, d]) => { const tt = sc(d.amounts); return { touchpoint, count: d.count, totalAmount: tt, percentage: totalAmount > 0 ? (tt / totalAmount) * 100 : 0 }; })
        .sort((a, b) => b.count - a.count);
      return { bankAnalytics, touchpointAnalytics, totalAmount, totalAccounts: allAccounts.size, totalPayments: payments.length };
    }
    // If in-memory data is loaded but filtered to 0, return zeroed analytics (don't fall through to empty state)
    if (data !== null && isFiltered) {
      return { bankAnalytics: [], touchpointAnalytics: [], totalAmount: 0, totalAccounts: 0, totalPayments: 0 };
    }
    // Fallback to API summary when no in-memory data (e.g. after page refresh).
    // The API is called with date_from/date_to so it is already filtered server-side.
    if (apiSummary) {
      return {
        totalAmount: apiSummary.total_amount,
        totalAccounts: apiSummary.total_accounts,
        totalPayments: apiSummary.total_payments,
        bankAnalytics: apiSummary.banks.map((b) => ({
          bank: b.bank, accountCount: b.account_count, totalAmount: b.total_amount,
          debtorSum: b.payment_count, percentage: b.percentage, paymentCount: b.payment_count,
        })),
        touchpointAnalytics: apiSummary.touchpoints.map((t) => ({
          touchpoint: t.touchpoint, count: t.count, totalAmount: t.total_amount, percentage: t.percentage,
        })),
      };
    }
    return null;
  }, [apiSummary, data, payments, isFiltered]);

  const fa = rawFa ?? { totalAmount: 0, totalAccounts: 0, totalPayments: 0, bankAnalytics: [], touchpointAnalytics: [] };
  const noData = !rawFa && !showSkeleton && !isFiltered;

  // ── Monthly trend ──
  const monthlyTrend = useMemo(() => {
    // When in-memory data is available use it (supports date filtering)
    if (payments.length > 0) {
      const map = new Map<string, number>();
      for (const p of payments) {
        const raw = p.paymentDate.slice(0, 7) || "";
        if (!raw || raw === "Unknown") continue;
        map.set(raw, (map.get(raw) || 0) + p.paymentAmount);
      }
      if (map.size === 0) return [];

      const sorted = Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));

      return sorted
        .map(([raw, amount]) => {
          const parts = raw.split("-");
          const label = new Date(Number(parts[0]), Number(parts[1]) - 1, 1)
            .toLocaleDateString("en-US", { month: "short", year: "numeric" });
          return { month: label, rawMonth: raw, amount };
        });
    }
    // In-memory data loaded but filter returns no results — show empty chart
    if (data !== null && isFiltered) return [];
    // Fallback to API summary monthly trend (no in-memory data, e.g. after page refresh)
    if (apiSummary?.monthly_trend?.length) {
      return apiSummary.monthly_trend.map(({ month, amount }) => {
        const parts = month.split("-");
        const label = new Date(Number(parts[0]), Number(parts[1]) - 1, 1)
          .toLocaleDateString("en-US", { month: "short", year: "numeric" });
        return { month: label, rawMonth: month, amount };
      });
    }
    return [];
  }, [payments, data, isFiltered, apiSummary]);

  // ── Portfolio tab data ──
  const allEnvironments = useMemo(() => {
    // Prefer in-memory data — avoids phantom options when date filter scopes the dataset
    if (data) return [...new Set(data.payments.map((p) => p.environment).filter(Boolean) as string[])].sort();
    if (apiSummary) return apiSummary.environments;
    return [];
  }, [apiSummary, data]);

  // Banks filtered by selected environments + touchpoints (cascading)
  const allBanks = useMemo(() => {
    if (selectedEnvironments.size > 0 || selectedTouchpoints.size > 0) {
      if (apiSummary?.environment_map) {
        const bankSet = new Set<string>();
        for (const envEntry of apiSummary.environment_map) {
          const envMatch = selectedEnvironments.size === 0 || selectedEnvironments.has(envEntry.environment);
          if (!envMatch) continue;
          for (const [bank, tps] of Object.entries(envEntry.touchpoints_by_bank)) {
            const tpMatch = selectedTouchpoints.size === 0 || tps.some((tp) => selectedTouchpoints.has(tp));
            if (tpMatch) bankSet.add(bank);
          }
        }
        return Array.from(bankSet).sort();
      }
      // In-memory fallback
      if (data) {
        const bankSet = new Set<string>();
        data.payments
          .filter((p) => {
            const envMatch = selectedEnvironments.size === 0 || selectedEnvironments.has(p.environment || "Unknown");
            const tpMatch = selectedTouchpoints.size === 0 || selectedTouchpoints.has(p.touchpoint || "Unknown");
            return envMatch && tpMatch;
          })
          .forEach((p) => bankSet.add(p.bank));
        return Array.from(bankSet).sort();
      }
      return [];
    }
    // No environment or touchpoint selected — show all banks
    if (apiSummary) return apiSummary.banks.map((b) => b.bank).sort();
    if (!data) return [];
    return [...new Set(data.payments.map((p) => p.bank))].sort();
  }, [apiSummary, data, selectedEnvironments, selectedTouchpoints]);

  const portfolioFiltered = useMemo(() => {
    let f = payments;
    if (selectedEnvironments.size > 0) f = f.filter((p) => selectedEnvironments.has(p.environment || "Unknown"));
    if (selectedBanks.size > 0) f = f.filter((p) => selectedBanks.has(p.bank));
    if (selectedTouchpoints.size > 0) f = f.filter((p) => selectedTouchpoints.has(p.touchpoint || "Unknown"));
    return f;
  }, [payments, selectedEnvironments, selectedBanks, selectedTouchpoints]);

  const portfolioAnalytics = useMemo(() => {
    const src = portfolioFiltered;
    // In-memory data loaded but filter returns no results — show zeros (never fall back to API when data is present)
    if (src.length === 0 && data !== null) {
      return { bankAnalytics: [] as typeof fa.bankAnalytics, totalAmount: 0, totalAccounts: 0, totalPayments: 0 };
    }
    // Fallback to apiSummary when no in-memory data — filter banks by selected environment/bank using environment_map.
    // apiSummary is already date-filtered from the API call.
    if (src.length === 0 && apiSummary) {
      // Use bank_touchpoint_matrix for accurate filtering when touchpoints or environments are selected.
      const matrix = apiSummary.bank_touchpoint_matrix ?? [];
      if (matrix.length > 0) {
        // Filter the matrix by all three dimensions
        let filtered = matrix;
        if (selectedEnvironments.size > 0) filtered = filtered.filter((r) => selectedEnvironments.has(r.environment || "Unknown"));
        if (selectedBanks.size > 0) filtered = filtered.filter((r) => selectedBanks.has(r.bank));
        if (selectedTouchpoints.size > 0) filtered = filtered.filter((r) => selectedTouchpoints.has(r.touchpoint || "Unknown"));
        // Aggregate by bank
        const bankMap = new Map<string, { amount: number; count: number; accountCount: number }>();
        for (const row of filtered) {
          if (!bankMap.has(row.bank)) bankMap.set(row.bank, { amount: 0, count: 0, accountCount: 0 });
          const b = bankMap.get(row.bank)!;
          b.amount += row.total_amount;
          b.count += row.count;
          b.accountCount += row.account_count;
        }
        const filteredTotal = Array.from(bankMap.values()).reduce((s, b) => s + b.amount, 0);
        const bankAnalytics = Array.from(bankMap.entries())
          .map(([bank, d]) => ({ bank, accountCount: d.accountCount, totalAmount: d.amount, debtorSum: d.count, percentage: filteredTotal > 0 ? (d.amount / filteredTotal) * 100 : 0, paymentCount: d.count }))
          .sort((a, b) => b.totalAmount - a.totalAmount);
        const filteredPayments = filtered.reduce((s, r) => s + r.count, 0);
        const filteredAccounts = filtered.reduce((s, r) => s + r.account_count, 0);
        return { bankAnalytics, totalAmount: filteredTotal, totalAccounts: filteredAccounts, totalPayments: filteredPayments };
      }
      // Fallback to bank-level totals when matrix not available (old API responses)
      let visibleBanks = apiSummary.banks;
      if ((selectedEnvironments.size > 0 || selectedTouchpoints.size > 0) && apiSummary.environment_map) {
        const bankSet = new Set<string>();
        for (const envEntry of apiSummary.environment_map) {
          const envMatch = selectedEnvironments.size === 0 || selectedEnvironments.has(envEntry.environment);
          if (!envMatch) continue;
          for (const [bank, tps] of Object.entries(envEntry.touchpoints_by_bank)) {
            const tpMatch = selectedTouchpoints.size === 0 || tps.some((tp) => selectedTouchpoints.has(tp));
            if (tpMatch) bankSet.add(bank);
          }
        }
        visibleBanks = visibleBanks.filter((b) => bankSet.has(b.bank));
      }
      if (selectedBanks.size > 0) {
        visibleBanks = visibleBanks.filter((b) => selectedBanks.has(b.bank));
      }
      const filteredTotal = visibleBanks.reduce((s, b) => s + b.total_amount, 0);
      const bankAnalytics = visibleBanks.map((b) => ({
        bank: b.bank, accountCount: b.account_count, totalAmount: b.total_amount,
        debtorSum: b.payment_count, percentage: filteredTotal > 0 ? (b.total_amount / filteredTotal) * 100 : 0, paymentCount: b.payment_count,
      }));
      const filteredAccounts = visibleBanks.reduce((s, b) => s + b.account_count, 0);
      const filteredPayments = visibleBanks.reduce((s, b) => s + b.payment_count, 0);
      return { bankAnalytics, totalAmount: filteredTotal, totalAccounts: filteredAccounts, totalPayments: filteredPayments };
    }
    if (src.length === 0) return { bankAnalytics: [] as typeof fa.bankAnalytics, totalAmount: 0, totalAccounts: 0, totalPayments: 0 };
    const bankMap = new Map<string, { amounts: number[]; paymentCount: number; accounts: Set<string> }>();
    const allAccounts = new Set<string>();
    for (const p of src) {
      allAccounts.add(p.account);
      if (!bankMap.has(p.bank)) bankMap.set(p.bank, { amounts: [], paymentCount: 0, accounts: new Set() });
      const b = bankMap.get(p.bank)!; b.amounts.push(p.paymentAmount); b.paymentCount++; b.accounts.add(p.account);
    }
    const totalAmount = src.reduce((s, p) => s + Math.round(p.paymentAmount * 100), 0) / 100;
    const bankAnalytics = Array.from(bankMap.entries())
      .map(([bank, d]) => { const bt = d.amounts.reduce((s, n) => s + Math.round(n * 100), 0) / 100; return { bank, accountCount: d.accounts.size, totalAmount: bt, debtorSum: d.paymentCount, percentage: totalAmount > 0 ? (bt / totalAmount) * 100 : 0, paymentCount: d.paymentCount }; })
      .sort((a, b) => b.totalAmount - a.totalAmount);
    return { bankAnalytics, totalAmount, totalAccounts: allAccounts.size, totalPayments: src.length };
  }, [portfolioFiltered, apiSummary, selectedEnvironments, selectedBanks, selectedTouchpoints, fa]);

  // ── Channels tab data ──
  const allTouchpoints = useMemo(() => {
    if (selectedEnvironments.size > 0 || selectedBanks.size > 0) {
      // Cascade: only show touchpoints that exist for the selected environments and/or banks
      if (apiSummary?.environment_map) {
        const tpSet = new Set<string>();
        for (const envEntry of apiSummary.environment_map) {
          const envMatch = selectedEnvironments.size === 0 || selectedEnvironments.has(envEntry.environment);
          if (!envMatch) continue;
          for (const [bank, tps] of Object.entries(envEntry.touchpoints_by_bank)) {
            const bankMatch = selectedBanks.size === 0 || selectedBanks.has(bank);
            if (bankMatch) tps.forEach((tp) => tpSet.add(tp));
          }
        }
        return Array.from(tpSet).sort();
      }
      if (data) {
        const tpSet = new Set<string>();
        data.payments
          .filter((p) => {
            const envMatch = selectedEnvironments.size === 0 || selectedEnvironments.has(p.environment || "Unknown");
            const bankMatch = selectedBanks.size === 0 || selectedBanks.has(p.bank);
            return envMatch && bankMatch;
          })
          .forEach((p) => tpSet.add(p.touchpoint || "Unknown"));
        return Array.from(tpSet).sort();
      }
      return [];
    }
    if (apiSummary) return apiSummary.touchpoints.map((t) => t.touchpoint);
    if (!data) return [];
    return [...new Set(data.payments.map((p) => p.touchpoint || "Unknown"))].sort();
  }, [apiSummary, data, selectedEnvironments, selectedBanks]);

  const channelAnalytics = useMemo(() => {
    let base = payments;
    if (selectedEnvironments.size > 0) base = base.filter((p) => selectedEnvironments.has(p.environment || "Unknown"));
    if (selectedBanks.size > 0) base = base.filter((p) => selectedBanks.has(p.bank));
    const src = selectedTouchpoints.size > 0
      ? base.filter((p) => selectedTouchpoints.has(p.touchpoint || "Unknown"))
      : base;
    // In-memory data loaded but filters return no results (no touchpoint/env selection active) — show zeros
    if (src.length === 0 && data !== null && isFiltered && selectedTouchpoints.size === 0 && selectedEnvironments.size === 0 && selectedBanks.size === 0) return [];
    // Fallback to apiSummary when no in-memory data — filter by selected environments + touchpoints.
    // apiSummary is already date-filtered from the API call.
    if (src.length === 0 && apiSummary) {
      // Use bank_touchpoint_matrix for accurate env+bank filtering of touchpoint amounts
      const matrix = apiSummary.bank_touchpoint_matrix ?? [];
      if (matrix.length > 0) {
        let filtered = matrix;
        if (selectedEnvironments.size > 0) filtered = filtered.filter((r) => selectedEnvironments.has(r.environment || "Unknown"));
        if (selectedBanks.size > 0) filtered = filtered.filter((r) => selectedBanks.has(r.bank));
        if (selectedTouchpoints.size > 0) filtered = filtered.filter((r) => selectedTouchpoints.has(r.touchpoint || "Unknown"));
        const tpMap = new Map<string, { count: number; amount: number }>();
        for (const row of filtered) {
          const tp = row.touchpoint || "Unknown";
          if (!tpMap.has(tp)) tpMap.set(tp, { count: 0, amount: 0 });
          const t = tpMap.get(tp)!; t.count += row.count; t.amount += row.total_amount;
        }
        const filteredTotal = Array.from(tpMap.values()).reduce((s, t) => s + t.amount, 0);
        return Array.from(tpMap.entries())
          .map(([touchpoint, d]) => ({ touchpoint, count: d.count, totalAmount: d.amount, percentage: filteredTotal > 0 ? (d.amount / filteredTotal) * 100 : 0 }))
          .sort((a, b) => b.count - a.count);
      }
      // Fallback to touchpoint-level totals (old API responses without matrix)
      let allowedTouchpoints: Set<string> | null = null;
      if ((selectedEnvironments.size > 0 || selectedBanks.size > 0) && apiSummary.environment_map) {
        allowedTouchpoints = new Set<string>();
        for (const envEntry of apiSummary.environment_map) {
          const envMatch = selectedEnvironments.size === 0 || selectedEnvironments.has(envEntry.environment);
          if (!envMatch) continue;
          for (const [bank, tps] of Object.entries(envEntry.touchpoints_by_bank)) {
            const bankMatch = selectedBanks.size === 0 || selectedBanks.has(bank);
            if (bankMatch) tps.forEach((tp) => allowedTouchpoints!.add(tp));
          }
        }
      }
      let all = apiSummary.touchpoints.map((t) => ({
        touchpoint: t.touchpoint, count: t.count, totalAmount: t.total_amount, percentage: t.percentage,
      }));
      if (allowedTouchpoints !== null) all = all.filter((t) => allowedTouchpoints!.has(t.touchpoint));
      if (selectedTouchpoints.size > 0) all = all.filter((t) => selectedTouchpoints.has(t.touchpoint));
      // Recalculate percentages after filtering
      const filteredTotal = all.reduce((s, t) => s + t.totalAmount, 0);
      return all.map((t) => ({ ...t, percentage: filteredTotal > 0 ? (t.totalAmount / filteredTotal) * 100 : 0 }));
    }
    if (src.length === 0) return [];
    const tpMap = new Map<string, { count: number; amounts: number[] }>();
    for (const p of src) {
      const tp = p.touchpoint || "Unknown";
      if (!tpMap.has(tp)) tpMap.set(tp, { count: 0, amounts: [] });
      const t = tpMap.get(tp)!; t.count++; t.amounts.push(p.paymentAmount);
    }
    const totalAmount = src.reduce((s, p) => s + Math.round(p.paymentAmount * 100), 0) / 100;
    return Array.from(tpMap.entries())
      .map(([touchpoint, d]) => { const tt = d.amounts.reduce((s, n) => s + Math.round(n * 100), 0) / 100; return { touchpoint, count: d.count, totalAmount: tt, percentage: totalAmount > 0 ? (tt / totalAmount) * 100 : 0 }; })
      .sort((a, b) => b.count - a.count);
  }, [payments, data, isFiltered, selectedTouchpoints, selectedEnvironments, selectedBanks, apiSummary]);

  // Channel type grouping (IB / OB / Direct / Ghost / Automated / No Touchpoint)
  const channelGroupData = useMemo(() => {
    let base = payments;
    if (selectedEnvironments.size > 0) base = base.filter((p) => selectedEnvironments.has(p.environment || "Unknown"));
    if (selectedBanks.size > 0) base = base.filter((p) => selectedBanks.has(p.bank));
    const src = selectedTouchpoints.size > 0
      ? base.filter((p) => selectedTouchpoints.has(p.touchpoint || "Unknown"))
      : base;
    // Fallback: derive groups from channelAnalytics (which already has apiSummary fallback)
    if (src.length === 0 && channelAnalytics.length > 0) {
      const groupMap = new Map<string, { count: number; amount: number }>();
      for (const t of channelAnalytics) {
        const g = channelType(t.touchpoint || "");
        if (!groupMap.has(g)) groupMap.set(g, { count: 0, amount: 0 });
        const e = groupMap.get(g)!; e.count += t.count; e.amount += t.totalAmount;
      }
      return Array.from(groupMap.entries())
        .map(([group, d]) => ({ group, count: d.count, amount: Math.round(d.amount * 100) / 100 }))
        .sort((a, b) => b.count - a.count);
    }
    const groupMap = new Map<string, { count: number; amount: number }>();
    for (const p of src) {
      const g = channelType(p.touchpoint || "");
      if (!groupMap.has(g)) groupMap.set(g, { count: 0, amount: 0 });
      const e = groupMap.get(g)!; e.count++; e.amount += p.paymentAmount;
    }
    return Array.from(groupMap.entries())
      .map(([group, d]) => ({ group, count: d.count, amount: Math.round(d.amount * 100) / 100 }))
      .sort((a, b) => b.count - a.count);
  }, [payments, selectedTouchpoints, selectedEnvironments, selectedBanks, channelAnalytics]);

  const tpTotal = channelAnalytics.reduce((s, t) => s + t.count, 0);
  const tpTotalAmount = channelAnalytics.reduce((s, t) => s + Math.round(t.totalAmount * 100), 0) / 100;

  // ── Shared pagination reset on tab change / filter change ──
  // Note: selectedBanks is intentionally excluded — changing bank filter while on a paginated
  // view should not reset the page (user may be selecting banks from a later page).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setPortfolioBankPage(1); }, [activeTab, selectedEnvironments, dateRange]);

  const TABS = [
    { id: "summary" as const, label: "Overview", icon: TrendingUp },
    { id: "portfolio" as const, label: "Banks", icon: Building2 },
    { id: "channels" as const, label: "Touchpoints", icon: Radio },
  ];

  const dropdownBtnClass = "flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-sm text-gray-700 dark:text-gray-200 hover:bg-muted/50 dark:hover:bg-muted transition-colors";
  const dropdownPanelClass = "absolute right-0 top-full mt-1 z-50 w-64 max-h-72 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-lg";

  return (
    <div className="px-4 sm:px-8 py-8 min-h-screen">
      {/* ── Date filter loading overlay ── */}
      {dateFilterLoading && apiFetching && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl px-10 py-8 flex flex-col items-center gap-4 border border-gray-200 dark:border-gray-700">
            <Loader2 className="animate-spin h-10 w-10 text-[#5B66E2]" />
            <p className="text-sm font-semibold text-gray-700 dark:text-gray-200 tracking-wide">Applying date filter…</p>
            <p className="text-xs text-gray-400 dark:text-gray-500">Fetching updated records</p>
          </div>
        </div>
      )}
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-6 gap-4">
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">Welcome{user ? `, ${user.full_name.split(" ")[0]}` : ""}!</p>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Environment filter — Portfolio + Channels tabs */}
          {(activeTab === "portfolio" || activeTab === "channels") && (
            <div ref={envDropdownRef} className="relative">
              <button onClick={() => setEnvDropdownOpen((v) => !v)} className={dropdownBtnClass}>
                <Globe className="h-4 w-4" />
                {selectedEnvironments.size === 0 ? "All Environments" : `${selectedEnvironments.size} selected`}
                <ChevronDown className={`h-4 w-4 transition-transform ${envDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {envDropdownOpen && (
                <div className={dropdownPanelClass}>
                  {selectedEnvironments.size > 0 && (
                    <button onClick={() => { setSelectedEnvironments(new Set()); setSelectedBanks(new Set()); setSelectedTouchpoints(new Set()); }} className="w-full px-3 py-2 text-left text-xs text-[#5B66E2] hover:bg-muted/50 border-b border-gray-200 dark:border-gray-700">Clear selection</button>
                  )}
                  {allEnvironments.map((env) => (
                    <button key={env} onClick={() => {
                      setSelectedEnvironments((prev) => {
                        const n = new Set(prev);
                        n.has(env) ? n.delete(env) : n.add(env);
                        return n;
                      });
                      // Clear banks and touchpoints that may not exist in the new env selection
                      setSelectedBanks(new Set());
                      setSelectedTouchpoints(new Set());
                    }} className="flex items-center w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-muted/50 transition-colors">
                      <span className={`flex items-center justify-center h-4 w-4 mr-2 rounded border ${selectedEnvironments.has(env) ? "bg-[#5B66E2] border-[#5B66E2]" : "border-gray-300 dark:border-gray-600"}`}>{selectedEnvironments.has(env) && <Check className="h-3 w-3 text-white" />}</span>
                      {env}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Bank filter — Portfolio + Touchpoints tabs */}
          {(activeTab === "portfolio" || activeTab === "channels") && (
            <div ref={bankDropdownRef} className="relative">
              <button onClick={() => setBankDropdownOpen((v) => !v)} className={dropdownBtnClass}>
                <Landmark className="h-4 w-4" />
                {selectedBanks.size === 0 ? "All Banks" : `${selectedBanks.size} bank${selectedBanks.size !== 1 ? "s" : ""}`}
                <ChevronDown className={`h-4 w-4 transition-transform ${bankDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {bankDropdownOpen && (
                <div className={dropdownPanelClass}>
                  {selectedBanks.size > 0 && (
                    <button onClick={() => setSelectedBanks(new Set())} className="w-full px-3 py-2 text-left text-xs text-[#5B66E2] hover:bg-muted/50 border-b border-gray-200 dark:border-gray-700">Clear selection</button>
                  )}
                  {allBanks.map((bank) => (
                    <button key={bank} onClick={() => setSelectedBanks((prev) => { const n = new Set(prev); n.has(bank) ? n.delete(bank) : n.add(bank); return n; })} className="flex items-center w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-muted/50 transition-colors">
                      <span className={`flex items-center justify-center h-4 w-4 mr-2 rounded border ${selectedBanks.has(bank) ? "bg-[#5B66E2] border-[#5B66E2]" : "border-gray-300 dark:border-gray-600"}`}>{selectedBanks.has(bank) && <Check className="h-3 w-3 text-white" />}</span>
                      {bank}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {/* Touchpoint filter — Portfolio + Channels tabs */}
          {(activeTab === "portfolio" || activeTab === "channels") && (
            <div ref={tpDropdownRef} className="relative">
              <button onClick={() => setTpDropdownOpen((v) => !v)} className={dropdownBtnClass}>
                <Waypoints className="h-4 w-4" />
                {selectedTouchpoints.size === 0 ? "All Touchpoints" : `${selectedTouchpoints.size} selected`}
                <ChevronDown className={`h-4 w-4 transition-transform ${tpDropdownOpen ? "rotate-180" : ""}`} />
              </button>
              {tpDropdownOpen && (
                <div className={dropdownPanelClass}>
                  {selectedTouchpoints.size > 0 && (
                    <button onClick={() => setSelectedTouchpoints(new Set())} className="w-full px-3 py-2 text-left text-xs text-[#5B66E2] hover:bg-muted/50 border-b border-gray-200 dark:border-gray-700">Clear selection</button>
                  )}
                  {allTouchpoints.map((tp) => (
                    <button key={tp} onClick={() => setSelectedTouchpoints((prev) => { const n = new Set(prev); n.has(tp) ? n.delete(tp) : n.add(tp); return n; })} className="flex items-center w-full px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-muted/50 transition-colors">
                      <span className={`flex items-center justify-center h-4 w-4 mr-2 rounded border ${selectedTouchpoints.has(tp) ? "bg-[#5B66E2] border-[#5B66E2]" : "border-gray-300 dark:border-gray-600"}`}>{selectedTouchpoints.has(tp) && <Check className="h-3 w-3 text-white" />}</span>
                      {tp}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          <DateFilter value={dateRange} onChange={(r, c) => { setDateRange(r); setCustomRange(c); setDateFilterLoading(true); }} customRange={customRange} dataStartDate={dataStartDate} />
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-0 border-b border-gray-200 dark:border-gray-700 mb-6">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)} className={`flex items-center gap-2 px-5 py-3 text-sm font-medium transition-colors -mb-px ${activeTab === id ? "border-b-2 border-[#5B66E2] text-[#5B66E2] bg-[#5B66E2]/5" : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* ════════════════════════════════════════════════════════
          TAB 1 — SUMMARY
      ════════════════════════════════════════════════════════ */}
      {activeTab === "summary" && (
        <>
          {noData && (
            <div className="mb-6 p-6 rounded-lg border border-[#5B66E2]/30 bg-[#5B66E2]/10 text-center flex flex-col items-center gap-3">
              <p className="text-sm text-[#5B66E2] dark:text-[#8B96F2]">
                No records found. Upload a dataset to get started.
              </p>
              <button
                onClick={handleUploadNav}
                className="px-4 py-2 text-sm font-medium rounded-lg bg-[#5B66E2] text-white hover:bg-[#4a55d1] transition-colors"
              >
                Upload Data
              </button>
            </div>
          )}

          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {showSkeleton ? (
              Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
            ) : (
              <>
                <MetricCard label="Total Payment Amount" value={`₱${fmtAmt(fa.totalAmount)}`} icon={DollarSign} iconBg="bg-[#5B66E2]" info="Sum of all payments" />
                <MetricCard label="Unique Accounts" value={fmt(fa.totalAccounts)} icon={Users} iconBg="bg-[#4a55d1]" info="Distinct debtor IDs" />
                <MetricCard label="Total Transactions" value={fmt(fa.totalPayments)} icon={FileText} iconBg="bg-[#5B66E2]" info="Total payment rows" />
                <MetricCard label="Banks / Portfolios" value={fmt(fa.bankAnalytics.length)} icon={Landmark} iconBg="bg-[#4048c0]" info="Distinct banks" />
              </>
            )}
          </div>

          {/* Monthly Trend — full width */}
          <Card className="p-6 bg-card border-border mb-6">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Payment Trend by Month</h3>
                <p className="text-xs text-gray-400 dark:text-gray-500">Total payment amount collected per month — shows growth or decline over time</p>
              </div>
            </div>
            {showSkeleton ? <ChartSkeleton type="line" height={220} /> : monthlyTrend.length === 0 ? (
              <div className="h-[220px] flex items-center justify-center text-sm text-gray-400">No date data available</div>
            ) : (
              <DynamicChart data={monthlyTrend} type="line" dataKey="amount" xAxisKey="month" height={220} />
            )}
            {!showSkeleton && monthlyTrend.length >= 2 && (() => {
              const first = monthlyTrend[0];
              const last = monthlyTrend[monthlyTrend.length - 1];
              // Only show % change if first month has substantial data (> 1% of last month)
              // to avoid misleading % from outlier months
              const showPct = first.amount > (last.amount * 0.01);
              const diff = last.amount - first.amount;
              const pct = showPct && first.amount > 0 ? ((diff / first.amount) * 100).toFixed(1) : null;
              const up = diff >= 0;
              return (
                <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700 flex items-center justify-between">
                  <p className="text-xs text-gray-400 dark:text-gray-500">
                    Showing {first.month} – {last.month}
                  </p>
                  {pct !== null && Math.abs(Number(pct)) < 1000 && (
                    <span className={`flex items-center gap-1 text-xs font-medium ${up ? "text-green-600 dark:text-green-400" : "text-red-500 dark:text-red-400"}`}>
                      {up ? "▲" : "▼"} {Math.abs(Number(pct))}% vs first month
                    </span>
                  )}
                </div>
              );
            })()}
          </Card>

          {/* Row 2: Top Banks bar + Touchpoint mix donut */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Top Banks by Payment Amount</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Top 10 banks ranked by total amount collected</p>
                </div>
              </div>
              {showSkeleton ? <ChartSkeleton type="barh" height={320} /> : (() => {
                const d = fa.bankAnalytics.slice(0, 10);
                return <DynamicChart data={[...d].sort((a, b) => a.totalAmount - b.totalAmount).map((a) => ({ bank: a.bank, amount: a.totalAmount }))} type="barh" dataKey="amount" xAxisKey="bank" height={320} />;
              })()}
            </Card>
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Touchpoint Mix (Top 8)</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Distribution of transactions across the top 8 touchpoints by count</p>
                </div>
              </div>
              {showSkeleton ? <ChartSkeleton type="donut" height={320} /> : (
                <DynamicChart data={fa.touchpointAnalytics.slice(0, 8).map((t) => ({ touchpoint: t.touchpoint, count: t.count }))} type="donut" dataKey="count" xAxisKey="touchpoint" height={320} valueType="count" />
              )}
            </Card>
          </div>
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB 2 — PORTFOLIO
      ════════════════════════════════════════════════════════ */}
      {activeTab === "portfolio" && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {showSkeleton ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />) : (
              <>
                <MetricCard label="Total Payment Amount" value={`₱${fmtAmt(portfolioAnalytics.totalAmount)}`} icon={DollarSign} iconBg="bg-[#5B66E2]" />
                <MetricCard label="Unique Accounts" value={fmt(portfolioAnalytics.totalAccounts)} icon={Users} iconBg="bg-[#4a55d1]" />
                <MetricCard label="Total Transactions" value={fmt(portfolioAnalytics.totalPayments)} icon={FileText} iconBg="bg-[#5B66E2]" />
                <MetricCard label="Total Banks" value={fmt(portfolioAnalytics.bankAnalytics.length)} icon={Landmark} iconBg="bg-[#4048c0]" />
              </>
            )}
          </div>

          {portfolioFiltered.length === 0 && portfolioAnalytics.bankAnalytics.length === 0 && !showSkeleton && (
            <div className="mb-6 p-4 rounded-lg border border-[#5B66E2]/30 bg-[#5B66E2]/10 text-sm text-[#5B66E2] dark:text-[#8B96F2] text-center">
              No records found for the selected filters.
            </div>
          )}

          {/* Row 1: Amount by Bank (bar) + Portfolio share (donut) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Payment Amount by Bank</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Total amount collected per bank — filter by environment to drill down</p>
                </div>
                <select value={portfolioBankTopN === "all" ? "all" : String(portfolioBankTopN)} onChange={(e) => { setPortfolioBankTopN(e.target.value === "all" ? "all" : parseInt(e.target.value)); setPortfolioBankPage(1); }} className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#5B66E2]">
                  <option value="10">Top 10</option><option value="20">Top 20</option><option value="50">Top 50</option><option value="all">All</option>
                </select>
              </div>
              {showSkeleton ? <ChartSkeleton type="bar" height={320} /> : (() => {
                const d = portfolioBankTopN === "all" ? portfolioAnalytics.bankAnalytics : portfolioAnalytics.bankAnalytics.slice(0, portfolioBankTopN);
                const minWidth = Math.max(500, d.length * 28);
                return <div className="overflow-x-auto rounded-xl"><div style={{ minWidth }}><DynamicChart data={d.map((a) => ({ bank: a.bank, amount: a.totalAmount }))} type="bar" dataKey="amount" xAxisKey="bank" height={320} /></div></div>;
              })()}
            </Card>
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Top 8 Banks by Amount</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Which banks collected the most — by total payment amount</p>
                </div>
              </div>
              {showSkeleton ? <ChartSkeleton type="pie" height={320} /> : (
                <DynamicChart data={portfolioAnalytics.bankAnalytics.slice(0, 8).map((a) => ({ bank: a.bank, amount: a.totalAmount }))} type="pie" dataKey="amount" xAxisKey="bank" height={320} />
              )}
            </Card>
          </div>

          {/* Row 2: Transaction Count vs Amount — side by side horizontal bars */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Transaction Count by Bank</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Number of payment transactions per bank — high count means high volume, not necessarily high value</p>
                </div>
              </div>
              {showSkeleton ? <ChartSkeleton type="barh" height={280} /> : (
                <DynamicChart data={[...portfolioAnalytics.bankAnalytics].sort((a, b) => b.paymentCount - a.paymentCount).slice(0, 10).sort((a, b) => a.paymentCount - b.paymentCount).map((a) => ({ bank: a.bank, transactions: a.paymentCount }))} type="barh" dataKey="transactions" xAxisKey="bank" height={280} valueType="count" />
              )}
            </Card>
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">% Share by Bank</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Each bank&apos;s percentage of total collected amount — all banks ranked</p>
                </div>
              </div>
              {showSkeleton ? <ChartSkeleton type="bar" height={280} /> : (() => {
                const d = portfolioAnalytics.bankAnalytics.slice(0, portfolioBankTopN === "all" ? undefined : portfolioBankTopN);
                const minWidth = Math.max(500, d.length * 28);
                return <div className="overflow-x-auto rounded-xl"><div style={{ minWidth }}><DynamicChart data={d.map((a) => ({ bank: a.bank, percentage: Math.round(a.percentage * 10) / 10 }))} type="bar" dataKey="percentage" xAxisKey="bank" height={280} /></div></div>;
              })()}
            </Card>
          </div>

          {/* Bank Analytics Table */}
          {showSkeleton ? (
            <div className="rounded-lg border bg-card border-border mb-8 p-6">
              <Skeleton className="h-6 w-40 mb-4" />
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full mb-2 rounded-md" />)}
            </div>
          ) : (
            <div className="rounded-lg border bg-card border-border overflow-x-auto mb-8">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">Bank Analytics</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Detailed breakdown per bank — unique accounts, total amount collected, transaction count and share</p>
                </div>
                <span className="text-xs text-gray-400">{fmt(portfolioAnalytics.bankAnalytics.length)} banks</span>
              </div>
              <table className="w-full min-w-[700px]">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Bank</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Unique Accounts</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Amount</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Transactions</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">% of Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  <tr className="bg-muted font-semibold">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">Total</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">{fmt(portfolioAnalytics.totalAccounts)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">₱{fmtAmt(portfolioAnalytics.totalAmount)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">{fmt(portfolioAnalytics.totalPayments)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">100.0%</td>
                  </tr>
                  {portfolioAnalytics.bankAnalytics.slice(0, portfolioBankTopN === "all" ? undefined : portfolioBankTopN).slice((portfolioBankPage - 1) * bankRowsPerPage, portfolioBankPage * bankRowsPerPage).map((b) => (
                    <tr key={b.bank} className="hover:bg-[#5B66E2]/5 dark:hover:bg-[#5B66E2]/10 transition-colors duration-200">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">{b.bank}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{fmt(b.accountCount)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">₱{fmt(b.totalAmount)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{fmt(b.paymentCount)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{b.percentage.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <Pagination page={portfolioBankPage} setPage={setPortfolioBankPage} total={portfolioBankTopN === "all" ? portfolioAnalytics.bankAnalytics.length : Math.min(portfolioBankTopN, portfolioAnalytics.bankAnalytics.length)} rowsPerPage={bankRowsPerPage} />
            </div>
          )}
        </>
      )}

      {/* ════════════════════════════════════════════════════════
          TAB 3 — CHANNELS
      ════════════════════════════════════════════════════════ */}
      {activeTab === "channels" && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            {showSkeleton ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />) : (
              <>
                <MetricCard label="Total Transactions" value={fmt(tpTotal)} icon={Hash} iconBg="bg-[#5B66E2]" />
                <MetricCard label="Total Amount" value={`₱${fmtAmt(tpTotalAmount)}`} icon={DollarSign} iconBg="bg-[#4a55d1]" />
                <MetricCard label="Active Touchpoints" value={fmt(channelAnalytics.length)} icon={Waypoints} iconBg="bg-[#5B66E2]" />
                <MetricCard label="Top Touchpoint" value={channelAnalytics[0]?.touchpoint ?? "—"} icon={BarChart3} iconBg="bg-[#4048c0]" />
              </>
            )}
          </div>

          {channelAnalytics.length === 0 && !showSkeleton && (
            <div className="mb-6 p-4 rounded-lg border border-[#5B66E2]/30 bg-[#5B66E2]/10 text-sm text-[#5B66E2] dark:text-[#8B96F2] text-center">
              No records found for the selected filters.
            </div>
          )}

          {/* Row 1: Channel type groups + Touchpoint donut */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Touchpoint Type Performance</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Inbound (IB) vs Outbound (OB) vs With Touchpoint vs Ghost Payment vs No Touchpoint — transaction count</p>
                </div>
              </div>
              {showSkeleton ? <ChartSkeleton type="bar" height={280} /> : (
                <DynamicChart data={channelGroupData.map((g) => ({ group: g.group, count: g.count }))} type="bar" dataKey="count" xAxisKey="group" height={280} valueType="count" />
              )}
            </Card>
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Touchpoint Type — Amount Share</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Total payment amount collected per touchpoint type — shows which strategy drives the most value</p>
                </div>
              </div>
              {showSkeleton ? <ChartSkeleton type="pie" height={280} /> : (
                <DynamicChart data={channelGroupData.map((g) => ({ group: g.group, amount: g.amount }))} type="pie" dataKey="amount" xAxisKey="group" height={280} />
              )}
            </Card>
          </div>

          {/* Row 2: Amount by touchpoint (horizontal) + % share bar */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Amount by Touchpoint</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Total payment amount collected per individual touchpoint — ranked highest to lowest</p>
                </div>
              </div>
              {showSkeleton ? <ChartSkeleton type="barh" height={300} /> : (
                <DynamicChart data={[...channelAnalytics].sort((a, b) => a.totalAmount - b.totalAmount).slice(0, 12).map((t) => ({ touchpoint: t.touchpoint, amount: t.totalAmount }))} type="barh" dataKey="amount" xAxisKey="touchpoint" height={300} />
              )}
            </Card>
            <Card className="p-6 bg-card border-border">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Top Touchpoints by Amount</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500">Top 8 individual touchpoints by total amount — shows which specific touchpoints generate the most collections</p>
                </div>
              </div>
              {showSkeleton ? <ChartSkeleton type="donut" height={300} /> : (
                <DynamicChart data={channelAnalytics.slice(0, 8).map((t) => ({ touchpoint: t.touchpoint, amount: t.totalAmount }))} type="donut" dataKey="amount" xAxisKey="touchpoint" height={300} />
              )}
            </Card>
          </div>

          {/* Touchpoint Analytics Table */}
          {apiLoading ? (
            <div className="rounded-lg border bg-card border-border mb-8 p-6">
              <Skeleton className="h-6 w-40 mb-4" />
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full mb-2 rounded-md" />)}
            </div>
          ) : (
            <div className="rounded-lg border bg-card border-border overflow-x-auto mb-8">
              <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
                <div>
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white">Touchpoint Analytics</h3>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Full breakdown per touchpoint — transaction count, amount collected, touchpoint type and share of total</p>
                </div>
                <span className="text-xs text-gray-400">{fmt(channelAnalytics.length)} touchpoints</span>
              </div>
              <table className="w-full min-w-[500px]">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Touchpoint</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Touchpoint Type</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Transactions</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Amount</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">% of Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                  <tr className="bg-muted font-semibold">
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">Total</td>
                    <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">—</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">{fmt(tpTotal)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">₱{fmt(tpTotalAmount)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-900 dark:text-white">100.0%</td>
                  </tr>
                  {channelAnalytics.map((t) => (
                    <tr key={t.touchpoint} className="hover:bg-[#5B66E2]/5 dark:hover:bg-[#5B66E2]/10 transition-colors duration-200">
                      <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">{t.touchpoint}</td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-[#5B66E2]/10 text-[#5B66E2] dark:text-[#8B96F2]">{channelType(t.touchpoint)}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{fmt(t.count)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">₱{fmt(t.totalAmount)}</td>
                      <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{t.percentage.toFixed(1)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

