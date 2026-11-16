"use client";

import "@xyflow/react/dist/style.css";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type MouseEvent } from "react";
import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type OnNodeDrag,
} from "@xyflow/react";
import { readyCore } from "@/lib/rust-core";
import { formatError } from "@/lib/format-error";
import { useScreenActive } from "@/lib/hooks/use-screen-active";
import { Button } from "@/components/button";
import {
  fromFlow,
  groupCarry,
  makeNode,
  moveMembers,
  newCanvasId,
  parseCanvasFile,
  toFlow,
  type CanvasFile,
  type CanvasFlowEdge,
  type RawCanvasEdge,
} from "../application/canvas-doc";
import { CanvasSaver } from "../application/canvas-save";
import { deleteKeysFor, focusesOnPress } from "../application/canvas-keys";
import { CanvasActionsContext, NODE_TYPES, type FlowNode } from "./canvas-nodes";

type FlowEdge = Edge<{ raw: RawCanvasEdge }>;

export interface CanvasEditorProps {
  /** The canvas note's body: JSON Canvas text. */
  body: string;
  /** Writes the body through the note's normal save path. */
  onSave: (body: string) => unknown;
  /** Paths a file node can point to, offered while typing one. */
  filePaths: readonly string[];
  /** Opens what a file node points to; false when nothing matches. */
  onOpenFile: (path: string) => boolean;
}

/** Obsidian's six preset colours, drawn in the theme's status colours. */
const PRESET_STROKE: Record<string, string> = {
  "1": "var(--s-danger)",
  "2": "var(--s-warn)",
  "3": "var(--s-warn)",
  "4": "var(--s-good)",
  "5": "var(--s-info)",
  "6": "var(--accent)",
};

const ARROW = { type: MarkerType.ArrowClosed } as const;

/** Whether keys typed at `target` go into a field or a card's text, not the canvas. */
function isTextEntry(target: EventTarget): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || target.closest("input, textarea, select, [contenteditable]") !== null);
}

/** An edge as React Flow draws it: ends as arrow markers, colour as its stroke. */
function drawnEdge(edge: CanvasFlowEdge): FlowEdge {
  const { markerStart, markerEnd, color, ...rest } = edge;
  const stroke = color ? (PRESET_STROKE[color] ?? color) : undefined;
  return {
    ...rest,
    ...(markerStart ? { markerStart: { ...ARROW, ...(stroke ? { color: stroke } : {}) } } : {}),
    ...(markerEnd ? { markerEnd: { ...ARROW, ...(stroke ? { color: stroke } : {}) } } : {}),
    ...(stroke ? { style: { stroke } } : {}),
  };
}

interface Loaded {
  file: CanvasFile;
  nodes: FlowNode[];
  edges: FlowEdge[];
}

function load(text: string): Loaded {
  const file = parseCanvasFile(text);
  const flow = toFlow(file);
  return { file, nodes: flow.nodes, edges: flow.edges.map(drawnEdge) };
}

/** The canvas as JSON Canvas text, laid out as Obsidian writes it. */
function canvasText(file: CanvasFile, nodes: readonly FlowNode[], edges: readonly FlowEdge[]): string {
  return readyCore().normalizeCanvasText(JSON.stringify(fromFlow(file, nodes, edges)));
}

/**
 * A canvas note, edited in place: pan, zoom, add, move, resize, connect and
 * delete; text nodes edit as markdown. Changes save themselves through
 * `onSave`. A body that is not a canvas is shown as an error and never
 * overwritten.
 */
export default function CanvasEditor(props: CanvasEditorProps) {
  return (
    <ReactFlowProvider>
      <CanvasSurface {...props} />
    </ReactFlowProvider>
  );
}

