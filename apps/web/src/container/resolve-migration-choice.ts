import { migrate097Status, type Migrate097Bridge, type Migrate097Resolved } from "@/lib/desktop/migrate-097";

/** Longest the container waits for the shell before it keeps the old backend. */
export const MIGRATION_CHOICE_TIMEOUT_MS = 3_000;

/** Attempts per resolve when the shell is slow or throws, each bounded by the timeout. */
export const MIGRATION_CHOICE_ATTEMPTS = 3;

/** First wait between attempts; doubles each retry. */
export const MIGRATION_CHOICE_RETRY_MS = 200;

/** The bridge slice this resolver reads: the migration status plus the open folder. */
export type MigrationChoiceBridge = Migrate097Bridge & {
  vaultRoot?(): Promise<{ path: string } | null>;
};

/**
 * Settles the migration state before the backend is wired, so the choice is
 * made once and never races a late shell answer. Anything that does not
 * answer in time, has no folder, or throws is `unavailable`. The backend choice
 * then fails closed on desktop (read-only, see file-backend-choice.ts) and keeps
 * PostgREST with writes on for web and Android, where there is no shell.
 */
export async function resolveMigrationChoice(
  bridge: MigrationChoiceBridge | null | undefined,
  timeoutMs: number = MIGRATION_CHOICE_TIMEOUT_MS,
  retryDelayMs: number = MIGRATION_CHOICE_RETRY_MS,
): Promise<Migrate097Resolved> {
  for (let attempt = 1; ; attempt++) {
    const state = await settleOnce(bridge, timeoutMs);
    // Without a bridge (web, Android) there is no shell to wait for, so never retry.
    if (state !== "unavailable" || !bridge || attempt >= MIGRATION_CHOICE_ATTEMPTS) return state;
    await delay(retryDelayMs * 2 ** (attempt - 1));
  }
}

/**
 * While read-only on desktop, asks again on each window focus. The backend is
 * wired once, so the first usable answer reloads the app to make the choice.
 */
export function reresolveOnFocus(
  initial: Migrate097Resolved,
  bridge: MigrationChoiceBridge | null | undefined,
  target: FocusTarget,
  onResolved: (state: Migrate097Resolved) => void,
): void {
  if (initial !== "unavailable") return;
  const onFocus = () => {
    void resolveMigrationChoice(bridge).then((state) => {
      if (state === "unavailable") return;
      target.removeEventListener("focus", onFocus);
      onResolved(state);
    });
  };
  target.addEventListener("focus", onFocus);
}

type FocusTarget = {
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
};

function settleOnce(bridge: MigrationChoiceBridge | null | undefined, timeoutMs: number): Promise<Migrate097Resolved> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<Migrate097Resolved>((resolve) => {
    timer = setTimeout(() => resolve("unavailable"), timeoutMs);
  });
  return Promise.race([answer(bridge), timedOut]).finally(() => clearTimeout(timer));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function answer(bridge: MigrationChoiceBridge | null | undefined): Promise<Migrate097Resolved> {
  try {
    const root = await bridge?.vaultRoot?.();
    return await migrate097Status(bridge ?? null, root?.path ?? null);
  } catch {
    return "unavailable";
  }
}
