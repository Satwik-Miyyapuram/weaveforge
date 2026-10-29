"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  type Experiment,
  type Milestone,
  type Paper,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { ClearFiltersButton, EmptyState } from "@/components/empty-state";
import { useScreenSearch } from "@/lib/hooks/use-screen-search";
import { NavIcon } from "@/app/nav-icon";
import { ShareButton, usePinnedOwnerNames } from "@/features/sharing";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray, emptyMap } from "@/lib/empty";
import { usePinnedSharing } from "@/lib/hooks/use-pinned-sharing";
import type { PlanScreenData } from "@/features/plan/application/load-plan-screen.use-case";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";
import { planPace, planTimeline } from "@/features/plan/application/plan-timeline";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { PlanTimelineBar } from "@/features/plan/ui/plan-timeline-bar";
import { MilestoneForm } from "./milestone-form";
import { MilestoneCard } from "./milestone-card";
import { Button } from "@/components/button";
import { FoldButton } from "@/components/controls";

type PlanViewData = PlanScreenData & { ownerNames: Map<string, string> };

/**
 * Plan screen: forward-looking milestones with structured dependencies
 * (other milestones / experiments / papers / external needs) and compute
 * requirements. Milestone events post to Mattermost when configured.
 */
export function PlanScreen() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const [search, setSearch] = useState("");

  const isSharedView = searchParams.get("shared") === "1";
  const focusFromUrl = searchParams.get("milestone");
  const appliedFocus = useRef<string | null>(null);

  const loadScreen = useCallback(async (): Promise<PlanViewData> => {
    const data = await getContainer().plan.loadScreenData();
    // Owner labels arrive separately — see usePinnedOwnerNames. Awaiting the
    // lab directory here delayed the whole screen by ~1.8s.
    return { ...data, ownerNames: emptyMap<string, string>() };
  }, []);

  const { data, loading, error: loadError, reload: load, setData } = useScreenData("plan", loadScreen);

  usePinnedOwnerNames(data, setData);

  useEffect(() => {
    setError(loadError);
  }, [loadError]);

  const items = data?.milestones ?? emptyArray<Milestone>();
  const papers = data?.papers ?? emptyArray<Paper>();
  const experiments = data?.experiments ?? emptyArray<Experiment>();
  const pinnedSharedBy = data?.pinnedSharedBy ?? emptyMap<string, string>();
  const milestoneCanComment = data?.milestoneCanComment ?? emptyMap<string, boolean>();
  const ownerNames = data?.ownerNames ?? emptyMap<string, string>();

  useEffect(() => {
    if (!focusFromUrl) {
      appliedFocus.current = null;
      return;
    }
    if (appliedFocus.current === focusFromUrl) return;
    const focused = items.find((m) => m.id === focusFromUrl);
    if (focused) {
      appliedFocus.current = focusFromUrl;
      if (focused.status === "done") setShowDone(true);
      requestAnimationFrame(() => {
        document.getElementById(`milestone-${focusFromUrl}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
      return;
    }
    if (isSharedView || pinnedSharedBy.has(focusFromUrl)) {
      void getContainer()
        .plan.getMilestone(focusFromUrl)
        .then((m) => {
          if (!m) return;
          appliedFocus.current = focusFromUrl;
          setData((prev) =>
            prev && !prev.milestones.some((x) => x.id === m.id)
              ? { ...prev, milestones: [...prev.milestones, m] }
              : prev,
          );
          requestAnimationFrame(() => {
            document.getElementById(`milestone-${focusFromUrl}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
          });
        })
        .catch((err: unknown) => {
          logToApp({ level: "warn", source: "plan", message: "Could not load the linked milestone", detail: formatError(err) });
        });
    }
  }, [focusFromUrl, items, isSharedView, pinnedSharedBy, setData]);

  const { isReadOnly: isReadOnlyMilestone, sharedOwnerName, isPinned: isPinnedMilestone } = usePinnedSharing({ isSharedView, pinnedSharedBy, ownerNames });

  const replace = useCallback(
    (m: Milestone) => {
      setData((prev) =>
        prev
          ? { ...prev, milestones: prev.milestones.map((x) => (x.id === m.id ? m : x)) }
          : prev,
      );
    },
    [setData],
  );

  // Resolve dependency refIds to display labels.
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    for (const p of papers) map.set(p.id, p.title);
    for (const e of experiments) map.set(e.id, e.name);
    for (const m of items) map.set(m.id, m.title);
    return map;
  }, [papers, experiments, items]);

  const progressItems = useMemo(
    () => items.filter((m) => !pinnedSharedBy.has(m.id)),
    [items, pinnedSharedBy],
  );
  const done = progressItems.filter((m) => m.status === "done").length;
  const pct = progressItems.length ? Math.round((done / progressItems.length) * 100) : 0;
  const timeline = useMemo(() => planTimeline(progressItems), [progressItems]);

  // Open milestones by due date first; finished ones fold away so a long plan
  // stays about what is left.
  const match = useScreenSearch(search, "milestone");
  const ordered = useMemo(
    () => match([...items].sort(byDue), (m) => m.id, (m) => `${m.title} ${m.description ?? ""}`),
    [items, match],
  );
  const openItems = ordered.filter((m) => m.status !== "done");
  const doneItems = ordered.filter((m) => m.status === "done");
  const doneVisible = showDone || openItems.length === 0;

  const jumpTo = useCallback(
    (id: string) => {
      if (items.find((m) => m.id === id)?.status === "done") setShowDone(true);
      requestAnimationFrame(() => {
        const el = document.getElementById(`milestone-${id}`);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        el.classList.add("is-jumped");
        window.setTimeout(() => el.classList.remove("is-jumped"), 1400);
      });
    },
    [items],
  );

  if (loading) {
    return <ScreenLoading status="Loading plan…" />;
  }

  function renderCard(m: Milestone) {
    return (
      <MilestoneCard
        key={m.id}
        milestone={m}
        labels={labels}
        papers={papers}
        experiments={experiments}
        milestones={items}
        readOnly={isReadOnlyMilestone(m.id)}
        isPinned={isPinnedMilestone(m.id)}
        sharedByName={sharedOwnerName(m.id)}
        canComment={milestoneCanComment.get(m.id) ?? false}
        onReplace={replace}
        onChanged={load}
        onError={setError}
        onJump={jumpTo}
      />
    );
  }

  return (
    <section className="screen plan-screen">
      <ScreenHead
        eyebrow={planEyebrow(progressItems.length, done)}
        search={items.length > 0 ? { value: search, onChange: setSearch, label: "Search milestones" } : undefined}
      >
        {/*
         * The header offers the two actions the spec names (ui-spec §3.8), and
         * "New milestone" opens the form itself.
         *
         * It used to open a "Plan actions" chooser first, whose entire contents
         * were one or two bordered choice cards — so a button labelled "New
         * milestone" produced a modal holding nothing but an outlined box, with
         * the form one click further on. The chooser existed to carry the
         * blanket "Share plan" action, which belongs in the header beside it.
         */}
        {progressItems.length > 0 && (
          <ShareButton
            resourceType="milestone"
            resourceId={null}
            title="Share your whole plan"
            label="Share plan"
            showLabel
          />
        )}
        <Button
          variant="primary"
         
          onClick={() => setComposeOpen(true)}
        >
          New milestone
        </Button>
      </ScreenHead>

      {composeOpen && (
        <Modal title="New milestone" onClose={() => setComposeOpen(false)}>
          <MilestoneForm
            papers={papers}
            experiments={experiments}
            milestones={items}
            onSaved={() => {
              setComposeOpen(false);
              void load();
            }}
          />
        </Modal>
      )}

      {progressItems.length > 0 && (
        <div className="card progress-card">
          <div className="progress-top">
            <span>{done} of {progressItems.length} milestones done</span>
            {timeline ? <small className="plan-pace">{planPace(progressItems)}</small> : <strong>{pct}%</strong>}
          </div>
          {timeline ? (
            <PlanTimelineBar timeline={timeline} pct={pct} onJump={jumpTo} />
          ) : (
            <div
              className="progress-bar"
              role="progressbar"
              aria-label="Plan progress"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: `${pct}%` }} />
            </div>
          )}
        </div>
      )}

      {error && <FormError>{error}</FormError>}
      {!error && items.length === 0 && (
        <EmptyState
          variant="first-run"
          icon={<NavIcon name="flag" />}
          title="No milestones yet"
          body="A milestone is a date you are steering by — a submission, a review, a chapter handed over. Sketch the road ahead and the plan screen starts counting towards it."
          action={
            <Button
              variant="primary"
              onClick={() => setComposeOpen(true)}
            >
              New milestone
            </Button>
          }
        />
      )}

      {items.length > 0 && ordered.length === 0 && (
        <EmptyState
          variant="no-results"
          body="No milestones match."
          action={<ClearFiltersButton onClear={() => setSearch("")} />}
        />
      )}
      <ul className="exp-list plan-list">{openItems.map(renderCard)}</ul>
      {doneItems.length > 0 && openItems.length > 0 && (
        <span className="plan-done-toggle">
          <FoldButton expanded={doneVisible} onClick={() => setShowDone((v) => !v)}>
            {doneVisible ? "Hide" : "Show"} {doneItems.length} done
          </FoldButton>
        </span>
      )}
      {doneVisible && doneItems.length > 0 && (
        <ul className="exp-list plan-list">{doneItems.map(renderCard)}</ul>
      )}
    </section>
  );
}

/** Dated milestones soonest first, undated ones after. */
function byDue(a: Milestone, b: Milestone): number {
  if (a.targetDate && b.targetDate) return a.targetDate.localeCompare(b.targetDate);
  return a.targetDate ? -1 : b.targetDate ? 1 : 0;
}

/** "3 milestones · 1 done" above the title. */
function planEyebrow(total: number, done: number): string | undefined {
  if (!total) return undefined;
  return `${total} ${total === 1 ? "milestone" : "milestones"} · ${done} done`;
}

