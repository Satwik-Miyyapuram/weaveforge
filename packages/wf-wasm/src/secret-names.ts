/**
 * Secret names (Rust `secret_names`), re-exported from index.ts. The keychain stays in TypeScript.
 */
import { isSecretName as rawIsSecretName } from "../pkg/wf_wasm.js";

/** Whether `name` is one of the secrets the app stores. Exact match. */
export function isSecretName(name: string): boolean {
  return rawIsSecretName(name);
}
