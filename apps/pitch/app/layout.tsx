import type { Metadata, Viewport } from "next";
import { FONT_VARIABLES } from "@/app/fonts";
import "@/app/globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/theme";

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
 * that domain. `metadataBase` is also what lets every image URL below stay
 * relative, which is what keeps them correct under a non-empty `BASE_PATH`.
 */
const SITE_URL = "https://www.weaveforge.org";

const TITLE = "WeaveForge — one workspace for research";
const DESCRIPTION =
  "Papers, notes, plan, experiments and writing in one project, so the reasoning behind your research survives the years it takes to do it.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: TITLE,
  description: DESCRIPTION,
  icons: { icon: `${basePath}/icons/weave_forge.svg` },
  openGraph: {
    type: "website",
    siteName: "WeaveForge",
    locale: "en",
    url: `${basePath}/`,
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: `${basePath}/og.png`,
        width: 1200,
        height: 630,
        alt: "WeaveForge — one workspace for research.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [`${basePath}/og.png`],
  },
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
