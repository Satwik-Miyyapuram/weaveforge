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
import { deletedMessage, removeLater, useHiddenKeys } from "@/lib/toast";
import { EntityCard } from "@/components/entity-card";
import { EntityCardMenu } from "@/components/entity-card-menu";
import { CommentsToggle, PinnedPaperBadge } from "@/features/sharing";
import { daysUntilDate } from "@/features/plan/application/plan-timeline";
import { formatDate } from "@/lib/format-date";
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
  const [editing, setEditing] = useState(false);
  const hidden = useHiddenKeys().has(milestoneKey(m.id));

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

  // Rule D-07: the card goes at once; the delete runs when the Undo toast closes.
  function remove() {
    removeLater({
      key: milestoneKey(m.id),
      message: deletedMessage(m.title),
      remove: () => getContainer().plan.manageMilestone.remove(m.id),
      onDeleted: () => void onChanged(),
    });
  }

  function unpin() {
    removeLater({
      key: milestoneKey(m.id),
      message: `"${m.title}" removed from your plan`,
      remove: () => getContainer().sharing.unpinShared("milestone", m.id),
      onDeleted: () => void onChanged(),
    });
  }

  if (hidden) return null;

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
              `Due ${formatDate(m.targetDate)}`,
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
          name={m.title}
          onDelete={isPinned ? unpin : readOnly ? undefined : remove}
          deleteLabel={isPinned ? "Remove from plan" : "Delete milestone"}
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
    </>
  );
}

/** The key a milestone card hides under while its Undo toast shows. */
export const milestoneKey = (id: string) => `milestone:${id}`;
