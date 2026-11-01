/* tslint:disable */
/* eslint-disable */

/**
 * [`wf_core::sync::json_entities::add_counts`] for JS.
 *
 * # Errors
 *
 * Fails when either argument is not action counts.
 */
export function addCounts(a: any, b: any): any;

/**
 * [`wf_core::search::excerpt::build_excerpt`]: a snippet of `body` around the
 * densest cluster of `terms`, as `{ text, highlights }` where `text` is UTF-16
 * code units (the TS wrapper turns them into a string, lone surrogates kept).
 * `max_chars` defaults to 240 and `single_line` to true.
 *
 * # Errors
 *
 * Fails if `body` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `terms`
 * do (each counting its length + 1), or if `terms` is not an array of strings.
 */
export function buildExcerpt(body: string, terms: any, max_chars?: number | null, single_line?: boolean | null): any;

/**
 * [`wf_core::sync::change_origin::changed_side`] for JS, as a `ChangeSide` string.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function changedSide(base?: string | null, folder?: string | null, workspace?: string | null): any;

/**
 * [`wf_core::core_info`] as a plain JS object (`CoreInfo` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function coreInfo(): any;

/**
 * [`wf_core::sync::json_entities::count_json_actions`] for JS.
 *
 * # Errors
 *
 * Fails when `entries` does not match the diff entry shape.
 */
export function countJsonActions(entries: any): any;

/**
 * [`wf_core::sync::git_policy::decide_git_sync_path`] for JS, as `{ include, reason? }`.
 *
 * # Errors
 *
 * Fails when `rel_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or the
 * decision cannot be converted to a JS value.
 */
export function decideGitSyncPath(rel_path: string, size_bytes: number, max_file_bytes: number): any;

/**
 * [`wf_core::sync::ink_note::default_ink_note_meta`] for JS.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultInkNoteMeta(): any;

/**
 * [`wf_core::sync::git_remote::describe_pull`] for JS.
 *
 * # Errors
 *
 * Fails when `result` is not a valid `GitPullResult` object.
 */
export function describePull(result: any): string;

/**
 * [`wf_core::sync::git_remote::describe_push`] for JS.
 *
 * # Errors
 *
 * Fails when `result` is not a valid `GitPushResult` object.
 */
export function describePush(result: any): string;

/**
 * [`wf_core::sync::text_diff::diff_body`] for JS, as `BodyDiff`.
 *
 * # Errors
 *
 * Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function diffBody(ours: string, theirs: string): any;

/**
 * [`wf_core::sync::json_entities::diff_json_data`] for JS. `side` is who changed `parsed.path`;
 * the TS wrapper asks `origin` for it.
 *
 * # Errors
 *
 * Fails when an argument does not match its shape.
 */
export function diffJsonData(parsed: any, existing_json: string, side: any): any;

/**
 * [`wf_core::sync::deserialize::diff_workspace`] for JS. `sides` maps a parsed path to who
 * changed it; the TS wrapper fills it from `origin`. A path it lacks is `Unknown`. Without
 * `sides`, there is no origin.
 *
 * # Errors
 *
 * Fails when an argument does not match its shape.
 */
export function diffWorkspace(parsed: any, existing: any, sides: any): any;

/**
 * [`wf_core::sync::folder_layout::entity_dir`] for JS.
 *
 * # Errors
 *
 * Fails when `entity` is not a workspace entity type, or `project_root` is
 * over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function entityDir(entity: string, project_root: string): string;

/**
 * [`wf_core::papers::paper_ref::extract_doi`]: the DOI found in `value`, or `None`.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function extractDoi(value: string): string | undefined;

/**
 * [`wf_core::papers::page_metadata::extract_page_metadata`]: metadata of a
 * fetched page (`PageMetadata` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails if `html` or `url` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function extractPageMetadata(html: string, url: string): any;

/**
 * [`wf_core::search::fusion::fuse_rankings`]: distinct ids, best fused rank first.
 * `k` defaults to [`RRF_K`]; `limit` of `None` or 0 means no limit.
 *
 * # Errors
 *
 * Fails if a list is malformed, the lists have more than `MAX_FUSION_IDS` ids
 * in total, or a weight is not finite and >= 0.
 */
export function fuseRankings(lists: any, k?: number | null, limit?: number | null): any;

