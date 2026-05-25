"use client";

import { useEffect, useMemo, useState, useRef, useCallback, Component, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AgGridReact, useGridFilter } from "ag-grid-react";
import type { CustomFilterProps } from "ag-grid-react";
import {
  AllCommunityModule,
  ModuleRegistry,
  type ColDef,
  type CellValueChangedEvent,
  type GridReadyEvent,
  type GridApi,
  type PaginationChangedEvent,
  themeQuartz,
} from "ag-grid-community";
import { useAuth } from "@/context/AuthContext";
import {
  createAuditLog,
  exportAllRecords,
  downloadAllRecordsCSV,
  createTransaction,
  updateTransaction,
  bulkDeleteTransactions,
} from "@/lib/api";
import { useUploadRecords } from "@/lib/queries";
import { Plus, Trash2, Download, ChevronDown, Undo2, Redo2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { exportToCSV, exportToExcel } from "@/utils/exportUtils";
import { useData } from "@/context/DataContext";
import type { ParsedData, PaymentRecord } from "@/types/data";
import { useQueryClient } from "@tanstack/react-query";

ModuleRegistry.registerModules([AllCommunityModule]);

/**
 * Module-level set of session IDs for which the full dataset has been loaded
 * into DataContext in this tab session. Persists across page navigation
 * (preventing redundant full-loads on back-navigation) and resets on page
 * refresh (in sync with DataContext, so the full-load re-runs cleanly).
 */
const completedFullLoads = new Set<string>();

/* ------------------------------------------------------------------ */
/*  Custom AG Grid theme matching M3 Expressive design                */
/* ------------------------------------------------------------------ */
const m3Theme = themeQuartz.withParams({
  accentColor: "#6750A4",
  borderRadius: 12,
  browserColorScheme: "inherit",
  headerBackgroundColor: "hsl(var(--muted))",
  headerTextColor: "hsl(var(--foreground))",
  rowHoverColor: "hsl(var(--muted) / 0.5)",
  selectedRowBackgroundColor: "hsl(var(--primary) / 0.08)",
  oddRowBackgroundColor: "transparent",
  fontFamily: "var(--font-jeko), sans-serif",
  fontSize: 14,
  headerFontSize: 13,
  headerFontWeight: 600,
  rowBorder: true,
  columnBorder: true,
  wrapperBorderRadius: 16,
  spacing: 6,
  cellHorizontalPadding: 12,
});

/* ------------------------------------------------------------------ */
/*  Row type                                                          */
/* ------------------------------------------------------------------ */
interface SheetRow {
  id?: string | null;
  bank: string;
  paymentDate: string;
  paymentAmount: number;
  account: string;
  touchpoint: string;
  environment?: string;
}

const emptyRow: SheetRow = {
  id: null,
  bank: "",
  paymentDate: "",
  paymentAmount: 0,
  account: "",
  touchpoint: "",
  environment: "",
};

/* ------------------------------------------------------------------ */
/*  Error Boundary for AG Grid                                        */
/* ------------------------------------------------------------------ */
class GridErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error.message };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-64 gap-3 rounded-2xl border border-destructive/40 bg-destructive/5 text-destructive">
          <span className="text-lg font-semibold">Grid Error</span>
          <span className="text-sm text-muted-foreground max-w-sm text-center">
            {this.state.message || "An unexpected error occurred while rendering the grid."}
          </span>
          <button
            className="mt-2 rounded-xl border border-destructive/40 px-4 py-1 text-sm hover:bg-destructive/10"
            onClick={() => this.setState({ hasError: false, message: "" })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ------------------------------------------------------------------ */
/*  Custom Set Filter (AG Grid Community doesn't have agSetColumnFilter) */
/* ------------------------------------------------------------------ */
function SetFilter({ model, onModelChange, colDef, api }: CustomFilterProps<SheetRow, unknown, string[]>) {
  const field = colDef.field as keyof SheetRow;

  // Gather unique values from row data
  const allValues = useMemo(() => {
    const vals = new Set<string>();
    api.forEachNode((node) => {
      if (node.data) {
        const v = String(node.data[field] ?? "");
        if (v) vals.add(v);
      }
    });
    return Array.from(vals).sort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, field]);

  const selected = useMemo(() => (model ? new Set(model) : new Set(allValues)), [model, allValues]);

  const doesFilterPass = useCallback(
    (params: { data: SheetRow }) => {
      if (!model) return true;
      const val = String(params.data[field] ?? "");
      return selected.has(val);
    },
    [model, field, selected]
  );

  useGridFilter({ doesFilterPass });

  const toggle = (val: string) => {
    const next = new Set(selected);
    if (next.has(val)) next.delete(val);
    else next.add(val);
    // If all selected, clear model (no filter)
    onModelChange(next.size >= allValues.length ? null : Array.from(next));
  };

  const selectAll = () => onModelChange(null);
  const selectNone = () => onModelChange([]);

  return (
    <div className="p-2 max-h-72 overflow-y-auto min-w-[180px]" style={{ fontSize: 13 }}>
      <div className="flex gap-2 mb-2">
        <button onClick={selectAll} className="text-xs text-primary hover:underline">All</button>
        <button onClick={selectNone} className="text-xs text-primary hover:underline">None</button>
      </div>
      {allValues.map((val) => (
        <label key={val} className="flex items-center gap-2 py-0.5 cursor-pointer hover:bg-muted/50 rounded px-1">
          <input
            type="checkbox"
            checked={selected.has(val)}
            onChange={() => toggle(val)}
            className="accent-[hsl(var(--primary))]"
          />
          <span className="truncate">{val}</span>
        </label>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Page                                                              */
/* ------------------------------------------------------------------ */
export default function SheetsPage() {
  const { data, setData, rawData, setRawData, fileName, setFileName, sessionId, setSessionId, sessionValidated } =
    useData();
  const { token } = useAuth();
  const queryClient = useQueryClient();
  const router = useRouter();

  // Use cached TanStack Query data for backend session (avoids re-fetch on every navigation).
  // dataIsComplete: true once a full-load (or session with ≤10k records) has completed.
  // Uses a module-level Set — no race condition with sessions cache loading timing.
  const paymentsHaveIds = !!(data?.payments?.length && data.payments.some((p) => p.id));
  const dataIsComplete = !!(paymentsHaveIds && sessionId && completedFullLoads.has(sessionId));
  const { data: uploadDetail, isLoading: uploadLoading } = useUploadRecords(
    token, (!data || !dataIsComplete) ? sessionId : null, sessionValidated
  );

  const [rows, setRows] = useState<SheetRow[]>([]);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isAwaitingData, setIsAwaitingData] = useState(false);
  const [awaitingTotal, setAwaitingTotal] = useState<number | null>(null);
  const needsFullLoadRef = useRef<{ total: number } | null>(null);
  const [fullLoadTrigger, setFullLoadTrigger] = useState(0);
  const gridRef = useRef<AgGridReact<SheetRow>>(null);
  const gridApiRef = useRef<GridApi<SheetRow> | null>(null);
  const skipNextDataEffect = useRef(false);
  const [paginationInfo, setPaginationInfo] = useState({
    from: 0,
    to: 0,
    total: 0,
    page: 1,
    totalPages: 1,
  });
  const [pageSize, setPageSize] = useState(50);
  const [pageInput, setPageInput] = useState("");

  /* ---- undo/redo stacks ---- */
  const undoStack = useRef<SheetRow[][]>([]);
  const redoStack = useRef<SheetRow[][]>([]);
  const MAX_UNDO = 50; // cap memory: 50 snapshots × ~rows × ~200 bytes each
  const pushUndo = (snapshot: SheetRow[]) => {
    undoStack.current.push(snapshot.map((r) => ({ ...r })));
    if (undoStack.current.length > MAX_UNDO) {
      undoStack.current.shift(); // drop the oldest entry
    }
    redoStack.current = [];
  };

  /* ---- recalc analytics ---- */
  const recalcParsedData = useCallback(
    (payments: PaymentRecord[]): ParsedData => {
      const bankMap = new Map<
        string,
        { count: Set<string>; amountCents: number; paymentCount: number }
      >();
      const tpMap = new Map<string, { count: number; amountCents: number }>();
      const accountSet = new Set<string>();
      let totalCents = 0;
      for (const p of payments) {
        totalCents += Math.round(p.paymentAmount * 100);
        accountSet.add(p.account);
        const bk = bankMap.get(p.bank) ?? {
          count: new Set<string>(),
          amountCents: 0,
          paymentCount: 0,
        };
        bk.count.add(p.account);
        bk.amountCents += Math.round(p.paymentAmount * 100);
        bk.paymentCount += 1;
        bankMap.set(p.bank, bk);
        const tp = tpMap.get(p.touchpoint) ?? { count: 0, amountCents: 0 };
        tp.count += 1;
        tp.amountCents += Math.round(p.paymentAmount * 100);
        tpMap.set(p.touchpoint, tp);
      }
      const totalAmount = totalCents / 100;
      const bankAnalytics = Array.from(bankMap.entries()).map(([bank, v]) => ({
        bank,
        accountCount: v.count.size,
        totalAmount: v.amountCents / 100,
        debtorSum: 0,
        percentage:
          totalAmount > 0 ? (v.amountCents / 100 / totalAmount) * 100 : 0,
        paymentCount: v.paymentCount,
      }));
      const touchpointAnalytics = Array.from(tpMap.entries()).map(
        ([touchpoint, v]) => ({
          touchpoint,
          count: v.count,
          totalAmount: v.amountCents / 100,
          percentage:
            totalAmount > 0 ? (v.amountCents / 100 / totalAmount) * 100 : 0,
        })
      );
      return {
        payments,
        bankAnalytics,
        touchpointAnalytics,
        totalAccounts: accountSet.size,
        totalAmount,
        totalPayments: payments.length,
        raw: payments.map((p) => ({
          Bank: p.bank,
          "Payment Date": p.paymentDate,
          "Payment Amount": p.paymentAmount,
          Account: p.account,
          Touchpoint: p.touchpoint,
        })),
      };
    },
    []
  );

  /* ---- sync local edits back to DataContext ---- */
  const syncToContext = useCallback(
    (updatedRows: SheetRow[]) => {
      const payments: PaymentRecord[] = updatedRows.map((r) => ({
        id: r.id ?? undefined,
        bank: r.bank,
        paymentDate: r.paymentDate,
        paymentAmount: Number.isFinite(r.paymentAmount) ? r.paymentAmount : 0,
        account: r.account,
        touchpoint: r.touchpoint ?? "",
        environment: r.environment ?? "",
      }));
      const parsed = recalcParsedData(payments);
      skipNextDataEffect.current = true;
      setData(parsed);
      setRawData(parsed.raw);
    },
    [recalcParsedData, setData, setRawData]
  );

  /* ---- invalidate dependent queries ---- */
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["transactions"], refetchType: "all" });
    queryClient.invalidateQueries({ queryKey: ["dashboard"], refetchType: "all" });
    queryClient.invalidateQueries({ queryKey: ["uploads"], refetchType: "all" });
    queryClient.invalidateQueries({ queryKey: ["unified-audit-log"], refetchType: "all" });
  }, [queryClient]);

  /* ---- Column definitions ---- */
  const columnDefs = useMemo<ColDef<SheetRow>[]>(
    () => [
      {
        headerName: "#",
        valueGetter: (p) => (p.node?.rowIndex ?? 0) + 1,
        width: 70,
        pinned: "left",
        filter: false,
        editable: false,
        sortable: false,
        suppressMovable: true,
        headerClass: "ag-header-center",
        cellStyle: {
          color: "var(--ag-header-text-color)",
          fontWeight: "500",
          textAlign: "center",
        } as Record<string, string>,
      },
      {
        headerName: "Bank",
        field: "bank",
        filter: "agTextColumnFilter",
        minWidth: 160,
        flex: 1,
      },
      {
        headerName: "Account",
        field: "account",
        filter: "agTextColumnFilter",
        minWidth: 140,
        flex: 1,
      },
      {
        headerName: "Touchpoint",
        field: "touchpoint",
        filter: SetFilter,
        minWidth: 160,
        flex: 1,
      },
      {
        headerName: "Payment Date",
        field: "paymentDate",
        filter: "agTextColumnFilter",
        minWidth: 140,
        flex: 1,
        // Display stored YYYY-MM-DD as MM-DD-YYYY
        valueFormatter: (params) => {
          const v = String(params.value ?? "").trim();
          if (!v) return "";
          // Convert YYYY-MM-DD → MM-DD-YYYY for display
          const iso = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
          if (iso) return `${iso[2]}-${iso[3]}-${iso[1]}`;
          return v; // already in another format — show as-is
        },
        valueSetter: (params) => {
          const raw = String(params.newValue ?? "").trim();
          if (!raw) {
            params.data.paymentDate = "";
            return true;
          }

          // Accept YYYY-MM-DD (the stored ISO format)
          if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            params.data.paymentDate = raw;
            return true;
          }

          // Accept MM-DD-YYYY or MM/DD/YYYY (also accepts single digits M-D-YYYY)
          const match = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
          if (!match) {
            toast.error("Invalid date format. Use MM-DD-YYYY (e.g. 01-31-2026).");
            return false;
          }
          const [, mm, dd, yyyy] = match;
          const day = parseInt(dd, 10);
          const month = parseInt(mm, 10);
          const year = parseInt(yyyy, 10);
          const d = new Date(year, month - 1, day);
          if (
            d.getFullYear() !== year ||
            d.getMonth() + 1 !== month ||
            d.getDate() !== day
          ) {
            toast.error("Invalid date. Please enter a real date in MM-DD-YYYY format.");
            return false;
          }
          // Store as YYYY-MM-DD internally
          params.data.paymentDate = `${yyyy}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          return true;
        },
      },
      {
        headerName: "Payment Amount",
        field: "paymentAmount",
        filter: "agNumberColumnFilter",
        minWidth: 160,
        flex: 1,
        valueFormatter: (params) =>
          params.value != null
            ? Number(params.value).toLocaleString("en-PH", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })
            : "",
        cellStyle: { textAlign: "right" } as Record<string, string>,
      },
      {
        headerName: "Environment",
        field: "environment",
        filter: SetFilter,
        minWidth: 140,
        flex: 1,
      },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(
    () => ({
      editable: true,
      sortable: true,
      resizable: true,
      filter: true,
      floatingFilter: false,
      menuTabs: ["filterMenuTab"],
    }),
    []
  );

  /* ---- Load rows from data context ---- */
  useEffect(() => {
    if (skipNextDataEffect.current) {
      skipNextDataEffect.current = false;
      return;
    }
    if (!data?.payments) {
      setRows([]);
      return;
    }
    setRows(
      data.payments.map((p) => ({
        id: p.id,
        bank: p.bank,
        paymentDate: p.paymentDate,
        paymentAmount: p.paymentAmount,
        account: p.account,
        touchpoint: p.touchpoint,
        environment: p.environment ?? "",
      }))
    );
  }, [data]);

  /* ---- Load rows from backend for persisted sessions (cached via TanStack Query) ---- */
  useEffect(() => {
    if (!uploadDetail) return;
    if (dataIsComplete) return; // DataContext already has all records for this session
    if (uploadDetail.records_truncated) {
      // Dataset exceeds inline cap — show loading spinner and fetch everything
      needsFullLoadRef.current = { total: uploadDetail.total_records };
      setAwaitingTotal(uploadDetail.total_records);
      setIsAwaitingData(true);
      setFullLoadTrigger((n) => n + 1);
    } else {
      // All records fit — show them directly
      const newRows = uploadDetail.records.map((r) => ({
        id: r.id,
        bank: r.bank,
        paymentDate: r.payment_date ?? "",
        paymentAmount: r.payment_amount,
        account: r.account,
        touchpoint: r.touchpoint ?? "",
        environment: r.environment ?? "",
      }));
      setRows(newRows);
      syncToContext(newRows);
      if (sessionId) completedFullLoads.add(sessionId);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uploadDetail]);

  /* ---- Load ALL rows when session has more than 10k records ---- */
  useEffect(() => {
    if (!fullLoadTrigger || !needsFullLoadRef.current || !sessionId || !token) return;

    const totalRecords = needsFullLoadRef.current.total;
    needsFullLoadRef.current = null; // prevent re-runs
    let cancelled = false;

    const fetchAll = async () => {
      // loading state is already set via isAwaitingData
      try {
        const records = await exportAllRecords(token, sessionId);
        const allRows: SheetRow[] = records.map((r) => ({
          id: r.id,
          bank: r.bank,
          paymentDate: r.payment_date ?? "",
          paymentAmount: r.payment_amount,
          account: r.account,
          touchpoint: r.touchpoint ?? "",
          environment: r.environment ?? "",
        }));
        // Always mark complete and update DataContext — safe even if component unmounted.
        // This ensures back-navigation after mid-load navigation shows the full dataset.
        if (sessionId) completedFullLoads.add(sessionId);
        if (!cancelled) {
          setIsAwaitingData(false);
          setRows(allRows);
          syncToContext(allRows);
        } else {
          // Component unmounted mid-fetch — update DataContext directly without
          // touching component-local state (setRows) or skipNextDataEffect ref.
          // On remount, the [data] effect will pick up the full dataset from context.
          const payments = allRows.map((r) => ({
            id: r.id ?? undefined,
            bank: r.bank,
            paymentDate: r.paymentDate,
            paymentAmount: Number.isFinite(r.paymentAmount) ? r.paymentAmount : 0,
            account: r.account,
            touchpoint: r.touchpoint ?? "",
            environment: r.environment ?? "",
          }));
          const parsed = recalcParsedData(payments);
          setData(parsed);
          setRawData(parsed.raw);
        }
      } catch (err) {
        if (!cancelled) {
          setIsAwaitingData(false);
          toast.error(
            `Failed to load all records: ${err instanceof Error ? err.message : "Network error"}.`
          );
        }
      }
    };

    fetchAll();
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullLoadTrigger]);

  /* ---- Cell edit handler ---- */
  const onCellValueChanged = useCallback(
    (event: CellValueChangedEvent<SheetRow>) => {
      const { data: rowData, colDef, oldValue, newValue } = event;
      if (!rowData || oldValue === newValue) return;

      const field = colDef.field as keyof SheetRow | undefined;
      if (!field) return;

      // Parse paymentAmount back to number if edited as string
      if (field === "paymentAmount") {
        const num = parseFloat(String(newValue).replace(/,/g, ""));
        if (!Number.isFinite(num)) return;
        rowData.paymentAmount = num;
      }

      // Push undo
      pushUndo(rows);

      // Update local state
      const updatedRows = rows.map((r) =>
        r === rowData ? { ...rowData } : r
      );
      setRows(updatedRows);
      syncToContext(updatedRows);

      // Persist to backend
      const id = rowData.id;
      if (token && sessionId && !id) {
        // New row with no backend ID yet — create it on first edit if the
        // minimum required fields are present (bank + account).
        if (rowData.bank && rowData.account) {
          (async () => {
            try {
              const rec = await createTransaction(token, sessionId, {
                bank: rowData.bank,
                account: rowData.account,
                touchpoint: rowData.touchpoint || undefined,
                payment_date: rowData.paymentDate || undefined,
                payment_amount: rowData.paymentAmount || 0,
                environment: rowData.environment || undefined,
              });
              // Patch the row with the real backend ID so future edits use updateTransaction
              setRows((prev) =>
                prev.map((r) => (r === rowData ? { ...r, id: rec.id } : r))
              );
              invalidateAll();
            } catch (err) {
              toast.error(`Failed to save new row: ${err instanceof Error ? err.message : "Network error"}`);
            }
          })();
        }
      } else if (token && sessionId && id) {        (async () => {
          try {
            await updateTransaction(token, sessionId, id, {
              bank: rowData.bank,
              account: rowData.account,
              touchpoint: rowData.touchpoint || undefined,
              payment_date: rowData.paymentDate || undefined,
              payment_amount: rowData.paymentAmount || 0,
              environment: rowData.environment || undefined,
            });
            try {
              await createAuditLog(token, {
                action: "record_update",
                file_name: fileName || "uploaded",
                session_id: sessionId,
                record_count: 1,
                details: `Updated record ${id}`,
                snapshot_data: JSON.stringify({
                  session_id: sessionId,
                  field,
                  old: oldValue,
                  new: newValue,
                }),
              });
            } catch {
              // best-effort audit
            }
            invalidateAll();
          } catch (err) {
            // Save failed — revert the cell to its previous value so the UI
            // stays in sync with the database.
            toast.error(`Save failed: ${err instanceof Error ? err.message : "Network error"}. Change reverted.`);
            // Use functional update to avoid stale closure over `rows` —
            // the user may have made additional edits while this save was in-flight.
            setRows((currentRows) => {
              const reverted = currentRows.map((r) =>
                r === rowData ? { ...rowData, [field]: oldValue } : r
              );
              // syncToContext inside the functional updater so it always
              // receives the same array that setRows will commit.
              syncToContext(reverted);
              return reverted;
            });
          }
        })();
      } else {
        if (token) {
          createAuditLog(token, {
            action: "record_update",
            file_name: fileName || "local",
            session_id: sessionId ?? null,
            record_count: 1,
            details: `Updated column ${String(field)}`,
            snapshot_data: JSON.stringify({
              session_id: sessionId ?? null,
              field,
              old: oldValue,
              new: newValue,
            }),
          }).catch(() => {});
        }
        invalidateAll();
      }
    },
    [rows, token, sessionId, fileName, syncToContext, invalidateAll]
  );

  /* ---- Grid ready ---- */
  const onGridReady = useCallback((params: GridReadyEvent<SheetRow>) => {
    gridApiRef.current = params.api;
  }, []);

  /* ---- Pagination info ---- */
  const onPaginationChanged = useCallback(
    (event: PaginationChangedEvent<SheetRow>) => {
      const api = event.api;
      const currentPage = api.paginationGetCurrentPage();
      const ps = api.paginationGetPageSize();
      const totalRows = api.paginationGetRowCount();
      const totalPages = api.paginationGetTotalPages();
      const from = totalRows === 0 ? 0 : currentPage * ps + 1;
      const to = Math.min((currentPage + 1) * ps, totalRows);
      setPaginationInfo({
        from,
        to,
        total: totalRows,
        page: currentPage + 1,
        totalPages,
      });
    },
    []
  );

  /* ---- Add row ---- */
  const addRow = useCallback(() => {
    pushUndo(rows);
    const tempRow: SheetRow = { ...emptyRow, id: null };
    const newRows = [tempRow, ...rows];
    setRows(newRows);
    syncToContext(newRows);
    // Don't create a backend record yet — wait until the user fills in the row
    // and triggers onCellValueChanged. Creating an empty record immediately
    // would persist junk data (bank="", account="", amount=0) to the database.
    toast.success("Row added — fill in the fields and they will save automatically.");
    invalidateAll();
  }, [rows, syncToContext, invalidateAll]);

  /* ---- Delete selected rows ---- */
  const deleteSelected = useCallback(() => {
    const api = gridApiRef.current;
    if (!api) return;
    const selected = api.getSelectedRows();
    if (selected.length === 0) {
      toast.error("Select at least one row to delete.");
      return;
    }
    const count = selected.length;

    toast(`Delete ${count} row${count > 1 ? "s" : ""}?`, {
      description: "This action cannot be undone.",
      position: "bottom-right",
      action: {
        label: "Delete",
        onClick: () => {
          pushUndo(rows);
          const selectedSet = new Set(selected);
          const deletedRows = selected.map((r) => ({
            bank: r.bank,
            account: r.account,
            touchpoint: r.touchpoint,
            paymentDate: r.paymentDate,
            paymentAmount: r.paymentAmount,
            environment: r.environment,
            id: r.id,
          }));

          (async () => {
            setIsDeleting(true);
            try {
              if (token && sessionId) {
                const ids = deletedRows
                  .map((r) => r.id)
                  .filter(Boolean) as string[];
                if (ids.length > 0) {
                  // Batch deletes in chunks of 1000 (backend max per request)
                  const BATCH = 1000;
                  let totalDeleted = 0;
                  for (let i = 0; i < ids.length; i += BATCH) {
                    const chunk = ids.slice(i, i + BATCH);
                    const result = await bulkDeleteTransactions(
                      token,
                      sessionId,
                      chunk
                    );
                    totalDeleted += result.deleted;
                  }
                  if (totalDeleted < ids.length) {
                    toast.error(
                      `${ids.length - totalDeleted} deletions failed on server.`
                    );
                  }
                }
              }

              const newRows = rows.filter((r) => !selectedSet.has(r));
              setRows(newRows);
              syncToContext(newRows);
              toast.success(`${count} row${count > 1 ? "s" : ""} deleted.`);
              invalidateAll();

              // If all records are deleted, _update_session_totals on the backend
              // already auto-deleted the session via CASCADE. Just clear local state.
              if (newRows.length === 0) {
                setData(null);
                setSessionId(null);
                setFileName("");
                // Invalidate specific queries rather than nuking the entire cache
                // (queryClient.clear() would wipe auth state and force full reloads)
                queryClient.invalidateQueries({ queryKey: ["uploads"] });
                queryClient.invalidateQueries({ queryKey: ["dashboard"] });
                queryClient.invalidateQueries({ queryKey: ["transactions"] });
                queryClient.invalidateQueries({ queryKey: ["upload-records"] });
                toast.info("All records deleted. Please upload a new file.");
                router.push("/upload");
              }
            } catch (err) {
              toast.error(
                "Bulk delete failed: " +
                  (err instanceof Error ? err.message : String(err))
              );
            } finally {
              setIsDeleting(false);
            }
          })();
        },
      },
    });
  }, [rows, token, sessionId, syncToContext, invalidateAll]);

  /* ---- Undo / Redo ---- */
  const undo = useCallback(() => {
    if (undoStack.current.length === 0) return;
    redoStack.current.push(rows.map((r) => ({ ...r })));
    const prev = undoStack.current.pop()!;
    setRows(prev);
    syncToContext(prev);
  }, [rows, syncToContext]);

  const redo = useCallback(() => {
    if (redoStack.current.length === 0) return;
    undoStack.current.push(rows.map((r) => ({ ...r })));
    const next = redoStack.current.pop()!;
    setRows(next);
    syncToContext(next);
  }, [rows, syncToContext]);

  /* ---- Export ---- */
  const handleExport = useCallback(
    async (format: "excel" | "csv") => {
      try {
        // For CSV, if we have a backend session, use the server-side streaming endpoint
        // which is safe for any dataset size (no memory cap).
        if (format === "csv" && token && sessionId) {
          await downloadAllRecordsCSV(token, sessionId, fileName || "export");
          toast.success("CSV download started.");
          return;
        }

        // Excel export (and CSV fallback when no session) uses in-memory rows
        const exportData = rows.map((r) => ({
          Bank: r.bank,
          "Payment Date": r.paymentDate,
          "Payment Amount": r.paymentAmount,
          Account: r.account,
          Touchpoint: r.touchpoint ?? "",
          Environment: r.environment ?? "",
        }));
        const name = `sheet_export_${new Date().toISOString().split("T")[0]}`;
        if (format === "excel") {
          await exportToExcel(exportData, name);
        } else {
          exportToCSV(exportData, name);
        }
        toast.success(
          `Exported ${exportData.length} records to ${format === "excel" ? "Excel" : "CSV"}`
        );
      } catch (err) {
        toast.error(`Export failed: ${err instanceof Error ? err.message : "Unknown error"}`);
      }
    },
    [rows, token, sessionId, fileName]
  );

  /* ---- Loading state (fetching from backend or awaiting full dataset) ---- */
  if (uploadLoading || isAwaitingData || (rows.length === 0 && sessionId && !data)) {
    return (
      <div className="px-4 sm:px-8 py-8 min-h-screen flex items-center justify-center">
        <div className="flex flex-col items-center gap-5 p-10 rounded-2xl bg-card border border-border shadow-lg min-w-[300px] text-center">
          <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <div>
            <h2 className="text-lg font-semibold mb-1">Loading Data</h2>
            <p className="text-sm text-muted-foreground">
              {isAwaitingData && awaitingTotal
                ? `Fetching all ${awaitingTotal.toLocaleString()} records…`
                : "Loading spreadsheet data…"}
            </p>
          </div>
        </div>
      </div>
    );
  }

  /* ---- Empty state ---- */
  if (!data && rows.length === 0) {
    return (
      <div className="px-4 sm:px-8 py-8 min-h-screen">
        <div className="p-10 rounded-2xl text-center bg-card border border-border">
          <h1 className="text-2xl font-semibold mb-2">Sheets</h1>
          <p className="text-muted-foreground">
            Upload data first to open it as a spreadsheet.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 sm:px-8 py-6 min-h-screen flex flex-col">
      {/* Header + Toolbar */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Sheets</h1>
          <p className="text-sm text-muted-foreground">
            {fileName || "Sheet"} &mdash; {rows.length.toLocaleString()} records
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Undo / Redo */}
          <Button
            variant="ghost"
            size="icon"
            onClick={undo}
            title="Undo"
            className="rounded-full"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={redo}
            title="Redo"
            className="rounded-full"
          >
            <Redo2 className="h-4 w-4" />
          </Button>

          <div className="w-px h-6 bg-border mx-1" />

          {/* + Row */}
          <Button variant="outline" className="gap-2" onClick={addRow}>
            <Plus className="h-4 w-4" /> Row
          </Button>

          {/* Delete Selected */}
          <Button
            variant="outline"
            className="gap-2 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={deleteSelected}
          >
            <Trash2 className="h-4 w-4" /> Delete Selected
          </Button>

          <div className="w-px h-6 bg-border mx-1" />

          {/* Export */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" className="gap-2">
                <Download className="h-4 w-4" />
                Export
                <ChevronDown className="h-3 w-3 ml-1" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-40 p-1" align="end">
              <button
                onClick={() => handleExport("excel")}
                className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors"
              >
                Export as XLSX
              </button>
              <button
                onClick={() => handleExport("csv")}
                className="w-full text-left px-3 py-2 text-sm rounded-lg hover:bg-muted transition-colors"
              >
                Export as CSV
              </button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {/* AG Grid */}
      <GridErrorBoundary>
      <div style={{ width: "100%", height: "calc(100vh - 240px)", position: "relative" }}>
        {isDeleting && (
          <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm rounded-lg">
            <div className="flex flex-col items-center gap-3">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
              <span className="text-sm font-medium text-muted-foreground">Deleting rows…</span>
            </div>
          </div>
        )}
        <AgGridReact<SheetRow>
          ref={gridRef}
          theme={m3Theme}
          rowData={rows}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          rowSelection={{
            mode: "multiRow",
            checkboxes: true,
            headerCheckbox: true,
            enableClickSelection: false,
          }}
          onGridReady={onGridReady}
          onCellValueChanged={onCellValueChanged}
          onPaginationChanged={onPaginationChanged}
          pagination
          paginationPageSize={pageSize}
          paginationPageSizeSelector={[25, 50, 100, 500]}
          suppressPaginationPanel
          animateRows
          enableCellTextSelection
          ensureDomOrder
        />
      </div>
      </GridErrorBoundary>

      {/* Custom pagination footer */}
      <div className="mt-3 flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <span>Page Size:</span>
          <select
            value={pageSize}
            onChange={(e) => {
              const val = Number(e.target.value);
              setPageSize(val);
              gridApiRef.current?.setGridOption("paginationPageSize", val);
            }}
            className="rounded-xl border border-border bg-background px-2 py-1 text-sm"
          >
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={500}>500</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <span>
            {paginationInfo.from} to {paginationInfo.to} of{" "}
            {paginationInfo.total.toLocaleString()}
          </span>
          <button
            onClick={() => gridApiRef.current?.paginationGoToFirstPage()}
            disabled={paginationInfo.page <= 1}
            className="px-2 py-1 rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            &laquo;
          </button>
          <button
            onClick={() => gridApiRef.current?.paginationGoToPreviousPage()}
            disabled={paginationInfo.page <= 1}
            className="px-2 py-1 rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            &lsaquo;
          </button>
          <span className="flex items-center gap-1">
            <span>Page</span>
            <input
              type="number"
              min={1}
              max={paginationInfo.totalPages}
              value={pageInput !== "" ? pageInput : paginationInfo.page}
              onChange={(e) => setPageInput(e.target.value)}
              onBlur={() => {
                const p = parseInt(pageInput, 10);
                if (!isNaN(p) && p >= 1 && p <= paginationInfo.totalPages) {
                  gridApiRef.current?.paginationGoToPage(p - 1);
                }
                setPageInput("");
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const p = parseInt(pageInput, 10);
                  if (!isNaN(p) && p >= 1 && p <= paginationInfo.totalPages) {
                    gridApiRef.current?.paginationGoToPage(p - 1);
                  }
                  setPageInput("");
                }
              }}
              className="w-14 rounded-full border border-border bg-background px-2 py-1 text-sm text-center font-medium [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            />
            <span>of {paginationInfo.totalPages.toLocaleString()}</span>
          </span>
          <button
            onClick={() => gridApiRef.current?.paginationGoToNextPage()}
            disabled={paginationInfo.page >= paginationInfo.totalPages}
            className="px-2 py-1 rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            &rsaquo;
          </button>
          <button
            onClick={() => gridApiRef.current?.paginationGoToLastPage()}
            disabled={paginationInfo.page >= paginationInfo.totalPages}
            className="px-2 py-1 rounded-lg border border-border hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            &raquo;
          </button>
        </div>
      </div>
    </div>
  );
}
