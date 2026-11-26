import { desktop } from "@/lib/desktop/desktop-bridge";
import { migrate097Status, usesFileBackend } from "@/lib/desktop/migrate-097";

/**
 * Same text as the container's read-only message. Kept here, not imported, so
 * the pre-disclaimer chunk does not pull in the container's repositories.
 */
export const PERSONAL_WRITES_BLOCKED_MESSAGE = "read-only until export verified";

export class PersonalWritesBlockedError extends Error {
  constructor() {
    super(PERSONAL_WRITES_BLOCKED_MESSAGE);
    this.name = "PersonalWritesBlockedError";
  }
}

/**
 * The settings writes that hold personal data. Account rows (acceptDisclaimer,
 * ensureProvisioned) are deliberately absent: they are server rows, not exported
 * data, so they are allowed in every state.
 */
export const PERSONAL_SETTINGS_WRITES = ["save", "saveDisclaimer", "saveAppearance", "saveNoticeSeen"] as const;

type PersonalSettingsWrite = (typeof PERSONAL_SETTINGS_WRITES)[number];

type Fn = (...args: unknown[]) => unknown;

/**
 * Whether personal-data writes are refused right now. Same rule as
 * chooseFileBackend: on desktop, a folder in a read-only state (not wired to
 * files, and not "none") refuses writes; the files-mode states (verified,
 * removing, removed) write to files and allow them. An unnamed folder fails
 * closed, because migrate097Status reports it as "unavailable". Checked at call
 * time, because the folder can move while the window is open.
 */
export async function personalWritesBlocked(): Promise<boolean> {
  const shell = desktop();
  if (!shell) return false;
  let folder: string | null = null;
  try {
    folder = (await shell.vaultRoot())?.path ?? null;
  } catch {
    folder = null;
  }
  const state = await migrate097Status(shell, folder);
  return !usesFileBackend(state) && state !== "none";
}

/**
 * Wraps the named write methods so each one first asks `blocked()` and refuses
 * before the target is touched. Every other member passes through bound to the
 * target, so methods that read private fields still work.
 */
export function guardWrites<T extends object, K extends keyof T>(
  target: T,
  writes: readonly K[],
  blocked: () => Promise<boolean>,
): T {
  const guarded = new Set<PropertyKey>(writes);
  // One wrapper per key, so `guarded.save === guarded.save` holds across reads.
  const wrappers = new Map<PropertyKey, { source: Fn; wrapper: Fn }>();
  return new Proxy(target, {
    get(obj, key) {
      const value: unknown = Reflect.get(obj, key, obj);
      if (typeof value !== "function") return value;
      const source = value as Fn;
      const cached = wrappers.get(key);
      if (cached?.source === source) return cached.wrapper;
      const wrapper: Fn = guarded.has(key)
        ? async (...args: unknown[]) => {
            if (await blocked()) throw new PersonalWritesBlockedError();
            return source.apply(obj, args);
          }
        : source.bind(obj);
      wrappers.set(key, { source, wrapper });
      return wrapper;
    },
  });
}

/**
 * A settings repository whose personal writes follow the read-only rule; account
 * rows pass. Wraps only the personal writes the repository actually has, so a
 * repository without one (such as saveNoticeSeen) is still wrapped and passes
 * everything else through.
 */
export function guardPersonalSettings<T extends object>(repo: T): T {
  const present = PERSONAL_SETTINGS_WRITES.filter(
    (name): name is PersonalSettingsWrite & keyof T => typeof (repo as Record<string, unknown>)[name] === "function",
  );
  return guardWrites(repo, present, personalWritesBlocked);
}
