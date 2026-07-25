"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap } from "@codemirror/commands";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { CollabSession } from "../application/collab-session.js";
import { EncryptedYjsProvider } from "../infrastructure/encrypted-yjs-provider.js";

const SAVE_MS = 1500;

const PRESENCE_COLORS = ["#e06c75", "#61afef", "#98c379", "#d19a66", "#c678dd", "#56b6c2"];

function pickColor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  return PRESENCE_COLORS[h % PRESENCE_COLORS.length]!;
}

export function CollaborativeMarkdownEditor({
  resourceType,
  resourceId,
  initialBody,
  session,
  authorId,
  displayName,
  onSave,
  className,
}: {
  resourceType: string;
  resourceId: string;
  initialBody: string;
  session: CollabSession;
  authorId: string;
  displayName: string;
  onSave: (body: string) => Promise<void>;
  className?: string;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const [peers, setPeers] = useState<string[]>([]);

  const scheduleSave = useCallback((body: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void onSaveRef.current(body);
    }, SAVE_MS);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const doc = new Y.Doc();
    const yText = doc.getText("body");
    if (yText.length === 0 && initialBody) yText.insert(0, initialBody);

    const awareness = new Awareness(doc);
    awareness.setLocalStateField("user", {
      name: displayName,
      color: pickColor(authorId),
    });

    const provider = new EncryptedYjsProvider({
      doc,
      db: session.db,
      crdtStore: session.crdtStore,
      resourceType,
      resourceId,
      projectId: session.projectId(),
      authorId,
      awareness,
      getSnapshotUpto: session.getSnapshotUpto,
      setSnapshotUpto: session.setSnapshotUpto,
      compactCrdtLog: session.compactCrdtLog,
    });

    const syncPeers = () => {
      const names = new Set<string>();
      awareness.getStates().forEach((state) => {
        const name = (state.user as { name?: string } | undefined)?.name;
        if (name) names.add(name);
      });
      setPeers([...names]);
    };
    awareness.on("change", syncPeers);
    syncPeers();

    const onYText = () => scheduleSave(yText.toString());
    yText.observe(onYText);

    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        lineNumbers(),
        markdown(),
        keymap.of(defaultKeymap),
        yCollab(yText, awareness),
        EditorView.lineWrapping,
      ],
    });

    const view = new EditorView({ state, parent: host });

    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      yText.unobserve(onYText);
      awareness.off("change", syncPeers);
      void onSaveRef.current(yText.toString());
      void provider.destroy();
      view.destroy();
      doc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount when resource or author changes
  }, [resourceType, resourceId, authorId, displayName, session]);

  return (
    <div className={className}>
      {peers.length > 1 ? (
        <div className="collab-presence muted" role="status">
          Editing with {peers.filter((n) => n !== displayName).join(", ") || "others"}
        </div>
      ) : null}
      <div ref={hostRef} />
    </div>
  );
}
