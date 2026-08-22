"use client";

import { useState } from "react";
import { PAPER_STATUSES, type Paper, type PaperStatus } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { confirmRemovePaper } from "./remove-paper";
import { EntityCard } from "@/components/entity-card";
import { PaperCardThumbs } from "@/components/card-thumbs";
import { cardSnippet } from "@/lib/card-snippet";
import { ShareButton, PinnedPaperBadge } from "@/features/sharing";
import { Select } from "@/components/select";

/** Compact paper card in the grid; clicking opens the full note page. */
export function PaperCard({
  paper,
  readOnly = false,
  sharedByName,
  onOpen,
  onReplace,
  onChanged,
}: {
  paper: Paper;
  readOnly?: boolean;
  sharedByName?: string;
  onOpen: () => void;
  onReplace: (p: Paper) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function changeStatus(status: PaperStatus) {
    setBusy(true);
    try {
      onReplace(await getContainer().papers.updatePaper.setStatus(paper.id, status));
    } finally {
      setBusy(false);
    }
  }

  const remove = () => confirmRemovePaper(paper, setBusy, onChanged);

  const authorsLine =
    paper.authors.length > 0
      ? `${paper.authors.slice(0, 3).join(", ")}${paper.authors.length > 3 ? " et al." : ""}`
      : "";

  const metaBits = [
    authorsLine || null,
    paper.year != null ? String(paper.year) : null,
  ].filter(Boolean) as string[];

  const snippet = cardSnippet(paper.summary ?? "");

  return (
    <EntityCard
      className="paper-card"
      onActivate={onOpen}
      title={paper.title}
      status={
        readOnly ? (
          <PinnedPaperBadge ownerName={sharedByName} />
        ) : (
          <Select
            className="status-select"
            value={paper.status}
            disabled={busy}
            onChange={(e) => void changeStatus(e.target.value as PaperStatus)}
            aria-label="Reading status"
          >
            {PAPER_STATUSES.map((s) => (
              <option key={s} value={s}>{s.replace("_", " ")}</option>
            ))}
          </Select>
        )
      }
      meta={metaBits.length > 0 ? metaBits.join(" · ") : undefined}
      tags={paper.tags}
      onDelete={readOnly ? undefined : () => void remove()}
      deleteDisabled={busy}
      deleteAriaLabel="Delete paper"
      actions={
        !readOnly ? (
          <ShareButton resourceType="paper" resourceId={paper.id} title={`Share: ${paper.title}`} />
        ) : undefined
      }
      onOpen={onOpen}
      openLabel="Open note"
    >
      <div className="card-body-row">
        {snippet ? <p className="entity-card-snippet">{snippet}</p> : null}
        <PaperCardThumbs paper={paper} />
      </div>
    </EntityCard>
  );
}
