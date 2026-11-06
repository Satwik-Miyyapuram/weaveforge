"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { defaultHighlightStyle, LanguageDescription, syntaxHighlighting } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState, Transaction } from "@codemirror/state";
import { EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { Button } from "@/components/button";
import { FormError } from "@/components/form-error";
import { OverleafFileTree } from "./overleaf-file-tree";
import { createCodeMirrorThemeForSite, watchSiteTheme } from "@/lib/theme/codemirror-theme";
import { changesFromOp, opFromChanges } from "@/features/overleaf/application/codemirror-ops";
import { LiveDoc, otUpdateOf } from "@/features/overleaf/application/live-doc";
import {
  closeLiveProject,
  loadLiveDoc,
  openLiveProject,
  sendLiveUpdate,
  takeLiveEvents,
  type LiveDocEntry,
} from "@/features/overleaf/infrastructure/workshop-live-client";
import type { WorkshopClientDeps } from "@/features/overleaf/infrastructure/workshop-session-client";

/** Marks edits that came from Overleaf, so they are not sent back. */
const remoteEdit = Annotation.define<boolean>();

type Project = { liveId: string; name: string; docs: LiveDocEntry[]; canEdit: boolean };

/**
 * Edits an Overleaf project's files live, in our editor: the desktop app holds the
 * connection to Overleaf (apps/shell/src/overleaf_live.rs), local edits are sent
 * as ops, and other people's edits arrive as events and are merged in.
 */
export function WorkshopLiveEditor({
  client,
  sessionId,
  projectId,
  layout,
  pdf,
}: {
  client: WorkshopClientDeps;
  sessionId: string;
  projectId: string;
  /** Which panes show next to the file tree, as Overleaf's layout menu. */
  layout: "split" | "editor" | "pdf";
  /** The compiled PDF pane. Hidden panes stay mounted, so the connection and the PDF survive a switch. */
  pdf: ReactNode;
}) {
  const [project, setProject] = useState<Project | null>(null);
  const [docId, setDocId] = useState<string | null>(null);
  const [status, setStatus] = useState("Opening the project…");
  const [error, setError] = useState("");
  const [closed, setClosed] = useState(false);
  /** Reconnect bumps this to open the project again. */
  const [attempt, setAttempt] = useState(0);
  /** Bumped to load the open doc again after the editor and Overleaf disagree. */
  const [reloads, setReloads] = useState(0);
  const parentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const liveRef = useRef<{ docId: string; doc: LiveDoc } | null>(null);
  const onEventRef = useRef<(event: { name: string; args: unknown[] }) => void>(() => {});

  const reload = (message: string) => {
    setError(message);
    setReloads((n) => n + 1);
  };

  /** Sends the next waiting edit, if none is in flight. */
  const flush = () => {
    const live = liveRef.current;
    if (!live || !project) return;
    const next = live.doc.take();
    if (!next) {
      setStatus(live.doc.unsaved ? "Saving…" : "Saved");
      return;
    }
    setStatus("Saving…");
    void sendLiveUpdate(client, project.liveId, live.docId, next.op, next.version).then((res) => {
      if (res.ok || liveRef.current !== live) return;
      if (res.closed) setClosed(true);
      else reload(`${res.message} Loaded the file again.`);
    });
  };
  // The editor's listener outlives renders; it calls the latest flush.
  const flushRef = useRef(flush);
  flushRef.current = flush;

  onEventRef.current = (event) => {
    const live = liveRef.current;
    const view = viewRef.current;
    if (!live || !view) return;
    if (event.name === "resync" || event.name === "otUpdateError") {
      reload("The file changed out of step with Overleaf. Loaded it again.");
      return;
    }
    const update = otUpdateOf(event);
    if (!update || update.doc !== live.docId) return;
    if (!update.op) {
      live.doc.acked();
      flush();
      return;
    }
    const shown = live.doc.remote(update.op, update.v);
    if (!shown) {
      reload("Missed an edit from Overleaf. Loaded the file again.");
      return;
    }
    for (const change of changesFromOp(shown)) {
      view.dispatch({ changes: change, annotations: [remoteEdit.of(true), Transaction.addToHistory.of(false)] });
    }
  };

  // Open the project and listen for its events until unmount or reconnect.
  useEffect(() => {
    let stopped = false;
    let liveId: string | null = null;
    setProject(null);
    setClosed(false);
    setError("");
    setStatus("Opening the project…");
    void openLiveProject(client, sessionId, projectId).then(async (res) => {
      if (stopped) {
        if (res.ok) void closeLiveProject(client, res.liveId);
        return;
      }
      if (!res.ok) {
        setError(res.message);
        setClosed(true);
        return;
      }
      liveId = res.liveId;
      setProject({ liveId: res.liveId, name: res.name, docs: res.docs, canEdit: res.canEdit });
      setDocId((current) =>
        current && res.docs.some((d) => d.id === current) ? current : (res.rootDocId ?? res.docs[0]?.id ?? null),
      );
      while (!stopped) {
        const events = await takeLiveEvents(client, res.liveId);
        if (stopped) return;
        if (!events.ok || events.closed) {
          if (!events.ok) setError(events.message);
          setClosed(true);
          return;
        }
        for (const event of events.events) onEventRef.current(event);
      }
    });
    return () => {
      stopped = true;
      if (liveId) void closeLiveProject(client, liveId);
    };
  }, [client, sessionId, projectId, attempt]);

  // Load the chosen doc into a fresh editor.
  useEffect(() => {
    const parent = parentRef.current;
    if (!project || !docId || !parent) return;
    let cancelled = false;
    let stopThemeWatch = () => {};
    setStatus("Loading the file…");
    void loadLiveDoc(client, project.liveId, docId).then(async (res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.message);
        return;
      }
      const live = { docId, doc: new LiveDoc(res.text, res.version) };
      liveRef.current = live;
      const themeCompartment = new Compartment();
      const languageCompartment = new Compartment();
      const view = new EditorView({
        parent,
        state: EditorState.create({
          doc: res.text,
          extensions: [
            lineNumbers(),
            highlightActiveLine(),
            history(),
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
            EditorView.lineWrapping,
            EditorState.readOnly.of(!project.canEdit),
            EditorView.editable.of(project.canEdit),
            syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
            themeCompartment.of(createCodeMirrorThemeForSite()),
            languageCompartment.of([]),
            EditorView.updateListener.of((update) => {
              let changed = false;
              for (const tr of update.transactions) {
                if (!tr.docChanged || tr.annotation(remoteEdit)) continue;
                live.doc.local(opFromChanges(tr.changes, tr.startState.doc.toString()));
                changed = true;
              }
              if (changed) flushRef.current();
            }),
          ],
        }),
      });
      viewRef.current = view;
      stopThemeWatch = watchSiteTheme(() => {
        view.dispatch({ effects: themeCompartment.reconfigure(createCodeMirrorThemeForSite()) });
      });
      setStatus(project.canEdit ? "Saved" : "Read only: your Overleaf access is view only.");
      const path = project.docs.find((d) => d.id === docId)?.path ?? "";
      const language = LanguageDescription.matchFilename(languages, path);
      if (language) {
        const support = await language.load();
        if (!cancelled) view.dispatch({ effects: languageCompartment.reconfigure(support) });
      }
    });
    return () => {
      cancelled = true;
      stopThemeWatch();
      viewRef.current?.destroy();
      viewRef.current = null;
      liveRef.current = null;
    };
  }, [client, project, docId, reloads]);

  return (
    <div className="workshop-live">
      <div className="workshop-live__bar">
        <span className="muted" role="status">{closed ? "Disconnected" : status}</span>
        {closed && <Button size="sm" variant="primary" onClick={() => setAttempt((n) => n + 1)}>Reconnect</Button>}
      </div>
      {error && <FormError>{error}</FormError>}
      <div className={`workshop-live__body workshop-live__body--${layout}`}>
        <OverleafFileTree docs={project?.docs ?? []} activeId={docId} onOpen={setDocId} />
        <div className="workshop-live__editor" ref={parentRef} />
        <div className="workshop-live__pdf">{pdf}</div>
      </div>
    </div>
  );
}
