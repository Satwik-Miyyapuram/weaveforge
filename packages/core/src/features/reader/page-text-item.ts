/**
 * One pdf.js text item in PDF user space (origin bottom-left). Core cannot import
 * `@weaveforge/wasm`, so this is a structural copy of the shape in
 * `packages/wf-wasm/src/reader-types.ts`; the Rust core is the authority.
 */
export interface PageTextItem {
  str: string;
  /** pdf.js transform `[a,b,c,d,e,f]` — e,f are the origin of the glyph run. */
  transform: number[];
  width: number;
  height: number;
  hasEOL?: boolean;
  /** pdf.js font name, when the caller carries it — used for weight checks. */
  fontName?: string;
}
