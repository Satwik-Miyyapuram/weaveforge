import type { ShareableType } from "@thesis/core";
import type { WiredBackend } from "@/backend/wire-backend";
import type { ProjectContext } from "@/lib/project-context";

export async function listShareResourceIds(
  resourceType: ShareableType,
  projectId: string,
  backend: WiredBackend,
  ctx: ProjectContext,
): Promise<string[]> {
  const prev = ctx.projectId;
  ctx.projectId = projectId;
  try {
    switch (resourceType) {
      case "paper":
        return (await backend.paperRepository.list()).map((p) => p.id);
      case "report_section":
        return (await backend.reportSectionRepository.list()).map((s) => s.id);
      case "experiment":
        return (await backend.experimentRepository.list()).map((e) => e.id);
      case "vault_page":
        return (await backend.rawVaultPageRepository.list()).map((p) => p.id);
      case "reading_list":
        return (await backend.readingListRepository.list()).map((l) => l.id);
      default:
        return [];
    }
  } finally {
    ctx.projectId = prev;
  }
}
