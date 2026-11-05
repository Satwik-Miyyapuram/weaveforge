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
 * [`apply_comma_placement`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `placement` is not `"inside"` or `"outside"`, or `input` is over the text cap.
 */
export function applyCommaPlacement(input: string, placement: any): any;

/**
 * [`binomial_smooth`].
 */
export function binomialSmooth(values: Float64Array, stride: number, passes: number): Float64Array;

/**
 * [`build_annotation_sort_index`] (TS `buildAnnotationSortIndex`).
 */
export function buildAnnotationSortIndex(page_index: number, char_offset: number, top_pdf_units: number): string;

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
 * [`can_join_ink_group`]; `group` may be `null`, `windowMs` defaults to 2000.
 */
export function canJoinInkGroup(group: any, next: any, window_ms?: number | null): boolean;

/**
 * [`wf_core::sync::change_origin::changed_side`] for JS, as a `ChangeSide` string.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function changedSide(base?: string | null, folder?: string | null, workspace?: string | null): any;

/**
 * [`choose_anchor_strategy`] as `{ kind, position | locus, confidence }`.
 *
 * # Errors
 *
 * Fails if `anchor` is not a combined anchor object, or the result cannot be converted.
 */
export function chooseAnchorStrategy(anchor: any, current_content_hash: string): any;

/**
 * [`item_to_rect`](analysis_text::item_to_rect) as `[x0, y0, x1, y1]` or null (TS `itemToRect`,
 * exported as `citationItemToRect` because `itemToRect` belongs to another lane).
 *
 * # Errors
 *
 * Fails if `item` is not a text item with `str`, `transform`, `width` and `height`.
 */
export function citationItemToRect(item: any, from: number, to: number): any;

/**
 * [`clamp_ink_note_width`]; `fallback` defaults to the default pen.
 */
export function clampInkNoteWidth(width: number, fallback?: number | null): number;

/**
 * [`clamp_ink_width`].
 */
export function clampInkWidth(width: number): number;

/**
 * [`clamp_ink_zoom`].
 */
export function clampInkZoom(zoom: number): number;

/**
 * [`clamp_page`] (TS `clampPage`).
 */
export function clampPage(page: number, num_pages: number): number;

/**
 * [`clamp_scale`]: a non-finite or non-positive scale gives 1, else clamps to the zoom range.
 */
export function clampScale(scale: number): number;

/**
 * [`clamp_zoom_factor`] (TS `clampZoomFactor`).
 */
export function clampZoomFactor(factor: number, base_scale: number): number;

/**
 * [`clean_pasted_text`] for JS, as `{ text, changed, urlsCleaned }`.
 *
 * # Errors
 *
 * Fails when `settings` is not a `PasteSettings` object, or `input` is over the text cap.
 */
export function cleanPastedText(input: string, settings: any): any;

/**
 * [`clean_pdf_text`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `options` is not a `PdfTextOptions` object, or `input` is over the text cap.
 */
export function cleanPdfText(input: string, options: any): any;

/**
 * Cleans the URLs in `text` with the built-in rules plus the user's `rules`
 * (TS `cleanUrlsInText(text, buildUrlCleanupOptions(rules))`), as `{ text, count }`.
 *
 * # Errors
 *
 * Fails when `rules` is not a string array, or `text` is over the text cap.
 */
export function cleanUrlsWithRules(text: string, rules: any): any;

/**
 * [`clean_wrapped_text`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `options` is not a `WrappedTextOptions` object, or `input` is over the text cap.
 */
export function cleanWrappedText(input: string, options: any): any;

/**
 * [`compact_ink_path`]; `options` is `{ tolerance?, maxPoints?, decimals? }` or absent.
 */
export function compactInkPath(path: Float64Array, options: any): Float64Array;

/**
 * [`compose_spacing_accents`](analysis_text::compose_spacing_accents) (TS `composeSpacingAccents`).
 */
export function composeSpacingAccents(text: string): string;

/**
 * [`compute_fit_page_scale`] (TS `computeFitPageScale`).
 *
 * # Errors
 *
 * Fails if `page` or `container` is not an object with `width` and `height`.
 */
export function computeFitPageScale(page: any, container: any, rotation: number, gutter_px: number): number;

/**
 * [`compute_fit_width_scale`] (TS `computeFitWidthScale`).
 *
 * # Errors
 *
 * Fails if `page` or `container` is not an object with `width` and `height`.
 */
export function computeFitWidthScale(page: any, container: any, rotation: number, gutter_px: number): number;

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
 * [`decide_annotation_sync`] for a row and a mode string (unknown modes act as `bidirectional`).
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 */
export function decideAnnotationSync(row: any, mode: string): any;

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
 * [`decode_ink_words`]: `words` is an array of `{ candidates, known?, join? }`,
 * `vocabulary` an array of strings.
 *
 * # Errors
 *
 * Fails if `words` or `vocabulary` is not such an array.
 */
export function decodeInkWords(words: any, vocabulary: any, engine_text?: string | null): any;

/**
 * [`decode_locus_value`] as a locus object, or `null` when malformed.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function decodeLocus(raw?: string | null): any;

/**
 * [`wf_core::sync::ink_note::default_ink_note_meta`] for JS.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultInkNoteMeta(): any;

/**
 * The default paste settings (TS `DEFAULT_PASTE_SETTINGS`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultPasteSettings(): any;

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
 * [`detect_columns`] as an array of 0-based column indices.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of `TextLine` objects.
 */
export function detectColumns(lines: any): any;

/**
 * [`diff_annotation_fields`] for a row: the fields that differ, in TS order.
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 */
export function diffAnnotationFields(row: any): any;

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
 * [`encode_locus`] as raw JSON (encode at the URL layer, not here).
 *
 * # Errors
 *
 * Fails if `locus` is not a locus object.
 */
export function encodeLocus(locus: any): string;

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
 * [`find_document_matches`] as an array of `{ pageIndex, start, end }`; `pages` is `{ pageIndex, text }[]`.
 *
 * # Errors
 *
 * Fails if `pages` is not an array of `{ pageIndex, text }` objects.
 */
export function findDocumentMatches(pages: any, query: string): any;

/**
 * [`find_quote_matches`] as an array of `{ start, end }`.
 *
 * # Errors
 *
 * Fails if `quote` is not a quote selector object.
 */
export function findQuoteMatches(text: string, quote: any): any;

/**
 * [`font_size_of`](analysis_text::font_size_of) (TS `fontSizeOf`).
 *
 * # Errors
 *
 * Fails if `item` is not a text item with `str`, `transform`, `width` and `height`.
 */
export function fontSizeOf(item: any): number;

/**
 * [`furniture_key`].
 */
export function furnitureKey(s: string): string;

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
 * [`initial_reader_viewport`] as `{ scale, fit, rotation, page }` (TS `initialReaderViewport`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function initialReaderViewport(page: number): any;

/**
 * [`ink_curve_at`] as `[x, y]`. A span past the end gives `[NaN, NaN]`, as
 * the TS copy's out-of-range reads do.
 */
export function inkCurveAt(xs: Float64Array, ys: Float64Array, i: number, u: number): Float64Array;

/**
 * [`ink_line_records`]: `counts[i]` strokes per line, `bands` as flat
 * `yMin, yMax` pairs, `recognised` an array of `{ text, confidence }` or
 * undefined per line.
 *
 * # Errors
 *
 * Fails if `recognised` is not such an array.
 */
export function inkLineRecords(counts: Uint32Array, bands: Float64Array, recognised: any): any;

/**
 * [`ink_note_width_to_pdf_points`].
 */
export function inkNoteWidthToPdfPoints(tenths: number): number;

/**
 * [`ink_page_confidence`] over the lines' `conf` values.
 */
export function inkPageConfidence(confs: Float64Array): number;

/**
 * [`ink_path_json_size`].
 */
export function inkPathJsonSize(path: Float64Array): number;

/**
 * [`ink_paths_bounds`]; `[x1, y1, x2, y2]` or `null`.
 */
export function inkPathsBounds(paths: any): any;

/**
 * [`ink_paths_hit_test`]; `paths` is an array of number arrays.
 */
export function inkPathsHitTest(paths: any, x: number, y: number, radius: number): boolean;

/**
 * [`ink_paths_in_polygon`]. `paths` is every path's flat `x, y` pairs back to back; `pathLengths`
 * gives each path's value count. A length that runs past `paths` is skipped.
 */
export function inkPathsInPolygon(paths: Float64Array, path_lengths: Uint32Array, polygon: Float64Array, share: number): boolean;

/**
 * [`ink_pressure_factor`].
 */
export function inkPressureFactor(pressure?: number | null): number;

/**
 * [`ink_tangent_at`] as `[x, y]`; `side` is `"in"` or `"out"` (anything else is `"out"`).
 * An index past the end gives `[0, 0]`, as the TS copy does.
 */
export function inkTangentAt(xs: Float64Array, ys: Float64Array, i: number, side: string): Float64Array;

/**
 * [`ink_velocity_between`].
 */
export function inkVelocityBetween(x0: number, y0: number, t0: number, x1: number, y1: number, t1: number): number;

/**
 * [`ink_velocity_factor`]; `fullTaper` defaults to `INK_VELOCITY_FULL_TAPER`.
 */
export function inkVelocityFactor(velocity: number, full_taper?: number | null): number;

/**
 * [`ink_vocabulary_hints`]; `limit` defaults to 500.
 *
 * # Errors
 *
 * Fails if `sources` is not an array of string arrays.
 */
export function inkVocabularyHints(sources: any, limit?: number | null): any;

/**
 * [`ink_width_for_pressure`]; `base` defaults to `INK_DEFAULT_WIDTH`.
 */
export function inkWidthForPressure(pressure?: number | null, base?: number | null): number;

/**
 * [`ink_zoom_in`].
 */
export function inkZoomIn(zoom: number): number;

/**
 * [`ink_zoom_out`].
 */
export function inkZoomOut(zoom: number): number;

/**
 * [`is_annotation_sync_state`] for any JS value: false unless `value` is a string.
 */
export function isAnnotationSyncState(value: any): boolean;

/**
 * [`wf_core::sync::json_entities::is_app_owned_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isAppOwnedPath(path: string): boolean;

/**
 * [`is_bibliographic_match`](analysis_text::is_bibliographic_match) (TS `isBibliographicMatch`).
 *
 * # Errors
 *
 * Fails if `hints` or `candidate` is not an object of the expected shape.
 */
export function isBibliographicMatch(hints: any, candidate: any): boolean;

/**
 * [`is_bold_font`]; `fontName` may be undefined.
 */
export function isBoldFont(font_name?: string | null): boolean;

/**
 * [`is_highlighter_ink`]; `undefined` is `None`.
 */
export function isHighlighterInk(width?: number | null): boolean;

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
 * [`is_reader_annotation_type`] for any JS value: false unless `value` is a string.
 */
export function isReaderAnnotationType(value: any): boolean;

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
 * [`is_unsure_confidence`].
 */
export function isUnsureConfidence(conf: number): boolean;

/**
 * [`is_zotero_library_sync_mode`] for any JS value: false unless `value` is a string.
 */
export function isZoteroLibrarySyncMode(value: any): boolean;

/**
 * [`item_to_rect`] as `[x1, y1, x2, y2]`, or `null`. Omitted bounds take the TS defaults (`0` and `Infinity`).
 *
 * # Errors
 *
 * Fails if `item` is not a text item object, or the result cannot be converted.
 */
export function itemToRect(item: any, char_from?: number | null, char_to?: number | null): any;

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
 * [`map_ink_confidence`]; `scale` defaults to 1.
 */
export function mapInkConfidence(raw: number, scale?: number | null): number;

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
 * [`mean_pressure`]; `undefined` when no sample reports pressure.
 */
export function meanPressure(samples: Float64Array): number | undefined;

/**
 * [`mention_rects`](analysis_text::mention_rects) as an array of rects (TS `mentionRects`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 */
export function mentionRects(items: any, start: number, end: number): any;

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
 * [`next_match_index`]: wraparound step; -1 when `total` is 0.
 */
export function nextMatchIndex(current: number, total: number, direction: number): number;

/**
 * [`next_rotation`] (TS `nextRotation`); `delta` defaults to 90 in the TS wrapper.
 */
export function nextRotation(current: number, delta: number): number;

/**
 * [`nib_width`]; `velocity` defaults to 0.
 */
export function nibWidth(base: number, pressure?: number | null, velocity?: number | null, full_taper?: number | null): number;

/**
 * [`normalise_page_rotation`] (TS `normalisePageRotation`): 0, 90, 180 or 270.
 */
export function normalisePageRotation(rotation: number): number;

/**
 * [`normalise_whitespace`] as `{ normalised, map }`; `options` is `{ trim? }` or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object, or the result cannot be converted.
 */
export function normaliseWhitespace(text: string, options: any): any;

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
 * [`normalize_paste_settings`] for JS. `json` is `JSON.stringify` of whatever was stored.
 *
 * # Errors
 *
 * Fails when `json` is not valid JSON or is over the text cap.
 */
export function normalizePasteSettings(json: string): any;

/**
 * [`original_range`](analysis_text::original_range) as `[start, end]` (TS `originalRange`).
 *
 * # Errors
 *
 * Fails if `view` is not a search text with `text`, `starts` and `ends`.
 */
export function originalRange(view: any, start: number, end: number): any;

/**
 * [`pack_ink_stroke`] as `{ points, pressures }`; `options` is the TS
 * `InkStrokePackerOptions` or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object.
 */
export function packInkStroke(points: Float64Array, pressures: Float64Array, options: any): any;

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
 * [`page_text_from_items`] over `{ str, hasEOL? }[]`.
 *
 * # Errors
 *
 * Fails if `items` is not an array of run objects.
 */
export function pageTextFromItems(items: any): string;

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
 * [`parse_link_removal_text`] for JS: the textarea's rules, one per line.
 *
 * # Errors
 *
 * Fails when `text` is over the text cap.
 */
export function parseLinkRemovalText(text: string): any;

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
 * [`paste_lands_in_verbatim_context`] for JS. `offset` is in UTF-16 code units.
 *
 * # Errors
 *
 * Fails when `document` is over the text cap.
 */
export function pasteLandsInVerbatimContext(document: string, offset: number): boolean;

/**
 * [`pdf_point_to_screen`] as `{ x, y }` (TS `pdfPointToScreen`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function pdfPointToScreen(x: number, y: number, p: any): any;

/**
 * [`pdf_rect_to_screen_box`] as `{ left, top, width, height }` (TS `pdfRectToScreenBox`).
 * `rect` is flat `[x1, y1, x2, y2]`; a short array reads missing entries as NaN.
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function pdfRectToScreenBox(rect: Float64Array, p: any): any;

/**
 * [`pick_nearest_match`] as `{ start, end }`, or `null` when there is no match.
 *
 * # Errors
 *
 * Fails if `matches` or `position` has the wrong shape.
 */
export function pickNearestMatch(matches: any, position: any): any;

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
 * [`point_in_polygon`]: is `(x, y)` inside the flat `x, y` polygon.
 */
export function pointInPolygon(polygon: Float64Array, x: number, y: number): boolean;

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
 * [`projected_page_size`] as `{ width, height }` (TS `projectedPageSize`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function projectedPageSize(p: any): any;

/**
 * [`quantize_ink_path`]; `decimals` defaults to 2.
 */
export function quantizeInkPath(path: Float64Array, decimals?: number | null): Float64Array;

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
 * [`reader_keyboard_command`]: the `ReaderKeyboardCommand` for `event`, or `null`
 * when the event passes through.
 *
 * # Errors
 *
 * Fails if `event` is not a `ReaderKeyEvent` object.
 */
export function readerKeyboardCommand(event: any): any;

/**
 * [`reconstruct_lines`] as an array of `TextLine`. `keep` is an array of
 * per-item flags (the TS predicate, already applied) or undefined to keep all.
 *
 * # Errors
 *
 * Fails if `items` or `keep` is not an array of the expected shape.
 */
export function reconstructLines(page: number, items: any, keep: any): any;

/**
 * [`rectangles_overlap`](analysis_text::rectangles_overlap) (TS `rectanglesOverlap`).
 */
export function rectanglesOverlap(a: Float64Array, b: Float64Array): boolean;

/**
 * [`wf_core::sync::blob_links::relative_asset_paths`] for JS, as `[{ scope, path }]`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function relativeAssetPaths(body: string): any;

/**
 * [`resample_ink_stroke`] as `{ points, pressures }`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function resampleInkStroke(points: Float64Array, pressures: Float64Array, spacing?: number | null): any;

/**
 * [`resolve_annotation_conflict`] for a row and a choice string (any other choice merges).
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 */
export function resolveAnnotationConflict(row: any, choice: string): any;

/**
 * [`resolve_position_selector`] as `{ start, end }`, or `null` when unusable.
 *
 * # Errors
 *
 * Fails if `position` is not a position selector object.
 */
export function resolvePositionSelector(text: string, position: any): any;

/**
 * [`resolve_text_anchor`] as `{ start, end, via, confidence }`, or `null`.
 *
 * # Errors
 *
 * Fails if `locus` is not a locus object.
 */
export function resolveTextAnchor(text: string, locus: any): any;

/**
 * [`resolve_viewport_scale`] (TS `resolveViewportScale`); `state` is `{ scale, fit, rotation }`.
 *
 * # Errors
 *
 * Fails if an argument is not an object of the expected shape.
 */
export function resolveViewportScale(state: any, page: any, container: any): number;

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
 * [`screen_point_to_pdf`] as `{ x, y }` (TS `screenPointToPdf`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function screenPointToPdf(sx: number, sy: number, p: any): any;

/**
 * [`search_text_from_items`](analysis_text::search_text_from_items) (TS `searchTextFromItems`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 */
export function searchTextFromItems(items: any): any;

/**
 * [`segment_ink_lines`] over strokes passed flat: stroke `i`'s points are
 * `points[offsets[i]..offsets[i + 1]]`, `pen[i]` is 1 for a pen stroke, and
 * `t0s[i]` its start (NaN when missing). Returns line indices into the strokes.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function segmentInkLines(points: Float64Array, offsets: Uint32Array, pen: Uint8Array, t0s: Float64Array, window_ms?: number | null, band_ratio?: number | null): any;

/**
 * [`selection_to_anchor`] as a `CombinedPdfAnchor`, or `null` when the selection is empty or out of range.
 *
 * # Errors
 *
 * Fails if `selection` or `page` is not the expected object shape, or the result cannot be converted.
 */
export function selectionToAnchor(selection: any, page: any): any;

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
 * [`should_append_ink_point`]; `minDistance` defaults to 0.75.
 */
export function shouldAppendInkPoint(path: Float64Array, x: number, y: number, min_distance?: number | null): boolean;

/**
 * [`simplify_ink_path`]; `tolerance` defaults to 0.35.
 */
export function simplifyInkPath(path: Float64Array, tolerance?: number | null): Float64Array;

/**
 * [`simplify_path_indices`]; `tolerance` defaults to 0.35. Returns a JS array of indices.
 */
export function simplifyPathIndices(path: Float64Array, tolerance?: number | null): any;

/**
 * [`smooth_ink_stroke`] as `{ points, pressures }`; `options` is
 * `{ spacing?, passes? }` or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object.
 */
export function smoothInkStroke(points: Float64Array, pressures: Float64Array, options: any): any;

/**
 * [`sort_by_reading_order_indices`] as an array of input indices in reading order.
 *
 * # Errors
 *
 * Fails if `tagged` is not an array of `{ line, column }` objects.
 */
export function sortByReadingOrder(tagged: any): any;

/**
 * [`wf_core::sync::stamp_workspace_id::stamp_workspace_id`] for JS; `null` when already stamped.
 *
 * # Errors
 *
 * Fails when `content` or `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function stampWorkspaceId(content: string, id: string): string | undefined;

/**
 * [`strip_invisible`](analysis_text::strip_invisible) (TS `stripInvisible`).
 */
export function stripInvisible(text: string): string;

/**
 * [`wf_core::sync::folder_layout::strip_kind_suffix`] for JS.
 *
 * # Errors
 *
 * Fails when `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function stripKindSuffix(name: string): string;

/**
 * [`stroke_base_width`].
 */
export function strokeBaseWidth(samples: Float64Array, base: number): number;

/**
 * [`surname_key`](analysis_text::surname_key) (TS `surnameKey`).
 */
export function surnameKey(name: string): string;

/**
 * [`tab_separated_to_markdown_table`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `input` is over the text cap.
 */
export function tabSeparatedToMarkdownTable(input: string): any;

/**
 * [`text_fingerprint`](analysis_text::text_fingerprint) (TS `textFingerprint`).
 *
 * # Errors
 *
 * Fails if `texts` is not an array of strings.
 */
export function textFingerprint(texts: any): string;

/**
 * [`title_similarity`](analysis_text::title_similarity) (TS `titleSimilarity`).
 */
export function titleSimilarity(left: string, right: string): number;

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
 * [`to_zotero_write_payload`] for one annotation under a parent item key.
 *
 * # Errors
 *
 * Fails if `ann` is not a `ZoteroAnnotationLocal` object.
 */
export function toZoteroWritePayload(ann: any, parent_item_key: string): any;

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
 * [`translate_ink_paths`]; `decimals` defaults to 2. Returns an array of number arrays.
 */
export function translateInkPaths(paths: any, dx: number, dy: number, decimals?: number | null): any;

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
 * [`visual_page_size`] as `{ width, height }` (TS `visualPageSize`).
 *
 * # Errors
 *
 * Fails if `page` is not an object with `width` and `height`.
 */
export function visualPageSize(page: any, rotation: number): any;

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

/**
 * [`zoom_in`] (TS `zoomIn`); `step` defaults to 1.25 in the TS wrapper.
 */
export function zoomIn(scale: number, step: number): number;

/**
 * [`zoom_out`] (TS `zoomOut`); `step` defaults to 1.25 in the TS wrapper.
 */
export function zoomOut(scale: number, step: number): number;

/**
 * [`zotero_write_back_annotations`]: indices of the annotations a write-back sends.
 *
 * # Errors
 *
 * Fails if `annotations` is not an array of `ZoteroAnnotationLocal` objects.
 */
export function zoteroWriteBackAnnotations(annotations: any): any;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly addCounts: (a: any, b: any) => [number, number, number];
    readonly applyCommaPlacement: (a: number, b: number, c: any) => [number, number, number];
    readonly binomialSmooth: (a: number, b: number, c: number, d: number) => [number, number];
    readonly buildAnnotationSortIndex: (a: number, b: number, c: number) => [number, number];
    readonly buildExcerpt: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly canJoinInkGroup: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly changedSide: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly chooseAnchorStrategy: (a: any, b: number, c: number) => [number, number, number];
    readonly citationItemToRect: (a: any, b: number, c: number) => [number, number, number];
    readonly clampInkNoteWidth: (a: number, b: number, c: number) => number;
    readonly clampInkWidth: (a: number) => number;
    readonly clampInkZoom: (a: number) => number;
    readonly clampPage: (a: number, b: number) => number;
    readonly clampScale: (a: number) => number;
    readonly clampZoomFactor: (a: number, b: number) => number;
    readonly cleanPastedText: (a: number, b: number, c: any) => [number, number, number];
    readonly cleanPdfText: (a: number, b: number, c: any) => [number, number, number];
    readonly cleanUrlsWithRules: (a: number, b: number, c: any) => [number, number, number];
    readonly cleanWrappedText: (a: number, b: number, c: any) => [number, number, number];
    readonly compactInkPath: (a: number, b: number, c: any) => [number, number, number, number];
    readonly composeSpacingAccents: (a: number, b: number) => [number, number];
    readonly computeFitPageScale: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly computeFitWidthScale: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly coreInfo: () => [number, number, number];
    readonly countJsonActions: (a: any) => [number, number, number];
    readonly decideAnnotationSync: (a: any, b: number, c: number) => [number, number, number];
    readonly decideGitSyncPath: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly decodeInkWords: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly decodeLocus: (a: number, b: number) => [number, number, number];
    readonly defaultInkNoteMeta: () => [number, number, number];
    readonly defaultPasteSettings: () => [number, number, number];
    readonly describePull: (a: any) => [number, number, number, number];
    readonly describePush: (a: any) => [number, number, number, number];
    readonly detectColumns: (a: any) => [number, number, number];
    readonly diffAnnotationFields: (a: any) => [number, number, number];
    readonly diffBody: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly diffJsonData: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly diffWorkspace: (a: any, b: any, c: any) => [number, number, number];
    readonly encodeLocus: (a: any) => [number, number, number, number];
    readonly entityDir: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly extractDoi: (a: number, b: number) => [number, number, number, number];
    readonly extractPageMetadata: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly findDocumentMatches: (a: any, b: number, c: number) => [number, number, number];
    readonly findQuoteMatches: (a: number, b: number, c: any) => [number, number, number];
    readonly fontSizeOf: (a: any) => [number, number, number];
    readonly furnitureKey: (a: number, b: number) => [number, number];
    readonly fuseRankings: (a: any, b: number, c: number) => [number, number, number];
    readonly guessBlobContentType: (a: number, b: number) => [number, number, number, number];
    readonly hasConflictMarkers: (a: number, b: number) => [number, number, number];
    readonly idSuffix: (a: number, b: number) => [number, number, number, number];
    readonly imageAltFromFilename: (a: number, b: number) => [number, number, number, number];
    readonly imageExtensionForMime: (a: number, b: number) => [number, number, number, number];
    readonly imagePathsInBody: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly indexTerms: (a: number, b: number, c: any) => [number, number, number];
    readonly initialReaderViewport: (a: number) => [number, number, number];
    readonly inkCurveAt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly inkLineRecords: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly inkNoteWidthToPdfPoints: (a: number) => number;
    readonly inkPageConfidence: (a: number, b: number) => number;
    readonly inkPathJsonSize: (a: number, b: number) => number;
    readonly inkPathsBounds: (a: any) => [number, number, number];
    readonly inkPathsHitTest: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly inkPathsInPolygon: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly inkPressureFactor: (a: number, b: number) => number;
    readonly inkTangentAt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly inkVelocityBetween: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly inkVelocityFactor: (a: number, b: number, c: number) => number;
    readonly inkVocabularyHints: (a: any, b: number, c: number) => [number, number, number];
    readonly inkWidthForPressure: (a: number, b: number, c: number, d: number) => number;
    readonly inkZoomIn: (a: number) => number;
    readonly inkZoomOut: (a: number) => number;
    readonly isAnnotationSyncState: (a: any) => number;
    readonly isAppOwnedPath: (a: number, b: number) => [number, number, number];
    readonly isBibliographicMatch: (a: any, b: any) => [number, number, number];
    readonly isBoldFont: (a: number, b: number) => number;
    readonly isHighlighterInk: (a: number, b: number) => number;
    readonly isInkChunkId: (a: number, b: number) => [number, number, number];
    readonly isInkNoteBody: (a: number, b: number) => [number, number, number];
    readonly isReaderAnnotationType: (a: any) => number;
    readonly isSafeWorkspacePath: (a: number, b: number) => [number, number, number];
    readonly isUnderIgnoredFolder: (a: number, b: number) => [number, number, number];
    readonly isUnsureConfidence: (a: number) => number;
    readonly isZoteroLibrarySyncMode: (a: any) => number;
    readonly itemToRect: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly jsonDataPath: (a: number, b: number, c: any) => [number, number, number, number];
    readonly jsonKindOfPath: (a: number, b: number) => [number, number, number, number];
    readonly mapInkConfidence: (a: number, b: number, c: number) => number;
    readonly markdownImage: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly maxFusionIds: () => number;
    readonly maxIndexTextUtf16: () => number;
    readonly meanPressure: (a: number, b: number) => [number, number];
    readonly mentionRects: (a: any, b: number, c: number) => [number, number, number];
    readonly mergeHunks: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly mergeRows: (a: any, b: any, c: any) => [number, number, number];
    readonly mergeVaultPage: (a: any, b: any, c: any) => [number, number, number];
    readonly nextMatchIndex: (a: number, b: number, c: number) => number;
    readonly nextRotation: (a: number, b: number) => number;
    readonly nibWidth: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly normalisePageRotation: (a: number) => number;
    readonly normaliseWhitespace: (a: number, b: number, c: any) => [number, number, number];
    readonly normalizeArxivId: (a: number, b: number) => [number, number, number, number];
    readonly normalizeMarkdownImageSyntax: (a: number, b: number) => [number, number, number, number];
    readonly normalizePasteSettings: (a: number, b: number) => [number, number, number];
    readonly originalRange: (a: any, b: number, c: number) => [number, number, number];
    readonly packInkStroke: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly pageImportRefusal: (a: any) => [number, number, number, number];
    readonly pageTextFromItems: (a: any) => [number, number, number, number];
    readonly parseJsonData: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly parseLinkRemovalText: (a: number, b: number) => [number, number, number];
    readonly parsePaperRef: (a: any, b: number, c: number) => [number, number, number];
    readonly parseQuery: (a: number, b: number) => [number, number, number];
    readonly parseWorkspaceFolder: (a: any) => [number, number, number];
    readonly pasteLandsInVerbatimContext: (a: number, b: number, c: number) => [number, number, number];
    readonly pdfPointToScreen: (a: number, b: number, c: any) => [number, number, number];
    readonly pdfRectToScreenBox: (a: number, b: number, c: any) => [number, number, number];
    readonly pickNearestMatch: (a: any, b: any) => [number, number, number];
    readonly planMirror: (a: any, b: any, c: any, d: any, e: any) => [number, number, number];
    readonly pointInPolygon: (a: number, b: number, c: number, d: number) => number;
    readonly projectDir: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly projectMetaDir: (a: number, b: number) => [number, number, number, number];
    readonly projectedPageSize: (a: any) => [number, number, number];
    readonly quantizeInkPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly readFrontmatter: (a: number, b: number) => [number, number, number];
    readonly readInkNoteBody: (a: number, b: number) => [number, number, number];
    readonly readerKeyboardCommand: (a: any) => [number, number, number];
    readonly reconstructLines: (a: number, b: any, c: any) => [number, number, number];
    readonly rectanglesOverlap: (a: number, b: number, c: number, d: number) => number;
    readonly relativeAssetPaths: (a: number, b: number) => [number, number, number];
    readonly resampleInkStroke: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly resolveAnnotationConflict: (a: any, b: number, c: number) => [number, number, number];
    readonly resolvePositionSelector: (a: number, b: number, c: any) => [number, number, number];
    readonly resolveTextAnchor: (a: number, b: number, c: any) => [number, number, number];
    readonly resolveViewportScale: (a: any, b: any, c: any) => [number, number, number];
    readonly safeWorkspacePath: (a: number, b: number) => [number, number, number, number];
    readonly sameValue: (a: any, b: any) => [number, number, number];
    readonly screenPointToPdf: (a: number, b: number, c: any) => [number, number, number];
    readonly searchTextFromItems: (a: any) => [number, number, number];
    readonly segmentInkLines: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
    readonly selectionToAnchor: (a: any, b: any) => [number, number, number];
    readonly serializeWorkspace: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly shouldAppendInkPoint: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly simplifyInkPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly simplifyPathIndices: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly smoothInkStroke: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly sortByReadingOrder: (a: any) => [number, number, number];
    readonly stampWorkspaceId: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly stripInvisible: (a: number, b: number) => [number, number];
    readonly stripKindSuffix: (a: number, b: number) => [number, number, number, number];
    readonly strokeBaseWidth: (a: number, b: number, c: number) => number;
    readonly surnameKey: (a: number, b: number) => [number, number];
    readonly tabSeparatedToMarkdownTable: (a: number, b: number) => [number, number, number];
    readonly textFingerprint: (a: any) => [number, number, number, number];
    readonly titleSimilarity: (a: number, b: number, c: number, d: number) => number;
    readonly toRelativeBlobLinks: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly toZoteroWritePayload: (a: any, b: number, c: number) => [number, number, number];
    readonly tokenize: (a: number, b: number, c: any) => [number, number, number];
    readonly translateInkPaths: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly vaultPageBase: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly vaultPageSide: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly visualPageSize: (a: any, b: number) => [number, number, number];
    readonly workspaceSnapshotCounts: (a: number, b: number) => [number, number, number];
    readonly writeConflictMarkers: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly writeFrontmatter: (a: any, b: number, c: number) => [number, number, number, number];
    readonly writeInkNoteBody: (a: any, b: number, c: number) => [number, number, number, number];
    readonly zoomIn: (a: number, b: number) => number;
    readonly zoomOut: (a: number, b: number) => number;
    readonly zoteroWriteBackAnnotations: (a: any) => [number, number, number];
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
