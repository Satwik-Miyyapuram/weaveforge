"use client";

import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import type { Compartment, Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { createCodeMirrorThemeForSite } from "@/lib/codemirror-theme";
import { pasteCleanup, pasteCleanupKeymap } from "./markdown-paste-cleanup";
import { imagePaste, type ImagePasteConfig } from "./markdown-image-paste";
import { pendingInsertSupport } from "./markdown-pending-insert";
import { readPasteSettings } from "@/lib/paste-cleanup-preference";
import type { CiteCompletion } from "@/lib/use-cite-links";
import type { EditorCitationFormat } from "@/lib/citation-format-preference";
import { formatPaperCitation } from "@/features/overleaf/application/build-overleaf-export";
import type { Paper, PasteSettings } from "@weaveforge/core";

/** Characters that may precede `@` for cite autocomplete (not email local-parts). */
const AT_BOUNDARY = /[^A-Za-z0-9._%+-]/;

export function toCompletions(
  titles: readonly string[] | undefined,
  completions: readonly CiteCompletion[] | undefined,
): CiteCompletion[] {
  if (completions?.length) return [...completions];
  return (titles ?? []).map((t) => ({ title: t, label: t }));
}

function filterCompletions(items: readonly CiteCompletion[], query: string) {
  const q = query.toLowerCase();
  return items
    .filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        (c.detail?.toLowerCase().includes(q) ?? false),
    )
    .slice(0, 20);
}

/** How an `@` cite completion inserts under the chosen format (Phase C2). */
function insertForCompletion(c: CiteCompletion, format: EditorCitationFormat): string {
  if (format === "wikilink" || !c.paper) return `[[${c.title}]]`;
  return formatPaperCitation(c.paper as Paper, format);
}

export interface MarkdownEditorExtensionOptions {
  placeholder?: string;
  disabled?: boolean;
  /**
   * Read through a ref on every keystroke rather than captured, so new notes and
   * papers become available as cite targets without rebuilding the editor.
   */
  completionsRef: { current: CiteCompletion[] };
  citationFormatRef: { current: EditorCitationFormat };
  editableCompartment: Compartment;
  themeCompartment: Compartment;
  /**
   * Paste rules, read the same way: through a ref, so turning a rule on in
   * settings reaches every editor already on screen.
   */
  pasteSettingsRef?: { current: PasteSettings };
  /**
   * How this surface stores a pasted image. Absent means the editor leaves
   * images to the browser, which is right for a screen with nowhere to put one.
   *
   * It is also what decides whether a pasted *image URL* can be downloaded: a
   * picture fetched from the web needs somewhere to be put, exactly like one
   * off the clipboard, so a screen with no uploader keeps the link.
   */
  imagePaste?: ImagePasteConfig;
  /**
   * Whether a pasted address may be looked up — the title read, the picture
   * behind it downloaded. Defaults to on; which of the two happens is the
   * reader's setting, not the caller's.
   *
   * No surface turns this off today. It is here for one that has no business
   * reaching the network at all — a demo harness, or a build with no session to
   * authenticate the request with — so that such a surface has an answer other
   * than "let the fetch fail".
   */
  remotePaste?: boolean;
}

/**
 * The note editor's CodeMirror stack: markdown, `[[wikilink]]` and `@cite`
 * completion, search, history, and the site theme.
 *
 * Shared so the collaborative editor is the *same* editor with a Yjs binding
 * added, rather than a second, plainer one. Wiring co-editing into notes by
 * swapping in a bare markdown editor would have quietly cost autocomplete,
 * find-in-note and undo on the app's main writing surface.
 */
export function markdownEditorExtensions(opts: MarkdownEditorExtensionOptions): Extension[] {
  const { completionsRef, citationFormatRef } = opts;

  const wikilinkSource = (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/\[\[[^\]\n]*/);
    if (!before || (before.from === before.to && !ctx.explicit)) return null;
    const query = before.text.slice(2);
    const options = filterCompletions(completionsRef.current, query).map((c) => ({
      label: c.label,
      detail: c.detail,
      apply: `${c.title}]]`,
      type: "text" as const,
    }));
    if (!options.length) return null;
    return { from: before.from + 2, options, filter: false };
  };

  const atCiteSource = (ctx: CompletionContext): CompletionResult | null => {
    const before = ctx.matchBefore(/@[^\s\]\n]*/);
    if (!before) return null;
    if (before.from > 0) {
      const prev = ctx.state.doc.sliceString(before.from - 1, before.from);
      if (!AT_BOUNDARY.test(prev)) return null;
    }
    const query = before.text.slice(1);
    if (!query && !ctx.explicit) return null;
    const format = citationFormatRef.current;
    const options = filterCompletions(completionsRef.current, query).map((c) => ({
      label: c.label,
      detail: c.detail ?? (format === "wikilink" ? undefined : format),
      apply: insertForCompletion(c, format),
      type: "text" as const,
    }));
    if (!options.length) return null;
    return { from: before.from, options, filter: false };
  };

  const pasteSettings = opts.pasteSettingsRef ?? { current: readPasteSettings() };

  const extensions: Extension[] = [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    opts.themeCompartment.of(createCodeMirrorThemeForSite()),
    // Both paste handlers go in front of the markdown package. A clipboard
    // carrying a bitmap is an image paste, so that one is first; and the text
    // cleanup has to see the clipboard before `pasteURLAsLink` does, or a URL
    // dropped on a selection is wrapped in its original spelling and the
    // tracking parameter survives inside the link.
    imagePaste(opts.imagePaste, {
      remoteImages:
        opts.remotePaste === false
          ? undefined
          : () => pasteSettings.current.cleanOnPaste && pasteSettings.current.downloadPastedImages,
    }),
    // Registered here as well as inside `imagePaste`, because a link waiting
    // for its title needs the same tracking on a screen that accepts no images
    // at all. CodeMirror deduplicates by identity, so listing it twice costs
    // nothing.
    pendingInsertSupport,
    pasteCleanup({
      settings: () => pasteSettings.current,
      remote: opts.remotePaste === false ? undefined : { images: opts.imagePaste },
    }),
    markdown({
      base: markdownLanguage,
      codeLanguages: languages,
      pasteURLAsLink: true,
    }),
    history(),
    autocompletion({ override: [wikilinkSource, atCiteSource], icons: false }),
    search({ top: true }),
    // Ahead of the default keymap so the cleanup bindings win.
    keymap.of(pasteCleanupKeymap({ settings: () => pasteSettings.current })),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    drawSelection(),
    EditorView.lineWrapping,
    opts.editableCompartment.of(EditorView.editable.of(!opts.disabled)),
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": { overflow: "auto" },
      ".cm-content": { padding: "10px 0" },
      ".cm-line": { padding: "0 4px 0 2px" },
      ".cm-gutters": { borderRight: "1px solid var(--line)" },
    }),
  ];

  if (opts.placeholder) extensions.push(cmPlaceholder(opts.placeholder));

  return extensions;
}
