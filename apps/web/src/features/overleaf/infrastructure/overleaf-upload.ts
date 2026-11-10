/**
 * Writes one text file into the open Overleaf project through the IDE's
 * forward, the same request Overleaf's own upload dialog sends. A file of the
 * same name is replaced.
 */
import type { Forward } from "@overleaf-ide";

export type UploadResult = { ok: true } | { ok: false; message: string };

export async function uploadOverleafText(
  forward: Forward,
  file: { projectId: string; folderId: string; name: string; text: string },
): Promise<UploadResult> {
  try {
    const form = new FormData();
    form.append("name", file.name);
    form.append("qqfile", new Blob([file.text], { type: "text/plain" }), file.name);
    const encoded = new Response(form);
    const res = await forward({
      method: "POST",
      url: `/project/${encodeURIComponent(file.projectId)}/upload?folder_id=${encodeURIComponent(file.folderId)}`,
      headers: { "content-type": encoded.headers.get("content-type") ?? "" },
      body: new Uint8Array(await encoded.arrayBuffer()),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    return { ok: false, message: `Overleaf refused the file (${res.status}${reason(res.body)}).` };
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : "Overleaf could not be reached." };
  }
}

function reason(body: Uint8Array): string {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(body)) as { error?: unknown };
    return typeof parsed.error === "string" ? `: ${parsed.error}` : "";
  } catch {
    return "";
  }
}
