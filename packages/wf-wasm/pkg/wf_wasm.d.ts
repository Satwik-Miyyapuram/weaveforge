/* tslint:disable */
/* eslint-disable */

/**
 * [`wf_core::core_info`] as a plain JS object (`CoreInfo` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function coreInfo(): any;

/**
 * [`wf_core::search::tokenizer::index_terms`]: what MiniSearch indexes for `text`.
 *
 * # Errors
 *
 * Fails if `text` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or if
 * `options` is not a valid `TokenizerOptions` object.
 */
export function indexTerms(text: string, options: any): any;

/**
 * [`MAX_INDEX_TEXT_UTF16`] for JS, so the wrappers check the cap before the
 * text is copied into linear memory.
 */
export function maxIndexTextUtf16(): number;

/**
 * [`wf_core::search::tokenizer::tokenize`]: search terms of `text`, deduplicated.
 *
 * # Errors
 *
 * Fails if `text` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or if
 * `options` is not a valid `TokenizerOptions` object.
 */
export function tokenize(text: string, options: any): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly coreInfo: () => [number, number, number];
    readonly indexTerms: (a: number, b: number, c: any) => [number, number, number];
    readonly maxIndexTextUtf16: () => number;
    readonly tokenize: (a: number, b: number, c: any) => [number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_start: () => void;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
