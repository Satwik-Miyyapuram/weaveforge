/**
 * Continue on a verified desktop upgrade. With no account signed in, the folder now on
 * files opens in local mode, so the reload lands in the workspace, not on sign-in (E12).
 * A signed-in window, or one that cannot say, keeps its choice.
 */
export async function continueAfterUpgrade(
  signedIn: () => Promise<boolean>,
  chooseLocal: () => void,
  reload: () => void,
): Promise<void> {
  const account = await signedIn().catch(() => true);
  if (!account) chooseLocal();
  reload();
}
