import { entryFileError, OVERLEAF_PROJECT_ID } from "@/features/overleaf/domain/link-rules";

export type OverleafLink = { projectId: string; title: string; overleafProjectId: string; entryFile: string };

/**
 * Links an Overleaf project to a report. The link is checked before anything is
 * written: saving the connection first left a stored token behind whenever the
 * report row was then refused.
 */
export async function linkOverleafReport(
  link: OverleafLink,
  steps: {
    saveConnection: () => Promise<string>;
    createReport: (input: OverleafLink & { connectionId: string }) => Promise<unknown>;
  },
): Promise<void> {
  const title = link.title.trim();
  const overleafProjectId = link.overleafProjectId.trim();
  const entryFile = link.entryFile.trim() || "main.tex";
  if (!title || !overleafProjectId) throw new Error("Title and Overleaf project id are required.");
  if (!OVERLEAF_PROJECT_ID.test(overleafProjectId)) throw new Error("Overleaf project id is invalid.");
  const entryFileInvalid = entryFileError(entryFile);
  if (entryFileInvalid) throw new Error(entryFileInvalid);
  const connectionId = await steps.saveConnection();
  await steps.createReport({ ...link, title, overleafProjectId, entryFile, connectionId });
}
