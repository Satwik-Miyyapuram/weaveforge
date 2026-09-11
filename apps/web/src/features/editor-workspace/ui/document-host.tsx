"use client";

/**
 * The one place that decides what a document kind *is* on screen.
 *
 * `CollabBodyHost` — the shipped CodeMirror source editor with its Yjs binding —
 * is untouched and stays the renderer for every text kind. It is wrapped here,
 * never replaced, so the collaborative stack, its save policy and its lazy
 * loading boundary are exactly what they were.
 *
 * Read mode is `VaultMarkdown`, the same renderer `/notes` uses. It is reused
 * rather than rewritten, which is what keeps this from being a third editor
 * surface: there is no live preview, no WYSIWYG, no click-to-edit at the caret.
 * Read is read-only, and a wikilink click opens a tab.
 *
 * The per-kind decision is `documentKind(kind)` from `kind.ts`. Ink (`.ink.md`)
 * is one more row there and one more case here when it lands.
 */

import { useCallback, useRef } from "react";
import type { EditorView } from "@codemirror/view";

import { CollabBodyHost } from "@/features/collab";
// The vault feature's public API, not its `ui/` folder: a feature may reach a
// sibling only through its index (CONTRIBUTING.md § SOLID). Read mode is
// deliberately the *same* renderer `/notes` uses rather than a second one.
import { VaultMarkdown, type WikilinkEntry } from "@/features/vault";
import type { TabRef } from "../application/pane-tree";
import { documentKind } from "./kind";

/** What the active renderer tells the pane about itself. */
export interface DocumentMetrics {
  text?: string;
  cursor?: { line: number; col: number };
}

export interface DocumentLinks {
  notes: WikilinkEntry[];
  papers: WikilinkEntry[];
  sections: WikilinkEntry[];
}

export interface DocumentHostProps {
  tab: TabRef;
  mode: "edit" | "read";
  body: string;
  /** Where a read-mode wikilink can go. The same lists `/notes` passes. */
  links?: DocumentLinks;
  onSave: (body: string) => Promise<void>;
  /** The renderer reporting on itself — see `DocumentMetrics`. */
  onMetrics?: (metrics: DocumentMetrics) => void;
  /** Read mode: follow a wikilink to the document it names. */
  onOpenLink?: (entry: WikilinkEntry) => void;
}

/** 1-based `Ln`/`Col` for a character offset, without importing CodeMirror values. */
export function cursorAt(view: EditorView): { line: number; col: number } {
  const head = view.state.selection.main.head;
  const line = view.state.doc.lineAt(head);
  return { line: line.number, col: head - line.from + 1 };
}

/** Which of the three renderers a (kind, mode) pair means. */
export type RendererName = "editor" | "markdown" | "ink";

/**
 * The whole decision, as data.
 *
 * Pulled out of the component so it is testable without a DOM: this is the
 * switch the design's §3.3 table describes, and it is the only place in the
 * screen that knows a kind and a mode can interact.
 */
export function rendererFor(kind: string, mode: "edit" | "read"): RendererName {
  if (documentKind(kind) === "ink") return "ink";
  return mode === "read" ? "markdown" : "editor";
}

/** Whether Edit / Read applies to a kind. Ink has one mode (§3.3). */
export function supportsEditMode(kind: string): boolean {
  return documentKind(kind) === "text";
}

export function DocumentHost({
  tab,
  mode,
  body,
  links,
  onSave,
  onMetrics,
  onOpenLink,
}: DocumentHostProps) {
  // Held in a ref so the editor's `onViewCreated` identity never changes: it is
  // a dependency of the CodeMirror stack, and rebuilding that stack would throw
  // away the document and its undo history.
  const metricsRef = useRef(onMetrics);
  metricsRef.current = onMetrics;

  const watch = useCallback((view: EditorView) => {
    const report = () =>
      metricsRef.current?.({ text: view.state.doc.toString(), cursor: cursorAt(view) });
    report();
    // `input` is CodeMirror's own DOM event for "the document changed", and a
    // selection change arrives as a keyup or a mouseup next to it. Listening on
    // the editor's own element keeps this a reporting seam rather than a
    // CodeMirror value import in the screen's bundle.
    const onInput = () => report();
    view.dom.addEventListener("input", onInput);
    view.dom.addEventListener("keyup", onInput);
    view.dom.addEventListener("mouseup", onInput);
    view.dom.addEventListener("focus", onInput);
    return () => {
      view.dom.removeEventListener("input", onInput);
      view.dom.removeEventListener("keyup", onInput);
      view.dom.removeEventListener("mouseup", onInput);
      view.dom.removeEventListener("focus", onInput);
    };
  }, []);

  const renderer = rendererFor(tab.kind, mode);

  if (renderer === "ink") {
    // Not built (design §3.3). The row exists so that an ink host is one more
    // case here and nothing else in the screen learns a new kind.
    return null;
  }

  if (renderer === "markdown") {
    return (
      <div className="document-read">
        <VaultMarkdown
          body={body}
          className="document-read-body"
          notes={links?.notes ?? []}
          papers={links?.papers ?? []}
          sections={links?.sections ?? []}
          onCreateNote={onOpenLink ? (title: string) => onOpenLink({ title } as WikilinkEntry) : undefined}
        />
      </div>
    );
  }

  return (
    <CollabBodyHost
      resourceType={tab.kind}
      resourceId={tab.id}
      initialBody={body}
      onSave={onSave}
      markdownEditing={{ placeholder: "Write…" }}
      editorClassName="workspace-editor"
      onViewCreated={onMetrics ? watch : undefined}
    />
  );
}
