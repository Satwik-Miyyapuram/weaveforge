"use client";

import { useEffect, useRef, useState } from "react";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { defaultKeymap } from "@codemirror/commands";
import { yCollab } from "y-codemirror.next";
import * as Y from "yjs";
import { Awareness } from "y-protocols/awareness";
import type { CollabSession } from "../application/parts.js";
import { isLocalMode } from "@/backend/providers/local/local-identity";
import { RealtimeYjsProvider } from "../infrastructure/realtime-yjs-provider.js";
import {
  applyStoredBody,
  markSaved,
  reconcileWithBody,
  savedDigests,
  unmarkSaved,
} from "../domain/seed-document.js";
import { BodySaver, publishPeers, type SaveBody } from "../application/parts.js";
import { logToApp } from "@/lib/error-report/app-log";
import type { Peer } from "../domain/presence.js";
import { readyCore, typedCore } from "@/lib/rust-core";
import { PresenceAvatars } from "./presence-avatars";

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
  extraExtensions,
  readOnly = false,
  editorClassName,
  onViewCreated,
  inlinePresence = true,
}: {
  resourceType: string;
  resourceId: string;
  initialBody: string;
  session: CollabSession;
  authorId: string;
  displayName: string;
  onSave: SaveBody;
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
  /**
   * Draw the avatars above the editor. Off where the surrounding chrome (the
   * workspace tab strip) draws them from the presence store instead.
   */
  inlinePresence?: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Moved in an effect, not during render: when the resource changes, the old
  // editor's cleanup (and its close-save) runs before this, so that save still
  // targets the old resource (P2-148).
  const onSaveRef = useRef(onSave);
  useEffect(() => {
    onSaveRef.current = onSave;
  });
  const displayNameRef = useRef(displayName);
  displayNameRef.current = displayName;
  const onViewCreatedRef = useRef(onViewCreated);
  onViewCreatedRef.current = onViewCreated;
  const awarenessRef = useRef<Awareness | null>(null);
  const docRef = useRef<Y.Doc | null>(null);
  const [peers, setPeers] = useState<readonly Peer[]>([]);
  const [transportError, setTransportError] = useState<string | null>(null);

  // Saves only real edits once the document is seeded, and tells compaction
  // (which deletes CRDT rows on the strength of the body) whether the newest
  // text actually landed. See BodySaver.
  const [saver] = useState(
    () =>
      new BodySaver(
        {
          // The body joins this document's saved bodies when the save is sent,
          // not when it lands: the close-save lands after the channel is gone,
          // and a mark made then reached nobody. A save that fails takes back a
          // mark it added, so a body that never landed is not claimed as saved
          // (see reconcileWithBody).
          // The save target is taken here, while the editor is still on the
          // resource the body belongs to: the save itself may run after a switch.
          prepare: (body) => {
            const target = onSaveRef.current;
            const doc = docRef.current;
            const digest = readyCore().digestText(body);
            if (!doc) return { target, doc, sentState: null, digest, wasMarked: true };
            const wasMarked = savedDigests(doc).includes(digest);
            const sentState = Y.encodeStateAsUpdate(doc);
            markSaved(doc, digest);
            return { target, doc, sentState, digest, wasMarked };
          },
          // The save names the bodies this document's sessions saved, so the
          // store does not take a peer's save for someone else's edit. A body
          // the store merged with another save comes back and goes into the
          // document, so the live copy holds what is stored.
          save: async (body, sent) => {
            const { doc } = sent;
            let stored: string | void;
            try {
              stored = await sent.target(body, { sessionDigests: doc ? savedDigests(doc) : [] });
            } catch (err) {
              if (doc && !sent.wasMarked) unmarkSaved(doc, sent.digest);
              throw err;
            }
            if (typeof stored === "string" && stored !== body && doc && sent.sentState && docRef.current === doc) {
              applyStoredBody(doc, sent.sentState, stored);
              markSaved(doc, readyCore().digestText(stored));
            }
            return stored;
          },
          onError: (err) =>
            logToApp({ level: "warn", source: "collab", message: "Body save failed", detail: String(err) }),
          delayMs: SAVE_MS,
        },
        initialBody,
      ),
  );

  // Kept out of the editor effect: the display name arrives after the profile
  // loads, and listing it as a dependency tore the whole CodeMirror/Yjs stack
  // down and rebuilt it mid-session.
  useEffect(() => {
    const awareness = awarenessRef.current;
    if (!awareness) return;
    awareness.setLocalStateField("user", { id: authorId, name: displayName, color: pickColor(authorId) });
  }, [displayName, authorId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    // Cleanup of the previous run has already flushed; this run starts unready
    // again until its own bootstrap + seed completes.
    saver.begin();

    const doc = new Y.Doc();
    docRef.current = doc;
    const yText = doc.getText("body");

    const awareness = new Awareness(doc);
    awarenessRef.current = awareness;
    awareness.setLocalStateField("user", {
      // The account id lets other clients show one avatar per person and
      // leave out their own other sessions.
      id: authorId,
      name: displayNameRef.current,
      color: pickColor(authorId),
    });

    const provider = new RealtimeYjsProvider({
      doc,
      db: session.db,
      crdtStore: session.crdtStore,
      resourceType,
      resourceId,
      projectId: session.projectId(),
      authorId,
      awareness,
      // A copy with no account has nobody to sync with, so it does not try:
      // no socket, no failing broadcast per keystroke, and no notice about a
      // live connection that was never part of the offer.
      live: !isLocalMode(),
      getSnapshotUpto: session.getSnapshotUpto,
      // Compaction waits on this. The body is the other durable copy of what it
      // is about to delete log rows for, and the debounce above means the newest
      // text may not have been written at all yet.
      awaitBodyPersisted: () => saver.flush(),
      crdtUpdateStore: session.crdtUpdateStore,
      // Runs once the CRDT log has been replayed. The row's body is the truth:
      // an empty document takes it, and a log it cannot show to be newer is
      // rebuilt to it, so a stale log never overwrites a newer body.
      seed: () => {
        const { saved, dirty } = reconcileWithBody(doc, initialBody, (text) => readyCore().digestText(text));
        saver.seeded(saved);
        if (dirty) saver.schedule(yText.toString());
        host.dispatchEvent(new Event("input", { bubbles: true }));
      },
      onError: (stage, detail) => setTransportError(`${stage}: ${detail}`),
      onConnected: () => setTransportError(null),
    });

    // One entry per other person, by account id (see peersFromStates).
    // Awareness changes on every remote cursor move, so only a changed list
    // of people is passed on: anything else re-rendered the editor per move.
    const docKey = `${resourceType}:${resourceId}`;
    let current: readonly Peer[] = [];
    const syncPeers = () => {
      const next = typedCore().peersFromStates(awareness.getStates(), { clientId: doc.clientID, authorId });
      if (typedCore().samePeers(current, next)) return;
      current = next;
      setPeers(next);
      publishPeers(docKey, next);
    };
    awareness.on("change", syncPeers);
    syncPeers();

    // Only this editor's own edits are saved: a peer's text, or the stored
    // body applied after a merge, is already the peer's or the store's to save.
    const onYText = (event: Y.YTextEvent) => {
      if (event.transaction.local) saver.schedule(yText.toString());
      else saver.refresh(yText.toString());
      host.dispatchEvent(new Event("input", { bubbles: true }));
    };
    yText.observe(onYText);

    const state = EditorState.create({
      doc: yText.toString(),
      extensions: [
        ...(extraExtensions ?? [lineNumbers(), markdown(), keymap.of(defaultKeymap), EditorView.lineWrapping]),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) host.dispatchEvent(new Event("input", { bubbles: true }));
        }),
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
      yText.unobserve(onYText);
      awareness.off("change", syncPeers);
      publishPeers(docKey, []);
      if (awarenessRef.current === awareness) awarenessRef.current = null;
      // Flush only real edits. An unconditional flush here wrote the body back
      // on every teardown, and the host closed the form on save — so the editor
      // shut itself the moment it opened.
      saver.close(yText.toString());
      if (docRef.current === doc) docRef.current = null;
      void provider.destroy();
      view.destroy();
      doc.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- remount when resource or author changes
  }, [resourceType, resourceId, authorId, session, extraExtensions, readOnly, saver]);

  return (
    <div className={className}>
      {inlinePresence && peers.length > 0 ? (
        <div className="collab-presence">
          <PresenceAvatars peers={peers} />
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
