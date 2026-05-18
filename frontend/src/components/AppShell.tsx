"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useTheme } from "next-themes";
import { useAuth } from "@/context/AuthContext";
import { DataProvider } from "@/context/DataContext";
import { useData } from "@/context/DataContext";
import { SidebarProvider, useSidebar } from "@/context/SidebarContext";
import { Sidebar } from "@/components/Sidebar";
import { MainContent } from "@/components/MainContent";
import { Toaster } from "@/components/ui/sonner";
import { Skeleton } from "@/components/ui/skeleton";
import { listUploads, type UploadSessionOut } from "@/lib/api";
import { useUploadEvents } from "@/lib/useUploadEvents";

/**
 * Silently restores the active session (sessionId + fileName) from the backend
 * on page refresh. Does NOT load individual records — the dashboard and
 * transactions pages each fetch their own data via TanStack Query, so loading
 * all records here would cause a large unnecessary payload on every refresh.
 */
function SessionRestorer() {
  const { token } = useAuth();
  const { sessionId, setSessionId, fileName, setFileName, setSessionValidated } = useData();
  // Use token as the key so the restorer re-runs when the token changes (e.g. after refresh).
  // We track the last token we ran for so we don't re-run on unrelated re-renders.
  const lastTokenRef = useRef<string | null>(null);
  // Keep refs to the latest sessionId/fileName so the async callback always
  // reads the current value, not the stale closure from when the effect ran.
  const sessionIdRef = useRef(sessionId);
  const fileNameRef = useRef(fileName);
  useEffect(() => { sessionIdRef.current = sessionId; }, [sessionId]);
  useEffect(() => { fileNameRef.current = fileName; }, [fileName]);

  useEffect(() => {
    if (!token) return;
    // Only re-run if the token has actually changed since the last run.
    if (lastTokenRef.current === token) return;
    lastTokenRef.current = token;

    // If we have a stored sessionId, trust it immediately — pages can render now.
    if (sessionIdRef.current) {
      setSessionValidated(true);
    }

    // Background validation: confirm session is still valid on the backend.
    listUploads(token).then((sessions: UploadSessionOut[]) => {
      const currentSessionId = sessionIdRef.current;
      const currentFileName = fileNameRef.current;
      if (currentSessionId) {
        // Validate the stored sessionId still exists on the backend
        const match = sessions.find((s) => s.id === currentSessionId);
        if (!match) {
          // Session expired/deleted (e.g. inactivity purge) — clear it silently
          setSessionId(null);
          setSessionValidated(true);
        } else {
          if (!currentFileName) setFileName(match.file_name);
          setSessionValidated(true);
        }
      } else {
        // No stored session — auto-pick the most recent one
        if (sessions.length > 0) {
          const sorted = [...sessions].sort(
            (a, b) => new Date(b.uploaded_at).getTime() - new Date(a.uploaded_at).getTime()
          );
          const latest = sorted[0];
          setSessionId(latest.id);
          setFileName(latest.file_name);
        }
        setSessionValidated(true);
      }
    }).catch((err: unknown) => {
      const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
      const is404or401 = msg.includes("404") || msg.includes("401") || msg.includes("403");
      if (is404or401) {
        // The stored session is definitively gone or unauthorized — clear it
        setSessionId(null);
      }
      // For network errors (502/503/timeout) keep the existing sessionId optimistically
      // so the user doesn't lose their session on a transient cold-start failure.
      setSessionValidated(true);
    });
  }, [token]);  // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}

/** Pings the backend health endpoint on first load to wake it up (e.g. Render cold start). */
function BackendWakeup() {
  useEffect(() => {
    const base = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000").replace(/\/+$/, "");
    fetch(`${base}/health`, { method: "GET", cache: "no-store" }).catch(() => {
      // Silently ignore — this is a best-effort wakeup ping
    });
  }, []);
  return null;
}

/** Subscribes to backend SSE to auto-invalidate the upload list cache. */
function UploadEventListener() {
  const { token } = useAuth();
  useUploadEvents(token);
  return null;
}

/** Invisible overlay — covers the page when the sidebar is expanded so any click outside collapses it. */
function CollapseSidebarOverlay() {
  const { isCollapsed, setIsCollapsed } = useSidebar();
  if (isCollapsed) return null;
  return (
    <div
      className="fixed inset-0 z-40"
      onClick={() => setIsCollapsed(true)}
      aria-hidden="true"
    />
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, isLoading } = useAuth();
  const pathname = usePathname();
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  // Use dark as default to match the defaultTheme="dark" in ThemeProvider,
  // preventing a hydration mismatch since resolvedTheme is undefined on the server.
  const bgImage = !mounted || resolvedTheme === "dark" ? "/BKGRD.svg" : "/BKGRD%20INV.svg";

  const isLoginPage = pathname === "/login";

  // Show a full-page skeleton while checking auth
  if (isLoading && !isLoginPage) {
    return (
      <div className="relative flex min-h-screen bg-[#070D12]">
        {/* Blurred background */}
        <div className="fixed inset-0 z-0 overflow-hidden">
          <Image
            src={bgImage}
            alt=""
            fill
            className="object-cover opacity-60"
            style={{ filter: "blur(8px)", transform: "scale(1.05)" }}
            priority
          />
        </div>
        {/* Sidebar skeleton */}
        <div className="relative z-10 hidden md:flex h-screen w-64 flex-col border-r bg-[rgba(7,13,18,0.85)] border-white/10 p-6 gap-6 backdrop-blur-xl">
          <Skeleton className="h-8 w-36 bg-white/10" />
          <div className="space-y-3 mt-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full bg-white/10" />
            ))}
          </div>
        </div>
        {/* Main content skeleton */}
        <div className="relative z-10 flex-1">
          {/* Top bar skeleton */}
          <div className="h-16 border-b border-white/10 bg-[rgba(7,13,18,0.75)] backdrop-blur-xl flex items-center px-8">
            <Skeleton className="h-5 w-32 bg-white/10" />
            <div className="flex-1" />
            <Skeleton className="h-8 w-8 rounded-full bg-white/10" />
          </div>
          {/* Page skeleton */}
          <div className="p-8 space-y-6">
            <Skeleton className="h-8 w-48 bg-white/10" />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-28 rounded-lg bg-white/10" />
              ))}
            </div>
            <Skeleton className="h-72 rounded-lg bg-white/10" />
          </div>
        </div>
      </div>
    );
  }

  // Login page — no sidebar, no topbar
  if (isLoginPage) {
    return (
      <>
        <BackendWakeup />
        {children}
        <Toaster position="bottom-right" />
      </>
    );
  }

  // Not authenticated and not on login — show skeleton while redirect happens
  if (!user) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#070D12]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  // Authenticated layout
  return (
    <DataProvider>
      <BackendWakeup />
      <SessionRestorer />
      <UploadEventListener />
      <SidebarProvider>
        {/* Fixed blurred background – always behind everything */}
        <div className="fixed inset-0 z-0 overflow-hidden bg-[#070D12] dark:bg-[#070D12]" style={{ backgroundColor: resolvedTheme === "dark" ? "#070D12" : "#f4f7f9" }}>
          <Image
            src={bgImage}
            alt=""
            fill
            className="object-cover opacity-60"
            style={{ filter: "blur(8px)", transform: "scale(1.05)" }}
            priority
          />
        </div>
        <div className="relative z-10 min-h-screen">
          <CollapseSidebarOverlay />
          <Sidebar />
          <MainContent>{children}</MainContent>
        </div>
        <Toaster position="bottom-right" />
      </SidebarProvider>
    </DataProvider>
  );
}
