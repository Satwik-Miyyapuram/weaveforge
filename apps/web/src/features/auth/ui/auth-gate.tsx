"use client";

import { useAuth } from "./auth-provider";
import { LoginScreen } from "./login-screen";
import { ThesisLoaderScreen } from "@/components/weaveforge-loader";

/**
 * Renders children only when signed in. When signed out it renders `fallback`
 * (the login screen by default; pass `fallback={null}` for chrome like the tab
 * bar that should simply disappear). Keeps feature screens free of auth checks.
 */
export function AuthGate({
  children,
  fallback,
}: {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { user, loading } = useAuth();

  if (loading) {
    return fallback === undefined ? <ThesisLoaderScreen /> : <>{fallback}</>;
  }
  if (!user) {
    return <>{fallback === undefined ? <LoginScreen /> : fallback}</>;
  }
  return <>{children}</>;
}
