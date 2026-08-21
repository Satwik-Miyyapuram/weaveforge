"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { shortSha, type Experiment, type MetricPoint } from "@weaveforge/core";
import { figureLabel } from "./figure-label";
import { getContainer } from "@/bootstrap";
import { commitUrl } from "@/features/sync";
import { formatMetricCell, MetricChart } from "./metric-chart";
import { isAbsoluteUrl } from "../infrastructure/experiment-artifact-store";

function isImageUrl(url: string): boolean {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(png|jpe?g|webp|gif|svg|avif)$/.test(path);
  } catch {
    return /\.(png|jpe?g|webp|gif|svg|avif)$/i.test(url.split("?")[0] ?? "");
  }
}

export function ExpGitChips({ exp, limit }: { exp: Experiment; limit?: number }) {
  const chips = [
    exp.branch ? <span key="branch" className="git-chip"><em>branch</em> {exp.branch}</span> : null,
    exp.commitSha ? (
      commitUrl(exp.repoUrl, exp.commitSha) ? (
        <a key="commit" className="git-chip link" href={commitUrl(exp.repoUrl, exp.commitSha)} target="_blank" rel="noreferrer">
          <em>commit</em> {shortSha(exp.commitSha)} ↗
        </a>
      ) : (
        <span key="commit" className="git-chip"><em>commit</em> {shortSha(exp.commitSha)}</span>
      )
    ) : null,
    exp.repoUrl ? (
      <a key="repo" className="git-chip link" href={exp.repoUrl} target="_blank" rel="noreferrer">repo ↗</a>
    ) : null,
    exp.relatedPaper ? <RelatedPaper key="paper" paperId={exp.relatedPaper} /> : null,
  ].filter(Boolean);
  if (chips.length === 0) return null;
  // Cards keep the row to one line; the detail view (no limit) shows them all.
  const shown = limit != null ? chips.slice(0, limit) : chips;
  const hidden = chips.length - shown.length;
  return (
    <div className={limit != null ? "git-chips chip-row--capped" : "git-chips"}>
      {shown}
      {hidden > 0 ? <span className="git-chip chip-more">+{hidden}</span> : null}
    </div>
  );
}

