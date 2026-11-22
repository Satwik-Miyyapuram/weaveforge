import { migrate097Status, type Migrate097Bridge, type Migrate097Resolved } from "@/lib/desktop/migrate-097";

/** Longest the container waits for the shell before it keeps the old backend. */
export const MIGRATION_CHOICE_TIMEOUT_MS = 3_000;

/** The bridge slice this resolver reads: the migration status plus the open folder. */
export type MigrationChoiceBridge = Migrate097Bridge & {
  vaultRoot?(): Promise<{ path: string } | null>;
};

/**
 * Settles the migration state before the backend is wired, so the choice is
 * made once and never races a late shell answer. Anything that does not
 * answer in time, has no folder, or throws is `unavailable`, which keeps the
 * old backend.
 */
export async function resolveMigrationChoice(
  bridge: MigrationChoiceBridge | null | undefined,
  timeoutMs: number = MIGRATION_CHOICE_TIMEOUT_MS,
): Promise<Migrate097Resolved> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Migrate097Resolved>((resolve) => {
    timer = setTimeout(() => resolve("unavailable"), timeoutMs);
  });
  try {
    return await Promise.race([answer(bridge), timedOut]);
  } finally {
    clearTimeout(timer);
  }
}

async function answer(bridge: MigrationChoiceBridge | null | undefined): Promise<Migrate097Resolved> {
  try {
    const root = await bridge?.vaultRoot?.();
    return await migrate097Status(bridge ?? null, root?.path ?? null);
  } catch {
    return "unavailable";
  }
}
