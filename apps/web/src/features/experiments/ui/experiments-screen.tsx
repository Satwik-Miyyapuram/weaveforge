"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  EXPERIMENT_STATUSES,
  experimentActivityAt,
  isStaleRunningExperiment,
  type Experiment,
  type ExperimentStatus,
  type MetricPoint,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { useNavPending } from "@/lib/nav-pending";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { Popover } from "@/components/popover";
import { CompareViewIcon, FilterIcon, ListViewIcon } from "@/components/view-icons";
import { EntityCard } from "@/components/entity-card";
import { ExperimentCardThumbs } from "@/components/card-thumbs";
import { cardSnippet } from "@/lib/card-snippet";
import { ShareButton, PinnedPaperBadge, usePinnedOwnerNames } from "@/features/sharing";
import { Select } from "@/components/select";
import { MultiSelect } from "@/components/multi-select";
import { usePersistedState } from "@/lib/use-persisted-state";
import { useScreenData } from "@/lib/use-screen-data";
import { emptyArray, emptyMap } from "@/lib/empty";
import type { ExperimentsScreenData } from "@/features/experiments/application/load-experiments-screen.use-case";
import { formatMetricCell, MetricChart } from "./metric-chart";
import {
  ExpGitChips,
  ExpMetricChips,
  ExperimentTitleLink,
} from "./experiment-panels";

type ExperimentsViewData = ExperimentsScreenData & { ownerNames: Map<string, string> };

