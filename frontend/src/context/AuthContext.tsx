"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter, usePathname } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  login as apiLogin,
  getMe,
  listUploads,
  refreshTokens,
  type UserResponse,
} from "@/lib/api";

interface AuthContextValue {
  user: UserResponse | null;
  token: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "pa_access_token";
const REFRESH_KEY = "pa_refresh_token";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Store token as proper React state so consumers re-render when it changes
  const [token, setTokenState] = useState<string | null>(() =>
    typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null
  );
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  // Load user from stored token on mount
  useEffect(() => {
    const storedToken = localStorage.getItem(TOKEN_KEY);
    if (!storedToken) {
      setIsLoading(false);
      if (pathname !== "/login") router.replace("/login");
      return;
    }

    getMe(storedToken)
      .then((u) => {
        setUser(u);
        setIsLoading(false);
      })
      .catch(async () => {
        // Access token expired — try refresh before giving up
        const refresh = localStorage.getItem(REFRESH_KEY);
        if (refresh) {
          try {
            const tokens = await refreshTokens(refresh);
            localStorage.setItem(TOKEN_KEY, tokens.access_token);
            localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
            setTokenState(tokens.access_token);
            // getMe with new token — run in background, don't block isLoading.
            // If it fails, user stays null but the app is still functional;
            // the next authenticated request will re-attempt via the mount effect.
            getMe(tokens.access_token).then(setUser).catch(() => {
              // Non-critical — user profile will reload on next navigation
            });
            setIsLoading(false);
            return;
          } catch {
            // refresh failed — fall through to logout
          }
        }
        localStorage.removeItem(TOKEN_KEY);
        localStorage.removeItem(REFRESH_KEY);
        setTokenState(null);
        setIsLoading(false);
        if (pathname !== "/login") {
          toast("Session expired", {
            description: "Please log in again to continue.",
            duration: 6000,
          });
          router.replace("/login");
        }
      });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await apiLogin(email, password);
      localStorage.setItem(TOKEN_KEY, tokens.access_token);
      localStorage.setItem(REFRESH_KEY, tokens.refresh_token);
      setTokenState(tokens.access_token);

      // Navigate immediately — don't wait for getMe or prefetch.
      // getMe and the uploads prefetch run in parallel in the background
      // so the dashboard data is ready (or nearly ready) by the time it renders.
      router.replace("/dashboard");

      // Run both in parallel in the background. We intentionally do not await
      // this Promise.all — navigation has already happened. The void operator
      // makes the unhandled-promise lint rule happy.
      void Promise.all([
        getMe(tokens.access_token).then(setUser).catch(() => {
          // getMe failed after login — token is valid (login succeeded) but
          // profile fetch failed. Clear session and redirect back to login
          // so the user isn't stuck on a dashboard with no user object.
          localStorage.removeItem(TOKEN_KEY);
          localStorage.removeItem(REFRESH_KEY);
          setTokenState(null);
          router.replace("/login");
        }),
        queryClient.prefetchQuery({
          queryKey: ["uploads", tokens.access_token],
          queryFn: () => listUploads(tokens.access_token),
          staleTime: 5 * 60 * 1000,
        }).catch(() => { /* non-critical */ }),
      ]);
    },
    [router, queryClient]
  );

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_KEY);
    // Clear session data so next user doesn't see previous user's state
    localStorage.removeItem("sessionId");
    localStorage.removeItem("fileName");
    setTokenState(null);
    setUser(null);
    // Wipe the entire query cache so the next user who logs in on this browser
    // never sees the previous user's uploads, dashboard data, or audit log.
    queryClient.clear();
    router.replace("/login");
  }, [router, queryClient]);

  const value = useMemo(
    () => ({
      user,
      token,
      isLoading,
      login,
      logout,
    }),
    [user, token, isLoading, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
