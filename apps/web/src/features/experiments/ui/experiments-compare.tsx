"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  experimentActivityAt,
  type Experiment,
  type MetricPoint,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { formatMetricCell, MetricChart } from "./metric-chart";
import { MetricGrid } from "./metric-grid";
import {
  ExperimentTitleLink,
} from "./experiment-panels";

const PALETTE = [
  "#3e5a78", "#c2410c", "#0f766e", "#7c3aed",
  "#b91c1c", "#a16207", "#0369a1", "#4d7c0f",
];

function asNumber(v: unknown): number | null {
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
}

/**
 * Compare view: a sortable runs table (metric columns) + overlaid curves for the
 * selected runs. This is the sweep workflow — "which config won, and why" — that
 * a per-card list can't answer.
 */
export function CompareView({ experiments }: { experiments: Experiment[] }) {
  const metricKeys = useMemo(() => {
    const s = new Set<string>();
    experiments.forEach((e) => Object.keys(e.metrics ?? {}).forEach((k) => s.add(k)));
    return [...s].sort();
  }, [experiments]);

  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selected, setSelected] = useState<string[]>(() =>
    experiments.slice(0, 3).map((e) => e.id),
  );

  const rows = useMemo(() => {
    const list = [...experiments];
    if (sortKey) {
      list.sort((a, b) => {
        const av = asNumber(a.metrics?.[sortKey]);
        const bv = asNumber(b.metrics?.[sortKey]);
        if (av === null && bv === null) return 0;
        if (av === null) return 1;
        if (bv === null) return -1;
        return sortDir === "asc" ? av - bv : bv - av;
      });
    }
    return list;
  }, [experiments, sortKey, sortDir]);

  function toggleSort(k: string) {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else {
      setSortKey(k);
      setSortDir("desc");
    }
  }
  function toggleSel(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const chosen = experiments.filter((e) => selected.includes(e.id));

  return (
    <div className="compare">
      <div className="table-scroll">
        <table className="cmp-table">
          <thead>
            <tr>
              <th aria-label="select" />
              <th>Run</th>
              <th>Status</th>
              {metricKeys.map((k) => (
                <th key={k}>
                  <button className="link-btn" onClick={() => toggleSort(k)}>
                    {k}
                    {sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((e, i) => (
              <tr key={e.id} className={sortKey && i === 0 ? "leader" : ""}>
                <td>
                  <input
                    type="checkbox"
                    className="themed-check"
                    checked={selected.includes(e.id)}
                    onChange={() => toggleSel(e.id)}
                    aria-label={`compare ${e.name}`}
                  />
                </td>
                <td><ExperimentTitleLink exp={e} /></td>
                <td>{e.status}</td>
                {metricKeys.map((k) => (
                  <td key={k}>
                    {e.metrics?.[k] !== undefined ? formatMetricCell(k, e.metrics[k]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {chosen.length > 0 && <OverlayCharts experiments={chosen} />}
    </div>
  );
}

/** Fetches the selected runs' histories and overlays them, one chart per metric. */
function OverlayCharts({ experiments }: { experiments: Experiment[] }) {
  /** Oldest first so uPlot draws newer runs on top of older ones. */
  const ordered = useMemo(
    () => [...experiments].sort((a, b) => experimentActivityAt(a) - experimentActivityAt(b)),
    [experiments],
  );
  const ids = ordered.map((e) => e.id).join(",");
  const [hist, setHist] = useState<Record<string, MetricPoint[]>>({});

  const fetchHist = useCallback(() => {
    return Promise.all(
      ordered.map((e) =>
        getContainer().experiments.metricHistory(e.id)
          .then((h) => [e.id, h] as const)
          .catch(() => [e.id, [] as MetricPoint[]] as const),
      ),
    ).then((entries) => setHist(Object.fromEntries(entries)));
  }, [ordered]);

  useEffect(() => {
    let alive = true;
    void fetchHist().then(() => {
      if (!alive) return;
    });
    const t = setInterval(() => { void fetchHist(); }, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [fetchHist, ids]);

  const metrics = useMemo(() => {
    const s = new Set<string>();
    Object.values(hist).forEach((pts) => pts.forEach((p) => s.add(p.metric)));
    return [...s].sort();
  }, [hist]);

  const color = (i: number) => PALETTE[i % PALETTE.length] ?? "#3e5a78";

  if (metrics.length === 0)
    return <p className="muted">Selected runs have no logged curves to overlay yet.</p>;

  return (
    <MetricGrid variant="compare" defaultCols={2}>
      {metrics.map((m) => (
        <MetricChart
          key={m}
          metric={m}
          height={320}
          series={ordered
            .map((e, i) => ({
              id: e.id,
              label: e.name,
              color: color(i),
              zOrder: experimentActivityAt(e),
              points: (hist[e.id] ?? []).filter((p) => p.metric === m),
            }))
            .filter((s) => s.points.length > 0)}
        />
      ))}
    </MetricGrid>
  );
}
