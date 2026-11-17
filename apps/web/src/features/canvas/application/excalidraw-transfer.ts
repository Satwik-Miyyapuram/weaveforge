/**
 * Excalidraw in and out of a freeform page. The Rust core converts the
 * drawing; this side moves the pictures through the page's store and joins
 * the drawing to what the page already holds.
 */

import { readyCore } from "@/lib/rust-core";
import { newCanvasId, parseCanvasFile, pictureOf, setInk, type CanvasFile } from "./canvas-doc";
import { strokesOf } from "./freeform-edit";

/** A page after the transfer, with one line per detail Excalidraw or the page could not carry. */
export interface DrawingImport {
  file: CanvasFile;
  warnings: string[];
}

export interface DrawingExport {
  json: string;
  warnings: string[];
}

function dataUrlBytes(dataUrl: string): { mime: string; bytes: Uint8Array<ArrayBuffer> } {
  const match = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("A picture in the drawing is not a data URL");
  const [, mime = "", base64, payload = ""] = match;
  const text = base64 ? atob(payload) : decodeURIComponent(payload);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return { mime, bytes };
}

async function blobDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "application/octet-stream"};base64,${btoa(text)}`;
}

/**
 * Adds an `.excalidraw` (or Obsidian `.excalidraw.md`) drawing to `page`.
 * Its pictures are stored first through `store`; an id the page already uses
 * gets a new one, so the same drawing can be imported twice.
 */
export async function importDrawing(page: CanvasFile, text: string, store: (file: File) => Promise<string>): Promise<DrawingImport> {
  const core = readyCore();
  const read = core.importExcalidraw(text);
  const drawing = parseCanvasFile(read.canvasText);
  const prefix = core.vaultImagePrefix();

  const pictures = new Map<string, string>();
  for (const image of read.images) {
    const { mime, bytes } = dataUrlBytes(image.dataUrl);
    const ext = mime.split("/")[1] ?? "png";
    pictures.set(image.nodeId, await store(new File([bytes], `${image.nodeId}.${ext}`, { type: mime })));
  }

  const taken = new Set([...page.nodes.map((node) => node.id), ...page.edges.map((edge) => edge.id), ...strokesOf(page).map((s) => s.id)]);
  const renamed = new Map<string, string>();
  const fresh = (id: string) => {
    if (!taken.has(id)) {
      taken.add(id);
      return id;
    }
    const next = newCanvasId();
    taken.add(next);
    renamed.set(id, next);
    return next;
  };
  const nodes = drawing.nodes.map((node) => {
    const stored = pictures.get(node.id);
    return { ...node, id: fresh(node.id), ...(stored === undefined ? {} : { file: `${prefix}${stored}` }) };
  });
  const edges = drawing.edges.map((edge) => ({
    ...edge,
    id: fresh(edge.id),
    fromNode: renamed.get(edge.fromNode) ?? edge.fromNode,
    toNode: renamed.get(edge.toNode) ?? edge.toNode,
  }));
  const strokes = strokesOf(drawing).map((stroke) => ({ ...stroke, id: fresh(stroke.id) }));

  const joined = { ...page, nodes: [...page.nodes, ...nodes], edges: [...page.edges, ...edges] };
  return { file: setInk(joined, [...strokesOf(page), ...strokes]), warnings: read.warnings };
}

/**
 * The page as `.excalidraw` JSON. Pictures are read through `fetchPicture`
 * and embedded; one that cannot be read is left out with a warning.
 */
export async function exportDrawing(page: CanvasFile, fetchPicture: (path: string) => Promise<Blob>): Promise<DrawingExport> {
  const core = readyCore();
  const prefix = core.vaultImagePrefix();
  const images = [];
  const missing: string[] = [];
  for (const node of page.nodes) {
    const path = pictureOf(node, prefix);
    if (path === undefined) continue;
    try {
      const blob = await fetchPicture(path);
      images.push({ nodeId: node.id, mime: blob.type, dataUrl: await blobDataUrl(blob) });
    } catch {
      missing.push(`Picture ${path} could not be read and was left out`);
    }
  }
  const written = core.exportExcalidraw(JSON.stringify(page), images);
  return { json: written.json, warnings: [...missing, ...written.warnings] };
}
