"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { readyCore } from "@/lib/rust-core";
import { formatError } from "@/lib/format-error";
import { downloadBlob } from "@/lib/parts";
import { useScreenActive } from "@/lib/hooks/use-screen-active";
import { useBlobObjectUrls, type BlobFetchers } from "@/lib/hooks/use-blob-object-urls";
import { Button, IconButton } from "@/components/button";
import { Select } from "@/components/select";
import {
  isPicturePath,
  makeNode,
  newCanvasId,
  nodeBox,
  parseCanvasFile,
  pictureOf,
  type CanvasFile,
} from "../application/canvas-doc";
import { addNode, addStroke, moveItems, patchNode, removeItems, strokesOf } from "../application/freeform-edit";
import {
  MIN_SIZE,
  pictureSize,
  placeText,
  resizeKeepAspect,
  screenToPage,
  zoomAt,
  type PageView,
  type Size,
} from "../application/freeform-geometry";
import { encodeStroke, eraseHits, strokeAt, type InkPoint } from "../application/freeform-ink";
import { canRedo, canUndo, createHistory, record, redo, undo, type History } from "../application/canvas-history";
import { CanvasSaver } from "../application/canvas-save";
import { canvasKeyAction, focusesOnPress } from "../application/canvas-keys";
import { CanvasCard } from "./canvas-nodes";
import { EdgeLayer } from "./canvas-edges";
import { InkLayer, type InkDraft } from "./canvas-ink";
import { loadNaturalSize, type CanvasImages } from "../application/canvas-images";
import { exportDrawing, importDrawing } from "../application/excalidraw-transfer";

export interface CanvasEditorProps {
  /** The canvas note's body: JSON Canvas text. */
  body: string;
  /**
   * Writes the body through the note's normal save path. `base` is the body
   * the change was built on, for the store's merge; it may resolve the body stored.
   */
  onSave: (body: string, base: string | undefined) => unknown;
  /** Paths a file node can point to, offered while typing one. */
  filePaths: readonly string[];
  /** Opens what a file node points to; false when nothing matches. */
  onOpenFile: (path: string) => boolean;
  /** This page's picture store, memoised by the caller per page. */
  images: CanvasImages;
}

type Mode = "type" | "pen" | "eraser" | "select";

interface Point {
  x: number;
  y: number;
}

/** What a pointer is doing between press and release. `base` is the file at the start, for one history entry. */
type Gesture =
  | { kind: "pan"; screen: Point; view: PageView }
  | { kind: "ink"; points: InkPoint[]; colour: string; width: number }
  | { kind: "erase"; base: CanvasFile }
  | { kind: "move"; base: CanvasFile; ids: ReadonlySet<string>; origin: Point }
  | { kind: "resize"; base: CanvasFile; id: string; origin: Point; size: Size; picture: boolean };

const EMPTY_FILE: CanvasFile = { nodes: [], edges: [] };
const DEFAULT_VIEW: PageView = { x: 0, y: 0, zoom: 1 };
const DEFAULT_COLOUR = "#1f2328";
const PEN_WIDTHS = [2, 4, 8, 16];
const DEFAULT_WIDTH = 4;
/** The eraser reaches this many screen pixels, whatever the zoom. */
const ERASER_RADIUS = 10;
const CARD_SIZE: Size = { width: 320, height: 120 };
const GROUP_SIZE: Size = { width: 320, height: 200 };

