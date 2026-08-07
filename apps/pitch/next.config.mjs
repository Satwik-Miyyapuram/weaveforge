/** @type {import('next').NextConfig} */
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webSrc = path.resolve(__dirname, "../web/src");

/**
 * The pitch site, built as plain static files for GitHub Pages.
 *
 * It is a separate Next app rather than a page of the product because the
 * product cannot be statically exported: it has 34 API routes and a runtime
 * that expects a server. This app has exactly one route and no server at all,
 * and it renders the product's own page component from `apps/web` — the same
 * file the in-app /pitch route renders, so the two cannot drift.
 *
 * BASE_PATH is the repository name when serving from
 * `user.github.io/<repo>`, and empty for a custom domain at the apex.
 */
const basePath = process.env.BASE_PATH ?? "";

const nextConfig = {
  output: "export",
  basePath,
  // basePath prefixes Link and next/image, but not a URL built in JS — the
  // pdf.js worker is fetched by path, so the page needs the value too.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  // Trailing slashes so GitHub Pages resolves directory URLs to index.html
  // without a redirect it cannot be configured to perform.
  trailingSlash: true,
  reactStrictMode: true,
  transpilePackages: ["@weaveforge/core"],
  // No image optimisation server exists behind a static export.
  images: { unoptimized: true },
  webpack: (config) => {
    // Resolve the product's own `@/…` specifiers against apps/web, so the
    // imported page pulls the real EntityCard and the real palette.
    config.resolve.alias = { ...config.resolve.alias, "@": webSrc };
    // @weaveforge/core is consumed as TypeScript source with ESM ".js" import
    // specifiers (NodeNext style). Teach webpack to resolve ".js" -> ".ts".
    config.resolve.extensionAlias = {
      ".js": [".ts", ".tsx", ".js"],
      ".mjs": [".mts", ".mjs"],
    };
    return config;
  },
};

export default nextConfig;
