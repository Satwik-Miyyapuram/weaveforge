/**
 * Deleting the old local data after a verified 0.9.7 migration. In order: the
 * TS verify, then the secrets move (keychain), then the Tauri remove. Each
 * step gates the next, so the remove never runs on an unverified or
 * unmoved migration. Tauri's remove also refuses a stale report on its own.
 */

export interface RemoveOldStatus {
  state: "none" | "verified" | "incomplete";
  removedAt?: string;
  /**
   * True when the migrated data was exported to the open folder. The shell decides
   * this; the page never compares paths (Rust stores \\?\ verbatim paths). Missing means false.
   */
  exportedHere?: boolean;
  /** The backup the confirm names; absent means the button stays hidden. */
  backupPath?: string;
}

/** Result of the TS verify pass that runs before the remove. */
export interface VerifyResult {
  state: "none" | "verified" | "incomplete";
  missing: string[];
}

/** The TS verify, injected; WEB-EXPORT supplies it. */
export type VerifyRunner = (folder: string) => Promise<VerifyResult>;

/** Moves the secrets into the OS keychain (Tauri `migrate_097_move_secrets`), injected. */
export type SecretsMover = (folder: string) => Promise<void>;

export interface RemoveOldDeps {
  verify: VerifyRunner | null;
  moveSecrets: SecretsMover | null;
}

/** `removed`: the old data is gone. `keychain-missing`: show the install dialog. `refused`: nothing changed. */
export type RemoveOutcome = "removed" | "refused" | "keychain-missing";

/**
 * Offered only for a verified migration whose old data is still on disk,
 * whose export the shell reports as made to this folder, and which names its
 * backup. Any missing field hides the button (fail closed).
 */
export function canRemoveOld(status: RemoveOldStatus): boolean {
  return (
    status.state === "verified" &&
    !status.removedAt &&
    status.exportedHere === true &&
    typeof status.backupPath === "string" &&
    status.backupPath.length > 0
  );
}

/** True when a secrets-move failure is the "no keychain on this machine" case. */
export function isKeychainMissing(err: unknown): boolean {
  return err instanceof Error && /no keychain available/i.test(err.message);
}

/**
 * Verify, move secrets, then remove. Refuses (nothing changed) when a dep is
 * missing, the verify fails or lists missing kinds, or the bridge lacks the
 * remove. A keychain-missing move failure is reported separately so the UI
 * can show the install dialog.
 */
export async function removeOldData(
  bridge: { migrate097RemoveOld?(folder: string): Promise<void> } | null | undefined,
  deps: RemoveOldDeps,
  folder: string,
): Promise<RemoveOutcome> {
  if (!bridge || typeof bridge.migrate097RemoveOld !== "function") return "refused";
  if (!deps.verify || !deps.moveSecrets) return "refused";
  let check: VerifyResult;
  try {
    check = await deps.verify(folder);
  } catch {
    return "refused";
  }
  if (check.state !== "verified" || check.missing.length > 0) return "refused";
  try {
    await deps.moveSecrets(folder);
  } catch (err) {
    return isKeychainMissing(err) ? "keychain-missing" : "refused";
  }
  await bridge.migrate097RemoveOld(folder);
  return "removed";
}
