"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { Users, DollarSign, FileText, Info, Search } from "lucide-react";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { DynamicChart } from "@/components/DynamicChart";
import { DateFilter, DateRange, CustomDateRange, filterByDateRange, dateRangeToBounds } from "@/components/DateFilter";
import { useAccountsSummary } from "@/lib/queries";
import type { PaymentRecord } from "@/types/data";

function fmt(n: number): string {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const PAGE_SIZE = 25;

export default function AccountsPage() {
  const { data, sessionId, sessionValidated } = useData();
  const { token } = useAuth();
  const [currentPage, setCurrentPage] = useState(1);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [customRange, setCustomRange] = useState<CustomDateRange | undefined>(undefined);

  // Debounce search: wait 400 ms after the user stops typing
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

  // Server-side path: sessionId is set → always use server-side pagination
  const useApiPath = !!sessionId;
  const dateBounds = dateRangeToBounds(dateRange, customRange);
  const { data: accountsSummary, isLoading: summaryLoading } = useAccountsSummary(
    token,
    useApiPath ? sessionId : null,
    sessionValidated,
    {
      search: debouncedSearch?.trim() || undefined,
      date_from: dateBounds.date_from,
      date_to: dateBounds.date_to,
      page: currentPage,
      page_size: PAGE_SIZE,
    }
  );

  // In-memory fallback (when no sessionId — data loaded from localStorage)
  const inMemoryPayments: PaymentRecord[] = useMemo(() => {
    if (!data || useApiPath) return [];
    return filterByDateRange(data.payments, dateRange, (p) => p.paymentDate, customRange);
  }, [data, useApiPath, dateRange, customRange]);

  const inMemoryAccountData = useMemo(() => {
    if (useApiPath || inMemoryPayments.length === 0) return [];
    const q = debouncedSearch.toLowerCase();
    const filtered = q
      ? inMemoryPayments.filter((p) => p.account.toLowerCase().includes(q))
      : inMemoryPayments;
    const map = new Map<string, { totalAmount: number; paymentCount: number; banks: Set<string> }>();
    for (const p of filtered) {
      if (!map.has(p.account)) map.set(p.account, { totalAmount: 0, paymentCount: 0, banks: new Set() });
      const entry = map.get(p.account)!;
      entry.totalAmount += p.paymentAmount;
      entry.paymentCount++;
      entry.banks.add(p.bank);
    }
    return Array.from(map.entries())
      .map(([account, d]) => ({
        account,
        totalAmount: d.totalAmount,
        paymentCount: d.paymentCount,
        bankCount: d.banks.size,
        banks: [...d.banks].join(", "),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);
  }, [useApiPath, inMemoryPayments, debouncedSearch]);

  // Unified display values
  const pageRows = useApiPath
    ? (accountsSummary?.accounts ?? []).map((a) => ({
        account: a.account,
        totalAmount: a.total_amount,
        paymentCount: a.payment_count,
        bankCount: a.bank_count,
        banks: a.banks,
      }))
    : inMemoryAccountData.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const totalAccounts = useApiPath
    ? (accountsSummary?.total_accounts ?? 0)
    : inMemoryAccountData.length;

  const totalPages = Math.max(1, Math.ceil(totalAccounts / PAGE_SIZE));
  const start = (currentPage - 1) * PAGE_SIZE;

  // If the current page is beyond the new total (e.g. search narrowed results),
  // snap back to the last valid page.
  useEffect(() => {
    if (currentPage > totalPages) setCurrentPage(totalPages);
  }, [totalPages, currentPage]);

  const isLoading = useApiPath ? summaryLoading : false;

  // KPI metrics — computed over the full dataset (no page filter)
  const allApiAccounts = accountsSummary?.accounts ?? [];
  const avgPayments = allApiAccounts.length > 0
    ? allApiAccounts.reduce((s, a) => s + a.payment_count, 0) / allApiAccounts.length
    : (inMemoryAccountData.length > 0 ? inMemoryAccountData.reduce((s, a) => s + a.paymentCount, 0) / inMemoryAccountData.length : 0);
  const avgAmount = allApiAccounts.length > 0
    ? allApiAccounts.reduce((s, a) => s + a.total_amount, 0) / allApiAccounts.length
    : (inMemoryAccountData.length > 0 ? inMemoryAccountData.reduce((s, a) => s + a.totalAmount, 0) / inMemoryAccountData.length : 0);

  if (!data && !accountsSummary && isLoading) {
    return (
      <div className="px-4 sm:px-8 py-8 min-h-screen">
        <div className="p-12 rounded-lg text-center bg-card border border-border">
          <p className="text-gray-600 dark:text-gray-400">Loading account data…</p>
        </div>
      </div>
    );
  }

  if (!data && !accountsSummary && !isLoading) {
    return (
      <div className="px-4 sm:px-8 py-8 min-h-screen">
        <div className="p-12 rounded-lg text-center bg-card border border-border">
          <h2 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">
            No Data Available
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            {sessionId
              ? "Restoring session data — please wait or go to Upload History to reload."
              : "Please upload an Excel file to view account data"}
          </p>
        </div>
      </div>
    );
  }

  const metrics = [
    {
      label: "Total Accounts",
      value: fmt(data?.totalAccounts ?? accountsSummary?.total_accounts ?? totalAccounts),
      icon: Users,
      iconBg: "bg-[#4a55d1]",
      info: "Unique accounts in dataset",
    },
    {
      label: "Avg Payments / Account",
      value: avgPayments.toFixed(2),
      icon: FileText,
      iconBg: "bg-[#5B66E2]",
      info: "Average payment count per account",
    },
    {
      label: "Avg Amount / Account",
      value: `₱${fmt(Math.round(avgAmount))}`,
      icon: DollarSign,
      iconBg: "bg-[#5B66E2]",
      info: "Average payment amount per account",
    },
  ];

  const chartData = pageRows.slice(0, 10).map((a) => ({ account: a.account, amount: a.totalAmount }));

  const pageNums: number[] = [];
  let ps = Math.max(1, currentPage - 2);
  const pe = Math.min(totalPages, ps + 4);
  ps = Math.max(1, pe - 4);
  for (let i = ps; i <= pe; i++) pageNums.push(i);

  const btnClass = "px-2.5 py-1.5 text-sm font-medium rounded-md border bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-800 dark:text-gray-100 hover:bg-[#5B66E2]/5 hover:border-[#5B66E2] hover:text-[#5B66E2] dark:hover:bg-[#5B66E2]/20 dark:hover:border-[#5B66E2] dark:hover:text-[#8B96F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors";

  return (
    <div className="px-4 sm:px-8 py-8 min-h-screen">
      <div className="mb-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">
              Accounts
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Debtor account analytics
            </p>
          </div>
          <DateFilter
            value={dateRange}
            onChange={(r, c) => { setDateRange(r); setCustomRange(c); setCurrentPage(1); }}
            customRange={customRange}
          />
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8 stagger-children">
        {metrics.map((m, idx) => {
          const Icon = m.icon;
          return (
            <Card
              key={idx}
              className="flex-1 overflow-hidden bg-card border-border gap-0 hover:shadow-lg hover:scale-[1.02] transition-all duration-300 cursor-default"
            >
              <div className="h-1 bg-[#5B66E2]" />
              <div className="flex flex-col h-[calc(100%-4px)] px-5 pt-3 pb-4 gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                    {m.label}:
                  </span>
                  <div className={`p-2 mt-1 mr-0.5 ${m.iconBg} rounded-lg`}>
                    <Icon className="w-6 h-6 text-white" />
                  </div>
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <span className="inline-block px-6 py-2 rounded-full border border-gray-300 dark:border-gray-600 text-lg font-bold text-gray-900 dark:text-white">
                    {m.value}
                  </span>
                </div>
                <div className="border-t border-gray-200 dark:border-gray-700 pt-2 flex items-center justify-between">
                  <span className="text-xs text-gray-400 dark:text-gray-500">{m.info}</span>
                  <Info className="w-3.5 h-3.5 text-gray-400 dark:text-gray-500" />
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {/* Top 10 Accounts Chart */}
      <div className="mb-8 animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
        <Card className="p-6 bg-card border-border">
          <h3 className="text-base font-semibold text-gray-900 dark:text-white mb-1">Top 10 Accounts by Amount</h3>
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">Top 10 debtor accounts ranked by total payment amount collected</p>
          <DynamicChart
            data={chartData}
            type="bar"
            dataKey="amount"
            xAxisKey="account"
            height={350}
          />
        </Card>
      </div>

      {/* Account Details Table */}
      <div className="rounded-lg border bg-card border-border overflow-x-auto">
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Account Details
          </h3>
          <div className="relative w-full sm:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <Input
              placeholder="Search accounts…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-sm"
            />
          </div>
        </div>
        <table className="w-full min-w-[600px]">
          <thead className="bg-muted">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Account
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Total Amount
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Payments
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">
                Banks
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  Loading…
                </td>
              </tr>
            ) : pageRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-500 dark:text-gray-400">
                  No accounts found.
                </td>
              </tr>
            ) : (
              pageRows.map((a) => (
                <tr
                  key={a.account}
                  className="hover:bg-[#5B66E2]/5 dark:hover:bg-[#5B66E2]/10 transition-colors duration-200"
                >
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">
                    {a.account}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-green-600 dark:text-green-400 font-medium">
                    ₱{fmt(a.totalAmount)}
                  </td>
                  <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">
                    {fmt(a.paymentCount)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300 max-w-[300px] truncate">
                    {a.banks}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <div className="px-4 py-3 flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-gray-200 dark:border-gray-700">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            Showing {totalAccounts === 0 ? 0 : fmt(start + 1)}&ndash;{fmt(Math.min(start + PAGE_SIZE, totalAccounts))} of {fmt(totalAccounts)} accounts
          </p>
          <div className="flex items-center gap-1">
            <button onClick={() => setCurrentPage(1)} disabled={currentPage === 1} className={btnClass}>First</button>
            <button onClick={() => setCurrentPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className={btnClass}>Prev</button>
            {pageNums.map((pg) => (
              <button
                key={pg}
                onClick={() => setCurrentPage(pg)}
                className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${
                  pg === currentPage
                    ? "bg-[#4a55d1] text-white border-[#4a55d1] shadow-sm"
                    : btnClass
                }`}
              >
                {pg}
              </button>
            ))}
            <button onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className={btnClass}>Next</button>
            <button onClick={() => setCurrentPage(totalPages)} disabled={currentPage === totalPages} className={btnClass}>Last</button>
          </div>
        </div>
      </div>
    </div>
  );
}
