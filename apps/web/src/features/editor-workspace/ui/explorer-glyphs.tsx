"use client";

/**
 * The explorer's small pieces: the glyphs it draws, the text box a draft or a
 * rename types into, and the message an error becomes.
 *
 * Extracted from `explorer-panel.tsx` so the panel is the tree and its
 * wiring, and the marks it draws are named for themselves.
 */

import { useEffect, useRef, useState } from "react";

import { FolderIcon } from "@/components/view-icons";
import { NavIcon } from "@/app/nav-icon";

import { draftIcon, type CreateKind } from "../application/explorer-edit";

/**
 * The glyph a draft row shows while it is being named.
 *
 * A folder keeps the explorer's own folder glyph — that is what a grouping row
 * draws — and everything else takes the same handle the tree gives the kind the
 * row will become, so a draft does not look like a different species than the
 * row it turns into. Which handle is a decision the create table owns.
 */
export function DraftIcon({ kind }: { kind: CreateKind }) {
  const name = draftIcon(kind);
  return name === "folder" ? <FolderIcon /> : <NavIcon name={name} />;
}

/**
 * The text box a draft or a rename types into. Enter submits, Escape cancels,
 * and leaving it submits what is there — VS Code's rule, so a click elsewhere
 * after typing a name does not throw the name away.
 */
export function InlineTitle({
  className,
  initial,
  placeholder,
  onSubmit,
  onCancel,
}: {
  className: string;
  initial: string;
  placeholder: string;
  onSubmit: (title: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const finish = (submit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (submit) void onSubmit(value);
    else onCancel();
  };
  return (
    <input
      ref={ref}
      type="text"
      className={`${className} explorer-inline-title`}
      value={value}
      placeholder={placeholder}
      aria-label={placeholder}
      onChange={(event) => setValue(event.target.value)}
      onClick={(event) => event.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      }}
    />
  );
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function HideGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16" />
    </svg>
  );
}

export function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="11"
      height="11"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function RefreshGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 12a8 8 0 1 1-2.3-5.6" />
      <path d="M20 4v4h-4" />
    </svg>
  );
}
