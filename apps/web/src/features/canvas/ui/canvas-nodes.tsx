"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Markdown } from "@/components/markdown/markdown";
import { MarkdownFieldEditor } from "@/components/markdown/markdown-field-editor";
import type { ImagePasteConfig } from "@/components/markdown/markdown-image-paste";
import { isPicturePath, nodeBox, nodeKind, nodeLabel, type CanvasNodeKind, type RawCanvasNode } from "../application/canvas-doc";

/** A preset colour (`1`..`6`) is styled by the theme; a hex one is the file's own. */
function colorOf(color: string | undefined): { attr?: string; style?: CSSProperties } {
  if (!color) return {};
  if (/^[1-6]$/.test(color)) return { attr: color };
  return { style: { borderColor: color } };
}

export interface CanvasCardProps {
  raw: RawCanvasNode;
  selected: boolean;
  /** This text node is open in the markdown editor. */
  editing: boolean;
  /** Object URL of a picture node's bytes, once fetched. */
  pictureUrl?: string;
  paste: ImagePasteConfig;
  openFile: (path: string) => boolean;
  /** Changes fields of this node (text, label, height). */
  onChange: (patch: Partial<RawCanvasNode>) => void;
  onEditStart: () => void;
  onEditEnd: () => void;
  /** Makes this card the selection (when it gets focus from the keyboard). */
  onSelect: () => void;
}

/**
 * One node drawn at its stored box in page coordinates; the surface finds it by `data-node-id`.
 * Cards are in the Tab order: focus selects one (so Delete and the arrows act on it), Enter opens it.
 */
export function CanvasCard(props: CanvasCardProps) {
  const { raw, selected } = props;
  const kind = nodeKind(raw);
  const box = nodeBox(raw);
  const color = colorOf(raw.color);
  return (
    <div
      className={`canvas-node canvas-node--${kind}${selected ? " canvas-node--selected" : ""}`}
      data-node-id={raw.id}
      data-color={color.attr}
      style={{ left: box.x, top: box.y, width: box.width, height: box.height, ...color.style }}
      tabIndex={0}
      role="group"
      aria-label={nodeLabel(raw)}
      onFocus={(event) => {
        // Keyboard focus only: a click selects through the surface, with Shift for more than one.
        if (event.target === event.currentTarget && event.currentTarget.matches(":focus-visible")) props.onSelect();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || event.key !== "Enter") return;
        event.preventDefault();
        openCard(props, event.currentTarget);
      }}
    >
      <CardBody {...props} kind={kind} />
      {selected ? <span className="canvas-node__resize" data-resize="" aria-hidden="true" /> : null}
    </div>
  );
}

/** What Enter on a focused card does: edit a text card or a group's label, open a file, follow a link. */
function openCard({ raw, openFile, onEditStart }: CanvasCardProps, card: HTMLElement) {
  switch (nodeKind(raw)) {
    case "text":
      onEditStart();
      return;
    case "file":
      openFile(raw.file ?? "");
      return;
    default:
      card.querySelector<HTMLElement>("input, a")?.focus();
  }
}

function CardBody(props: CanvasCardProps & { kind: CanvasNodeKind }) {
  switch (props.kind) {
    case "text":
      return <TextBody {...props} />;
    case "file":
      return isPicturePath(props.raw.file) && props.pictureUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- blob object URL, not optimisable
        <img className="canvas-node__picture" src={props.pictureUrl} alt={props.raw.file?.split("/").pop() ?? ""} draggable={false} />
      ) : (
        <FileBody {...props} />
      );
    case "link":
      return <LinkBody raw={props.raw} />;
    case "group":
      return <GroupBody {...props} />;
    default:
      return <p className="canvas-node__body muted">{props.raw.type} node</p>;
  }
}

/** Markdown, shown rendered; a double-click opens the markdown editor on it. */
function TextBody({ raw, editing, paste, onChange, onEditStart, onEditEnd }: CanvasCardProps) {
  const bodyRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editing) bodyRef.current?.querySelector<HTMLElement>(".cm-content")?.focus();
  }, [editing]);
  // While a text box is edited it grows to fit its text (page units: scrollHeight ignores the zoom).
  useEffect(() => {
    const el = bodyRef.current;
    if (!editing || !el) return;
    const fit = Math.ceil(el.scrollHeight);
    if (fit > raw.height) onChange({ height: fit });
  }, [editing, raw.text, raw.height, onChange]);

  if (!editing) {
    return (
      <div className="canvas-node__body" onDoubleClick={onEditStart} title="Double-click to edit">
        {raw.text ? <Markdown>{raw.text}</Markdown> : <p className="muted">Double-click to write.</p>}
      </div>
    );
  }
  return (
    <div
      ref={bodyRef}
      className="canvas-node__body canvas-node__editor"
      onKeyDown={(event) => {
        // Keys typed into the text stay in the text: no delete, no page undo.
        event.stopPropagation();
        if (event.key === "Escape") onEditEnd();
      }}
    >
      <MarkdownFieldEditor value={raw.text ?? ""} onChange={(text) => onChange({ text })} placeholder="Write markdown…" imagePaste={paste} />
    </div>
  );
}

/** A note, paper or attachment by path; a double-click opens it. */
function FileBody({ raw, openFile }: CanvasCardProps) {
  const [missing, setMissing] = useState(false);
  const name = (raw.file ?? "").split("/").pop() || "(no file)";
  return (
    <div className="canvas-node__body" onDoubleClick={() => setMissing(!openFile(raw.file ?? ""))} title="Double-click to open">
      <strong>{name}</strong>
      {raw.subpath ? <span className="muted"> {raw.subpath}</span> : null}
      <p className="muted canvas-node__path">{raw.file}</p>
      {missing ? <p className="muted">Not in this workspace.</p> : null}
    </div>
  );
}

/** A web page; the address opens in the browser, never inside the app. */
function LinkBody({ raw }: { raw: RawCanvasNode }) {
  const safe = /^https?:\/\//i.test(raw.url ?? "");
  return (
    <div className="canvas-node__body">
      {safe ? (
        <a href={raw.url} target="_blank" rel="noopener noreferrer" draggable={false}>
          {raw.url}
        </a>
      ) : (
        <span>{raw.url || "(no address)"}</span>
      )}
    </div>
  );
}

/** A labelled area. Its label is typed in place; the area itself is moved and resized on the surface. */
function GroupBody({ raw, onChange, onEditStart, onEditEnd }: CanvasCardProps) {
  return (
    <input
      className="canvas-node__label"
      aria-label="Group label"
      value={raw.label ?? ""}
      placeholder="Group"
      onFocus={onEditStart}
      onBlur={onEditEnd}
      onChange={(event) => onChange({ label: event.target.value })}
    />
  );
}
