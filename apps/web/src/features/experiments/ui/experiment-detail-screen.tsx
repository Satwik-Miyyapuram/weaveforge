"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  EXPERIMENT_STATUSES, isStaleRunningExperiment, shortSha, type Experiment, type ExperimentStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { BackButton } from "@/components/back-button";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { NoteComments, ShareButton } from "@/features/sharing";
import { commitUrl } from "@/features/sync";
import { CommentsIcon } from "@/components/view-icons";
import {
  RecordActivity,
  RecordEmpty,
  RecordFacts,
  RecordSection,
  recordDate,
} from "@/components/record";
import { formatMetricCell } from "./metric-chart";
import { formatError } from "@/lib/format-error";
import { AttachArtifactsButton } from "./attach-artifacts-button";
import { EXPERIMENTS_HREF } from "../application/experiment-href";
import { Artifacts, MetricCurves, usePaperTitle } from "./experiment-panels";
import { StatusSelect } from "@/components/status-select";
import { FormError } from "@/components/form-error";
import { ChevronIcon } from "@/components/chevron-icon";


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
  const [asideOpen, setAsideOpen] = useState(() => {
    try {
      return sessionStorage.getItem("record-aside:shut") !== "1";
    } catch {
      return true;
    }
  });
  const toggleAside = () =>
    setAsideOpen((open) => {
      try {
        sessionStorage.setItem("record-aside:shut", open ? "1" : "0");
      } catch {}
      return !open;
    });
  const resultRef = useRef<HTMLParagraphElement>(null);
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

  const [resultDraft, setResultDraft] = useState<string | null>(null);
  const [resultError, setResultError] = useState<string | null>(null);
  async function saveResult() {
    if (!exp || resultDraft === null) return;
    try {
      setExp(await getContainer().experiments.manageExperiment.setResultNote(exp.id, resultDraft));
      setResultDraft(null);
      setResultError(null);
    } catch (err) {
      setResultError(formatError(err));
    }
  }

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
        <BackButton label="Experiments" onClick={goBackToList} />
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
    <section className="screen exp-detail screen--wide">
      <article className="record">
        <nav className="record-bar" aria-label="Experiment">
          <BackButton label="Experiments" onClick={goBackToList} />
          <span className="record-mono record-bar-id">Run {exp.id.slice(0, 6)}</span>
          <StatusSelect
            value={exp.status}
            statuses={EXPERIMENT_STATUSES}
            onChange={(st) => void setStatus(st)}
            label="Run status"
          />
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

        <div className={`record-grid${asideOpen ? "" : " record-grid--aside-shut"}`}>
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

            <RecordSection
              label="Result"
              tag={
                resultDraft === null ? (
                  <button type="button" className="record-action" onClick={() => setResultDraft(exp.resultNote ?? "")}>
                    {exp.resultNote ? "Edit" : "Write result"}
                  </button>
                ) : undefined
              }
            >
              {resultError && <FormError>{resultError}</FormError>}
              {resultDraft !== null ? (
                <div className="exp-result-edit">
                  <textarea
                    autoFocus
                    rows={5}
                    value={resultDraft}
                    placeholder="What came out of this run? Does it confirm the hypothesis?"
                    onChange={(e) => setResultDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void saveResult();
                      if (e.key === "Escape") setResultDraft(null);
                    }}
                  />
                  <div className="exp-result-actions">
                    <button type="button" className="btn-secondary" onClick={() => setResultDraft(null)}>Cancel</button>
                    <button type="button" className="btn-primary" onClick={() => void saveResult()}>Save result</button>
                  </div>
                </div>
              ) : exp.resultNote ? (
                <p ref={resultRef} className="record-abstract">{exp.resultNote}</p>
              ) : (
                <RecordEmpty>No result written yet. Write one here, or the SDK&apos;s <code>run.finish(note=…)</code> fills it in.</RecordEmpty>
              )}
            </RecordSection>

            {exp.runCommand && (
              <RecordSection label="Run command">
                <pre className="exp-run-cmd">{exp.runCommand}</pre>
              </RecordSection>
            )}

            <NoteComments
              resourceType="experiment"
              resourceId={exp.id}
              canComment
              isOwner
              contentRef={resultRef}
              contentKey={exp.resultNote ?? ""}
            />
          </div>

          <aside className="record-aside">
            <button
              type="button"
              className="entity-icon-btn record-aside-toggle"
              onClick={toggleAside}
              aria-expanded={asideOpen}
              aria-label={asideOpen ? "Hide side panel" : "Show side panel"}
              title={asideOpen ? "Hide side panel" : "Show side panel"}
            >
              <ChevronIcon />
            </button>
            {asideOpen && (
            <>
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
            </>
            )}
          </aside>
        </div>
      </article>
    </section>
  );
}
