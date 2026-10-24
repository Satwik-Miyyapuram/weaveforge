"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  EXPERIMENT_STATUSES,
  isStaleRunningExperiment,
  type Experiment,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { CompareViewIcon, ListViewIcon } from "@/components/view-icons";
import { ClearFiltersButton, EmptyState } from "@/components/empty-state";
import { NavIcon } from "@/app/nav-icon";
import { CardColumns } from "@/components/card-columns";
import { ShareButton, usePinnedOwnerNames } from "@/features/sharing";
import { usePersistedState } from "@/lib/hooks/use-persisted-state";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray, emptyMap } from "@/lib/empty";
import { usePinnedSharing } from "@/lib/hooks/use-pinned-sharing";
import type { ExperimentsScreenData } from "@/features/experiments/application/load-experiments-screen.use-case";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { LocalApiTokenCreate, useLocalApiState } from "@/components/local-api-tokens";
import { ScreenHead } from "@/components/screen-head";
import { FilterRow } from "@/components/filter-row";
import { warnOnce } from "@/lib/error-report/warn-once";
import { ViewSwitch } from "@/components/view-switch";
import { useScreenSearch } from "@/lib/hooks/use-screen-search";
import { isOfflineBuild } from "@/deployment/build-target";
import { statusLabel } from "@/components/status-select";
import { ExperimentDetailScreen } from "./experiment-detail-screen";
import { FormError } from "@/components/form-error";
import { AddExperimentForm } from "./add-experiment-form";
import { ExperimentCard } from "./experiment-card";
import { CompareView } from "./experiments-compare";

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

  const items = data?.experiments ?? emptyArray<Experiment>();
  const pinnedSharedBy = data?.pinnedSharedBy ?? emptyMap<string, string>();
  const ownerNames = data?.ownerNames ?? emptyMap<string, string>();

  const [statusFilter, setStatusFilter] = usePersistedState<string[]>("thesis.experiments.status", []);
  const [view, setView] = usePersistedState<string>("thesis.experiments.view", "list");
  const [search, setSearch] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeMode, setComposeMode] = useState<"menu" | "new" | "sdk">("menu");
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
    // A build with a page per experiment sends the reader there. A static one
    // has no such page, and shows the experiment here instead.
    if (isOfflineBuild()) return;
    if (!focusFromUrl) {
      appliedFocus.current = null;
      return;
    }
    if (appliedFocus.current === focusFromUrl) return;
    appliedFocus.current = focusFromUrl;
    router.replace(`/experiments/${focusFromUrl}`);
  }, [focusFromUrl, router]);

  const { isReadOnly: isReadOnlyExperiment, sharedOwnerName, isPinned: isPinnedExperiment } = usePinnedSharing({ isSharedView, pinnedSharedBy, ownerNames });

  // Poll while a run is actually in progress so metrics/status stay fresh.
  // Ungated it polled forever on a screen full of finished experiments, and
  // every tick asked the loader to re-fetch a cached payload — see the wording
  // on the live badge, which has to match what this actually does.
  const hasLiveRunning = useMemo(
    () => items.some((e) => e.status === "running" && !isStaleRunningExperiment(e)),
    [items],
  );
  useEffect(() => {
    if (!hasLiveRunning) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [hasLiveRunning, load]);

  // Stale-run cleanup, once per mount and deliberately *not* part of the load.
  //
  // It writes, and the load path runs on mount, on project switch and on every
  // poll above — hanging maintenance there made a read a mutation and had it
  // run several times over. The facade single-flights the call, so a second
  // mount (React's development double-invoke, or another tab) joins this one
  // rather than issuing the same updates again. Reload afterwards, so a run
  // that has just been marked abandoned is drawn as abandoned.
  useEffect(() => {
    let active = true;
    void getContainer()
      .experiments.reconcileStaleRuns()
      .then(() => {
        if (active) void load();
      })
      .catch((err: unknown) => warnOnce("experiments", "reconcile stale runs failed", err));
    return () => {
      active = false;
    };
  }, [load]);

  const match = useScreenSearch(search, "experiment");
  const visible = useMemo(() => {
    const set = new Set(statusFilter);
    const byStatus = set.size === 0 ? items : items.filter((e) => set.has(e.status));
    return match(byStatus, (e) => e.id, (e) => [e.name, e.hypothesis, e.branch, e.resultNote].join(" "));
  }, [items, statusFilter, match]);

  // The static build has no page per experiment, so the list's own route stands
  // in for one: with `?experiment=` set it *is* the experiment's page, the way
  // `/papers/?paper=` is a paper's. It used to open over the list in a dialog,
  // which made an experiment the one thing in the app you could not link to,
  // go back from, or read at full width.
  if (isOfflineBuild() && focusFromUrl) return <ExperimentDetailScreen id={focusFromUrl} />;

  if (loading) {
    return <ScreenLoading status="Loading experiments…" />;
  }

  return (
    <section className="screen screen--wide">
      <ScreenHead
        eyebrow={experimentsEyebrow(items)}
        search={items.length > 0 ? { value: search, onChange: setSearch, label: "Search experiments" } : undefined}
      >
        {hasLiveRunning && (
          // The tick is 5s, but a tick does not necessarily refresh anything:
          // `useScreenData` serves the cached payload and only re-fetches once
          // the screen cache is older than its 120s freshness window. "Every 5s"
          // claimed a freshness this screen never had.
          <span className="live-dot" title="A run is in progress — this screen re-checks for updates in the background, at most once every 2 minutes">● live</span>
        )}
        <button
          className="btn-primary"
          type="button"
          onClick={() => { setComposeMode("menu"); setComposeOpen(true); }}
        >
          New experiment
        </button>
      </ScreenHead>

      {composeOpen && (
        <Modal
          title={composeMode === "new" ? "Log an experiment" : composeMode === "sdk" ? "Python SDK token" : "Experiment actions"}
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
              {desktop() && (
                <button
                  type="button"
                  className="org-choice-card"
                  onClick={() => setComposeMode("sdk")}
                >
                  <span className="org-choice-title">Python SDK token</span>
                  <p className="org-choice-desc">Copy or create a token so training scripts log runs here.</p>
                </button>
              )}
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
          ) : composeMode === "sdk" ? (
            <SdkTokenView />
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
          label="⇅ Share all"
          hideTrigger
          open={shareAllOpen}
          onOpenChange={setShareAllOpen}
        />
      )}

      {items.length > 0 && (
        <FilterRow
          label="Filter experiments"
          facets={[
            {
              id: "fprogress",
              label: "Status",
              chipPrefix: "Status: ",
              values: statusFilter,
              onChange: setStatusFilter,
              options: EXPERIMENT_STATUSES.map((s) => ({ value: s, label: statusLabel(s) })),
            },
          ]}
        >
          <ViewSwitch
            label="Experiments view"
            value={view}
            onChange={setView}
            options={[
              { value: "list", label: "Cards", icon: <ListViewIcon /> },
              { value: "compare", label: "Compare", icon: <CompareViewIcon /> },
            ]}
          />
        </FilterRow>
      )}

      {error && <FormError>{error}</FormError>}
      {!error && items.length === 0 && (
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="flask" />}
          title="No experiments yet"
          body="An experiment is one run you can point at: what you changed, what came out, and which paper it came from. Record the first one and the chain starts here."
          action={
            <button
              type="button"
              className="btn-primary"
              onClick={() => { setComposeMode("menu"); setComposeOpen(true); }}
            >
              New experiment
            </button>
          }
        />
      )}
      {items.length > 0 && visible.length === 0 && (
        <EmptyState
          variant="no-results"
          body="No experiments match."
          action={<ClearFiltersButton onClear={() => { setStatusFilter([]); setSearch(""); }} />}
        />
      )}

      {visible.length > 0 &&
        (view === "compare" ? (
          <CompareView experiments={visible} />
        ) : (
          // Masonry like Papers and Notes, wider: a run card carries charts and chips.
          <CardColumns
            className="exp-columns"
            items={visible}
            getKey={(e) => e.id}
            minColumnWidth={380}
            gap={16}
            deferOffscreen={visible.length > 20}
            renderItem={(e) => (
              <ExperimentCard
                exp={e}
                readOnly={isReadOnlyExperiment(e.id)}
                isPinned={isPinnedExperiment(e.id)}
                sharedByName={sharedOwnerName(e.id)}
                onReplace={replace}
                onChanged={load}
              />
            )}
          />
        ))}

    </section>
  );
}

/** "5 experiments · 2 running": the count the brutal themes set over the title. */
function experimentsEyebrow(experiments: Experiment[]): string | undefined {
  if (experiments.length === 0) return undefined;
  const running = experiments.filter((e) => e.status === "running").length;
  const total = `${experiments.length} ${experiments.length === 1 ? "experiment" : "experiments"}`;
  return running > 0 ? `${total} · ${running} running` : total;
}

/** Token picker for `pip install weaveforge` scripts talking to this desktop app. */
function SdkTokenView() {
  const [state, setState] = useLocalApiState();
  if (!state) return <p className="muted">Loading…</p>;
  return (
    <div className="add-form">
      <p className="muted">
        Scripts on this computer log runs with <code>pip install weaveforge</code>. Set{" "}
        <code>WEAVEFORGE_PROJECT</code> to this project&rsquo;s name.
      </p>
      <LocalApiTokenCreate state={state} onChange={setState} permissions={["experiments"]} />
    </div>
  );
}