export function ExperimentsScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  const isSharedView = searchParams.get("shared") === "1";
  const focusFromUrl = searchParams.get("experiment");
  const appliedFocus = useRef<string | null>(null);

  const loadScreen = useCallback(async (): Promise<ExperimentsViewData> => {
    const data = await getContainer().experiments.loadScreenData();
    // Owner labels arrive separately — see usePinnedOwnerNames. Awaiting the
    // lab directory here delayed the whole screen by ~1.8s.
    return { ...data, ownerNames: emptyMap<string, string>() };
  }, []);

  const { data, loading, error: loadError, reload: load, setData } = useScreenData(
    "experiments",
    loadScreen,
  );

  usePinnedOwnerNames(data, setData);

  useEffect(() => {
    setError(loadError);
  }, [loadError]);

  const items = data?.experiments ?? emptyArray<import("@weaveforge/core").Experiment>();
  const pinnedSharedBy = data?.pinnedSharedBy ?? emptyMap<string, string>();
  const ownerNames = data?.ownerNames ?? emptyMap<string, string>();

  const [statusFilter, setStatusFilter] = usePersistedState<string[]>("thesis.experiments.status", []);
  const [view, setView] = usePersistedState<string>("thesis.experiments.view", "list");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"menu" | "new">("menu");
  const [shareAllOpen, setShareAllOpen] = useState(false);

  const replace = useCallback(
    (e: Experiment) => {
      setData((prev) =>
        prev
          ? { ...prev, experiments: prev.experiments.map((x) => (x.id === e.id ? e : x)) }
          : prev,
      );
    },
    [setData],
  );

  useEffect(() => {
    if (!focusFromUrl) {
      appliedFocus.current = null;
      return;
    }
    if (appliedFocus.current === focusFromUrl) return;
    appliedFocus.current = focusFromUrl;
    router.replace(`/experiments/${focusFromUrl}`);
  }, [focusFromUrl, router]);

  const isReadOnlyExperiment = useCallback(
    (id: string) => isSharedView || pinnedSharedBy.has(id),
    [isSharedView, pinnedSharedBy],
  );

  const sharedOwnerName = useCallback(
    (id: string) => {
      const ownerId = pinnedSharedBy.get(id);
      return ownerId ? ownerNames.get(ownerId) : undefined;
    },
    [pinnedSharedBy, ownerNames],
  );

  // Poll every 5s while this screen is open so metrics/status stay fresh.
  const hasLiveRunning = useMemo(
    () => items.some((e) => e.status === "running" && !isStaleRunningExperiment(e)),
    [items],
  );
  useEffect(() => {
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [load]);

  const visible = useMemo(() => {
    const set = new Set(statusFilter);
    return set.size === 0 ? items : items.filter((e) => set.has(e.status));
  }, [items, statusFilter]);

  if (loading) {
    return <ScreenLoading status="Loading experiments…" />;
  }

  return (
    <section className="screen">
      <header className="screen-head">
        <div className="head-row">
          <div className="screen-actions">
            {hasLiveRunning && (
              <span className="live-dot" title="A run is in progress — auto-refreshing every 5s">● live</span>
            )}
            <button
              className="btn-primary"
              type="button"
              onClick={() => { setComposeMode("menu"); setComposeOpen(true); }}
            >
              + Experiment
            </button>
          </div>
        </div>
      </header>

      {composeOpen && (
        <Modal
          title={composeMode === "new" ? "Log an experiment" : "Experiment actions"}
          onClose={() => { setComposeOpen(false); setComposeMode("menu"); }}
        >
          {composeMode === "menu" ? (
            <div className="org-modal-choices">
              <button
                type="button"
                className="org-choice-card"
                onClick={() => setComposeMode("new")}
              >
                <span className="org-choice-title">Log run</span>
                <p className="org-choice-desc">Record a new experiment run.</p>
              </button>
              {items.length > 0 && (
                <button
                  type="button"
                  className="org-choice-card"
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeMode("menu");
                    setShareAllOpen(true);
                  }}
                >
                  <span className="org-choice-title">Share all</span>
                  <p className="org-choice-desc">Share every experiment in this project.</p>
                </button>
              )}
            </div>
          ) : (
            <AddExperimentForm
              onAdded={() => {
                setComposeOpen(false);
                setComposeMode("menu");
                void load();
              }}
            />
          )}
        </Modal>
      )}

      {items.length > 0 && (
        <ShareButton
          resourceType="experiment"
          resourceId={null}
          title="Share all your experiments"
          label="⇅ share all"
          hideTrigger
          open={shareAllOpen}
          onOpenChange={setShareAllOpen}
        />
      )}

      {items.length > 0 && (
        <div className="controls-row">
          <Popover
            label={<FilterIcon />}
            ariaLabel="Filters"
            iconOnly
            count={statusFilter.length ? 1 : 0}
            align="right"
          >
            <div className="filters">
              <MultiSelect
                id="fprogress"
                values={statusFilter}
                onChange={setStatusFilter}
                allLabel="All statuses"
                ariaLabel="Filter by progress"
                options={EXPERIMENT_STATUSES.map((s) => ({ value: s, label: s }))}
              />
              {statusFilter.length > 0 && (
                <button type="button" className="link-btn" onClick={() => setStatusFilter([])}>
                  Clear filters
                </button>
              )}
            </div>
          </Popover>
          <div className="controls-spacer" />
          <div className="seg" role="tablist" aria-label="Experiments view">
            <button
              type="button"
              role="tab"
              aria-label="List view"
              aria-selected={view === "list"}
              className={view === "list" ? "seg-on" : ""}
              onClick={() => setView("list")}
            >
              <ListViewIcon />
            </button>
            <button
              type="button"
              role="tab"
              aria-label="Compare view"
              aria-selected={view === "compare"}
              className={view === "compare" ? "seg-on" : ""}
              onClick={() => setView("compare")}
            >
              <CompareViewIcon />
            </button>
          </div>
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!error && items.length === 0 && (
        <div className="empty">
          <p>No experiments yet. Use “+ Experiment” to record your first one.</p>
        </div>
      )}
      {items.length > 0 && visible.length === 0 && (
        <div className="empty">
          <p>No experiments match the filter.</p>
        </div>
      )}

      {visible.length > 0 &&
        (view === "compare" ? (
          <CompareView experiments={visible} />
        ) : (
          <ul className={`exp-list ${visible.length > 20 ? "long-list" : ""}`}>
            {visible.map((e) => (
              <ExperimentCard
                key={e.id}
                exp={e}
                readOnly={isReadOnlyExperiment(e.id)}
                sharedByName={sharedOwnerName(e.id)}
                onReplace={replace}
                onChanged={load}
              />
            ))}
          </ul>
        ))}
    </section>
  );
}

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
function CompareView({ experiments }: { experiments: Experiment[] }) {
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
    <div className="metric-curves metric-curves--compare">
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
    </div>
  );
}

