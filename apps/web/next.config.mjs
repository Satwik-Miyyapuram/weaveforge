/** @type {import('next').NextConfig} */
import path from "node:path";
import { fileURLToPath } from "node:url";
import bundleAnalyzer from "@next/bundle-analyzer";
import withSerwistInit from "@serwist/next";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

/** Only immutable build assets + public icons/manifest — never HTML/API/blobs. */
const withSerwist = withSerwistInit({
  swSrc: "src/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  register: false,
  cacheOnNavigation: false,
  reloadOnOnline: false,
  globPublicPatterns: ["manifest.webmanifest", "icons/**/*"],
  exclude: [/\.map$/, /^manifest.*\.js$/, /^server\//, /^middleware/],
  manifestTransforms: [
    async (entries) => ({
      manifest: entries.filter((entry) => {
        const url = entry.url;
        return (
          url.startsWith("/_next/static/") ||
          url.startsWith("/icons/") ||
          url === "/manifest.webmanifest"
        );
      }),
      warnings: [],
    }),
  ],
});

const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@weaveforge/core"],
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
