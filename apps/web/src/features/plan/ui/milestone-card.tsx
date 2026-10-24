"use client";

import { useState, type MouseEvent } from "react";
import Link from "next/link";
import {
  MILESTONE_STATUSES,
  type Experiment,
  type Milestone,
  type MilestoneStatus,
  type Paper,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { EntityCard } from "@/components/entity-card";
import { EntityCardMenu } from "@/components/entity-card-menu";
import { CommentsToggle, PinnedPaperBadge } from "@/features/sharing";
import { daysUntilDate } from "@/features/plan/application/plan-timeline";
import { logToApp } from "@/lib/error-report/app-log";
import { formatError } from "@/lib/format-error";
import { runReported } from "@/lib/run-reported";
import { StatusSelect } from "@/components/status-select";
import { MilestoneForm } from "./milestone-form";
import { planChipTarget } from "./plan-chip";

export function MilestoneCard({
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
  onError,
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
  onError: (message: string) => void;
  onJump?: (id: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  /** Whether the delete confirmation is up. */
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmUnpinOpen, setConfirmUnpinOpen] = useState(false);

  async function setStatus(status: MilestoneStatus) {
    await runReported(async () => {
      const updated = await getContainer().plan.manageMilestone.setStatus(m.id, status);
      onReplace(updated);
      try {
        await getContainer().plan.notifyMilestone("status", updated);
      } catch (err) {
        logToApp({ level: "warn", source: "plan", message: "Milestone notification failed", detail: formatError(err) });
      }
    }, onError);
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

  const due = m.targetDate ? daysUntilDate(m.targetDate) : null;

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
        <div className="plan-chips">
          {m.dependencies.map((d, i) => {
            const labelText = d.kind === "external" ? d.label : labels.get(d.refId ?? "") ?? d.label ?? d.refId;
            const target = planChipTarget(d, labels, milestones);
            const body = <><em>{d.kind}</em> {labelText}</>;
            const cls = `plan-chip${d.kind === "external" ? " is-ext" : ""}`;
            if (target.kind === "jump" && onJump) {
              return (
                <button
                  key={i}
                  type="button"
                  className={`${cls} link`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onJump(target.milestoneId);
                  }}
                  title={`Jump to ${labelText}`}
                >
                  {body}
                </button>
              );
            }
            if (target.kind === "link") {
              const stop = (e: MouseEvent) => e.stopPropagation();
              return target.external ? (
                <a key={i} className={`${cls} link`} href={target.href} target="_blank" rel="noreferrer" onClick={stop} title={target.href}>
                  {body}
                </a>
              ) : (
                <Link key={i} className={`${cls} link`} href={target.href} onClick={stop} title={`Open ${labelText}`}>
                  {body}
                </Link>
              );
            }
            return (
              <span
                key={i}
                className={`${cls}${target.kind === "missing" ? " is-missing" : ""}`}
                title={target.kind === "missing" ? `${labelText} was deleted` : undefined}
              >
                {body}
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
