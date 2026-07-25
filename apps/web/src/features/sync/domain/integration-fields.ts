import type { Integration } from "./integration";

/**
 * Semantic accessors for {@link Integration} fields.
 *
 * Storage uses a fixed shape (`token`, `repo`, `branch`) for all project connectors.
 * Each provider maps those keys differently — use these helpers in infrastructure
 * instead of reading `.repo` / `.branch` with implicit meaning.
 */

/** GitHub / GitLab: token + repo path + branch. */
export function gitConnection(i: Integration) {
  return {
    token: i.token ?? "",
    repo: i.repo ?? "",
    branch: i.branch,
  };
}

/** Mattermost: bot token + server URL (repo) + channel id (branch). */
export function mattermostConnection(i: Integration) {
  return {
    botToken: i.token ?? "",
    serverUrl: i.repo ?? "",
    channelId: i.branch,
  };
}

export function gitConnectionReady(i: Integration): boolean {
  const { token, repo } = gitConnection(i);
  return i.enabled && !!token.trim() && !!repo.trim();
}

export function mattermostConnectionReady(i: Integration): boolean {
  const { botToken, serverUrl, channelId } = mattermostConnection(i);
  return i.enabled && !!botToken.trim() && !!serverUrl.trim() && !!channelId.trim();
}
