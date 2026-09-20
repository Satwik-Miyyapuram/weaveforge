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

/**
 * Message, digest and — where the runtime has one — the stack.
 *
 * The stack was missing, and it is the half a bug report is *for*: "Cannot read
 * properties of undefined" without a frame tells whoever reads the issue nothing
 * about where. Next's type says `Error & { digest?: string }`, but the object a
 * client boundary receives really is an `Error`, so the stack is usually there and
 * was simply not asked for. It is omitted rather than guessed at when absent —
 * that happens for errors Next has already stripped, which is also when the digest
 * is the only handle.
 */
export function errorDetail(error: ErrorBoundaryProps["error"]): string {
  if (!error?.message) return "";
  const parts = [error.message];
  if (error.digest) parts.push(`digest: ${error.digest}`);
  // Guarded: a `stack` has been a getter that throws, and a boundary must not
  // fail while describing a failure.
  try {
    if (typeof error.stack === "string" && error.stack.trim()) parts.push(error.stack);
  } catch {
    // No stack available; the message and digest stand.
  }
  return parts.join("\n");
}
