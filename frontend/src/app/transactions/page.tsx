"use client";

import { useState, useMemo, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { Download, Search, Plus, Pencil, Trash2, ChevronDown, X, Check, AlertTriangle, FileSpreadsheet } from "lucide-react";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DateFilter, DateRange, CustomDateRange, filterByDateRange, dateRangeToBounds } from "@/components/DateFilter";
import { getTransactions, getDashboardSummary, deleteTransaction, deleteTransactionsByDateRange, getUpload, deleteUpload, createTransaction, updateTransaction, downloadAllRecordsCSV, type PaymentRecordOut } from "@/lib/api";
import { useDashboard, useTransactions, queryKeys } from "@/lib/queries";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { exportToExcel, exportToCSV } from "@/utils/exportUtils";
import type { PaymentRecord, ParsedData } from "@/types/data";

function fmt(n: number): string {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function TransactionsPage() {
  const { data, setData, rawData, sessionId, setSessionId, sessionValidated, fileName } = useData();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // True while the debounce timer is running (user typed but search hasn't fired yet)
  const isSearchPending = searchQuery !== debouncedSearch;
  const [bankFilter, setBankFilter] = useState("all");
  const [tpFilter, setTpFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");
  const [envFilter, setEnvFilter] = useState("all");
  const [currentPage, setCurrentPage] = useState(1);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [customRange, setCustomRange] = useState<CustomDateRange | undefined>(undefined);
  const rowsPerPage = 25;

  // Debounce search: wait 400 ms after the user stops typing before firing API call
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedSearch(searchQuery);
      setCurrentPage(1);
    }, 400);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchQuery]);

  // Backend-mode state using TanStack Query (cached, no redundant Neon fetches)
  const { data: dashSummary } = useDashboard(token, sessionId, sessionValidated);
  const dateBounds = dateRangeToBounds(dateRange, customRange);
  const apiFilters = {
    bank: bankFilter !== "all" ? bankFilter : undefined,
    touchpoint: tpFilter !== "all" ? tpFilter : undefined,
    payment_date: dateFilter !== "all" ? dateFilter : undefined,
    environment: envFilter !== "all" ? envFilter : undefined,
    date_from: dateBounds.date_from,
    date_to: dateBounds.date_to,
    search: debouncedSearch || undefined,
    page: currentPage,
    page_size: rowsPerPage,
  };
  const { data: txPage, isFetching: apiLoading, error: txError } = useTransactions(token, sessionId, apiFilters, sessionValidated);

  // Auto-clear stale session on 404 or 500 (e.g. after DB migration / new database)
  useEffect(() => {
    if (txError && (txError.message.includes("404") || txError.message.includes("Not Found") || txError.message.includes("500") || txError.message.includes("Internal Server Error"))) {
      setSessionId(null);
    }
  }, [txError, setSessionId]);

  const apiRows = txPage?.items ?? null;
  const apiTotal = txPage?.total ?? 0;
  const apiTotalAmount = txPage?.total_amount ?? 0;
  const apiEnvironments = dashSummary?.environments ?? [];
  const apiEnvironmentMap = dashSummary?.environment_map ?? [];

  // Cascading filter helpers (API mode)
  const apiBanks = useMemo(() => {
    if (!dashSummary) return [];
    if (envFilter !== "all") {
      const envEntry = apiEnvironmentMap.find((e) => e.environment === envFilter);
      return envEntry ? envEntry.banks : [];
    }
    return dashSummary.banks.map((b) => b.bank);
  }, [dashSummary, envFilter, apiEnvironmentMap]);

  const apiTouchpoints = useMemo(() => {
    if (!dashSummary) return [];
    if (bankFilter !== "all") {
      if (envFilter !== "all") {
        const envEntry = apiEnvironmentMap.find((e) => e.environment === envFilter);
        return envEntry?.touchpoints_by_bank[bankFilter] ?? [];
      }
      // bank selected but no env: collect touchpoints across all envs for this bank
      const tpSet = new Set<string>();
      for (const e of apiEnvironmentMap) {
        for (const tp of (e.touchpoints_by_bank[bankFilter] ?? [])) tpSet.add(tp);
      }
      return tpSet.size > 0 ? Array.from(tpSet).sort() : dashSummary.touchpoints.map((t) => t.touchpoint);
    }
    if (envFilter !== "all") {
      const envEntry = apiEnvironmentMap.find((e) => e.environment === envFilter);
      if (envEntry) {
        const tpSet = new Set<string>();
        for (const tps of Object.values(envEntry.touchpoints_by_bank)) tps.forEach((tp) => tpSet.add(tp));
        return Array.from(tpSet).sort();
      }
    }
    return dashSummary.touchpoints.map((t) => t.touchpoint);
  }, [dashSummary, envFilter, bankFilter, apiEnvironmentMap]);

  const apiDates = dashSummary?.dates ?? [];

  // In-memory fallback (used when sessionId is null)
  const inMemoryEnvironments = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.payments.map((p) => p.environment).filter(Boolean) as string[])].sort();
  }, [data]);

  const inMemoryBanks = useMemo(() => {
    if (!data) return [];
    const payments = envFilter !== "all"
      ? data.payments.filter((p) => (p.environment ?? "") === envFilter)
      : data.payments;
    return [...new Set(payments.map((p) => p.bank))].sort();
  }, [data, envFilter]);

  const inMemoryTouchpoints = useMemo(() => {
    if (!data) return [];
    const payments = data.payments.filter((p) => {
      if (envFilter !== "all" && (p.environment ?? "") !== envFilter) return false;
      if (bankFilter !== "all" && p.bank !== bankFilter) return false;
      return true;
    });
    return [...new Set(payments.map((p) => p.touchpoint))].sort();
  }, [data, envFilter, bankFilter]);

  const inMemoryDates = useMemo(() => {
    if (!data) return [];
    return [...new Set(data.payments.map((p) => p.paymentDate).filter(Boolean))].sort();
  }, [data]);

  const inMemoryFiltered = useMemo(() => {
    if (sessionId || !data) return [];
    const dateFiltered = filterByDateRange(data.payments, dateRange, (p) => p.paymentDate, customRange);
    return dateFiltered.filter((p) => {
      if (bankFilter !== "all" && p.bank !== bankFilter) return false;
      if (tpFilter !== "all" && p.touchpoint !== tpFilter) return false;
      if (dateFilter !== "all" && p.paymentDate !== dateFilter) return false;
      if (envFilter !== "all" && (p.environment ?? "") !== envFilter) return false;
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        return (
          p.bank.toLowerCase().includes(q) ||
          p.account.toLowerCase().includes(q) ||
          p.touchpoint.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [data, sessionId, bankFilter, tpFilter, dateFilter, envFilter, debouncedSearch, dateRange, customRange]);

  const inMemoryFilteredTotal = useMemo(
    () => inMemoryFiltered.reduce((s, p) => s + Math.round(p.paymentAmount * 100), 0) / 100,
    [inMemoryFiltered]
  );

  const inMemoryTotalPages = Math.max(1, Math.ceil(inMemoryFiltered.length / rowsPerPage));
  const inMemoryPaginatedRows = useMemo(() => {
    const start = (currentPage - 1) * rowsPerPage;
    return inMemoryFiltered.slice(start, start + rowsPerPage);
  }, [inMemoryFiltered, currentPage]);

  // Derived display values (switches between API and in-memory)
  const usingApi = !!sessionId;
  const displayBanks = usingApi ? apiBanks : inMemoryBanks;
  const displayTouchpoints = usingApi ? apiTouchpoints : inMemoryTouchpoints;
  const displayDates = usingApi ? apiDates : inMemoryDates;
  const displayEnvironments = usingApi ? apiEnvironments : inMemoryEnvironments;
  const displayRows = usingApi
    ? (apiRows ?? []).map((r) => ({
        bank: r.bank,
        paymentDate: r.payment_date ?? "",
        paymentAmount: r.payment_amount,
        account: r.account,
        touchpoint: r.touchpoint ?? "",
        environment: r.environment ?? "",
      }))
    : inMemoryPaginatedRows.map((p) => ({
        bank: p.bank,
        paymentDate: p.paymentDate,
        paymentAmount: p.paymentAmount,
        account: p.account,
        touchpoint: p.touchpoint,
        environment: p.environment ?? "",
      }));
  const displayTotal = usingApi ? apiTotal : inMemoryFiltered.length;
  const displayTotalAmount = usingApi ? apiTotalAmount : inMemoryFilteredTotal;
  const displayTotalPages = usingApi ? Math.max(1, Math.ceil(apiTotal / rowsPerPage)) : inMemoryTotalPages;

  // Reset to page 1 when filters change
  const resetPage = () => setCurrentPage(1);

  const handleExportCSV = async () => {
    // If there's a backend session, use the server-side streaming endpoint (safe for any size)
    if (token && sessionId) {
      try {
        await downloadAllRecordsCSV(token, sessionId, fileName || "transactions");
        toast.success("CSV download started.");
      } catch (err) {
        toast.error(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
      return;
    }
    // Fallback: in-memory export (local files with no session)
    const rows = inMemoryFiltered.map((p) => [p.bank, p.paymentDate, p.paymentAmount.toFixed(2), p.account, p.touchpoint, p.environment ?? ""]);
    const escapeField = (f: string | number | null | undefined) => {
      const s = String(f ?? "");
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [
      ["Bank", "Payment Date", "Payment Amount", "Account", "Touchpoint", "Environment"],
      ...rows,
    ]
      .map((row) => row.map(escapeField).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transactions.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportXLSX = async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Transactions");
    sheet.columns = [
      { header: "Bank", key: "bank" },
      { header: "Payment Date", key: "paymentDate" },
      { header: "Payment Amount", key: "paymentAmount" },
      { header: "Account", key: "account" },
      { header: "Touchpoint", key: "touchpoint" },
      { header: "Environment", key: "environment" },
    ];
    const rows = usingApi
      ? (apiRows ?? []).map((r) => ({ bank: r.bank, paymentDate: r.payment_date, paymentAmount: r.payment_amount, account: r.account, touchpoint: r.touchpoint, environment: r.environment ?? "" }))
      : inMemoryFiltered.map((p) => ({ bank: p.bank, paymentDate: p.paymentDate, paymentAmount: p.paymentAmount, account: p.account, touchpoint: p.touchpoint, environment: p.environment ?? "" }));
    sheet.addRows(rows);
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "transactions.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── CRUD helpers (in-memory mode only) ──
  const [showAddForm, setShowAddForm] = useState(false);
  const [isCrudSubmitting, setIsCrudSubmitting] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editingDisplayIndex, setEditingDisplayIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState({ bank: "", paymentDate: "", paymentAmount: "", account: "", touchpoint: "", environment: "" });
  const [addForm, setAddForm] = useState({ bank: "", paymentDate: "", paymentAmount: "", account: "", touchpoint: "", environment: "" });
  const [exportOpen, setExportOpen] = useState(false);

  // Mass delete state
  const [showMassDelete, setShowMassDelete] = useState(false);
  const [massDeleteFrom, setMassDeleteFrom] = useState("");
  const [massDeleteTo, setMassDeleteTo] = useState("");
  const [massDeleteConfirmStep, setMassDeleteConfirmStep] = useState(false);
  const [massDeleting, setMassDeleting] = useState(false);

  const recalcParsedData = useCallback((payments: PaymentRecord[]): ParsedData => {
    const bankMap = new Map<string, { count: Set<string>; amount: number; paymentCount: number }>();
    const tpMap = new Map<string, { count: number; amount: number }>();
    const accountSet = new Set<string>();
    let totalAmount = 0;
    for (const p of payments) {
      totalAmount += p.paymentAmount;
      accountSet.add(p.account);
      const bk = bankMap.get(p.bank) ?? { count: new Set<string>(), amount: 0, paymentCount: 0 };
      bk.count.add(p.account);
      bk.amount += p.paymentAmount;
      bk.paymentCount += 1;
      bankMap.set(p.bank, bk);
      const tp = tpMap.get(p.touchpoint) ?? { count: 0, amount: 0 };
      tp.count += 1;
      tp.amount += p.paymentAmount;
      tpMap.set(p.touchpoint, tp);
    }
    const bankAnalytics = Array.from(bankMap.entries()).map(([bank, v]) => ({
      bank,
      accountCount: v.count.size,
      totalAmount: v.amount,
      debtorSum: 0,
      percentage: totalAmount > 0 ? (v.amount / totalAmount) * 100 : 0,
      paymentCount: v.paymentCount,
    }));
    const touchpointAnalytics = Array.from(tpMap.entries()).map(([touchpoint, v]) => ({
      touchpoint,
      count: v.count,
      totalAmount: v.amount,
      percentage: totalAmount > 0 ? (v.amount / totalAmount) * 100 : 0,
    }));
    return {
      payments,
      bankAnalytics,
      touchpointAnalytics,
      totalAccounts: accountSet.size,
      totalAmount,
      totalPayments: payments.length,
      raw: payments.map((p) => ({ Bank: p.bank, "Payment Date": p.paymentDate, "Payment Amount": p.paymentAmount, Account: p.account, Touchpoint: p.touchpoint })),
    };
  }, []);

  /** Re-fetch session data from backend and update DataContext so all pages see the change */
  const refreshSessionData = useCallback(async () => {
    if (!token || !sessionId) return;
    try {
      const detail = await getUpload(token, sessionId);
      const payments = detail.records.map((r) => ({
        bank: r.bank,
        paymentDate: r.payment_date ?? "",
        paymentAmount: r.payment_amount,
        account: r.account,
        touchpoint: r.touchpoint ?? "",
        environment: r.environment,
        month: r.month,
      }));
      setData(recalcParsedData(payments));
    } catch {
      // Silently fail — the TanStack Query cache will still be fresh
    }
  }, [token, sessionId, setData, recalcParsedData]);

  const handleAddTransaction = async () => {
    if (isCrudSubmitting) return;
    const amount = parseFloat(addForm.paymentAmount);
    if (!addForm.bank || !addForm.paymentDate || isNaN(amount) || amount < 0 || !addForm.account || !addForm.touchpoint) {
      toast.error("Please fill in all fields with valid values. Amount cannot be negative.");
      return;
    }

    setIsCrudSubmitting(true);
    if (usingApi && token && sessionId) {
      try {
        await createTransaction(token, sessionId, {
          bank: addForm.bank.toUpperCase(),
          account: addForm.account,
          payment_amount: amount,
          touchpoint: addForm.touchpoint.toUpperCase(),
          payment_date: addForm.paymentDate,
          environment: addForm.environment || undefined,
        });
        queryClient.invalidateQueries({ queryKey: ["transactions"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        setAddForm({ bank: "", paymentDate: "", paymentAmount: "", account: "", touchpoint: "", environment: "" });
        setShowAddForm(false);
        toast.success("Transaction added.");
      } catch {
        toast.error("Failed to add transaction.");
      } finally {
        setIsCrudSubmitting(false);
      }
      return;
    }

    if (!data) { setIsCrudSubmitting(false); return; }
    const newRecord: PaymentRecord = {
      bank: addForm.bank.toUpperCase(),
      paymentDate: addForm.paymentDate,
      paymentAmount: amount,
      account: addForm.account,
      touchpoint: addForm.touchpoint.toUpperCase(),
      environment: addForm.environment || undefined,
    };
    const newPayments = [newRecord, ...data.payments];
    setData(recalcParsedData(newPayments));
    setAddForm({ bank: "", paymentDate: "", paymentAmount: "", account: "", touchpoint: "", environment: "" });
    setShowAddForm(false);
    setIsCrudSubmitting(false);
    toast.success("Transaction added.");
  };

  const handleStartEdit = (globalIdx: number, displayIdx: number, displayRow?: { bank: string; paymentDate: string; paymentAmount: number; account: string; touchpoint: string; environment?: string }) => {
    if (!data && !displayRow) return;
    const p = displayRow ?? (globalIdx >= 0 ? data?.payments[globalIdx] : undefined);
    if (!p) return;
    setEditingIndex(globalIdx);
    setEditingDisplayIndex(displayIdx);
    setEditForm({
      bank: p.bank,
      paymentDate: p.paymentDate,
      paymentAmount: String(p.paymentAmount),
      account: p.account,
      touchpoint: p.touchpoint,
      environment: ('environment' in p ? (p as { environment?: string }).environment : undefined) || "",
    });
  };

  const handleSaveEdit = async () => {
    if (editingIndex === null || isCrudSubmitting) return;
    const amount = parseFloat(editForm.paymentAmount);
    if (!editForm.bank || !editForm.paymentDate || isNaN(amount) || amount < 0 || !editForm.account || !editForm.touchpoint) {
      toast.error("Please fill in all fields with valid values. Amount cannot be negative.");
      return;
    }

    setIsCrudSubmitting(true);
    if (usingApi && token && sessionId && apiRows) {
      const row = editingDisplayIndex !== null ? apiRows[editingDisplayIndex] : null;
      if (!row) { toast.error("Could not find record to update."); return; }
      try {
        await updateTransaction(token, sessionId, row.id, {
          bank: editForm.bank.toUpperCase(),
          account: editForm.account,
          payment_amount: amount,
          touchpoint: editForm.touchpoint.toUpperCase(),
          payment_date: editForm.paymentDate,
          environment: editForm.environment || undefined,
        });
        queryClient.invalidateQueries({ queryKey: ["transactions"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        setEditingIndex(null);
        setEditingDisplayIndex(null);
        toast.success("Transaction updated.");
      } catch {
        toast.error("Failed to update transaction.");
      } finally {
        setIsCrudSubmitting(false);
      }
      return;
    }

    if (!data) { setIsCrudSubmitting(false); return; }
    const newPayments = [...data.payments];
    newPayments[editingIndex] = {
      bank: editForm.bank.toUpperCase(),
      paymentDate: editForm.paymentDate,
      paymentAmount: amount,
      account: editForm.account,
      touchpoint: editForm.touchpoint.toUpperCase(),
      environment: editForm.environment || undefined,
    };
    setData(recalcParsedData(newPayments));
    setEditingIndex(null);
    setEditingDisplayIndex(null);
    setIsCrudSubmitting(false);
    toast.success("Transaction updated.");
  };

  const handleCancelEdit = () => { setEditingIndex(null); setEditingDisplayIndex(null); };

  const handleDelete = async (globalIdx: number, displayIdx: number) => {
    if (usingApi && token && sessionId && apiRows) {
      const row = apiRows[displayIdx];
      if (!row) return;
      try {
        await deleteTransaction(token, sessionId, row.id);
        queryClient.invalidateQueries({ queryKey: ["transactions"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });

        // If this was the last record, remove the session entirely
        if (displayTotal <= 1) {
          await deleteUpload(token, sessionId);
          setSessionId(null);
          setData(null);
          queryClient.invalidateQueries({ queryKey: ["uploads"] });
          toast.success("Last transaction deleted. Upload session removed.");
        } else {
          await refreshSessionData();
          toast.success("Transaction deleted.");
        }
      } catch {
        toast.error("Failed to delete transaction.");
      }
      return;
    }
    if (!data) return;
    const newPayments = data.payments.filter((_, i) => i !== globalIdx);
    setData(recalcParsedData(newPayments));
    toast.success("Transaction deleted.");
  };

  // Mass delete: count of records in selected date range
  const massDeleteCount = useMemo(() => {
    if (!data || !massDeleteFrom || !massDeleteTo) return 0;
    return data.payments.filter((p) => {
      const d = p.paymentDate;
      return d >= massDeleteFrom && d <= massDeleteTo;
    }).length;
  }, [data, massDeleteFrom, massDeleteTo]);

  const handleMassDelete = async () => {
    if (!massDeleteFrom || !massDeleteTo) return;

    if (usingApi && token && sessionId) {
      // API mode: delete from backend
      setMassDeleting(true);
      try {
        const result = await deleteTransactionsByDateRange(token, sessionId, massDeleteFrom, massDeleteTo);
        queryClient.invalidateQueries({ queryKey: ["transactions"] });
        queryClient.invalidateQueries({ queryKey: ["dashboard"] });
        queryClient.invalidateQueries({ queryKey: ["uploads"] });

        // Check if all records were deleted — if so, remove the session entirely
        const remaining = displayTotal - result.deleted;
        if (remaining <= 0) {
          await deleteUpload(token, sessionId);
          setSessionId(null);
          setData(null);
          queryClient.invalidateQueries({ queryKey: ["uploads"] });
          closeMassDelete();
          toast.success(`Deleted all ${fmt(result.deleted)} transactions. Upload session removed.`);
        } else {
          await refreshSessionData();
          closeMassDelete();
          toast.success(`Deleted ${fmt(result.deleted)} transactions.`);
        }
      } catch {
        toast.error("Failed to delete transactions.");
      } finally {
        setMassDeleting(false);
      }
      return;
    }

    if (!data) return;
    const newPayments = data.payments.filter((p) => {
      const d = p.paymentDate;
      return !(d >= massDeleteFrom && d <= massDeleteTo);
    });
    const deleted = data.payments.length - newPayments.length;
    setData(recalcParsedData(newPayments));
    closeMassDelete();
    toast.success(`Deleted ${fmt(deleted)} transactions.`);
  };

  const closeMassDelete = () => {
    setShowMassDelete(false);
    setMassDeleteConfirmStep(false);
    setMassDeleteFrom("");
    setMassDeleteTo("");
    setMassDeleting(false);
  };

  // Map display row index back to global index in data.payments
  const getGlobalIndex = (rowIdx: number): number => {
    if (!data) return -1;
    if (usingApi) {
      // Match by all fields for API rows
      const r = displayRows[rowIdx];
      return data.payments.findIndex(
        (p) => p.bank === r.bank && p.paymentDate === r.paymentDate && p.paymentAmount === r.paymentAmount && p.account === r.account && p.touchpoint === r.touchpoint
      );
    }
    const pageOffset = (currentPage - 1) * rowsPerPage;
    const item = inMemoryFiltered[pageOffset + rowIdx];
    return data.payments.indexOf(item);
  };

  if (!data && !sessionId) {
    return (
      <div className="px-4 sm:px-8 py-8 min-h-screen">
        <div className="p-12 rounded-lg text-center bg-card border border-border">
          <h2 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">
            No Data Available
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Please upload an Excel file to view transactions
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-8 py-8 min-h-screen">
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
          <div>
            <h1 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">
              Transactions
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              {fmt(displayTotal)} records &middot; ₱{fmt(displayTotalAmount)} total
            </p>
          </div>
          <div className="flex items-center gap-2 self-start sm:self-auto">
            <Popover open={exportOpen} onOpenChange={setExportOpen}>
              <PopoverTrigger asChild>
                <Button className="bg-[#4a55d1] hover:bg-[#4048c0] text-white">
                  <Download className="w-4 h-4 mr-1" />
                  Export
                  <ChevronDown className="w-3 h-3 ml-1" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-36 p-1" align="end">
                <button
                  onClick={() => { handleExportCSV(); setExportOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200"
                >
                  Export as CSV
                </button>
                <button
                  onClick={() => { handleExportXLSX(); setExportOpen(false); }}
                  className="w-full text-left px-3 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200"
                >
                  Export as XLSX
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Date Filter — only shown for in-memory mode */}
        {!usingApi && (
          <div className="mb-4">
            <DateFilter
              value={dateRange}
              onChange={(r, c) => { setDateRange(r); setCustomRange(c); resetPage(); }}
              customRange={customRange}
            />
          </div>
        )}

        <div className="mb-4 rounded-lg border border-[#5B66E2]/30 bg-[#5B66E2]/8 px-4 py-3 text-sm text-gray-700 dark:text-gray-200">
          Transactions is view-only now. For create, edit, and delete actions, use
          <Link href="/sheets" className="ml-1 font-semibold text-[#4a55d1] hover:underline">
            Sheets
          </Link>
          .
        </div>



        {/* Filters */}
        <div className="p-4 rounded-lg bg-card border border-border mb-4 animate-fade-in-up" style={{ animationDelay: '0.1s' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="relative sm:col-span-2 lg:col-span-1">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
              <input
                type="text"
                placeholder="Search bank, account, touchpoint..."
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); }}
                className="w-full pl-10 pr-8 py-2 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#5B66E2] text-sm"
              />
              {(isSearchPending || (apiLoading && !!searchQuery)) && (
                <span className="absolute right-3 top-1/2 -translate-y-1/2">
                  <svg className="h-4 w-4 animate-spin text-[#5B66E2]" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                </span>
              )}
            </div>

            {/* Environment filter — first, drives bank list */}
            <select
              value={envFilter}
              onChange={(e) => { setEnvFilter(e.target.value); setBankFilter("all"); setTpFilter("all"); resetPage(); }}
              className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#5B66E2] text-sm"
            >
              <option value="all">All Environments</option>
              {displayEnvironments.map((e) => (
                <option key={e} value={e}>{e}</option>
              ))}
            </select>

            {/* Bank (Campaign) filter — filtered by selected environment */}
            <select
              value={bankFilter}
              onChange={(e) => { setBankFilter(e.target.value); setTpFilter("all"); resetPage(); }}
              className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#5B66E2] text-sm"
            >
              <option value="all">All Banks</option>
              {displayBanks.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>

            {/* Touchpoint filter — filtered by selected environment + bank */}
            <select
              value={tpFilter}
              onChange={(e) => { setTpFilter(e.target.value); resetPage(); }}
              className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#5B66E2] text-sm"
            >
              <option value="all">All Touchpoints</option>
              {displayTouchpoints.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>

            <select
              value={dateFilter}
              onChange={(e) => { setDateFilter(e.target.value); resetPage(); }}
              className="px-3 py-2 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-[#5B66E2] text-sm"
            >
              <option value="all">All Dates</option>
              {displayDates.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Table */}
        <div className="rounded-lg border bg-card border-border overflow-x-auto animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
          <table className="w-full min-w-[850px]">
            <thead className="bg-muted">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Bank
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Payment Date
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Amount
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Account
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Touchpoint
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                  Environment
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
              {displayRows.map((p, i) => {
                return (
                <tr
                  key={`${currentPage}-${i}`}
                  className="hover:bg-[#5B66E2]/5 dark:hover:bg-[#5B66E2]/10 transition-colors duration-200"
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white whitespace-nowrap">
                    {p.bank}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {p.paymentDate}
                  </td>
                  <td className="px-4 py-3 text-sm text-right font-medium text-green-600 dark:text-green-400 whitespace-nowrap">
                    {`₱${fmt(p.paymentAmount)}`}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {p.account}
                  </td>
                  <td className="px-4 py-3 text-sm whitespace-nowrap">
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[#5B66E2]/10 text-[#5B66E2] dark:bg-[#5B66E2]/20 dark:text-[#8B96F2]">
                      {p.touchpoint}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap">
                    {p.environment || "—"}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          {/* Pagination Controls */}
          <div className="px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-700">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              Showing {fmt((currentPage - 1) * rowsPerPage + 1)}&ndash;{fmt(Math.min(currentPage * rowsPerPage, displayTotal))} of {fmt(displayTotal)} records
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="px-2.5 py-1.5 text-sm font-medium rounded-md border bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-800 dark:text-gray-100 hover:bg-[#5B66E2]/5 hover:border-[#5B66E2] hover:text-[#5B66E2] dark:hover:bg-[#5B66E2]/20 dark:hover:border-[#5B66E2] dark:hover:text-[#8B96F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                First
              </button>
              <button
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-2.5 py-1.5 text-sm font-medium rounded-md border bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-800 dark:text-gray-100 hover:bg-[#5B66E2]/5 hover:border-[#5B66E2] hover:text-[#5B66E2] dark:hover:bg-[#5B66E2]/20 dark:hover:border-[#5B66E2] dark:hover:text-[#8B96F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Prev
              </button>

              {/* Page number buttons */}
              {(() => {
                const pages: number[] = [];
                let start = Math.max(1, currentPage - 2);
                const end = Math.min(displayTotalPages, start + 4);
                start = Math.max(1, end - 4);
                for (let i = start; i <= end; i++) pages.push(i);
                return pages.map((pg) => (
                  <button
                    key={pg}
                    onClick={() => setCurrentPage(pg)}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                      pg === currentPage
                        ? "bg-[#4a55d1] text-white border-[#4a55d1] shadow-sm"
                        : "bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-800 dark:text-gray-100 hover:bg-[#5B66E2]/5 hover:border-[#5B66E2] hover:text-[#5B66E2] dark:hover:bg-[#5B66E2]/20 dark:hover:border-[#5B66E2] dark:hover:text-[#8B96F2]"
                    }`}
                  >
                    {pg}
                  </button>
                ));
              })()}

              <button
                onClick={() => setCurrentPage((p) => Math.min(displayTotalPages, p + 1))}
                disabled={currentPage === displayTotalPages}
                className="px-2.5 py-1.5 text-sm font-medium rounded-md border bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-800 dark:text-gray-100 hover:bg-[#5B66E2]/5 hover:border-[#5B66E2] hover:text-[#5B66E2] dark:hover:bg-[#5B66E2]/20 dark:hover:border-[#5B66E2] dark:hover:text-[#8B96F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
              <button
                onClick={() => setCurrentPage(displayTotalPages)}
                disabled={currentPage === displayTotalPages}
                className="px-2.5 py-1.5 text-sm font-medium rounded-md border bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-800 dark:text-gray-100 hover:bg-[#5B66E2]/5 hover:border-[#5B66E2] hover:text-[#5B66E2] dark:hover:bg-[#5B66E2]/20 dark:hover:border-[#5B66E2] dark:hover:text-[#8B96F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                Last
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
