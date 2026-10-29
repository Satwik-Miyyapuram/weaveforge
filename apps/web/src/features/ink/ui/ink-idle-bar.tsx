"use client";

/**
 * The one bar, greyed: what Ink offers, in the place Ink puts it, wherever no
 * live ink surface is (a note in Text). Only what the document hands over is
 * live: a picture at the caret, its own Insert entries and More sections.
 *
 * It wraps itself in `.workspace-toolbar-idle` so a live bar portalled into the
 * `.workspace-toolbar-doc` slot just before it hides it (editor-workspace.css).
 */

import { useRef } from "react";
import { INK_COLOURS, INK_PEN_WIDTHS } from "@weaveforge/core";

import { InkBar } from "./ink-bar";
import type { InkMenuAction, InkMenuSection } from "./ink-bar-menus";

const noop = () => {};

export interface InkIdleBarProps {
  /** Insert ▾ → Image from file…: a picture from disk, at the caret. */
  onInsertImage?: (file: File) => void;
  insertItems?: readonly InkMenuAction[];
  moreSections?: readonly InkMenuSection[];
}

export function InkIdleBar({ onInsertImage, insertItems, moreSections }: InkIdleBarProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  return (
    <span className="workspace-toolbar-doc workspace-toolbar-idle">
      <InkBar
        readOnly
        tool="pen"
        colour={INK_COLOURS[0]}
        width={INK_PEN_WIDTHS[1]}
        onTool={noop}
        onColour={noop}
        onWidth={noop}
        onUndo={noop}
        onRedo={noop}
        onSelect={noop}
        selectPointer
        onAddPicture={onInsertImage ? () => fileRef.current?.click() : undefined}
        insertItems={insertItems}
        moreSections={moreSections}
      />
      {onInsertImage ? (
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Cleared so choosing the same file twice fires again.
            event.target.value = "";
            if (file) onInsertImage(file);
          }}
        />
      ) : null}
    </span>
  );
}
