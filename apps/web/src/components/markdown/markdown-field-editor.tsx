"use client";

import { useEffect, useRef, useState } from "react";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { markdownEditorExtensions } from "@/components/markdown/markdown-editor-extensions";
import { createCodeMirrorThemeForSite, watchSiteTheme } from "@/lib/theme/codemirror-theme";
import type { ImagePasteConfig } from "@/components/markdown/markdown-image-paste";

export interface MarkdownFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** The id of the `<label>` that names the field. */
  labelledBy?: string;
  className?: string;
  /** How a dropped or pasted image is stored; read once, when the editor is built. */
  imagePaste?: ImagePasteConfig;
}

/**
 * The note editor as a form field: the same CodeMirror stack the workspace
 * and the collaborative editor build, for text that has no record yet to
 * co-edit (a new log entry). Controlled: `value` set from outside, an emptied
 * form after Create, replaces the document.
 */
export function MarkdownFieldEditor({ value, onChange, placeholder, labelledBy, className, imagePaste }: MarkdownFieldProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [editableCompartment] = useState(() => new Compartment());
  const [themeCompartment] = useState(() => new Compartment());

  useEffect(() => {
    const view = new EditorView({
      parent: hostRef.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          ...markdownEditorExtensions({
            placeholder,
            imagePaste,
            completionsRef: { current: [] },
            citationFormatRef: { current: "wikilink" },
            editableCompartment,
            themeCompartment,
          }),
          EditorView.contentAttributes.of(labelledBy ? { "aria-labelledby": labelledBy } : {}),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onChangeRef.current(update.state.doc.toString());
          }),
        ],
      }),
    });
    viewRef.current = view;
    const stopThemeWatch = watchSiteTheme(() => {
      view.dispatch({ effects: themeCompartment.reconfigure(createCodeMirrorThemeForSite()) });
    });
    return () => {
      stopThemeWatch();
      viewRef.current = null;
      view.destroy();
    };
    // Built once: `value` reaches the open editor through the effect below,
    // and rebuilding would lose the caret and the undo history.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  return <div ref={hostRef} className={className} />;
}
