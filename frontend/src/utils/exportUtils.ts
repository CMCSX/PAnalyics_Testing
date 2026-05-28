import ExcelJS from "exceljs";
import { DataRow, BankAnalytics, TouchpointAnalytics } from "@/types/data";

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, "_").substring(0, 100);
}

function triggerDownload(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  link.style.visibility = "hidden";
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

// ── Export Options Interface ─────────────────────────────────────────────────

export interface ExportOptions {
  /** Specific fields to include (default: all) */
  fields?: string[];
  /** Include summary analytics sheet */
  includeSummary?: boolean;
  /** Bank analytics data for summary */
  bankAnalytics?: BankAnalytics[];
  /** Touchpoint analytics data for summary */
  touchpointAnalytics?: TouchpointAnalytics[];
  /** Total amount for summary header */
  totalAmount?: number;
  /** Date range label for header */
  dateRangeLabel?: string;
  /** Apply number formatting to currency columns */
  formatCurrency?: boolean;
}

// ── Excel Export (Enhanced) ──────────────────────────────────────────────────

export async function exportToExcel(
  data: DataRow[],
  fileName: string = "report",
  options: ExportOptions = {}
): Promise<void> {
  if (data.length === 0) return;
  const safeName = sanitizeFileName(fileName);
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "PayAnalytics";
  workbook.created = new Date();

  // Determine columns
  const allKeys = Object.keys(data[0]);
  const keys = options.fields && options.fields.length > 0
    ? options.fields.filter((f) => allKeys.includes(f))
    : allKeys;

  // ── Data Sheet ──
  const dataSheet = workbook.addWorksheet("Report");

  // Header row with styling
  dataSheet.columns = keys.map((key) => ({
    header: key,
    key,
    width: Math.max(key.length + 4, 15),
  }));

  const headerRow = dataSheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF5B66E2" },
  };
  headerRow.alignment = { horizontal: "center" };

  // Add data rows
  for (const row of data) {
    const rowData: Record<string, unknown> = {};
    for (const k of keys) {
      rowData[k] = row[k];
    }
    dataSheet.addRow(rowData);
  }

  // Auto-fit columns based on content
  dataSheet.columns.forEach((col) => {
    let maxLen = (col.header as string)?.length || 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      const len = String(cell.value ?? "").length;
      if (len > maxLen) maxLen = len;
    });
    col.width = Math.min(maxLen + 2, 40);
  });

  // Currency formatting
  if (options.formatCurrency) {
    const amountIdx = keys.findIndex((k) => k.toLowerCase().includes("amount"));
    if (amountIdx >= 0) {
      dataSheet.getColumn(amountIdx + 1).numFmt = "₱#,##0.00";
    }
  }

  // ── Summary Sheet (optional) ──
  if (options.includeSummary) {
    const summarySheet = workbook.addWorksheet("Summary");

    // Title
    summarySheet.mergeCells("A1:D1");
    const titleCell = summarySheet.getCell("A1");
    titleCell.value = "PayAnalytics Report Summary";
    titleCell.font = { bold: true, size: 14, color: { argb: "FF5B66E2" } };
    titleCell.alignment = { horizontal: "center" };

    // Metadata
    summarySheet.getCell("A3").value = "Generated:";
    summarySheet.getCell("B3").value = new Date().toLocaleDateString();
    summarySheet.getCell("A4").value = "Total Records:";
    summarySheet.getCell("B4").value = data.length;
    if (options.totalAmount !== undefined) {
      summarySheet.getCell("A5").value = "Total Amount:";
      summarySheet.getCell("B5").value = options.totalAmount;
      summarySheet.getCell("B5").numFmt = "₱#,##0.00";
    }
    if (options.dateRangeLabel) {
      summarySheet.getCell("A6").value = "Date Range:";
      summarySheet.getCell("B6").value = options.dateRangeLabel;
    }

    // Bank Analytics
    if (options.bankAnalytics && options.bankAnalytics.length > 0) {
      let row = 8;
      summarySheet.getCell(`A${row}`).value = "Bank Breakdown";
      summarySheet.getCell(`A${row}`).font = { bold: true, size: 12 };
      row++;

      const bankHeaders = ["Bank", "Touchpoint Type", "Payments", "Total Amount", "Accounts", "% of Total"];
      bankHeaders.forEach((h, i) => {
        const cell = summarySheet.getCell(row, i + 1);
        cell.value = h;
        cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B66E2" } };
      });
      row++;

      for (const b of options.bankAnalytics) {
        summarySheet.getCell(row, 1).value = b.bank;
        summarySheet.getCell(row, 2).value = b.touchpointType || "—";
        summarySheet.getCell(row, 3).value = b.paymentCount;
        summarySheet.getCell(row, 4).value = b.totalAmount;
        summarySheet.getCell(row, 4).numFmt = "₱#,##0.00";
        summarySheet.getCell(row, 5).value = b.accountCount;
        summarySheet.getCell(row, 6).value = `${b.percentage.toFixed(2)}%`;
        row++;
      }

      // Touchpoint Analytics
      if (options.touchpointAnalytics && options.touchpointAnalytics.length > 0) {
        row += 2;
        summarySheet.getCell(`A${row}`).value = "Touchpoint Breakdown";
        summarySheet.getCell(`A${row}`).font = { bold: true, size: 12 };
        row++;

        const tpHeaders = ["Touchpoint", "Count", "Total Amount", "% of Total"];
        tpHeaders.forEach((h, i) => {
          const cell = summarySheet.getCell(row, i + 1);
          cell.value = h;
          cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B66E2" } };
        });
        row++;

        for (const t of options.touchpointAnalytics) {
          summarySheet.getCell(row, 1).value = t.touchpoint;
          summarySheet.getCell(row, 2).value = t.count;
          summarySheet.getCell(row, 3).value = t.totalAmount;
          summarySheet.getCell(row, 3).numFmt = "₱#,##0.00";
          summarySheet.getCell(row, 4).value = `${t.percentage.toFixed(2)}%`;
          row++;
        }
      }
    }

    summarySheet.columns.forEach((col) => {
      col.width = 20;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  triggerDownload(blob, `${safeName}.xlsx`);
}

// ── CSV Export (Enhanced with BOM and field selection) ────────────────────────

export function exportToCSV(
  data: DataRow[],
  fileName: string = "report",
  options: ExportOptions = {}
): void {
  if (data.length === 0) return;
  const safeName = sanitizeFileName(fileName);
  const allKeys = Object.keys(data[0]);
  const keys = options.fields && options.fields.length > 0
    ? options.fields.filter((f) => allKeys.includes(f))
    : allKeys;

  const escapeCell = (val: unknown): string => {
    const str = String(val ?? "");
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  };

  const csvRows = [
    keys.map(escapeCell).join(","),
    ...data.map((row) => keys.map((k) => escapeCell(row[k])).join(",")),
  ];
  const csv = csvRows.join("\n");

  // Add BOM for proper Unicode handling in Excel
  const BOM = "\uFEFF";
  const blob = new Blob([BOM + csv], { type: "text/csv;charset=utf-8;" });
  triggerDownload(blob, `${safeName}.csv`);
}

// ── JSON Export ──────────────────────────────────────────────────────────────

export function exportToJSON(
  data: DataRow[],
  fileName: string = "report",
  options: ExportOptions = {}
): void {
  if (data.length === 0) return;
  const safeName = sanitizeFileName(fileName);

  const allKeys = Object.keys(data[0]);
  const keys = options.fields && options.fields.length > 0
    ? options.fields.filter((f) => allKeys.includes(f))
    : allKeys;

  const filtered = data.map((row) => {
    const obj: Record<string, unknown> = {};
    for (const k of keys) {
      obj[k] = row[k];
    }
    return obj;
  });

  const output = {
    metadata: {
      exportedAt: new Date().toISOString(),
      totalRecords: filtered.length,
      fields: keys,
      ...(options.totalAmount !== undefined ? { totalAmount: options.totalAmount } : {}),
      ...(options.dateRangeLabel ? { dateRange: options.dateRangeLabel } : {}),
    },
    data: filtered,
    ...(options.includeSummary && options.bankAnalytics
      ? {
          summary: {
            bankAnalytics: options.bankAnalytics,
            touchpointAnalytics: options.touchpointAnalytics || [],
          },
        }
      : {}),
  };

  const json = JSON.stringify(output, null, 2);
  const blob = new Blob([json], { type: "application/json;charset=utf-8;" });
  triggerDownload(blob, `${safeName}.json`);
}

// ── Chart Image Export ───────────────────────────────────────────────────────

export async function exportChartAsImage(
  chartContainerId: string,
  fileName: string = "chart",
  format: "png" | "svg" = "png"
): Promise<void> {
  const container = document.getElementById(chartContainerId);
  if (!container) return;

  const svg = container.querySelector("svg");
  if (!svg) return;

  const safeName = sanitizeFileName(fileName);

  if (format === "svg") {
    const serializer = new XMLSerializer();
    const svgStr = serializer.serializeToString(svg);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    triggerDownload(blob, `${safeName}.svg`);
    return;
  }

  // PNG export via canvas
  const svgData = new XMLSerializer().serializeToString(svg);
  const svgBlob = new Blob([svgData], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const img = new Image();
  img.onload = () => {
    canvas.width = img.width * 2; // 2x for retina
    canvas.height = img.height * 2;
    ctx.scale(2, 2);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, img.width, img.height);
    ctx.drawImage(img, 0, 0);
    canvas.toBlob((blob) => {
      if (blob) triggerDownload(blob, `${safeName}.png`);
      URL.revokeObjectURL(svgUrl);
    }, "image/png");
  };
  img.src = svgUrl;
}

// ── PDF Export (Enhanced print layout) ───────────────────────────────────────

export function exportToPDF(
  elementId: string,
  fileName: string = "report"
): void {
  const element = document.getElementById(elementId);
  if (!element) return;

  // Use textContent-based approach to avoid XSS via innerHTML
  const printWindow = window.open("", "", "height=600,width=800");
  if (!printWindow) return;

  const safeTitle = document.createTextNode(sanitizeFileName(fileName));
  printWindow.document.title = safeTitle.textContent || "Report";

  const style = printWindow.document.createElement("style");
  style.textContent = `
    body { font-family: 'Segoe UI', Arial, sans-serif; padding: 20px; color: #1e293b; }
    h1 { color: #5B66E2; font-size: 24px; margin-bottom: 8px; }
    h2 { color: #334155; font-size: 18px; margin-top: 24px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th { background: #5B66E2; color: white; padding: 8px 12px; text-align: left; font-size: 12px; }
    td { padding: 6px 12px; border-bottom: 1px solid #e2e8f0; font-size: 12px; }
    tr:nth-child(even) { background: #f8fafc; }
    .kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin: 16px 0; }
    .kpi-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; }
    .kpi-value { font-size: 20px; font-weight: bold; color: #5B66E2; }
    .kpi-label { font-size: 11px; color: #64748b; margin-top: 4px; }
    @media print { body { padding: 0; } }
  `;
  printWindow.document.head.appendChild(style);

  // Clone the element to avoid XSS instead of using innerHTML
  const clonedContent = element.cloneNode(true);
  printWindow.document.body.appendChild(clonedContent);
  printWindow.document.close(); // signal to browser that document is ready
  printWindow.print();
}

// ── Available Export Fields ──────────────────────────────────────────────────

export const EXPORT_FIELDS = [
  { key: "Bank", label: "Bank", default: true },
  { key: "Payment Date", label: "Payment Date", default: true },
  { key: "Payment Amount", label: "Payment Amount", default: true },
  { key: "Account", label: "Account", default: true },
  { key: "Touchpoint", label: "Touchpoint", default: true },
  { key: "Environment", label: "Environment", default: false },
] as const;