/**
 * [`wf_core::storage::blob::guess_blob_content_type`]: MIME type for `path`
 * by its extension.
 *
 * # Errors
 *
 * Fails if `path` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function guessBlobContentType(path: string): string;

/**
 * [`wf_core::sync::text_diff::has_conflict_markers`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function hasConflictMarkers(text: string): boolean;

/**
 * [`wf_core::sync::folder_layout::id_suffix`] for JS.
 *
 * # Errors
 *
 * Fails when `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function idSuffix(id: string): string;

/**
 * [`wf_core::sync::markdown_image::image_alt_from_filename`] for JS.
 *
 * # Errors
 *
 * Fails when `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function imageAltFromFilename(name?: string | null): string;

/**
 * [`wf_core::sync::markdown_image::image_extension_for_mime`] for JS.
 *
 * # Errors
 *
 * Fails when `mime` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function imageExtensionForMime(mime: string): string;

/**
 * [`wf_core::sync::markdown_image::image_paths_in_body`] for JS. The body is
 * always normalised with `normalize_markdown_image_syntax` first, as every
 * TS caller does; `prefix` is literal text, not a regex.
 *
 * # Errors
 *
 * Fails when `body` or `prefix` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function imagePathsInBody(body: string, prefix: string): string[];

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
 * [`wf_core::sync::json_entities::is_app_owned_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isAppOwnedPath(path: string): boolean;

/**
 * [`wf_core::sync::ink_note::is_ink_chunk_id`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isInkChunkId(text: string): boolean;

/**
 * [`wf_core::sync::ink_note::is_ink_note_body`] for JS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isInkNoteBody(body: string): boolean;

/**
 * [`wf_core::workspace::is_safe_workspace_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isSafeWorkspacePath(path: string): boolean;

/**
 * [`wf_core::sync::git_policy::is_under_ignored_folder`] for JS.
 *
 * # Errors
 *
 * Fails when `rel_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isUnderIgnoredFolder(rel_path: string): boolean;

/**
 * [`wf_core::sync::json_entities::json_data_path`] for JS.
 *
 * # Errors
 *
 * Fails when `project_root` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units or `kind` is not a
 * known kind.
 */
export function jsonDataPath(project_root: string, kind: any): string;

/**
 * [`wf_core::sync::json_entities::json_kind_of_path`] for JS; `undefined` for none.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function jsonKindOfPath(path: string): string | undefined;

/**
 * [`wf_core::sync::markdown_image::markdown_image`] for JS.
 *
 * # Errors
 *
 * Fails when an argument is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function markdownImage(target: string, alt: string): string;

/**
 * [`MAX_FUSION_IDS`] for JS.
 */
export function maxFusionIds(): number;

/**
 * [`MAX_INDEX_TEXT_UTF16`] for JS, so the wrappers check the cap before the
 * text is copied into linear memory.
 */
export function maxIndexTextUtf16(): number;

/**
 * [`wf_core::sync::text_diff::merge_hunks`] for JS. Picks are keyed by hunk
 * index; only canonical decimal keys (`"0"`, not `"00"`) count, as in the TS.
 *
 * # Errors
 *
 * Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
 * `picks` is not an object of `HunkPick` values.
 */
export function mergeHunks(ours: string, theirs: string, picks: any): string;

/**
 * [`wf_core::sync::merge::merge_rows`] for JS, as `{ merged, conflicts }`.
 *
 * # Errors
 *
 * Fails when a row is not a plain object of JSON values.
 */
export function mergeRows(base: any, local: any, remote: any): any;

/**
 * [`wf_core::sync::merge_vault_page::merge_vault_page`] for JS, as `VaultPageMerge`.
 *
 * # Errors
 *
 * Fails when a body or the base digest is over `MAX_INDEX_TEXT_UTF16` UTF-16
 * units, or when an argument is not a valid vault page shape.
 */
export function mergeVaultPage(base: any, folder: any, workspace: any): any;

/**
 * [`wf_core::papers::paper_ref::normalize_arxiv_id`]: the bare arXiv id in
 * `value`, or `None`.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function normalizeArxivId(value: string): string | undefined;

/**
 * [`wf_core::sync::markdown_image::normalize_markdown_image_syntax`] for JS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function normalizeMarkdownImageSyntax(body: string): string;

/**
 * [`wf_core::papers::page_metadata::page_import_refusal`]: why `meta` cannot be
 * imported, or `None` when it can.
 *
 * # Errors
 *
 * Fails if `meta` is not a valid `PageMetadata` object.
 */
export function pageImportRefusal(meta: any): string | undefined;

/**
 * [`wf_core::sync::json_entities::parse_json_data`] for JS, as `null` when it is not a JSON array.
 *
 * # Errors
 *
 * Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `kind` is
 * not a known kind.
 */
export function parseJsonData(path: string, content: string, kind: any): any;

/**
 * [`wf_core::papers::paper_ref::parse_paper_ref`]: `value` as a `PaperRef`
 * (`PaperRef` in `bindings.ts`) of the given `kind`.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or if `kind`
 * is not a valid `PaperRefKind`.
 */
export function parsePaperRef(kind: any, value: string): any;

