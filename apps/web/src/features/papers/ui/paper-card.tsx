"use client";

import { useState } from "react";
import { isPlaceholderTitle, titleFromFileName, type Paper, type PaperStatus, type PaperSummary } from "@weaveforge/core";
import { getContainer } from "@/bootstrap";
import { confirmRemovePaper } from "./remove-paper";
import { EntityCard } from "@/components/entity-card";
import { CardMenu } from "@/components/card-menu";
import { PaperCardThumbs } from "@/components/card-thumbs";
import { cardSnippet } from "@/lib/card-snippet";
import { ShareButton, PinnedPaperBadge } from "@/features/sharing";
import { ListPicker } from "@/features/reading-lists";
import { PaperStatusControl } from "./paper-status";

/** Compact paper card in the grid; clicking opens the full note page. */
export function PaperCard({
  paper,
  readOnly = false,
  sharedByName,
  onOpen,
  onReplace,
  onChanged,
}: {
  /**
   * The summary projection, which is what the list holds. Everything the card
   * paints — title, authors, year, status, tags, note snippet — is on it. The
   * two things that are not (`metadata` for thumbnails, and the row the delete
   * needs) are resolved where they are used: `PaperCardThumbs` guards on the
   * property, and `confirmRemovePaper` re-reads the full row.
   */
  paper: PaperSummary | Paper;
  readOnly?: boolean;
  sharedByName?: string;
  onOpen: () => void;
  onReplace: (p: Paper) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  // Held here rather than inside the menu: the menu closes the moment an item is
  // picked, and the dialog it opened has to outlive that.
  const [shareOpen, setShareOpen] = useState(false);

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
    // A page name ("Catalog Page", "PDF Full Text") is not the paper's title;
    // saying so beats letting it pass for one. Opening the paper lets it be fixed.
    isPlaceholderTitle(paper.title) ? "Title not found — open to set it" : null,
    authorsLine || null,
    paper.year != null ? String(paper.year) : null,
  ].filter(Boolean) as string[];

  const snippet = cardSnippet(paper.summary ?? "");

  return (
    <>
      <EntityCard
        className="paper-card"
        onActivate={onOpen}
        // Rows imported before titles were cleaned still carry the filename.
        title={titleFromFileName(paper.title)}
        status={
          readOnly ? (
            <PinnedPaperBadge ownerName={sharedByName} />
          ) : (
            <PaperStatusControl status={paper.status} disabled={busy} onChange={(s) => void changeStatus(s)} />
          )
        }
        meta={metaBits.length > 0 ? metaBits.join(" · ") : undefined}
        tags={paper.tags}
        // Status stays on the card — it is the one control worth a tap, and the
        // reason the cards are scanned. Share, filing and delete are occasional
        // and move behind the kebab; the card body opens the paper.
        menu={
          readOnly ? undefined : (
            <CardMenu
              items={[
                { id: "share", label: "Share", onSelect: () => setShareOpen(true) },
                { id: "list", label: "Add to list", onSelect: () => {}, submenu: () => <ListPicker target={{ kind: "paper", id: paper.id }} /> },
                { id: "delete", label: "Delete", danger: true, disabled: busy, onSelect: () => void remove() },
              ]}
            />
          )
        }
      >
        <div className="card-body-row">
          {snippet ? <p className="entity-card-snippet">{snippet}</p> : null}
          <PaperCardThumbs paper={paper} />
        </div>
      </EntityCard>
      {/* Mounted above the card: the shell's dialog host renders the share sheet,
          and the list picker has to survive the refresh the card's own change
          event triggers. */}
      <ShareButton
        hideTrigger
        resourceType="paper"
        resourceId={paper.id}
        title={`Share: ${paper.title}`}
        open={shareOpen}
        onOpenChange={setShareOpen}
      />
    </>
  );
}
