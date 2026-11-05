"use client";

import { experimentHref } from "../application/experiment-href";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { shortSha, type Experiment, type MetricPoint } from "@weaveforge/core";
import { artifactItems } from "./artifact-items";
import { getContainer } from "@/bootstrap";
import { commitUrl } from "@/features/sync";
import { formatMetricCell, MetricChart } from "./metric-chart";
import { MetricGrid } from "./metric-grid";
import { usePolledLoad } from "./use-polled-load";
import { isAbsoluteUrl, viewableArtifactUrl } from "../infrastructure/experiment-artifact-store";
import { FormError } from "@/components/form-error";
import { Chip } from "@/components/controls";
import { ImageViewer } from "@/components/image-viewer";
import { formatError } from "@/lib/format-error";
import { warnOnce } from "@/lib/error-report/warn-once";

export function ExpGitChips({ exp, limit }: { exp: Experiment; limit?: number }) {
  const chips = [
    exp.branch ? <Chip key="branch"><em>branch</em> {exp.branch}</Chip> : null,
    exp.commitSha ? (
      commitUrl(exp.repoUrl, exp.commitSha) ? (
        <Chip key="commit" href={commitUrl(exp.repoUrl, exp.commitSha) ?? ""} target="_blank" rel="noreferrer">
          <em>commit</em> {shortSha(exp.commitSha)}
        </Chip>
      ) : (
        <Chip key="commit"><em>commit</em> {shortSha(exp.commitSha)}</Chip>
      )
    ) : null,
    exp.repoUrl ? (
      <Chip key="repo" href={exp.repoUrl} target="_blank" rel="noreferrer">repo</Chip>
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
      {hidden > 0 ? <span className="chip-more">+{hidden}</span> : null}
    </div>
  );
}

/** The title of the paper a run tests, or null until (or unless) it resolves. */
export function usePaperTitle(paperId: string | undefined): string | null {
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    setTitle(null);
    if (!paperId) return;
    let alive = true;
    getContainer().experiments.getPaper(paperId)
      .then((p) => alive && setTitle(p?.title ?? null))
      .catch((err: unknown) => warnOnce("experiments", "linked paper title failed to load", err));
    return () => {
      alive = false;
    };
  }, [paperId]);
  return title;
}

function RelatedPaper({ paperId }: { paperId: string }) {
  const title = usePaperTitle(paperId);
  if (!title) return null;
  return (
    <Chip title={`Paper this run tests/implements: ${title}`}>
      <em>paper</em> {title}
    </Chip>
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
function useArtifactUrls(entries: string[]): (string | null)[] {
  // One slot per entry, in order: absolute links are ready now, paths once signed.
  const [resolved, setResolved] = useState<(string | null)[]>(() =>
    entries.map((entry) => (isAbsoluteUrl(entry) ? viewableArtifactUrl(entry) : null)),
  );

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
        if (!cancelled) setResolved(urls);
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
  const { images, links } = artifactItems(entries, useArtifactUrls(entries));
  // Detail: a uniform responsive grid of fixed-ratio tiles. The old
  // column-masonry gave every figure a different height (contain-fit) and
  // flowed column-major, which read as "images spilling onto the next line"
  // on a narrow phone.
  const thumbClass = detail ? "artifact-figures" : "artifact-thumbs";
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div className="artifacts">
      {images.length > 0 && (
        <div className={thumbClass}>
          {images.map(({ url, label }, i) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noreferrer"
              title={label}
              className={detail ? "card artifact-card" : undefined}
              onClick={(e) => {
                // Modified clicks keep the browser's own open-in-tab behaviour.
                if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                setOpen(i);
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={label} loading="lazy" />
              {detail && <span className="artifact-caption">{label}</span>}
            </a>
          ))}
        </div>
      )}
      {open !== null && (
        <ImageViewer
          images={images.map(({ url, label }) => ({ src: url, label }))}
          index={open}
          onIndex={setOpen}
          onClose={() => setOpen(null)}
        />
      )}
      {links.length > 0 && (
        <div className="git-chips">
          {links.map(({ url, label }) => (
            <Chip key={url} href={url} target="_blank" rel="noreferrer">
              {label}
            </Chip>
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
  const { data: points, error: loadError } = usePolledLoad(
    experimentId,
    () => getContainer().experiments.metricHistory(experimentId),
    live ? 5000 : null,
  );
  // A PostgREST refusal is a plain object; String() of it was "[object Object]".
  const error = loadError ? formatError(loadError) : null;
  // The server has not been migrated to the function the curves read through.
  // Nothing on this device is wrong and a report would not help, so it is said
  // plainly rather than raised as an error.
  const serverBehind = (loadError as { code?: unknown } | null)?.code === "PGRST202";

  /** One stable series list per metric, so a chart only redraws when its data changes. */
  const byMetric = useMemo(() => {
    const groups = new Map<string, MetricPoint[]>();
    for (const p of points ?? []) {
      const arr = groups.get(p.metric) ?? [];
      arr.push(p);
      groups.set(p.metric, arr);
    }
    return [...groups.entries()].map(([metric, pts]) => ({ metric, series: [{ id: experimentId, points: pts }] }));
  }, [points, experimentId]);

  if (error && serverBehind) return <p className="record-empty">{error}</p>;
  if (error) return <FormError>{error}</FormError>;
  if (points === null) return <p className="muted">Loading curves…</p>;
  if (byMetric.length === 0)
    return (
      <p className="muted">
        No curve data yet — log metrics with a step via the Python SDK
        (<code>run.log_metric(&quot;your_metric&quot;, value, step=n)</code>).
      </p>
    );

  return (
    <MetricGrid variant="detail">
      {byMetric.map(({ metric, series }) => (
        <MetricChart key={metric} metric={metric} height={chartHeight} series={series} />
      ))}
    </MetricGrid>
  );
}

export function ExperimentTitleLink({ exp }: { exp: Experiment }) {
  return (
    <Link href={experimentHref(exp.id)} className="exp-title-link">
      {exp.name}
    </Link>
  );
}
