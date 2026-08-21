"use client";

import { useEffect } from "react";
import { useAuth } from "@/features/auth";
import { hydrateThemeFromServer } from "@/lib/theme/theme-persistence";

/** Sync theme preferences from the user settings row after sign-in. */
export function ThemeSyncProvider({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading || !user?.id) return;
    void hydrateThemeFromServer();
  }, [user?.id, loading]);

  return children;
}
