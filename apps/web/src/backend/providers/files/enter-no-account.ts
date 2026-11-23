import { desktop, type DesktopBridge } from "@/lib/desktop/desktop-bridge";

/** What "Use without an account" needs from the app. */
export interface EnterNoAccountDeps {
  /** Opens the folder dialog; `false` when it was dismissed or there is no shell. */
  chooseFolder: () => Promise<false | { warnings: readonly string[] }>;
  /** Shows the shell's folder warnings; resolves when the reader presses OK. */
  showWarnings: (warnings: readonly string[]) => Promise<void>;
  /** Remembers the no-account choice for this window and the next launch. */
  remember: () => Promise<void>;
  reload: () => void;
}

/**
 * Work without an account: pick the workspace folder, let the reader see any
 * folder warnings, then remember the choice and reload, since the wiring is
 * built once at startup. The folder comes first so a dismissed dialog leaves the
 * sign-in screen as it was. True when reloading.
 */
export async function enterNoAccount(deps: EnterNoAccountDeps): Promise<boolean> {
  const picked = await deps.chooseFolder();
  if (!picked) return false;
  if (picked.warnings.length > 0) await deps.showWarnings(picked.warnings);
  await deps.remember();
  deps.reload();
  return true;
}

/**
 * Ask the shell for a folder and nothing more: the shell remembers the pick,
 * and the reloaded window connects it. Connecting here would watch and sync the
 * folder while the window is still signed out, before the choice is remembered.
 */
export async function pickFolderOnly(
  bridge: Pick<DesktopBridge, "chooseVaultRoot"> | null,
): Promise<false | { warnings: readonly string[] }> {
  const root = await bridge?.chooseVaultRoot();
  if (!root) return false;
  return { warnings: root.warnings ?? [] };
}

/**
 * The desktop wiring: the caller brings the warnings notice; the flag is set
 * only here, through the files provider, and its module loads on click so the
 * sign-in bundle stays light.
 */
export function enterNoAccountOnDesktop(ui: Pick<EnterNoAccountDeps, "showWarnings">): Promise<boolean> {
  return enterNoAccount({
    ...ui,
    chooseFolder: () => pickFolderOnly(desktop()),
    remember: async () => (await import("./no-account-mode")).setLocalMode(true),
    reload: () => window.location.reload(),
  });
}
