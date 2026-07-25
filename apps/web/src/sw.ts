/**
 * Privacy-preserving service worker (Serwist).
 *
 * Precache: hashed Next static chunks + public icons/manifest only.
 * Runtime: StaleWhileRevalidate for `/_next/static/` JS/CSS (instant launch;
 * content-hashed URLs are immutable so a cached copy is never wrong).
 * Never cache HTML/navigations (Next embeds build-id-specific chunk + RSC URLs,
 * so a cached shell breaks after a deploy), RSC payloads, `/api/*`, or blobs.
 *
 * New deploys ship new hashed URLs, so patched bundles reach clients on the
 * next navigation; activate wipes legacy runtime caches from older workers.
 */
import type { PrecacheEntry, RuntimeCaching, SerwistGlobalConfig } from "serwist";
import { CacheFirst, ExpirationPlugin, Serwist, StaleWhileRevalidate } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const DAY_SECONDS = 24 * 60 * 60;
const WEEK_SECONDS = 7 * 24 * 60 * 60;

/** Runtime caches owned by this worker — wiped on activate / may be cleared on sign-out. */
const RUNTIME_CACHE_NAMES = ["thesis-next-static", "thesis-next-static-fonts"] as const;
/** Retired caches — deleted on activate. thesis-app-shell caused build-id/chunk
 *  mismatches on Next.js after a deploy (client-side exception on reopen). */
const LEGACY_RUNTIME_CACHE_NAMES = ["thesis-next-static-fallback", "thesis-app-shell"] as const;

const staticOnlyRuntime: RuntimeCaching[] = [
  {
    // JS/CSS: content-hashed and immutable, so serve instantly from cache and
    // revalidate in the background — new deploys ship new hashed URLs (fetched
    // fresh), so a stale copy for a given URL can never be wrong. Instant launch.
    matcher: /\/_next\/static.+\.(?:js|css)$/i,
    handler: new StaleWhileRevalidate({
      cacheName: "thesis-next-static",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 128,
          maxAgeSeconds: DAY_SECONDS,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
  {
    // Fonts are not security-sensitive; CacheFirst is fine with a bounded TTL.
    matcher: /\/_next\/static.+\.woff2?$/i,
    handler: new CacheFirst({
      cacheName: "thesis-next-static-fonts",
      plugins: [
        new ExpirationPlugin({
          maxEntries: 32,
          maxAgeSeconds: WEEK_SECONDS,
          maxAgeFrom: "last-used",
        }),
      ],
    }),
  },
];

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: false,
  runtimeCaching: staticOnlyRuntime,
  precacheOptions: {
    cleanupOutdatedCaches: true,
  },
});

// Wipe runtime caches when a new worker activates (deploy), so offline
 // fallbacks cannot outlive a security patch. Precache cleanup is Serwist's job.
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const drop = new Set<string>([...RUNTIME_CACHE_NAMES, ...LEGACY_RUNTIME_CACHE_NAMES]);
      await Promise.all(keys.filter((k) => drop.has(k)).map((k) => caches.delete(k)));
    })(),
  );
});

serwist.addEventListeners();
