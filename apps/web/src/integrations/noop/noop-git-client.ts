import type { IGitClient } from "@/features/sync/domain/sync-ports";
import type { Integration } from "@/features/sync/domain/integration";

/** Used when NEXT_PUBLIC_GIT_READ_PROVIDERS=none — Git tab is hidden. */
export class NoopGitClient implements IGitClient {
  async listCommits(_integration: Integration, _branch?: string) {
    return [];
  }

  async listBranches(_integration: Integration) {
    return [];
  }
}
