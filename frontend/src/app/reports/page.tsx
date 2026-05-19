"use client";

import { useMemo, useState } from "react";
import {
  Download,
  FileSpreadsheet,
  BarChart3,
  ChevronDown,
  FileJson,
  FileText,
  Settings2,
  Check,
  DollarSign,
  Hash,
  Landmark,
} from "lucide-react";
import { Card } from "@/components/ui/card";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { exportToExcel, exportToCSV, exportToJSON, EXPORT_FIELDS, type ExportOptions } from "@/utils/exportUtils";
import { exportAllRecords } from "@/lib/api";
import { useDashboard } from "@/lib/queries";
import { toast } from "sonner";
import type { DataRow } from "@/types/data";

function fmt(n: number): string {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function ReportsPage() {
  const { data, rawData, sessionId, fileName, sessionValidated } = useData();
  const { token } = useAuth();
  const { data: apiSummary } = useDashboard(token, sessionId, sessionValidated);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [bankPage, setBankPage] = useState(1);
  const [bankRowsPerPage, setBankRowsPerPage] = useState(15);

  // Export field selection
  const [selectedFields, setSelectedFields] = useState<Set<string>>(
    new Set(EXPORT_FIELDS.filter((f) => f.default).map((f) => f.key))
  );
  const [includeSummary, setIncludeSummary] = useState(true);
  const [formatCurrency, setFormatCurrency] = useState(true);

  const toggleField = (key: string) => {
    setSelectedFields((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        if (next.size > 1) next.delete(key); // keep at least 1
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const reportData = useMemo(() => {
    if (!data) return [];
    return data.payments.map((p) => ({
      Bank: p.bank,
      "Payment Date": p.paymentDate,
      "Payment Amount": p.paymentAmount,
      Account: p.account,
      Touchpoint: p.touchpoint,
    }));
  }, [data]);

  // Fetch ALL records from backend for export.
  // Uses the streaming CSV endpoint for CSV format (safe for any size),
  // and the JSON export endpoint for Excel/JSON (capped at 500k records).
  const fetchAllForExport = async (): Promise<{ Bank: string; "Payment Date": string; "Payment Amount": number; Account: string; Touchpoint: string }[]> => {
    if (!token || !sessionId) return reportData;
    const allItems = await exportAllRecords(token, sessionId);
    return allItems.map((r) => ({
      Bank: r.bank,
      "Payment Date": r.payment_date ?? "",
      "Payment Amount": r.payment_amount,
      Account: r.account,
      Touchpoint: r.touchpoint ?? "",
    }));
  };

  const handleExport = async (format: "excel" | "csv" | "json") => {
    setExporting(true);
    try {
      // For CSV with a backend session, use the server-side streaming endpoint —
      // it's memory-safe for any dataset size and bypasses the 500k record cap.
      if (format === "csv" && sessionId && token) {
        await import("@/lib/api").then(({ downloadAllRecordsCSV }) =>
          downloadAllRecordsCSV(token, sessionId, fileName || "payanalytics_report")
        );
        toast.success("CSV download started.");
        setExporting(false);
        return;
      }

      let exportData: DataRow[];
      if (sessionId && token) {
        toast.info("Fetching all records from server...");
        exportData = await fetchAllForExport();
      } else {
        exportData = reportData.length > 0 ? reportData : rawData;
      }

      if (exportData.length === 0) {
        toast.error("No data to export");
        return;
      }

      const exportFileName = `payanalytics_report_${new Date().toISOString().split("T")[0]}`;
      const exportOpts: ExportOptions = {
        fields: Array.from(selectedFields),
        includeSummary,
        formatCurrency,
        bankAnalytics: data?.bankAnalytics ?? apiSummary?.banks.map((b) => ({ bank: b.bank, totalAmount: b.total_amount, paymentCount: b.payment_count, accountCount: b.account_count, percentage: b.percentage, debtorSum: b.payment_count })),
        touchpointAnalytics: data?.touchpointAnalytics ?? apiSummary?.touchpoints.map((t) => ({ touchpoint: t.touchpoint, count: t.count, totalAmount: t.total_amount, percentage: t.percentage })),
        totalAmount: data?.totalAmount ?? apiSummary?.total_amount,
        dateRangeLabel: "All Data",
      };

      if (format === "excel") {
        await exportToExcel(exportData, exportFileName, exportOpts);
        toast.success(`Exported ${fmt(exportData.length)} records to Excel${includeSummary ? " with summary" : ""}`);
      } else if (format === "csv") {
        exportToCSV(exportData, exportFileName, exportOpts);
        toast.success(`Exported ${fmt(exportData.length)} records to CSV`);
      } else {
        exportToJSON(exportData, exportFileName, exportOpts);
        toast.success(`Exported ${fmt(exportData.length)} records to JSON`);
      }
    } catch {
      toast.error("Export failed");
    } finally {
      setExporting(false);
    }
  };

  if (!data && !sessionId) {
    return (
      <div className="px-4 sm:px-8 py-8 min-h-screen">
        <div className="p-12 rounded-lg text-center bg-card border border-border">
          <h2 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">
            No Data Available
          </h2>
          <p className="text-gray-600 dark:text-gray-400">
            Please upload an Excel file to generate reports
          </p>
        </div>
      </div>
    );
  }

  // Summary stats
  const totalRecords = data?.totalPayments ?? apiSummary?.total_payments ?? 0;
  const totalAmount = data?.totalAmount ?? apiSummary?.total_amount ?? 0;
  const bankCount = data?.bankAnalytics.length ?? apiSummary?.total_banks ?? 0;
  const reportBankAnalytics = data?.bankAnalytics ?? apiSummary?.banks.map((b) => ({
    bank: b.bank,
    accountCount: b.account_count,
    totalAmount: b.total_amount,
    debtorSum: b.payment_count,
    percentage: b.percentage,
    paymentCount: b.payment_count,
  })) ?? [];
  return (
    <div className="px-4 sm:px-8 py-8 min-h-screen">
      {/* Print-only header */}
      <div className="hidden print:block mb-4 border-b border-gray-300 pb-3">
        <h1 className="text-lg font-bold text-black">PayAnalytics — Financial Report</h1>
        {fileName && <p className="text-sm text-gray-600 mt-1">{fileName}</p>}
        <p className="text-xs text-gray-400 mt-0.5">{new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</p>
      </div>

      <div className="mb-6">
        <div className="print:hidden flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
          <div>
            <h1 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">
              Reports
            </h1>
            <p className="text-gray-600 dark:text-gray-400">
              Generate and export payment reports
            </p>
          </div>
          <div className="flex gap-2">
            <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" className="gap-2">
                  <Settings2 className="w-4 h-4" />
                  Export Settings
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-64 p-3">
                <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2 uppercase">Fields to Export</p>
                {EXPORT_FIELDS.map((f) => (
                  <label key={f.key} className="flex items-center gap-2 py-1 text-sm text-gray-700 dark:text-gray-200 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 rounded px-1">
                    <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${selectedFields.has(f.key) ? "bg-[#5B66E2] border-[#5B66E2]" : "border-gray-300 dark:border-gray-600"}`}>
                      {selectedFields.has(f.key) && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <input type="checkbox" checked={selectedFields.has(f.key)} onChange={() => toggleField(f.key)} className="sr-only" />
                    {f.label}
                  </label>
                ))}
                <hr className="my-2 border-gray-200 dark:border-gray-700" />
                <label className="flex items-center gap-2 py-1 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                  <input type="checkbox" checked={includeSummary} onChange={(e) => setIncludeSummary(e.target.checked)} className="rounded border-gray-300" />
                  Include summary sheet
                </label>
                <label className="flex items-center gap-2 py-1 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                  <input type="checkbox" checked={formatCurrency} onChange={(e) => setFormatCurrency(e.target.checked)} className="rounded border-gray-300" />
                  Format currency columns
                </label>
              </PopoverContent>
            </Popover>
            <Popover open={exportOpen} onOpenChange={setExportOpen}>
              <PopoverTrigger asChild>
                <Button
                  disabled={exporting}
                  className="bg-[#4a55d1] hover:bg-[#4048c0] text-white gap-2"
                >
                  <Download className="w-4 h-4" />
                  {exporting ? "Exporting..." : "Export"}
                  <ChevronDown className="w-4 h-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-52 p-1">
                <button
                  onClick={() => { setExportOpen(false); handleExport("excel"); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                >
                  <FileSpreadsheet className="w-4 h-4" />
                  Export as XLSX
                </button>
                <button
                  onClick={() => { setExportOpen(false); handleExport("csv"); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                >
                  <FileText className="w-4 h-4" />
                  Export as CSV
                </button>
                <button
                  onClick={() => { setExportOpen(false); handleExport("json"); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-sm rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200"
                >
                  <FileJson className="w-4 h-4" />
                  Export as JSON
                </button>
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6 animate-fade-in-up">
          <Card className="p-5 bg-card border-border hover:shadow-lg hover:scale-[1.01] transition-all duration-300 cursor-default">
            <div className="flex items-start justify-between mb-2">
              <div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white block">Total Records</span>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Total payment rows</p>
              </div>
              <div className="p-2 bg-[#5B66E2] rounded-lg flex-shrink-0"><Hash className="w-4 h-4 text-white" /></div>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white truncate">{fmt(totalRecords)}</div>
          </Card>
          <Card className="p-5 bg-card border-border hover:shadow-lg hover:scale-[1.01] transition-all duration-300 cursor-default">
            <div className="flex items-start justify-between mb-2">
              <div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white block">Total Amount</span>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Sum of all payments</p>
              </div>
              <div className="p-2 bg-[#5B66E2] rounded-lg flex-shrink-0"><DollarSign className="w-4 h-4 text-white" /></div>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white truncate">₱{fmt(totalAmount)}</div>
          </Card>
          <Card className="p-5 bg-card border-border hover:shadow-lg hover:scale-[1.01] transition-all duration-300 cursor-default">
            <div className="flex items-start justify-between mb-2">
              <div>
                <span className="text-sm font-semibold text-gray-900 dark:text-white block">Banks</span>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">Distinct banks</p>
              </div>
              <div className="p-2 bg-[#4048c0] rounded-lg flex-shrink-0"><Landmark className="w-4 h-4 text-white" /></div>
            </div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white truncate">{fmt(bankCount)}</div>
          </Card>
        </div>

        {/* Bank breakdown table */}
        {reportBankAnalytics.length > 0 && (
          <div className="rounded-lg border bg-card border-border overflow-x-auto animate-fade-in-up" style={{ animationDelay: '0.2s' }}>
            <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700 flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-[#5B66E2]" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Bank Summary</h3>
            </div>
            <table className="w-full min-w-[500px]">
              <thead className="bg-muted">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Bank</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Payments</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">Total Amount</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-gray-400 uppercase">% of Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {reportBankAnalytics
                  .slice((bankPage - 1) * bankRowsPerPage, bankPage * bankRowsPerPage)
                  .map((b) => (
                  <tr key={b.bank} className="hover:bg-[#5B66E2]/5 dark:hover:bg-[#5B66E2]/10 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-white">{b.bank}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{fmt(b.paymentCount)}</td>
                    <td className="px-4 py-3 text-sm text-right text-green-600 dark:text-green-400 font-medium">₱{fmt(b.totalAmount)}</td>
                    <td className="px-4 py-3 text-sm text-right text-gray-700 dark:text-gray-300">{b.percentage.toFixed(2)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {(() => {
              const totalPages = Math.max(1, Math.ceil(reportBankAnalytics.length / bankRowsPerPage));
              if (reportBankAnalytics.length === 0) return null;
              const start = (bankPage - 1) * bankRowsPerPage + 1;
              const end = Math.min(bankPage * bankRowsPerPage, reportBankAnalytics.length);
              // Build page number window
              const pageNums: number[] = [];
              let ps = Math.max(1, bankPage - 2);
              const pe = Math.min(totalPages, ps + 4);
              ps = Math.max(1, pe - 4);
              for (let i = ps; i <= pe; i++) pageNums.push(i);
              const btnClass = "px-2.5 py-1.5 text-sm font-medium rounded-md border bg-gray-100 dark:bg-gray-700 border-gray-300 dark:border-gray-500 text-gray-800 dark:text-gray-100 hover:bg-[#5B66E2]/5 hover:border-[#5B66E2] hover:text-[#5B66E2] dark:hover:bg-[#5B66E2]/20 dark:hover:border-[#5B66E2] dark:hover:text-[#8B96F2] disabled:opacity-40 disabled:cursor-not-allowed transition-colors";
              return (
                <div className="print:hidden flex flex-col sm:flex-row items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-3">
                    <p className="text-sm text-gray-500 dark:text-gray-400">
                      Showing {fmt(start)}–{fmt(end)} of {fmt(reportBankAnalytics.length)} banks
                    </p>
                    <select
                      value={bankRowsPerPage}
                      onChange={(e) => { setBankRowsPerPage(parseInt(e.target.value)); setBankPage(1); }}
                      className="text-xs px-2 py-1 rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-1 focus:ring-[#5B66E2]"
                    >
                      <option value={10}>10 / page</option>
                      <option value={15}>15 / page</option>
                      <option value={25}>25 / page</option>
                      <option value={50}>50 / page</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-1">
                    <button onClick={() => setBankPage(1)} disabled={bankPage === 1} className={btnClass}>First</button>
                    <button onClick={() => setBankPage((p) => Math.max(1, p - 1))} disabled={bankPage === 1} className={btnClass}>Prev</button>
                    {pageNums.map((pg) => (
                      <button
                        key={pg}
                        onClick={() => setBankPage(pg)}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md border transition-colors ${pg === bankPage ? "bg-[#4a55d1] text-white border-[#4a55d1] shadow-sm" : btnClass}`}
                      >
                        {pg}
                      </button>
                    ))}
                    <button onClick={() => setBankPage((p) => Math.min(totalPages, p + 1))} disabled={bankPage === totalPages} className={btnClass}>Next</button>
                    <button onClick={() => setBankPage(totalPages)} disabled={bankPage === totalPages} className={btnClass}>Last</button>
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
