import type { Metadata, Viewport } from "next";
import { FONT_VARIABLES } from "./fonts";
import "./globals.css";
import { AuthProvider } from "@/features/auth/ui/auth-provider";
import { AppShell } from "./app-shell";
import { THEME_BOOT_SCRIPT } from "@/lib/theme";
import { ThemeColorMeta } from "./theme-color-meta";
import { ReactiveMotion } from "./reactive-motion";
import { ServiceWorkerRegister } from "@/components/service-worker-register";
import { ClientRuntimeRecovery } from "@/components/client-runtime-recovery";

export const metadata: Metadata = {
  title: "WeaveForge",
  description: "A private research environment for literature, experiments, and logs.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icons/weave_forge.svg", apple: "/icons/weave_forge.svg" },
  appleWebApp: { capable: true, title: "WeaveForge", statusBarStyle: "black-translucent" },
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
      </head>
      <body>
        <ThemeColorMeta />
        <ReactiveMotion />
        <ServiceWorkerRegister />
        <ClientRuntimeRecovery />
        <AuthProvider>
          <AppShell>{children}</AppShell>
        </AuthProvider>
      </body>
    </html>
  );
}