/**
 * [`wf_core::search::query::parse_query`]: the query split into terms, phrases,
 * exclusions and filters.
 *
 * # Errors
 *
 * Fails if `query` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function parseQuery(query: string): any;

/**
 * [`wf_core::sync::deserialize::parse_workspace_folder`] for JS, over `[path, content][]`.
 *
 * # Errors
 *
 * Fails when a path or content is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function parseWorkspaceFolder(files: any): any;

/**
 * [`wf_core::sync::folder_mirror::plan_mirror`] for JS: `files` is `[path, content][]`,
 * `asset_paths` and `previous_paths` are `string[]`, `base` is an optional
 * `{ [path]: digest }` and `disk` is `{ [path]: text }` for the paths the plan reads.
 * Returns the `MirrorResult` (`mirrored` and `bases` as `[path, value][]`).
 *
 * # Errors
 *
 * Fails when an argument has the wrong shape.
 */
export function planMirror(files: any, asset_paths: any, previous_paths: any, base: any, disk: any): any;

/**
 * [`wf_core::sync::folder_layout::project_dir`] for JS.
 *
 * # Errors
 *
 * Fails when `id` or `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function projectDir(id: string, name: string): string;

/**
 * [`wf_core::sync::folder_layout::project_meta_dir`] for JS.
 *
 * # Errors
 *
 * Fails when `project_root` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function projectMetaDir(project_root: string): string;

/**
 * [`wf_core::sync::frontmatter::read_frontmatter`] for JS, as `ParsedDocument`.
 *
 * # Errors
 *
 * Fails when `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function readFrontmatter(content: string): any;

/**
 * [`wf_core::sync::ink_note::read_ink_note_body`] for JS, as `{ meta, text }`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function readInkNoteBody(body: string): any;

/**
 * [`wf_core::sync::blob_links::relative_asset_paths`] for JS, as `[{ scope, path }]`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function relativeAssetPaths(body: string): any;

/**
 * [`wf_core::workspace::safe_workspace_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when the
 * path could leave the workspace root (`Unsafe workspace path: <path>`).
 */
export function safeWorkspacePath(path: string): string;

/**
 * [`wf_core::sync::merge::same_value`] for JS.
 *
 * # Errors
 *
 * Fails when a value is not JSON.
 */
export function sameValue(a: any, b: any): boolean;

/**
 * [`wf_core::sync::serialize::serialize_workspace`] for JS, as `{ files, assets }`.
 *
 * # Errors
 *
 * Fails when the snapshot JSON is invalid, or the project id or name is over
 * `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function serializeWorkspace(snapshot_json: string, project_id: string, project_name: string): any;

/**
 * [`wf_core::sync::stamp_workspace_id::stamp_workspace_id`] for JS; `null` when already stamped.
 *
 * # Errors
 *
 * Fails when `content` or `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function stampWorkspaceId(content: string, id: string): string | undefined;

/**
 * [`wf_core::sync::folder_layout::strip_kind_suffix`] for JS.
 *
 * # Errors
 *
 * Fails when `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function stripKindSuffix(name: string): string;

/**
 * [`wf_core::sync::blob_links::to_relative_blob_links`] for JS, as
 * `{ body, assets: [{ scheme, storagePath, folderPath }] }`.
 *
 * # Errors
 *
 * Fails when `body` or `file_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function toRelativeBlobLinks(body: string, file_path: string): any;

/**
 * [`wf_core::search::tokenizer::tokenize`]: search terms of `text`, deduplicated.
 *
 * # Errors
 *
 * Fails if `text` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or if
 * `options` is not a valid `TokenizerOptions` object.
 */
export function tokenize(text: string, options: any): any;

/**
 * [`wf_core::sync::merge_vault_page::vault_page_base`] for JS; `null` when the file is not a note.
 *
 * # Errors
 *
 * Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function vaultPageBase(path: string, content: string): any;

/**
 * [`wf_core::sync::merge_vault_page::vault_page_side`] for JS; `null` when the file is not a note.
 *
 * # Errors
 *
 * Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function vaultPageSide(path: string, content: string): any;

/**
 * [`wf_core::sync::workspace_snapshot::workspace_snapshot_counts`] for JS.
 *
 * # Errors
 *
 * Fails when the snapshot JSON is invalid.
 */
export function workspaceSnapshotCounts(snapshot_json: string): any;

/**
 * [`wf_core::sync::text_diff::write_conflict_markers`] for JS.
 *
 * # Errors
 *
 * Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function writeConflictMarkers(ours: string, theirs: string): string;

/**
 * [`wf_core::sync::frontmatter::write_frontmatter`] for JS. Fields are written
 * in object key order; a `null` (JS `undefined`) value is skipped, as in the TS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
 * `fields` is not an object.
 */
