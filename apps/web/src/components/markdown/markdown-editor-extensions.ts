"use client";

import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  type Completion,
  type CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import type { Compartment, Extension } from "@codemirror/state";
import { extractWikilinks, normalizeTitleKey } from "@weaveforge/core";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import { createCodeMirrorThemeForSite } from "@/lib/theme/codemirror-theme";
import { pasteCleanup, pasteCleanupKeymap } from "@/components/markdown/markdown-paste-cleanup";
import { imagePaste, type ImagePasteConfig } from "@/components/markdown/markdown-image-paste";
import { pendingInsertSupport } from "@/components/markdown/markdown-pending-insert";
import { readPasteSettings } from "@/lib/paste-cleanup-preference";
import type { CiteCompletion } from "@/lib/hooks/use-cite-links";
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

function hasExactTitle(items: readonly CiteCompletion[], title: string): boolean {
  const key = normalizeTitleKey(title);
  return items.some((c) => normalizeTitleKey(c.title) === key);
}

/** How an `@` cite completion inserts under the chosen format (Phase C2). */
function insertForCompletion(c: CiteCompletion, format: EditorCitationFormat): string {
  if (format === "wikilink" || !c.paper) return `[[${c.title}]]`;
  return formatPaperCitation(c.paper as Paper, format);
}

/**
 * Makes the note a `[[title]]` names. `open` is whether to show it: a row
 * picked from the list or a link clicked wants the note on screen, a link
 * typed in passing does not — the person is mid-sentence.
 */
export type CreateNote = (title: string, opts?: { open?: boolean }) => void;

/**
 * Closing brackets typed by `closeBrackets` sit after the caret, so a
 * completion that writes `title]]` must eat the `]]` already there or the
 * link ends `]]]]`. One or two, since the person may have typed one themself.
 */
function closingAfter(view: EditorView, pos: number): number {
  const ahead = view.state.sliceDoc(pos, pos + 2);
  return ahead === "]]" ? 2 : ahead.startsWith("]") ? 1 : 0;
}

/**
 * The note a typed link names, made when the link is finished.
 *
 * A `[[title]]` that resolves to nothing gets its note the moment the caret
 * leaves it — the person typed a link and went on writing, and that is the
 * whole instruction; picking "Create note" from the list was one step too
 * many. While the caret is still inside the brackets nothing happens: with
 * `closeBrackets` the link is `[[F]]` after one keystroke, and `F` is not a
 * note anyone wants. A title is offered once per editor, so a link that stays
 * unresolved (the make failed, or it is a paper's title) is not retried on
 * every keystroke.
 */
export function finishedLinks(doc: string, caret: number): string[] {
  const out: string[] = [];
  const re = /\[\[([^[\]\n]+?)\]\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(doc)) !== null) {
    if (caret > m.index && caret < m.index + m[0].length) continue;
    // Only links `extractWikilinks` reads: `[[title|alias]]` and
    // `[[title#heading]]` name `title`.
    const [ref] = extractWikilinks(m[0]);
    if (ref) out.push(ref.target);
  }
  return out;
}

