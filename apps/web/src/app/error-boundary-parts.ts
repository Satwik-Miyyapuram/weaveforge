"use client";

import { useEffect } from "react";

/** The props Next hands both `error.tsx` and `global-error.tsx`. */
export interface ErrorBoundaryProps {
  error: Error & { digest?: string };
  reset: () => void;
}

/** Both boundaries log the crash so it survives in the Android logcat. */
export function useLoggedError(error: Error): void {
  useEffect(() => {
    console.error(error);
  }, [error]);
}

/** Message plus digest, or empty when the error carried neither. */
export function errorDetail(error: ErrorBoundaryProps["error"]): string {
  if (!error?.message) return "";
  return error.digest ? `${error.message}\ndigest: ${error.digest}` : error.message;
}
