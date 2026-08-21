"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  DEPENDENCY_KINDS, MILESTONE_STATUSES, type ComputeNeed, type DependencyKind, type Experiment, type Milestone, type MilestoneDependency, type MilestoneStatus, type Paper } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { Modal } from "@/components/modal";
import { ScreenLoading } from "@/components/screen-loading";
import { Select } from "@/components/select";
import { EntityCard } from "@/components/entity-card";
import { EditIcon } from "@/components/view-icons";
import { ShareButton, CommentsToggle, PinnedPaperBadge, usePinnedOwnerNames } from "@/features/sharing";
import { useScreenData } from "@/lib/hooks/use-screen-data";
import { emptyArray, emptyMap } from "@/lib/empty";
import { usePinnedSharing } from "@/lib/hooks/use-pinned-sharing";
import type { PlanScreenData } from "@/features/plan/application/load-plan-screen.use-case";
import { formatError } from "@/lib/format-error";

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
  const [composeMode, setComposeMode] = useState<"menu" | "new">("menu");
  const [shareOpen, setShareOpen] = useState(false);

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

  const items = data?.milestones ?? emptyArray<import("@weaveforge/core").Milestone>();
  const papers = data?.papers ?? emptyArray<import("@weaveforge/core").Paper>();
  const experiments = data?.experiments ?? emptyArray<import("@weaveforge/core").Experiment>();
  const pinnedSharedBy = data?.pinnedSharedBy ?? emptyMap<string, string>();
  const milestoneCanComment = data?.milestoneCanComment ?? emptyMap<string, boolean>();
  const ownerNames = data?.ownerNames ?? emptyMap<string, string>();

  useEffect(() => {
    if (!focusFromUrl) {
      appliedFocus.current = null;
      return;
    }
    if (appliedFocus.current === focusFromUrl) return;
    if (items.some((m) => m.id === focusFromUrl)) {
      appliedFocus.current = focusFromUrl;
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

  const { isReadOnly: isReadOnlyMilestone, sharedOwnerName } = usePinnedSharing({ isSharedView, pinnedSharedBy, ownerNames });


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

  if (loading) {
    return <ScreenLoading status="Loading plan…" />;
  }

  return (
    <section className="screen">
      <header className="screen-head">
        <div className="head-row">
          <div className="screen-actions">
            <button
              className="btn-primary"
              type="button"
              onClick={() => { setComposeMode("menu"); setComposeOpen(true); }}
            >
              + Milestone
            </button>
          </div>
        </div>
      </header>

      {composeOpen && (
        <Modal
          title={composeMode === "new" ? "Add a milestone" : "Plan actions"}
          onClose={() => { setComposeOpen(false); setComposeMode("menu"); }}
        >
          {composeMode === "menu" ? (
            <div className="org-modal-choices">
              <button
                type="button"
                className="org-choice-card"
                onClick={() => setComposeMode("new")}
              >
                <span className="org-choice-title">Add milestone</span>
                <p className="org-choice-desc">Sketch the next goal on your roadmap.</p>
              </button>
              {progressItems.length > 0 && (
                <button
                  type="button"
                  className="org-choice-card"
                  onClick={() => {
                    setComposeOpen(false);
                    setComposeMode("menu");
                    setShareOpen(true);
                  }}
                >
                  <span className="org-choice-title">Share plan</span>
                  <p className="org-choice-desc">Share every milestone in this project.</p>
                </button>
              )}
            </div>
          ) : (
            <MilestoneForm
              papers={papers}
              experiments={experiments}
              milestones={items}
              onSaved={() => {
                setComposeOpen(false);
                setComposeMode("menu");
                void load();
              }}
            />
          )}
        </Modal>
      )}

      {progressItems.length > 0 && (
        <ShareButton
          resourceType="milestone"
          resourceId={null}
          title="Share your whole plan"
          label="⇅ share plan"
          hideTrigger
          open={shareOpen}
          onOpenChange={setShareOpen}
        />
      )}

      {progressItems.length > 0 && (
        <div className="card progress-card">
          <div className="progress-top">
            <span>{done} / {progressItems.length} milestones done</span>
            <strong>{pct}%</strong>
          </div>
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
        </div>
      )}

      {error && <p className="error">{error}</p>}
      {!error && items.length === 0 && (
        <div className="empty">
          <p>No milestones yet. Use “+ Milestone” to sketch the road ahead.</p>
        </div>
      )}

      <ul className="exp-list">
        {items.map((m) => (
          <MilestoneCard
            key={m.id}
            milestone={m}
            labels={labels}
            papers={papers}
            experiments={experiments}
            milestones={items}
            readOnly={isReadOnlyMilestone(m.id)}
            sharedByName={sharedOwnerName(m.id)}
            canComment={milestoneCanComment.get(m.id) ?? false}
            onReplace={replace}
            onChanged={load}
          />
        ))}
      </ul>
    </section>
  );
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
  sharedByName,
  canComment = false,
  onReplace,
  onChanged,
}: {
  milestone: Milestone;
  labels: Map<string, string>;
  papers: Paper[];
  experiments: Experiment[];
  milestones: Milestone[];
  readOnly?: boolean;
  sharedByName?: string;
  canComment?: boolean;
  onReplace: (m: Milestone) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  async function setStatus(status: MilestoneStatus) {
    const updated = await getContainer().plan.manageMilestone.setStatus(m.id, status);
    onReplace(updated);
    try { await getContainer().plan.notifyMilestone("status", updated); } catch { /* best-effort */ }
  }

  async function remove() {
    if (!confirm(`Delete milestone "${m.title}"?`)) return;
    setBusy(true);
    try {
      await getContainer().plan.manageMilestone.remove(m.id);
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
    <EntityCard
      as="li"
      id={`milestone-${m.id}`}
      className="exp-item"
      title={m.title}
      status={
        readOnly ? (
          <PinnedPaperBadge ownerName={sharedByName} />
        ) : (
          <Select
            className="status-select"
            value={m.status}
            onChange={(e) => void setStatus(e.target.value as MilestoneStatus)}
            aria-label="Milestone status"
          >
            {MILESTONE_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </Select>
        )
      }
      meta={
        m.targetDate
          ? [
              `due ${m.targetDate}`,
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
      onDelete={readOnly ? undefined : () => void remove()}
      deleteDisabled={busy}
      deleteAriaLabel="Delete milestone"
      actions={
        <>
          {!readOnly && (
            <ShareButton resourceType="milestone" resourceId={m.id} title={`Share: ${m.title}`} />
          )}
          <CommentsToggle
            resourceType="milestone"
            resourceId={m.id}
            canComment={readOnly ? canComment : true}
          />
          {!readOnly && (
            <button
              type="button"
              className="entity-icon-btn"
              onClick={() => setEditing(true)}
              aria-label="Edit milestone"
              title="Edit"
            >
              <EditIcon />
            </button>
          )}
        </>
      }
    >
      {m.description && <p className="summary">{m.description}</p>}
      {m.dependencies.length > 0 && (
        <div className="git-chips">
          {m.dependencies.map((d, i) => (
            <span key={i} className="git-chip">
              <em>{d.kind}</em>{" "}
              {d.kind === "external" ? d.label : labels.get(d.refId ?? "") ?? d.label ?? d.refId}
            </span>
          ))}
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
  );
}

/* ---------------------------------------------------------------- form ---- */

interface DepDraft { kind: DependencyKind; refId: string; label: string }
interface ComputeDraft { resource: string; count: string; hours: string; notes: string }

function MilestoneForm({
  initial,
  papers,
  experiments,
  milestones,
  onSaved,
  onCancel,
}: {
  initial?: Milestone;
  papers: Paper[];
  experiments: Experiment[];
  milestones: Milestone[];
  onSaved: () => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [targetDate, setTargetDate] = useState(initial?.targetDate ?? "");
  const [status, setStatus] = useState<MilestoneStatus>(initial?.status ?? "planned");
  const [deps, setDeps] = useState<DepDraft[]>(
    (initial?.dependencies ?? []).map((d) => ({
      kind: d.kind,
      refId: d.refId ?? "",
      label: d.label ?? "",
    })),
  );
  const [compute, setCompute] = useState<ComputeDraft[]>(
    (initial?.compute ?? []).map((c) => ({
      resource: c.resource,
      count: c.count != null ? String(c.count) : "",
      hours: c.hours != null ? String(c.hours) : "",
      notes: c.notes ?? "",
    })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refOptions: Record<Exclude<DependencyKind, "external">, { id: string; label: string }[]> = {
    milestone: milestones
      .filter((m) => m.id !== initial?.id)
      .map((m) => ({ id: m.id, label: m.title })),
    experiment: experiments.map((e) => ({ id: e.id, label: e.name })),
    paper: papers.map((p) => ({ id: p.id, label: p.title })),
  };

  function patchDep(i: number, patch: Partial<DepDraft>) {
    setDeps((prev) => prev.map((d, k) => (k === i ? { ...d, ...patch } : d)));
  }
  function patchCompute(i: number, patch: Partial<ComputeDraft>) {
    setCompute((prev) => prev.map((c, k) => (k === i ? { ...c, ...patch } : c)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const dependencies: MilestoneDependency[] = deps.map((d) =>
        d.kind === "external"
          ? { kind: d.kind, label: d.label.trim() }
          : { kind: d.kind, refId: d.refId, label: d.label || undefined },
      );
      const computeNeeds: ComputeNeed[] = compute.map((c) => ({
        resource: c.resource.trim(),
        count: c.count.trim() ? Number(c.count) : undefined,
        hours: c.hours.trim() ? Number(c.hours) : undefined,
        notes: c.notes.trim() || undefined,
      }));
      const plan = getContainer().plan;
      const { manageMilestone } = plan;
      if (initial) {
        await manageMilestone.update(initial.id, {
          title,
          description: description.trim() || undefined,
          status,
          targetDate,
          dependencies,
          compute: computeNeeds,
        });
      } else {
        const added = await manageMilestone.add({
          title,
          description: description.trim() || undefined,
          status,
          targetDate: targetDate || undefined,
          dependencies,
          compute: computeNeeds,
        });
        try { await plan.notifyMilestone("added", added); } catch { /* best-effort */ }
        setTitle("");
        setDescription("");
        setTargetDate("");
        setStatus("planned");
        setDeps([]);
        setCompute([]);
      }
      await onSaved();
    } catch (err) {
      setError(formatError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={initial ? "add-form" : "card add-form"} onSubmit={submit}>
      <div className="field">
        <label htmlFor={`mtitle-${initial?.id ?? "new"}`}>Milestone</label>
        <input
          id={`mtitle-${initial?.id ?? "new"}`}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Ablation study finished"
          required
        />
      </div>
      <div className="field">
        <label htmlFor={`mdesc-${initial?.id ?? "new"}`}>Details</label>
        <textarea
          id={`mdesc-${initial?.id ?? "new"}`}
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What does done look like?"
        />
      </div>
      <div className="field-row-equal">
        <div className="field">
          <label htmlFor={`mdate-${initial?.id ?? "new"}`}>Target date</label>
          <input
            id={`mdate-${initial?.id ?? "new"}`}
            type="date"
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`mstatus-${initial?.id ?? "new"}`}>Status</label>
          <Select
            id={`mstatus-${initial?.id ?? "new"}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as MilestoneStatus)}
          >
            {MILESTONE_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="field">
        <label>Dependencies</label>
        {deps.map((d, i) => (
          <div key={i} className="builder-row">
            <Select
              value={d.kind}
              onChange={(e) => patchDep(i, { kind: e.target.value as DependencyKind, refId: "" })}
              aria-label="Dependency kind"
            >
              {DEPENDENCY_KINDS.map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </Select>
            {d.kind === "external" ? (
              <input
                value={d.label}
                onChange={(e) => patchDep(i, { label: e.target.value })}
                placeholder="dataset access, cluster account…"
                required
              />
            ) : (
              <Select
                value={d.refId}
                onChange={(e) => patchDep(i, { refId: e.target.value })}
                aria-label={`${d.kind} reference`}
              >
                <option value="">pick…</option>
                {refOptions[d.kind].map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </Select>
            )}
            <button
              type="button"
              className="link-btn danger"
              onClick={() => setDeps((prev) => prev.filter((_, k) => k !== i))}
              aria-label="Remove dependency"
            >
              remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="link-btn builder-add"
          onClick={() => setDeps((prev) => [...prev, { kind: "external", refId: "", label: "" }])}
        >
          + add dependency
        </button>
      </div>

      <div className="field">
        <label>Compute needed</label>
        {compute.map((c, i) => (
          <div key={i} className="builder-row compute-row">
            <input
              value={c.resource}
              onChange={(e) => patchCompute(i, { resource: e.target.value })}
              placeholder="A100"
              required
            />
            <input
              type="number"
              min="1"
              value={c.count}
              onChange={(e) => patchCompute(i, { count: e.target.value })}
              placeholder="count"
              aria-label="Count"
            />
            <input
              type="number"
              min="0"
              value={c.hours}
              onChange={(e) => patchCompute(i, { hours: e.target.value })}
              placeholder="hours"
              aria-label="Hours"
            />
            <input
              value={c.notes}
              onChange={(e) => patchCompute(i, { notes: e.target.value })}
              placeholder="notes"
              aria-label="Notes"
            />
            <button
              type="button"
              className="link-btn danger"
              onClick={() => setCompute((prev) => prev.filter((_, k) => k !== i))}
              aria-label="Remove compute need"
            >
              remove
            </button>
          </div>
        ))}
        <button
          type="button"
          className="link-btn builder-add"
          onClick={() =>
            setCompute((prev) => [...prev, { resource: "", count: "", hours: "", notes: "" }])
          }
        >
          + add compute
        </button>
      </div>

      {error && <p className="error">{error}</p>}
      <div className={onCancel ? "card-foot edit-actions" : "card-foot form-foot"}>
        {onCancel && (
          <button type="button" className="link-btn" onClick={onCancel} disabled={busy}>
            cancel
          </button>
        )}
        <button className="btn-primary" disabled={busy}>
          {busy ? "Saving…" : initial ? "Save" : "Add milestone"}
        </button>
      </div>
    </form>
  );
}
