"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Compartment, type Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getContainer } from "@/bootstrap";
import {
  markdownEditorExtensions,
  toCompletions,
} from "@/components/markdown-editor-extensions";
import { createCodeMirrorThemeForSite, watchSiteTheme } from "@/lib/codemirror-theme";
import type { CiteCompletion } from "@/lib/use-cite-links";
import type { EditorCitationFormat } from "@/lib/citation-format-preference";
import { CollaborativeMarkdownEditor } from "./collaborative-markdown-editor.js";

/**
 * The full markdown editing stack, described as data.
 *
 * Callers used to build the CodeMirror extension array themselves and hand it
 * over as `extraExtensions`. That is a value import of `@codemirror/*` in a
 * screen module, which pulled the whole editor — CodeMirror plus
 * `@codemirror/language-data` — into that route's first-load bundle and
 * defeated the point of this component being lazily loaded. `/notes` paid 217 kB
 * of route JS for it while `/log`, which uses the same collaborative editor
 * without extensions, paid 9 kB. Everything here is plain data, so the screen
 * imports no CodeMirror at all and the editor arrives with its own chunk.
 */
export interface CollabMarkdownEditing {
  placeholder?: string;
  /** Note/paper/section titles offered as `[[` / `@` completions. */
  wikilinkTitles?: string[];
  /** Rich cite options (Author year · title). Preferred over `wikilinkTitles`. */
  wikilinkCompletions?: CiteCompletion[];
  citationFormat?: EditorCitationFormat;
}

export function CollabBodyHost({
  resourceType,
  resourceId,
  initialBody,
  onSave,
  className,
  extraExtensions,
  markdownEditing,
  readOnly,
  editorClassName,
  onViewCreated,
}: {
  resourceType: string;
  resourceId: string;
  initialBody: string;
  onSave: (body: string) => Promise<void>;
  className?: string;
  /** Caller's CodeMirror stack — see `CollaborativeMarkdownEditor`. */
  extraExtensions?: Extension[];
  /** Markdown editing described as data; built into extensions in here. */
  markdownEditing?: CollabMarkdownEditing;
  readOnly?: boolean;
  editorClassName?: string;
  onViewCreated?: (view: EditorView) => (() => void) | void;
}) {
  const [authorId, setAuthorId] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState("Editor");

  useEffect(() => {
    if (!getContainer().collab.enabled()) return;
    void getContainer().collab.requireUserId().then(setAuthorId);
    void getContainer()
      .org.loadProfile()
      .then((p) => setDisplayName(p?.fullName ?? p?.email ?? "Editor"));
  }, []);

  // `collabSession` builds a fresh object every call, and the editor keys its
  // Yjs/CodeMirror effect on that object. Calling it inline made the identity
  // change on every render, so the editor tore itself down and rebuilt — and
  // each teardown flushed a save, which re-rendered the host, which built
  // another session. Memoised per resource; the container is a singleton.
  const session = useMemo(
    () => getContainer().collab.collabSession(resourceType, resourceId),
    [resourceType, resourceId],
  );

  // The collaborative editor rebuilds its document whenever the extension array
  // changes, so the stack is built once and fed new completions through refs
  // rather than rebuilt whenever a note or paper is added.
  const completionsRef = useRef<CiteCompletion[]>([]);
  completionsRef.current = toCompletions(
    markdownEditing?.wikilinkTitles,
    markdownEditing?.wikilinkCompletions,
  );
  const citationFormatRef = useRef<EditorCitationFormat>(
    markdownEditing?.citationFormat ?? "wikilink",
  );
  citationFormatRef.current = markdownEditing?.citationFormat ?? "wikilink";
  const editableCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const placeholder = markdownEditing?.placeholder;

  const markdownExtensions = useMemo(
    () =>
      markdownEditing
        ? markdownEditorExtensions({
            placeholder,
            completionsRef,
            citationFormatRef,
            editableCompartment: editableCompartment.current,
            themeCompartment: themeCompartment.current,
          })
        : null,
    // `placeholder` is read once, when the stack is built; a later change to it
    // must not tear the shared document down mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(markdownEditing)],
  );

  const extensions = useMemo(() => {
    if (!markdownExtensions) return extraExtensions;
    return extraExtensions ? [...markdownExtensions, ...extraExtensions] : markdownExtensions;
  }, [markdownExtensions, extraExtensions]);

  const handleViewCreated = useCallback(
    (view: EditorView) => {
      const stopCallerWatch = onViewCreated?.(view);
      if (!markdownExtensions) return stopCallerWatch;
      const stopThemeWatch = watchSiteTheme(() => {
        view.dispatch({
          effects: themeCompartment.current.reconfigure(createCodeMirrorThemeForSite()),
        });
      });
      return () => {
        stopThemeWatch();
        stopCallerWatch?.();
      };
    },
    [markdownExtensions, onViewCreated],
  );

  if (!getContainer().collab.enabled()) return null;
  if (!authorId) return <p className="muted">Loading editor…</p>;

  return (
    <CollaborativeMarkdownEditor
      resourceType={resourceType}
      resourceId={resourceId}
      initialBody={initialBody}
      session={session}
      authorId={authorId}
      displayName={displayName}
      onSave={onSave}
      className={className}
      extraExtensions={extensions}
      readOnly={readOnly}
      editorClassName={editorClassName}
      onViewCreated={handleViewCreated}
    />
  );
}