export function writeFrontmatter(fields: any, body: string): string;

/**
 * [`wf_core::sync::ink_note::write_ink_note_body`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
 * `meta` is not an `InkNoteMeta` (unknown paper or hand included).
 */
export function writeInkNoteBody(meta: any, text: string): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly addCounts: (a: any, b: any) => [number, number, number];
    readonly buildExcerpt: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly changedSide: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly coreInfo: () => [number, number, number];
    readonly countJsonActions: (a: any) => [number, number, number];
    readonly decideGitSyncPath: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly defaultInkNoteMeta: () => [number, number, number];
    readonly describePull: (a: any) => [number, number, number, number];
    readonly describePush: (a: any) => [number, number, number, number];
    readonly diffBody: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly diffJsonData: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly diffWorkspace: (a: any, b: any, c: any) => [number, number, number];
    readonly entityDir: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly extractDoi: (a: number, b: number) => [number, number, number, number];
    readonly extractPageMetadata: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly fuseRankings: (a: any, b: number, c: number) => [number, number, number];
    readonly guessBlobContentType: (a: number, b: number) => [number, number, number, number];
    readonly hasConflictMarkers: (a: number, b: number) => [number, number, number];
    readonly idSuffix: (a: number, b: number) => [number, number, number, number];
    readonly imageAltFromFilename: (a: number, b: number) => [number, number, number, number];
    readonly imageExtensionForMime: (a: number, b: number) => [number, number, number, number];
    readonly imagePathsInBody: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly indexTerms: (a: number, b: number, c: any) => [number, number, number];
    readonly isAppOwnedPath: (a: number, b: number) => [number, number, number];
    readonly isInkChunkId: (a: number, b: number) => [number, number, number];
    readonly isInkNoteBody: (a: number, b: number) => [number, number, number];
    readonly isSafeWorkspacePath: (a: number, b: number) => [number, number, number];
    readonly isUnderIgnoredFolder: (a: number, b: number) => [number, number, number];
    readonly jsonDataPath: (a: number, b: number, c: any) => [number, number, number, number];
    readonly jsonKindOfPath: (a: number, b: number) => [number, number, number, number];
    readonly markdownImage: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly maxFusionIds: () => number;
    readonly maxIndexTextUtf16: () => number;
    readonly mergeHunks: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly mergeRows: (a: any, b: any, c: any) => [number, number, number];
    readonly mergeVaultPage: (a: any, b: any, c: any) => [number, number, number];
    readonly normalizeArxivId: (a: number, b: number) => [number, number, number, number];
    readonly normalizeMarkdownImageSyntax: (a: number, b: number) => [number, number, number, number];
    readonly pageImportRefusal: (a: any) => [number, number, number, number];
    readonly parseJsonData: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly parsePaperRef: (a: any, b: number, c: number) => [number, number, number];
    readonly parseQuery: (a: number, b: number) => [number, number, number];
    readonly parseWorkspaceFolder: (a: any) => [number, number, number];
    readonly planMirror: (a: any, b: any, c: any, d: any, e: any) => [number, number, number];
    readonly projectDir: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly projectMetaDir: (a: number, b: number) => [number, number, number, number];
    readonly readFrontmatter: (a: number, b: number) => [number, number, number];
    readonly readInkNoteBody: (a: number, b: number) => [number, number, number];
    readonly relativeAssetPaths: (a: number, b: number) => [number, number, number];
    readonly safeWorkspacePath: (a: number, b: number) => [number, number, number, number];
    readonly sameValue: (a: any, b: any) => [number, number, number];
    readonly serializeWorkspace: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly stampWorkspaceId: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly stripKindSuffix: (a: number, b: number) => [number, number, number, number];
    readonly toRelativeBlobLinks: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly tokenize: (a: number, b: number, c: any) => [number, number, number];
    readonly vaultPageBase: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly vaultPageSide: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly workspaceSnapshotCounts: (a: number, b: number) => [number, number, number];
    readonly writeConflictMarkers: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly writeFrontmatter: (a: any, b: number, c: number) => [number, number, number, number];
    readonly writeInkNoteBody: (a: any, b: number, c: number) => [number, number, number, number];
    readonly __wbindgen_malloc: (a: number, b: number) => number;
    readonly __wbindgen_realloc: (a: number, b: number, c: number, d: number) => number;
    readonly __wbindgen_exn_store: (a: number) => void;
    readonly __externref_table_alloc: () => number;
    readonly __wbindgen_externrefs: WebAssembly.Table;
    readonly __externref_table_dealloc: (a: number) => void;
    readonly __wbindgen_free: (a: number, b: number, c: number) => void;
    readonly __externref_drop_slice: (a: number, b: number) => void;
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
