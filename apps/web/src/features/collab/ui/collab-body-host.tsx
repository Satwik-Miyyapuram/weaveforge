"use client";

import { useEffect, useMemo, useState } from "react";
import type { Extension } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { getContainer } from "@/bootstrap";
import { CollaborativeMarkdownEditor } from "./collaborative-markdown-editor.js";

export function CollabBodyHost({
  resourceType,
  resourceId,
  initialBody,
  onSave,
  className,
  extraExtensions,
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
      extraExtensions={extraExtensions}
      readOnly={readOnly}
      editorClassName={editorClassName}
      onViewCreated={onViewCreated}
    />
  );
}
