"use client";

import { useEffect } from "react";
import { bestEffort } from "@/lib/best-effort";

/**
 * Registers the Serwist worker in production only.
 * Private data stays network-only — the SW precaches static assets exclusively.
 *
 * In development, unregister leftover production SWs (e.g. after `next start`)
 * so a stale precache cannot blank the page with Next’s Application error.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    // Durability is an optimization; failure must not affect startup.
    void bestEffort("Requesting persistent storage failed.", async () => {
      if (!navigator.storage?.persist) return;
      if (await navigator.storage.persisted()) return;
      await navigator.storage.persist();
    });

    if (!("serviceWorker" in navigator)) return;

    if (process.env.NODE_ENV !== "production") {
      void bestEffort("Clearing dev service workers failed.", async () => {
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
      });
      return;
    }

    // Offline enhancement is best-effort and must not affect app startup.
    void bestEffort("Service worker registration failed.", async () => {
      if (window.serwist) {
        await window.serwist.register();
        return;
      }
      await navigator.serviceWorker.register("/sw.js", { scope: "/" });
    });
  }, []);

  return null;
}