function createTypedLinks(
  completionsRef: { current: readonly CiteCompletion[] },
  createNoteRef: { current: CreateNote | undefined },
): Extension {
  const offered = new Set<string>();
  return EditorView.updateListener.of((update) => {
    if (!update.docChanged && !update.selectionSet && !update.focusChanged) return;
    const create = createNoteRef.current;
    if (!create) return;
    const caret = update.view.hasFocus ? update.state.selection.main.head : -1;
    for (const title of finishedLinks(update.state.doc.toString(), caret)) {
      const key = normalizeTitleKey(title);
      if (!key || offered.has(key)) continue;
      offered.add(key);
      if (hasExactTitle(completionsRef.current, title)) continue;
      create(title, { open: false });
    }
  });
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
  /**
   * `#tag` completions, read the same way. Absent means no tag source: a
   * surface with no tags to offer should not open an empty list on every `#`.
   */
  tagsRef?: { current: readonly string[] };
  /**
   * What to do with a `[[title]]` nobody has written yet. When set, an unknown
   * title gets a "Create note" row at the end of the list; choosing it inserts
   * the link and calls this with the title. `undefined` means the surface
   * cannot create notes, or the person has turned it off — the ref is read on
   * each keystroke so a settings change reaches an open editor.
   */
  createNoteRef?: { current: CreateNote | undefined };
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
    const options: Completion[] = filterCompletions(completionsRef.current, query).map((c) => ({
      label: c.label,
      detail: c.detail,
      apply: (view, _completion, from, to) => {
        const insert = `${c.title}]]`;
        view.dispatch({
          changes: { from, to: to + closingAfter(view, to), insert },
          selection: { anchor: from + insert.length },
        });
      },
      type: "text",
    }));
    // The create row: offered only for a title that matches nothing exactly,
    // so a person who has typed a known name sees one row, not a duplicate
    // offer to make a second note by the same name (titles are unique).
    const title = query.trim();
    const create = opts.createNoteRef?.current;
    if (create && title && !hasExactTitle(completionsRef.current, title)) {
      options.push({
        label: `Create note "${title}"`,
        detail: "new",
        type: "text",
        apply: (view, _completion, from, to) => {
          view.dispatch({
            changes: { from, to: to + closingAfter(view, to), insert: `${title}]]` },
            selection: { anchor: from + title.length + 2 },
          });
          create(title, { open: true });
        },
      });
    }
    if (!options.length) return null;
    return { from: before.from + 2, options, filter: false };
  };

  // `#tag`, at a word boundary, from the tags every document in the project
  // already carries. A `#` inside a word (`C#`, `issue#12`) or a heading's
  // leading `#` at the start of a line is not a tag and gets no list.
  const tagSource = (ctx: CompletionContext): CompletionResult | null => {
    const tags = opts.tagsRef?.current;
    if (!tags?.length) return null;
    const before = ctx.matchBefore(/#[\p{L}\p{N}_-]*/u);
    if (!before) return null;
    const line = ctx.state.doc.lineAt(before.from);
    if (before.from === line.from) return null;
    const prev = ctx.state.doc.sliceString(before.from - 1, before.from);
    if (!/\s/.test(prev)) return null;
    const query = before.text.slice(1).toLowerCase();
    if (!query && !ctx.explicit) return null;
    const options = tags
      .filter((t) => t.toLowerCase().includes(query))
      .slice(0, 20)
      .map((t) => ({ label: `#${t}`, apply: `#${t}`, type: "text" as const }));
    if (!options.length) return null;
    return { from: before.from, options, filter: false };
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
    autocompletion({ override: [wikilinkSource, atCiteSource, tagSource], icons: false }),
    // `[` gets its `]`, and the rest of the pairs: a typed `[[` is a link
    // with its close already there, and Backspace on the pair removes both.
    closeBrackets(),
    ...(opts.createNoteRef ? [createTypedLinks(completionsRef, opts.createNoteRef)] : []),
    search({ top: true }),
    // Ahead of the default keymap so the cleanup bindings win.
    keymap.of(pasteCleanupKeymap({ settings: () => pasteSettings.current })),
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...historyKeymap, ...searchKeymap]),
    drawSelection(),
    EditorView.lineWrapping,
    opts.editableCompartment.of(EditorView.editable.of(!opts.disabled)),
    EditorView.theme({
      "&": { height: "100%" },
      ".cm-scroller": { overflow: "auto" },
      // The content and gutter fill the pane rather than stopping at the last
      // line: a one-line note otherwise rendered as a one-line strip with the
      // pane's background under it, and read as a text field rather than a
      // page. Clicking anywhere below the text now lands the cursor on it.
      ".cm-content": { padding: "10px 0", minHeight: "100%" },
      ".cm-gutter": { minHeight: "100%" },
      ".cm-line": { padding: "0 4px 0 2px" },
      ".cm-gutters": { borderRight: "1px solid var(--line)" },
    }),
  ];

  if (opts.placeholder) extensions.push(cmPlaceholder(opts.placeholder));

  return extensions;
}