function RelatedPaper({ paperId }: { paperId: string }) {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getContainer().experiments.getPaper(paperId)
      .then((p) => alive && setTitle(p?.title ?? null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [paperId]);
  if (!title) return null;
  return (
    <span className="git-chip" title="Paper this run tests/implements">
      <em>paper</em> {title}
    </span>
  );
}

export function ExpMetricChips({ exp, limit }: { exp: Experiment; limit?: number }) {
  const metrics = Object.entries(exp.metrics ?? {});
  if (metrics.length === 0) return null;
  // On a card, a run with a dozen metrics buries the title; show a few and a
  // count. The detail view (no limit) keeps them all.
  const shown = limit != null ? metrics.slice(0, limit) : metrics;
  const hidden = metrics.length - shown.length;
  return (
    <div className={limit != null ? "metric-chips chip-row--capped" : "metric-chips"}>
      {shown.map(([k, v]) => (
        <span key={k} className="metric-chip">
          <em>{k}</em> {formatMetricCell(k, v)}
        </span>
      ))}
      {hidden > 0 ? <span className="metric-chip chip-more">+{hidden}</span> : null}
    </div>
  );
}

export function ExpConfigPanel({ config }: { config: Record<string, unknown> }) {
  const entries = Object.entries(config ?? {});
  if (entries.length === 0) return null;
  return (
    <section className="exp-detail-section">
      <h3 className="exp-detail-heading">Config</h3>
      <dl className="exp-config-grid">
        {entries.map(([k, v]) => (
          <div key={k} className="exp-config-row">
            <dt>{k}</dt>
            <dd>{typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}


/**
 * Resolve stored artifact entries to URLs that can be rendered now.
 *
 * Entries are a mix: absolute links from `log_artifact(url)`, and storage paths
 * from `log_bytes`. Paths are signed on demand and the signature lasts an hour,
 * which is why this happens at render time and the result is never written
 * back — the previous version stored a signed URL, and SigV4 caps those at
 * seven days regardless of what is asked for, so every figure broke a week
 * after upload.
 */
function useArtifactUrls(entries: string[]): string[] {
  const [resolved, setResolved] = useState<string[]>(() => entries.filter(isAbsoluteUrl));

  // NUL separator, written as an escape: a literal NUL byte in the source makes
  // git treat this whole file as binary and hides it from grep.
  const key = entries.join("\u0000");
  useEffect(() => {
    let cancelled = false;
    if (entries.length === 0) {
      setResolved([]);
      return;
    }
    void getContainer()
      .experiments.artifactViewUrls(entries)
      .then((urls) => {
        if (!cancelled) setResolved(urls.filter((u): u is string => Boolean(u)));
      })
      .catch(() => {
        // Leave whatever resolved already rather than blanking the panel.
      });
    return () => {
      cancelled = true;
    };
    // `key` stands in for the array: a new array of the same entries must not
    // re-sign on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return resolved;
}

export function Artifacts({ urls: entries, detail = false }: { urls: string[]; detail?: boolean }) {
  const urls = useArtifactUrls(entries);
  const images = urls.filter(isImageUrl);
  const links = urls.filter((u) => !isImageUrl(u));
  // Detail: a uniform responsive grid of fixed-ratio tiles. The old
  // column-masonry gave every figure a different height (contain-fit) and
  // flowed column-major, which read as "images spilling onto the next line"
  // on a narrow phone.
  const thumbClass = detail ? "artifact-figures" : "artifact-thumbs";
  return (
    <div className="artifacts">
      {images.length > 0 && (
        <div className={thumbClass}>
          {images.map((url, i) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              title={figureLabel(url, i)}
              className={detail ? "card artifact-card" : undefined}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={figureLabel(url, i)} loading="lazy" />
              {detail && <span className="artifact-caption">{figureLabel(url, i)}</span>}
            </a>
          ))}
        </div>
      )}
      {links.length > 0 && (
        <div className="git-chips">
          {links.map((url) => (
            <a key={url} className="git-chip link" href={url} target="_blank" rel="noreferrer">
              artifact ↗
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function MetricCurves({
  experimentId,
  live = false,
  chartHeight = 260,
}: {
  experimentId: string;
  live?: boolean;
  chartHeight?: number;
}) {
  const [points, setPoints] = useState<MetricPoint[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(() => {
    return getContainer().experiments.metricHistory(experimentId)
      .then(setPoints)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [experimentId]);

  useEffect(() => {
    let alive = true;
    void fetchHistory().then(() => {
      if (!alive) return;
    });
    return () => {
      alive = false;
    };
  }, [fetchHistory]);

  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { void fetchHistory(); }, 5000);
    return () => clearInterval(t);
  }, [live, fetchHistory]);

  const byMetric = useMemo(() => {
    const groups = new Map<string, MetricPoint[]>();
    for (const p of points ?? []) {
      const arr = groups.get(p.metric) ?? [];
      arr.push(p);
      groups.set(p.metric, arr);
    }
    return [...groups.entries()];
  }, [points]);

  if (error) return <p className="error">{error}</p>;
  if (points === null) return <p className="muted">Loading curves…</p>;
  if (byMetric.length === 0)
    return (
      <p className="muted">
        No curve data yet — log metrics with a step via the Python SDK
        (<code>run.log_metric(&quot;your_metric&quot;, value, step=n)</code>).
      </p>
    );

  return (
    <div className="metric-curves metric-curves--detail">
      {byMetric.map(([metric, pts]) => (
        <MetricChart
          key={metric}
          metric={metric}
          height={chartHeight}
          series={[{ id: experimentId, points: pts }]}
        />
      ))}
    </div>
  );
}

export function ExperimentTitleLink({ exp }: { exp: Experiment }) {
  return (
    <Link href={`/experiments/${exp.id}`} className="exp-title-link">
      {exp.name}
    </Link>
  );
}
