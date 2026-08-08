/** @type {import('next').NextConfig} */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bundleAnalyzer from "@next/bundle-analyzer";
import withSerwistInit from "@serwist/next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/**
 * Public files to precache, listed rather than globbed.
 *
 * `globPublicPatterns` walks the public directory with the host OS separator,
 * so a Windows build produced entries like "/icons\icon-192.png". That URL
 * 308-redirects, a redirecting entry rejects the precache install, and a failed
 * install takes the whole precache with it — silently, so the app looks fine
 * and simply never caches anything. It also swept up `desktop.ini`.
 *
 * Serwist only globs when `additionalPrecacheEntries` is absent, and these
 * entries are appended after `manifestTransforms` run, so a transform cannot
 * repair them. Building the list here is the only place that can.
 */
const publicDir = path.join(__dirname, "public");
const PUBLIC_PRECACHE_FILES = ["manifest.webmanifest", "icons/icon-192.png", "icons/icon-512.png", "icons/maskable-512.png", "icons/weave_forge.svg"];
const publicPrecacheEntries = PUBLIC_PRECACHE_FILES.filter((file) =>
  fs.existsSync(path.join(publicDir, file)),
).map((file) => ({
  url: `/${file}`,
  revision: createHash("sha256").update(fs.readFileSync(path.join(publicDir, file))).digest("hex"),
}));

/** Only immutable build assets + public icons/manifest — never HTML/API/blobs. */
const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  register: false,
  cacheOnNavigation: false,
  reloadOnOnline: false,
  additionalPrecacheEntries: publicPrecacheEntries,
  exclude: [/\.map$/, /^manifest.*\.js$/, /^server\//, /^middleware/],
  manifestTransforms: [
    /**
     * Precache the boot set only — not the whole build.
     *
     * Precaching every `/_next/static/**` entry meant a first visit (and every
     * visit after a deploy) downloaded 321 files before the app was useful:
     * 188 vendor chunks, 91 font files, and a chunk for every route, most of
     * which that session never opens. Measured on a real load, page requests
     * were 25 and the worker's install was the other 327.
     *
     * What stays: the framework/webpack/main-app/polyfill chunks, the build
     * manifests, and CSS — enough for the shell to start offline. Everything
     * else is content-hashed and already covered at runtime by the
     * StaleWhileRevalidate rule for JS/CSS and CacheFirst for fonts in
     * `src/sw.ts`, so it is cached the first time a route actually needs it.
     * The trade is that a route never visited online is not available offline.
     */
    async (entries) => ({
      manifest: entries
        // Public-folder entries are globbed with the host OS separator, so a
        // Windows build emitted "/icons\icon-192.png". That URL 308-redirects,
        // and a redirecting entry fails the precache install — which fails all
        // of it, silently. Normalize before anything else looks at the path.
        .map((entry) => ({ ...entry, url: entry.url.replace(/\\/g, "/") }))
        .filter((entry) => {
          const url = entry.url;
          // Windows Explorer metadata, never part of the app.
          if (url.endsWith("/desktop.ini")) return false;
          if (url.startsWith("/icons/") || url === "/manifest.webmanifest") return true;
          if (!url.startsWith("/_next/static/")) return false;
          return (
            /\/chunks\/(webpack|main-app|framework|polyfills|main)[-.]/.test(url) ||
            /_(build|ssg)Manifest\.js$/.test(url) ||
            url.endsWith(".css")
          );
        }),
      warnings: [],
    }),
  ],
});

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@weaveforge/core"],
  // The docs live on their own host (GitHub Pages, apps/pitch), but people
  // reach for /docs on the app's domain because that is where they already are.
  // Send them rather than showing a 404.
  //
  // Not permanent: a 308 is cached by the browser indefinitely, and if the docs
  // ever move back under this domain that cache is not ours to clear.
  async redirects() {
    return [
      { source: "/docs", destination: "https://docs.weaveforge.org/docs/", permanent: false },
      {
        source: "/docs/:path*",
        destination: "https://docs.weaveforge.org/docs/:path*",
        permanent: false,
      },
    ];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https: wss:",
              "frame-ancestors 'none'",
              "base-uri 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        ],
      },
    ];
  },
  webpack: (config, { isServer, dev }) => {
    // @weaveforge/core is consumed as TypeScript source with ESM ".js" import
    // specifiers (NodeNext style). Teach webpack to resolve ".js" -> ".ts".
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    if (dev) {
      // Batch rapid saves (e.g. graph edits) so HMR does not request stale hot-update chunks.
      config.watchOptions = {
        ...config.watchOptions,
        aggregateTimeout: 300,
      };
    }
    // The encoder runtime ships prebuilt ESM that webpack's parser rejects as
    // "import outside module code". It is already a module; this says so.
    config.module.rules.push({
      test: /\.m?js$/,
      include: /node_modules[\\/](@huggingface[\\/]transformers|onnxruntime-web|onnxruntime-common)/,
      type: "javascript/auto",
      resolve: { fullySpecified: false },
    });

    if (!isServer) {
      config.resolve.alias = {
        ...config.resolve.alias,
        [path.resolve(__dirname, "src/backend/providers/postgres/wire-postgres-backend.ts")]:
          path.resolve(__dirname, "src/backend/providers/postgres/wire-postgres-backend.client.ts"),
        // The encoder runtime ships a Node backend built on native `.node`
        // binaries. Nothing in a browser can load those, and webpack cannot
        // parse them; the WASM backend is the one that runs here.
        "onnxruntime-node": false,
      };
    }
    // The encoder is only ever constructed inside a worker in the browser. On
    // the server the import must not be followed at all — resolving it drags in
    // platform-specific binaries for whatever machine did the build.
    if (isServer) {
      config.externals = [...(config.externals ?? []), "@huggingface/transformers"];
    }
    return config;
  },
};

export default withSerwist(withBundleAnalyzer(nextConfig));
