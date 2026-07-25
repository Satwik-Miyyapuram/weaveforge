import type { IntegrationManifest } from "./types";
import { zoteroBibliographyManifest } from "./zotero";
import { mattermostNotificationManifest } from "./mattermost";
import { gitlabLogSyncManifest } from "./gitlab-log";
import { githubGitReadManifest, gitlabGitReadManifest } from "./git-read";
import { semanticScholarCitationManifest } from "./semantic-scholar";

/** Stock providers shipped with WeaveForge. */
export const BUILTIN_INTEGRATION_MANIFESTS: readonly IntegrationManifest[] = [
  zoteroBibliographyManifest,
  semanticScholarCitationManifest,
  mattermostNotificationManifest,
  gitlabLogSyncManifest,
  githubGitReadManifest,
  gitlabGitReadManifest,
];

export {
  zoteroBibliographyManifest,
  semanticScholarCitationManifest,
  mattermostNotificationManifest,
  gitlabLogSyncManifest,
  githubGitReadManifest,
  gitlabGitReadManifest,
};
