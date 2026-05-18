import ExcelJS from "exceljs";
import {
  ParsedData,
  DataRow,
  PaymentRecord,
  BankAnalytics,
  TouchpointAnalytics,
} from "@/types/data";

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB — matches the backend /file endpoint limit
const ALLOWED_EXTENSIONS = [".xlsx", ".xls", ".csv"];

function validateFile(file: File): void {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error("File size exceeds 50MB limit.");
  }
  const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    throw new Error(
      `Invalid file type "${ext}". Allowed: ${ALLOWED_EXTENSIONS.join(", ")}`
    );
  }
}

/** Find column key by matching patterns (case-insensitive) */
function findColumn(
  keys: string[],
  patterns: string[]
): string | undefined {
  return keys.find((k) => {
    const lower = k.toLowerCase();
    return patterns.some((p) => lower.includes(p));
  });
}

/** Convert Excel date values to YYYY-MM-DD string */
function formatDate(value: unknown): string {
  if (value instanceof Date) {
    // Avoid timezone shift by using UTC parts
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "number" && value > 30000 && value < 100000) {
    // Excel serial date
    const date = new Date((value - 25569) * 86400 * 1000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, "0");
    const d = String(date.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof value === "string" && value.trim()) {
    const s = value.trim();
    // Already YYYY-MM-DD — check first
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    // Slash-separated: DD/MM/YYYY (Philippine convention) or MM/DD/YYYY (US).
    // If first part > 12 → must be DD/MM; if second part > 12 → must be MM/DD.
    // When both ≤ 12, default to DD/MM (Philippine locale).
    const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (slashMatch) {
      const [, p1, p2, yyyy] = slashMatch;
      const n1 = parseInt(p1, 10), n2 = parseInt(p2, 10);
      let dd: string, mm: string;
      if (n1 > 12) {
        dd = p1; mm = p2;          // DD/MM/YYYY
      } else if (n2 > 12) {
        mm = p1; dd = p2;          // MM/DD/YYYY
      } else {
        dd = p1; mm = p2;          // default DD/MM/YYYY
      }
      return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
    // DD-MM-YYYY → YYYY-MM-DD
    const dmyMatch = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
    if (dmyMatch) {
      const [, dd, mm, yyyy] = dmyMatch;
      return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
    }
  }
  return String(value || "");
}

/** Extract a plain value from an ExcelJS cell value */
function extractCellValue(
  cellValue: ExcelJS.CellValue
): string | number | Date {
  if (cellValue === null || cellValue === undefined) return "";
  if (
    typeof cellValue === "string" ||
    typeof cellValue === "number" ||
    cellValue instanceof Date
  ) {
    return cellValue;
  }
  if (typeof cellValue === "boolean") return cellValue ? "TRUE" : "FALSE";
  // Formula result
  if (typeof cellValue === "object" && "result" in cellValue) {
    const r = (cellValue as ExcelJS.CellFormulaValue).result;
    return extractCellValue(r as ExcelJS.CellValue);
  }
  // Rich text
  if (typeof cellValue === "object" && "richText" in cellValue) {
    return (cellValue as ExcelJS.CellRichTextValue).richText
      .map((r) => r.text)
      .join("");
  }
  return String(cellValue);
}

/**
 * Sum an array of peso amounts accurately.
 * Converts each value to centavos (integer) before summing to avoid
 * IEEE 754 floating-point drift across large datasets.
 */
function sumAmounts(amounts: number[]): number {
  const centavos = amounts.reduce((s, a) => s + Math.round(a * 100), 0);
  return centavos / 100;
}

export async function parseExcelFile(file: File): Promise<ParsedData> {
  validateFile(file);

  const arrayBuffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(arrayBuffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error("No sheets found in the workbook");
  }

  const headers: string[] = [];
  const jsonData: DataRow[] = [];

  worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) {
      (row.values as ExcelJS.CellValue[]).forEach((val, idx) => {
        if (idx > 0) {
          headers[idx - 1] = String(extractCellValue(val) ?? "");
        }
      });
    } else {
      const rowData: DataRow = {};
      (row.values as ExcelJS.CellValue[]).forEach((val, idx) => {
        if (idx > 0) {
          const header = headers[idx - 1];
          if (header) {
            rowData[header] = extractCellValue(val);
          }
        }
      });
      if (Object.keys(rowData).length > 0) {
        jsonData.push(rowData);
      }
    }
  });

  if (jsonData.length === 0) {
    throw new Error("The uploaded file contains no data");
  }

  return categorizePaymentData(jsonData);
}

function categorizePaymentData(data: DataRow[]): ParsedData {
  const keys = data.length > 0 ? Object.keys(data[0]) : [];

  const bankCol = findColumn(keys, ["bank"]);
  const dateCol = findColumn(keys, [
    "leads_result_edate",
    "date_created",
    "payment date",
    "paymentdate",
    "edate",
    "date",
  ]);
  const amountCol = findColumn(keys, [
    "leads_result_amount",
    "payment amount",
    "paymentamount",
    "amount",
  ]);
  const accountCol = findColumn(keys, ["debtor_id", "debtorid", "account", "debtor"]);
  const touchpointCol = findColumn(keys, ["tagging", "touchpoint", "tag"]);
  const envCol = findColumn(keys, ["environment", "env"]);

  const monthCol = findColumn(keys, ["month"]);

  const payments: PaymentRecord[] = data.map((row) => ({
    bank: bankCol ? String(row[bankCol] || "Unknown") : "Unknown",
    paymentDate: dateCol ? formatDate(row[dateCol]) : "",
    paymentAmount: amountCol ? Math.round((Number(row[amountCol]) || 0) * 100) / 100 : 0,
    account: accountCol ? String(row[accountCol] || "") : "",
    touchpoint: touchpointCol
      ? String(row[touchpointCol] || "NO TOUCHPOINT")
      : "NO TOUCHPOINT",
    environment: envCol ? String(row[envCol] || "") : undefined,
    month: monthCol ? String(row[monthCol] || "").toUpperCase() || undefined : undefined,
  }));

  return computeAnalytics(payments, data);
}

