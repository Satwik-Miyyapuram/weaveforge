"use client";

import { useState } from "react";

import type { MarkActions } from "../application/mark-actions";
import { AnchoredBar, COMMENT_PATH, CommentField, Glyph, type SelectionAnchor } from "./selection-create-bar";
import { Swatch } from "@/components/controls";
import { Button, IconButton } from "@/components/button";

const DELETE_PATH = "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13";

interface MarkPopoverProps {
  at: SelectionAnchor;
  actions: MarkActions;
  colour: string;
  /** The palette's quick colours, so a mark is recoloured from the same five. */
  colours: readonly string[];
  onColour: (colour: string) => void;
  /** Saves the comment typed in the popover; empty removes it. */
  onComment: (comment: string) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** What a tapped mark offers: its kind, colour, Delete, then its comment. */
export function MarkPopover({ at, actions, colour, colours, onColour, onComment, onDelete, onClose }: MarkPopoverProps) {
  const [editing, setEditing] = useState(false);
  return (
    <AnchoredBar at={at} label="Annotation" className="pdf-reader-mark-bar">
      <div className="pdf-reader-pop-row">
        <div className="pdf-reader-pop-col">
          <span className="pdf-reader-pop-kind">{actions.kind}</span>
          {actions.colour && (
            <div className="pdf-reader-pop-swatches" role="group" aria-label="Colour">
              {colours.map((entry) => (
                <Swatch key={entry} label={`Colour ${entry}`} colour={entry} selected={entry === colour} onClick={() => onColour(entry)} />
              ))}
            </div>
          )}
        </div>
        <span className="pdf-reader-pop-delete">
          <IconButton tone="danger" label="Delete" onClick={onDelete}>
            <Glyph d={DELETE_PATH} />
          </IconButton>
        </span>
      </div>
      {actions.comment && (
        <div className="pdf-reader-pop-row">
          {editing ? (
            <CommentField placeholder="Add a comment…" initial={actions.prefill} onSave={onComment} onCancel={onClose} />
          ) : (
            <>
              {actions.prefill && <div className="pdf-reader-pop-quote">“{actions.prefill}”</div>}
              <Button variant={actions.prefill ? "secondary" : "primary"} size="sm" onClick={() => setEditing(true)}
              >
                <Glyph d={COMMENT_PATH} />
                {actions.comment}
              </Button>
            </>
          )}
        </div>
      )}
    </AnchoredBar>
  );
}
