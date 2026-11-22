import type { Secrets, SecretsStore } from "@/features/settings/infrastructure/parts";

/** Thrown when a browser build is asked to save an API key. Callers can match it by class or `name`. */
export class ApiKeysNotInBrowserError extends Error {
  constructor() {
    super("API keys can't be saved in the browser in this version");
    this.name = "ApiKeysNotInBrowserError";
  }
}

/**
 * The browser has no OS keychain, so keys are never stored or sent anywhere: `load` reports no keys
 * and `save` refuses with a typed error. Nothing here touches the network or a file. A save with no
 * non-empty key has nothing to store, so it resolves instead of refusing.
 */
export class RefusingSecretsStore implements SecretsStore {
  async load(): Promise<Secrets> {
    return {};
  }

  async save(secrets: Secrets): Promise<void> {
    if (holdsValue(secrets)) throw new ApiKeysNotInBrowserError();
  }
}

/** True when some leaf under `value` is a non-empty string or a number, boolean or other non-object. */
function holdsValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return false;
  if (typeof value === "object") return Object.values(value).some(holdsValue);
  return true;
}
