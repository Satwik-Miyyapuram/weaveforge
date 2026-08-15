"use client";

import { useCallback, useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { useProject } from "@/features/projects";
import type { Integration, SyncProvider } from "../domain/integration";
import { gitConnection } from "../domain/integration-fields";
import type { GitBranch, GitCommit } from "../infrastructure/git-client";
import { Select } from "@/components/select";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { formatError } from "@/lib/format-error";

function repoWebUrl(i: Integration): string {
  const { repo } = gitConnection(i);
  const host = i.provider === "github" ? "https://github.com" : "https://gitlab.com";
  return `${host}/${repo}`;
}

/** Git tab: pulls the connected repo's branches + commits (git → here). */
export function GitScreen() {
  const { current } = useProject();
  const [integration, setIntegration] = useState<Integration | null>(null);
  const [branches, setBranches] = useState<GitBranch[]>([]);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [branch, setBranch] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState(false);

  const pickIntegration = useCallback(async (): Promise<Integration | null> => {
    if (!current) return null;
    const store = getContainer().sync.integrations;
    const providers = getContainer().integrationConfig.gitRead as SyncProvider[];
    for (const p of providers) {
      const i = await store.get(current.id, p);
      if (gitConnection(i).token && gitConnection(i).repo && i.enabled) return i;
    }
    return null;
  }, [current]);

  const load = useCallback(async (br?: string) => {
    setLoading(true);
    setError(null);
    try {
      const i = await pickIntegration();
      setIntegration(i);
      if (!i) return;
      const client = getContainer().sync.git;
      const useBranch = br ?? i.branch;
      setBranch(useBranch);
      const [bs, cs] = await Promise.all([
        client.listBranches(i).catch(() => []),
        client.listCommits(i, useBranch),
      ]);
      setBranches(bs);
      setCommits(cs);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [pickIntegration]);

  useEffect(() => { void load(); }, [load]);

  async function track(c: GitCommit) {
    if (!integration) return;
    await getContainer().sync.manageExperiment.add({
      name: c.message || c.shortSha,
      branch,
      commitSha: c.sha,
      repoUrl: repoWebUrl(integration),
    });
    setError(`Tracked “${c.message}” as an experiment.`);
  }

  // An experiment often spans a whole branch, not one commit. Track the branch
  // itself — no commitSha pins it to a single revision.
  async function trackBranch() {
    if (!integration || !branch) return;
    setTracking(true);
    try {
      await getContainer().sync.manageExperiment.add({
        name: branch,
        branch,
        repoUrl: repoWebUrl(integration),
      });
      setError(`Tracked branch “${branch}” as an experiment.`);
    } catch (err) {
      setError(formatError(err));
    } finally {
      setTracking(false);
    }
  }

  return (
    <section className="screen">
      {integration && branch && (
        <div className="git-branch-bar">
          {branches.length > 0 && (
            <div className="field">
              <label htmlFor="gbr">Branch</label>
              <Select id="gbr" value={branch} onChange={(e) => void load(e.target.value)} disabled={loading || tracking}>
                {branches.map((b) => <option key={b.name} value={b.name}>{b.name}</option>)}
              </Select>
            </div>
          )}
          <button className="btn-secondary track-branch-btn" onClick={() => void trackBranch()} disabled={loading || tracking}>
            {tracking ? "Tracking…" : "Track branch as experiment"}
          </button>
          {loading && <ScreenLoader status="Refreshing git history…" showTips={false} compact />}
        </div>
      )}
      {loading && !integration && <ScreenLoader status="Loading git history…" />}
      {!loading && !integration && (
        <div className="empty">
          <p>No repo connected. Enable GitHub or GitLab in Settings → Sync.</p>
        </div>
      )}
      {error && <p className="muted">{error}</p>}

      <ul className="commit-list">
        {commits.map((c) => (
          <li key={c.sha} className="card commit-item">
            <div className="commit-main">
              <a className="commit-sha" href={c.url} target="_blank" rel="noreferrer">{c.shortSha}</a>
              <span className="commit-msg">{c.message}</span>
            </div>
            <div className="commit-meta">
              <span className="muted">{c.author}{c.date ? ` · ${c.date.slice(0, 10)}` : ""}</span>
              <button className="link-btn" onClick={() => void track(c)}>track as experiment</button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
