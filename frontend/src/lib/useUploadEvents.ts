/**
 * useUploadEvents
 *
 * Subscribes to the backend SSE stream (/api/v1/events/stream) and
 * invalidates the TanStack Query uploads cache whenever another user
 * (or admin) saves a new Excel file.  Also forwards upload_progress
 * events so the UI can show a real-time progress bar.
 *
 * Uses the Fetch API instead of the browser's native EventSource so we can
 * pass the Authorization header — EventSource does not support custom headers.
 *
 * Auto-reconnects after 5 s on connection failures.
 */

"use client";

import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export interface UploadProgress {
  session_id: string;
  file_name: string;
  processed: number;
  total: number;
}

export function useUploadEvents(token: string | null) {
  const queryClient = useQueryClient();
  const abortRef = useRef<AbortController | null>(null);
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);

  useEffect(() => {
    if (!token) return;

    let active = true;

    async function connect() {
      if (!active) return;

      const controller = new AbortController();
      abortRef.current = controller;

      // Always read the latest token from localStorage — it may have been
      // refreshed since this effect last ran (stale closure fix).
      const currentToken =
        (typeof window !== "undefined" && localStorage.getItem("pa_access_token")) ||
        token;

      try {
        const response = await fetch(`${API_BASE}/api/v1/events/stream`, {
          headers: { Authorization: `Bearer ${currentToken}` },
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          // On 401, try to refresh the token once
          if (response.status === 401) {
            const refreshToken = typeof window !== "undefined" ? localStorage.getItem("pa_refresh_token") : null;
            if (refreshToken) {
              try {
                const refreshRes = await fetch(`${API_BASE}/api/v1/auth/refresh`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ refresh_token: refreshToken }),
                });
                if (refreshRes.ok) {
                  const tokens = await refreshRes.json();
                  localStorage.setItem("pa_access_token", tokens.access_token);
                  localStorage.setItem("pa_refresh_token", tokens.refresh_token);
                  // Reconnect with new token after short delay
                  retryTimer.current = setTimeout(connect, 1_000);
                  return;
                }
              } catch { /* fall through */ }
            }
            // Can't refresh — stop retrying
            return;
          }
          throw new Error(`SSE connection failed (${response.status})`);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (active) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          // SSE messages are separated by double newlines
          const chunks = buffer.split("\n\n");
          buffer = chunks.pop() ?? "";

          for (const chunk of chunks) {
            const dataLine = chunk
              .split("\n")
              .find((line) => line.startsWith("data: "));
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine.slice(6));
              if (payload.type === "new_upload") {
                // Invalidate the uploads list so every subscriber refetches
                queryClient.invalidateQueries({ queryKey: ["uploads"] });
                // Clear progress when upload completes
                setUploadProgress(null);
              } else if (payload.type === "upload_progress") {
                setUploadProgress({
                  session_id: payload.session_id,
                  file_name: payload.file_name,
                  processed: payload.processed,
                  total: payload.total,
                });
              }
            } catch {
              // Ignore malformed JSON (e.g. keepalive comments)
            }
          }
        }
      } catch (err) {
        if (!active) return;
        const isAbort = (err as Error).name === "AbortError";
        if (!isAbort) {
          // Don't retry on 401 — token is invalid, no point hammering the server
          const is401 = (err as Error).message?.includes("401");
          if (!is401) {
            retryTimer.current = setTimeout(connect, 5_000);
          }
        }
      }
    }

    connect();

    return () => {
      active = false;
      abortRef.current?.abort();
      // Clear the retry timer so a pending reconnect from the old token
      // doesn't fire after the new token's connection is already established.
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [token, queryClient]);

  return { uploadProgress };
}
