"use client";

import { createContext, useContext, useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { Handle, NodeResizer, Position, useReactFlow, type Node, type NodeProps } from "@xyflow/react";
import { Markdown } from "@/components/markdown/markdown";
import { MarkdownFieldEditor } from "@/components/markdown/markdown-field-editor";
import { useVaultImageSource } from "@/lib/hooks/use-vault-markdown-source";
import type { RawCanvasNode } from "../application/canvas-doc";

/** A node as React Flow holds it: the stored object rides along in `data.raw`. */
export type FlowNode = Node<{ raw: RawCanvasNode }>;

/** What a node can ask of the screen around the canvas. */
export interface CanvasActions {
  /** Opens the note or paper a file node points to; false when nothing matches. */
  openFile: (path: string) => boolean;
}

export const CanvasActionsContext = createContext<CanvasActions>({ openFile: () => false });

const SIDES = [
  ["top", Position.Top],
  ["right", Position.Right],
  ["bottom", Position.Bottom],
  ["left", Position.Left],
] as const;

/** A preset colour (`1`..`6`) is styled by the theme; a hex one is the file's own. */
function colorProps(color: string | undefined): { "data-color"?: string; style?: CSSProperties } {
  if (!color) return {};
  if (/^[1-6]$/.test(color)) return { "data-color": color };
  return { style: { borderColor: color } };
}

/** The box every node kind draws in: resize corners when selected, a handle on each side. */
function NodeFrame({ raw, selected, kind, children }: { raw: RawCanvasNode; selected: boolean; kind: string; children: ReactNode }) {
  return (
    <div className={`canvas-node canvas-node--${kind}`} {...colorProps(raw.color)}>
      <NodeResizer isVisible={selected} minWidth={40} minHeight={30} />
      {SIDES.flatMap(([id, position]) => [
        <Handle key={`s-${id}`} id={id} type="source" position={position} className="canvas-node__handle" />,
        <Handle key={`t-${id}`} id={id} type="target" position={position} className="canvas-node__handle" />,
      ])}
      {children}
    </div>
  );
}

/** Markdown, shown rendered; a double-click opens the note editor on it. */
function TextNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { updateNodeData } = useReactFlow<FlowNode>();
  const [editing, setEditing] = useState(false);
  const raw = data.raw;
  // Read mode shows the same pictures a note page does: `vault:` refs resolve to blob URLs.
  const readSource = useVaultImageSource(raw.text ?? "");
  // Clicking elsewhere on the canvas deselects the node and ends the edit.
  useEffect(() => {
    if (!selected) setEditing(false);
  }, [selected]);
  return (
    <NodeFrame raw={raw} selected={selected} kind="text">
      {editing ? (
        <div
          className="canvas-node__body nodrag nowheel nopan"
          onKeyDown={(event) => {
            if (event.key === "Escape") setEditing(false);
            // Backspace and Delete edit the text, not the canvas.
            event.stopPropagation();
          }}
        >
          <MarkdownFieldEditor
            value={raw.text ?? ""}
            onChange={(text) => updateNodeData(id, { raw: { ...raw, text } })}
            placeholder="Write markdown…"
          />
        </div>
      ) : (
        <div className="canvas-node__body" onDoubleClick={() => setEditing(true)} title="Double-click to edit">
          {raw.text ? <Markdown>{readSource}</Markdown> : <p className="muted">Double-click to write.</p>}
        </div>
      )}
    </NodeFrame>
  );
}

/** A note, paper or attachment by path; a double-click opens it. */
function FileNode({ data, selected }: NodeProps<FlowNode>) {
  const raw = data.raw;
  const { openFile } = useContext(CanvasActionsContext);
  const [missing, setMissing] = useState(false);
  const name = (raw.file ?? "").split("/").pop() || "(no file)";
  return (
    <NodeFrame raw={raw} selected={selected} kind="file">
      <div
        className="canvas-node__body"
        onDoubleClick={() => setMissing(!openFile(raw.file ?? ""))}
        title="Double-click to open"
      >
        <strong>{name}</strong>
        {raw.subpath ? <span className="muted"> {raw.subpath}</span> : null}
        <p className="muted canvas-node__path">{raw.file}</p>
        {missing ? <p className="muted">Not in this workspace.</p> : null}
      </div>
    </NodeFrame>
  );
}

/** A web page; the address opens in the browser, never inside the app. */
function LinkNode({ data, selected }: NodeProps<FlowNode>) {
  const raw = data.raw;
  const safe = /^https?:\/\//i.test(raw.url ?? "");
  return (
    <NodeFrame raw={raw} selected={selected} kind="link">
      <div className="canvas-node__body">
        {safe ? (
          <a href={raw.url} target="_blank" rel="noopener noreferrer" className="nodrag">
            {raw.url}
          </a>
        ) : (
          <span>{raw.url || "(no address)"}</span>
        )}
      </div>
    </NodeFrame>
  );
}

/** A labelled area; moving it moves what lies inside. */
function GroupNode({ id, data, selected }: NodeProps<FlowNode>) {
  const { updateNodeData } = useReactFlow<FlowNode>();
  const raw = data.raw;
  return (
    <NodeFrame raw={raw} selected={selected} kind="group">
      <input
        className="canvas-node__label nodrag"
        aria-label="Group label"
        value={raw.label ?? ""}
        placeholder="Group"
        onChange={(event) => updateNodeData(id, { raw: { ...raw, label: event.target.value } })}
        onKeyDown={(event) => event.stopPropagation()}
      />
    </NodeFrame>
  );
}

/** A node type from a later spec or a plugin: kept and moved, not drawn. */
function UnknownNode({ data, selected }: NodeProps<FlowNode>) {
  return (
    <NodeFrame raw={data.raw} selected={selected} kind="unknown">
      <p className="canvas-node__body muted">{data.raw.type} node</p>
    </NodeFrame>
  );
}

export const NODE_TYPES = {
  text: TextNode,
  file: FileNode,
  link: LinkNode,
  group: GroupNode,
  unknown: UnknownNode,
};
