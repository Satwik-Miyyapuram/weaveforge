"use client";

import { useEffect, useRef } from "react";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { languages } from "@codemirror/language-data";
import { search, searchKeymap } from "@codemirror/search";
import { Compartment, EditorState } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers,
  placeholder as cmPlaceholder,
} from "@codemirror/view";
import {
  createCodeMirrorThemeForSite,
  watchSiteTheme,
} from "@/lib/codemirror-theme";
import type { CiteCompletion } from "@/lib/use-cite-links";
import type { EditorCitationFormat } from "@/lib/citation-format-preference";
import { formatPaperCitation } from "@/features/overleaf/application/build-overleaf-export";
import type { Paper } from "@thesis/core";

/** Characters that may precede `@` for cite autocomplete (not email local-parts). */
const AT_BOUNDARY = /[^A-Za-z0-9._%+-]/;

function toCompletions(
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

/**
 * Markdown editor — Lezer at edit time; @uiw/codemirror-themes matched to site theme.
 * Read/preview uses Shiki via {@link ShikiMarkdown}.
 */
export function MarkdownCodeEditor({
  value,
  onChange,
  placeholder,
  disabled = false,
  className,
  wikilinkTitles,
  wikilinkCompletions,
  citationFormat = "wikilink",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Note/paper/section titles offered as `[[` / `@` cite completions. */
  wikilinkTitles?: string[];
  /** Rich cite options (Author year · title). Preferred over `wikilinkTitles`. */
  wikilinkCompletions?: CiteCompletion[];
  /** How `@` completions insert (Phase C2). `[[` always inserts the title. */
  citationFormat?: EditorCitationFormat;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const completionsRef = useRef<CiteCompletion[]>(
    toCompletions(wikilinkTitles, wikilinkCompletions),
  );
  completionsRef.current = toCompletions(wikilinkTitles, wikilinkCompletions);
  const citationFormatRef = useRef(citationFormat);
  citationFormatRef.current = citationFormat;
  const editableCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChangeRef.current(update.state.doc.toString());
      }
    });

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

    const extensions = [
      lineNumbers(),
      highlightActiveLine(),
      highlightActiveLineGutter(),
      themeCompartment.current.of(createCodeMirrorThemeForSite()),
      markdown({
        base: markdownLanguage,
        codeLanguages: languages,
        pasteURLAsLink: true,
      }),
      history(),
      autocompletion({ override: [wikilinkSource, atCiteSource], icons: false }),
      search({ top: true }),
      keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
      drawSelection(),
      EditorView.lineWrapping,
      updateListener,
      editableCompartment.current.of(EditorView.editable.of(!disabled)),
      EditorView.theme({
        "&": { height: "100%" },
        ".cm-scroller": { overflow: "auto" },
        ".cm-content": { padding: "10px 0" },
        ".cm-line": { padding: "0 4px 0 2px" },
        ".cm-gutters": { borderRight: "1px solid var(--line)" },
      }),
    ];

    if (placeholder) {
      extensions.push(cmPlaceholder(placeholder));
    }

    const state = EditorState.create({
      doc: value,
      extensions,
    });

    const view = new EditorView({ state, parent: host });
    viewRef.current = view;

    const stopThemeWatch = watchSiteTheme(() => {
      view.dispatch({
        effects: themeCompartment.current.reconfigure(createCodeMirrorThemeForSite()),
      });
    });

    return () => {
      stopThemeWatch();
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeholder]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (value !== current) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: editableCompartment.current.reconfigure(EditorView.editable.of(!disabled)),
    });
  }, [disabled]);

  return (
    <div
      className={className ? `markdown-code-editor ${className}` : "markdown-code-editor"}
      ref={hostRef}
    />
  );
}