function CanvasSurface({ body, onSave, filePaths, onOpenFile }: CanvasEditorProps) {
  const [initial] = useState(() => {
    try {
      return { loaded: load(body), error: null };
    } catch (err) {
      return { loaded: null, error: formatError(err) };
    }
  });
  // A load error means the body is not a canvas: the editor halts and never saves over it.
  const [loadError, setLoadError] = useState<string | null>(initial.error);
  // A failed write is shown but does not halt: the edit stays pending and saves on the next change or flush.
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.loaded?.nodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(initial.loaded?.edges ?? []);
  const fileRef = useRef<CanvasFile>(initial.loaded?.file ?? { nodes: [], edges: [] });
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const { screenToFlowPosition } = useReactFlow<FlowNode, FlowEdge>();
  const wrapRef = useRef<HTMLDivElement>(null);
  const screenActive = useScreenActive();
  const [focusWithin, setFocusWithin] = useState(false);
  const [editing, setEditing] = useState(false);
  const deleteKeys = deleteKeysFor({ screenActive, focusWithin, editing });
  const [saver] = useState(
    () =>
      new CanvasSaver({
        loaded: body,
        write: (text) => {
          fileRef.current = parseCanvasFile(text);
          return onSaveRef.current(text);
        },
        onError: (err) => setSaveError(formatError(err)),
        onSaved: () => setSaveError(null),
      }),
  );
  const readText = useCallback(() => canvasText(fileRef.current, nodesRef.current, edgesRef.current), []);

  const issues = useMemo(() => {
    try {
      return loadError ? [] : readyCore().validateCanvasText(body);
    } catch {
      return [];
    }
  }, [body, loadError]);

  // The body changed outside this editor (another device, an import): show it.
  // Our own saves echo back through here, and a change still waiting to save
  // wins over an incoming body: both are left alone.
  useEffect(() => {
    if (saver.isOwnEcho(body) || saver.hasPending()) return;
    saver.markLoaded(body);
    try {
      const next = load(body);
      fileRef.current = next.file;
      setNodes(next.nodes);
      setEdges(next.edges);
      setLoadError(null);
    } catch (err) {
      setLoadError(formatError(err));
    }
  }, [body, saver, setNodes, setEdges]);

  // Save a moment after the last change. A broken body is never saved over.
  useEffect(() => {
    if (loadError) {
      saver.halt();
      return;
    }
    saver.resume();
    saver.touch(readText);
  }, [nodes, edges, loadError, saver, readText]);
  // Leaving mid-wait still saves: closing the tab, navigating away, unmounting.
  useEffect(() => {
    const save = () => saver.flush(readText);
    window.addEventListener("pagehide", save, { passive: true });
    window.addEventListener("beforeunload", save, { passive: true });
    return () => {
      window.removeEventListener("pagehide", save);
      window.removeEventListener("beforeunload", save);
      saver.flush(readText);
    };
  }, [saver, readText]);

  // Dragging a group carries the nodes inside it, as in Obsidian. Members are
  // found once, at drag start, by the Rust core's geometry.
  const groupDrag = useRef<{ id: string; members: string[]; last: { x: number; y: number } } | null>(null);
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback((_event, node, dragged) => {
    if (!dragged.some((n) => n.type === "group")) {
      groupDrag.current = null;
      return;
    }
    const text = JSON.stringify(fromFlow(fileRef.current, nodesRef.current, edgesRef.current));
    const members = groupCarry(dragged, (id) => readyCore().canvasGroupMembers(text, id));
    groupDrag.current = { id: node.id, members, last: { ...node.position } };
  }, []);
  const onNodeDrag: OnNodeDrag<FlowNode> = useCallback(
    (_event, node) => {
      const drag = groupDrag.current;
      if (!drag || drag.id !== node.id) return;
      const delta = { x: node.position.x - drag.last.x, y: node.position.y - drag.last.y };
      if (delta.x === 0 && delta.y === 0) return;
      drag.last = { ...node.position };
      setNodes((current) => moveMembers(current, drag.members, delta));
    },
    [setNodes],
  );
  const onNodeDragStop: OnNodeDrag<FlowNode> = useCallback(
    (event, node, dragged) => {
      onNodeDrag(event, node, dragged);
      groupDrag.current = null;
    },
    [onNodeDrag],
  );

  const onConnect = useCallback(
    (connection: Connection) => setEdges((current) => addEdge({ ...connection, id: newCanvasId(), markerEnd: ARROW }, current)),
    [setEdges],
  );

  /** The flow point at the middle of the visible canvas. */
  const centre = useCallback(() => {
    const box = wrapRef.current?.getBoundingClientRect();
    if (!box) return { x: 0, y: 0 };
    return screenToFlowPosition({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
  }, [screenToFlowPosition]);

  const add = useCallback(
    (raw: ReturnType<typeof makeNode>) => {
      const [node] = toFlow({ nodes: [raw], edges: [] }).nodes;
      setNodes((current) => [...current.map((n) => ({ ...n, selected: false })), { ...node!, selected: true }]);
    },
    [setNodes],
  );
  const addAtCentre = (kind: "text" | "group") => {
    const at = centre();
    add(makeNode(kind, { x: at.x - 125, y: at.y - 30 }));
  };

  // A double-click on empty canvas adds a text card there, as in Obsidian.
  const onDoubleClick = (event: MouseEvent) => {
    if (!(event.target instanceof Element) || !event.target.classList.contains("react-flow__pane")) return;
    const at = screenToFlowPosition({ x: event.clientX, y: event.clientY });
    add(makeNode("text", { x: at.x - 125, y: at.y - 30 }));
  };

  const [filePath, setFilePath] = useState("");
  const [url, setUrl] = useState("");
  const addFile = (event: FormEvent) => {
    event.preventDefault();
    if (!filePath.trim()) return;
    const at = centre();
    add(makeNode("file", { x: at.x - 200, y: at.y - 200 }, { file: filePath.trim() }));
    setFilePath("");
  };
  const addLink = (event: FormEvent) => {
    event.preventDefault();
    if (!url.trim()) return;
    const at = centre();
    add(makeNode("link", { x: at.x - 200, y: at.y - 200 }, { url: url.trim() }));
    setUrl("");
  };

  const actions = useMemo(() => ({ openFile: onOpenFile }), [onOpenFile]);

  if (loadError && nodes.length === 0 && edges.length === 0 && initial.error) {
    return (
      <div className="canvas-editor canvas-editor--broken" role="alert">
        <p>This canvas cannot be shown, so it is left as it is.</p>
        <p className="muted">{loadError}</p>
      </div>
    );
  }

  return (
    <div
      className="canvas-editor"
      ref={wrapRef}
      // Focusable so a press can move focus here; the delete keys need focus inside the canvas.
      tabIndex={-1}
      onMouseDown={(event) => {
        if (focusesOnPress({ screenActive, textEntry: isTextEntry(event.target) })) wrapRef.current?.focus({ preventScroll: true });
      }}
      onDoubleClick={onDoubleClick}
      onFocus={(event) => {
        setFocusWithin(true);
        setEditing(isTextEntry(event.target));
      }}
      onBlur={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
        setFocusWithin(false);
        setEditing(false);
      }}
    >
      <div className="canvas-editor__bar" role="toolbar" aria-label="Canvas">
        <Button size="sm" onClick={() => addAtCentre("text")}>
          Text
        </Button>
        <Button size="sm" onClick={() => addAtCentre("group")}>
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
        {loadError ?? saveError ? (
          <span className="canvas-editor__status" role="alert">
            {loadError ?? saveError}
          </span>
        ) : issues.length > 0 ? (
          <span className="canvas-editor__status muted" title={issues.map((issue: { message: string }) => issue.message).join("\n")}>
            {issues.length} {issues.length === 1 ? "issue" : "issues"} in this canvas
          </span>
        ) : null}
      </div>
      <CanvasActionsContext.Provider value={actions}>
        <ReactFlow<FlowNode, FlowEdge>
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          onNodeDragStart={onNodeDragStart}
          onNodeDrag={onNodeDrag}
          onNodeDragStop={onNodeDragStop}
          connectionMode={ConnectionMode.Loose}
          deleteKeyCode={deleteKeys}
          elevateNodesOnSelect={false}
          zoomOnDoubleClick={false}
          minZoom={0.1}
          maxZoom={4}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </CanvasActionsContext.Provider>
    </div>
  );
}