function ExperimentCard({
  exp,
  readOnly = false,
  sharedByName,
  onReplace,
  onChanged,
}: {
  exp: Experiment;
  readOnly?: boolean;
  sharedByName?: string;
  onReplace: (e: Experiment) => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { beginNavigation } = useNavPending();
  const [busy, setBusy] = useState(false);
  const openDetail = useCallback(() => {
    const dest = `/experiments/${exp.id}`;
    beginNavigation(dest);
    router.push(dest);
  }, [beginNavigation, router, exp.id]);
  async function setStatus(status: ExperimentStatus) {
    onReplace(await getContainer().experiments.manageExperiment.setStatus(exp.id, status));
  }
  async function remove() {
    if (!confirm(`Delete experiment "${exp.name}"?`)) return;
    setBusy(true);
    try {
      await getContainer().experiments.manageExperiment.remove(exp.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }
  return (
    <EntityCard
      as="li"
      id={`exp-${exp.id}`}
      className="exp-item"
      onActivate={openDetail}
      title={exp.name}
      status={
        readOnly ? (
          <PinnedPaperBadge ownerName={sharedByName} />
        ) : (
          <Select
            className="status-select"
            value={exp.status}
            onChange={(ev) => void setStatus(ev.target.value as ExperimentStatus)}
          >
            {EXPERIMENT_STATUSES.map((st) => (
              <option key={st} value={st}>{st}</option>
            ))}
          </Select>
        )
      }
      meta={exp.hypothesis || undefined}
      onDelete={readOnly ? undefined : () => void remove()}
      deleteDisabled={busy}
      deleteAriaLabel="Delete experiment"
      actions={
        !readOnly ? (
          <ShareButton resourceType="experiment" resourceId={exp.id} title={`Share: ${exp.name}`} />
        ) : undefined
      }
      onOpen={openDetail}
      openLabel="Open experiment"
    >
      <ExpGitChips exp={exp} limit={3} />
      <ExpMetricChips exp={exp} limit={3} />
      <div className="card-body-row">
        {exp.resultNote && <p className="entity-card-snippet">{cardSnippet(exp.resultNote)}</p>}
        <ExperimentCardThumbs artifacts={exp.artifacts} />
      </div>
    </EntityCard>
  );
}

function AddExperimentForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState("");
  const [branch, setBranch] = useState("");
  const [commit, setCommit] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [config, setConfig] = useState("");
  const [status, setStatus] = useState<ExperimentStatus>("planned");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      let parsed: Record<string, unknown> | undefined;
      if (config.trim()) {
        try { parsed = JSON.parse(config); }
        catch { throw new Error("Config must be valid JSON."); }
      }
      await getContainer().experiments.manageExperiment.add({
        name, branch: branch || undefined, commitSha: commit || undefined,
        repoUrl: repoUrl || undefined, status, config: parsed,
      });
      setName(""); setBranch(""); setCommit(""); setRepoUrl(""); setConfig("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card add-form" onSubmit={submit}>
      <div className="field">
        <label htmlFor="ename">Name</label>
        <input id="ename" value={name} onChange={(e) => setName(e.target.value)} placeholder="beta-vae sweep β=4" required />
      </div>
      <div className="field-row">
        <div className="field"><label htmlFor="ebranch">Branch</label><input id="ebranch" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" /></div>
        <div className="field"><label htmlFor="ecommit">Commit</label><input id="ecommit" value={commit} onChange={(e) => setCommit(e.target.value)} placeholder="a1b2c3d" /></div>
        <div className="field">
          <label htmlFor="estatus">Status</label>
          <Select id="estatus" value={status} onChange={(e) => setStatus(e.target.value as ExperimentStatus)}>
            {EXPERIMENT_STATUSES.map((st) => <option key={st} value={st}>{st}</option>)}
          </Select>
        </div>
      </div>
      <div className="field"><label htmlFor="erepo">Repo URL</label><input id="erepo" value={repoUrl} onChange={(e) => setRepoUrl(e.target.value)} placeholder="https://github.com/you/thesis-experiments" /></div>
      <div className="field"><label htmlFor="econfig">Config (JSON)</label><textarea id="econfig" rows={2} value={config} onChange={(e) => setConfig(e.target.value)} placeholder='{"beta":4,"latent_dim":32,"seed":0}' /></div>
      {error && <p className="error">{error}</p>}
      <button className="btn-primary" disabled={busy}>{busy ? "Adding…" : "Add experiment"}</button>
    </form>
  );
}
