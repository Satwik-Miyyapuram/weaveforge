"use client";

import { useEffect, useRef } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { createCodeMirrorThemeForSite, watchSiteTheme } from "@/lib/codemirror-theme";
import type { CiteCompletion } from "@/lib/use-cite-links";
import type { EditorCitationFormat } from "@/lib/citation-format-preference";
import { markdownEditorExtensions, toCompletions } from "./markdown-editor-extensions";

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

    const extensions = [
      ...markdownEditorExtensions({
        placeholder,
        disabled,
        completionsRef,
        citationFormatRef,
        editableCompartment: editableCompartment.current,
        themeCompartment: themeCompartment.current,
      }),
      updateListener,
    ];

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
