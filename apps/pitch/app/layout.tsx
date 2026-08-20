import type { Metadata, Viewport } from "next";
import { FONT_VARIABLES } from "@/app/fonts";
import "@/app/globals.css";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";

/**
 * Root document for the exported pitch site.
 *
 * Deliberately thin: the product's stylesheet and theme boot script, the same
 * three fonts, and nothing else. No auth provider, no service worker, no app
 * shell — none of it has anything to do here, and every one of them would need
 * a server the static export does not have.
 */

const basePath = process.env.BASE_PATH ?? "";

export const metadata: Metadata = {
  title: "WeaveForge — one workspace for research",
  description:
    "Papers, notes, plan, experiments and writing in one project, so the reasoning behind your research survives the years it takes to do it.",
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
