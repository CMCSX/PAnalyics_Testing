/**
 * Centralized TanStack Query hooks for PayAnalytics API calls.
 *
 * Using TanStack Query avoids redundant Neon DB round-trips:
 *  - staleTime: 5 min  → data from a recent navigation reuse is served from cache
 *  - gcTime:   10 min  → unused cache entries are kept for fast back-navigation
 *  - placeholderData   → pagination keeps showing previous page while new one loads
 */

import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  getDashboardSummary,
  getTransactions,
  listUploads,
  getUpload,
  getAccountsSummary,
  getAuditLog,
  getUnifiedAuditLog,
} from "@/lib/api";

// ── Query key factory ────────────────────────────────────────────────────────
export const queryKeys = {
  uploads: (token: string) => ["uploads", token] as const,
  uploadRecords: (token: string, sessionId: string) => ["upload-records", sessionId, token] as const,
  accountsSummary: (
    token: string,
    sessionId: string,
    filters: { search?: string; date_from?: string; date_to?: string; page?: number; page_size?: number }
  ) => ["accounts-summary", sessionId, filters, token] as const,
  dashboard: (token: string, sessionId: string, dateFrom?: string, dateTo?: string) =>
    ["dashboard", sessionId, token, dateFrom, dateTo] as const,
  transactions: (
    token: string,
    sessionId: string,
    filters: {
      bank?: string;
      touchpoint?: string;
      search?: string;
      page?: number;
      page_size?: number;
    }
  ) => ["transactions", sessionId, filters, token] as const,
  auditLog: (token: string) => ["audit-log", token] as const,
  unifiedAuditLog: (token: string) => ["unified-audit-log", token] as const,
};

// ── Hooks ────────────────────────────────────────────────────────────────────

/** Fetch aggregated dashboard KPIs for a session — cached 10 minutes */
export function useDashboard(token: string | null, sessionId: string | null, sessionValidated = true, dateFrom?: string, dateTo?: string) {
  return useQuery({
    queryKey: queryKeys.dashboard(token!, sessionId!, dateFrom, dateTo),
    queryFn: () => getDashboardSummary(token!, sessionId!, { date_from: dateFrom, date_to: dateTo }),
    enabled: !!token && !!sessionId && sessionValidated,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    // No refetchInterval — the dashboard is event-driven (SSE invalidates on new upload).
    // Auto-polling every 5 min was causing 401/404 bursts during token refresh and
    // after the inactivity purge deletes the session.
    placeholderData: keepPreviousData,
  });
}

/** Fetch paginated + filtered transactions — keeps previous page while loading */
export function useTransactions(
  token: string | null,
  sessionId: string | null,
  filters: {
    bank?: string;
    touchpoint?: string;
    search?: string;
    payment_date?: string;
    environment?: string;
    page?: number;
    page_size?: number;
  } = {},
  sessionValidated = true
) {
  return useQuery({
    queryKey: queryKeys.transactions(token!, sessionId!, filters),
    queryFn: () => getTransactions(token!, sessionId!, filters),
    enabled: !!token && !!sessionId && sessionValidated,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    // Removed refetchInterval — same reason as useDashboard (401/404 burst loops)
    placeholderData: keepPreviousData,
  });
}

/** List all upload sessions for the current user */
export function useUploads(
  token: string | null,
  options: { refetchInterval?: number } = {}
) {
  return useQuery({
    queryKey: queryKeys.uploads(token!),
    queryFn: () => listUploads(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    select: (data) =>
      [...data].sort(
        (a, b) =>
          new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
      ),
    ...options,
  });
}

/** Fetch all records for a session — cached 10 minutes so back-navigation is instant */
export function useUploadRecords(token: string | null, sessionId: string | null, sessionValidated = true) {
  return useQuery({
    queryKey: queryKeys.uploadRecords(token!, sessionId!),
    queryFn: () => getUpload(token!, sessionId!),
    enabled: !!token && !!sessionId && sessionValidated,
    staleTime: 10 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    // refetchOnMount: true (default) so navigating back to Sheets always gets
    // fresh data if the cache is stale — prevents showing pre-edit state.
  });
}

/** Fetch server-side account aggregates — paginated and filtered, memory-safe for any dataset size */
export function useAccountsSummary(
  token: string | null,
  sessionId: string | null,
  sessionValidated = true,
  filters: { search?: string; date_from?: string; date_to?: string; page?: number; page_size?: number } = {}
) {
  return useQuery({
    queryKey: queryKeys.accountsSummary(token!, sessionId!, filters),
    queryFn: () => getAccountsSummary(token!, sessionId!, filters),
    enabled: !!token && !!sessionId && sessionValidated,
    staleTime: 5 * 60 * 1000,
    gcTime: 30 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  });
}

/** Admin: fetch audit log — cached 5 minutes */
export function useAuditLog(token: string | null, isAdmin: boolean) {
  return useQuery({
    queryKey: queryKeys.auditLog(token!),
    queryFn: () => getAuditLog(token!),
    enabled: !!token && isAdmin,
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

/** Fetch unified audit log for the current user — cached with TanStack Query */
export function useUnifiedAuditLog(token: string | null) {
  return useQuery({
    queryKey: queryKeys.unifiedAuditLog(token!),
    queryFn: () => getUnifiedAuditLog(token!),
    enabled: !!token,
    staleTime: 2 * 60 * 1000,   // 2 min — avoid re-fetching on every settings tab open
    gcTime: 10 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}
