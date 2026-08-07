"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  EXPERIMENT_STATUSES,
  isStaleRunningExperiment,
  type Experiment,
  type ExperimentStatus,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Select } from "@/components/select";
import { ScreenLoader } from "@/components/weaveforge-loader";
import { ShareButton, CommentsToggle } from "@/features/sharing";
import {
  Artifacts,
  ExpConfigPanel,
  ExpGitChips,
  ExpMetricChips,
  MetricCurves,
} from "./experiment-panels";

export function ExperimentDetailScreen({ id: idProp }: { id?: string }) {
  const router = useRouter();
  const params = useParams();
  const id = idProp ?? (typeof params.id === "string" ? params.id : "");
  const [exp, setExp] = useState<Experiment | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

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
      setError(err instanceof Error ? err.message : String(err));
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

  const goBackToList = useCallback(() => {
    router.back();
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
        <p className="error">{error ?? "Experiment not found."}</p>
      </section>
    );
  }

  const config = exp.config ?? {};
  const hasArtifacts = (exp.artifacts?.length ?? 0) > 0;

  return (
    <section className="screen exp-detail">
      <button type="button" className="btn-secondary paper-back" onClick={goBackToList}>
        ← Experiments
      </button>

      <div className="paper-note-head">
        <span className="paper-note-status">
          <Select
            className="status-select"
            value={exp.status}
            onChange={(ev) => void setStatus(ev.target.value as ExperimentStatus)}
          >
            {EXPERIMENT_STATUSES.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </Select>
        </span>
        <div className="card-foot-right">
          {live && (
            <span className="live-dot" title="Run in progress — auto-refreshing every 5s">● live</span>
          )}
          <ShareButton resourceType="experiment" resourceId={exp.id} title={`Share: ${exp.name}`} />
          <CommentsToggle resourceType="experiment" resourceId={exp.id} canComment variant="detail" />
        </div>
      </div>

      <h1 className="exp-detail-title">{exp.name}</h1>
      {exp.hypothesis && <p className="exp-detail-hypothesis">{exp.hypothesis}</p>}
      <div className="exp-detail-meta">
        <ExpGitChips exp={exp} />
        <ExpMetricChips exp={exp} />
      </div>

      <ExpConfigPanel config={config} />

      <section className="exp-detail-section">
        <h3 className="exp-detail-heading">Metrics</h3>
        <MetricCurves experimentId={exp.id} live={live} chartHeight={320} />
      </section>

      {hasArtifacts && (
        <section className="exp-detail-section">
          <h3 className="exp-detail-heading">Figures &amp; artifacts</h3>
          <Artifacts urls={exp.artifacts} detail />
        </section>
      )}

      {exp.resultNote && (
        <section className="exp-detail-section">
          <h3 className="exp-detail-heading">Notes</h3>
          <p className="summary">{exp.resultNote}</p>
        </section>
      )}

      {exp.runCommand && (
        <section className="exp-detail-section">
          <h3 className="exp-detail-heading">Run command</h3>
          <pre className="exp-run-cmd">{exp.runCommand}</pre>
        </section>
      )}
    </section>
  );
}
