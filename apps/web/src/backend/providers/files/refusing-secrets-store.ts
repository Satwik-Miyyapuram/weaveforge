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
 * and `save` refuses with a typed error. Nothing here touches the network or a file.
 */
export class RefusingSecretsStore implements SecretsStore {
  async load(): Promise<Secrets> {
    return {};
  }

  async save(_secrets: Secrets): Promise<void> {
    throw new ApiKeysNotInBrowserError();
  }
}
