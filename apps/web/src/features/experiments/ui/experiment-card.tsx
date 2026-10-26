"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import {
  EXPERIMENT_STATUSES,
  type Experiment,
  type ExperimentStatus,
} from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { deletedMessage, removeLater, useHiddenKeys } from "@/lib/toast";
import { useNavPending } from "@/lib/nav-pending";
import { EntityCard } from "@/components/entity-card";
import { EntityCardMenu } from "@/components/entity-card-menu";
import { ExperimentCardThumbs } from "@/components/card-thumbs";
import { cardSnippet } from "@/lib/card-snippet";
import { PinnedPaperBadge } from "@/features/sharing";
import {
  ExpGitChips,
  ExpMetricChips,
} from "./experiment-panels";
import { experimentHref } from "../application/experiment-href";
import { StatusSelect } from "@/components/status-select";
import { FormError } from "@/components/form-error";
import { formatError } from "@/lib/format-error";

export function ExperimentCard({
  exp,
  readOnly = false,
  isPinned = false,
  sharedByName,
  onReplace,
  onChanged,
}: {
  exp: Experiment;
  readOnly?: boolean;
  isPinned?: boolean;
  sharedByName?: string;
  onReplace: (e: Experiment) => void;
  onChanged: () => void;
}) {
  const router = useRouter();
  const { beginNavigation } = useNavPending();
  const hidden = useHiddenKeys().has(experimentKey(exp.id));
  /** The last status change that failed, shown on the card. */
  const [actionError, setActionError] = useState<string | null>(null);
  const openDetail = useCallback(() => {
    const dest = experimentHref(exp.id);
    beginNavigation(dest);
    router.push(dest);
  }, [beginNavigation, router, exp.id]);
  async function setStatus(status: ExperimentStatus) {
    try {
      onReplace(await getContainer().experiments.manageExperiment.setStatus(exp.id, status));
      setActionError(null);
    } catch (err) {
      setActionError(formatError(err));
    }
  }
  // Rule D-07: the card goes at once; the delete runs when the Undo toast closes.
  function remove() {
    removeLater({
      key: experimentKey(exp.id),
      message: deletedMessage(exp.name),
      remove: () => getContainer().experiments.manageExperiment.remove(exp.id),
      onDeleted: onChanged,
    });
  }
  function unpin() {
    removeLater({
      key: experimentKey(exp.id),
      message: `"${exp.name}" removed from experiments`,
      remove: () => getContainer().sharing.unpinShared("experiment", exp.id),
      onDeleted: onChanged,
    });
  }
  if (hidden) return null;
  return (
    <>
    <EntityCard
      id={`exp-${exp.id}`}
      className="exp-item"
      tone={exp.status}
      onActivate={openDetail}
      title={exp.name}
      badge={readOnly ? <PinnedPaperBadge ownerName={sharedByName} /> : undefined}
      status={
        <StatusSelect
          value={exp.status}
          statuses={EXPERIMENT_STATUSES}
          disabled={readOnly}
          onChange={(st) => void setStatus(st)}
          label="Run status"
        />
      }
      meta={exp.hypothesis || undefined}
      // Same card shape as papers and notes: status stays on the card, the
      // occasional and destructive controls move behind one ⋯.
      menu={
        readOnly && !isPinned ? undefined : (
          <EntityCardMenu
            resourceType="experiment"
            resourceId={exp.id}
            title={`Share: ${exp.name}`}
            name={exp.name}
            deleteLabel={isPinned ? "Remove from experiments" : "Delete experiment"}
            onDelete={isPinned ? unpin : readOnly ? undefined : remove}
          />
        )
      }
    >
      <ExpGitChips exp={exp} limit={3} />
      <ExpMetricChips exp={exp} limit={3} />
      <div className="card-body-row">
        {exp.resultNote && <p className="entity-card-snippet">{cardSnippet(exp.resultNote)}</p>}
        <ExperimentCardThumbs artifacts={exp.artifacts} />
      </div>
      {actionError && <FormError>{actionError}</FormError>}
    </EntityCard>
    </>
  );
}

/** The key an experiment card hides under while its Undo toast shows. */
export const experimentKey = (id: string) => `experiment:${id}`;
