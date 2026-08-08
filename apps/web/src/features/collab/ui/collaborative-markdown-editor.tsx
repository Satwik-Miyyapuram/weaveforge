"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap } from "@codemirror/commands";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { CollabSession } from "../application/collab-session.js";
import { EncryptedYjsProvider } from "../infrastructure/encrypted-yjs-provider.js";

const SAVE_MS = 1500;

const PRESENCE_COLORS = ["#e06c75", "#61afef", "#98c379", "#d19a66", "#c678dd", "#56b6c2"];

/**
 * The row's body as a Yjs update that every client generates *identically*.
 *
 * Seeding by calling `yText.insert(0, body)` locally cannot work for more than
 * one client: each insert is a distinct operation from a distinct author, so
 * two people opening the same never-co-edited entry both insert the body and
 * the CRDT — correctly — keeps both copies. Building the update from a throwaway
 * document pinned to client id 0 makes the operation byte-identical everywhere,
 * so Yjs recognises it as already-applied and merges it to a single copy no
 * matter how many clients contribute it or how often it is replayed.
 */
function seedUpdate(body: string): Uint8Array {
  const seedDoc = new Y.Doc();
  seedDoc.clientID = 0;
  seedDoc.getText("body").insert(0, body);
  const update = Y.encodeStateAsUpdate(seedDoc);
  seedDoc.destroy();
  return update;
}

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
  extraExtensions,
  readOnly = false,
  editorClassName,
  onViewCreated,
}: {
  resourceType: string;
  resourceId: string;
  initialBody: string;
  session: CollabSession;
  authorId: string;
  displayName: string;
  onSave: (body: string) => Promise<void>;
  className?: string;
  /**
   * CodeMirror stack to use instead of the plain markdown default. Notes pass
   * their own so co-editing keeps wikilink/cite completion, search and history —
   * see `markdownEditorExtensions`. Must be referentially stable: the editor
   * rebuilds when it changes.
   */
  extraExtensions?: Extension[];
  readOnly?: boolean;
  /** Class for the element CodeMirror mounts into, not the presence wrapper. */
  editorClassName?: string;
  /**
   * Runs with the live `EditorView`; return a teardown. Lets a caller keep
   * compartments in `extraExtensions` reconfigured — the notes editor uses it to
   * follow the site theme without rebuilding the document.
   */
  onViewCreated?: (view: EditorView) => (() => void) | void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;
  const onViewCreatedRef = useRef(onViewCreated);
  onViewCreatedRef.current = onViewCreated;
  const awarenessRef = useRef<Awareness | null>(null);
  // The body as the server last saw it. Seeding the Y.Doc with `initialBody`
  // fires the observer, and every teardown used to flush unconditionally — so
  // opening the editor wrote the unchanged body straight back, which invalidated
  // the screen cache and (under StrictMode's mount/unmount/mount) fired several
  // times before a keystroke ever happened. Saves now have to differ from this.
  const lastSaved = useRef(initialBody);
  // The document is empty until the CRDT log has been replayed and the seed has
  // run. Saving before that point writes the empty document over a non-empty
  // row — which the logbook rejects outright ("Log entry body is required").
  const ready = useRef(false);
  const [peers, setPeers] = useState<string[]>([]);
  const [transportError, setTransportError] = useState<string | null>(null);

  const scheduleSave = useCallback((body: string) => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    if (!ready.current || body === lastSaved.current) return;
    saveTimer.current = setTimeout(() => {
      lastSaved.current = body;
      void onSaveRef.current(body);
    }, SAVE_MS);
  }, []);

  // Kept out of the editor effect: the display name arrives after the profile
  // loads, and listing it as a dependency tore the whole CodeMirror/Yjs stack
  // down and rebuilt it mid-session.
  useEffect(() => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    awareness.setLocalStateField("user", { name: displayName, color: pickColor(authorId) });
  }, [displayName, authorId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Cleanup of the previous run has already flushed; this run starts unready
    // again until its own bootstrap + seed completes.
    ready.current = false;

    const doc = new Y.Doc();
    const yText = doc.getText("body");

    const awareness = new Awareness(doc);
    awarenessRef.current = awareness;
    awareness.setLocalStateField("user", {
      name: displayNameRef.current,
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
      // Runs once the CRDT log has been replayed. Only a document with no
      // stored history takes the row's body — otherwise the log is the truth
      // and seeding would duplicate it.
      seed: () => {
        if (yText.length === 0 && initialBody) Y.applyUpdate(doc, seedUpdate(initialBody));
        lastSaved.current = yText.toString();
        ready.current = true;
      },
      onError: (stage, detail) => setTransportError(`${stage}: ${detail}`),
      onConnected: () => setTransportError(null),
    });

    // Keyed by awareness client id, not by name. Keying by name meant two
    // sessions of one account — or two people who happen to share a display
    // name — collapsed into a single entry, so the presence line never appeared
    // for exactly the case it is most needed in.
    const syncPeers = () => {
      const names: string[] = [];
      awareness.getStates().forEach((state, clientId) => {
        if (clientId === doc.clientID) return;
        names.push((state.user as { name?: string } | undefined)?.name || "Someone");
      });
      setPeers(names);
    };
    awareness.on("change", syncPeers);
    syncPeers();

    const onYText = () => scheduleSave(yText.toString());
    yText.observe(onYText);

    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        ...(extraExtensions ?? [lineNumbers(), markdown(), keymap.of(defaultKeymap), EditorView.lineWrapping]),
        // After the caller's stack, so the Yjs binding owns the document and
        // the undo history it installs wins over a plain `history()`.
        yCollab(yText, awareness),
        EditorView.editable.of(!readOnly),
      ],
    });

    const view = new EditorView({ state, parent: host });
    const disposeView = onViewCreatedRef.current?.(view);

    return () => {
      if (typeof disposeView === "function") disposeView();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      yText.unobserve(onYText);
      awareness.off("change", syncPeers);
      if (awarenessRef.current === awareness) awarenessRef.current = null;
      // Flush only real edits. An unconditional flush here wrote the body back
      // on every teardown, and the host closed the form on save — so the editor
      // shut itself the moment it opened.
      const pending = yText.toString();
      if (ready.current && pending !== lastSaved.current) {
        lastSaved.current = pending;
        void onSaveRef.current(pending);
      }
      void provider.destroy();
      view.destroy();
      doc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount when resource or author changes
  }, [resourceType, resourceId, authorId, session, extraExtensions, readOnly]);

  return (
    <div className={className}>
      {peers.length > 0 ? (
        <div className="collab-presence muted" role="status">
          Editing with {peers.join(", ")}
        </div>
      ) : null}
      {transportError ? (
        <p className="muted collab-offline" role="status">
          Live sync unavailable ({transportError}). Your edits are still saved.
        </p>
      ) : null}
      <div ref={hostRef} className={editorClassName} />
    </div>
  );
}
