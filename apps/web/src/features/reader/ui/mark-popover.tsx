"use client";

import { useState } from "react";

import type { MarkActions } from "../application/mark-actions";
import { AnchoredBar, COMMENT_PATH, CommentField, Glyph, type SelectionAnchor } from "./selection-create-bar";

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
                <button
                  key={entry}
                  type="button"
                  className="pdf-reader-pop-swatch"
                  style={{ background: entry }}
                  aria-pressed={entry === colour}
                  aria-label={`Colour ${entry}`}
                  title={entry}
                  onClick={() => onColour(entry)}
                />
              ))}
            </div>
          )}
        </div>
        <button
          type="button"
          className="btn-ghost pdf-reader-create-icon pdf-reader-pop-delete"
          aria-label="Delete"
          title="Delete"
          onClick={onDelete}
        >
          <Glyph d={DELETE_PATH} />
        </button>
      </div>
      {actions.comment && (
        <div className="pdf-reader-pop-row">
          {editing ? (
            <CommentField placeholder="Add a comment…" initial={actions.prefill} onSave={onComment} onCancel={onClose} />
          ) : (
            <>
              {actions.prefill && <div className="pdf-reader-pop-quote">“{actions.prefill}”</div>}
              <button
                type="button"
                className={`${actions.prefill ? "btn-secondary" : "btn-primary"} btn-sm pdf-reader-pop-btn`}
                onClick={() => setEditing(true)}
              >
                <Glyph d={COMMENT_PATH} />
                {actions.comment}
              </button>
            </>
          )}
        </div>
      )}
    </AnchoredBar>
  );
}
