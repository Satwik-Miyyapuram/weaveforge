import type { CommitOutcome, FileChange, GitRemote, RemoteHead } from "./opfs-clone";

/**
 * The web clone's remote over GitHub's REST Git Data API (D-1a). Browsers may
 * call it directly (it allows CORS), unlike git's own HTTP protocol, so no
 * proxy is needed. The branch only moves fast-forward: the ref update is sent
 * with `force: false`, and GitHub's 422 for a moved branch is `behind`.
 */
export interface GithubRemoteOptions {
  owner: string;
  repo: string;
  branch: string;
  fetch: typeof fetch;
  /** Runs a call with the in-memory token; see `github-token-memory.ts`. */
  withToken(call: (token: string) => Promise<Response>): Promise<Response>;
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function createGithubRemote(options: GithubRemoteOptions): GitRemote {
  const root = `https://api.github.com/repos/${options.owner}/${options.repo}`;

  const send = (path: string, init: { method?: string; body?: unknown; accept?: string } = {}) =>
    options.withToken((token) =>
      options.fetch(`${root}${path}`, {
        method: init.method ?? "GET",
        headers: {
          authorization: `Bearer ${token}`,
          accept: init.accept ?? "application/vnd.github+json",
          ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: init.body === undefined ? undefined : JSON.stringify(init.body),
      }),
    );

  const json = async <T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
    const response = await send(path, init);
    if (!response.ok) throw new Error(`GitHub ${init?.method ?? "GET"} ${path} failed: ${response.status}`);
    return (await response.json()) as T;
  };

  const treeOf = async (commit: string) => (await json<{ tree: { sha: string } }>(`/git/commits/${commit}`)).tree.sha;

  return {
    async head(): Promise<RemoteHead> {
      const ref = await json<{ object: { sha: string } }>(`/git/ref/heads/${options.branch}`);
      const commit = ref.object.sha;
      const tree = await json<{ truncated: boolean; tree: Array<{ path: string; type: string; sha: string }> }>(
        `/git/trees/${await treeOf(commit)}?recursive=1`,
      );
      if (tree.truncated) throw new Error("The repository tree is too large to list in one request.");
      return {
        commit,
        files: tree.tree.filter((e) => e.type === "blob").map((e) => ({ path: e.path, sha: e.sha })),
      };
    },

    async blob(sha: string): Promise<Uint8Array> {
      const response = await send(`/git/blobs/${sha}`, { accept: "application/vnd.github.raw+json" });
      if (!response.ok) throw new Error(`GitHub GET /git/blobs/${sha} failed: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    },

    async commit(parent: string, changes: readonly FileChange[], message: string): Promise<CommitOutcome> {
      const baseTree = await treeOf(parent);
      const entries = [];
      for (const change of changes) {
        const sha = change.bytes
          ? (
              await json<{ sha: string }>("/git/blobs", {
                method: "POST",
                body: { content: base64(change.bytes), encoding: "base64" },
              })
            ).sha
          : null;
        entries.push({ path: change.path, mode: "100644", type: "blob", sha });
      }
      const tree = await json<{ sha: string }>("/git/trees", {
        method: "POST",
        body: { base_tree: baseTree, tree: entries },
      });
      const commit = await json<{ sha: string }>("/git/commits", {
        method: "POST",
        body: { message, tree: tree.sha, parents: [parent] },
      });
      const path = `/git/refs/heads/${options.branch}`;
      const moved = await send(path, { method: "PATCH", body: { sha: commit.sha, force: false } });
      if (moved.status === 422) return { kind: "behind" };
      if (!moved.ok) throw new Error(`GitHub PATCH ${path} failed: ${moved.status}`);
      return { kind: "pushed", commit: commit.sha };
    },
  };
}
