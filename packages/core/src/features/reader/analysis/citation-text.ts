/**
 * Text helpers for the citation pipeline, ported from the reference Scholar
 * reader (`text.ts`): a normalized search text that maps every character
 * back to the raw page offsets, and PDF rects for a span of that text.
 */
import type { PageTextItem } from "../../../reader/selection-to-anchor.js";

export type PdfItem = PageTextItem & { fontAscent?: number; fontDescent?: number };

export function pageTextFromItems(items: readonly PdfItem[]): string {
  return items.map((item) => item.str + (item.hasEOL ? "\n" : "")).join("");
}

export function stripInvisible(text: string): string {
  return text.replace(/[​-‍⁠﻿­]/g, "")
    .replace(/[   - ]/g, " ");
}

export function fontSizeOf(item: PdfItem): number {
  return Math.hypot(item.transform[2] ?? 0, item.transform[3] ?? 0) || item.height || 10;
}

export interface SearchText {
  text: string;
  starts: number[];
  ends: number[];
}

// Every normalized character maps back to the untouched PDF text and glyph runs.
export function searchTextFromItems(items: readonly PdfItem[]): SearchText {
  let text = "";
  const starts: number[] = [];
  const ends: number[] = [];
  let cursor = 0;
  let previous: PdfItem | undefined;
  const append = (str: string, start: number, end: number) => {
    text += str;
    for (let i = 0; i < str.length; i++) {
      starts.push(start);
      ends.push(end);
    }
  };

  for (const item of items) {
    if (previous && item.str && text && !/\s$/.test(text) && !/^\s/.test(item.str)) {
      const size = Math.max(fontSizeOf(item), fontSizeOf(previous));
      const gap = (item.transform[4] ?? 0) - ((previous.transform[4] ?? 0) + previous.width);
      const sameLine = Math.abs((item.transform[5] ?? 0) - (previous.transform[5] ?? 0)) < size * 0.4;
      if (sameLine && gap > Math.max(0.8, size * 0.13)) append(" ", cursor, cursor);
    }
    for (const glyph of item.str) {
      const normalized = stripInvisible(glyph.normalize("NFKC")).replace(/\s/g, " ");
      append(normalized, cursor, cursor + glyph.length);
      cursor += glyph.length;
    }
    if (item.hasEOL) {
      append(" ", cursor, cursor + 1);
      cursor++;
    }
    if (item.str.trim()) previous = item;
  }
  return { text, starts, ends };
}

export function originalRange(view: SearchText, start: number, end: number): [number, number] {
  return [view.starts[start] ?? 0, view.ends[end - 1] ?? 0];
}

export function itemToRect(item: PdfItem, from = 0, to = item.str.length): number[] | null {
  if (!item.str.length || item.width <= 0 || to <= from) return null;
  const [a = 0, b = 0, c = 0, d = 10, x = 0, y = 0] = item.transform;
  const size = Math.hypot(a, b) || fontSizeOf(item);
  const start = item.width * Math.max(0, from) / item.str.length;
  const end = item.width * Math.min(item.str.length, to) / item.str.length;
  const ascent = Number.isFinite(item.fontAscent) ? item.fontAscent! : 0.85;
  const descent = Number.isFinite(item.fontDescent) ? item.fontDescent! : -0.15;
  const corners = [start, end].flatMap((offset) => [ascent, descent].map((height) => [
    x + a / size * offset + c * height,
    y + b / size * offset + d * height,
  ]));
  const rect = [
    Math.min(...corners.map((point) => point[0]!)),
    Math.min(...corners.map((point) => point[1]!)),
    Math.max(...corners.map((point) => point[0]!)),
    Math.max(...corners.map((point) => point[1]!)),
  ];
  return rect.every(Number.isFinite) ? rect : null;
}

export function mentionRects(items: readonly PdfItem[], start: number, end: number): number[][] {
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
  const rects: number[][] = [];
  let cursor = 0;
  for (const item of items) {
    const from = cursor;
    const to = from + item.str.length;
    cursor = to + (item.hasEOL ? 1 : 0);
    if (to <= start || from >= end || !item.str.trim()) continue;
    const rect = itemToRect(item, Math.max(0, start - from), Math.min(item.str.length, end - from));
    if (rect && rect[2]! > rect[0]! && rect[3]! > rect[1]!) rects.push(rect);
  }
  return rects;
}

export function surnameKey(name: string): string {
  return name.normalize("NFKD").replace(/\p{M}/gu, "")
    .replace(/^(?:(?:van|von|de|der|den|del|da|di|la|le|du|dos|das|te|ter|al|el|bin|ibn)\s+)+/iu, "")
    .toLowerCase().replace(/[^\p{L}]/gu, "");
}

export function rectanglesOverlap(a: readonly number[], b: readonly number[]): boolean {
  return Math.min(a[2]!, b[2]!) > Math.max(a[0]!, b[0]!) &&
    Math.min(a[3]!, b[3]!) > Math.max(a[1]!, b[1]!);
}
