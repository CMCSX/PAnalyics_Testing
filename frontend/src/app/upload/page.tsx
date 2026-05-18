"use client";

import { useState, useRef, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Upload, AlertCircle, CheckCircle2, FileSpreadsheet, RotateCcw, Trash2, History, Merge, X, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip";
import { useData } from "@/context/DataContext";
import { useAuth } from "@/context/AuthContext";
import { parseExcelFile } from "@/utils/excelParser";
import { saveUpload, deleteUpload, uploadFile, type UploadSessionOut } from "@/lib/api";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { useUploads } from "@/lib/queries";
import { ParsedData, PaymentRecord } from "@/types/data";

function fmt(n: number): string {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtAmount(n: number): string {
  return n.toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function UploadPage() {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0); // 0-100
  const [uploadPhase, setUploadPhase] = useState<"parsing" | "saving" | "done">("parsing");
  const progressTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const { data, setData, rawData, setRawData, fileName, setFileName, sessionId, setSessionId } = useData();
  const { token } = useAuth();
  const queryClient = useQueryClient();

  // Smooth progress animation: fill to 40% during parsing, then hold at 40%
  // during the saving phase. The circle switches to a spinner animation while
  // waiting for the server so it never looks frozen or goes backwards.
  useEffect(() => {
    if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    if (!uploading || uploadPhase === "done" || uploadPhase === "saving") return;

    // Only animate during "parsing" — ramp up to 40%
    const target = 40;
    progressTimerRef.current = setInterval(() => {
      setUploadProgress((prev) => {
        if (prev >= target) return prev;
        const remaining = target - prev;
        const increment = Math.max(0.3, remaining * 0.06);
        return Math.min(prev + increment, target);
      });
    }, 200);

    return () => {
      if (progressTimerRef.current) clearInterval(progressTimerRef.current);
    };
  }, [uploading, uploadPhase]);

  // Upload history state
  const [restoring, setRestoring] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // SSE (useUploadEvents in AppShell) already invalidates the uploads cache on new_upload events.
  // No need for polling — removing refetchInterval avoids redundant Neon DB hits.
  const { data: sessions = [] } = useUploads(token);

  // Multi-file merge state
  const mergeInputRef = useRef<HTMLInputElement>(null);
  const [mergeFiles, setMergeFiles] = useState<File[]>([]);
  const [merging, setMerging] = useState(false);
  const [mergeResult, setMergeResult] = useState<{
    totalRecords: number;
    duplicatesRemoved: number;
    filesProcessed: number;
  } | null>(null);

  // Merge date picker popup state
  interface MergeFileEntry {
    fileName: string;
    parsed: ParsedData;
    allDates: boolean;
    dateFrom: string;
    dateTo: string;
    availableDates: string[];
  }
  const [showMergeDatePicker, setShowMergeDatePicker] = useState(false);
  const [mergeFileEntries, setMergeFileEntries] = useState<MergeFileEntry[]>([]);

  // Date filter popup state
  const [pendingParsed, setPendingParsed] = useState<ParsedData | null>(null);
  const [pendingFileName, setPendingFileName] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [allDates, setAllDates] = useState(true);
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");

  // Current data removal state
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removing, setRemoving] = useState(false);

  // Upload mode: "standard" (client-side parse + date filter) or "fast" (direct import)
  const [uploadMode, setUploadMode] = useState<"standard" | "fast">("fast");

  const handleRemoveCurrentData = async () => {
    setRemoving(true);
    try {
      // Only clear front-end state — keep the upload session in the backend/history
      setData(null);
      setRawData([]);
      setFileName("");
      setSessionId(null);
      queryClient.invalidateQueries({ queryKey: ["dashboard"] });
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      toast.success("Current data removed");
    } finally {
      setRemoving(false);
      setConfirmRemove(false);
    }
  };

  // Extract unique sorted dates from pending data
  const availableDates = useMemo(() => {
    if (!pendingParsed) return [];
    const dates = new Set<string>();
    for (const p of pendingParsed.payments) {
      if (p.paymentDate) dates.add(p.paymentDate);
    }
    return [...dates].sort();
  }, [pendingParsed]);

  // Count records matching the current date range selection
  const filteredRecordCount = useMemo(() => {
    if (!pendingParsed || allDates) return pendingParsed?.payments.length ?? 0;
    return pendingParsed.payments.filter((p) => {
      if (!p.paymentDate) return false;
      if (dateFrom && p.paymentDate < dateFrom) return false;
      if (dateTo && p.paymentDate > dateTo) return false;
      return true;
    }).length;
  }, [pendingParsed, allDates, dateFrom, dateTo]);

  // Rebuild ParsedData from a filtered payment array
  function buildParsedData(payments: PaymentRecord[]): ParsedData {
    const bankMap = new Map<string, { totalAmountCents: number; paymentCount: number; accounts: Set<string> }>();
    const tpMap = new Map<string, { count: number; totalAmountCents: number }>();
    let totalAmountCents = 0;
    const allAccounts = new Set<string>();

    for (const p of payments) {
      totalAmountCents += Math.round(p.paymentAmount * 100);
      allAccounts.add(p.account);
      if (!bankMap.has(p.bank)) bankMap.set(p.bank, { totalAmountCents: 0, paymentCount: 0, accounts: new Set() });
      const b = bankMap.get(p.bank)!;
      b.totalAmountCents += Math.round(p.paymentAmount * 100);
      b.paymentCount++;
      b.accounts.add(p.account);
      if (!tpMap.has(p.touchpoint)) tpMap.set(p.touchpoint, { count: 0, totalAmountCents: 0 });
      const t = tpMap.get(p.touchpoint)!;
      t.count++;
      t.totalAmountCents += Math.round(p.paymentAmount * 100);
    }

    const totalAmount = totalAmountCents / 100;

    const bankAnalytics = Array.from(bankMap.entries())
      .map(([bank, d]) => ({
        bank,
        accountCount: d.accounts.size,
        totalAmount: d.totalAmountCents / 100,
        debtorSum: 0,
        percentage: totalAmount > 0 ? ((d.totalAmountCents / 100) / totalAmount) * 100 : 0,
        paymentCount: d.paymentCount,
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount);

    const touchpointAnalytics = Array.from(tpMap.entries())
      .map(([touchpoint, d]) => ({
        touchpoint,
        count: d.count,
        totalAmount: d.totalAmountCents / 100,
        percentage: totalAmount > 0 ? ((d.totalAmountCents / 100) / totalAmount) * 100 : 0,
      }))
      .sort((a, b) => b.count - a.count);

    return {
      payments,
      bankAnalytics,
      touchpointAnalytics,
      totalAccounts: allAccounts.size,
      totalAmount,
      totalPayments: payments.length,
      raw: payments.map((p) => ({ Bank: p.bank, "Payment Date": p.paymentDate, "Payment Amount": p.paymentAmount, Account: p.account, Touchpoint: p.touchpoint })),
    };
  }

  // Finalize import after user confirms date selection
  const finalizeImport = async (parsedData: ParsedData, fileName: string) => {
    setData(parsedData);
    setRawData(parsedData.raw);
    setFileName(fileName);

    if (token) {
      try {
        const records = parsedData.payments.map((p) => ({
          bank: p.bank,
          account: p.account,
          touchpoint: p.touchpoint,
          payment_date: p.paymentDate,
          payment_amount: p.paymentAmount,
          environment: p.environment,
          month: p.month,
        }));
        const saved = await saveUpload(token, { file_name: fileName, records });
        setSessionId(saved.id);
        await queryClient.invalidateQueries({ queryKey: ["uploads"] });
        toast.success(`File uploaded & saved! ${saved.total_records} records stored.`);
        setUploadSuccess(true);
        setTimeout(() => router.push("/dashboard"), 1500);
      } catch (backendErr) {
        setSessionId(null);
        const msg = backendErr instanceof Error ? backendErr.message : "Unknown error";
        toast.warning(`File loaded locally — server sync failed: ${msg}. Make sure the backend is running.`);
        // Do NOT navigate — stay on the upload page so the user can retry.
      }
    } else {
      toast.success("File uploaded successfully!");
      setUploadSuccess(true);
      setTimeout(() => router.push("/dashboard"), 1500);
    }
  };

  // Handle date selection confirmation
  const handleDateConfirm = async () => {
    if (!pendingParsed) return;

    let finalData: ParsedData;
    if (allDates) {
      finalData = pendingParsed;
    } else {
      const filtered = pendingParsed.payments.filter((p) => {
        if (!p.paymentDate) return false;
        if (dateFrom && p.paymentDate < dateFrom) return false;
        if (dateTo && p.paymentDate > dateTo) return false;
        return true;
      });
      if (filtered.length === 0) {
        toast.error("No records found for the selected date range.");
        return;
      }
      finalData = buildParsedData(filtered);
    }

    setShowDatePicker(false);
    setPendingParsed(null);
    setUploading(true);
    setUploadProgress(5);
    setUploadPhase("saving");
    try {
      await finalizeImport(finalData, pendingFileName);
      setUploadProgress(100);
      setUploadPhase("done");
    } catch {
      toast.error("Import failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDateCancel = () => {
    setShowDatePicker(false);
    setPendingParsed(null);
    setPendingFileName("");
    setDateFrom("");
    setDateTo("");
    setUploading(false);
  };

  const handleFileUpload = async (file: File) => {
    // Fast Upload: send file directly to server for streaming parse
    if (uploadMode === "fast") {
      return handleFastUpload(file);
    }

    setUploading(true);
    setError(null);
    setUploadSuccess(false);

    try {
      const parsedData = await parseExcelFile(file);

      // Show date selection popup before importing (no progress bar yet)
      setPendingParsed(parsedData);
      setPendingFileName(file.name);
      setAllDates(true);
      setDateFrom("");
      setDateTo("");
      setShowDatePicker(true);
      setUploading(false);
    } catch (err) {
      const message =
        err instanceof Error
          ? err.message
          : "Failed to parse file. Please ensure it's a valid .xlsx or .xls file.";
      setError(message);
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleFastUpload = async (file: File) => {
    if (!token) {
      setError("You must be logged in to upload.");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setUploadPhase("parsing");
    setError(null);
    setUploadSuccess(false);

    // Abort controller so we can cancel the upload on timeout
    const abortController = new AbortController();
    // 5-minute hard timeout — large files on Render free tier can be slow,
    // but anything beyond 5 min is almost certainly a stalled connection.
    const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000;
    const timeoutId = setTimeout(() => {
      abortController.abort();
    }, UPLOAD_TIMEOUT_MS);

    try {
      // Server-side streaming path: send raw file, backend parses row-by-row
      setUploadProgress(20);
      setUploadPhase("saving");

      const saved = await uploadFile(token, file, abortController.signal);

      // Jump straight to 100% and show "Done!" before navigating
      setUploadProgress(100);
      setUploadPhase("done");
      setSessionId(saved.id);
      setFileName(file.name);
      // No in-memory data — dashboard fetches from API
      setData(null);
      setRawData([]);

      await queryClient.invalidateQueries({ queryKey: ["uploads"] });
      toast.success(`Uploaded! ${saved.total_records.toLocaleString()} records saved.`);
      setUploadSuccess(true);

      // Brief pause so the user sees "Done!" before the page changes
      await new Promise((resolve) => setTimeout(resolve, 800));
      setUploading(false);
      router.push("/dashboard");
    } catch (err) {
      const isAbort = err instanceof Error && err.name === "AbortError";
      const message = isAbort
        ? `Upload timed out after ${UPLOAD_TIMEOUT_MS / 60000} minutes. The file may be too large or the server is under load — please try again.`
        : err instanceof Error
        ? err.message
        : "Upload failed";
      setError(message);
      toast.error(isAbort ? "Upload timed out" : "Upload failed");
      setUploading(false);
    } finally {
      // Always clear the timeout — prevents a 5-min delayed abort on an already-finished upload
      clearTimeout(timeoutId);
    }
  };

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter(
      (f) =>
        f.name.endsWith(".xlsx") ||
        f.name.endsWith(".xls") ||
        f.name.endsWith(".csv")
    );
    if (files.length === 0) {
      setError("Please upload valid files (.xlsx, .xls, .csv)");
      return;
    }
    if (uploadMode === 'fast') {
      if (files.length > 1) {
        setError("Enable Controlled Upload to merge multiple files.");
        return;
      }
      handleFileUpload(files[0]);
    } else if (files.length === 1) {
      handleFileUpload(files[0]);
    } else {
      setMergeFiles((prev) => [...prev, ...files]);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(
      (f) =>
        f.name.endsWith(".xlsx") ||
        f.name.endsWith(".xls") ||
        f.name.endsWith(".csv")
    );
    if (uploadMode === 'fast') {
      if (files.length > 1) {
        setError("Enable Controlled Upload to merge multiple files.");
        return;
      }
      if (files.length === 1) handleFileUpload(files[0]);
    } else if (files.length === 1) {
      handleFileUpload(files[0]);
    } else if (files.length > 1) {
      setMergeFiles((prev) => [...prev, ...files]);
    }
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleRestore = async (session: UploadSessionOut) => {
    if (!token) return;
    setRestoring(session.id);
    try {
      // Set sessionId + fileName only — the dashboard and transactions pages
      // each fetch their own data via TanStack Query (no need to load all records here).
      setSessionId(session.id);
      setFileName(session.file_name);
      toast.success(`Session restored: ${session.file_name}`);
      router.push("/dashboard");
    } catch {
      toast.error("Failed to restore session");
    } finally {
      setRestoring(null);
    }
  };

  const handleDelete = async (session: UploadSessionOut) => {
    if (!token) return;
    setDeleting(session.id);
    setConfirmDelete(null);
    try {
      await deleteUpload(token, session.id);
      toast.success(`"${session.file_name}" deleted`);
      if (session.id === sessionId) {
        setSessionId(null);
        setData(null);
        setFileName("");
      }
      queryClient.invalidateQueries({ queryKey: ["uploads"] });
    } catch {
      toast.error("Failed to delete upload session");
    } finally {
      setDeleting(null);
    }
  };

  const handleMergeFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(
      (f) => f.name.endsWith(".xlsx") || f.name.endsWith(".xls") || f.name.endsWith(".csv")
    );
    if (files.length > 0) setMergeFiles((prev) => [...prev, ...files]);
    if (mergeInputRef.current) mergeInputRef.current.value = "";
  };

  const removeMergeFile = (idx: number) => {
    setMergeFiles((prev) => prev.filter((_, i) => i !== idx));
    setMergeResult(null);
  };

  const executeMerge = async () => {
    if (mergeFiles.length < 2) {
      toast.error("Select at least 2 files to merge");
      return;
    }
    setMerging(true);
    setError(null);
    setMergeResult(null);
    try {
      const entries: MergeFileEntry[] = [];
      for (const file of mergeFiles) {
        const parsed = await parseExcelFile(file);
        const dates = [...new Set(parsed.payments.map((p) => p.paymentDate).filter(Boolean))].sort();
        entries.push({
          fileName: file.name,
          parsed,
          allDates: true,
          dateFrom: "",
          dateTo: "",
          availableDates: dates,
        });
      }
      setMergeFileEntries(entries);
      setShowMergeDatePicker(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to parse files";
      setError(message);
      toast.error("Merge failed");
    } finally {
      setMerging(false);
    }
  };

  // Compute per-file filtered record count
  const mergeFilteredCounts = useMemo(() => {
    return mergeFileEntries.map((entry) => {
      if (entry.allDates) return entry.parsed.payments.length;
      return entry.parsed.payments.filter((p) => {
        if (!p.paymentDate) return false;
        if (entry.dateFrom && p.paymentDate < entry.dateFrom) return false;
        if (entry.dateTo && p.paymentDate > entry.dateTo) return false;
        return true;
      }).length;
    });
  }, [mergeFileEntries]);

  const mergeTotalFilteredCount = mergeFilteredCounts.reduce((s, c) => s + c, 0);

  // Compute overall unique dates and total records across all merge files
  const mergeOverallStats = useMemo(() => {
    const allDates = new Set<string>();
    let totalRecords = 0;
    for (const entry of mergeFileEntries) {
      totalRecords += entry.parsed.payments.length;
      for (const d of entry.availableDates) allDates.add(d);
    }
    const sorted = [...allDates].sort();
    return { totalRecords, uniqueDates: sorted.length, minDate: sorted[0] ?? "", maxDate: sorted[sorted.length - 1] ?? "" };
  }, [mergeFileEntries]);

  const updateMergeEntry = (idx: number, updates: Partial<MergeFileEntry>) => {
    setMergeFileEntries((prev) => prev.map((e, i) => i === idx ? { ...e, ...updates } : e));
  };

  const handleMergeDateConfirm = async () => {
    setShowMergeDatePicker(false);
    setMerging(true);
    setError(null);
    try {
      const allPayments: ParsedData["payments"] = [];
      for (const entry of mergeFileEntries) {
        let payments = entry.parsed.payments;
        if (!entry.allDates) {
          payments = payments.filter((p) => {
            if (!p.paymentDate) return false;
            if (entry.dateFrom && p.paymentDate < entry.dateFrom) return false;
            if (entry.dateTo && p.paymentDate > entry.dateTo) return false;
            return true;
          });
        }
        allPayments.push(...payments);
      }

      // Deduplicate by bank + account + date + amount + touchpoint
      const seen = new Set<string>();
      const unique = allPayments.filter((p) => {
        const key = `${p.bank}|${p.account}|${p.paymentDate}|${p.paymentAmount}|${p.touchpoint}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      if (unique.length === 0) {
        toast.error("No records found for the selected date ranges.");
        setMerging(false);
        setShowMergeDatePicker(true);
        return;
      }

      const duplicatesRemoved = allPayments.length - unique.length;

      // Build analytics using cent-based integer arithmetic to avoid float rounding errors
      const bankMap = new Map<string, { totalAmountCents: number; paymentCount: number; accounts: Set<string> }>();
      const tpMap = new Map<string, { count: number; totalAmountCents: number }>();
      let totalAmountCents = 0;
      const allAccounts = new Set<string>();

      for (const p of unique) {
        totalAmountCents += Math.round(p.paymentAmount * 100);
        allAccounts.add(p.account);
        if (!bankMap.has(p.bank)) bankMap.set(p.bank, { totalAmountCents: 0, paymentCount: 0, accounts: new Set() });
        const b = bankMap.get(p.bank)!;
        b.totalAmountCents += Math.round(p.paymentAmount * 100);
        b.paymentCount++;
        b.accounts.add(p.account);
        if (!tpMap.has(p.touchpoint)) tpMap.set(p.touchpoint, { count: 0, totalAmountCents: 0 });
        const t = tpMap.get(p.touchpoint)!;
        t.count++;
        t.totalAmountCents += Math.round(p.paymentAmount * 100);
      }

      const totalAmount = totalAmountCents / 100;

      const bankAnalytics = Array.from(bankMap.entries())
        .map(([bank, d]) => ({
          bank,
          accountCount: d.accounts.size,
          totalAmount: d.totalAmountCents / 100,
          debtorSum: 0,
          percentage: totalAmountCents > 0 ? (d.totalAmountCents / totalAmountCents) * 100 : 0,
          paymentCount: d.paymentCount,
        }))
        .sort((a, b) => b.totalAmount - a.totalAmount);

      const touchpointAnalytics = Array.from(tpMap.entries())
        .map(([touchpoint, d]) => ({
          touchpoint,
          count: d.count,
          totalAmount: d.totalAmountCents / 100,
          percentage: totalAmountCents > 0 ? (d.totalAmountCents / totalAmountCents) * 100 : 0,
        }))
        .sort((a, b) => b.count - a.count);

      const mergedData: ParsedData = {
        payments: unique,
        bankAnalytics,
        touchpointAnalytics,
        totalAccounts: allAccounts.size,
        totalAmount,
        totalPayments: unique.length,
        raw: [],
      };

      const mergedFileName = mergeFileEntries.map((e) => e.fileName).join(" + ");
      setData(mergedData);
      setRawData([]);
      setFileName(mergedFileName);

      // Save to backend
      if (token) {
        try {
          const records = unique.map((p) => ({
            bank: p.bank,
            account: p.account,
            touchpoint: p.touchpoint,
            payment_date: p.paymentDate,
            payment_amount: p.paymentAmount,
            environment: p.environment,
          }));
          const saved = await saveUpload(token, { file_name: mergedFileName, records });
          setSessionId(saved.id);
          await queryClient.invalidateQueries({ queryKey: ["uploads"] });
        } catch (backendErr) {
          setSessionId(null);
          const msg = backendErr instanceof Error ? backendErr.message : "Unknown error";
          toast.warning(`Merged locally — server sync failed: ${msg}`);
        }
      }

      setMergeResult({
        totalRecords: unique.length,
        duplicatesRemoved,
        filesProcessed: mergeFileEntries.length,
      });

      toast.success(`Merged ${mergeFileEntries.length} files — ${fmt(unique.length)} records (${fmt(duplicatesRemoved)} duplicates removed)`);
      setTimeout(() => router.push("/dashboard"), 2000);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to merge files";
      setError(message);
      toast.error("Merge failed");
    } finally {
      setMerging(false);
    }
  };

  const handleMergeDateCancel = () => {
    setShowMergeDatePicker(false);
    setMergeFileEntries([]);
  };

  const circleRadius = 40;
  const circleCircumference = 2 * Math.PI * circleRadius;

  return (
    <div className="px-4 sm:px-8 py-8 min-h-screen">
      {/* Circular loading popup overlay */}
      {uploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-900 rounded-2xl shadow-2xl p-10 flex flex-col items-center gap-6 min-w-[260px]">
            <div className="relative w-28 h-28">
              {uploadPhase === "saving" ? (
                /* Indeterminate spinner — no percentage, just a rotating arc */
                <svg className="w-full h-full animate-spin" viewBox="0 0 96 96">
                  <circle
                    cx="48" cy="48" r={circleRadius}
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="8"
                    className="dark:stroke-gray-700"
                  />
                  <circle
                    cx="48" cy="48" r={circleRadius}
                    fill="none"
                    stroke="#4a55d1"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circleCircumference}
                    strokeDashoffset={circleCircumference * 0.75}
                  />
                </svg>
              ) : (
                /* Determinate progress arc for parsing + done phases */
                <svg className="w-full h-full -rotate-90" viewBox="0 0 96 96">
                  <circle
                    cx="48" cy="48" r={circleRadius}
                    fill="none"
                    stroke="#e2e8f0"
                    strokeWidth="8"
                    className="dark:stroke-gray-700"
                  />
                  <circle
                    cx="48" cy="48" r={circleRadius}
                    fill="none"
                    stroke="#4a55d1"
                    strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={circleCircumference}
                    strokeDashoffset={circleCircumference * (1 - uploadProgress / 100)}
                    className="transition-all duration-700 ease-out"
                  />
                </svg>
              )}
              {/* Only show percentage when not in the indeterminate spinner phase */}
              {uploadPhase !== "saving" && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-xl font-bold text-[#4a55d1]">{Math.round(uploadProgress)}%</span>
                </div>
              )}
            </div>
            <div className="text-center">
              <p className="text-base font-semibold text-gray-900 dark:text-white">
                {uploadPhase === "parsing" && "Reading file..."}
                {uploadPhase === "saving" && "Uploading to server..."}
                {uploadPhase === "done" && "Done!"}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                {uploadPhase === "parsing" && "Parsing your data"}
                {uploadPhase === "saving" && "Server is processing rows..."}
                {uploadPhase === "done" && "Upload complete"}
              </p>
              {(uploadPhase === "parsing" || uploadPhase === "saving") && (
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-2 max-w-[200px]">
                  Large files may take 1–2 minutes — please keep this tab open
                </p>
              )}
            </div>
          </div>
        </div>
      )}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold mb-2 text-gray-900 dark:text-white">
          Upload Data
        </h1>
        <p className="text-gray-600 dark:text-gray-400">
          Import data from Excel or CSV files
        </p>
      </div>

      {/* Main content */}
      <div className="max-w-4xl mx-auto">
        <div className="space-y-6">
          {/* Combined Upload & Merge Area */}
          <Card
            className="relative p-8 sm:p-12 border-2 border-dashed bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-700 text-center cursor-pointer hover:border-[#5B66E2] hover:shadow-lg transition-all duration-300 animate-fade-in-up"
            style={{ animationDelay: '0.15s' }}
            onDrop={handleFileDrop}
            onDragOver={(e) => e.preventDefault()}
            onClick={() => fileInputRef.current?.click()}
          >
            {/* Controlled Upload Toggle */}
            <div className="absolute top-4 right-4 z-10" onClick={(e) => e.stopPropagation()}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div
                    className="flex items-center gap-2.5 cursor-pointer select-none"
                    onClick={() => setUploadMode(prev => prev === 'fast' ? 'standard' : 'fast')}
                  >
                    <span className="text-sm font-medium text-gray-500 dark:text-gray-400">
                      Controlled Upload
                    </span>
                    <div className={`relative w-11 h-6 rounded-full transition-colors duration-200 ${
                      uploadMode === 'standard'
                        ? 'bg-[#5B66E2]'
                        : 'bg-gray-300 dark:bg-gray-600'
                    }`}>
                      <div className={`absolute top-[3px] w-[18px] h-[18px] rounded-full bg-white shadow-sm transition-transform duration-200 ${
                        uploadMode === 'standard' ? 'translate-x-[22px]' : 'translate-x-[3px]'
                      }`} />
                    </div>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[280px] text-center">
                  <p className="font-medium mb-1">Controlled Upload</p>
                  <p>Preview your data and filter by date range before importing. Supports merging multiple files. Best for smaller files when you need precise control over which records to import.</p>
                </TooltipContent>
              </Tooltip>
            </div>

            <Upload className="w-12 sm:w-16 h-12 sm:h-16 mx-auto mb-3 text-gray-400 dark:text-gray-600" />
            <h3 className="text-xl sm:text-2xl font-bold mb-1 text-gray-900 dark:text-white">
              {uploadMode === 'fast' ? 'Fast Upload' : 'Controlled Upload'}
            </h3>
            <p className="text-base font-medium mb-1 text-gray-700 dark:text-gray-300">
              {uploadMode === 'fast' ? 'Drop a file here' : 'Drop one or more files here'}
            </p>
            <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">
              Supports .xlsx, .xls, and .csv files
            </p>
            <p className="mb-5 text-sm text-gray-400 dark:text-gray-500 max-w-md mx-auto">
              {uploadMode === 'fast'
                ? 'Drop a single file to import directly to your dashboard. For larger files or to filter by date, enable the Controlled Upload toggle.'
                : 'Preview your data and choose a date range before importing. You can also drop multiple files to merge them into one dataset.'}
            </p>
            <Button
              className="bg-[#4a55d1] hover:bg-[#4048c0] text-white w-full"
              disabled={merging || uploading}
            >
              {merging ? "Merging..." : uploading ? "Uploading..." : "Browse Files"}
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              multiple={uploadMode !== 'fast'}
              onChange={handleFileSelect}
              className="hidden"
            />
          </Card>

          {/* Current Data Info Box */}
          {(data && data.totalPayments > 0) && (
            <div className="p-6 rounded-lg bg-card border border-border animate-fade-in-up" style={{ animationDelay: '0.17s' }}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-start gap-3">
                  <FileSpreadsheet className="w-5 h-5 text-[#5B66E2] flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-gray-900 dark:text-white font-semibold mb-1">
                      Current Data
                    </h4>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      {fileName || "Uploaded data"} &middot; {fmt(data?.totalPayments ?? 0)} records &middot; ₱{fmt(data?.totalAmount ?? 0)}
                    </p>
                    {data && (
                      <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                        {data.bankAnalytics.length} bank{data.bankAnalytics.length !== 1 ? "s" : ""} &middot; {data.touchpointAnalytics.length} touchpoint{data.touchpointAnalytics.length !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {confirmRemove ? (
                    <>
                      <span className="text-sm text-red-600 dark:text-red-400 mr-1">Remove all data?</span>
                      <Button
                        onClick={handleRemoveCurrentData}
                        disabled={removing}
                        className="h-9 px-4 text-sm bg-red-600 hover:bg-red-700 text-white"
                      >
                        {removing ? "Removing..." : "Yes, Remove"}
                      </Button>
                      <Button
                        onClick={() => setConfirmRemove(false)}
                        disabled={removing}
                        className="h-9 px-4 text-sm bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-100"
                      >
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => setConfirmRemove(true)}
                      className="flex items-center gap-2 bg-transparent hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-500 hover:text-red-600 dark:hover:text-red-400 border border-gray-200 dark:border-gray-600 hover:border-red-300 dark:hover:border-red-600 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                      Remove Current Data
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Merge file list (shown when multiple files queued) */}
          {mergeFiles.length > 0 && (
            <div className="p-6 rounded-lg bg-card border border-border animate-fade-in-up" style={{ animationDelay: '0.20s' }}>
              <div className="flex items-center gap-2 mb-3">
                <Merge className="w-5 h-5 text-[#8B96F2]" />
                <h4 className="text-gray-900 dark:text-white font-semibold">Files to Merge</h4>
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  — duplicates (same account + date + amount) will be removed automatically
                </span>
              </div>

              <div className="flex flex-wrap gap-2 mb-4" onClick={(e) => e.stopPropagation()}>
                {mergeFiles.map((f, i) => (
                  <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-[#5B66E2]/10 dark:bg-[#5B66E2]/20 border border-[#5B66E2]/30 dark:border-[#5B66E2]/30 rounded-full text-sm">
                    <FileSpreadsheet className="w-4 h-4 text-[#5B66E2] dark:text-[#8B96F2]" />
                    <span className="text-gray-800 dark:text-gray-200 max-w-[200px] truncate">{f.name}</span>
                    <button onClick={(e) => { e.stopPropagation(); removeMergeFile(i); }} className="text-gray-400 hover:text-red-500 transition-colors">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                <Button
                  onClick={() => mergeInputRef.current?.click()}
                  disabled={merging}
                  className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600"
                >
                  Add More Files
                </Button>
                <Button
                  onClick={executeMerge}
                  disabled={merging || mergeFiles.length < 2}
                  className="bg-[#4a55d1] hover:bg-[#4048c0] text-white disabled:opacity-50"
                >
                  {merging ? "Merging..." : `Merge ${mergeFiles.length} File${mergeFiles.length !== 1 ? "s" : ""}`}
                </Button>
                <Button
                  onClick={() => { setMergeFiles([]); setMergeResult(null); }}
                  disabled={merging}
                  className="bg-transparent hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600 dark:hover:text-red-400 border border-gray-200 dark:border-gray-600 hover:border-red-300 dark:hover:border-red-600"
                >
                  Clear All
                </Button>
                <input
                  ref={mergeInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  multiple
                  onChange={handleMergeFiles}
                  className="hidden"
                />
              </div>

              {mergeResult && (
                <div className="mt-4 p-3 rounded-lg bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 text-sm text-green-700 dark:text-green-300">
                  <CheckCircle2 className="w-4 h-4 inline mr-2" />
                  Merged {mergeResult.filesProcessed} files — {fmt(mergeResult.totalRecords)} total records, {fmt(mergeResult.duplicatesRemoved)} duplicates removed. Redirecting...
                </div>
              )}
            </div>
          )}

          {/* Import Instructions */}
          <div className="p-6 rounded-lg bg-card border border-border animate-fade-in-up" style={{ animationDelay: '0.25s' }}>
            {/* Mode description header */}
            <h4 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              {uploadMode === 'fast'
                ? 'Drop a single file to import directly to your dashboard'
                : 'Preview and filter your data before importing'}
            </h4>
            <div className="flex items-start gap-2 mb-4">
              <AlertCircle className="w-5 h-5 text-[#8B96F2] flex-shrink-0 mt-0.5" />
              <div>
                <h4 className="text-gray-900 dark:text-white font-semibold mb-2">
                  What your file needs
                </h4>
                <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-2">
                  <li>
                    <strong>Required Columns:</strong> Bank, Payment Date
                    (leads_result_edate or date_created), Payment Amount (leads_result_amount),
                    Account (debtor_id), Touchpoint (TAGGING), Environment (ENVIRONMENT)
                  </li>
                  <li>
                    <strong>Supported formats:</strong> .xlsx, .xls, .csv
                  </li>
                </ul>
                <div className="mt-4">
                  <h5 className="text-gray-900 dark:text-white font-semibold mb-2">
                    Tips:
                  </h5>
                  <ul className="text-sm text-gray-600 dark:text-gray-400 space-y-1.5">
                    <li>Dates can be in YYYY-MM-DD format or Excel serial numbers</li>
                    <li>Payment amounts should be numeric values</li>
                    <li>Column headers are matched flexibly (e.g. &quot;Bank&quot;, &quot;BANK&quot;, &quot;bank&quot; all work)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>

          {/* Alerts */}
          {uploadSuccess && (
            <Alert className="bg-green-50 dark:bg-green-900 border-green-300 dark:border-green-700">
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
              <AlertDescription className="text-green-800 dark:text-green-200">
                File uploaded successfully! Redirecting to dashboard...
              </AlertDescription>
            </Alert>
          )}

          {error && (
            <Alert className="bg-red-50 dark:bg-red-900 border-red-300 dark:border-red-700">
              <AlertCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
              <AlertDescription className="text-red-800 dark:text-red-200">
                {error}
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Upload History */}
        <div className="mt-10 animate-fade-in-up" style={{ animationDelay: '0.35s' }}>
          <div className="flex items-center gap-3 mb-4">
            <History className="w-6 h-6 text-[#5B66E2]" />
            <h2 className="text-xl font-semibold text-gray-900 dark:text-white">Upload History</h2>
          </div>

          {sessions.length === 0 ? (
            <div className="p-8 rounded-lg text-center bg-card border border-border">
              <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 text-gray-400" />
              <p className="text-gray-600 dark:text-gray-400">No uploads yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {sessions.map((s) => {
                const isActive = s.id === sessionId;
                return (
                  <div
                    key={s.id}
                    className={`rounded-lg border p-5 bg-white dark:bg-gray-800 transition-all duration-200 ${
                      isActive
                        ? "border-[#5B66E2] ring-1 ring-[#5B66E2]/40 shadow-[#5B66E2]/10 dark:shadow-none"
                        : "border-gray-200 dark:border-gray-700 hover:border-[#5B66E2]/50 dark:hover:border-[#5B66E2]/50"
                    }`}
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <FileSpreadsheet className="w-5 h-5 text-green-500 flex-shrink-0" />
                          <span className="font-medium text-gray-900 dark:text-white truncate">
                            {s.file_name}
                          </span>
                          {isActive && (
                            <span className="inline-flex items-center px-2 py-0.5 text-xs font-medium bg-[#5B66E2]/10 text-[#5B66E2] dark:bg-[#5B66E2]/20 dark:text-[#8B96F2] rounded-full">
                              Active
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-500 dark:text-gray-400">
                          <span>{fmt(s.total_records)} records</span>
                          <span>₱{fmtAmount(s.total_amount)}</span>
                          <span>{fmtDate(s.uploaded_at)}</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Button
                          onClick={() => handleRestore(s)}
                          disabled={restoring === s.id || deleting === s.id}
                          className={`flex items-center gap-2 ${
                            isActive
                              ? "bg-[#4a55d1] hover:bg-[#4048c0] text-white"
                              : "bg-gray-100 dark:bg-gray-700 hover:bg-[#5B66E2]/5 dark:hover:bg-[#5B66E2]/20 text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600"
                          }`}
                        >
                          <RotateCcw className="w-4 h-4" />
                          {restoring === s.id ? "Restoring..." : isActive ? "Reload" : "Restore"}
                        </Button>

                        {confirmDelete === s.id ? (
                          <div className="flex items-center gap-1">
                            <span className="text-xs text-gray-500 dark:text-gray-400 mr-1">Delete?</span>
                            <Button
                              onClick={() => handleDelete(s)}
                              disabled={deleting === s.id}
                              className="h-8 px-3 text-xs bg-red-600 hover:bg-red-700 text-white"
                            >
                              {deleting === s.id ? "Deleting..." : "Yes"}
                            </Button>
                            <Button
                              onClick={() => setConfirmDelete(null)}
                              className="h-8 px-3 text-xs bg-gray-200 dark:bg-gray-600 hover:bg-gray-300 dark:hover:bg-gray-500 text-gray-800 dark:text-gray-100"
                            >
                              No
                            </Button>
                          </div>
                        ) : (
                          <Button
                            onClick={() => setConfirmDelete(s.id)}
                            disabled={restoring === s.id || deleting === s.id}
                            title="Delete this upload session"
                            className="h-9 w-9 p-0 flex items-center justify-center bg-transparent hover:bg-red-50 dark:hover:bg-red-900/30 text-gray-400 hover:text-red-600 dark:hover:text-red-400 border border-gray-200 dark:border-gray-600 hover:border-red-300 dark:hover:border-red-600"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Date Selection Popup */}
      {showDatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-md mx-4 rounded-xl bg-card border border-border shadow-2xl p-6 animate-fade-in-up">
            <div className="flex items-center gap-3 mb-4">
              <CalendarDays className="w-6 h-6 text-[#5B66E2]" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                Select Import Date
              </h3>
            </div>

            <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
              File: <span className="font-medium text-gray-800 dark:text-gray-200">{pendingFileName}</span>
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-5">
              {fmt(pendingParsed?.payments.length ?? 0)} total records &middot; {availableDates.length} unique date{availableDates.length !== 1 ? "s" : ""} found
              {availableDates.length > 0 && (
                <span> &middot; {availableDates[0]} to {availableDates[availableDates.length - 1]}</span>
              )}
            </p>

            {/* All Dates checkbox */}
            <label className="flex items-center gap-3 mb-5 cursor-pointer group">
              <input
                type="checkbox"
                checked={allDates}
                onChange={(e) => {
                  setAllDates(e.target.checked);
                  if (e.target.checked) {
                    setDateFrom("");
                    setDateTo("");
                  }
                }}
                className="w-5 h-5 rounded border-gray-300 dark:border-gray-600 text-[#5B66E2] focus:ring-[#5B66E2] accent-[#5B66E2]"
              />
              <span className="text-gray-900 dark:text-white font-medium group-hover:text-[#5B66E2] dark:group-hover:text-[#8B96F2] transition-colors">
                All Dates
              </span>
              <span className="text-sm text-gray-500 dark:text-gray-400">
                (Import entire file)
              </span>
            </label>

            {/* Date range selectors */}
            <div className={`transition-opacity ${allDates ? "opacity-40 pointer-events-none" : "opacity-100"}`}>
              <p className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                Or select a date range:
              </p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    From
                  </label>
                  <select
                    value={dateFrom}
                    onChange={(e) => {
                      setDateFrom(e.target.value);
                      if (e.target.value) setAllDates(false);
                      // Auto-set To if empty or less than From
                      if (e.target.value && (!dateTo || dateTo < e.target.value)) {
                        setDateTo(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B66E2]"
                  >
                    <option value="">Earliest</option>
                    {availableDates.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5">
                    To
                  </label>
                  <select
                    value={dateTo}
                    onChange={(e) => {
                      setDateTo(e.target.value);
                      if (e.target.value) setAllDates(false);
                      // Auto-set From if empty or greater than To
                      if (e.target.value && (!dateFrom || dateFrom > e.target.value)) {
                        setDateFrom(e.target.value);
                      }
                    }}
                    className="w-full px-3 py-2.5 rounded-lg bg-gray-100 dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#5B66E2]"
                  >
                    <option value="">Latest</option>
                    {availableDates.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Summary of selection */}
            {!allDates && (dateFrom || dateTo) && (
              <div className="mt-4 p-3 rounded-lg bg-[#5B66E2]/10 dark:bg-[#5B66E2]/20 border border-[#5B66E2]/30 dark:border-[#5B66E2]/30 text-sm text-[#5B66E2] dark:text-[#8B96F2]">
                <CheckCircle2 className="w-4 h-4 inline mr-2" />
                {fmt(filteredRecordCount)} records will be imported
                {dateFrom && dateTo && dateFrom === dateTo
                  ? ` for ${dateFrom}`
                  : ` from ${dateFrom || availableDates[0] || "start"} to ${dateTo || availableDates[availableDates.length - 1] || "end"}`}
              </div>
            )}

            {/* Buttons */}
            <div className="flex items-center justify-end gap-3 mt-6">
              <Button
                onClick={handleDateCancel}
                className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600"
              >
                Cancel
              </Button>
              <Button
                onClick={handleDateConfirm}
                disabled={!allDates && !dateFrom && !dateTo}
                className="bg-[#4a55d1] hover:bg-[#4048c0] text-white disabled:opacity-50"
              >
                Import {!allDates && filteredRecordCount > 0 ? `(${fmt(filteredRecordCount)} records)` : ""}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Merge Date Selection Popup */}
      {showMergeDatePicker && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-lg mx-4 rounded-2xl bg-card border border-border shadow-2xl animate-fade-in-up overflow-hidden">
            {/* Header */}
            <div className="px-6 pt-6 pb-4 border-b border-border">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-xl bg-[#5B66E2]/10 dark:bg-[#5B66E2]/20 flex items-center justify-center">
                  <CalendarDays className="w-5 h-5 text-[#5B66E2]" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                    Select Import Dates
                  </h3>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Choose which dates to include from each file
                  </p>
                </div>
              </div>
              {/* Overall stats bar */}
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400 mt-2">
                <span>{mergeFileEntries.length} files</span>
                <span>&middot;</span>
                <span>{fmt(mergeOverallStats.totalRecords)} total records</span>
                <span>&middot;</span>
                <span>{mergeOverallStats.uniqueDates} unique dates</span>
                {mergeOverallStats.minDate && (
                  <>
                    <span>&middot;</span>
                    <span>{mergeOverallStats.minDate} to {mergeOverallStats.maxDate}</span>
                  </>
                )}
              </div>
            </div>

            {/* Per-file sections */}
            <div className="px-6 py-4 max-h-[50vh] overflow-y-auto space-y-4">
              {mergeFileEntries.map((entry, idx) => (
                <div key={idx} className="rounded-xl border border-border bg-gray-50 dark:bg-gray-800/50 p-4">
                  {/* File header */}
                  <div className="flex items-center gap-2 mb-3">
                    <FileSpreadsheet className="w-4 h-4 text-[#5B66E2] flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{entry.fileName}</span>
                    <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">
                      {fmt(entry.parsed.payments.length)} records &middot; {entry.availableDates.length} dates
                    </span>
                  </div>
                  {entry.availableDates.length > 0 && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mb-3 -mt-1">
                      {entry.availableDates[0]} to {entry.availableDates[entry.availableDates.length - 1]}
                    </p>
                  )}

                  {/* All Dates toggle */}
                  <label className="flex items-center gap-2.5 mb-3 cursor-pointer group">
                    <input
                      type="checkbox"
                      checked={entry.allDates}
                      onChange={(e) => {
                        updateMergeEntry(idx, {
                          allDates: e.target.checked,
                          ...(e.target.checked ? { dateFrom: "", dateTo: "" } : {}),
                        });
                      }}
                      className="w-4 h-4 rounded border-gray-300 dark:border-gray-600 text-[#5B66E2] focus:ring-[#5B66E2] accent-[#5B66E2]"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300 group-hover:text-[#5B66E2] dark:group-hover:text-[#8B96F2] transition-colors">
                      All Dates
                    </span>
                    <span className="text-xs text-gray-400 dark:text-gray-500">(import entire file)</span>
                  </label>

                  {/* Date range selectors */}
                  <div className={`transition-all duration-200 ${entry.allDates ? "opacity-30 pointer-events-none max-h-0 overflow-hidden" : "opacity-100 max-h-40"}`}>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">From</label>
                        <select
                          value={entry.dateFrom}
                          onChange={(e) => {
                            const val = e.target.value;
                            const updates: Partial<MergeFileEntry> = { dateFrom: val };
                            if (val) {
                              updates.allDates = false;
                              if (!entry.dateTo || entry.dateTo < val) updates.dateTo = val;
                            }
                            updateMergeEntry(idx, updates);
                          }}
                          className="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#5B66E2]"
                        >
                          <option value="">Earliest</option>
                          {entry.availableDates.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">To</label>
                        <select
                          value={entry.dateTo}
                          onChange={(e) => {
                            const val = e.target.value;
                            const updates: Partial<MergeFileEntry> = { dateTo: val };
                            if (val) {
                              updates.allDates = false;
                              if (!entry.dateFrom || entry.dateFrom > val) updates.dateFrom = val;
                            }
                            updateMergeEntry(idx, updates);
                          }}
                          className="w-full px-2.5 py-2 rounded-lg bg-white dark:bg-gray-900 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-[#5B66E2]"
                        >
                          <option value="">Latest</option>
                          {entry.availableDates.map((d) => (
                            <option key={d} value={d}>{d}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Per-file record count badge */}
                  {!entry.allDates && (entry.dateFrom || entry.dateTo) && (
                    <div className="mt-2 text-xs text-[#5B66E2] dark:text-[#8B96F2]">
                      {fmt(mergeFilteredCounts[idx])} records selected
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Footer */}
            <div className="px-6 py-4 border-t border-border bg-gray-50/50 dark:bg-gray-800/30">
              {/* Total summary pill */}
              <div className="mb-4 p-3 rounded-lg bg-[#5B66E2]/10 dark:bg-[#5B66E2]/20 border border-[#5B66E2]/20 dark:border-[#5B66E2]/30 flex items-center gap-2 text-sm text-[#5B66E2] dark:text-[#8B96F2]">
                <Merge className="w-4 h-4 flex-shrink-0" />
                <span className="font-medium">{fmt(mergeTotalFilteredCount)}</span> records will be merged
                <span className="text-xs opacity-70">(duplicates removed automatically)</span>
              </div>
              <div className="flex items-center justify-end gap-3">
                <Button
                  onClick={handleMergeDateCancel}
                  className="bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 border border-gray-300 dark:border-gray-600"
                >
                  Cancel
                </Button>
                <Button
                  onClick={handleMergeDateConfirm}
                  disabled={mergeTotalFilteredCount === 0}
                  className="bg-[#4a55d1] hover:bg-[#4048c0] text-white disabled:opacity-50"
                >
                  Merge &amp; Import
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
