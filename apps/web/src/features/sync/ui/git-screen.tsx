"use client";

import { useCallback, useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { useProject } from "@/features/projects";
import type { Integration, SyncProvider } from "../domain/integration";
import { gitConnection } from "../domain/integration-fields";
import type { GitBranch, GitCommit } from "../infrastructure/git-client";
import { ScreenHead } from "@/components/screen-head";
import { EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import Link from "next/link";
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

  const repo = integration ? gitConnection(integration).repo : "";

  return (
    <section className="screen git-screen">
      <ScreenHead eyebrow="Code for the experiments">
        <Link className="btn-secondary" href="/settings">
          Settings
        </Link>
        {integration && (
          <button type="button" className="btn-primary" onClick={() => void load(branch)} disabled={loading}>
            {loading ? "Syncing…" : "Sync now"}
          </button>
        )}
      </ScreenHead>
      {loading && !integration && <ScreenLoader status="Loading git history…" />}
      {!loading && !integration && (
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="git" />}
          title="No repository connected"
          body="Connect the repository your project lives in and this screen lists its branches and commits — so the code behind a result stays a click away from the result."
          action={
            <Link className="btn-primary" href="/settings">
              Open settings
            </Link>
          }
        />
      )}
      {error && <p className="muted">{error}</p>}

      {integration && (
        <>
          <div className="card git-hero">
            <span className="git-hero-mark" aria-hidden="true">
              <NavIcon name="git" />
            </span>
            <div className="git-hero-main">
              <p className="git-hero-repo">
                <a href={repoWebUrl(integration)} target="_blank" rel="noreferrer">{repo}</a>
                <span className="status status-done">Connected</span>
              </p>
              <p className="git-hero-sub">
                {repoWebUrl(integration).replace(/^https:\/\//, "")} · tracking {integration.branch}
              </p>
            </div>
            <dl className="git-hero-stats">
              <div><dt>Branches</dt><dd>{branches.length}</dd></div>
              <div><dt>Commits</dt><dd>{commits.length}</dd></div>
              <div><dt>Latest</dt><dd>{commits[0]?.date ? shortDate(commits[0].date) : "—"}</dd></div>
            </dl>
          </div>

          <div className="git-layout">
            <div className="card git-commits">
              <div className="git-card-head">
                <h2>Commits</h2>
                {loading && <ScreenLoader status="Refreshing git history…" showTips={false} compact />}
              </div>
              <ul className="commit-list">
                {commits.map((c) => (
                  <li key={c.sha} className="commit-item">
                    <div className="commit-main">
                      <span className="commit-msg">{c.message}</span>
                      <span className="commit-meta">
                        <a className="commit-sha" href={c.url} target="_blank" rel="noreferrer">{c.shortSha}</a>
                        {c.author ? ` ${c.author}` : ""}
                        {c.date ? ` · ${shortDate(c.date)}` : ""}
                      </span>
                    </div>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => void track(c)}>
                      Track
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            <aside className="card git-branches" aria-label="Branches">
              <h2>Branches</h2>
              <ul className="git-branch-list">
                {branches.map((b) => (
                  <li key={b.name}>
                    <button
                      type="button"
                      className={b.name === branch ? "git-branch is-active" : "git-branch"}
                      aria-pressed={b.name === branch}
                      onClick={() => void load(b.name)}
                      disabled={loading}
                    >
                      <span className="git-branch-swatch" aria-hidden="true" />
                      <span className="git-branch-name">{b.name}</span>
                      {b.name === integration.branch && <span className="git-branch-note">default</span>}
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="btn-primary track-branch-btn"
                onClick={() => void trackBranch()}
                disabled={loading || tracking || !branch}
              >
                {tracking ? "Tracking…" : `Track ${branch} as experiment`}
              </button>
              <p className="muted git-branches-note">A tracked branch shows up as an experiment, with its runs.</p>
            </aside>
          </div>
        </>
      )}
    </section>
  );
}

/** A commit's day as the list shows it, e.g. "20 Sep". */
function shortDate(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso.slice(0, 10) : at.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
