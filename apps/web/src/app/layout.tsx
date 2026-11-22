import type { Metadata, Viewport } from "next";
import { FONT_VARIABLES } from "./fonts";
import "./globals.css";
import { AuthProvider } from "@/features/auth/ui/auth-provider";
import { Install097Gate } from "@/features/workspace/ui/install-097-gate";
import { AppShell } from "./app-shell";
import { Migrate097Gate } from "@/lib/desktop/migrate-097-gate";
import { BootSnapshot } from "./boot-snapshot";
import { THEME_BOOT_SCRIPT } from "@/lib/theme/theme";
import { ThemeColorMeta } from "./theme-color-meta";
import { WindowScrollbar } from "@/components/window-scrollbar";
import { DesktopTitleBar, TITLE_BAR_BOOT_SCRIPT } from "@/components/desktop-title-bar";
import { DesktopWindowIcon } from "@/features/desktop-window-icon";
import { PlanWidgetTheme } from "@/components/plan-widget-theme";
import { ReactiveMotion } from "./reactive-motion";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ClientRuntimeRecovery } from "@/components/client-runtime-recovery";

export const metadata: Metadata = {
  title: "WeaveForge",
  description: "A private research environment for literature, experiments, and logs.",
  manifest: "/manifest.webmanifest",
  // The SVG themes itself from the OS colour scheme. Browsers without SVG favicons
  // get a PNG for their scheme: the light emblem, or the light-ink variant on dark.
  // iOS ignores an SVG touch icon and screenshots the page instead, so the home
  // screen gets a 180px PNG (full-bleed; iOS rounds the corners itself).
  icons: {
    icon: [
      { url: "/icons/weave_forge.svg", type: "image/svg+xml" },
      { url: "/icons/icon-512.png", type: "image/png", media: "(prefers-color-scheme: light)" },
      { url: "/icons/icon-512-dark.png", type: "image/png", media: "(prefers-color-scheme: dark)" },
    ],
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: { capable: true, title: "WeaveForge", statusBarStyle: "black-translucent" },
  // Next 14 writes only the unprefixed `mobile-web-app-capable`; older iPadOS
  // still needs Apple's name to open the home-screen app without Safari's bars.
  other: { "apple-mobile-web-app-capable": "yes" },
};

export const viewport: Viewport = {
  // Static fallback before JS/ThemeColorMeta — Amoled black (default theme).
  // ThemeColorMeta + boot script then track the live --bg.
  themeColor: "#000000",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/**
 * The authed shell is entirely client-rendered (auth/session resolve in the
 * browser), so routes can be statically prerendered. Static routes let Next
 * prefetch them on <Link> hover/viewport, making tab navigation instant instead
 * of paying a per-click server RSC round-trip.
 */

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={FONT_VARIABLES}
    >
      <head>
        <meta name="mobile-web-app-capable" content="yes" />
        <script
          dangerouslySetInnerHTML={{
            __html: THEME_BOOT_SCRIPT,
          }}
        />
        <script dangerouslySetInnerHTML={{ __html: TITLE_BAR_BOOT_SCRIPT }} />
      </head>
      <body>
        {/* First focusable thing on the page, ahead of the desktop title bar
            and the nine-item nav, so a keyboard user reaches content in one
            Tab. Hidden until focused; `base.css` already draws the ring. */}
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <ThemeColorMeta />
        <ReactiveMotion />
        <ServiceWorkerRegister />
        <ClientRuntimeRecovery />
        <WindowScrollbar />
        <DesktopTitleBar />
        <DesktopWindowIcon />
        <PlanWidgetTheme />
        <Install097Gate>
          <AuthProvider>
            <BootSnapshot />
            <Migrate097Gate>
              <AppShell>{children}</AppShell>
            </Migrate097Gate>
          </AuthProvider>
        </Install097Gate>
      </body>
    </html>
  );
}
