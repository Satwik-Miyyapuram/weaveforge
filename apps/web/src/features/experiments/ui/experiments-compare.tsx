"use client";

import { useMemo, useState } from "react";
import {
  experimentActivityAt,
  type Experiment,
  type MetricPoint,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { SortHeader } from "@/components/sort-header";
import { Table } from "@/components/table";
import { statusLabel } from "@/components/status-select";
import { formatMetricCell, MetricChart } from "./metric-chart";
import { MetricGrid } from "./metric-grid";
import { usePolledLoad } from "./use-polled-load";
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

  const chosen = useMemo(() => experiments.filter((e) => selected.includes(e.id)), [experiments, selected]);

  return (
    <div className="compare">
      <Table
        empty="No runs to compare yet."
        head={
          <>
            <th>
              <span className="sr-only">Compare</span>
            </th>
            <th>Run</th>
            <th>Status</th>
            {metricKeys.map((k) => (
              <SortHeader
                key={k}
                label={k}
                active={sortKey === k}
                dir={sortDir}
                onSort={() => toggleSort(k)}
              />
            ))}
          </>
        }
      >
            {rows.map((e, i) => (
              <tr key={e.id} className={sortKey && i === 0 ? "leader" : ""}>
                <td>
                  <input className="wf-check"
                    type="checkbox"
                    checked={selected.includes(e.id)}
                    onChange={() => toggleSel(e.id)}
                    aria-label={`compare ${e.name}`}
                  />
                </td>
                <td><ExperimentTitleLink exp={e} /></td>
                <td>{statusLabel(e.status)}</td>
                {metricKeys.map((k) => (
                  <td key={k}>
                    {e.metrics?.[k] !== undefined ? formatMetricCell(k, e.metrics[k]) : "—"}
                  </td>
                ))}
              </tr>
            ))}
      </Table>
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
  // One run failing to load shows as no curve for that run, not an error.
  const { data } = usePolledLoad(
    ids,
    () =>
      Promise.all(
        ordered.map((e) =>
          getContainer().experiments.metricHistory(e.id)
            .then((h) => [e.id, h] as const)
            .catch(() => [e.id, [] as MetricPoint[]] as const),
        ),
      ).then((entries) => Object.fromEntries(entries) as Record<string, MetricPoint[]>),
    5000,
  );

  /** One stable series list per metric, so a chart only redraws when its data changes. */
  const seriesByMetric = useMemo(() => {
    const hist = data ?? {};
    const names = new Set<string>();
    Object.values(hist).forEach((pts) => pts.forEach((p) => names.add(p.metric)));
    return [...names].sort().map((m) => [
      m,
      ordered
        .map((e, i) => ({
          id: e.id,
          label: e.name,
          color: PALETTE[i % PALETTE.length] ?? "#3e5a78",
          zOrder: experimentActivityAt(e),
          points: (hist[e.id] ?? []).filter((p) => p.metric === m),
        }))
        .filter((s) => s.points.length > 0),
    ] as const);
  }, [data, ordered]);

  if (seriesByMetric.length === 0)
    return <p className="muted">Selected runs have no logged curves to overlay yet.</p>;

  return (
    <MetricGrid variant="compare" defaultCols={2}>
      {seriesByMetric.map(([m, series]) => (
        <MetricChart key={m} metric={m} height={320} series={series} />
      ))}
    </MetricGrid>
  );
}
