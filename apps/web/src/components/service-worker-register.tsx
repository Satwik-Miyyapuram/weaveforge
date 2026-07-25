"use client";

import { useEffect } from "react";

/**
 * Registers the Serwist worker in production only.
 * Private data stays network-only — the SW precaches static assets exclusively.
 *
 * In development, unregister leftover production SWs (e.g. after `next start`)
 * so a stale precache cannot blank the page with Next’s Application error.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    const requestPersistence = async () => {
      try {
        if (!navigator.storage?.persist) return;
        if (await navigator.storage.persisted()) return;
        await navigator.storage.persist();
      } catch {
        // Durability is an optimization; failure must not affect startup.
      }
    };
    void requestPersistence();

    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void (async () => {
        try {
          const regs = await navigator.serviceWorker.getRegistrations();
          await Promise.all(regs.map((r) => r.unregister()));
          if (typeof caches !== "undefined") {
            const keys = await caches.keys();
            await Promise.all(
              keys
                .filter((k) => k.includes("serwist") || k.includes("thesis-"))
                .map((k) => caches.delete(k)),
            );
          }
        } catch {
          // Dev cleanup is best-effort.
        }
      })();
      return;
    }

    const register = async () => {
      try {
        if (window.serwist) {
          await window.serwist.register();
          return;
        }
        await navigator.serviceWorker.register("/sw.js", { scope: "/" });
      } catch {
        // Offline enhancement is best-effort and must not affect app startup.
      }
    };

    void register();
  }, []);

  return null;
}
