import type { DesktopOverleafSource } from "@/lib/desktop/desktop-bridge";
import { readOverleafProject } from "@/features/overleaf/infrastructure/overleaf-git-reader";
import { safeOverleafError } from "@/features/overleaf/infrastructure/overleaf-error";
import type { IpcResult } from "./channels";

/**
 * A linked Overleaf project, read here because there is no server to read it.
 *
 * The clone itself is the web app's own module — the same one its API route
 * calls, imported rather than reimplemented, so the file limits, the path
 * checks and the error redaction are decided in one place for both builds.
 *
 * What this file adds is the division of labour. The token is read from the
 * keychain on this side and used on this side; the renderer names the project
 * and the entry file and never holds the credential. That mirrors the hosted
 * build, where the token is sealed with a key the browser has no access to.
 *
 * The section tree is deliberately not computed here. The renderer parses the
 * files it is handed with the same `@weaveforge/core` function the route uses,
 * which keeps this payload to the text and nothing derived from it.
 */

const NO_TOKEN =
  "No Overleaf token is stored on this computer. Link the report again to add one.";

export async function handleOverleafRead(
  projectId: unknown,
  entryFile: unknown,
  readToken: () => Promise<IpcResult<string | null>>,
): Promise<IpcResult<DesktopOverleafSource>> {
  if (typeof projectId !== "string" || typeof entryFile !== "string") {
    return { ok: false, message: "That Overleaf project could not be read." };
  }
  const stored = await readToken();
  if (!stored.ok) return stored;
  const token = stored.value;
  if (!token) return { ok: false, message: NO_TOKEN };
  try {
    const result = await readOverleafProject(projectId, entryFile, token);
    return {
      ok: true,
      value: {
        projectId: result.projectId,
        entryFile: result.entryFile,
        files: result.files.map((file) => ({ path: file.path, content: file.content })),
        overleafUrl: result.overleafUrl,
      },
    };
  } catch (error) {
    // The token can appear inside git's own error text, so it is redacted by
    // the same function the API route redacts with before anything is shown.
    return { ok: false, message: safeOverleafError(error, token) };
  }
}
