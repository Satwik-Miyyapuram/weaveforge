import { desktop } from "@/lib/desktop/desktop-bridge";
import { migrate097Status } from "@/lib/desktop/migrate-097";

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
 * Whether personal-data writes are refused right now. Same rule as
 * chooseFileBackend's read-only branch: on desktop, any state other than a
 * genuine "none" is read-only, and an unnamed folder fails closed. Checked at
 * call time, because the folder can move while the window is open.
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
  return (await migrate097Status(shell, folder)) !== "none";
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
  return new Proxy(target, {
    get(obj, key) {
      const value: unknown = Reflect.get(obj, key, obj);
      if (typeof value !== "function") return value;
      if (!guarded.has(key)) return value.bind(obj);
      return async (...args: unknown[]) => {
        if (await blocked()) throw new PersonalWritesBlockedError();
        return value.apply(obj, args);
      };
    },
  });
}
