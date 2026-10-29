import { sealOverleafToken, openOverleafToken } from "./overleaf-token-crypto";
import type { BaseAPI, ResponseSchema } from "../vendor/overleaf-workshop/base-api";

/** Persistence port: the store only ever sees sealed ciphertext. */
export interface WorkshopSessionStore {
  save(cookieCiphertext: string): Promise<string>;
  loadCiphertext(sessionId: string): Promise<string | null>;
  remove(sessionId: string): Promise<void>;
}

export type CreateWorkshopSessionResult =
  | { ok: true; sessionId: string }
  | { ok: false; message: string };

/**
 * Verifies a session cookie with Overleaf, then stores it sealed server-side.
 * Only the opaque session id is returned to the client; the cookie is never sent back.
 */
export async function createWorkshopSession(
  store: WorkshopSessionStore,
  cookies: string,
  api: Pick<BaseAPI, "cookiesLogin">,
): Promise<CreateWorkshopSessionResult> {
  const login: ResponseSchema = await api.cookiesLogin(cookies);
  if (login.type !== "success" || !login.identity) {
    return { ok: false, message: login.message ?? "Overleaf sign-in failed." };
  }
  const sessionId = await store.save(sealOverleafToken(cookies));
  return { ok: true, sessionId };
}

/** Returns the decrypted cookie for a stored session, or null when the id is unknown. */
export async function loadWorkshopSessionCookies(store: WorkshopSessionStore, sessionId: string): Promise<string | null> {
  const ciphertext = await store.loadCiphertext(sessionId);
  return ciphertext === null ? null : openOverleafToken(ciphertext);
}

export async function deleteWorkshopSession(store: WorkshopSessionStore, sessionId: string): Promise<void> {
  await store.remove(sessionId);
}
