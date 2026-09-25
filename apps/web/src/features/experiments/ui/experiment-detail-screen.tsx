"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  EXPERIMENT_STATUSES, isStaleRunningExperiment, shortSha, type Experiment, type ExperimentStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { CommentsPanel, ShareButton } from "@/features/sharing";
import { commitUrl } from "@/features/sync";
import { CommentsIcon } from "@/components/view-icons";
import {
  RecordActivity,
  RecordDots,
  RecordEmpty,
  RecordFacts,
  RecordSection,
  recordDate,
} from "@/components/record";
import { formatMetricCell } from "./metric-chart";
import { formatError } from "@/lib/format-error";
import { AttachArtifactsButton } from "./attach-artifacts-button";
import { EXPERIMENTS_HREF } from "./experiment-href";
import { Artifacts, MetricCurves, usePaperTitle } from "./experiment-panels";
import { FormError } from "@/components/form-error";

/** How far along a run is: planned, under way, settled (done, failed or abandoned). */
const STATUS_DOTS: Partial<Record<ExperimentStatus, number>> = { running: 1, done: 2, failed: 2, abandoned: 2 };

export function ExperimentDetailScreen({ id: idProp }: { id?: string }) {
  const router = useRouter();
  const params = useParams();
  const id = idProp ?? (typeof params.id === "string" ? params.id : "");
  const [exp, setExp] = useState<Experiment | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Kept apart from `error`, which means "this experiment could not be loaded"
  // and replaces the whole screen. A failed upload must not do that.
  const [attachError, setAttachError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const paperTitle = usePaperTitle(exp?.relatedPaper);

  const load = useCallback(async () => {
    if (!id) {
      setError("Experiment not found.");
      setExp(null);
      setLoading(false);
      return;
    }
    try {
      const e = await getContainer().experiments.getExperiment(id);
      if (!e) {
        setError("Experiment not found.");
        setExp(null);
      } else {
        setExp(e);
        setError(null);
      }
    } catch (err) {
      setError(formatError(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = exp?.status === "running" && !isStaleRunningExperiment(exp);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [live, load]);

  async function setStatus(status: ExperimentStatus) {
    if (!exp) return;
    setExp(await getContainer().experiments.manageExperiment.setStatus(exp.id, status));
  }

  // Back where the reader came from, or to the list when the page was opened
  // directly (a link, a reload) and there is nowhere to go back to.
  const goBackToList = useCallback(() => {
    if (typeof window !== "undefined" && window.history.length > 1) router.back();
    else router.push(EXPERIMENTS_HREF);
  }, [router]);

  if (loading) {
    return (
      <section className="screen">
        <ScreenLoader status="Loading experiment…" />
      </section>
    );
  }
  if (error || !exp) {
    return (
      <section className="screen">
        <button type="button" className="btn-secondary paper-back" onClick={goBackToList}>
          ← Experiments
        </button>
        <FormError>{error ?? "Experiment not found."}</FormError>
      </section>
    );
  }

  const config = exp.config ?? {};
  const configRows = Object.entries(config);
  const metricRows = Object.entries(exp.metrics ?? {});
  const hasArtifacts = (exp.artifacts?.length ?? 0) > 0;
  const started = recordDate(exp.startedAt ?? exp.createdAt);
  const finished = recordDate(exp.finishedAt);
  const meta = [
    started ? `Started ${started}` : null,
    finished ? `Finished ${finished}` : null,
    exp.branch ? `Branch ${exp.branch}` : null,
    exp.commitSha ? `Commit ${shortSha(exp.commitSha)}` : null,
  ].filter(Boolean).join(" / ");
  const activity = [
    exp.finishedAt ? { at: recordDate(exp.finishedAt), what: `Marked ${exp.status}` } : null,
    exp.startedAt ? { at: recordDate(exp.startedAt), what: "Run started" } : null,
    { at: recordDate(exp.createdAt), what: "Logged" },
  ].filter((e): e is { at: string; what: string } => e !== null && e.at !== "");

  return (
    <section className="screen exp-detail">
      <article className="record">
        <nav className="record-bar" aria-label="Experiment">
          <button type="button" className="record-back" onClick={goBackToList}>← Experiments</button>
          <span className="record-mono record-bar-id">Run {exp.id.slice(0, 6)}</span>
          <span className="record-state">
            <RecordDots filled={STATUS_DOTS[exp.status] ?? 0} total={2} label={`Status: ${exp.status}`} />
            <Select
              className="record-state-select"
              value={exp.status}
              onChange={(ev) => void setStatus(ev.target.value as ExperimentStatus)}
              aria-label="Run status"
            >
              {EXPERIMENT_STATUSES.map((st) => (
                <option key={st} value={st}>{st}</option>
              ))}
            </Select>
          </span>
          {live && (
            <span className="live-dot" title="Run in progress — auto-refreshing every 5s">● live</span>
          )}
          <div className="record-actions">
            <ShareButton resourceType="experiment" resourceId={exp.id} title={`Share: ${exp.name}`} showLabel />
            <a href="#record-comments" className="record-action">
              <CommentsIcon />
              <span>Comment</span>
            </a>
          </div>
        </nav>

        <header className="record-head">
          <h1 className="record-title">{exp.name}</h1>
          {exp.hypothesis && <p className="record-by record-hypothesis">{exp.hypothesis}</p>}
          {meta && <p className="record-mono record-meta">{meta}</p>}
        </header>

        <div className="record-grid">
          <div className="record-main">
            <RecordSection label="Metrics" tag={live ? "Live" : undefined}>
              <MetricCurves experimentId={exp.id} live={live} chartHeight={300} />
            </RecordSection>

            <RecordSection
              label="Figures & artifacts"
              tag={
                <AttachArtifactsButton
                  experimentId={exp.id}
                  onAttached={setExp}
                  onError={setAttachError}
                />
              }
            >
              {attachError && <FormError>{attachError}</FormError>}
              {hasArtifacts ? (
                <Artifacts urls={exp.artifacts} detail />
              ) : (
                <RecordEmpty>Nothing attached yet. Runs log their own; add one here.</RecordEmpty>
              )}
            </RecordSection>

            <RecordSection label="Result" tag={exp.resultNote ? undefined : "Open"}>
              {exp.resultNote ? (
                <p className="record-abstract">{exp.resultNote}</p>
              ) : (
                <RecordEmpty>No result written yet. The SDK&apos;s <code>run.finish(note=…)</code> fills this in.</RecordEmpty>
              )}
            </RecordSection>

            {exp.runCommand && (
              <RecordSection label="Run command">
                <pre className="exp-run-cmd">{exp.runCommand}</pre>
              </RecordSection>
            )}

            <RecordSection label="Comments" id="record-comments">
              <CommentsPanel resourceType="experiment" resourceId={exp.id} canComment />
            </RecordSection>
          </div>

          <aside className="record-aside">
            <RecordSection label="Record">
              <RecordFacts
                rows={[
                  ["Status", exp.status],
                  started ? ["Started", started] : null,
                  finished ? ["Finished", finished] : null,
                  exp.branch ? ["Branch", exp.branch] : null,
                  exp.commitSha
                    ? [
                        "Commit",
                        exp.repoUrl ? (
                          <a href={commitUrl(exp.repoUrl, exp.commitSha)} target="_blank" rel="noreferrer">
                            {shortSha(exp.commitSha)}
                          </a>
                        ) : (
                          shortSha(exp.commitSha)
                        ),
                      ]
                    : null,
                  exp.repoUrl
                    ? ["Repo", <a key="repo" href={exp.repoUrl} target="_blank" rel="noreferrer">Open ↗</a>]
                    : null,
                  paperTitle && exp.relatedPaper
                    ? ["Paper", <Link key="paper" href={`/papers/?paper=${exp.relatedPaper}`}>{paperTitle}</Link>]
                    : null,
                ]}
              />
            </RecordSection>

            {metricRows.length > 0 && (
              <RecordSection label="Final metrics">
                <RecordFacts rows={metricRows.map(([k, v]) => [k, formatMetricCell(k, v)] as const)} />
              </RecordSection>
            )}

            {configRows.length > 0 && (
              <RecordSection label="Config" tag={`${configRows.length}`}>
                <RecordFacts
                  rows={configRows.map(
                    ([k, v]) => [k, typeof v === "object" && v !== null ? JSON.stringify(v) : String(v)] as const,
                  )}
                />
              </RecordSection>
            )}

            {activity.length > 0 && (
              <RecordSection label="Activity">
                <RecordActivity events={activity} />
              </RecordSection>
            )}
          </aside>
        </div>
      </article>
    </section>
  );
}
