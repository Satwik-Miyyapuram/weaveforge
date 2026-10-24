"use client";

import { useEffect } from "react";
import { useAuth } from "@/features/auth";
import { hydrateThemeFromServer } from "@/lib/theme/theme-persistence";
import { logToApp } from "@/lib/error-report/app-log";

/** Sync theme preferences from the user settings row after sign-in. */
export function ThemeSyncProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user?.id) return;
    hydrateThemeFromServer().catch((err) =>
      logToApp({ level: "warn", source: "theme", message: "Could not load the saved theme; keeping this device's", detail: String(err) }),
    );
  }, [user?.id, loading]);

  return children;
}
