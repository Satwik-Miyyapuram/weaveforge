import { BaseAPI, type ProjectPersist } from "../vendor/overleaf-workshop/base-api";

/** Overleaf's public host. The cookie is sent only to this origin. */
export const OVERLEAF_BASE_URL = "https://www.overleaf.com/";

export type OverleafProjectsResult =
  | { ok: true; projects: ProjectPersist[] }
  | { ok: false; message: string };

/**
 * Sign in to Overleaf with a session cookie string and list the user's
 * projects. The cookie is used for this one request and never stored.
 */
export async function listOverleafProjectsWithCookies(
  cookies: string,
  api: BaseAPI = new BaseAPI(OVERLEAF_BASE_URL),
): Promise<OverleafProjectsResult> {
  const login = await api.cookiesLogin(cookies);
  if (login.type !== "success" || !login.identity) {
    return { ok: false, message: login.message ?? "Overleaf sign-in failed." };
  }
  const listed = await api.userProjectsJson(login.identity);
  if (listed.type !== "success" || !listed.projects) {
    return { ok: false, message: listed.message ?? "Overleaf projects could not be listed." };
  }
  return { ok: true, projects: listed.projects.map((p) => ({ id: p.id, name: p.name })) };
}
