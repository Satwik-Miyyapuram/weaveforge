/**
 * The desktop fallback for 0.9.7: when this device's old local database has
 * not been exported, its repositories answer reads and refuse every write, so
 * nothing can change data that the export has not yet copied to files.
 *
 * A method counts as a write when its name starts with a write verb. The
 * iteration test in container/test checks every method of every repository, so
 * a new write method with a verb name cannot slip past unwrapped.
 */
export const READ_ONLY_MESSAGE = "read-only until export verified";

const WRITE_VERB =
  /^(create|save|set|update|upsert|put|add|insert|delete|remove|move|rename|pin|unpin|track|untrack|clear|reset|import|append|write|link|unlink|mark|apply|submit|record|touch|reorder|replace|share|revoke|accept|reject|dismiss|store|sync|bind|register|enqueue|claim|release|lock|unlock|commit|flush|purge|trash|restore)/;

export function isWriteMethod(name: string): boolean {
  return WRITE_VERB.test(name);
}

/** Method names of a repository object, walking its prototype chain (no Object.prototype). */
export function repositoryMethods(repo: object): string[] {
  const names = new Set<string>();
  for (let p: object | null = repo; p && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const name of Object.getOwnPropertyNames(p)) {
      if (name === "constructor") continue;
      const desc = Object.getOwnPropertyDescriptor(p, name);
      if (desc && typeof desc.value === "function") names.add(name);
    }
  }
  return [...names];
}

/** Wraps one repository: write methods throw, every other method passes through. */
export function readOnlyRepository<T extends object>(repo: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const name of repositoryMethods(repo)) {
    const original = (repo as Record<string, unknown>)[name] as (...args: unknown[]) => unknown;
    wrapped[name] = isWriteMethod(name)
      ? () => {
          throw new Error(READ_ONLY_MESSAGE);
        }
      : (...args: unknown[]) => original.apply(repo, args);
  }
  return wrapped as T;
}

/** Wraps every repository object of a backend bag; non-object fields pass through. */
export function readOnlyRepositories<T extends object>(repos: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(repos)) {
    out[key] = value && typeof value === "object" ? readOnlyRepository(value) : value;
  }
  return out as T;
}

/** Backend bag fields that hold repositories or stores. */
const REPOSITORY_FIELD = /(Repository|Store)$/;

/**
 * Wraps only the repository and store fields of a wired backend. Use cases, the
 * database client and config are left as they are.
 */
export function readOnlyBackend<T extends object>(backend: T): T {
  const out: Record<string, unknown> = { ...(backend as Record<string, unknown>) };
  for (const [key, value] of Object.entries(backend)) {
    if (REPOSITORY_FIELD.test(key) && value && typeof value === "object") out[key] = readOnlyRepository(value);
  }
  return out as T;
}
