import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, IBM_Plex_Serif } from "next/font/google";
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

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
  display: "swap",
});

const ibmPlexSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-serif",
  display: "swap",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
  display: "swap",
});

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
      className={`${ibmPlexSans.variable} ${ibmPlexSerif.variable} ${ibmPlexMono.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
