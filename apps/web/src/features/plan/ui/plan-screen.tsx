"use client";

import { DatePicker } from "@/components/date-picker";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  MILESTONE_STATUSES,
  type Experiment,
  type Milestone,
  type MilestoneStatus,
  type Paper,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { EntityCard } from "@/components/entity-card";
import { EntityCardMenu } from "@/components/entity-card-menu";
import { ClearFiltersButton, EmptyState } from "@/components/empty-state";
import { useScreenSearch } from "@/lib/hooks/use-screen-search";
import { NavIcon } from "@/app/nav-icon";
import { ShareButton, CommentsToggle, PinnedPaperBadge, usePinnedOwnerNames } from "@/features/sharing";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray, emptyMap } from "@/lib/empty";
import { usePinnedSharing } from "@/lib/hooks/use-pinned-sharing";
import type { PlanScreenData } from "@/features/plan/application/load-plan-screen.use-case";
import { ScreenHead } from "@/components/screen-head";
import { FormError } from "@/components/form-error";
import { planPace, planTimeline } from "@/features/plan/application/plan-timeline";
import { PlanTimelineBar } from "@/features/plan/ui/plan-timeline-bar";
import { StatusSelect } from "@/components/status-select";
import { MilestoneForm } from "./milestone-form";

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
            label="⇅ Share plan"
            showLabel
          />
        )}
        <button
          className="btn-primary"
          type="button"
          onClick={() => setComposeOpen(true)}
        >
          New milestone
        </button>
      </ScreenHead>

      {composeOpen && (
        <Modal title="Add a milestone" onClose={() => setComposeOpen(false)}>
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
            <button
              type="button"
              className="btn-primary"
              onClick={() => setComposeOpen(true)}
            >
              New milestone
            </button>
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
        <button
          type="button"
          className="btn-ghost plan-done-toggle"
          aria-expanded={doneVisible}
          onClick={() => setShowDone((v) => !v)}
        >
          {doneVisible ? "Hide" : "Show"} {doneItems.length} done
        </button>
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

function daysUntil(date: string): number {
  const target = new Date(`${date}T00:00:00`);
  return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
}

function MilestoneCard({
  milestone: m,
  labels,
  papers,
  experiments,
  milestones,
  readOnly = false,
  isPinned = false,
  sharedByName,
  canComment = false,
  onReplace,
  onChanged,
  onJump,
}: {
  milestone: Milestone;
  labels: Map<string, string>;
  papers: Paper[];
  experiments: Experiment[];
  milestones: Milestone[];
  readOnly?: boolean;
  isPinned?: boolean;
  sharedByName?: string;
  canComment?: boolean;
  onReplace: (m: Milestone) => void;
  onChanged: () => void;
  onJump?: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  /** Whether the delete confirmation is up. */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmUnpinOpen, setConfirmUnpinOpen] = useState(false);

  async function setStatus(status: MilestoneStatus) {
    const updated = await getContainer().plan.manageMilestone.setStatus(m.id, status);
    onReplace(updated);
    try { await getContainer().plan.notifyMilestone("status", updated); } catch { /* best-effort */ }
  }

  async function remove() {
    setConfirmOpen(false);
    setBusy(true);
    try {
      await getContainer().plan.manageMilestone.remove(m.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function unpin() {
    setConfirmUnpinOpen(false);
    setBusy(true);
    try {
      await getContainer().sharing.unpinShared("milestone", m.id);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (editing && !readOnly) {
    return (
      <li className="card exp-item">
        <MilestoneForm
          initial={m}
          papers={papers}
          experiments={experiments}
          milestones={milestones}
          onCancel={() => setEditing(false)}
          onSaved={async () => {
            setEditing(false);
            await onChanged();
          }}
        />
      </li>
    );
  }

  const due = m.targetDate ? daysUntil(m.targetDate) : null;

  return (
    <>
    <EntityCard
      as="li"
      id={`milestone-${m.id}`}
      className="exp-item milestone-item"
      tone={m.status}
      title={m.title}
      leading={
        <input
          type="checkbox"
          className="themed-check milestone-check"
          checked={m.status === "done"}
          disabled={readOnly}
          onChange={(e) => void setStatus(e.target.checked ? "done" : "planned")}
          aria-label={m.status === "done" ? `Reopen ${m.title}` : `Mark ${m.title} done`}
        />
      }
      badge={readOnly ? <PinnedPaperBadge ownerName={sharedByName} /> : undefined}
      status={
        <StatusSelect
          value={m.status}
          statuses={MILESTONE_STATUSES}
          disabled={readOnly}
          onChange={(st) => void setStatus(st)}
          label="Milestone status"
        />
      }
      meta={
        m.targetDate
            ? [
              `Due ${m.targetDate}`,
              due != null && m.status !== "done"
                ? due < 0
                  ? `${-due}d overdue`
                  : `in ${due}d`
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
          : undefined
      }
      menu={
        <EntityCardMenu
          resourceType="milestone"
          resourceId={m.id}
          title={`Share: ${m.title}`}
          onDelete={isPinned ? () => setConfirmUnpinOpen(true) : readOnly ? undefined : () => setConfirmOpen(true)}
          deleteLabel={isPinned ? "Remove from plan" : "Delete milestone"}
          deleteDisabled={busy}
          extraItems={readOnly ? [] : [{ id: "edit", label: "Edit", onSelect: () => setEditing(true) }]}
        />
      }
      actions={
        <CommentsToggle
          resourceType="milestone"
          resourceId={m.id}
          canComment={readOnly ? canComment : true}
          isOwner={!readOnly}
        />
      }
    >
      {m.description && <p className="summary">{m.description}</p>}
      {m.dependencies.length > 0 && (
        <div className="git-chips">
          {m.dependencies.map((d, i) => {
            const labelText = d.kind === "external" ? d.label : labels.get(d.refId ?? "") ?? d.label ?? d.refId;
            const targetMilestoneId = d.kind === "milestone" ? (d.refId || milestones.find((x) => x.title === d.label)?.id) : undefined;
            if (targetMilestoneId && onJump) {
              return (
                <button
                  key={i}
                  type="button"
                  className="git-chip link"
                  onClick={(e) => {
                    e.stopPropagation();
                    onJump(targetMilestoneId);
                  }}
                  title={`Jump to ${labelText}`}
                >
                  <em>{d.kind}</em> {labelText}
                </button>
              );
            }
            return (
              <span key={i} className="git-chip">
                <em>{d.kind}</em> {labelText}
              </span>
            );
          })}
        </div>
      )}
      {m.compute.length > 0 && (
        <div className="metric-chips">
          {m.compute.map((c, i) => (
            <span key={i} className="metric-chip">
              <em>{c.resource}</em>
              {[c.count != null ? `×${c.count}` : null, c.hours != null ? `~${c.hours}h` : null]
                .filter(Boolean)
                .join(" ")}
              {c.notes ? ` — ${c.notes}` : ""}
            </span>
          ))}
        </div>
      )}
    </EntityCard>

    {confirmOpen && (
      <ConfirmDialog
        title="Delete this milestone?"
        body={`“${m.title}” comes off the plan, and anything that points at it loses its target.`}
        confirmLabel="Delete milestone"
        danger
        busy={busy}
        onConfirm={() => void remove()}
        onClose={() => setConfirmOpen(false)}
      />
    )}

    {confirmUnpinOpen && (
      <ConfirmDialog
        title="Remove shared milestone?"
        body={`“${m.title}” will be removed from your plan. The original will stay intact for ${sharedByName ?? "its owner"}.`}
        confirmLabel="Remove from plan"
        danger
        busy={busy}
        onConfirm={() => void unpin()}
        onClose={() => setConfirmUnpinOpen(false)}
      />
    )}
    </>
  );
}



/** "3 milestones · 1 done" above the title. */
function planEyebrow(total: number, done: number): string | undefined {
  if (!total) return undefined;
  return `${total} ${total === 1 ? "milestone" : "milestones"} · ${done} done`;
}

