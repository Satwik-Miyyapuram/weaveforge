"use client";

import { useEffect, useState } from "react";
import { getContainer } from "@/bootstrap";
import { CollaborativeMarkdownEditor } from "./collaborative-markdown-editor.js";

export function CollabBodyHost({
  resourceType,
  resourceId,
  initialBody,
  onSave,
  className,
}: {
  resourceType: string;
  resourceId: string;
  initialBody: string;
  onSave: (body: string) => Promise<void>;
  className?: string;
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

  if (!getContainer().collab.enabled()) return null;
  if (!authorId) return <p className="muted">Loading editor…</p>;

  const session = getContainer().collab.collabSession(resourceType, resourceId);

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
    />
  );
}
