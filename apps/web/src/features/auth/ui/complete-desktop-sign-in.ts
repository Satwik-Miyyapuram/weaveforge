import { logToApp, type AppLogInput } from "@/lib/error-report/app-log";

interface LightModule {
  getLightContainer(): { auth: { completeOAuth(query: string): Promise<void> } };
}

export interface CompleteDesktopSignInDeps {
  load?: () => Promise<LightModule>;
  log?: (line: AppLogInput) => void;
  /** False once the provider unmounted; nothing is redeemed then. */
  isActive: () => boolean;
}

/**
 * Redeems a sign-in the desktop shell handed back.
 *
 * Never rejects. The auth listener never fires for a failed exchange, so this
 * is the only place that knows; a chunk that fails to load or a refused code is
 * logged instead of left as an unhandled rejection (P2-147).
 */
export async function completeDesktopSignIn(
  query: string,
  { load = () => import("@/light-bootstrap"), log = logToApp, isActive }: CompleteDesktopSignInDeps,
): Promise<void> {
  try {
    const { getLightContainer } = await load();
    if (!isActive()) return;
    await getLightContainer().auth.completeOAuth(query);
  } catch (error) {
    console.error("[weaveforge] sign-in could not be completed:", error);
    log({ level: "error", source: "auth", message: "sign-in could not be completed", detail: String(error) });
  }
}
