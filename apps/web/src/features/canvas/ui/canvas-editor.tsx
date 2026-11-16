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
import { Button } from "@/components/button";
import {
  fromFlow,
  makeNode,
  moveMembers,
  newCanvasId,
  parseCanvasFile,
  toFlow,
  type CanvasFile,
  type CanvasFlowEdge,
  type RawCanvasEdge,
} from "../application/canvas-doc";
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

/** How long the canvas waits after the last change before it saves. */
const SAVE_DELAY_MS = 600;

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
  const [error, setError] = useState<string | null>(initial.error);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initial.loaded?.nodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>(initial.loaded?.edges ?? []);
  const fileRef = useRef<CanvasFile>(initial.loaded?.file ?? { nodes: [], edges: [] });
  /** The body this editor last showed or wrote: an incoming body equal to it is our own echo. */
  const bodyRef = useRef(body);
  /** The text of what is on screen when it was last loaded or saved; saving the same text is a no-op. */
  const savedRef = useRef<string | null>(null);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const edgesRef = useRef(edges);
  edgesRef.current = edges;
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const { screenToFlowPosition } = useReactFlow<FlowNode, FlowEdge>();
  const wrapRef = useRef<HTMLDivElement>(null);

  const issues = useMemo(() => {
    try {
      return error ? [] : readyCore().validateCanvasText(body);
    } catch {
      return [];
    }
  }, [body, error]);

  // The body changed outside this editor (another device, an import): show it.
  useEffect(() => {
    if (body === bodyRef.current) return;
    bodyRef.current = body;
    try {
      const next = load(body);
      fileRef.current = next.file;
      savedRef.current = null;
      setNodes(next.nodes);
      setEdges(next.edges);
      setError(null);
    } catch (err) {
      setError(formatError(err));
    }
  }, [body, setNodes, setEdges]);

  // Save a moment after the last change. The first pass only records what was
  // loaded, so opening a canvas never rewrites it.
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    pending.current = null;
    let text: string;
    try {
      text = canvasText(fileRef.current, nodesRef.current, edgesRef.current);
    } catch (err) {
      setError(formatError(err));
      return;
    }
    if (savedRef.current === null) {
      savedRef.current = text;
      return;
    }
    if (text === savedRef.current) return;
    savedRef.current = text;
    bodyRef.current = text;
    fileRef.current = parseCanvasFile(text);
    void Promise.resolve(onSaveRef.current(text)).catch((err) => setError(formatError(err)));
  }, []);
  useEffect(() => {
    if (error) return;
    if (savedRef.current === null) {
      flush();
      return;
    }
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(flush, SAVE_DELAY_MS);
  }, [nodes, edges, error, flush]);
  // Closing the tab mid-wait still saves.
  useEffect(
    () => () => {
      if (pending.current) {
        clearTimeout(pending.current);
        flush();
      }
    },
    [flush],
  );

  // Dragging a group carries the nodes inside it, as in Obsidian. Members are
  // found once, at drag start, by the Rust core's geometry.
  const groupDrag = useRef<{ id: string; members: string[]; last: { x: number; y: number } } | null>(null);
  const onNodeDragStart: OnNodeDrag<FlowNode> = useCallback((_event, node, dragged) => {
    if (node.type !== "group") {
      groupDrag.current = null;
      return;
    }
    const moving = new Set(dragged.map((n) => n.id));
    const text = JSON.stringify(fromFlow(fileRef.current, nodesRef.current, edgesRef.current));
    const members = readyCore()
      .canvasGroupMembers(text, node.id)
      .filter((id: string) => !moving.has(id));
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

  if (error && nodes.length === 0 && edges.length === 0 && initial.error) {
    return (
      <div className="canvas-editor canvas-editor--broken" role="alert">
        <p>This canvas cannot be shown, so it is left as it is.</p>
        <p className="muted">{error}</p>
      </div>
    );
  }

  return (
    <div className="canvas-editor" ref={wrapRef} onDoubleClick={onDoubleClick}>
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
        {error ? (
          <span className="canvas-editor__status" role="alert">
            {error}
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
          deleteKeyCode={["Backspace", "Delete"]}
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
