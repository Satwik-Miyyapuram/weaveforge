"use client";

import { useEffect } from "react";
import { recoverClientRuntime } from "@/lib/client-runtime-recovery";

function looksLikeChunkFailure(message: string): boolean {
  return /ChunkLoadError|Loading chunk [\d]+ failed|Failed to fetch dynamically imported module|error loading dynamically imported module/i.test(
    message,
  );
}

/**
 * Auto-recover once when a deploy leaves the TWA/PWA on stale hashed chunks.
 * Mounted from the root layout (client).
 */
export function ClientRuntimeRecovery() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      const msg = event.message || "";
      const target = event.target;
      const scriptFailed =
        !!target &&
        typeof (target as HTMLElement).tagName === "string" &&
        (target as HTMLElement).tagName.toLowerCase() === "script";
      if (scriptFailed || looksLikeChunkFailure(msg)) {
        void recoverClientRuntime();
      }
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const msg =
        reason instanceof Error
          ? `${reason.name} ${reason.message}`
          : String(reason ?? "");
      if (looksLikeChunkFailure(msg)) {
        void recoverClientRuntime();
      }
    };
    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
