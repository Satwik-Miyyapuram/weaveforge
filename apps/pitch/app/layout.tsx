import type { Metadata, Viewport } from "next";
import { FONT_VARIABLES } from "@/app/fonts";
import "@/app/globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/theme";
import { pitchShareMetadata } from "@/app/pitch/share-card";

/**
 * Root document for the exported pitch site.
 *
 * Deliberately thin: the product's stylesheet and theme boot script, the same
 * three fonts, and nothing else. No auth provider, no service worker, no app
 * shell — none of it has anything to do here, and every one of them would need
 * a server the static export does not have.
 */

const basePath = process.env.BASE_PATH ?? "";

/**
 * The host this export answers on.
 *
 * Not a guess: `scripts/copy-assets.mjs` writes the CNAME GitHub Pages serves
 * from (`PAGES_DOMAIN`, default www.weaveforge.org), and the Pages workflow
 * builds with `BASE_PATH: ""` precisely because the site sits at the root of
 * that domain. It becomes the card's `metadataBase`, which is what lets the
 * image URLs in `@/app/pitch/share-card` stay relative — and relative is what
 * keeps them correct under a non-empty `BASE_PATH`.
 */
const SITE_URL = "https://www.weaveforge.org";

/**
 * Title, description and the whole Open Graph / Twitter block come from the
 * pitch's own module, shared with the copy of this page the app serves at
 * `/pitch`. Two hosts, one card — see `@/app/pitch/share-card`.
 */
export const metadata: Metadata = {
  ...pitchShareMetadata({ origin: SITE_URL, basePath }),
  icons: { icon: `${basePath}/icons/weave_forge.svg` },
};

export const viewport: Viewport = {
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={FONT_VARIABLES}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