function Glyph({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">
      <path d={d} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const MODES: { mode: Mode; label: string; icon: ReactNode }[] = [
  { mode: "select", label: "Select", icon: <Glyph d="M5 3l13 8-5.5 1.5L15 19l-2.5 1-2.7-6.4L5 17z" /> },
  { mode: "type", label: "Type", icon: <Glyph d="M5 6V4h14v2M12 4v16M9 20h6" /> },
  { mode: "pen", label: "Pen", icon: <Glyph d="M4 20l1.2-4.2L15.8 5.2a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8.2 18.8z" /> },
  { mode: "eraser", label: "Eraser", icon: <Glyph d="M3 17l8.5-8.5a2 2 0 0 1 2.8 0l4.2 4.2a2 2 0 0 1 0 2.8L14 21H8zM7 12l5 5" /> },
];

/** Whether keys typed at `target` go into a field or a card's text, not the canvas. */
function isTextEntry(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]") !== null);
}

function isImage(file: File): boolean {
  return file.type.startsWith("image/");
}

/**
 * A freeform page: pan and zoom; text boxes, pictures, links, notes and
 * groups as cards; pen strokes on top. Changes save themselves through
 * `onSave`. A body that is not a canvas is shown as an error and never
 * overwritten.
 */
export default function CanvasEditor({ body, onSave, filePaths, onOpenFile, images }: CanvasEditorProps) {
  const [initial] = useState(() => {
    try {
      return { file: parseCanvasFile(body), error: null as string | null };
    } catch (err) {
      return { file: EMPTY_FILE, error: formatError(err) };
    }
  });
  // A load error means the body is not a canvas: the editor halts and never saves over it.
  const [loadError, setLoadError] = useState<string | null>(initial.error);
  // A failed write is shown but does not halt: the edit stays pending and saves on the next change or flush.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [pictureError, setPictureError] = useState<string | null>(null);
  /** What the last Excalidraw import or export could not do, or the details it could not carry. */
  const [transferNote, setTransferNote] = useState<string | null>(null);
  const drawingInputRef = useRef<HTMLInputElement>(null);
  const [hist, setHist] = useState<History<CanvasFile>>(() => createHistory(initial.file));
  const file = hist.present;
  // The body never parsed and nothing valid has replaced it: show the error card, with no surface.
  const broken = loadError !== null && file === initial.file;
  const fileRef = useRef(file);
  fileRef.current = file;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const screenActive = useScreenActive();
  const wrapperRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [focusWithin, setFocusWithin] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  // The file as it was when a text or label edit began: one history entry covers the whole edit.
  const editBaseRef = useRef<CanvasFile | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [mode, setMode] = useState<Mode>("select");
  const [colour, setColour] = useState(DEFAULT_COLOUR);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [view, setView] = useState<PageView>(DEFAULT_VIEW);
  const [draft, setDraft] = useState<InkDraft | null>(null);
  const gestureRef = useRef<Gesture | null>(null);
  // The pointer the gesture belongs to: a second finger or pen is ignored until it ends.
  const pointerRef = useRef<number | null>(null);
  const [filePath, setFilePath] = useState("");
  const [url, setUrl] = useState("");

  // Puts a body from the store on screen.
  const show = useCallback((text: string) => {
    try {
      const next = parseCanvasFile(text);
      editBaseRef.current = null;
      // A gesture in progress was built on the old file: drop it, so its release cannot write that file back.
      gestureRef.current = null;
      pointerRef.current = null;
      setDraft(null);
      setHist(createHistory(next));
      setSelected(new Set());
      setEditingId(null);
      setLoadError(null);
    } catch (err) {
      setLoadError(formatError(err));
    }
  }, []);
  const [saver] = useState(
    () =>
      new CanvasSaver({
        loaded: body,
        write: (text, base) => onSaveRef.current(text, base),
        onError: (err) => setSaveError(formatError(err)),
        onSaved: () => setSaveError(null),
        onStored: show,
      }),
  );
  const readText = useCallback(() => readyCore().normalizeCanvasText(JSON.stringify(fileRef.current)), []);

  const issues = useMemo(() => {
    try {
      return loadError ? [] : readyCore().validateCanvasText(body);
    } catch {
      return [];
    }
  }, [body, loadError]);

  // The body changed outside this editor (another device, an import): show it.
  // Our own saves echo back through here and are left alone. While a change of
  // ours is unsaved, theirs waits: our write names its base, the store merges
  // (or keeps a conflict copy) and the saver shows the result.
  useEffect(() => {
    if (saver.receive(body)) show(body);
  }, [body, saver, show]);

  // Save a moment after the last change. A broken body is never saved over.
  useEffect(() => {
    if (loadError) {
      saver.halt();
      return;
    }
    saver.resume();
    saver.touch(readText);
  }, [file, loadError, saver, readText]);
  // Leaving mid-wait still saves: closing the tab, navigating away, unmounting.
  useEffect(() => {
    const save = () => saver.flush(readText);
    window.addEventListener("pagehide", save, { passive: true });
    window.addEventListener("beforeunload", save, { passive: true });
    return () => {
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
      // The last change gets one write; no retry or banner outlives the editor.
      saver.flush(readText);
      saver.dispose();
    };
  }, [saver, readText]);

  // Pictures: the file node's path is the vault prefix plus the stored path.
  const prefix = readyCore().vaultImagePrefix();
  const picturePaths = useMemo(
    () => file.nodes.flatMap((node) => {
      const path = pictureOf(node, prefix);
      return path ? [path] : [];
    }),
    [file.nodes, prefix],
  );
  const fetchers = useMemo<BlobFetchers>(() => ({ fetchOne: (path) => images.fetch(path) }), [images]);
  const pictureUrls = useBlobObjectUrls(picturePaths, fetchers);

  /** Selection without ids that no longer exist (after undo or a remote change). */
  const live = useMemo(() => {
    const ids = new Set<string>([...file.nodes.map((node) => node.id), ...strokesOf(file).map((stroke) => stroke.id)]);
    return new Set([...selected].filter((id) => ids.has(id)));
  }, [file, selected]);

  // One history entry per edit: `record` for discrete changes, `preview` while a gesture or typing changes the
  // page without an entry, and `commit` to close a gesture with the file it started from.
  const edit = useCallback((change: (f: CanvasFile) => CanvasFile) => setHist((h) => record(h, change(h.present))), []);
  const preview = useCallback((change: (f: CanvasFile) => CanvasFile) => {
    setHist((h) => {
      const next = change(h.present);
      return next === h.present ? h : { ...h, present: next };
    });
  }, []);
  const commit = useCallback((base: CanvasFile) => {
    setHist((h) => {
      if (JSON.stringify(base) === JSON.stringify(h.present)) return h.present === base ? h : { ...h, present: base };
      return record({ ...h, present: base }, h.present);
    });
  }, []);

  const beginEdit = useCallback((id: string) => {
    if (editBaseRef.current === null) editBaseRef.current = fileRef.current;
    setEditingId(id);
  }, []);
  const endEdit = useCallback(() => {
    const base = editBaseRef.current;
    editBaseRef.current = null;
    setEditingId(null);
    if (base) commit(base);
  }, [commit]);

  /** Puts a new text box at `at`, open for typing. */
  const createText = (at: Point) => {
    const raw = makeNode("text", at, placeText(at));
    if (editBaseRef.current === null) editBaseRef.current = fileRef.current;
    setHist((h) => ({ ...h, present: addNode(h.present, raw) }));
    setSelected(new Set([raw.id]));
    setEditingId(raw.id);
  };

  /** The ids plus the nodes inside any group among them: a group carries its members, as in Obsidian. */
  const withMembers = useCallback((selection: ReadonlySet<string>): Set<string> => {
    const ids = new Set(selection);
    const text = JSON.stringify(fileRef.current);
    for (const node of fileRef.current.nodes) {
      if (selection.has(node.id) && node.type === "group") {
        for (const member of readyCore().canvasGroupMembers(text, node.id)) ids.add(member);
      }
    }
    return ids;
  }, []);

  // Keys (see canvasKeyAction): delete, undo, redo, and arrows that nudge the selection. Never while typing.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = canvasKeyAction(
        { screenActive, focusWithin, editing: editingId !== null, textEntry: isTextEntry(event.target) },
        { key: event.key, ctrl: event.ctrlKey || event.metaKey, shift: event.shiftKey },
      );
      if (!action) return;
      if (action.kind === "undo" || action.kind === "redo") {
        event.preventDefault();
        setHist((h) => (action.kind === "undo" ? undo(h) : redo(h)));
        return;
      }
      if (live.size === 0) return;
      event.preventDefault();
      if (action.kind === "delete") {
        const ids = live;
        setHist((h) => record(h, removeItems(h.present, ids)));
        setSelected(new Set());
      } else {
        const ids = withMembers(live);
        setHist((h) => record(h, moveItems(h.present, ids, action.dx, action.dy)));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screenActive, focusWithin, editingId, live, withMembers]);

  // Plain wheel pans; Ctrl+wheel zooms about the pointer. Text being typed keeps its own scrolling.
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if (isTextEntry(event.target)) return;
      event.preventDefault();
      if (event.ctrlKey) {
        const rect = el.getBoundingClientRect();
        const at = { x: event.clientX - rect.left, y: event.clientY - rect.top };
        const factor = Math.exp(-event.deltaY * 0.002);
        setView((v) => zoomAt(v, at, factor));
      } else {
        setView((v) => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }));
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [broken]);

  const local = (clientX: number, clientY: number): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: clientX, y: clientY };
  };
  const pageAt = (clientX: number, clientY: number): Point => screenToPage(view, local(clientX, clientY));
  /** The page point at the middle of the visible surface. */
  const centre = (): Point => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    return screenToPage(view, { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 });
  };

  const startGesture = (event: ReactPointerEvent<HTMLDivElement>, gesture: Gesture) => {
    gestureRef.current = gesture;
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const eraseAt = (at: Point) => {
    const radius = ERASER_RADIUS / view.zoom;
    preview((f) => {
      const ids = eraseHits(strokesOf(f), at, radius);
      return ids.length > 0 ? removeItems(f, new Set(ids)) : f;
    });
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (isTextEntry(event.target) || gestureRef.current !== null) return;
    if (focusesOnPress({ screenActive, textEntry: false })) wrapperRef.current?.focus({ preventScroll: true });
    if (editingId !== null) endEdit();
    const target = event.target instanceof Element ? event.target : null;
    const card = target?.closest<HTMLElement>("[data-node-id]") ?? null;
    const at = pageAt(event.clientX, event.clientY);
    const screen = local(event.clientX, event.clientY);

    if (event.button === 1) {
      event.preventDefault();
      startGesture(event, { kind: "pan", screen, view });
      return;
    }
    if (event.button !== 0) return;

    if (mode === "pen") {
      const first = { x: at.x, y: at.y, pressure: event.pressure > 0 ? event.pressure : 0.5 };
      startGesture(event, { kind: "ink", points: [first], colour, width });
      setDraft({ points: [first], colour, width });
      return;
    }
    if (mode === "eraser") {
      startGesture(event, { kind: "erase", base: fileRef.current });
      eraseAt(at);
      return;
    }

    const raw = card ? fileRef.current.nodes.find((node) => node.id === card.dataset.nodeId) : undefined;
    if (raw && target?.closest("[data-resize]")) {
      const box = nodeBox(raw);
      startGesture(event, {
        kind: "resize",
        base: fileRef.current,
        id: raw.id,
        origin: at,
        size: { width: box.width, height: box.height },
        picture: isPicturePath(raw.file),
      });
      return;
    }
    // In select mode a press on empty page picks the topmost stroke there, if any.
    const hit = raw?.id ?? (mode === "select" ? strokeAt(strokesOf(fileRef.current), at, ERASER_RADIUS / view.zoom) : undefined);
    if (hit) {
      const next = event.shiftKey ? new Set([...selected, hit]) : selected.has(hit) ? selected : new Set([hit]);
      setSelected(next);
      // Group members are found once, at press, by the Rust core.
      startGesture(event, { kind: "move", base: fileRef.current, ids: withMembers(next), origin: at });
      return;
    }
    if (mode === "type") {
      createText(at);
      return;
    }
    setSelected(new Set());
    startGesture(event, { kind: "pan", screen, view });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || event.pointerId !== pointerRef.current) return;
    const screen = local(event.clientX, event.clientY);
    const at = screenToPage(view, screen);
    if (g.kind === "pan") {
      setView({ ...g.view, x: g.view.x + screen.x - g.screen.x, y: g.view.y + screen.y - g.screen.y });
    } else if (g.kind === "ink") {
      g.points.push({ x: at.x, y: at.y, pressure: event.pressure > 0 ? event.pressure : 0.5 });
      setDraft({ points: g.points.slice(), colour: g.colour, width: g.width });
    } else if (g.kind === "erase") {
      eraseAt(at);
    } else if (g.kind === "move") {
      const dx = at.x - g.origin.x;
      const dy = at.y - g.origin.y;
      preview(() => moveItems(g.base, g.ids, dx, dy));
    } else {
      const dx = at.x - g.origin.x;
      const dy = at.y - g.origin.y;
      const size = g.picture
        ? resizeKeepAspect(g.size, dx)
        : { width: Math.max(MIN_SIZE, Math.round(g.size.width + dx)), height: Math.max(MIN_SIZE, Math.round(g.size.height + dy)) };
      preview(() => patchNode(g.base, g.id, { width: size.width, height: size.height }));
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const g = gestureRef.current;
    if (!g || event.pointerId !== pointerRef.current) return;
    gestureRef.current = null;
    pointerRef.current = null;
    if (g.kind === "ink") {
      setDraft(null);
      if (g.points.length > 0) {
        const stroke = encodeStroke({ id: newCanvasId(), width: g.width, colour: g.colour, points: g.points });
        edit((f) => addStroke(f, stroke));
      }
    } else if (g.kind === "erase" || g.kind === "move" || g.kind === "resize") {
      commit(g.base);
    }
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (mode !== "select" || isTextEntry(event.target)) return;
    if (event.target instanceof Element && event.target.closest("[data-node-id]")) return;
    createText(pageAt(event.clientX, event.clientY));
  };

  /** Stores pictures and places each as a file node, one after another from `at`. */
  const addPictures = async (pictures: File[], at: Point) => {
    let spot = at;
    for (const picture of pictures) {
      try {
        const path = await images.store(picture);
        const size = pictureSize(await loadNaturalSize(picture));
        const raw = makeNode("file", spot, size, { file: `${prefix}${path}` });
        edit((f) => addNode(f, raw));
        setSelected(new Set([raw.id]));
        spot = { x: spot.x + 24, y: spot.y + 24 };
      } catch (err) {
        setPictureError(formatError(err));
      }
    }
  };

  const onDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (Array.from(event.dataTransfer.types).includes("Files")) event.preventDefault();
  };
  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    if (isTextEntry(event.target)) return;
    const pictures = Array.from(event.dataTransfer.files).filter(isImage);
    if (pictures.length === 0) return;
    event.preventDefault();
    void addPictures(pictures, pageAt(event.clientX, event.clientY));
  };
  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (isTextEntry(event.target)) return;
    const pictures = Array.from(event.clipboardData.files).filter(isImage);
    if (pictures.length === 0) return;
    event.preventDefault();
    void addPictures(pictures, centre());
  };

  /** Undo or redo from the toolbar: an open text edit is closed first, so it becomes the entry undone. */
  const stepHistory = (step: (h: History<CanvasFile>) => History<CanvasFile>) => {
    endEdit();
    setHist((h) => step(h));
  };
  const chooseMode = (next: Mode) => {
    endEdit();
    setMode(next);
  };
  const zoomBy = (factor: number) => {
    const rect = surfaceRef.current?.getBoundingClientRect();
    const at = { x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 };
    setView((v) => zoomAt(v, at, factor));
  };
  const addGroup = () => {
    const at = centre();
    const raw = makeNode("group", { x: at.x - 160, y: at.y - 100 }, GROUP_SIZE);
    edit((f) => addNode(f, raw));
    setSelected(new Set([raw.id]));
  };

  const addFile = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const path = filePath.trim();
    if (!path) return;
    const at = centre();
    edit((f) => addNode(f, makeNode("file", { x: at.x - 160, y: at.y - 60 }, CARD_SIZE, { file: path })));
    setFilePath("");
  };
  const addLink = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const address = url.trim();
    if (!address) return;
    const at = centre();
    edit((f) => addNode(f, makeNode("link", { x: at.x - 160, y: at.y - 60 }, CARD_SIZE, { url: address })));
    setUrl("");
  };

  if (broken) {
    return (
      <div className="canvas-editor canvas-editor--broken" role="alert">
        <p>This canvas cannot be shown, so it is left as it is.</p>
        <p className="muted">{loadError}</p>
      </div>
    );
  }

  const noteTransfer = (warnings: string[]) =>
    setTransferNote(warnings.length === 0 ? null : `${warnings.length} ${warnings.length === 1 ? "detail" : "details"} could not carry over: ${warnings.join("; ")}`);

  /** Adds an Excalidraw drawing to the page as one undoable step. */
  const importDrawingFile = async (drawing: File) => {
    try {
      const result = await importDrawing(fileRef.current, await drawing.text(), images.store);
      edit(() => result.file);
      noteTransfer(result.warnings);
    } catch (err) {
      setTransferNote(`Could not import ${drawing.name}: ${formatError(err)}`);
    }
  };

  const exportDrawingFile = async () => {
    try {
      const result = await exportDrawing(fileRef.current, images.fetch);
      downloadBlob(new Blob([result.json], { type: "application/json" }), "page.excalidraw");
      noteTransfer(result.warnings);
    } catch (err) {
      setTransferNote(`Could not export the page: ${formatError(err)}`);
    }
  };

  const problem = loadError ?? saveError ?? pictureError ?? transferNote;

  return (
    <div
      className="canvas-editor"
      ref={wrapperRef}
      // Focusable (by Tab too) so the delete, undo and arrow keys, which need focus inside the canvas, reach it.
      tabIndex={0}
      aria-label="Freeform page"
      onFocus={() => setFocusWithin(true)}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFocusWithin(false);
        endEdit();
      }}
      onPaste={onPaste}
    >
      <div className="canvas-editor__bar" role="toolbar" aria-label="Canvas">
        <div className="canvas-editor__modes" role="group" aria-label="Mode">
          {MODES.map(({ mode: m, label, icon }) => (
            <IconButton key={m} label={label} size="sm" aria-pressed={mode === m} onClick={() => chooseMode(m)}>
              {icon}
            </IconButton>
          ))}
        </div>
        <input type="color" aria-label="Pen colour" value={colour} onChange={(event) => setColour(event.target.value)} />
        <Select aria-label="Pen width" value={width} onChange={(event) => setWidth(Number(event.target.value))}>
          {PEN_WIDTHS.map((w) => (
            <option key={w} value={w}>
              {w} px
            </option>
          ))}
        </Select>
        <IconButton label="Undo" size="sm" disabled={!canUndo(hist)} onClick={() => stepHistory(undo)}>
          <Glyph d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
        </IconButton>
        <IconButton label="Redo" size="sm" disabled={!canRedo(hist)} onClick={() => stepHistory(redo)}>
          <Glyph d="M15 14l5-5-5-5M20 9H10a6 6 0 0 0 0 12h3" />
        </IconButton>
        <IconButton label="Zoom out" size="sm" onClick={() => zoomBy(1 / 1.25)}>
          −
        </IconButton>
        <span className="canvas-editor__zoom">{Math.round(view.zoom * 100)}%</span>
        <IconButton label="Zoom in" size="sm" onClick={() => zoomBy(1.25)}>
          +
        </IconButton>
        <Button size="sm" onClick={() => createText(centre())}>
          Text
        </Button>
        <Button size="sm" onClick={addGroup}>
          Group
        </Button>
        <form onSubmit={addFile} className="canvas-editor__add">
          <input
            aria-label="Note or file path"
            placeholder="Note or file…"
            list="canvas-file-paths"
            value={filePath}
            onChange={(event) => setFilePath(event.target.value)}
          />
          <datalist id="canvas-file-paths">
            {filePaths.map((path) => (
              <option key={path} value={path} />
            ))}
          </datalist>
          <Button type="submit" size="sm">
            Add file
          </Button>
        </form>
        <form onSubmit={addLink} className="canvas-editor__add">
          <input aria-label="Web address" placeholder="https://…" type="url" value={url} onChange={(event) => setUrl(event.target.value)} />
          <Button type="submit" size="sm">
            Add link
          </Button>
        </form>
        <Button size="sm" onClick={() => drawingInputRef.current?.click()}>
          Import Excalidraw
        </Button>
        <input
          ref={drawingInputRef}
          type="file"
          accept=".excalidraw,.md,.json,application/json"
          hidden
          aria-label="Excalidraw drawing"
          onChange={(event) => {
            const drawing = event.target.files?.[0];
            event.target.value = "";
            if (drawing) void importDrawingFile(drawing);
          }}
        />
        <Button size="sm" onClick={() => void exportDrawingFile()}>
          Export Excalidraw
        </Button>
        {problem ? (
          <span className="canvas-editor__status" role="alert">
            {problem}
          </span>
        ) : issues.length > 0 ? (
          <span className="canvas-editor__status muted" title={issues.map((issue: { message: string }) => issue.message).join("\n")}>
            {issues.length} {issues.length === 1 ? "issue" : "issues"} in this canvas
          </span>
        ) : null}
      </div>
      <div
        className="canvas-surface"
        ref={surfaceRef}
        data-mode={mode}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <div className="canvas-page" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}>
          <EdgeLayer nodes={file.nodes} edges={file.edges} />
          {file.nodes.map((raw) => {
            const picture = pictureOf(raw, prefix);
            return (
              <CanvasCard
                key={raw.id}
                raw={raw}
                selected={live.has(raw.id)}
                editing={editingId === raw.id}
                pictureUrl={picture ? pictureUrls.get(picture) : undefined}
                paste={images.paste}
                openFile={onOpenFile}
                onChange={(patch) => preview((f) => patchNode(f, raw.id, patch))}
                onEditStart={() => beginEdit(raw.id)}
                onEditEnd={endEdit}
                onSelect={() => setSelected(new Set([raw.id]))}
              />
            );
          })}
          <InkLayer strokes={strokesOf(file)} selected={live} draft={draft} />
        </div>
      </div>
    </div>
  );
}