function computeAnalytics(
  payments: PaymentRecord[],
  raw: DataRow[]
): ParsedData {
  const totalAmount = sumAmounts(payments.map((p) => p.paymentAmount));
  const uniqueAccounts = new Set(payments.map((p) => p.account));

  // Bank analytics
  const bankMap = new Map<
    string,
    { accounts: Set<string>; amounts: number[]; debtorIds: number; count: number }
  >();
  for (const p of payments) {
    if (!bankMap.has(p.bank)) {
      bankMap.set(p.bank, {
        accounts: new Set(),
        amounts: [],
        debtorIds: 0,
        count: 0,
      });
    }
    const entry = bankMap.get(p.bank)!;
    entry.accounts.add(p.account);
    entry.amounts.push(p.paymentAmount);
    entry.debtorIds += Number(p.account) || 0;
    entry.count++;
  }

  const bankAnalytics: BankAnalytics[] = Array.from(bankMap.entries())
    .map(([bank, d]) => {
      const bankTotal = sumAmounts(d.amounts);
      return {
        bank,
        accountCount: d.accounts.size,
        totalAmount: bankTotal,
        debtorSum: d.debtorIds,
        percentage: totalAmount > 0 ? (bankTotal / totalAmount) * 100 : 0,
        paymentCount: d.count,
      };
    })
    .sort((a, b) => b.totalAmount - a.totalAmount);

  // Touchpoint analytics
  const tpMap = new Map<string, { count: number; amounts: number[] }>();
  for (const p of payments) {
    const tp = p.touchpoint || "NO TOUCHPOINT";
    if (!tpMap.has(tp)) tpMap.set(tp, { count: 0, amounts: [] });
    const entry = tpMap.get(tp)!;
    entry.count++;
    entry.amounts.push(p.paymentAmount);
  }

  const touchpointAnalytics: TouchpointAnalytics[] = Array.from(
    tpMap.entries()
  )
    .map(([touchpoint, d]) => {
      const tpTotal = sumAmounts(d.amounts);
      return {
        touchpoint,
        count: d.count,
        totalAmount: tpTotal,
        percentage: totalAmount > 0 ? (tpTotal / totalAmount) * 100 : 0,
      };
    })
    .sort((a, b) => b.count - a.count);

  return {
    payments,
    bankAnalytics,
    touchpointAnalytics,
    totalAccounts: uniqueAccounts.size,
    totalAmount,
    totalPayments: payments.length,
    raw,
  };
}

/* ── Real bank & tag names from the dataset ── */

const BANKS = [
  "MBTC P1",
  "MBTC P2",
  "MBTC APR",
  "MBTC P4",
  "SBC PL RECOV L1",
  "SBF PL",
  "SBC CARDS RECOV L1",
  "SBC CARDS & LOAN L6",
  "SBF SALAD",
  "EWB",
  "UBP RECOV BLUE",
  "UBP RECOV NEWLY",
  "UBP RECOV OLD1",
  "UBP RECOV YOUNG MODEL",
  "UBP SEEKCAP",
  "BANKARD",
  "RCBC",
  "MBTC P90",
  "UBP COMBANK RMG",
  "HSBC UAE",
  "ENBD",
  "UBP RECOV PL1",
  "UBP SME 90DPD",
  "UBP SF RECOV",
  "UBP SF ECA",
  "MBTC PA",
  "EIB",
  "UBP HOME MORTGAGE",
  "MBTC CARDS REST",
];

const TAGS = [
  "GHOST PAYMENT",
  "OB CALL",
  "OB EMAIL",
  "NO TOUCHPOINT",
  "OB SMS",
  "EMAIL",
  "IB EMAIL",
  "SMS",
  "OB VIBER",
  "IB VIBER",
  "IB SMS",
  "IB CALL",
  "SKIPTRACE",
  "VIBER",
  "OB SKIPTRACE",
  "CALL",
  "OB FIELD",
  "IB FIELD",
];

function randomItem<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateMockData(): ParsedData {
  const payments: PaymentRecord[] = [];
  const numRecords = 500;

  for (let i = 0; i < numRecords; i++) {
    const month = Math.floor(Math.random() * 12) + 1;
    const day = Math.floor(Math.random() * 28) + 1;
    const dateStr = `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const bank = randomItem(BANKS);
    const amount = Math.round((Math.random() * 50000 + 500) * 100) / 100;
    const account = String(100000 + Math.floor(Math.random() * 900000));

    payments.push({
      bank,
      paymentDate: dateStr,
      paymentAmount: amount,
      account,
      touchpoint: randomItem(TAGS),
      environment: "ENV1",
    });
  }

  const raw: DataRow[] = payments.map((p) => ({
    Bank: p.bank,
    leads_result_edate: p.paymentDate,
    leads_result_amount: p.paymentAmount,
    debtor_id: p.account,
    TAGGING: p.touchpoint,
    Environment: p.environment || "ENV1",
  }));

  return computeAnalytics(payments, raw);
}
