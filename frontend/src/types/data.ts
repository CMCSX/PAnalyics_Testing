export interface DataRow {
  [key: string]: string | number | Date;
}

export interface PaymentRecord {
  id?: string;
  bank: string;
  paymentDate: string;
  paymentAmount: number;
  account: string; // debtor_id
  touchpoint: string; // TAGGING
  environment?: string;
  month?: string; // Month header from Excel (e.g., "JANUARY", "FEBRUARY")
}

export interface BankAnalytics {
  bank: string;
  accountCount: number;
  totalAmount: number;
  debtorSum: number;
  percentage: number;
  paymentCount: number;
  touchpointType?: string;
}

export interface TouchpointAnalytics {
  touchpoint: string;
  count: number;
  totalAmount: number;
  percentage: number;
}

export interface ParsedData {
  payments: PaymentRecord[];
  bankAnalytics: BankAnalytics[];
  touchpointAnalytics: TouchpointAnalytics[];
  totalAccounts: number;
  totalAmount: number;
  totalPayments: number;
  raw: DataRow[];
}

export type ChartType = "bar" | "line" | "pie" | "area" | "barh" | "donut" | "stackedBar";

export interface FilterOptions {
  startDate?: string;
  endDate?: string;
  environment?: string;
  bank?: string;
  touchpoint?: string;
  minValue?: number;
  maxValue?: number;
}
