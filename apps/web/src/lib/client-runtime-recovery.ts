"use client";

/**
 * Recovers from Next.js blank “Application error” pages caused by stale
 * service-worker precaches / build-id mismatches (common on Android TWA after
 * deploys). One automatic reload per tab session after wiping SW + caches.
 */
async function resetClientRuntimeCaches(): Promise<void> {
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* best-effort */
  }
  try {
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    /* best-effort */
  }
}

/** Clear WeaveForge local/session keys that can poison cold start after a crash. */
function clearThesisWebStorage(): void {
  try {
    const drop: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith("thesis.") || k.startsWith("sb-"))) drop.push(k);
    }
    for (const k of drop) localStorage.removeItem(k);
  } catch {
    /* best-effort */
  }
  try {
    sessionStorage.clear();
  } catch {
    /* best-effort */
  }
}

const RELOAD_FLAG = "thesis.runtime.recovered";

export async function recoverClientRuntime(opts?: { clearAppStorage?: boolean }): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    if (sessionStorage.getItem(RELOAD_FLAG) === "1") return;
    sessionStorage.setItem(RELOAD_FLAG, "1");
  } catch {
    /* continue anyway */
  }
  await resetClientRuntimeCaches();
  if (opts?.clearAppStorage) clearThesisWebStorage();
  window.location.replace("/");
}

/**
 * What the "Reset app data" button on both error screens does.
 *
 * The two screens cannot share their markup — `global-error` replaces the whole
 * document, stylesheet included, so it cannot use the app's classes — but the
 * three steps behind the button are not a styling decision, and they were
 * written out twice.
 */
export function resetAppData(): void {
  void (async () => {
    await resetClientRuntimeCaches();
    clearThesisWebStorage();
    window.location.replace("/");
  })();
}
