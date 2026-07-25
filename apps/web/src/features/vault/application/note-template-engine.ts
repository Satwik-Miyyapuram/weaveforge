/**
 * Vault note template engine — application layer, no UI.
 *
 * Templates use `{{var}}` substitution and HTML-comment region markers.
 * Generated regions refresh on re-render; editable regions and unmarked
 * text are preserved byte-for-byte. Damaged markers → keep the existing
 * document unchanged (losing user text is the one unacceptable failure).
 *
 * Marker forms:
 *   <!-- wf:generated:name -->…<!-- /wf:generated:name -->
 *   <!-- wf:editable:name -->…<!-- /wf:editable:name -->
 */

export type TemplateContext = Record<string, unknown>;

export type RegionKind = "generated" | "editable";

export interface TemplateRegion {
  kind: RegionKind;
  name: string;
  /** Body between the open and close markers, verbatim. */
  body: string;
}

type Segment =
  | { type: "text"; text: string }
  | { type: "region"; kind: RegionKind; name: string; body: string; open: string; close: string };

export type ParseRegionsResult =
  | { ok: true; segments: Segment[] }
  | { ok: false; reason: "malformed_markers" };

const OPEN_RE = /<!--\s*wf:(generated|editable):([A-Za-z0-9_-]+)\s*-->/g;
const CLOSE_PREFIX = "<!-- /wf:";

function formatValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => formatValue(item))
      .filter((item) => item !== "")
      .join(", ");
  }
  return "";
}

/**
 * Substitute `{{key}}` from context. Missing keys become "" — never throws,
 * never emits the literal `undefined`.
 */
export function substituteVariables(template: string, context: TemplateContext): string {
  return template.replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(context, key)) {
      return formatValue(context[key]);
    }
    // Dotted paths: paper.title → context.paper.title
    const parts = key.split(".");
    let cur: unknown = context;
    for (const part of parts) {
      if (cur == null || typeof cur !== "object") return "";
      cur = (cur as Record<string, unknown>)[part];
    }
    return formatValue(cur);
  });
}

function openMarker(kind: RegionKind, name: string): string {
  return `<!-- wf:${kind}:${name} -->`;
}

function closeMarker(kind: RegionKind, name: string): string {
  return `<!-- /wf:${kind}:${name} -->`;
}

export function wrapRegion(kind: RegionKind, name: string, body: string): string {
  return `${openMarker(kind, name)}${body}${closeMarker(kind, name)}`;
}

/**
 * Parse a document into text / region segments. Any mismatched, nested, or
 * half-deleted marker yields `{ ok: false }` so callers can preserve the
 * whole document rather than guess.
 */
export function parseRegions(document: string): ParseRegionsResult {
  const segments: Segment[] = [];
  let cursor = 0;
  OPEN_RE.lastIndex = 0;

  while (cursor <= document.length) {
    OPEN_RE.lastIndex = cursor;
    const openMatch = OPEN_RE.exec(document);
    if (!openMatch) {
      if (cursor < document.length) {
        const rest = document.slice(cursor);
        // A stray close marker with no open is damage.
        if (rest.includes(CLOSE_PREFIX)) {
          return { ok: false, reason: "malformed_markers" };
        }
        segments.push({ type: "text", text: rest });
      }
      break;
    }

    const openStart = openMatch.index;
    if (openStart > cursor) {
      const gap = document.slice(cursor, openStart);
      if (gap.includes(CLOSE_PREFIX)) {
        return { ok: false, reason: "malformed_markers" };
      }
      segments.push({ type: "text", text: gap });
    }

    const kind = openMatch[1] as RegionKind;
    const name = openMatch[2]!;
    const open = openMatch[0];
    const bodyStart = openStart + open.length;
    const close = closeMarker(kind, name);
    const closeStart = document.indexOf(close, bodyStart);
    if (closeStart < 0) {
      return { ok: false, reason: "malformed_markers" };
    }

    const body = document.slice(bodyStart, closeStart);
    // Nested opens inside a region are not supported — treat as damage.
    if (/<!--\s*wf:(generated|editable):/.test(body)) {
      return { ok: false, reason: "malformed_markers" };
    }

    segments.push({ type: "region", kind, name, body, open, close });
    cursor = closeStart + close.length;
  }

  return { ok: true, segments };
}

/** Render a template with variable substitution (markers left intact). */
export function renderTemplate(template: string, context: TemplateContext): string {
  return substituteVariables(template, context);
}

/**
 * Merge a freshly rendered template into an existing document.
 *
 * - Rebuilds from the **existing** segment structure so unmarked user text and
 *   editable regions stay byte-identical.
 * - Generated region bodies refresh from the rendered template when the same
 *   name is present.
 * - Malformed markers on either side → return `existing` unchanged.
 */
export function mergeTemplate(existing: string, rendered: string): string {
  if (existing === "") return rendered;

  const existingParsed = parseRegions(existing);
  if (!existingParsed.ok) return existing;

  const renderedParsed = parseRegions(rendered);
  if (!renderedParsed.ok) return existing;

  const generatedBodies = new Map<string, string>();
  for (const seg of renderedParsed.segments) {
    if (seg.type === "region" && seg.kind === "generated") {
      generatedBodies.set(seg.name, seg.body);
    }
  }

  let out = "";
  for (const seg of existingParsed.segments) {
    if (seg.type === "text") {
      out += seg.text;
      continue;
    }
    if (seg.kind === "editable") {
      out += `${seg.open}${seg.body}${seg.close}`;
      continue;
    }
    const nextBody = generatedBodies.has(seg.name) ? generatedBodies.get(seg.name)! : seg.body;
    out += `${seg.open}${nextBody}${seg.close}`;
  }
  return out;
}

/**
 * First render (empty existing) or merge on re-render. Convenience wrapper.
 */
export function applyTemplate(
  existing: string | null | undefined,
  template: string,
  context: TemplateContext,
): string {
  const rendered = renderTemplate(template, context);
  if (existing == null || existing === "") return rendered;
  return mergeTemplate(existing, rendered);
}
