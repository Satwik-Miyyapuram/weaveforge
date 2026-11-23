/** What the "Use without an account" entry needs from the app. */
export interface WithoutAccountDeps {
  /** Opens the folder dialog; `false` when it was dismissed or there is no shell. */
  chooseFolder: () => Promise<false | { warnings: readonly string[] }>;
  setLocalMode: (on: boolean) => void;
  reload: () => void;
}

/**
 * Work without an account: pick the workspace folder, then remember the choice
 * and reload, since the wiring is built once at startup. The folder comes first
 * so a dismissed dialog leaves the sign-in screen as it was. True when reloading.
 */
export async function enterWithoutAccount(deps: WithoutAccountDeps): Promise<boolean> {
  const picked = await deps.chooseFolder();
  if (!picked) return false;
  deps.setLocalMode(true);
  deps.reload();
  return true;
}
