const API_BASE = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");

const TOKEN_KEY = "pa_access_token";
const REFRESH_KEY = "pa_refresh_token";

interface FetchOptions extends RequestInit {
  token?: string;
  _isRetry?: boolean;
  _retryCount?: number;
}

const COLD_START_MAX_RETRIES = 2;
const COLD_START_RETRY_DELAY_MS = 3000;

function _sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Single in-flight refresh promise — prevents multiple parallel 401s from each
// triggering their own token refresh and causing ERR_INSUFFICIENT_RESOURCES.
let _refreshPromise: Promise<string | null> | null = null;

async function _doRefresh(): Promise<string | null> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return null;
  try {
    const res = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return null;
    const tokens = await res.json();
    localStorage.setItem(TOKEN_KEY, tokens.access_token);
    localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
    return tokens.access_token as string;
  } catch {
    return null;
  }
}

export async function apiFetch<T>(
  path: string,
  options: FetchOptions = {}
): Promise<T> {
  const { token, headers, _isRetry, _retryCount = 0, ...rest } = options;

  let res: Response;
  try {
    const isFormData = rest.body instanceof FormData;
    res = await fetch(`${API_BASE}${path}`, {
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...rest,
  });
  } catch (err) {
    // Retry on network errors — these occur when Render's free tier returns a 502
    // during cold start; Render's proxy omits CORS headers, so the browser reports
    // a network/CORS error instead of the actual 502.
    if (_retryCount < COLD_START_MAX_RETRIES) {
      await _sleep(COLD_START_RETRY_DELAY_MS * (_retryCount + 1));
      return apiFetch<T>(path, { ...options, _retryCount: _retryCount + 1 });
    }
    throw new Error(`Network error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Also retry explicit 502/503/504 responses (gateway errors)
  if ((res.status === 502 || res.status === 503 || res.status === 504) && _retryCount < COLD_START_MAX_RETRIES) {
    await _sleep(COLD_START_RETRY_DELAY_MS * (_retryCount + 1));
    return apiFetch<T>(path, { ...options, _retryCount: _retryCount + 1 });
  }

  // Auto-refresh on 401 — only one refresh runs at a time; others wait for it
  if (res.status === 401 && !_isRetry && typeof window !== "undefined") {
    if (!_refreshPromise) {
      _refreshPromise = _doRefresh().finally(() => { _refreshPromise = null; });
    }
    const newToken = await _refreshPromise;
    if (newToken) {
      return apiFetch<T>(path, { ...options, token: newToken, _isRetry: true });
    }
    // Refresh failed — clear session and redirect
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    window.location.href = "/login";
    throw new Error("Session expired. Please log in again.");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail;
    let message: string;
    if (Array.isArray(detail)) {
      message = detail.map((e: { msg?: string; loc?: unknown[] }) => {
        const loc = Array.isArray(e.loc) ? e.loc.slice(1).join(" → ") : "";
        return loc ? `${loc}: ${e.msg ?? "invalid"}` : (e.msg ?? "invalid");
      }).join("; ");
    } else {
      message = detail || `Request failed (${res.status})`;
    }
    throw new Error(message);
  }

  if (res.status === 204) {
    return undefined as T;
  }

  return res.json() as Promise<T>;
}

export interface TokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
}

export interface UserResponse {
  id: string;
  email: string;
  full_name: string;
  is_active: boolean;
  is_superuser: boolean;
  created_at: string;
}

export function login(email: string, password: string) {
  return apiFetch<TokenResponse>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export function refreshTokens(refreshToken: string) {
  return apiFetch<TokenResponse>("/api/v1/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

export function getMe(token: string) {
  return apiFetch<UserResponse>("/api/v1/auth/me", { token });
}

export function listUsers(token: string) {
  return apiFetch<UserResponse[]>("/api/v1/users", { token });
}

export function createUser(
  token: string,
  data: { email: string; full_name: string; password: string }
) {
  return apiFetch<UserResponse>("/api/v1/users", {
    method: "POST",
    token,
    body: JSON.stringify(data),
  });
}

export function changePassword(
  token: string,
  data: { current_password: string; new_password: string }
) {
  return apiFetch<void>("/api/v1/users/me/change-password", {
    method: "POST",
    token,
    body: JSON.stringify(data),
  });
}

export function adminUpdateUser(
  token: string,
  userId: string,
  data: Partial<{ email: string; full_name: string; new_password: string }>
) {
  return apiFetch<UserResponse>(`/api/v1/users/${userId}`, {
    method: "PATCH",
    token,
    body: JSON.stringify(data),
  });
}

export function setUserAdmin(token: string, userId: string, isAdmin: boolean) {
  return apiFetch<UserResponse>(`/api/v1/users/${userId}/admin`, {
    method: "PATCH",
    token,
    body: JSON.stringify({ is_superuser: isAdmin }),
  });
}

export function deleteUser(token: string, userId: string) {
  return apiFetch<void>(`/api/v1/users/${userId}`, {
    method: "DELETE",
    token,
  });
}

// ─── Upload / Persistence API ────────────────────────────────────────────────

export interface PaymentRecordIn {
  bank: string;
  account: string;
  touchpoint?: string;
  payment_date?: string;
  payment_amount: number;
  environment?: string;
  month?: string;
}

export interface PaymentRecordOut extends PaymentRecordIn {
  id: string;
  session_id: string;
}

export interface UploadSessionOut {
  id: string;
  user_id: string;
  file_name: string;
  total_records: number;
  total_amount: number;
  uploaded_at: string;
}

export interface UploadSessionDetail extends UploadSessionOut {
  records: PaymentRecordOut[];
  /** True when the session has more than MAX_DETAIL_RECORDS rows.
   *  Full data is accessible via getTransactions() or getAccountsSummary(). */
  records_truncated: boolean;
}

export interface AccountSummaryEntry {
  account: string;
  total_amount: number;
  payment_count: number;
  bank_count: number;
  banks: string;
}

export interface AccountsSummaryResponse {
  session_id: string;
  total_accounts: number;
  total_records: number;
  page: number;
  page_size: number;
  accounts: AccountSummaryEntry[];
}

export interface PaginatedTransactions {
  total: number;
  total_amount: number;
  page: number;
  page_size: number;
  items: PaymentRecordOut[];
}

export interface BankSummary {
  bank: string;
  payment_count: number;
  account_count: number;
  total_amount: number;
  percentage: number;
}

export interface TouchpointSummary {
  touchpoint: string;
  count: number;
  total_amount: number;
  percentage: number;
}

export interface EnvironmentCampaignMap {
  environment: string;
  banks: string[];
  touchpoints_by_bank: Record<string, string[]>;
}

export interface BankTouchpointMatrixRow {
  bank: string;
  touchpoint: string;
  environment: string;
  count: number;
  total_amount: number;
  account_count: number;
}

export interface DashboardSummary {
  total_payments: number;
  total_amount: number;
  total_accounts: number;
  total_banks: number;
  banks: BankSummary[];
  touchpoints: TouchpointSummary[];
  bank_touchpoint_matrix: BankTouchpointMatrixRow[];
  dates: string[];
  environments: string[];
  months: string[];
  environment_map: EnvironmentCampaignMap[];
  monthly_trend: { month: string; amount: number }[];
  session_id: string | null;
}

export function saveUpload(
  token: string,
  payload: { file_name: string; records: PaymentRecordIn[] }
) {
  return apiFetch<UploadSessionOut>("/api/v1/uploads", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

export function listUploads(token: string) {
  return apiFetch<UploadSessionOut[]>("/api/v1/uploads", { token });
}

export function getUpload(token: string, sessionId: string) {
  return apiFetch<UploadSessionDetail>(`/api/v1/uploads/${sessionId}`, { token });
}

export function getAccountsSummary(
  token: string,
  sessionId: string,
  params: { search?: string; date_from?: string; date_to?: string; page?: number; page_size?: number } = {}
) {
  const qs = new URLSearchParams();
  if (params.search) qs.set("search", params.search);
  if (params.date_from) qs.set("date_from", params.date_from);
  if (params.date_to) qs.set("date_to", params.date_to);
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  const query = qs.toString() ? `?${qs}` : "";
  return apiFetch<AccountsSummaryResponse>(`/api/v1/uploads/${sessionId}/accounts-summary${query}`, { token });
}

export function getTransactions(
  token: string,
  sessionId: string,
  params: { bank?: string; touchpoint?: string; search?: string; payment_date?: string; environment?: string; date_from?: string; date_to?: string; page?: number; page_size?: number } = {}
) {
  const qs = new URLSearchParams();
  if (params.bank) qs.set("bank", params.bank);
  if (params.touchpoint) qs.set("touchpoint", params.touchpoint);
  if (params.search) qs.set("search", params.search);
  if (params.payment_date) qs.set("payment_date", params.payment_date);
  if (params.date_from) qs.set("date_from", params.date_from);
  if (params.date_to) qs.set("date_to", params.date_to);
  if (params.environment) qs.set("environment", params.environment);
  if (params.page) qs.set("page", String(params.page));
  if (params.page_size) qs.set("page_size", String(params.page_size));
  const query = qs.toString() ? `?${qs}` : "";
  return apiFetch<PaginatedTransactions>(`/api/v1/uploads/${sessionId}/transactions${query}`, { token });
}

export function getDashboardSummary(token: string, sessionId: string, params: { date_from?: string; date_to?: string } = {}) {
  const qs = new URLSearchParams();
  if (params.date_from) qs.set("date_from", params.date_from);
  if (params.date_to) qs.set("date_to", params.date_to);
  const query = qs.toString() ? `?${qs}` : "";
  return apiFetch<DashboardSummary>(`/api/v1/uploads/${sessionId}/dashboard${query}`, { token });
}

/** Fetch ALL records for a session in a single request — use for exports only. */
export function exportAllRecords(token: string, sessionId: string) {
  return apiFetch<PaymentRecordOut[]>(`/api/v1/uploads/${sessionId}/export/records`, { token });
}

/**
 * Triggers a browser download of all records as a CSV file using the server-side
 * streaming endpoint. Safe for very large sessions (no memory cap on the server).
 */
export async function downloadAllRecordsCSV(token: string, sessionId: string, fileName: string): Promise<void> {
  const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? ""}/api/v1/uploads/${sessionId}/export/csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    const detail = body?.detail || `Request failed (${res.status})`;
    throw new Error(detail);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName.replace(/\.[^/.]+$/, "") + "_export.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export interface AuditLogEntry {
  id: string;
  file_name: string;
  total_records: number;
  total_amount: number;
  uploaded_at: string;
  user_id: string;
  user_email: string;
  user_name: string;
}

export function getAuditLog(token: string) {
  return apiFetch<AuditLogEntry[]>("/api/v1/uploads/admin/audit-log", { token });
}

export interface DeletionAuditLogEntry {
  id: string;
  session_id: string;
  file_name: string;
  total_records: number;
  total_amount: number;
  owner_user_id: string;
  deleted_by_user_id: string;
  deleted_by_email: string;
  deleted_by_name: string;
  deleted_at: string;
}

export function getDeletionAuditLog(token: string) {
  return apiFetch<DeletionAuditLogEntry[]>("/api/v1/uploads/admin/deletion-log", { token });
}

export interface UnifiedAuditLogEntry {
  id: string;
  user_id: string;
  user_email: string;
  user_name: string;
  action: string;
  file_name: string;
  session_id: string | null;
  record_count: number;
  total_amount: number;
  details: string | null;
  is_undone: boolean;
  can_undo: boolean;
  created_at: string;
}

export function getUnifiedAuditLog(token: string) {
  return apiFetch<UnifiedAuditLogEntry[]>("/api/v1/uploads/unified-audit-log", { token });
}

export function undoAuditEntry(token: string, entryId: string) {
  return apiFetch<{ detail: string }>(`/api/v1/uploads/audit-log/${entryId}/undo`, {
    method: "POST",
    token,
  });
}

export function deleteUpload(token: string, sessionId: string) {
  return apiFetch<void>(`/api/v1/uploads/${sessionId}`, { method: "DELETE", token });
}

export function createTransaction(token: string, sessionId: string, record: PaymentRecordIn) {
  return apiFetch<PaymentRecordOut>(`/api/v1/uploads/${sessionId}/transactions`, {
    method: "POST",
    token,
    body: JSON.stringify(record),
  });
}

export function updateTransaction(token: string, sessionId: string, recordId: string, record: PaymentRecordIn) {
  return apiFetch<PaymentRecordOut>(`/api/v1/uploads/${sessionId}/transactions/${recordId}`, {
    method: "PUT",
    token,
    body: JSON.stringify(record),
  });
}

export function deleteTransaction(token: string, sessionId: string, recordId: string) {
  return apiFetch<void>(`/api/v1/uploads/${sessionId}/transactions/${recordId}`, { method: "DELETE", token });
}

export function bulkDeleteTransactions(token: string, sessionId: string, ids: string[]) {
  return apiFetch<{ deleted: number }>(`/api/v1/uploads/${sessionId}/transactions/bulk-delete`, {
    method: "POST",
    token,
    body: JSON.stringify({ ids }),
  });
}

export function deleteTransactionsByDateRange(token: string, sessionId: string, dateFrom: string, dateTo: string) {
  const qs = new URLSearchParams({ date_from: dateFrom, date_to: dateTo });
  return apiFetch<{ deleted: number }>(`/api/v1/uploads/${sessionId}/transactions?${qs}`, { method: "DELETE", token });
}

export interface AuditLogCreate {
  action: string;
  file_name: string;
  session_id?: string | null;
  record_count?: number;
  total_amount?: number;
  details?: string | null;
  snapshot_data?: string | null;
}

export function createAuditLog(token: string, payload: AuditLogCreate) {
  return apiFetch<{ detail: string }>("/api/v1/uploads/audit", {
    method: "POST",
    token,
    body: JSON.stringify(payload),
  });
}

/**
 * Upload an Excel/CSV file for server-side streaming parse.
 * The backend parses the file in read-only/streaming mode to keep
 * memory usage low. Progress events are broadcast via SSE.
 */
export async function uploadFile(
  token: string,
  file: File
): Promise<UploadSessionOut> {
  const formData = new FormData();
  formData.append("file", file);

  return apiFetch<UploadSessionOut>(`/api/v1/uploads/file`, {
    method: "POST",
    token,
    body: formData,
  });
}
