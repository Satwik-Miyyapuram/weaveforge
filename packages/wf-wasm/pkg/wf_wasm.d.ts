/* tslint:disable */
/* eslint-disable */

/**
 * [`ArchiveBudget`](archive::ArchiveBudget): the caps an import is held to, checked as
 * entries are inflated. `limits` is `{ maxTotalBytes, maxFileBytes, maxEntries }`.
 */
export class ArchiveBudget {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * [`admit`](archive::ArchiveBudget::admit). `original_size` is a JS number; the
     * cast saturates, so a huge declared size is refused rather than wrapped.
     *
     * # Errors
     *
     * Throws past the entry count or the total cap.
     */
    admit(name: string, original_size: number): boolean;
    /**
     * # Errors
     *
     * Fails if `limits` has the wrong shape.
     */
    constructor(limits: any);
    /**
     * Names refused as over the file cap, in archive order.
     */
    readonly oversize: string[];
}

/**
 * The live packer: [`CorePacker`] fed one pen sample at a time, so the
 * stroke drawn while writing is the one saved on lift.
 */
export class InkStrokePacker {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * The kept points so far, then the pen's latest sample, as flat x,y pairs.
     */
    points(): Float64Array;
    /**
     * One pressure byte per point of [`InkStrokePacker::points`].
     */
    pressures(): Float64Array;
    /**
     * Adds the pen's next sample, in 0.1 mm, with its 0-255 pressure if it
     * has one. A non-finite sample is skipped.
     */
    push(x: number, y: number, pressure?: number | null): void;
}

/**
 * [`NibFilter`](CoreNibFilter): the pen-level filter (position and pressure, one state).
 */
export class NibFilter {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Filter one raw sample. Returns `[x, y, pressure, velocity, t]`.
     */
    filter(x: number, y: number, pressure: number, t: number): Float64Array;
    /**
     * `position` and `pressure` are each `{ minCutoff, beta, derivativeCutoff }`.
     */
    constructor(position: any, pressure: any);
    /**
     * Start a new stroke: no state carries over from the last one.
     */
    reset(): void;
    /**
     * Put back a state from [`Self::save`].
     */
    restore(snapshot: NibFilterSnapshot): void;
    /**
     * Snapshot the state, to pass to [`Self::restore`] later.
     */
    save(): NibFilterSnapshot;
    /**
     * The filter's own speed estimate for the newest sample, for diagnostics.
     */
    readonly speed: number;
}

/**
 * An opaque snapshot of a [`NibFilter`], for [`NibFilter::restore`].
 */
export class NibFilterSnapshot {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
}

/**
 * [`OneEuroFilter`](CoreOneEuroFilter): one scalar channel, held across calls.
 */
export class OneEuroFilter {
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Filter one sample taken at `time` milliseconds; returns the filtered value.
     */
    filter(value: number, time: number): number;
    /**
     * `options` is `{ minCutoff, beta, derivativeCutoff }`.
     */
    constructor(options: any);
    /**
     * Forget everything, as at pen-down.
     */
    reset(): void;
    /**
     * The last filtered value, or `undefined` before the first sample.
     */
    readonly last: number | undefined;
    /**
     * The last estimated speed, in value units per millisecond.
     */
    readonly speed: number;
}

/**
 * Brute-force cosine index over normalized vectors.
 */
export class VectorIndex {
    private constructor();
    free(): void;
    [Symbol.dispose](): void;
    /**
     * Insert or replace; `values` is `ids.length * dimensions` long and is all-or-nothing.
     *
     * # Errors
     *
     * Fails when `ids` is not a string array or `values` has the wrong length.
     */
    add(ids: string[], values: Float32Array): void;
    /**
     * Every id held, in slot order.
     */
    allIds(): string[];
    /**
     * Drop every vector.
     */
    clear(): void;
    /**
     * Whether `id` is held.
     */
    has(id: string): boolean;
    /**
     * Remove by id; unknown ids are ignored.
     *
     * # Errors
     *
     * Fails when `ids` is not a string array.
     */
    remove(ids: string[]): void;
    /**
     * Top `limit` by cosine similarity, best first; scores below `minScore` are dropped.
     *
     * # Errors
     *
     * Fails when `query` is not the index width.
     */
    search(query: Float32Array, limit: number, min_score: number): { id: string; score: number }[];
    /**
     * The packed bytes; read back with `vectorIndexFromBytes`.
     */
    toBytes(): Uint8Array;
    /**
     * The stored unit vector for `id`; empty when absent (dimensions are at least 1).
     */
    vectorOf(id: string): Float32Array;
    /**
     * The width every vector must have.
     */
    readonly dimensions: number;
    /**
     * How many vectors are held.
     */
    readonly size: number;
}

/**
 * [`account_menu::account_attention`]: the menu rows and the icon total as `{ rows, total }`.
 *
 * # Errors
 *
 * Fails if `input` is not an `AccountAttentionInput`-shaped object, or the result cannot be converted to JS.
 */
export function accountAttention(input: any): any;

/**
 * [`account_links::account_links`]: the account block's rows as `{ id, label, href?, external? }`.
 *
 * # Errors
 *
 * Fails if `input` is not an `AccountLinksInput`-shaped object, or the result cannot be converted to JS.
 */
export function accountLinks(input: any): any;

/**
 * [`acronyms_for_title`](acronyms::acronyms_for_title) as a JS array of strings.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function acronymsForTitle(title: string): any;

/**
 * [`activate_tab`](pane::activate_tab).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function activateTab(layout: any, pane_id: string, index: number): any;

/**
 * [`active_tab`](pane::active_tab). Takes a leaf.
 *
 * # Errors
 *
 * Fails if `leaf` has the wrong shape.
 */
export function activeTab(leaf: any): any;

/**
 * [`active_tab_key`](pane::active_tab_key).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function activeTabKey(layout: any): any;

/**
 * [`active_tab_ref`](pane::active_tab_ref).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function activeTabRef(layout: any): any;

/**
 * [`wf_core::sync::json_entities::add_counts`] for JS.
 *
 * # Errors
 *
 * Fails when either argument is not action counts.
 */
export function addCounts(a: any, b: any): any;

/**
 * [`add_days`](feed::add_days): `iso` moved by `days` calendar days.
 *
 * # Errors
 *
 * Throws if `iso` is not a real `yyyy-mm-dd` date.
 */
export function addDays(iso: string, days: number): string;

/**
 * [`added_notice`]: what an add says.
 */
export function addedNotice(created: boolean): string;

/**
 * [`agreement_between`](screening::agreement_between) (TS `agreementBetween`).
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function agreementBetween(decisions: any, reviewers: any, stage: any): any;

/**
 * [`ai_read_category_for_resource`](access_policy::ai_read_category_for_resource).
 *
 * # Errors
 *
 * Fails if `resourceType` is not a known resource type.
 */
export function aiReadCategoryForResource(resource_type: any): any;

/**
 * [`align_series`]: overlaid runs on one union step axis, gaps as `null`.
 */
export function alignSeries(series: any): any;

/**
 * [`analyze_pdf_document`](document_analysis::analyze_pdf_document) (TS `analyzePdfDocument`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of analysis pages or `outline` not an array of outline items.
 */
export function analyzePdfDocument(pages: any, outline: any): any;

/**
 * [`anchor_at`](text_anchor::anchor_at): the anchor, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function anchorAt(text: string, start: number, end: number): any;

/**
 * [`annotation_doc_id`](search_document::annotation_doc_id).
 */
export function annotationDocId(annotation_id: string): string;

/**
 * [`annotation_identity`] (TS `sameAnnotation`): the key two annotations share when they are
 * the same mark.
 *
 * # Errors
 *
 * Fails if `annotation` is not a JSON-like object.
 */
export function annotationIdentity(annotation: any): string;

/**
 * [`to_domain`](annotation_pin::to_domain) (TS `annotationPinToDomain`).
 *
 * # Errors
 *
 * Fails if `row` is not an annotation pin row, or the result cannot be converted.
 */
export function annotationPinToDomain(row: any): any;

/**
 * [`to_domain`]: an `annotation_quotation_types` row as a domain value. Throws on an unknown type.
 */
export function annotationQuotationTypeRowToDomain(row: any): any;

/**
 * [`append_paper_note`]: the note with `addition` appended, or `undefined` when the addition is
 * blank.
 */
export function appendPaperNote(existing: string | null | undefined, addition: string): string | undefined;

/**
 * [`append_tag_hashtags`](note_tags::append_tag_hashtags). `tag_names` is an array of tag names.
 *
 * # Errors
 *
 * Fails if `tag_names` is not an array of strings.
 */
export function appendTagHashtags(body: string, tag_names: any): string;

/**
 * [`apply_comma_placement`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `placement` is not `"inside"` or `"outside"`, or `input` is over the text cap.
 */
export function applyCommaPlacement(input: string, placement: any): any;

/**
 * [`wf_core::sync::snapshot_delta::apply_delta`] for JS over rows that carry an `id`.
 * `order` is `{ id, updatedAt }[]`; the result follows it.
 *
 * # Errors
 *
 * Fails when an argument does not have the expected shape.
 */
export function applyDelta(held: any, fetched: any, order: any): any;

/**
 * [`apply_group_command`](groups::apply_group_command).
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function applyGroupCommand(leaf: any, index: number, command: any): any;

/**
 * [`apply_template`](tpl::apply_template). A null or undefined `existing` counts as empty.
 *
 * # Errors
 *
 * Fails if the context is not a plain object.
 */
export function applyTemplate(existing: string | null | undefined, template: string, context_value: any): string;

/**
 * [`apply_op`](text_ot::apply_op): `text` with `op` applied.
 *
 * # Errors
 *
 * Fails when the op does not fit the text, or the op cannot be read.
 */
export function applyTextOp(text: string, op: any): string;

/**
 * [`apply_user_integration_fields`](user_settings::apply_user_integration_fields).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON or `fields` is not a string map.
 */
export function applyUserIntegrationFields(settings: any, provider_id: string, fields: any): any;

/**
 * [`artifact_basename`](artifact_refs::artifact_basename) (TS `artifactBasename`).
 */
export function artifactBasename(name: string): string;

/**
 * [`wf_core::papers::open_access::arxiv_candidates`]: arXiv's PDF and HTML copies.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function arxivCandidates(arxiv_id: string): any;

/**
 * [`arxiv_entry_to_metadata`] (TS `arxivEntryToMetadata`). The first entry of an arXiv Atom
 * feed as a paper.
 *
 * # Errors
 *
 * Fails when the feed has no usable entry for `arxiv_id`.
 */
export function arxivEntryToMetadata(xml: string, arxiv_id: string): any;

/**
 * [`ask_prompt`](ask_library::ask_prompt): `{ system, user }` for the sources as passed.
 */
export function askPrompt(question: string, sources: any, nonce: string): any;

/**
 * [`assemble_page_citations`] (TS `assemblePageCitations`). `candidates` is optional.
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function assemblePageCitations(page: any, native: any, patterns: any, excluded: any, candidates: any): any;

/**
 * [`unsafe_export_path_error`](export_path::unsafe_export_path_error): the refusal message, or
 * `undefined` when the path is a safe relative ZIP entry name.
 */
export function assertSafeExportPath(path: string): string | undefined;

/**
 * [`asset_extension`](asset_mime::asset_extension): lowercased extension of a path, `png` when none.
 */
export function assetExtension(path: string): string;

/**
 * [`asset_mime_type`](asset_mime::asset_mime_type): content type for an imported asset's extension.
 */
export function assetMimeType(ext: string): string;

/**
 * [`asset_path`](folder_layout::asset_path). `scope` is `"notes"`, `"papers"` or `"report"`.
 *
 * # Errors
 *
 * Fails on any other scope.
 */
export function assetPath(scope: string, storage_path: string): string;

/**
 * [`axis_spec`](plot_size::axis_spec) for a tier name (`PlotTier` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails if `tier` is not one of the three tier names.
 */
export function axisSpec(tier: string): any;

/**
 * [`backlinks_for_annotation`](backlinks::backlinks_for_annotation) as an array of targets.
 *
 * # Errors
 *
 * Fails if `hits` is not an array of hits.
 */
export function backlinksForAnnotation(hits: any, annotation_id: string): any;

/**
 * [`bib_import_message`](paper_drop::bib_import_message) (TS `bibImportMessage`).
 */
export function bibImportMessage(added: number, skipped: number, problems: number): string;

/**
 * [`bib_paper_input`](bib_import::bib_paper_input) (TS `bibPaperInput`).
 *
 * # Errors
 *
 * Fails if `entry` cannot be read as a planned `.bib` entry.
 */
export function bibPaperInput(entry: any): any;

/**
 * [`binomial_smooth`].
 */
export function binomialSmooth(values: Float64Array, stride: number, passes: number): Float64Array;

/**
 * [`blank_ink_page`](ink_page::blank_ink_page): an empty A4 page on `paper`, `blank` by default.
 *
 * # Errors
 *
 * Fails if `paper` is not a known paper name.
 */
export function blankInkPage(paper: any): any;

/**
 * [`blob_provider_for_runtime`]. `configured` is `tiered` or anything else for Supabase.
 *
 * # Errors
 *
 * Fails if `runtime` is not `{ inBrowser, publicProvider? }`, or the result cannot be converted to JS.
 */
export function blobProviderForRuntime(configured: string, runtime: any): any;

/**
 * [`body_font_size`](analysis_outline::body_font_size) (TS `bodyFontSize`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of arrays of text items.
 */
export function bodyFontSize(pages: any): number;

/**
 * [`body_links_to`](page::body_links_to) (TS `bodyLinksTo`).
 */
export function bodyLinksTo(body: string, target_key: string): boolean;

/**
 * [`body_stats`](stats::body_stats).
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function bodyStats(body: string): any;

/**
 * [`local_first_route::both_ends_merge`]: `"serverError"`, `"preferLocalRows"` or `"concatRows"`.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function bothEndsMerge(name: string, here_failed: boolean, there_failed: boolean): any;

/**
 * [`bounded_body`](search_document::bounded_body).
 */
export function boundedBody(body: string): string;

/**
 * [`breadcrumbs`](crumbs::breadcrumbs) as an array of crumbs.
 *
 * # Errors
 *
 * Fails if `tab`, `files` or `lists` does not have the shape of its type.
 */
export function breadcrumbs(tab: any, files: any, lists: any): any;

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
 * [`build_graph_data`](graph_build::build_graph_data): nodes, links and lookups for one graph view.
 *
 * # Errors
 *
 * Fails if the input has the wrong shape, or the result cannot be serialised.
 */
export function buildGraphData(input: any): any;

/**
 * [`build_lab_snapshot_content`](lab_snapshot::build_lab_snapshot_content).
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function buildLabSnapshotContent(input: any): any;

/**
 * [`build_list_tree`](reading_list::build_list_tree).
 *
 * # Errors
 *
 * Fails if `lists` has the wrong shape.
 */
export function buildListTree(lists: any): any;

/**
 * [`build_lists_tree`](tree::build_lists_tree). `input` is a `ListsTreeInput`.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function buildListsTree(input: any): any;

/**
 * [`build_page_tree`](page::build_page_tree) over the summary fields of each page.
 *
 * # Errors
 *
 * Fails if `pages` has the wrong shape.
 */
export function buildPageTree(pages: any): any;

/**
 * [`build_paper_html_document`]: the framed, self-contained document for one kept paper.
 *
 * # Errors
 *
 * Fails if `page` is not a paper page object, or `options` is not an options object.
 */
export function buildPaperHtmlDocument(page: any, options: any): string;

/**
 * [`build_propose_fill_prompt`]: the prompt that asks the AI to fill one column.
 */
export function buildProposeFillPrompt(input: any): string;

/**
 * [`build_reference_index`]: analyzes the pages and shapes the overlay's index.
 *
 * # Errors
 *
 * Fails if `pages` or `outline` do not have the expected shape.
 */
export function buildReferenceIndex(pages: any, outline: any): any;

/**
 * [`build_section_tree`](report_section::build_section_tree) (TS `buildSectionTree`).
 *
 * # Errors
 *
 * Fails if `sections` is not a list of sections.
 */
export function buildSectionTree(sections: any): any;

/**
 * [`build_wiki_graph`](wiki_graph::build_wiki_graph).
 *
 * # Errors
 *
 * Fails if `snapshot` has the wrong shape.
 */
export function buildWikiGraph(snapshot: any): any;

/**
 * [`build_wiki_index`](wiki_index::build_wiki_index); `heading` defaults to `Index` when `undefined`.
 *
 * # Errors
 *
 * Fails if `pages` is not an array of `{ title, aliases? }` objects.
 */
export function buildWikiIndex(pages: any, heading: string | null | undefined, generated_at: string): string;

/**
 * [`build_workspace_tree`](tree::build_workspace_tree).
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function buildWorkspaceTree(input: any): any;

/**
 * [`try_cache_path_segments`](model_cache::try_cache_path_segments): the segments a cache URL
 * names under the cache root, or `null` when it names none or would leave the root.
 *
 * # Errors
 *
 * Throws on a URL that does not parse, or a path escape `decodeURIComponent` rejects, as the
 * TS did.
 */
export function cachePathSegments(url: string): string[] | undefined;

/**
 * [`can_create_role`](member::can_create_role).
 */
export function canCreateRole(creator: string, target: string): boolean;

/**
 * [`can_drop`](edit::can_drop).
 *
 * # Errors
 *
 * Fails if an argument does not have the expected shape, or the result cannot be serialised.
 */
export function canDrop(source: any, target: any): any;

/**
 * [`can_join_ink_group`]; `group` may be `null`, `windowMs` defaults to 2000.
 */
export function canJoinInkGroup(group: any, next: any, window_ms?: number | null): boolean;

/**
 * [`can_rename`](edit::can_rename).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 */
export function canRename(node: any): any;

/**
 * [`canonical_ai_tool_name`](ai_tool_name::canonical_ai_tool_name).
 */
export function canonicalAiToolName(name: string): string;

/**
 * [`card_snippet::card_snippet`]: plain-text preview of `body`, cut to `max` UTF-16 units.
 *
 * # Errors
 *
 * Fails if `body` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function cardSnippet(body: string, max: number): string;

/**
 * [`wf_core::sync::change_origin::changed_side`] for JS, as a `ChangeSide` string.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function changedSide(base?: string | null, folder?: string | null, workspace?: string | null): any;

/**
 * [`check_bibliography`](bibliography_report::check_bibliography) (TS `checkBibliography`).
 * Each entry's fields cross as an ordered `{ name, value }` list.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function checkBibliography(input: any): any;

/**
 * [`check_git_remote_url`](wf_core::sync::git_remote::check_git_remote_url); a
 * non-string `raw` is refused (TS `checkGitRemoteUrl`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function checkGitRemoteUrl(raw: any): any;

/**
 * [`check_ink_chunk_body`](chunk::check_ink_chunk_body): the layout and page header of a body
 * that passed every check.
 *
 * # Errors
 *
 * Fails on a body whose tables do not add up.
 */
export function checkInkChunkBody(body: Uint8Array): any;

/**
 * [`check_link_folder`]: whether a vault-relative folder may be linked, and its normalised form.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function checkOverleafLinkFolder(raw: string): any;

/**
 * [`check_url_shape`](url_safety::check_url_shape) on the parts of a parsed URL.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function checkUrlShape(protocol: string, has_credentials: boolean, port: string, hostname: string): any;

/**
 * [`choose_anchor_strategy`] as `{ kind, position | locus, confidence }`.
 *
 * # Errors
 *
 * Fails if `anchor` is not a combined anchor object, or the result cannot be converted.
 */
export function chooseAnchorStrategy(anchor: any, current_content_hash: string): any;

/**
 * [`chunk_for_embedding`](text_chunks::chunk_for_embedding); `undefined` options take the defaults.
 *
 * # Errors
 *
 * Fails if `options` has the wrong shape.
 */
export function chunkForEmbedding(text: string, options: any): any;

/**
 * [`citation_alert_message`] for JS (TS `citationAlertMessage`).
 *
 * # Errors
 *
 * Fails when `input` is not a citation alert input with the expected fields.
 */
export function citationAlertMessage(input: any): string;

/**
 * [`citation_alert_score`](citation_alerts::citation_alert_score) of each candidate, in order.
 *
 * # Errors
 *
 * Fails if `candidates` has the wrong shape.
 */
export function citationAlertScores(candidates: any): Float64Array;

/**
 * [`citation_alert_track_from_row`](citation_alert_track::citation_alert_track_from_row):
 * the domain track for a stored row (null `last_checked_at` reads as absent, null
 * `seen_citing_ids` as empty).
 *
 * # Errors
 *
 * Fails if `row` has the wrong shape.
 */
export function citationAlertTrackFromRow(row: any): any;

/**
 * [`citation_contexts`](semantic_scholar_citation::citation_contexts): trimmed snippets, or
 * nothing when none remain.
 *
 * # Errors
 *
 * Fails if the value cannot be read as JSON.
 */
export function citationContexts(raw: any): any;

/**
 * [`external_id_ref`](semantic_scholar_citation::external_id_ref): the lookup reference for
 * a paper's external ids, or nothing.
 *
 * # Errors
 *
 * Fails if `ids` has the wrong shape.
 */
export function citationExternalIdRef(ids: any): any;

/**
 * [`intent_label`](citation_alerts::intent_label) of one candidate, or `undefined` when it has no intents.
 *
 * # Errors
 *
 * Fails if `candidate` has the wrong shape.
 */
export function citationIntentLabel(candidate: any): string | undefined;

/**
 * [`citation_intents`](semantic_scholar_citation::citation_intents): the known intents, or
 * nothing when none remain.
 *
 * # Errors
 *
 * Fails if the value cannot be read as JSON.
 */
export function citationIntents(raw: any): any;

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
 * [`cite_key_of`](bib_import::cite_key_of) (TS `citeKeyOf`).
 *
 * # Errors
 *
 * Fails if `metadata` cannot be read as a JSON value.
 */
export function citeKeyOf(metadata: any): any;

/**
 * [`cited_sources`](retrieval::cited_sources): the 1-based source numbers an answer cites, in
 * first-citation order, out of `count` sources.
 *
 * # Errors
 *
 * Fails if the numbers cannot be converted to a JS value.
 */
export function citedSourceNumbers(answer: string, count: number): any;

/**
 * [`clamp_ink_note_width`]; `fallback` defaults to the default pen.
 */
export function clampInkNoteWidth(width: number, fallback?: number | null): number;

/**
 * [`clamp_ink_page_size`](ink_page::clamp_ink_page_size): `{ width, height }` clamped to `Int16`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function clampInkPageSize(width: number, height: number): any;

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
 * [`claude_code_commands`](mcp_client_config::claude_code_commands).
 */
export function claudeCodeCommands(): string;

/**
 * [`wf_core::papers::open_access::clean_arxiv_id`]: the cleaned arXiv id, or `None`.
 */
export function cleanArxivId(id?: string | null): string | undefined;

/**
 * [`clean_groups`](groups::clean_groups).
 *
 * # Errors
 *
 * Fails if `leaf` has the wrong shape.
 */
export function cleanGroups(leaf: any): any;

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
 * [`wf_core::papers::open_access::clean_pmcid`]: the cleaned PMCID, or `None`.
 */
export function cleanPmcid(id?: string | null): string | undefined;

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
 * [`clean_widget_palette`]: the palette if every key is valid, else `null`.
 *
 * # Errors
 *
 * Fails if `value` cannot be read as JSON, or the result cannot be converted to JS.
 */
export function cleanWidgetPalette(value: any): any;

/**
 * [`clean_wrapped_text`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `options` is not a `WrappedTextOptions` object, or `input` is over the text cap.
 */
export function cleanWrappedText(input: string, options: any): any;

/**
 * [`clip_segment_to_area`](clip::clip_segment_to_area) as `{ from, to }`, or `null`.
 *
 * # Errors
 *
 * Fails only if the arguments cannot be read or the result cannot be serialised.
 */
export function clipSegmentToArea(area: any, from: any, to: any): any;

/**
 * [`clone_links`] (TS `cloneLinks`): links with string endpoints, every other field kept.
 *
 * # Errors
 *
 * Fails if `links` is not an array of JSON values.
 */
export function cloneLinks(links: any): any;

/**
 * [`close_tab`](pane::close_tab).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function closeTab(layout: any, pane_id: string, index: number): any;

/**
 * [`closed_tabs`](pane::closed_tabs).
 *
 * # Errors
 *
 * Fails if a layout has the wrong shape.
 */
export function closedTabs(before: any, after: any): any;

/**
 * [`cluster_marks`](timeline::cluster_marks): marks nearer than `min_gap` stacked into clusters.
 *
 * # Errors
 *
 * Fails if `marks` has the wrong shape.
 */
export function clusterMarks(marks: any, min_gap: number): any;

/**
 * [`coalesce_mentions`] (TS `coalesceMentions`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function coalesceMentions(mentions: any, text: string, items: any): any;

/**
 * [`codex_toml`](mcp_client_config::codex_toml) for a `McpLaunchLine`.
 *
 * # Errors
 *
 * Fails if `launch` has the wrong shape.
 */
export function codexToml(launch: any): string;

/**
 * [`coerce_paper_field_value`] (TS `coercePaperFieldValue`). `null` or blank clears the value
 * (returns `null`); a refusal throws an `Error` with the wf-core message.
 *
 * # Errors
 *
 * Fails if `kind` is not a field kind, if `value` is not a string, number, or string list,
 * or if the value is refused for `kind`.
 */
export function coercePaperFieldValue(kind: any, value: any): any;

/**
 * [`cold_blob_client_config`]. `null` when any cold-tier field is unset or empty.
 *
 * # Errors
 *
 * Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
 */
export function coldBlobClientConfig(fields: any): any;

/**
 * [`collapse_alert`]: the short form of a citation alert as `{ shown, hidden }`, or
 * `undefined` when the entry is not a long citation alert.
 */
export function collapseAlert(headline: string, rest: string): any;

/**
 * [`collapse_hits`](result_dedupe::collapse_hits) as `{id, score}` objects.
 *
 * # Errors
 *
 * Fails if `hits` is not an array of hit records.
 */
export function collapseToEntities(hits: any, seed_entity_id: string): any;

/**
 * [`collect_annotation_image_regions`](ops::collect_annotation_image_regions).
 *
 * # Errors
 *
 * Fails if the annotations do not have the shape of a TS `ReaderAnnotation`,
 * or the result cannot be serialised.
 */
export function collectAnnotationImageRegions(annotations: any): any;

/**
 * [`collect_cited_keys`](bibtex::collect_cited_keys): the keys a LaTeX body cites, as an array.
 */
export function collectCitedKeys(latex: string): any;

/**
 * [`collect_list_ids`]: every list id in the tree, parents before children.
 */
export function collectListIds(tree: any): any;

/**
 * [`collect_new_hits`](related_paper_hit::collect_new_hits): adds the new candidates up to the limit.
 *
 * # Errors
 *
 * Fails if `input` cannot be read as a collect input.
 */
export function collectNewHits(input: any): any;

/**
 * [`colour_tool_for`]: returns `"pen"`, `"highlighter"`, `"text"` or `"highlight"`.
 */
export function colourToolFor(pen_open: boolean, pen_tool: string, picked_tool: string): string;

/**
 * [`command_for_chord`](keys::command_for_chord). `tab_count` is omitted for an unbounded count.
 *
 * # Errors
 *
 * Fails if `chord` has the wrong shape.
 */
export function commandForChord(chord: any, tab_count?: number | null): any;

/**
 * [`command_match_indices`](palette_groups::command_match_indices): every index for an empty
 * query, else the page rule.
 *
 * # Errors
 *
 * Fails if `query` is too long or `labels` is not an array of strings.
 */
export function commandMatchIndices(labels: any, query: string): any;

/**
 * [`comment_from_row`](sharing::comment_from_row): a `comments` row as the app's `Comment`.
 *
 * # Errors
 *
 * Fails if `row` does not have the `comments` columns.
 */
export function commentFromRow(row: any): any;

/**
 * [`commit_url`](repo_web_url::commit_url): a commit's web URL, or `undefined`.
 */
export function commitUrl(repo_url?: string | null, sha?: string | null): string | undefined;

/**
 * [`communities`](node_colouring::communities): `[id, rank]` pairs, rank 0 for the biggest.
 *
 * # Errors
 *
 * Fails if `ids` or `edges` has the wrong shape.
 */
export function communities(ids: any, edges: any): any;

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
 * [`compute_rollup_for_papers`] (TS `computeRollupsForPapers`). One call fills a rollup column
 * for every listed paper; `null` where the rollup has no value.
 */
export function computeRollupsForPapers(paper_ids: any, rollup: any, defs: any, values: any): any;

/**
 * [`concept_key`](extraction::concept_key).
 */
export function conceptKey(name: string): string;

/**
 * [`conflict_route`] for JS (TS `conflictRoute`).
 *
 * # Errors
 *
 * Fails when `input` is not a conflict input.
 */
export function conflictRoute(input: any): any;

/**
 * [`container_resize`]: `last` and `next` are `{ width, height }`. Returns `"ignore"`, `"now"` or `"settle"`.
 *
 * # Errors
 *
 * Fails if either argument is not a `{ width, height }` object of numbers.
 */
export function containerResize(last: any, next: any): string;

/**
 * [`context_nonce_from`](ai_tool_name::context_nonce_from): the caller passes the
 * `Math.random()` values.
 */
export function contextNonceFrom(randoms: Float64Array): string;

/**
 * [`wf_core::core_info`] as a plain JS object (`CoreInfo` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function coreInfo(): any;

/**
 * [`count_action_list`](folder_merge::count_action_list): the tally over bare actions.
 *
 * # Errors
 *
 * Fails when `actions` is not a list of import actions.
 */
export function countActionList(actions: any): any;

/**
 * [`count_actions`](folder_merge::count_actions).
 *
 * # Errors
 *
 * Fails when `entries` is not a list of import entries.
 */
export function countActions(entries: any): any;

/**
 * [`wf_core::sync::json_entities::count_json_actions`] for JS.
 *
 * # Errors
 *
 * Fails when `entries` does not match the diff entry shape.
 */
export function countJsonActions(entries: any): any;

/**
 * [`count_section_sources`](section_sources::count_section_sources) (TS `countSectionSources`).
 * An absent or empty body counts 0.
 */
export function countSectionSources(body?: string | null): number;

/**
 * [`count_words`](text::count_words): runs of non-whitespace in `text`.
 */
export function countWords(text: string): number;

/**
 * [`covered_hit_mask`](hybrid_fusion::covered_hit_mask) as a boolean array.
 *
 * # Errors
 *
 * Fails if `query_term_counts` is not an array of numbers or `null`.
 */
export function coveredHitMask(query_term_counts: any, term_count: number, min_coverage: number): any;

/**
 * [`covered_text_spans`](link_citations::covered_text_spans) (TS `coveredTextSpans`).
 *
 * # Errors
 *
 * Fails if `page` or `links` do not have the expected shape.
 */
export function coveredTextSpans(page: any, links: any): any;

/**
 * [`creatable_roles`](member::creatable_roles).
 */
export function creatableRoles(creator: string): any;

/**
 * [`creatable_under`](edit::creatable_under).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 */
export function creatableUnder(node: any): any;

/**
 * [`create_experiment`](experiments::create_experiment) with the id and time supplied. Invalid
 * input fails with the TS validation message.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or its name is blank.
 */
export function createExperimentWith(input: any, id: string, now: string): any;

/**
 * A new [`InkStrokePacker`]; `options` is the TS `InkStrokePackerOptions`
 * or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object.
 */
export function createInkStrokePacker(options: any): InkStrokePacker;

/**
 * [`create_log_entry`](log_entry::create_log_entry). `id` and `now` come from the TS clock and
 * id generator, which the caller runs before this call.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape, or the body is blank after trimming.
 */
export function createLogEntry(input: any, id: string, now: string): any;

/**
 * [`create_milestone`](milestone::create_milestone) with the id and time supplied. Call
 * [`milestone_input_error_js`] first: invalid input fails here.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or is invalid.
 */
export function createMilestoneWith(input: any, id: string, created_at: string): any;

/**
 * [`create_paper_relation`](paper_relation::create_paper_relation) with the id and time
 * supplied. Call [`paper_relation_input_error_js`] first: invalid input fails here.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 */
export function createPaperRelationWith(input: any, id: string, created_at: string): any;

/**
 * [`create_reading_list`](reading_list::create_reading_list) with the id and time supplied.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or the name is blank.
 */
export function createReadingListWith(input: any, id: string, now: string): any;

/**
 * [`create_report_section`](report_section::create_report_section) with the id and time
 * supplied. Call [`report_section_input_error_js`] first: invalid input fails here.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 */
export function createReportSectionWith(input: any, id: string, now_iso: string): any;

/**
 * [`create_vault_page`](page::create_vault_page) with the id and time supplied.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape, or with the validation message when the title is blank.
 */
export function createVaultPageWith(input: any, id: string, now: string): any;

/**
 * An empty index `dimensions` wide.
 *
 * # Errors
 *
 * Fails when `dimensions` is zero.
 */
export function createVectorIndex(dimensions: number): VectorIndex;

/**
 * [`created_page_index`](proposal_created_page::created_page_index). `item` is a proposal with
 * `kind` and `payload`; `pages` is a list of pages with `title` and `parentId`. Returns the
 * index into `pages`, or `null`.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 */
export function createdPageIndex(item: any, pages: any): any;

/**
 * [`creation_kind_for`](edit::creation_kind_for). `activeKind` is `null` when no document is open.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 */
export function creationKindFor(active_kind?: string | null): any;

/**
 * [`creation_target`](edit::creation_target). `active` is `null` when no document is open,
 * `folders` the ids of the notes made as folders.
 *
 * # Errors
 *
 * Fails if an argument does not have the expected shape, or the result cannot be serialised.
 */
export function creationTarget(kind: any, active: any, folders: any): any;

/**
 * [`crop_figure_to`](figure::crop_figure_to): a figure re-cropped to `kept` inside `full`.
 *
 * # Errors
 *
 * Fails if `full` or `kept` has the wrong shape.
 */
export function cropFigureTo(full: any, kept: any): any;

/**
 * [`crossref_to_metadata`] (TS `crossrefToMetadata`). A Crossref `message` as a paper.
 *
 * # Errors
 *
 * Fails if `message` is not a Crossref message.
 */
export function crossrefToMetadata(message: any, doi: string): any;

/**
 * [`damerau_levenshtein`](vocab_match::damerau_levenshtein) as a number.
 */
export function damerauLevenshtein(a: string, b: string): number;

/**
 * [`append_card_pair`](layout::append_card_pair): append one card to both breakpoints.
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardAppendCardPair(layout_value: any, card_type: string, id: string, limits: any): any;

/**
 * [`build_dashboard_stats`](stats::build_dashboard_stats) for the whole dashboard.
 *
 * # Errors
 *
 * Fails if `input` cannot be read as the expected shape.
 */
export function dashboardBuildStats(input: any, today: string): any;

/**
 * [`close_gaps`](packing::close_gaps).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardCloseGaps(items: any, limits: any, cols: number): any;

/**
 * [`compact_vertical`](packing::compact_vertical).
 *
 * # Errors
 *
 * Fails on a bad input shape.
 */
export function dashboardCompactVertical(items: any, cols: number): any;

/**
 * [`default_layout`](layout::default_layout): the supervisor or the student default.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function dashboardDefaultLayout(supervisor: boolean): any;

/**
 * [`finalize_dashboard_layout`](layout::finalize_dashboard_layout).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardFinalizeLayout(layout_value: any, limits: any): any;

/**
 * [`floors`](packing::floors) for one card type on a grid `cols` wide.
 *
 * # Errors
 *
 * Fails if `limit` is not a card limit.
 */
export function dashboardLayoutFloors(limit: any, cols: number): any;

/**
 * [`layout_signature`](layout::layout_signature).
 *
 * # Errors
 *
 * Fails on a bad input shape.
 */
export function dashboardLayoutSignature(items: any): string;

/**
 * [`lg_layout_needs_repair`](layout::lg_layout_needs_repair).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardLgNeedsRepair(items: any, limits: any): boolean;

/**
 * [`merge_rgl_positions`](layout::merge_rgl_positions): the grid's positions, normalized to `cols`.
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardMergeRglPositions(items: any, rgl: any, limits: any, cols: number): any;

/**
 * [`merge_supervisor_cards`](layout::merge_supervisor_cards). `ids` holds one new card id per
 * supervisor-only card type, in order.
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardMergeSupervisorCards(layout_value: any, limits: any, ids: any): any;

/**
 * [`needs_attention`](stats::needs_attention) for the given papers, milestones, experiments,
 * and `today` (`yyyy-mm-dd`).
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 */
export function dashboardNeedsAttention(papers: any, milestones: any, experiments: any, today: string): any;

/**
 * [`normalize_item`](packing::normalize_item).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardNormalizeItem(item: any, limits: any, cols: number): any;

/**
 * [`pack_sm`](packing::pack_sm).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardPackSm(items: any, limits: any): any;

/**
 * [`sm_layout_needs_repack`](layout::sm_layout_needs_repack).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardSmNeedsRepack(items: any, limits: any): boolean;

/**
 * [`supervisee_counts`](stats::supervisee_counts) for one supervisee.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 */
export function dashboardSuperviseeCounts(milestones: any, logs: any, today: string): any;

/**
 * [`sync_dashboard_layouts`](layout::sync_dashboard_layouts).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 */
export function dashboardSyncLayouts(layout_value: any, limits: any): any;

/**
 * [`team_attention`](stats::team_attention) across all supervisees.
 *
 * # Errors
 *
 * Fails if `supervisees` cannot be read as the expected shape.
 */
export function dashboardTeamAttention(supervisees: any, today: string): any;

/**
 * [`top_tags`](stats::top_tags) with the `limit` most-used tags.
 *
 * # Errors
 *
 * Fails if `tags` cannot be read as the expected shape.
 */
export function dashboardTopTags(tags: any, limit: number): any;

/**
 * [`days_until_date`](timeline::days_until_date): the whole days from `today`, or `undefined`
 * unless both are real dates.
 */
export function daysUntilDate(iso: string, today: string): any;

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
 * [`wf_core::sync::git_gate::decide_vault_commit`] for JS, as `{ ok, action? | reason? }`.
 *
 * # Errors
 *
 * Fails when `state` is not a valid repo state, or the verdict cannot be converted to a JS value.
 */
export function decideVaultCommit(enabled: boolean, state: any): any;

/**
 * [`declared_charset`]: the charset a page declares, lowercased, else `utf-8`.
 */
export function declaredCharset(content_type: string | null | undefined, bytes: Uint8Array): string;

/**
 * [`decode_html_entities`]: the named and numeric entities in `value`, decoded once.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function decodeHtmlEntities(value: string): string;

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
 * [`decode_share_link_token`](sharing::decode_share_link_token); a bad token throws its message.
 *
 * # Errors
 *
 * Fails if `encoded` is not valid base64 (either alphabet).
 */
export function decodeShareLinkToken(encoded: string): Uint8Array;

/**
 * [`deepest_first_list_ids`](reading_list::deepest_first_list_ids) (TS `removeList` order).
 *
 * # Errors
 *
 * Fails if `lists` has the wrong shape.
 */
export function deepestFirstListIds(list_id: string, lists: any): string[];

/**
 * [`default_expanded`](state::default_expanded).
 *
 * # Errors
 *
 * Fails if the argument is not an array of strings, or the result cannot be serialised.
 */
export function defaultExpanded(roots: any): any;

/**
 * [`default_graph_settings`](graph_settings::default_graph_settings).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultGraphSettings(): any;

/**
 * [`wf_core::sync::ink_note::default_ink_note_meta`] for JS.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultInkNoteMeta(): any;

/**
 * [`rules::default_mode_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultModeFor(kind: string): any;

/**
 * [`default_open_sections`](state::default_open_sections). Takes `{ id, collapsedByDefault }`
 * objects; extra fields are ignored.
 *
 * # Errors
 *
 * Fails if the argument is not an array of section declarations, or the result cannot be serialised.
 */
export function defaultOpenSections(sections: any): any;

/**
 * The default paste settings (TS `DEFAULT_PASTE_SETTINGS`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultPasteSettings(): any;

/**
 * [`default_share_link_expires_at`](sharing::default_share_link_expires_at): the default expiry
 * of a new view link. `now_ms` is the JS `Date.now()` value.
 */
export function defaultShareLinkExpiresAt(now_ms: number): string;

/**
 * [`default_source_note_template`](tpl::default_source_note_template): the default source-note
 * template text, with generated metadata and editable summary, key points and notes.
 */
export function defaultSourceNoteTemplate(): string;

/**
 * [`degree_colours`](node_colouring::degree_colours): `[id, colour]` pairs for `[id, degree]` pairs.
 *
 * # Errors
 *
 * Fails if `degree` is not an array of `[id, number]` pairs.
 */
export function degreeColours(degree: any): any;

/**
 * [`deleted_local_base`] for JS (TS `deletedLocalBase`). Empty when there are no ops.
 *
 * # Errors
 *
 * Fails when `ops` is not a list of outbox ops.
 */
export function deletedLocalBase(ops: any): any;

/**
 * [`deleted_remote_sides`] for JS (TS `deletedRemoteSides`). `stored` is the local row or
 * `null`; `null` is returned when neither it nor an owed op is available.
 *
 * # Errors
 *
 * Fails when `ops` is not a list of outbox ops or `stored` is not a plain object.
 */
export function deletedRemoteSides(ops: any, stored: any): any;

/**
 * [`deletion_action`] for JS (TS `deletionAction`). `kind` is `"deleted_remote"` or
 * `"deleted_local"`, `choice` is `"keep"` or `"delete"`, and `remote` is the server row or `null`.
 *
 * # Errors
 *
 * Fails when `kind` or `choice` is not one of its strings, or a row is not a plain object.
 */
export function deletionAction(kind: any, choice: any, local: any, row_id: string, remote: any): any;

/**
 * [`deletion_for`] (TS `deletionFor`). `kind` is `"deleted_remote"` or `"deleted_local"`,
 * `side` is `"local"` or `"remote"`; returns `"keep"` or `"delete"`.
 *
 * # Errors
 *
 * Fails if `kind` or `side` is not one of those strings.
 */
export function deletionFor(kind: any, side: any): any;

/**
 * [`wf_core::sync::git_policy::describe_changes`] for JS, from `[{ state: "added" | "modified" | "deleted" }]`.
 *
 * # Errors
 *
 * Fails when `status` is not that shape.
 */
export function describeChanges(status: any): string;

/**
 * [`describe_free_copy_failure`]: `outcome` is the `"none"` outcome of a search.
 *
 * # Errors
 *
 * Fails if `outcome` does not have the expected shape.
 */
export function describeFreeCopyFailure(outcome: any, web_article: boolean): string;

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
 * [`wf_core::sync::git_remote::describe_status`] for JS.
 *
 * # Errors
 *
 * Fails when `status` is not a valid `{ url, branch, ahead, behind }` object.
 */
export function describeRemoteStatus(status: any): string;

/**
 * [`detect_citation_style`] (TS `detectCitationStyle`). `texts` is the page texts as an array of
 * strings; the result is `"numeric"`, `"author-year"`, `"both"`, or `undefined` for neither.
 *
 * # Errors
 *
 * Fails if `texts` is not an array of strings.
 */
export function detectCitationStyle(texts: any): any;

/**
 * [`detect_columns`] as an array of 0-based column indices.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of `TextLine` objects.
 */
export function detectColumns(lines: any): any;

/**
 * [`device_markers`](panel_labels::device_markers): conflict markers named for this device and the cloud.
 */
export function deviceMarkers(ours: string, theirs: string): string;

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
 * [`diff_refresh`](refresh_diff::diff_refresh) as `{remove, add, prints}`.
 *
 * # Errors
 *
 * Fails if `prints` or `fresh` is not an array of `{id, print}` records, or
 * `held` is not an array of strings.
 */
export function diffRefreshPlan(prints: any, held: any, fresh: any): any;

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
 * [`wf_core::sync::change_origin::digest_text`] for JS.
 */
export function digestText(text: string): string;

/**
 * [`distance_to_segment_squared`](hit_test::distance_to_segment_squared).
 */
export function distanceToSegmentSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number;

/**
 * [`distinct_related`](result_dedupe::distinct_related) as kept indices and
 * merge pairs.
 *
 * # Errors
 *
 * Fails if `input` is not a distinct-input record.
 */
export function distinctRelated(input: any): any;

/**
 * [`document_boost`](search_tuning::document_boost). `now` is epoch milliseconds.
 *
 * # Errors
 *
 * Fails if `doc` or `options` has the wrong shape.
 */
export function documentBoost(doc: any, options: any, now: number): number;

/**
 * [`document_id_of`](semantic_fingerprint::document_id_of): the document a passage id belongs to.
 */
export function documentIdOf(passage: string): string;

/**
 * [`document_id_of_path`](semantic_fingerprint::document_id_of_path): the document id behind a workspace file name.
 */
export function documentIdOfPath(file: string): string;

/**
 * [`rules::document_kind`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function documentKind(kind: string): any;

/**
 * [`rules::document_suffix`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function documentSuffix(kind: string): any;

/**
 * [`double_click_figure`](page_math::double_click_figure): the figure every press lands in.
 *
 * # Errors
 *
 * Fails if `figures` is not an array of boxes or `points` is not an array of points.
 */
export function doubleClickFigure(figures: any, points: any, skip?: number | null): number | undefined;

/**
 * [`draft_icon`](edit::draft_icon).
 *
 * # Errors
 *
 * Fails if the argument is not a create kind, or the result cannot be serialised.
 */
export function draftIcon(kind: any): any;

/**
 * [`draft_makes`](edit::draft_makes).
 *
 * # Errors
 *
 * Fails if the argument is not a create kind, or the result cannot be serialised.
 */
export function draftMakes(kind: any): any;

/**
 * [`draft_placeholder`](edit::draft_placeholder).
 *
 * # Errors
 *
 * Fails if the argument is not a create kind, or the result cannot be serialised.
 */
export function draftPlaceholder(kind: any): any;

/**
 * [`draft_reading_log`](reading_digest::draft_reading_log) (TS `draftReadingLog`).
 *
 * # Errors
 *
 * Fails if `papers` or `marks` are not lists of the right shape.
 */
export function draftReadingLog(papers: any, marks: any, day: string): string;

/**
 * [`drop_parent_id`](edit::drop_parent_id).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 */
export function dropParentId(target: any): any;

/**
 * [`duplicate_plan`](duplicate::duplicate_plan) as `{ title, parentId, body }`, or `null`.
 *
 * # Errors
 *
 * Fails if `doc` or `documents` does not have the shape of a duplicate source.
 */
export function duplicatePlan(doc: any, documents: any): any;

/**
 * [`edit_sides`] for JS (TS `editSides`). `null` when no non-delete op is owed.
 *
 * # Errors
 *
 * Fails when `ops` is not a list of outbox ops.
 */
export function editSides(ops: any): any;

/**
 * [`edited_relative_label`](edited_label::edited_relative_label) (TS `editedRelativeLabel`).
 * `None` (a week or more, or NaN) becomes `undefined`; the caller then shows the date.
 */
export function editedRelativeLabel(seconds: number): string | undefined;

/**
 * [`effective_field_boosts`](search_settings::effective_field_boosts).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function effectiveFieldBoosts(settings: any): any;

/**
 * [`effective_relation_types`](graph_settings::effective_relation_types).
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function effectiveRelationTypes(settings: any): any;

/**
 * [`ema_smooth`]: debiased EMA over the values; `null` gaps stay gaps.
 */
export function emaSmooth(values: any, alpha: number): any;

/**
 * [`embed_titles`](page::embed_titles): the trimmed title of each `![[...]]` in `body`.
 */
export function embedTitles(body: string): string[];

/**
 * [`embeddable_text`](semantic_fingerprint::embeddable_text): the text a document is embedded from.
 */
export function embeddableText(title: string, aliases: string[], body: string): string;

/**
 * [`empty_cell_paper_ids`]: the papers whose cell for `field_id` is empty and not pending.
 */
export function emptyCellPaperIds(rows: any, field_id: string, pending_paper_ids: any): any;

/**
 * [`empty_integration`](fields::empty_integration): the integration a provider starts from.
 *
 * # Errors
 *
 * Fails if `provider` is not `"github"`, `"gitlab"` or `"mattermost"`.
 */
export function emptyIntegration(provider: any): any;

/**
 * [`empty_layout`](pane::empty_layout).
 *
 * # Errors
 *
 * Never fails in practice; returns the serializer's result type.
 */
export function emptyLayout(pane_id: string): any;

/**
 * [`empty_page_history`] as `{ undo: [], redo: [] }`.
 */
export function emptyPageHistory(): any;

/**
 * [`empty_to_null`]: the text as stored, with an absent or empty value as `null`.
 */
export function emptyToNull(value?: string | null): any;

/**
 * [`encode_ink_chunk_body`](chunk::encode_ink_chunk_body): a page packed into an uncompressed body.
 *
 * # Errors
 *
 * Fails on a page the format cannot hold, or one that is not an `InkPage`.
 */
export function encodeInkChunkBody(page: any): Uint8Array;

/**
 * [`encode_locus`] as raw JSON (encode at the URL layer, not here).
 *
 * # Errors
 *
 * Fails if `locus` is not a locus object.
 */
export function encodeLocus(locus: any): string;

/**
 * [`nav_open_groups::encode_open_groups`]: the stored JSON for an open-groups list.
 *
 * # Errors
 *
 * Fails if `groups` is not an array of strings.
 */
export function encodeOpenGroups(groups: any): string;

/**
 * [`encode_rollup_options`](paper_field::encode_rollup_options) (TS `encodeRollupOptions`).
 *
 * # Errors
 *
 * Fails if `config` is not a rollup config object.
 */
export function encodeRollupOptions(config: any): string[];

/**
 * [`encode_share_link_token`](sharing::encode_share_link_token): unpadded base64url.
 */
export function encodeShareLinkToken(token: Uint8Array): string;

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
 * [`entry_file_error`](overleaf::entry_file_error).
 */
export function entryFileError(entry_file: string): string | undefined;

/**
 * [`enum_label::enum_label`]: the label for `value` under `kind`, humanised when unknown.
 */
export function enumLabel(kind: string, value: string): string;

/**
 * [`enum_label::enum_options`] as `{ value, label }` objects, in the fixed order.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function enumOptions(kind: string): any;

/**
 * [`escape_html`](text::escape_html): `&`, `<`, `>` and `"` made safe for markup.
 */
export function escapeHtml(value: string): string;

/**
 * [`escape_latex_text`](markdown_to_latex::escape_latex_text) (TS `escapeLatexText`).
 */
export function escapeLatexText(s: string): string;

/**
 * [`evaluate_ai_access`](access_policy::evaluate_ai_access); `now` is the ISO 8601 clock time.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function evaluateAiAccess(input: any, now: string): any;

/**
 * [`excerptOf`]: a 200-character excerpt of `body` around `terms`, cut like [`index_terms_of_js`].
 *
 * # Errors
 *
 * Fails if `terms` is not an array of strings, or if the terms together need more than
 * `MAX_INDEX_TEXT_UTF16` units (each counts its length + 1), as the TS `buildExcerpt` does.
 */
export function excerptOf(body: string, terms: any): any;

/**
 * [`excerpt_segments`](excerpt_segments::excerpt_segments) as `{text,
 * highlighted}` runs.
 *
 * # Errors
 *
 * Fails if `excerpt` is not a `{text, highlights}` record.
 */
export function excerptSegments(excerpt: any): any;

/**
 * [`exclusion_reasons`](screening::exclusion_reasons) (TS `exclusionReasons`).
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 */
export function exclusionReasons(decisions: any, stage: any): any;

/**
 * [`expand_embeds`](page::expand_embeds): `bodies[i]` is the body that `titles[i]` resolves to.
 */
export function expandEmbeds(body: string, titles: string[], bodies: string[]): string;

/**
 * [`expand_ipv6`](url_safety::expand_ipv6); `undefined` when the text is not IPv6.
 *
 * # Errors
 *
 * Fails if the groups cannot be converted to a JS value.
 */
export function expandIpv6(value: string): any;

/**
 * [`experiment_activity_at`](experiment_status::experiment_activity_at).
 *
 * # Errors
 *
 * Fails if `experiment` has the wrong shape.
 */
export function experimentActivityAt(experiment: any): number;

/**
 * [`experiment_href`](experiment_status::experiment_href): where an experiment opens.
 */
export function experimentHref(id: string, is_offline_build: boolean): string;

/**
 * [`to_domain`]: an `experiments` row as an experiment.
 */
export function experimentRowToDomain(row: any): any;

/**
 * [`to_row`]: an experiment as the `experiments` row it is written as.
 */
export function experimentToRow(experiment: any): any;

/**
 * [`EXPERIMENTS_HREF`](experiment_status::EXPERIMENTS_HREF): the experiments list.
 */
export function experimentsListHref(): string;

/**
 * [`explain_arm`](related::explain_arm).
 *
 * # Errors
 *
 * Fails if `arm` is not a known arm name.
 */
export function explainArm(arm: any): string;

/**
 * [`export_asset_path`]: the folder a stored asset is written to in the export.
 */
export function exportAssetPath(root: string, prefix: string, storage_path: string): string;

/**
 * [`export_manifest_json`]: the export's `manifest.json` text.
 */
export function exportManifestJson(exported_at: string, stats: any): string;

/**
 * [`export_readme`]: the export's `README.txt` text.
 */
export function exportReadme(exported_at: string): string;

/**
 * [`wf_core::papers::paper_ref::extract_doi`]: the DOI found in `value`, or `None`.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function extractDoi(value: string): string | undefined;

/**
 * [`extract_hashtag_refs`](paper::extract_hashtag_refs) (TS `extractHashtagRefs`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function extractHashtagRefs(text?: string | null): any;

/**
 * [`extract_hashtags`](paper::extract_hashtags) (TS `extractHashtags`).
 */
export function extractHashtags(text?: string | null): string[];

/**
 * [`extract_headings`](search_document::extract_headings).
 */
export function extractHeadings(body?: string | null): string[];

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
 * [`extract_page_title`](page_title::extract_page_title): `{ title, suspect }`, or
 * `null` when the HTML has no title.
 *
 * # Errors
 *
 * Fails if `html` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function extractPageTitle(html: string): any;

/**
 * [`extractVenue`](bibliography::extract_venue): venue named after the title, if any.
 */
export function extractVenue(after_title: string): string | undefined;

/**
 * [`extract_wikilinks`](page::extract_wikilinks) (TS `extractWikilinks`). Offsets are UTF-16.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function extractWikilinks(body: string): any;

/**
 * [`extraction_csv`]: the table as CSV, with a header line.
 */
export function extractionCsv(rows: any, defs: any, columns: any): string;

/**
 * [`extraction_markdown`]: the table as a Markdown table.
 */
export function extractionMarkdown(rows: any, defs: any, columns: any): string;

/**
 * [`paper_value_rows`]: each listed paper's stored and rollup values, in list order.
 */
export function extractionValueRows(paper_ids: any, values: any, defs: any): any;

/**
 * [`fence_untrusted`](untrusted_context::fence_untrusted).
 *
 * # Errors
 *
 * Fails if `items` is not an array of `{ label, text }` objects.
 */
export function fenceUntrusted(items: any, nonce: string): string;

/**
 * [`figure_alt_for`](figure::figure_alt_for): the figure alt of the image at `path`, or `undefined`.
 *
 * # Errors
 *
 * Fails if `body` is longer than the index text limit.
 */
export function figureAltFor(body: string, path: string): string | undefined;

/**
 * [`figure_clip_text`]: the clipboard text for a copied figure.
 */
export function figureClipText(clip: any): string;

/**
 * [`figure_corner_hit`](figure::figure_corner_hit): the corner grab distance at `scale`.
 */
export function figureCornerHit(scale: number): number;

/**
 * [`figure_image_frame`](figure::figure_image_frame): the whole picture inside the frame, in percent.
 *
 * # Errors
 *
 * Fails if `value` has the wrong shape.
 */
export function figureImageFrame(value: any): any;

/**
 * [`figure_label`](figure_label::figure_label): the label for an artifact URL. `index` is 0-based.
 */
export function figureLabel(url: string, index: number): string;

/**
 * [`figure_under`](page_math::figure_under): the topmost figure holding `at`, ignoring `skip`.
 *
 * # Errors
 *
 * Fails if `figures` is not an array of boxes or `at` is not a point.
 */
export function figureUnder(figures: any, at: any, skip?: number | null): number | undefined;

/**
 * [`filter_graph_by_nodes`] (TS `filterGraphByNodes`). `allowed` is an array of node ids, or
 * `null` to keep everything. Returns `{ nodes, links }`.
 *
 * # Errors
 *
 * Fails if `nodes` or `links` is not an array of JSON values, or `allowed` is not an array of
 * strings or `null`.
 */
export function filterGraphByNodes(nodes: any, links: any, allowed: any): any;

/**
 * [`filter_lab_members`](member::filter_lab_members). Returns indices into `members`.
 *
 * # Errors
 *
 * Fails if `members` or `options` has the wrong shape.
 */
export function filterLabMembers(viewer_id: string, members: any, options: any): any;

/**
 * [`filter_rows`](tree::filter_rows). `rows` is an array of `VisibleRow`.
 *
 * # Errors
 *
 * Fails if `rows` has the wrong shape.
 */
export function filterRows(rows: any, query: string): any;

/**
 * [`filter_team_members`](member::filter_team_members). Returns indices into `members`.
 *
 * # Errors
 *
 * Fails if `members` or `options` has the wrong shape.
 */
export function filterTeamMembers(viewer_id: string, members: any, options: any): any;

/**
 * [`find_annotation_backlinks`](backlinks::find_annotation_backlinks) as an array of hits.
 *
 * # Errors
 *
 * Fails if `input` lacks the `annotations`, `pins`, `sections` or `vaultPages` arrays.
 */
export function findAnnotationBacklinks(input: any): any;

/**
 * [`find_citation_candidates`](analysis_citations::find_citation_candidates) (TS `findCitationCandidates`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 */
export function findCitationCandidates(items: any): any;

/**
 * [`find_document_matches`] as an array of `{ pageIndex, start, end }`; `pages` is `{ pageIndex, text }[]`.
 *
 * # Errors
 *
 * Fails if `pages` is not an array of `{ pageIndex, text }` objects.
 */
export function findDocumentMatches(pages: any, query: string): any;

/**
 * [`find_duplicate_groups`] (TS `findDuplicateGroups`). Groups of two or more papers.
 *
 * # Errors
 *
 * Fails if `papers` is not a list of paper summaries, or the result cannot be converted.
 */
export function findDuplicateGroups(papers: any): any;

/**
 * [`find_figure_mentions`] (TS `findFigureMentions`). `outline` is optional.
 *
 * # Errors
 *
 * Fails if `pages` or `outline` do not have the expected shape.
 */
export function findFigureMentions(pages: any, outline: any): any;

/**
 * [`find_heading_lines`] (TS `findHeadingLines`). `furniture_indices` are the positions in
 * `lines` that count as furniture (never headings); the TS wrapper maps flags to indices.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of text lines or `furnitureIndices` is not an array of
 * non-negative integers.
 */
export function findHeadingLines(lines: any, body: number, furniture_indices: any): any;

/**
 * [`wf_core::sync::markdown_image::find_image_refs`] for JS, with one `head`.
 *
 * # Errors
 *
 * Fails when `body` or `head` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function findImageRefs(body: string, head: string, allow_space: boolean): any;

/**
 * [`find_marks`]: where each match falls in the document, as a fraction of its height.
 *
 * # Errors
 *
 * Fails if `matches` or `pages` do not have the expected shape.
 */
export function findMarks(matches: any, num_pages: number, pages: any): any;

/**
 * [`find_pattern_citation_mentions`](analysis_citations::find_pattern_citation_mentions) (TS
 * `findPatternCitationMentions`). The TS wrapper always passes `excluded` and `candidates`.
 *
 * # Errors
 *
 * Fails if `page`, `refs`, `excluded` or `candidates` do not have the expected shape.
 */
export function findPatternCitationMentions(page: any, refs: any, excluded: any, candidates: any): any;

/**
 * [`find_quote_matches`] as an array of `{ start, end }`.
 *
 * # Errors
 *
 * Fails if `quote` is not a quote selector object.
 */
export function findQuoteMatches(text: string, quote: any): any;

/**
 * [`find_reference_section`] (TS `findReferenceSection`). `furniture` is an optional
 * per-line boolean array, `undefined` or `null` for none.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of text lines or `furniture` is not an array of booleans.
 */
export function findReferenceSection(lines: any, body_font_size: number, page_count: number, furniture: any): any;

/**
 * [`find_related`](related::find_related); `[{ id, score, arm, arms?, similarity? }]`, best first.
 *
 * # Errors
 *
 * Fails if `graph` or `options` has the wrong shape.
 */
export function findRelated(graph: any, seed: string, limit: number, options: any, rng: () => number, lexical: (seedId: string, limit: number) => { id: string; score: number }[], tagged: (seedId: string, limit: number) => { id: string; score: number }[]): any;

/**
 * [`find_wiki_root`]: the note titled `Wiki`, or nothing.
 */
export function findWikiRoot(pages: any): any;

/**
 * [`fit_cols`](plot_size::fit_cols).
 */
export function fitCols(grid_width: number, gap: number): number;

/**
 * [`fit_layout_to_content`](fit::fit_layout_to_content). `measured` and `maxHeights` map a card id
 * (or card type) to rows; only card types in `maxHeights` fit their content.
 *
 * # Errors
 *
 * Fails when an argument is not the expected shape.
 */
export function fitLayoutToContent(items: any, measured: any, max_heights: any): any;

/**
 * [`fit_scale`](page_math::fit_scale): CSS pixels per 0.1 mm unit, `1` with no width.
 */
export function fitScale(container_width: number, page_width: number): number;

/**
 * [`fits_ink_note_budget`](chunk::fits_ink_note_budget): whether these chunk sizes fit a note.
 */
export function fitsInkNoteBudget(sizes: Float64Array): boolean;

/**
 * [`flat_path`](folder_layout::flat_path). `entity` is a `WorkspaceEntityType` string.
 *
 * # Errors
 *
 * Fails if `entity` is not a known entity type.
 */
export function flatPath(entity: any, id: string, title: string, project_root: string): string;

/**
 * [`flatten`] over `docs`: the project's text files as paths, in walk order.
 */
export function flattenOverleafDocs(root_folder: any): any;

/**
 * [`flatten`] over `fileRefs`: the project's binary files as paths, in walk order.
 */
export function flattenOverleafFiles(root_folder: any): any;

/**
 * [`flatten_tree`](tree::flatten_tree).
 *
 * # Errors
 *
 * Fails if `nodes` has the wrong shape.
 */
export function flattenTree(nodes: any): any;

/**
 * [`focus_pane`](pane::focus_pane).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function focusPane(layout: any, pane_id: string): any;

/**
 * [`focused_tab_count`](pane::focused_tab_count).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function focusedTabCount(layout: any): number;

/**
 * [`folder_ids_of`](tree::folder_ids_of). Returns an array; the TS wrapper makes the `Set`.
 *
 * # Errors
 *
 * Fails if `nodes` has the wrong shape.
 */
export function folderIdsOf(nodes: any): any;

/**
 * [`folder_key`](folder_layout::folder_key) (TS `folderSegments` joined with `/`): the folder
 * of one picked file's relative path.
 */
export function folderKey(relative_path: string): string;

/**
 * [`folder_keys`](folder_layout::folder_keys) (TS `folderKeys`): every folder the picked files
 * lead to, shallowest first.
 */
export function folderKeys(relative_paths: string[]): string[];

/**
 * [`folder_title_from_path`](folder_layout::folder_title_from_path).
 */
export function folderTitleFromPath(path: string): string;

/**
 * [`font_size_of`](analysis_text::font_size_of) (TS `fontSizeOf`).
 *
 * # Errors
 *
 * Fails if `item` is not a text item with `str`, `transform`, `width` and `height`.
 */
export function fontSizeOf(item: any): number;

/**
 * [`forget_search_query`](search_history::forget_search_query).
 */
export function forgetSearchQuery(history: string[], query: string): string[];

/**
 * [`format_citation`](cite_key::format_citation) (TS `formatCitation`).
 */
export function formatCitation(key: string, format: string): string;

/**
 * [`format_count`](stats::format_count).
 */
export function formatCount(value: number): string;

/**
 * [`format_cursor`](stats::format_cursor).
 */
export function formatCursorLabel(line: number, col: number): string;

/**
 * [`format_figure_tokens`](figure::format_figure_tokens): the tokens written in an alt.
 *
 * # Errors
 *
 * Fails if `geometry` has the wrong shape.
 */
export function formatFigureTokens(geometry: any): string;

/**
 * [`format_invite_code`](org::format_invite_code).
 */
export function formatInviteCode(raw: string): string;

/**
 * [`format_log_line`]: one log entry as the text the panel and the log file both show.
 */
export function formatLogLine(at: string, level: string, source: string, message: string, detail?: string | null): string;

/**
 * [`format_metric_cell`](experiment_status::format_metric_cell).
 *
 * # Errors
 *
 * Fails if `value` cannot be read as JSON.
 */
export function formatMetricCell(metric: string, value: any): string;

/**
 * [`format_metric_value`](experiment_status::format_metric_value).
 */
export function formatMetricValue(metric: string, value: number): string;

/**
 * [`format_paper_citation`](cite_key::format_paper_citation) (TS `formatPaperCitation`).
 *
 * # Errors
 *
 * Fails if `paper` is not an object with a string `id`.
 */
export function formatPaperCitation(paper: any, format: string): string;

/**
 * [`format_quote_block`] for JS (TS `formatQuoteBlock`).
 *
 * # Errors
 *
 * Fails when `quote` is over the text cap.
 */
export function formatQuoteBlock(quote: string): string;

/**
 * [`format_quote_cite_clipboard`] for JS (TS `formatQuoteCiteClipboard`).
 *
 * # Errors
 *
 * Fails when `quote` is over the text cap.
 */
export function formatQuoteCiteClipboard(quote: string, paper_title: string): string;

/**
 * [`format_reference`](reference_text::format_reference).
 *
 * # Errors
 *
 * Fails when `paper` is not a paper.
 */
export function formatReference(paper: any): string;

/**
 * [`format_words`](stats::format_words).
 */
export function formatWords(words: number): string;

/**
 * [`wf_core::sync::blob_links::from_relative_blob_links_mapped`] for JS. `resolved`
 * is `{ "assets/<scope>/<path>": storagePath }`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `resolved` is
 * not an object of strings.
 */
export function fromRelativeBlobLinks(body: string, resolved: any): string;

/**
 * [`frontmatter_list`](wf_core::sync::frontmatter::frontmatter_list) for JS: a list field
 * as its entries as text, or a non-blank scalar string as one entry.
 *
 * # Errors
 *
 * Fails when `frontmatter` is not an object.
 */
export function frontmatterList(frontmatter: any, key: string): any;

/**
 * [`frontmatter_string`](wf_core::sync::frontmatter::frontmatter_string) for JS: the
 * field as text, or `undefined` when it is absent, a list, or blank.
 *
 * # Errors
 *
 * Fails when `frontmatter` is not an object.
 */
export function frontmatterString(frontmatter: any, key: string): string | undefined;

/**
 * [`furniture_key`].
 */
export function furnitureKey(s: string): string;

/**
 * [`furniture_lines`] (TS `furnitureLines`): one boolean per line, `true` for running heads
 * and folios.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of text lines.
 */
export function furnitureLines(lines: any): any;

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
 * [`fuzziness_for_term`](search_tuning::fuzziness_for_term).
 */
export function fuzzinessForTerm(term: string): number;

/**
 * [`gate_vector_mask`](hybrid_fusion::gate_vector_mask) as a boolean array.
 *
 * # Errors
 *
 * Fails if `scores` is not an array of numbers.
 */
export function gateVectorMask(scores: any, floor: number, keep_top: number): any;

/**
 * [`gemini_install`](mcp_client_config::gemini_install).
 */
export function geminiInstall(): string;

/**
 * [`get_user_integration_field`](integration_credentials::get_user_integration_field);
 * `undefined` when empty.
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function getUserIntegrationField(settings: any, provider_id: string, field_id: string): any;

/**
 * [`git_connection`](fields::git_connection).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 */
export function gitConnection(integration: any): any;

/**
 * [`git_connection_ready`](fields::git_connection_ready).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 */
export function gitConnectionReady(integration: any): boolean;

/**
 * [`git_reason`](git_reason::git_reason): git's `fatal:`/`error:` lines from a failed command's text.
 */
export function gitReason(text: string): string;

/**
 * [`github_repo_pdf_path`] (TS `githubRepoPdfPath`): the repo-relative PDF path, or none.
 */
export function githubRepoPdfPath(given_pdf_path: string | null | undefined, paper_id: string): string | undefined;

/**
 * [`gitlab_combined_active`].
 *
 * # Errors
 *
 * Fails if `config` has the wrong shape, or the result cannot be converted to JS.
 */
export function gitlabCombinedActive(config: any): any;

/**
 * [`graph_degrees`](wiki_graph::graph_degrees), as `{ node, degree }` rows.
 *
 * # Errors
 *
 * Fails if `graph` has the wrong shape.
 */
export function graphDegrees(graph: any): any;

/**
 * [`graph_density`](wiki_graph::graph_density).
 *
 * # Errors
 *
 * Fails if `graph` has the wrong shape.
 */
export function graphDensity(graph: any): any;

/**
 * [`graph_filter_count`](graph_settings::graph_filter_count), given the two selection sizes.
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function graphFilterCountFor(selected_tags: number, selected_lists: number, settings: any): number;

/**
 * [`graph_palette`](graph_colour::graph_palette): every fixed colour the graph draws.
 *
 * # Errors
 *
 * Fails only if the palette cannot be serialised.
 */
export function graphPalette(): any;

/**
 * [`graph_tag_names`](graph_tags::graph_tag_names): every filterable tag, sorted.
 *
 * # Errors
 *
 * Fails if `papers`, `notes` or `lists` has the wrong shape.
 */
export function graphTagNames(papers: any, notes: any, lists: any, include_lists: boolean): any;

/**
 * [`graph_topology_key`](topology::graph_topology_key). `shown` is `{ nodes, links }` with `id` on each entry.
 *
 * # Errors
 *
 * Fails if `shown` has the wrong shape.
 */
export function graphTopologyKey(shown: any, local_seed: string | null | undefined, local_depth: number): string;

/**
 * [`group_by_day`] for JS (TS `groupByDay`): `{ day, indexes }[]`, newest day first.
 *
 * # Errors
 *
 * Fails when `entryDates` is not an array of strings.
 */
export function groupByDay(entry_dates: any): any;

/**
 * [`group_hunks`](panel_labels::group_hunks): unchanged and changed runs of a body diff.
 *
 * # Errors
 *
 * Fails if `lines` has the wrong shape, or the result cannot be serialised.
 */
export function groupHunks(lines: any): any;

/**
 * [`group_palette_rows`](palette_groups::group_palette_rows): the headings present, each with the
 * indices of its rows, from the group of each row.
 *
 * # Errors
 *
 * Fails if `groups` has the wrong shape.
 */
export function groupPaletteRows(groups: any): any;

/**
 * [`group_proposals`](proposal_groups::group_proposals). `items` is a list of objects with
 * `kind` and `resourceId`; `by` is `"document"` or `"kind"`; `knownIds` is an optional string
 * array. Returns `{ key, indices }[]`, with indices into `items`.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 */
export function groupProposals(items: any, by: any, known_ids: any): any;

/**
 * [`group_recurring_lines`](analysis_outline::group_recurring_lines) (TS `groupRecurringLines`).
 * The TS wrapper passes each line's text and page; members come back as indices.
 *
 * # Errors
 *
 * Fails if `texts` is not an array of strings or `pages` is not an array of numbers.
 */
export function groupRecurringLines(texts: any, pages: any): any;

/**
 * [`group_results`](quick::group_results) as an array of `{ kind, label, results }`.
 *
 * # Errors
 *
 * Fails if `results` is not an array of quick-open results.
 */
export function groupResults(results: any): any;

/**
 * [`group_runs`](groups::group_runs).
 *
 * # Errors
 *
 * Fails if `leaf` has the wrong shape.
 */
export function groupRuns(leaf: any): any;

/**
 * [`group_subtree_items`]: the subtree's items grouped by list, in subtree order.
 */
export function groupSubtreeItems(node: any, items: any): any;

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
 * [`guess_title`](paper_drop::guess_title) (TS `guessTitle`).
 */
export function guessTitle(text: string): string | undefined;

/**
 * [`has_active_lab`](org::has_active_lab).
 *
 * # Errors
 *
 * Fails if `memberships` has the wrong shape.
 */
export function hasActiveLab(active_org_id: string | null | undefined, memberships: any, owns_active_org: boolean): boolean;

/**
 * [`wf_core::sync::text_diff::has_conflict_markers`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function hasConflictMarkers(text: string): boolean;

/**
 * [`rules::has_ink_view`].
 */
export function hasInkView(kind: string): boolean;

/**
 * [`rules::has_lazy_body`].
 */
export function hasLazyBody(kind: string): boolean;

/**
 * [`has_pdf_magic`]: whether the first bytes carry the `%PDF-` signature.
 */
export function hasPdfMagic(bytes: Uint8Array): boolean;

/**
 * [`rules::has_pdf_view`].
 */
export function hasPdfView(kind: string): boolean;

/**
 * [`heading_outline`] (TS `headingOutline`).
 *
 * # Errors
 *
 * Fails if `headings` is not an array of text lines.
 */
export function headingOutline(headings: any): any;

/**
 * [`heading_slug`](heading_slug::heading_slug): the anchor id for a heading.
 */
export function headingSlug(text: string): string;

/**
 * [`highlight_within_excerpt`](evidence::highlight_within_excerpt). `locus` is a PDF locus object or
 * `undefined`; the result is `{ before, match, after, confidence }`, or `null` when nothing matches.
 *
 * # Errors
 *
 * Fails if `locus` is not a PDF locus object, or the result cannot be converted.
 */
export function highlightWithinExcerpt(excerpt: string, locus: any): any;

/**
 * [`highlights_digest`](reading_digest::highlights_digest) (TS `highlightsDigest`).
 *
 * # Errors
 *
 * Fails if `marks` is not a list of digest marks.
 */
export function highlightsDigest(marks: any, existing: string): string;

/**
 * [`host_of`]: the host and port of a PDF address for a failure line, or the address when it has none.
 */
export function hostOf(url: string): string;

/**
 * [`enum_label::humanise`]: `made_up_kind` reads `Made up kind`.
 */
export function humanise(value: string): string;

/**
 * [`humanize`](panel_labels::humanize): a field name as a label.
 */
export function humanize(field: string): string;

/**
 * [`hydrate_tab_modes`](pane::hydrate_tab_modes). `modes` is an object of tab key to mode.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function hydrateTabModes(layout: any, modes: any): any;

/**
 * [`hydrate_user_settings`](user_settings::hydrate_user_settings).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function hydrateUserSettings(settings: any): any;

/**
 * [`wf_core::sync::folder_layout::id_suffix`] for JS.
 *
 * # Errors
 *
 * Fails when `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function idSuffix(id: string): string;

/**
 * [`pglite_sql::ident`] (TS `ident`): a trimmed, double-quoted column name.
 *
 * # Errors
 *
 * Returns an error for a name the local database will not accept.
 */
export function ident(name: string): string;

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
 * [`images_of`](paper_image::images_of) (TS `imagesOf`). `null` metadata has no images.
 *
 * # Errors
 *
 * Fails if `metadata` is not an object of JSON values.
 */
export function imagesOf(metadata: any): string[];

/**
 * [`in_reference_list`](analysis_citations::in_reference_list) (TS `inReferenceList`).
 *
 * # Errors
 *
 * Fails if `ranges` is not an array of page text ranges.
 */
export function inReferenceList(page: number, start: number, end: number, ranges: any): boolean;

/**
 * [`account_menu::inbox_links`]: the Inbox rows as `{ key, label, path, icon, badge? }`.
 *
 * # Errors
 *
 * Fails if `input` is not an `InboxInput`-shaped object, or the result cannot be converted to JS.
 */
export function inboxLinks(input: any): any;

/**
 * [`enum_label::incoming_relation_label`]: `cites` reads `Cited by`.
 */
export function incomingRelationLabel(relation: string): string;

/**
 * [`index_from_analysis`]: shapes an analysis the worker already ran into the overlay's index.
 *
 * # Errors
 *
 * Fails if `analysis` or `pages` do not have the expected shape.
 */
export function indexFromAnalysis(analysis: any, pages: any): any;

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
 * [`indexTermsOf`]: the index terms of `text`, cut to the longest text the index accepts rather
 * than throwing. Rust `index_terms` with the search tokenizer defaults.
 */
export function indexTermsOf(text: string): string[];

/**
 * [`initial_reader_viewport`] as `{ scale, fit, rotation, page }` (TS `initialReaderViewport`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function initialReaderViewport(page: number): any;

/**
 * [`ink_attachment_index`](ink_page::ink_attachment_index): the attachment index of `path`, or `0`.
 */
export function inkAttachmentIndex(body: string, path?: string | null): number;

/**
 * [`ink_chunk_body_size`](chunk::ink_chunk_body_size): the body length a page would take.
 *
 * # Errors
 *
 * Fails on a body over `u32`, or a value that is not an `InkPage`.
 */
export function inkChunkBodySize(page: any): number;

/**
 * [`ink_chunk_header_bytes`](chunk::ink_chunk_header_bytes): the header for a payload.
 */
export function inkChunkHeaderBytes(body_size: number, payload_size: number, compressed: boolean): Uint8Array;

/**
 * [`ink_chunk_path`](ink_paths::ink_chunk_path).
 *
 * # Errors
 *
 * Fails when `chunkId` or `noteId` is unusable.
 */
export function inkChunkPath(note_id: string, chunk_id: string): string;

/**
 * [`ink_curve_at`] as `[x, y]`. A span past the end gives `[NaN, NaN]`, as
 * the TS copy's out-of-range reads do.
 */
export function inkCurveAt(xs: Float64Array, ys: Float64Array, i: number, u: number): Float64Array;

/**
 * [`ink_engine_info`](ink_engine::ink_engine_info): the engine's declared facts, or
 * `null` for an unknown id.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function inkEngineInfo(id: string): any;

/**
 * [`ink_enum_index`](ink_page::ink_enum_index): the position of `value` in `values`, or `0`.
 *
 * # Errors
 *
 * Fails if `values` is not an array of strings.
 */
export function inkEnumIndex(values: any, value: string): number;

/**
 * [`ink_enum_value`](ink_page::ink_enum_value): the name at `index`, or the first entry
 * where out of range; `undefined` for an empty list.
 *
 * # Errors
 *
 * Fails if `values` is not an array of strings.
 */
export function inkEnumValue(values: any, index: number): string | undefined;

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
 * [`ink_line_strokes`](ink_engine::ink_line_strokes): the strokes of one line, given
 * the line record `{ strokeStart, strokeCount, ... }`. Strokes pass through as JS values.
 *
 * # Errors
 *
 * Fails if `strokes` is not an array or `line` lacks `strokeStart` / `strokeCount`.
 */
export function inkLineStrokes(strokes: any, line: any): any;

/**
 * [`ink_note_width_to_pdf_points`].
 */
export function inkNoteWidthToPdfPoints(tenths: number): number;

/**
 * [`ink_page_background`](ink_page::ink_page_background): the background path, or `null`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function inkPageBackground(text: string): any;

/**
 * [`ink_page_confidence`] over the lines' `conf` values.
 */
export function inkPageConfidence(confs: Float64Array): number;

/**
 * [`ink_page_figures`](figure::ink_page_figures): the figures a page's text places.
 *
 * # Errors
 *
 * Fails if `text` is longer than the index text limit.
 */
export function inkPageFigures(text: string): any;

/**
 * [`ink_page_marker`](ink_page::ink_page_marker): the `<!-- page N -->` line for page `page`.
 */
export function inkPageMarker(page: number): string;

/**
 * [`ink_page_over_budget`](ink_page::ink_page_over_budget): whether the page has too many strokes.
 *
 * # Errors
 *
 * Fails if `page` has the wrong shape.
 */
export function inkPageOverBudget(page: any): boolean;

/**
 * [`ink_page_svg`]: `page` is an `InkSvgPage`, `options` an `InkSvgOptions` (may be `{}`).
 */
export function inkPageSvg(page: any, options: any): string;

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
 * [`point_in_polygon`](hit_test::point_in_polygon) over a flat `x,y` array.
 *
 * # Errors
 *
 * Fails if `polygon` is not an array of numbers.
 */
export function inkPointInPolygon(px: number, py: number, polygon: any): boolean;

/**
 * [`ink_pressure_factor`].
 */
export function inkPressureFactor(pressure?: number | null): number;

/**
 * [`ink_print_document`]: the page as an HTML document for a print frame's `srcdoc`.
 */
export function inkPrintDocument(doc: any): string;

/**
 * [`ink_sidecar_dir`](ink_paths::ink_sidecar_dir).
 *
 * # Errors
 *
 * Fails when `noteId` is not a safe id.
 */
export function inkSidecarDir(note_id: string): string;

/**
 * [`ink_stroke_band`](wf_core::ink::segment::ink_stroke_band): `[yMin, yMax]` over a
 * stroke's flat x,y points, or `undefined` when no y is finite.
 */
export function inkStrokeBandOf(points: Float64Array): Float64Array | undefined;

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
 * [`ink_vocabulary_words`](wf_core::ink::decode::ink_vocabulary_words), sorted
 * (TS `inkVocabularyWords`; the TS wrapper makes it a `Set`).
 *
 * # Errors
 *
 * Fails if `vocabulary` is not an array of strings.
 */
export function inkVocabularyWordList(vocabulary: any): any;

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
 * [`integrations_bag_from_legacy`](integration_credentials::integrations_bag_from_legacy);
 * `undefined` when no legacy field is set.
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function integrationsBagFromLegacy(settings: any): any;

/**
 * [`cache_invalidation::invalidation_map`]: one entry per resource type.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function invalidationMap(): any;

/**
 * [`cache_invalidation::plan`] for the resource type named `resource_type`, or `undefined` for an
 * unknown name.
 *
 * # Errors
 *
 * Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function invalidationPlan(resource_type: string): any;

/**
 * [`inverted_abstract`](related_paper_hit::inverted_abstract): the abstract text, or nothing.
 *
 * # Errors
 *
 * Fails if `index` is neither an object nor missing.
 */
export function invertedAbstract(index: any): any;

/**
 * [`is_all_pages`](pdf_pages::is_all_pages).
 */
export function isAllPages(answer: string): boolean;

/**
 * [`is_allowed_pdf_proxy_url`]: https, no credentials, and an allowlisted host.
 */
export function isAllowedPdfProxyUrl(raw: string): boolean;

/**
 * [`is_annotation_sync_state`] for any JS value: false unless `value` is a string.
 */
export function isAnnotationSyncState(value: any): boolean;

/**
 * [`is_api_host`](api_host::is_api_host): the URL's host is `weaveforge.org` or a subdomain of it.
 */
export function isApiHost(url: string): boolean;

/**
 * [`wf_core::sync::json_entities::is_app_owned_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isAppOwnedPath(path: string): boolean;

/**
 * [`is_bib_file`](paper_drop::is_bib_file) (TS `isBibFile`).
 */
export function isBibFile(name: string): boolean;

/**
 * [`is_bibliographic_match`](analysis_text::is_bibliographic_match) (TS `isBibliographicMatch`).
 *
 * # Errors
 *
 * Fails if `hints` or `candidate` is not an object of the expected shape.
 */
export function isBibliographicMatch(hints: any, candidate: any): boolean;

/**
 * [`is_blanket_share`](sharing::is_blanket_share); `null` or `undefined` means every resource.
 */
export function isBlanketShare(resource_id?: string | null): boolean;

/**
 * [`is_bold_font`]; `fontName` may be undefined.
 */
export function isBoldFont(font_name?: string | null): boolean;

/**
 * [`local_first_route::is_both_ends_rpc`].
 */
export function isBothEndsRpc(name: string): boolean;

/**
 * [`is_citation_destination`] (TS `isCitationDestination`). `name` is optional.
 *
 * # Errors
 *
 * Fails if `name` is neither a string nor `undefined`/`null`.
 */
export function isCitationDestination(name: any): boolean;

/**
 * [`is_conference_copy`] (TS `isConferenceCopy`).
 *
 * # Errors
 *
 * Fails if `paper` is not a paper summary.
 */
export function isConferenceCopy(paper: any): boolean;

/**
 * [`rules::is_creatable_kind`].
 */
export function isCreatableKind(kind: string): boolean;

/**
 * [`is_dismiss_tap`]: `down` and `up` are `{ x, y, time }`; `down` may be `null`.
 *
 * # Errors
 *
 * Fails if `down` or `up` is not a press object of numbers.
 */
export function isDismissTap(down: any, up: any, bar_open: boolean): boolean;

/**
 * [`rules::is_document_kind`].
 */
export function isDocumentKind(kind: string): boolean;

/**
 * [`is_document_node`](tree::is_document_node).
 *
 * # Errors
 *
 * Fails if `node` has the wrong shape.
 */
export function isDocumentNode(node: any): boolean;

/**
 * [`is_editable_reader_target`]: whether a target with this `tagName` and
 * `isContentEditable` owns its keystrokes.
 */
export function isEditableReaderTarget(tag_name: string | null | undefined, content_editable: boolean): boolean;

/**
 * [`is_electron_entry`](mcp_config_rewrite::is_electron_entry): an entry the Electron app wrote.
 */
export function isElectronMcpEntry(entry: any): boolean;

/**
 * [`is_empty_paper_summary`](paper::is_empty_paper_summary) (TS `isEmptyPaperSummary`).
 */
export function isEmptyPaperSummary(summary?: string | null): boolean;

/**
 * [`is_explicit_lab_membership`](org::is_explicit_lab_membership).
 *
 * # Errors
 *
 * Fails if `membership` has the wrong shape.
 */
export function isExplicitLabMembership(membership: any): boolean;

/**
 * [`is_highlighter_ink`]; `undefined` is `None`.
 */
export function isHighlighterInk(width?: number | null): boolean;

/**
 * [`is_html_content_type`]: whether a response counts as a web page.
 */
export function isHtmlContentType(value?: string | null): boolean;

/**
 * [`wf_core::sync::ink_note::is_ink_chunk_id`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isInkChunkId(text: string): boolean;

/**
 * [`is_ink_engine_id`](ink_engine::is_ink_engine_id).
 */
export function isInkEngineId(id: string): boolean;

/**
 * [`wf_core::sync::ink_note::is_ink_note_body`] for JS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isInkNoteBody(body: string): boolean;

/**
 * [`is_ink_note_frontmatter`](ink_note::is_ink_note_frontmatter).
 *
 * # Errors
 *
 * Fails if `frontmatter` is not an object.
 */
export function isInkNoteFrontmatter(frontmatter: any): boolean;

/**
 * [`is_ink_note_id`](ink_paths::is_ink_note_id).
 */
export function isInkNoteId(id: string): boolean;

/**
 * [`is_ink_tool`]: `ink` and `highlighter` draw on the page.
 */
export function isInkTool(tool: string): boolean;

/**
 * [`is_ip_address`](url_safety::is_ip_address).
 */
export function isIpAddress(value: string): boolean;

/**
 * [`is_iso_day`](milestone::is_iso_day).
 */
export function isIsoDay(value: string): boolean;

/**
 * [`cache_invalidation::is_known_resource_type`]: whether `value` names a resource type.
 */
export function isKnownResourceType(value: string): boolean;

/**
 * [`pglite_sql::is_literal`] (TS `isLiteral`): `null`, `true` or `false`.
 *
 * # Errors
 *
 * Returns an error for any other operand.
 */
export function isLiteral(text: string): string;

/**
 * [`is_local_zotero_url`]: whether `url` is the local Zotero API's own path with no credentials.
 */
export function isLocalZoteroUrl(url: string): boolean;

/**
 * [`is_missing_service_role`](org::is_missing_service_role).
 */
export function isMissingServiceRole(message: string): boolean;

/**
 * [`is_newer`]: whether `candidate` is later than `current`, both `[major, minor, patch]`.
 *
 * # Errors
 *
 * Fails if either argument is not three numbers.
 */
export function isNewerVersion(candidate: any, current: any): boolean;

/**
 * [`is_note_import_file`](import_links::is_note_import_file).
 */
export function isNoteImportFile(name: string): boolean;

/**
 * [`is_on_sampling_grid`](experiments::is_on_sampling_grid).
 */
export function isOnSamplingGrid(step: number): boolean;

/**
 * [`is_valid_project_id`](overleaf::is_valid_project_id).
 */
export function isOverleafProjectId(id: string): boolean;

/**
 * [`is_paper_field_kind`](paper_field::is_paper_field_kind) (TS `isPaperFieldKind`).
 */
export function isPaperFieldKind(value: string): boolean;

/**
 * [`is_pdf_content_type`]: whether a `Content-Type` value names a PDF. `null` or empty is not.
 */
export function isPdfContentType(value?: string | null): boolean;

/**
 * [`is_pdf_file`](paper_drop::is_pdf_file) (TS `isPdfFile`).
 */
export function isPdfFile(name: string, mime_type: string): boolean;

/**
 * [`is_pen_barrel_pointer`](pen_pointer::is_pen_barrel_pointer): whether a pen touched
 * down with its barrel button held.
 */
export function isPenBarrelPointer(pointer_type: string, button?: number | null, buttons?: number | null): boolean;

/**
 * [`is_pen_eraser_pointer`](pen_pointer::is_pen_eraser_pointer): whether a pointer
 * event is the pen's eraser end.
 */
export function isPenEraserPointer(pointer_type: string, button?: number | null, buttons?: number | null): boolean;

/**
 * [`is_placeholder_title`](paper_title::is_placeholder_title) (TS `isPlaceholderTitle`).
 */
export function isPlaceholderTitle(title?: string | null): boolean;

/**
 * [`is_preview_key`](palette_sort::is_preview_key): whether a key press opens the preview.
 *
 * # Errors
 *
 * Fails if `event` has the wrong shape.
 */
export function isPreviewKey(event: any, in_text_box: boolean): boolean;

/**
 * [`is_private_host`](private_host::is_private_host): a host this machine or its network answers for.
 */
export function isPrivateHost(hostname: string): boolean;

/**
 * [`is_public_address`](url_safety::is_public_address).
 */
export function isPublicAddress(address: string): boolean;

/**
 * [`is_public_https_url`](private_host::is_public_https_url): https, no credentials, public host.
 * `false` for text that does not parse, as the TS `catch` did.
 */
export function isPublicHttpsUrl(raw: string): boolean;

/**
 * [`is_quotation_type`](annotation_quotation_type::is_quotation_type) (TS `isQuotationType`).
 */
export function isQuotationType(value: string): boolean;

/**
 * [`is_reader_annotation_type`] for any JS value: false unless `value` is a string.
 */
export function isReaderAnnotationType(value: any): boolean;

/**
 * [`is_rotated_text`](analysis_outline::is_rotated_text) (TS `isRotatedText`).
 */
export function isRotatedText(transform: Float64Array): boolean;

/**
 * [`wf_core::workspace::is_safe_workspace_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function isSafeWorkspacePath(path: string): boolean;

/**
 * [`is_open`](state::is_open).
 *
 * # Errors
 *
 * Fails if the open argument is not an array of strings.
 */
export function isSectionOpen(open: any, id: string): boolean;

/**
 * [`is_settled`](panel_labels::is_settled): whether a field's choice is complete.
 *
 * # Errors
 *
 * Fails if `choice` has the wrong shape.
 */
export function isSettled(choice: any, ours: string, theirs: string): boolean;

/**
 * [`is_stale_running_experiment`](experiment_status::is_stale_running_experiment); `undefined` last metric time means none.
 *
 * # Errors
 *
 * Fails if `experiment` has the wrong shape.
 */
export function isStaleRunningExperiment(experiment: any, now_ms: number, stale_ms: number, last_metric_at_ms?: number | null): boolean;

/**
 * [`is_substantial_paper_text`]: whether the text reaches `min_chars` once whitespace is collapsed.
 */
export function isSubstantialPaperText(text: string, min_chars: number): boolean;

/**
 * [`is_supervisor_role`](member::is_supervisor_role).
 */
export function isSupervisorRole(role?: string | null): boolean;

/**
 * [`local_first_route::is_synced_table`].
 */
export function isSyncedTable(table: string): boolean;

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
 * [`is_user_integration_connected`](integration_credentials::is_user_integration_connected).
 *
 * # Errors
 *
 * Fails if `settings` or `field_ids` has the wrong shape.
 */
export function isUserIntegrationConnected(settings: any, provider_id: string, field_ids: any): boolean;

/**
 * [`is_web_article`]: `ids` is an `OpenAccessIds`.
 *
 * # Errors
 *
 * Fails if `ids` does not have the expected shape.
 */
export function isWebArticle(ids: any): boolean;

/**
 * [`is_child_item`](zotero_library::is_child_item): true for an attachment, note, annotation or
 * an item with a parent.
 *
 * # Errors
 *
 * Fails if `item` cannot be read as an object.
 */
export function isZoteroChildItem(item: any): boolean;

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
 * [`join_bibtex`](bibtex::join_bibtex): entries joined with a blank line, or `% (empty)`.
 *
 * # Errors
 *
 * Fails if `entries` is not an array of strings.
 */
export function joinBibtex(entries: any): string;

/**
 * [`join_ink_text_layer`](ink_page::join_ink_text_layer): one text layer per page, joined.
 *
 * # Errors
 *
 * Fails if `pages` is not an array of strings.
 */
export function joinInkTextLayer(pages: any): string;

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
 * [`json_edit_since`](folder_mirror::json_edit_since). `base` is the recorded digest map.
 *
 * # Errors
 *
 * Fails when `base` is not an object of string digests.
 */
export function jsonEditSince(base: any, path: string, text: string): boolean;

/**
 * [`wf_core::sync::json_entities::json_kind_of_path`] for JS; `undefined` for none.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function jsonKindOfPath(path: string): string | undefined;

/**
 * [`keep_figure_on_page`](figure::keep_figure_on_page): the box's `[x, y]` kept half on the page.
 *
 * # Errors
 *
 * Fails if `rect` has the wrong shape.
 */
export function keepFigureOnPage(rect: any, width: number, height: number): Float64Array;

/**
 * [`shortcut_label::key_label`]: one keycap, `⌘` reads `Ctrl` off a Mac.
 */
export function keyLabel(key: string, mac: boolean): string;

/**
 * [`rules::kind_icon`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindIcon(kind: string): any;

/**
 * [`rules::kind_icon_class`]. `open` defaults to false.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindIconClass(kind: string, open?: boolean | null): any;

/**
 * [`kind_multiplier`](search_settings::kind_multiplier); an unknown `kind` reads as `1`.
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function kindMultiplier(kind: string, settings: any): number;

/**
 * [`rules::KINDS`] as a string array.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindNames(): any;

/**
 * [`kind_of`](panel_labels::kind_of): the label for a synced table.
 */
export function kindOf(table: string): string;

/**
 * [`rules::kind_owner`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindOwner(kind: string): any;

/**
 * [`rules::kind_suffix`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindSuffix(kind: string): any;

/**
 * [`rules::kind_tint_class`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function kindTintClass(kind: string): any;

/**
 * [`kinds_for_resource`](search_index_state::kinds_for_resource): the kinds a write can change, or `null` when unmapped.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialized.
 */
export function kindsForResource(resource_type: string): any;

/**
 * [`wf_core::papers::open_access::known_candidates`]: the paper's own PDF and page.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function knownCandidates(known_pdf?: string | null, page?: string | null): any;

/**
 * [`to_domain`]: a `lab_snapshots` row as a published snapshot.
 */
export function labSnapshotRowToDomain(row: any): any;

/**
 * [`route_title::label_for_path`]: the screen's own name, or `undefined` for a route with none.
 *
 * # Errors
 *
 * Fails if `nav_items` is not an array of `{ path, label }` objects.
 */
export function labelForPath(pathname: string, nav_items: any): string | undefined;

/**
 * [`labelNumber`](bibliography::label_number): entry number from the exec groups.
 *
 * # Errors
 *
 * Returns an error when `groups` is not an array of strings or `undefined`.
 */
export function labelNumber(groups: any): number;

/**
 * [`label_size`](graph_sizing::label_size) as `{ font, line, gap }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function labelSize(is_tag: boolean, zoom: number, bounded: boolean): any;

/**
 * [`ladder_order`] (TS `ladderOrder`): the indexes of the supporting resolvers, in order.
 *
 * # Errors
 *
 * Fails if `supports` is not an array of booleans.
 */
export function ladderOrder(supports: any): any;

/**
 * [`latest_by_reviewer`](screening::latest_by_reviewer) (TS `latestByReviewer`), as the
 * decisions in `Map` order.
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 */
export function latestByReviewerList(decisions: any, item_id: string, stage: any): any;

/**
 * [`layout_for_command`](pane::layout_for_command). `command` is a chord name such as `"split-right"`.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function layoutForCommand(layout: any, command: any, new_pane_id: string): any;

/**
 * [`layout_for_tab_menu`](pane::layout_for_tab_menu).
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function layoutForTabMenu(layout: any, pane_id: string, index: number, command: any, new_pane_id: string): any;

/**
 * [`layout_from_record`](layout_record::layout_from_record). A missing or
 * unusable record is one empty pane, so this never fails on content.
 *
 * # Errors
 *
 * Never fails in practice; returns the serializer's result type.
 */
export function layoutFromRecord(raw?: string | null): any;

/**
 * [`layout_margin_notes`]: `marks` is one `{ hasComment, hasPicture, geometry }` per
 * annotation and `projection` a page projection. Returns `{ index, top, anchorTop }[]` in
 * ascending `anchorTop` order, where `index` is the mark's position in `marks`.
 *
 * # Errors
 *
 * Fails if `marks` or `projection` do not have the expected shape.
 */
export function layoutMarginNotes(marks: any, projection: any, card_height: number): any;

/**
 * [`leaves`](pane::leaves). Returns owned copies of the leaves.
 *
 * # Errors
 *
 * Fails if `node` has the wrong shape.
 */
export function leaves(node: any): any;

/**
 * [`levenshtein`](analysis_outline::levenshtein) (TS `levenshtein`).
 */
export function levenshtein(a: string, b: string, limit: number): number;

/**
 * [`library_bibtex`](bibtex::library_bibtex): the whole library as one `.bib`.
 *
 * # Errors
 *
 * Fails if `papers` is not an array of paper objects.
 */
export function libraryBibtex(papers_value: any): string;

/**
 * [`to_domain`]: a `library_pins` row as a library pin.
 *
 * # Errors
 *
 * Fails if the row cannot be read as a `library_pins` row.
 */
export function libraryPinRowToDomain(row: any): any;

/**
 * [`link_citation_mentions`](link_citations::link_citation_mentions) (TS
 * `linkCitationMentions`).
 *
 * # Errors
 *
 * Fails if `page`, `links` or `refs` do not have the expected shape.
 */
export function linkCitationMentions(page: any, links: any, refs: any): any;

/**
 * [`rules::link_group_of`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function linkGroupOf(kind: string): any;

/**
 * [`link_node_id`] (TS `linkNodeId`). `source` is a string endpoint or an endpoint object; the
 * result is the id, or `null` when there is none.
 *
 * # Errors
 *
 * Fails if `source` cannot be read as a JSON value.
 */
export function linkNodeId(source: any): any;

/**
 * [`lint_wiki`](wiki_lint::lint_wiki). A missing `otherTitles` means none, as in the TS default.
 *
 * # Errors
 *
 * Fails if `pages` is not a list of `{ id, title, body, aliases? }` objects, or `otherTitles`
 * is not a list of strings.
 */
export function lintWiki(pages: any, other_titles: any): any;

/**
 * [`list_display_colour`](reading_list::list_display_colour).
 *
 * # Errors
 *
 * Fails if `list` has the wrong shape.
 */
export function listDisplayColor(list: any): string;

/**
 * [`list_membership`](tree::list_membership). Returns a JS `Map` of `kind:id` to list titles.
 *
 * # Errors
 *
 * Fails if either argument has the wrong shape.
 */
export function listMembership(items: any, titles: any): any;

/**
 * [`list_membership`](reading_list::list_membership) (TS `buildListMembership`). `key` is
 * `"paper"`, `"vaultPage"` or `"either"`. Returns `[listId, resourceIds[]]` pairs in list order.
 *
 * # Errors
 *
 * Fails if `lists`, `items` or `key` has the wrong shape.
 */
export function listMembershipByKey(lists: any, items: any, key: any): any;

/**
 * [`nav_open_groups::load_open_groups`]: the open groups from stored JSON, with `active` forced open.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function loadOpenGroups(raw?: string | null, active?: string | null): any;

/**
 * [`local_keys`](related_paper_hit::local_keys): the dedupe keys of a library.
 *
 * # Errors
 *
 * Fails if `papers` cannot be read as a list of library papers.
 */
export function localKeys(papers: any): any;

/**
 * [`local_subgraph`] (TS `localSubgraph`). `neighbors` is an array of `[id, neighbourIds]` pairs.
 *
 * # Errors
 *
 * Fails if `neighbors` is not an array of `[string, string[]]` pairs.
 */
export function localSubgraph(seed: string | null | undefined, depth: number, neighbors: any): any;

/**
 * [`locate_anchor`](text_anchor::locate_anchor): `{ start, end }`, or `null`.
 *
 * # Errors
 *
 * Fails when `anchor` is not a comment anchor.
 */
export function locateAnchor(text: string, anchor: any): any;

/**
 * [`locate_mention`]: the rects and bounds a mention covers on its page.
 *
 * # Errors
 *
 * Fails if `items` is not an array of page text items.
 */
export function locateMention(items: any, start: number, end: number): any;

/**
 * [`validate_new_log_entry`](log_entry::validate_new_log_entry): the error message, or `None`.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function logEntryInputError(input: any): string | undefined;

/**
 * [`log_entry_message`] for JS (TS `logEntryMessage`).
 *
 * # Errors
 *
 * Fails when `input` is not a log entry message input with the expected fields.
 */
export function logEntryMessage(input: any): string;

/**
 * [`to_domain`]: a `log_entries` row as a domain entry.
 */
export function logEntryToDomain(row: any): any;

/**
 * [`to_row`]: a domain entry as the `log_entries` row it is written as.
 */
export function logEntryToRow(entry: any): any;

/**
 * [`log_eyebrow`] for JS (TS `logEyebrow`): the line, or `undefined` with no entries.
 *
 * # Errors
 *
 * Fails when `entryDates` is not an array of strings.
 */
export function logEyebrow(entry_dates: any, today: string): any;

/**
 * [`log_path`](folder_layout::log_path).
 */
export function logPath(id: string, entry_date: string, project_root: string): string;

/**
 * [`looks_like_image_url`](wf_core::net::image_url::looks_like_image_url): the URL's own
 * path names a picture, so a pasted link is worth downloading.
 */
export function looksLikeImageUrl(url: string): boolean;

/**
 * [`looks_like_pdf_url`]: `true` for a direct PDF path, `false` for an HTML landing page.
 */
export function looksLikePdfUrl(url: string): boolean;

/**
 * [`make_ink_stroke`](ink_page::make_ink_stroke) with the defaults filled in.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function makeInkStroke(input: any): any;

/**
 * [`map_ink_confidence`]; `scale` defaults to 1.
 */
export function mapInkConfidence(raw: number, scale?: number | null): number;

/**
 * [`mark_actions`]: what the popover on a tapped mark offers, or `null` when it offers nothing.
 *
 * # Errors
 *
 * Fails if `target` is not a mark's `{ type, origin, comment }` object.
 */
export function markActions(target: any): any;

/**
 * [`mark_colour_tool`]: returns `"pen"`, `"highlight"`, `"underline"` or `"text"`.
 */
export function markColourTool(mark_type: string): string;

/**
 * [`mark_popover_shown`]: whether a mark's popover shows under the current tool.
 */
export function markPopoverShown(annotation_type: string, tool: string): boolean;

/**
 * [`wf_core::sync::markdown_image::markdown_image`] for JS.
 *
 * # Errors
 *
 * Fails when an argument is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function markdownImage(target: string, alt: string): string;

/**
 * [`markdown_to_latex`](markdown_to_latex::markdown_to_latex) (TS `markdownToLatex`).
 *
 * # Errors
 *
 * Fails if `opts` is not an options object.
 */
export function markdownToLatex(md: string, opts: any): any;

/**
 * [`match_author_year_text`](analysis_citations::match_author_year_text) (TS `matchAuthorYearText`).
 *
 * # Errors
 *
 * Fails if `refs` is not an array of parsed references.
 */
export function matchAuthorYearText(text: string, refs: any): any;

/**
 * [`match_page_citations`] (TS `matchPageCitations`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function matchPageCitations(page: any, references: any, reference_ranges: any): any;

/**
 * [`match_vocabulary`](vocab_match::match_vocabulary) as `{ text, matches }`.
 *
 * # Errors
 *
 * Fails if `vocabulary` is not an array of strings, or the result cannot be serialised.
 */
export function matchVocabulary(text: string, vocabulary: any): any;

/**
 * [`matching_page_indices`](palette_groups::matching_page_indices): the indices of the labels that
 * hold `query`, names that start with it first.
 *
 * # Errors
 *
 * Fails if `query` is too long or `labels` is not an array of strings.
 */
export function matchingPageIndices(labels: any, query: string): any;

/**
 * [`mattermost_channel_for`](options::mattermost_channel_for); `undefined` when the event is off.
 *
 * # Errors
 *
 * Fails if `integration` or `event` has the wrong shape.
 */
export function mattermostChannelFor(integration: any, event: any): string | undefined;

/**
 * [`mattermost_connection`](fields::mattermost_connection).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 */
export function mattermostConnection(integration: any): any;

/**
 * [`mattermost_connection_ready`](fields::mattermost_connection_ready).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 */
export function mattermostConnectionReady(integration: any): boolean;

/**
 * [`mattermost_events`](options::mattermost_events): the settings rows, in panel order.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function mattermostEvents(): any;

/**
 * [`mattermost_options`](options::mattermost_options) with the defaults applied.
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 */
export function mattermostOptions(integration: any): any;

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
 * [`MAX_REPORT_CHARS`] for JS, so the wrapper's default cap matches Rust.
 */
export function maxReportChars(): number;

/**
 * [`blob_access::MAX_SIGNED_URL_PATHS`]: most paths one signed-url request may ask for.
 */
export function maxSignedUrlPaths(): number;

/**
 * [`may_drive_device`] for JS (TS `mayDriveDevice`).
 */
export function mayDriveDevice(signed_in_user_id?: string | null, adopted_account_id?: string | null): boolean;

/**
 * [`may_open_externally`](open_external::may_open_externally): a plain web address, with no
 * credentials, on an allowed port and not a private host. Scheme-less input is read as https.
 */
export function mayOpenExternally(url: string): boolean;

/**
 * [`mcp_file_of`](mcp_config_rewrite::mcp_file_of): the MCP file name an env points at.
 */
export function mcpFileOf(env: any): string;

/**
 * [`mcp_read_result`](mcp_result::mcp_read_result), as a plain JS `McpResult` object.
 *
 * # Errors
 *
 * Fails if `items` is not an array of `{ label, text }` objects.
 */
export function mcpReadResult(items: any, max_item_chars: number | null | undefined, max_result_chars: number | null | undefined, nonce: string): any;

/**
 * [`mcp_servers_json`](mcp_client_config::mcp_servers_json) for a `McpLaunchLine`.
 *
 * # Errors
 *
 * Fails if `launch` has the wrong shape.
 */
export function mcpServersJson(launch: any): string;

/**
 * [`mean_pressure`]; `undefined` when no sample reports pressure.
 */
export function meanPressure(samples: Float64Array): number | undefined;

/**
 * [`media_type_essence`]: the media type without parameters, lowercased.
 */
export function mediaTypeEssence(value: string): string;

/**
 * [`member_name_map`](wf_core::member::member_name_map).
 *
 * # Errors
 *
 * Fails when `members` is not a list of member sources.
 */
export function memberNameMap(members: any): any;

/**
 * [`rules::member_rank`].
 */
export function memberRank(kind: string): number;

/**
 * [`member_role_label`](member::member_role_label): the label, or `undefined` when the role has none.
 *
 * # Errors
 *
 * Fails if `member` has the wrong shape.
 */
export function memberRoleLabelOf(member: any, in_lab: boolean, owns_org: boolean): string | undefined;

/**
 * [`to_domain`]: a `profiles` row as a lab member.
 */
export function memberRowToDomain(row: any): any;

/**
 * [`to_view`]: an `org_memberships` row with its embedded organisation as a membership view.
 */
export function membershipViewFromRow(row: any): any;

/**
 * [`mention_item_ranges`]: where a mention's offsets fall in each run it covers.
 *
 * # Errors
 *
 * Fails if `items` is not an array of page text items.
 */
export function mentionItemRanges(items: any, start: number, end: number): any;

/**
 * [`mention_rects`](analysis_text::mention_rects) as an array of rects (TS `mentionRects`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 */
export function mentionRects(items: any, start: number, end: number): any;

/**
 * [`merge_both_changed`](folder_merge::merge_both_changed). `base` and `workspace_content`
 * may be absent, which keeps the entry as it was.
 *
 * # Errors
 *
 * Fails when `entry` or `base` is not the shape the folder import produces.
 */
export function mergeBothChanged(entry: any, base: any, workspace_content?: string | null): any;

/**
 * [`merge_extractions`](extraction::merge_extractions).
 *
 * # Errors
 *
 * Fails when `results` is not a list of extraction results.
 */
export function mergeExtractions(results: any): any;

/**
 * [`merge_graph_persisted_state`](graph_settings::merge_graph_persisted_state): `stored` is the
 * parsed state, or `null` for the defaults.
 *
 * # Errors
 *
 * Fails if `stored` has the wrong shape.
 */
export function mergeGraphPersistedState(stored: any): any;

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
 * [`merge_paper_into`] (TS `mergePaperInto`). The kept paper with the duplicate's gaps filled.
 *
 * # Errors
 *
 * Fails if either argument is not a paper, or the result cannot be converted.
 */
export function mergePaperInto(keep: any, dup: any): any;

/**
 * [`merge_reader_annotations`](merge_annotations::merge_reader_annotations): Zotero and
 * local rows as one list sorted by `sortIndex`. Rows come back as copies, not the same
 * objects, and an `undefined` field reads back as `null`.
 *
 * # Errors
 *
 * Fails if either argument is not an array, or the result cannot be converted to JS.
 */
export function mergeReaderAnnotations(zotero: any, local: any): any;

/**
 * [`wf_core::sync::merge::merge_rows`] for JS, as `{ merged, conflicts }`.
 *
 * # Errors
 *
 * Fails when a row is not a plain object of JSON values.
 */
export function mergeRows(base: any, local: any, remote: any): any;

/**
 * [`merge_seen_ids`](citation_alerts::merge_seen_ids): prior ids, then new ones, each once.
 */
export function mergeSeenIds(prior: string[], current: string[]): string[];

/**
 * [`merge_template`](tpl::merge_template).
 */
export function mergeTemplate(existing: string, rendered: string): string;

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
 * [`merge_wiki_pages`](wiki_merge::merge_wiki_pages).
 *
 * # Errors
 *
 * Fails if `primary` or `secondary` is not a `{ id, title, body, aliases?, sources? }` object.
 */
export function mergeWikiPages(primary: any, secondary: any): any;

/**
 * [`metadata_title`](paper_drop::metadata_title) (TS `metadataTitle`).
 */
export function metadataTitle(raw?: string | null): string | undefined;

/**
 * [`metric_keys`](experiment_status::metric_keys): the metric names across runs, in UTF-16 order.
 *
 * # Errors
 *
 * Fails if `experiments` is not an array of run objects.
 */
export function metricKeys(experiments: any): any;

/**
 * [`to_domain`]: a metric row as a metric point.
 */
export function metricRowToDomain(row: any): any;

/**
 * [`migrated_expanded`](state::migrated_expanded).
 *
 * # Errors
 *
 * Fails if an argument is not an array of strings, or the result cannot be serialised.
 */
export function migratedExpanded(saved: any, roots: any): any;

/**
 * [`migrated_notice`](migrated_notice::migrated_notice): the warning for the marker's text, or
 * `undefined` when there is no marker. The TS wrapper maps `undefined` to `null`.
 */
export function migratedNotice(raw?: string | null): string | undefined;

/**
 * [`to_milestone`]: a `milestones` row as the app's milestone.
 */
export function milestoneFromRow(row: any): any;

/**
 * [`validate_new_milestone`](milestone::validate_new_milestone): the validation message, or
 * `undefined` when the input is valid.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function milestoneInputError(input: any): string | undefined;

/**
 * [`milestone_message`] for JS (TS `milestoneMessage`).
 *
 * # Errors
 *
 * Fails when `input` is not a milestone message input with the expected fields.
 */
export function milestoneMessage(input: any): string;

/**
 * [`to_row`]: a milestone as the `milestones` row it is written as.
 */
export function milestoneToRow(milestone: any): any;

/**
 * [`milestones_to_ics`](feed::milestones_to_ics): the `.ics` text for `items`.
 *
 * # Errors
 *
 * Fails if `items` has the wrong shape.
 */
export function milestonesToIcs(items: any, include_done: boolean, reminder_days: number, now_ms: number): string;

/**
 * [`MIN_ARTICLE_TEXT_CHARS`]: the text a paper's own web page must carry.
 */
export function minArticleTextChars(): number;

/**
 * [`MIN_PAPER_TEXT_CHARS`]: how much text a page must carry to count as the paper.
 */
export function minPaperTextChars(): number;

/**
 * [`missing_config_message`]: names the absent required env vars, never values.
 * `cfg` is the backend config object; `required` is an array of camelCase field names.
 *
 * # Errors
 *
 * Fails if `cfg` is not an object of optional strings, `required` is not an array of
 * known field names, or the result cannot be converted to JS.
 */
export function missingConfigMessage(cfg: any, required: any): any;

/**
 * [`missing_figure_warning`](export_path::missing_figure_warning).
 */
export function missingFigureWarning(zip_path: string, storage_path: string): string;

/**
 * [`missing_page_plans`]: one placeholder plan per distinct, non-blank dead-link target.
 */
export function missingPagePlans(targets: any): any;

/**
 * [`missing_r2_config_message`]: names the unset R2 env vars, never values.
 *
 * # Errors
 *
 * Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
 */
export function missingR2ConfigMessage(fields: any): any;

/**
 * [`try_model_cache_url`](model_cache::try_model_cache_url): the cache URL a request names, or
 * `null` when it is not a weights request.
 *
 * # Errors
 *
 * Throws on a URL that does not parse, as `new URL` did in the TS.
 */
export function modelCacheUrl(url: string, app_host: string): string | undefined;

/**
 * [`rules::modes_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function modesFor(kind: string): any;

/**
 * [`move_tab`](pane::move_tab).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function moveTab(layout: any, from_pane_id: string, from_index: number, to_pane_id: string, to_index?: number | null): any;

/**
 * [`moved_ids`]: `ids` with `id` moved one step (`-1` or `1`), or `undefined` at either end.
 */
export function movedIds(ids: any, id: string, step: number): any;

/**
 * [`name_of`](panel_labels::name_of): a conflict's title, or "Untitled".
 *
 * # Errors
 *
 * Fails if `local` or `remote` is not an object (or null for `remote`).
 */
export function nameOf(local: any, remote: any): string;

/**
 * [`native_citation_mentions`] (TS `nativeCitationMentions`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function nativeCitationMentions(page: any, refs: any, excluded: any): any;

/**
 * [`needs_disclaimer_acceptance`](user_settings::needs_disclaimer_acceptance).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function needsDisclaimerAcceptance(settings: any): boolean;

/**
 * [`needs_migration_hint`](org::needs_migration_hint).
 */
export function needsMigrationHint(message: string): boolean;

/**
 * [`needs_org_setup`](org::needs_org_setup).
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 */
export function needsOrgSetup(state: any): boolean;

/**
 * [`needs_standalone_role_sync`](member::needs_standalone_role_sync).
 *
 * # Errors
 *
 * Fails if `profile` or `memberships` has the wrong shape.
 */
export function needsStandaloneRoleSync(profile: any, memberships: any, in_lab: boolean): boolean;

/**
 * [`neutralise_context`](untrusted_context::neutralise_context).
 */
export function neutraliseContext(text: string, nonce: string): string;

/**
 * [`new_ink_chunk_id`](ink_paths::new_ink_chunk_id). JS passes `Date.now()` as `nowMs` and a
 * 10-byte `Uint8Array` filled by `crypto.getRandomValues` as `randomBytes`.
 *
 * # Errors
 *
 * Fails when `nowMs` is not finite.
 */
export function newInkChunkId(now_ms: number, random_bytes: Uint8Array): string;

/**
 * [`wf_core::error_report::issue_url::new_issue_url`] for JS: the address for
 * `body`, cut to fit the length limit.
 *
 * # Errors
 *
 * Fails when `title`, `body` or `repo` is over the text cap.
 */
export function newIssueUrl(title: string, body: string, repo: string): string;

/**
 * [`newest_release`]: the newest stable desktop release in `releases`, or `null`.
 *
 * # Errors
 *
 * Fails if `releases` does not match the release list shape, or the result cannot be converted
 * to JS.
 */
export function newestDesktopRelease(releases: any): any;

/**
 * [`newest_first_order`] for JS (TS `newestFirstOrder`): indexes, latest stamp first.
 *
 * # Errors
 *
 * Fails when `publishedAt` is not an array of strings.
 */
export function newestFirstOrder(published_at: any): any;

/**
 * [`next_auth_step`] (TS `nextAuthStep`): the step as `{ kind, ... }`.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 */
export function nextAuthStep(user_id: string | null | undefined, previous_id: string | null | undefined, signing_out: boolean, was_expired: boolean, desktop: boolean, local_account_id?: string | null): any;

/**
 * [`next_page_offset`](semantic_scholar_citation::next_page_offset): the next offset, or `-1`
 * to stop. A non-number `next` is read as missing, as the TS did.
 *
 * # Errors
 *
 * Fails if `next` cannot be read as JSON.
 */
export function nextCitationPageOffset(current_offset: number, next: any, pages_fetched: number): number;

/**
 * [`next_manifest`](folder_mirror::next_manifest).
 */
export function nextManifest(previous: string[], written: string[], removed: string[]): string[];

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
 * [`node_size`](graph_sizing::node_size) as `{ r, line, drop, hit }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function nodeSize(base_r: number, zoom: number, bounded: boolean): any;

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
 * [`normalize_ai_access_settings`](access_policy::normalize_ai_access_settings); `undefined` reads as none.
 *
 * # Errors
 *
 * Fails if a field has the wrong JS type (for example a non-boolean `enabled`).
 */
export function normalizeAiAccessSettings(input: any): any;

/**
 * [`normalize_appearance`](user_appearance::normalize_appearance); `undefined` when
 * nothing is valid.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 */
export function normalizeAppearance(raw: any): any;

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
 * [`normalize_color_value`](theme_config::normalize_color_value); `undefined` for a
 * non-string or a rejected color.
 */
export function normalizeColorValue(raw: any): string | undefined;

/**
 * [`normalize_comment_input`](sharing::normalize_comment_input); a message throws as text.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 */
export function normalizeCommentInput(input: any): any;

/**
 * [`normalize_doi`](paper::normalize_doi) (TS `normalizeDoi`). `None` becomes `undefined`.
 */
export function normalizeDoi(doi?: string | null): string | undefined;

/**
 * [`normalize_field_name`](paper_field::normalize_field_name) (TS `normalizeFieldName`).
 */
export function normalizeFieldName(raw: string): string;

/**
 * [`normalize_font_stack`](theme_config::normalize_font_stack); `undefined` for a
 * non-string or a rejected stack.
 */
export function normalizeFontStack(raw: any): string | undefined;

/**
 * [`normalize_graph_view_settings`](graph_settings::normalize_graph_view_settings).
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 */
export function normalizeGraphViewSettings(raw: any): any;

/**
 * [`normalize_highlight_rects`]: one clean band per line of a text highlight.
 *
 * # Errors
 *
 * Fails if `rects` is not an array of number arrays.
 */
export function normalizeHighlightRects(rects: any): any;

/**
 * A length from a number (px) or a string, limited to `max_px` (default 64).
 */
export function normalizeLengthValue(raw: any, max_px?: number | null): string | undefined;

/**
 * [`wf_core::sync::markdown_image::normalize_markdown_image_syntax`] for JS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function normalizeMarkdownImageSyntax(body: string): string;

/**
 * [`normalize_invite_code`](org::normalize_invite_code).
 */
export function normalizeOrgInviteCode(input: string): string;

/**
 * [`normalize_paste_settings`] for JS. `json` is `JSON.stringify` of whatever was stored.
 *
 * # Errors
 *
 * Fails when `json` is not valid JSON or is over the text cap.
 */
export function normalizePasteSettings(json: string): any;

/**
 * [`normalize_project_path`](project_path::normalize_project_path) (TS `normalizeProjectPath`).
 * `None` becomes `undefined`.
 */
export function normalizeProjectPath(path: string): string | undefined;

/**
 * [`normalize_search_history`](search_history::normalize_search_history). Any
 * non-array input yields an empty list.
 *
 * # Errors
 *
 * Fails only if `raw` cannot be read as JSON-like data.
 */
export function normalizeSearchHistory(raw: any, max: number): string[];

/**
 * [`normalize_search_settings`](search_settings::normalize_search_settings); `undefined` when nothing valid remains.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 */
export function normalizeSearchSettings(raw: any): any;

/**
 * [`normalize_select_options`](paper_field::normalize_select_options) (TS `normalizeSelectOptions`).
 */
export function normalizeSelectOptions(raw: string[]): string[];

/**
 * [`normalize_share_input`](sharing::normalize_share_input); a validation message throws as text.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 */
export function normalizeShareInput(input: any): any;

/**
 * [`normalize_tags`](paper::normalize_tags) (TS `normalizeTags`).
 */
export function normalizeTags(tags: string[]): string[];

/**
 * [`normalize_theme_config`](theme_config::normalize_theme_config): a stored config
 * re-checked, `null` when it no longer passes.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 */
export function normalizeThemeConfig(raw: any): any;

/**
 * [`normalize_title_key`](page::normalize_title_key) (TS `normalizeTitleKey`).
 */
export function normalizeTitleKey(title: string): string;

/**
 * [`normalize_user_settings`](user_settings::normalize_user_settings).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function normalizeUserSettings(settings: any): any;

/**
 * [`normalize_vector`](embedding::normalize_vector). Returns a new `Float32Array`.
 */
export function normalizeVector(vector: Float32Array): Float32Array;

/**
 * [`normalize_zotero_library`](zotero_library::normalize_zotero_library): the library path, or
 * nothing when the input is not a library.
 *
 * # Errors
 *
 * Fails if `library` is neither a string nor missing.
 */
export function normalizeZoteroLibrary(library: any): any;

/**
 * [`note_backlinks`](page::note_backlinks) (TS `noteBacklinks`), as `{ id, title }` objects.
 *
 * # Errors
 *
 * Fails if `notes` has the wrong shape.
 */
export function noteBacklinks(notes: any, selected_id?: string | null): any;

/**
 * [`note_tags`](page::note_tags) (TS `noteTags`): the distinct hashtags, sorted by UTF-16 order.
 *
 * # Errors
 *
 * Fails if `notes` has the wrong shape.
 */
export function noteTags(notes: any): string[];

/**
 * [`notes_tagged`](graph_tags::notes_tagged): indices of the notes matching `tags`.
 *
 * # Errors
 *
 * Fails if `notes` or `tags` has the wrong shape.
 */
export function notesTagged(notes: any, tags: any): any;

/**
 * [`notice_for`]: the text under `entry_index`, or `null` when the notice is about another entry.
 *
 * # Errors
 *
 * Fails if `notice` is neither `null` nor a `{ index, text }` object.
 */
export function noticeFor(notice: any, entry_index: number): any;

/**
 * [`one_euro_alpha`](one_euro::one_euro_alpha): the smoothing factor for a cutoff in
 * hertz and a timestep in milliseconds.
 */
export function oneEuroAlpha(cutoff: number, dt_ms: number): number;

/**
 * [`open_access_ids_of`]: `paper` carries `doi`, `arxivId`, `url` and `metadata`.
 *
 * # Errors
 *
 * Fails if `paper` does not have the expected shape.
 */
export function openAccessIdsOf(paper: any): any;

/**
 * [`openalex_to_hit`](related_paper_hit::openalex_to_hit): the hit for an OpenAlex work, or
 * nothing when it has no title.
 *
 * # Errors
 *
 * Fails if `work` cannot be read as an OpenAlex work object.
 */
export function openAlexToHit(work: any): any;

/**
 * [`openalex_to_metadata`] (TS `openAlexToMetadata`). An OpenAlex work as a paper.
 *
 * # Errors
 *
 * Fails if `work` is not an OpenAlex work.
 */
export function openAlexToMetadata(work: any): any;

/**
 * [`rules::open_mode_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function openModeFor(kind: string, body: string): any;

/**
 * [`open_tab`](pane::open_tab).
 *
 * # Errors
 *
 * Fails if `layout` or `tab` has the wrong shape.
 */
export function openTab(layout: any, tab: any, pane_id: string): any;

/**
 * [`open_tab_keys`](pane::open_tab_keys).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function openTabKeys(layout: any): any;

/**
 * [`rules::opening_tab`]. `body` absent reads as an empty body.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function openingTab(kind: string, id: string, body?: string | null): any;

/**
 * [`original_range`](analysis_text::original_range) as `[start, end]` (TS `originalRange`).
 *
 * # Errors
 *
 * Fails if `view` is not a search text with `text`, `starts` and `ends`.
 */
export function originalRange(view: any, start: number, end: number): any;

/**
 * [`outline_from_text`](analysis_outline::outline_from_text) (TS `outlineFromText`).
 *
 * # Errors
 *
 * Fails if `allPages` is not an array of arrays of text items.
 */
export function outlineFromText(all_pages: any): any;

/**
 * [`outline_is_plausible`](analysis_outline::outline_is_plausible) (TS `outlineIsPlausible`).
 *
 * # Errors
 *
 * Fails if `headings` is not an array of `{ page }` objects.
 */
export function outlineIsPlausible(headings: any, page_count: number): boolean;

/**
 * [`outline_item_of`](document_analysis::outline_item_of) (TS `outlineItemOf`).
 *
 * # Errors
 *
 * Fails if `item` is not a pdf.js text item with a `transform` array.
 */
export function outlineItemOf(item: any, page: number): any;

/**
 * [`outline_items_for`]: each page's runs as outline items.
 *
 * # Errors
 *
 * Fails if `pages` does not have the expected shape.
 */
export function outlineItemsFor(pages: any): any;

/**
 * [`outline_of`](outline::outline_of) as an array of `{ level, text, slug }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function outlineOf(body: string, max_level: number): any;

/**
 * [`outline_progress`](section_progress::outline_progress) (TS `outlineProgress`).
 *
 * # Errors
 *
 * Fails if `roots` is not a list of section tree nodes.
 */
export function outlineProgress(roots: any): any;

/**
 * [`outline_text_lines`](analysis_outline::outline_text_lines) (TS `outlineTextLines`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of arrays of text items.
 */
export function outlineTextLines(pages: any): any;

/**
 * [`external_url`](overleaf::external_url).
 */
export function overleafExternalUrl(id: string): string;

/**
 * [`overleaf_git_url`](overleaf::overleaf_git_url).
 */
export function overleafGitUrl(id: string): string;

/**
 * [`wf_core::sync::blob_links::owned_asset_folder_paths`] for JS. `bodies` is an array
 * of strings; the result is the sorted array of folder paths they point at.
 *
 * # Errors
 *
 * Fails when `bodies` is not an array of strings, or a body is over `MAX_INDEX_TEXT_UTF16`
 * UTF-16 units.
 */
export function ownedAssetFolderPaths(bodies: any): any;

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
 * [`pack_vectors`](codec::pack_vectors).
 *
 * # Errors
 *
 * Fails if the head argument is not an object with `model`, `dimensions` and `revision`.
 */
export function packVectors(head: any, bytes: Uint8Array): Uint8Array;

/**
 * [`page_from_chunk_body`](chunk_read::page_from_chunk_body): a checked body as the page model.
 *
 * # Errors
 *
 * Fails on a body whose tables do not add up.
 */
export function pageFromChunkBody(body: Uint8Array): any;

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
 * [`page_list_problem`](pdf_pages::page_list_problem): the message, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function pageListProblem(answer: string, count: number): any;

/**
 * [`page_text_after_recognition`]: the page text once handwriting has been recognised.
 */
export function pageTextAfterRecognition(was: string, prior: string, recognised: string): string;

/**
 * [`page_text_from_items`] over `{ str, hasEOL? }[]`.
 *
 * # Errors
 *
 * Fails if `items` is not an array of run objects.
 */
export function pageTextFromItems(items: any): string;

/**
 * [`pages_to_evict`]: `rendered` and `visible` are number arrays; returns a sorted number array.
 *
 * # Errors
 *
 * Fails if `rendered` or `visible` is not an array of numbers.
 */
export function pagesToEvict(rendered: any, visible: any, radius: number): any;

/**
 * [`painted_order`](quick::painted_order): the results group by group.
 *
 * # Errors
 *
 * Fails if `results` is not an array of quick-open results.
 */
export function paintedOrder(results: any): any;

/**
 * [`palette_mode_for`](palette_groups::palette_mode_for): the mode a key press opens, or `null`.
 *
 * # Errors
 *
 * Fails if `event` has the wrong shape.
 */
export function paletteModeFor(event: any): any;

/**
 * [`paper_cite_keys`](bibtex::paper_cite_keys) (TS `buildCiteByTitle`'s key list): one key per
 * paper, in order, unique across the list.
 *
 * # Errors
 *
 * Fails if `papers` is not an array of paper objects.
 */
export function paperCiteKeys(papers_value: any): any;

/**
 * [`paper_counts_for_tags`](tag_counts::paper_counts_for_tags): one count per `tagIds` entry, in order.
 *
 * # Errors
 *
 * Fails if `tagIds` or `links` has the wrong shape.
 */
export function paperCountsForTags(tag_ids: any, links: any): any;

/**
 * [`to_def_domain`]: a `paper_fields` row as a domain field definition.
 */
export function paperFieldDefRowToDomain(row: any): any;

/**
 * [`to_value_domain`]: a `paper_field_values` row as a domain value. Throws on a bad payload.
 */
export function paperFieldValueRowToDomain(row: any): any;

/**
 * [`PAPER_HTML_CSP`]: the frame's own content security policy.
 */
export function paperHtmlCsp(): string;

/**
 * [`paper_html_path`](folder_layout::paper_html_path).
 */
export function paperHtmlPath(paper_id: string, project_root: string): string;

/**
 * [`paper_image_thumbnail_path`](paper_image::paper_image_thumbnail_path) (TS `paperImageThumbnailPath`).
 */
export function paperImageThumbnailPath(path: string): string;

/**
 * [`paper_pdf_path`](folder_layout::paper_pdf_path).
 */
export function paperPdfPath(paper_id: string, project_root: string): string;

/**
 * [`paper_relation_from_row`](paper_relation::paper_relation_from_row): the domain relation
 * for a stored row (a null note reads as absent).
 *
 * # Errors
 *
 * Fails if `row` has the wrong shape.
 */
export function paperRelationFromRow(row: any): any;

/**
 * [`validate_new_paper_relation`](paper_relation::validate_new_paper_relation): the
 * validation message, or `undefined` when the input is valid.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function paperRelationInputError(input: any): string | undefined;

/**
 * [`paper_relation_to_row`](paper_relation::paper_relation_to_row): the stored row for a
 * relation (an absent note is stored as null).
 *
 * # Errors
 *
 * Fails if `relation` has the wrong shape.
 */
export function paperRelationToRow(relation: any): any;

/**
 * [`paper_to_domain`]: a `papers` row as a domain paper.
 */
export function paperRowToDomain(row: any): any;

/**
 * [`paper_to_summary`]: a `papers` row read with the card projection, as a summary.
 */
export function paperRowToSummary(row: any): any;

/**
 * [`to_paper_tag`]: a `paper_tags` row as the app's paper-tag link.
 */
export function paperTagFromRow(row: any): any;

/**
 * [`paper_to_bibtex`](bibtex::paper_to_bibtex): one `.bib` entry under `key`.
 *
 * # Errors
 *
 * Fails if `paper` is not a paper object.
 */
export function paperToBibtex(paper: any, key: string): string;

/**
 * [`paper_to_row`]: a domain paper as the `papers` row it is written as.
 */
export function paperToRow(paper: any): any;

/**
 * [`parse_version`]: `0.5.2` to `[0, 5, 2]`, or `null`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function parseAppVersion(version: string): any;

/**
 * [`parse_artifact_refs`](artifact_refs::parse_artifact_refs) (TS `parseArtifactRefs`). Offsets
 * are UTF-16 code units.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 */
export function parseArtifactRefs(markdown: string): any;

/**
 * [`parse_bib_entries`](bib_entries::parse_bib_entries) (TS `parseBibEntries`).
 *
 * # Errors
 *
 * Fails if `files` is not an array of `{ path, content }`.
 */
export function parseBibEntries(files: any): any;

/**
 * [`parseBibliography`](bibliography::parse_bibliography): every entry, or none when fewer than three.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function parseBibliography(lines: any, with_offsets: boolean): any;

/**
 * [`parseBibliographyEntry`](bibliography::parse_bibliography_entry): fields of one entry.
 *
 * # Errors
 *
 * Returns an error when `lines` is empty or does not deserialize as text lines, or the result fails to convert.
 */
export function parseBibliographyEntry(lines: any, index: number, with_offsets: boolean): any;

/**
 * [`wf_core::papers::open_access::parse_biorxiv`]: a bioRxiv or medRxiv answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseBiorxiv(body: any, server: string): any;

/**
 * [`parse_dashboard_layout`](layout::parse_dashboard_layout); `null` when `lg` or `sm`
 * is not an array.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 */
export function parseDashboardLayout(raw: any): any;

/**
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseDoaj(body: any): any;

/**
 * [`wf_core::papers::open_access::parse_europe_pmc`]: Europe PMC's answer as `{ candidates, pmcid }`.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseEuropePmc(body: any): any;

/**
 * [`parse_explorer_keys`](state::parse_explorer_keys). Takes the raw stored
 * string (or `null` when absent) and returns the keys, or `null` when the
 * record is unusable.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function parseExplorerKeys(raw?: string | null): any;

/**
 * [`parse_extraction_json`](model_concepts::parse_extraction_json): the reply's `concepts` list, or `[]`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function parseExtractionJson(text: string): any;

/**
 * [`parse_figure_clip`]: the figure a clipboard text names, or `null`.
 */
export function parseFigureClip(text?: string | null): any;

/**
 * [`parse_figure_crop`](figure::parse_figure_crop): a `c=` value as four insets, or `undefined`.
 *
 * # Errors
 *
 * Fails if `raw` is longer than the index text limit.
 */
export function parseFigureCrop(raw: string): any;

/**
 * [`parse_figure_tokens`](figure::parse_figure_tokens): an alt's box and crop, or `undefined`.
 *
 * # Errors
 *
 * Fails if `alt` is longer than the index text limit.
 */
export function parseFigureTokens(alt: string): any;

/**
 * [`parse_folder_draft`](folder_draft::parse_folder_draft): the draft, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function parseFolderDraft(raw: string): any;

/**
 * [`parse_graph_persisted_state`](graph_settings::parse_graph_persisted_state); `null` when absent.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 */
export function parseGraphPersistedState(raw: any): any;

/**
 * [`wf_core::papers::open_access::parse_hal`]: HAL's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseHal(body: any): any;

/**
 * [`parse_ink_chunk_path`](ink_paths::parse_ink_chunk_path): `{ noteId, chunkId }`, or `null`.
 */
export function parseInkChunkPath(path: string): any;

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
 * [`parse_kind_suffix`](folder_layout::parse_kind_suffix): the entity type, or `null`.
 */
export function parseKindSuffix(path: string): any;

/**
 * [`parse_latex_section_tree`](wf_core::latex_section_tree::parse_latex_section_tree)
 * (TS `parseLatexSectionTree`). `entry_file` defaults to `main.tex`.
 *
 * # Errors
 *
 * Fails if `files` is not an array of `{ path, content }`.
 */
export function parseLatexSectionTree(files: any, entry_file?: string | null): any;

/**
 * [`parse_link_removal_text`] for JS: the textarea's rules, one per line.
 *
 * # Errors
 *
 * Fails when `text` is over the text cap.
 */
export function parseLinkRemovalText(text: string): any;

/**
 * [`parse_md_image_alt`](markdown_figure_alt::parse_md_image_alt): an alt split into text, crop,
 * side and width.
 *
 * # Errors
 *
 * Fails if `raw` is longer than the index text limit.
 */
export function parseMdImageAlt(raw: string): any;

/**
 * [`wf_core::papers::open_access::parse_openalex`]: OpenAlex's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseOpenalex(body: any): any;

/**
 * [`parse_links`]: the well-formed links in the stored JSON.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function parseOverleafLinks(stored: string): any;

/**
 * [`parse_overleaf_project_id`](overleaf::parse_overleaf_project_id).
 */
export function parseOverleafProjectId(raw: string): string | undefined;

/**
 * [`parse_page_list`](pdf_pages::parse_page_list) as `{ pages, outOfRange? }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function parsePageList(answer: string, count: number): any;

/**
 * [`parse_paper_field_value`] (TS `parsePaperFieldValue`). A refusal throws an `Error`
 * with the caller's `name` in the message.
 */
export function parsePaperFieldValue(value: any, name: string): any;

/**
 * [`parse_paper_html_document`]: the paper a kept file holds, or `null` for a file this app did not write.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function parsePaperHtmlDocument(paper_id: string, text: string): any;

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
 * [`parse_bounds`]: the saved position from the preference JSON, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function parsePlanWidgetBounds(stored: string): any;

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
 * [`parse_reader_split_pane`](split::parse_reader_split_pane); `null` for any value
 * other than `report` or `vault`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function parseReaderSplitPane(raw?: string | null): any;

/**
 * [`parse_regions`](tpl::parse_regions) as `{ ok, segments }` or `{ ok: false, reason }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function parseRegions(document: string): any;

/**
 * [`parse_tag`]: `v0.5.2` to `[0, 5, 2]`, or `null` for any other tag.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function parseReleaseTag(tag: string): any;

/**
 * [`parse_rollup_options`](paper_field::parse_rollup_options) (TS `parseRollupOptions`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function parseRollupOptions(options: string[]): any;

/**
 * [`wf_core::papers::open_access::parse_semantic_scholar`]: Semantic Scholar's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseSemanticScholar(body: any): any;

/**
 * [`parse_stroke_clip`]: the strokes a clipboard text carries, or `null`.
 */
export function parseStrokeClip(text?: string | null): any;

/**
 * [`parse_taskbar_created`]: the `TaskbarCreated` message id the helper printed, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function parseTaskbarCreatedId(stdout: string): any;

/**
 * [`parse_theme_config`](theme_config::parse_theme_config); a non-string reads as empty.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function parseThemeConfig(text: any): any;

/**
 * [`wf_core::papers::open_access::parse_unpaywall`]: Unpaywall's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseUnpaywall(body: any): any;

/**
 * [`parse_wikilink_inner`](page::parse_wikilink_inner) (TS `parseWikilinkInner`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function parseWikilinkInner(inner: string, raw: string): any;

/**
 * [`wf_core::sync::deserialize::parse_workspace_folder`] for JS, over `[path, content][]`.
 *
 * # Errors
 *
 * Fails when a path or content is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function parseWorkspaceFolder(files: any): any;

/**
 * [`wf_core::papers::open_access::parse_zenodo`]: a Zenodo record's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 */
export function parseZenodo(body: any): any;

/**
 * [`partition_pdf_texts`](pdf_text_prune::partition_pdf_texts): which stored PDF texts survive and which to delete.
 *
 * # Errors
 *
 * Fails if `stored` is not an array of PDF sources or `paper_ids` is not an array of strings.
 */
export function partitionPdfTexts(stored: any, paper_ids: any): any;

/**
 * [`paste_lands_in_verbatim_context`] for JS. `offset` is in UTF-16 code units.
 *
 * # Errors
 *
 * Fails when `document` is over the text cap.
 */
export function pasteLandsInVerbatimContext(document: string, offset: number): boolean;

/**
 * [`pasted_figure_place`]: `figure` is a `FigurePlacement`, `on_page` the page's figures, `page` an `InkPageSize`.
 */
export function pastedFigurePlace(figure: any, on_page: any, page: any): any;

/**
 * [`pasted_strokes_place`]: `strokes` are the pasted ones, `on_page` the page's, `page` an `InkPageSize`.
 */
export function pastedStrokesPlace(strokes: any, on_page: any, page: any): any;

/**
 * [`pdf_doc_id`](search_document::pdf_doc_id).
 */
export function pdfDocId(paper_id: string, page_index: number): string;

/**
 * [`pdf_doc_ids_for`](search_document::pdf_doc_ids_for).
 */
export function pdfDocIdsFor(paper_id: string, page_count: number): string[];

/**
 * [`pdf_page_href`](search_document::pdf_page_href).
 */
export function pdfPageHref(paper_id: string, page_index: number): string;

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
 * [`peers_from_states`](collab::peers_from_states); `users` is `[clientId, user][]`.
 *
 * # Errors
 *
 * Fails when `users` is not a list of pairs.
 */
export function peersFromUsers(users: any, self_client_id: number, self_author_id: string): any;

/**
 * [`pending_field_fills`]: the pending `paper_field_value` proposals, optionally for one field.
 */
export function pendingFieldFills(proposals: any, field_id?: string | null): any;

/**
 * [`personalized_page_rank`](personalized_pagerank::personalized_page_rank); `[{ node, score }]`
 * in first-visit order.
 *
 * # Errors
 *
 * Fails if `graph` or `options` has the wrong shape.
 */
export function personalizedPageRank(graph: any, seed: string, options: any, rng: () => number): any;

/**
 * [`pglite_sql::pg_array`] (TS `pgArray`): the values as a Postgres array literal.
 *
 * # Errors
 *
 * Returns an error if `values` is not an array of strings.
 */
export function pgArray(values: any): string;

/**
 * [`pick_keeper`] (TS `pickKeeper`), returning the kept paper's id.
 *
 * # Errors
 *
 * Fails if `group` is not a list of paper summaries, or it is empty.
 */
export function pickKeeper(group: any): string;

/**
 * [`pick_keys_to_evict`]: the keys to drop, oldest first. Throws an `Error` when
 * `maxEntries` is not a positive integer.
 *
 * # Errors
 *
 * Fails if `maxEntries` is not a positive integer, or `entries` has the wrong shape.
 */
export function pickKeysToEvict(entries: any, max_entries: number): any;

/**
 * [`pick_nearest_match`] as `{ start, end }`, or `null` when there is no match.
 *
 * # Errors
 *
 * Fails if `matches` or `position` has the wrong shape.
 */
export function pickNearestMatch(matches: any, position: any): any;

/**
 * [`pick_project`](project_pick::pick_project): the index of the picked project. A miss or an
 * ambiguous match throws the message as a string; the TS wrapper turns it into an `Error`.
 */
export function pickProject(projects: any, needle?: string | null): number;

/**
 * [`pick_project_folder`](folder_layout::pick_project_folder). `undefined` when no folder fits.
 */
export function pickProjectFolder(dirs: string[], exact: string, tail: string): string | undefined;

/**
 * [`picture_path`]: the stored file behind a placed picture, or `null`.
 *
 * # Errors
 *
 * Fails if `target` is not a mark's `{ type, origin, comment }` object.
 */
export function picturePath(target: any): any;

/**
 * [`pinned_screen_index`]: the pure half of merging pinned shared rows into a screen.
 *
 * # Errors
 *
 * Fails if `input` does not match the pinned-screen input shape, or the result cannot be
 * converted to JS.
 */
export function pinnedScreenIndex(input: any): any;

/**
 * [`place_on_sheet`](page_background::place_on_sheet) as `{ x, y, width, height }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function placeOnSheet(source_width: number, source_height: number, sheet_width: number, sheet_height: number): any;

/**
 * [`place_widget`]: the saved spot if it is on a screen, else the top-right of the first one.
 *
 * # Errors
 *
 * Fails if `saved` is not a position or `areas` is not a list of work areas, or the result
 * cannot be converted to JS.
 */
export function placePlanWidget(saved: any, areas: any): any;

/**
 * [`plan_entries`](archive::plan_entries). `entries` is `{ name, size }[]` in archive order;
 * the result is `{ name, action }[]` in the same order, where `action` is `keep`,
 * `empty`, `unsafe-name` or `too-big`.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or past the entry count or the total cap.
 */
export function planArchiveEntries(entries: any, limits: any): any;

/**
 * [`wf_core::sync::blob_links::plan_asset_reanchor`] for JS. `owned` and `available` are
 * arrays of folder paths; the result is `{ keep, upload, unresolved }`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `owned` or `available`
 * is not an array of strings.
 */
export function planAssetReanchor(body: string, owned: any, available: any): any;

/**
 * [`plan_bib_import`](bib_import::plan_bib_import) (TS `planBibImport`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function planBibImport(file_name: string, text: string, existing_dois: string[], existing_keys: string[]): any;

/**
 * [`plan_bibliography_annotations`]. `papers` is an array of paper snapshots,
 * `pull` the pulled annotations keyed by Zotero item key.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 */
export function planBibliographyAnnotations(papers: any, pull: any): any;

/**
 * [`chip_target`](chip::chip_target): where a dependency chip goes when tapped.
 *
 * # Errors
 *
 * Fails if `dep` or `milestones` has the wrong shape, or the result cannot be serialised.
 */
export function planChipTarget(dep: any, known: any, milestones: any, is_offline_build: boolean): any;

/**
 * [`plan_citation_segments`]: each run split at the mention boundaries inside it.
 *
 * # Errors
 *
 * Fails if `items` or `mentions` do not have the expected shape.
 */
export function planCitationSegments(items: any, mentions: any): any;

/**
 * [`wf_core::sync::snapshot_delta::plan_delta`] for JS. `remote` is `{ id, updatedAt }[]`
 * and `held` is `[id, stamp][]`, as the TS shell passes them.
 *
 * # Errors
 *
 * Fails when either argument does not have the expected shape.
 */
export function planDelta(remote: any, held: any): any;

/**
 * [`plan_embedding_start`](embedding_models::plan_embedding_start) as `"reuse" | "swap" | "rebuild"`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialized.
 */
export function planEmbeddingStart(stored_model: string | null | undefined, target: string): any;

/**
 * [`plan_eyebrow`](screen::plan_eyebrow): the line above the plan title, or `undefined` for none.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function planEyebrow(total: number, done: number): any;

/**
 * [`plan_feed_origin`](feed_urls::plan_feed_origin): where the calendar feed is served.
 */
export function planFeedOrigin(server_routes: boolean, here?: string | null, configured?: string | null): string;

/**
 * [`plan_feed_urls`](feed_urls::plan_feed_urls): the calendar, https and widget links for `token`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS object.
 */
export function planFeedUrls(origin: string, token: string, include_done: boolean, reminder_days: number): any;

/**
 * [`plan_fix_order`](wiki_lint::plan_fix_order).
 *
 * # Errors
 *
 * Fails if `report` is not a `LintReport` object.
 */
export function planFixOrder(report: any): any;

/**
 * [`plan_item_order`]: the writes for a new item order, or the message that refuses it.
 */
export function planItemOrder(list_id: string, items: any, ordered_ids: string[]): any;

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
 * [`plan_pace`](timeline::plan_pace): `"on track"` or the overdue and due-soon counts.
 */
export function planPace(milestones: any, today: string): string;

/**
 * [`plan_series_ingest`](experiments::plan_series_ingest): `{ keep: indices, supersededTipStep }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function planSeriesIngestIndices(steps: Float64Array, previous_max_step?: number | null): any;

/**
 * [`plan_timeline`](timeline::plan_timeline): the laid-out plan, or `null` when no milestone is
 * dated.
 *
 * # Errors
 *
 * Fails if `milestones` has the wrong shape.
 */
export function planTimeline(milestones: any, today: string): any;

/**
 * [`plan_widget`](feed::plan_widget): the summary a widget draws.
 *
 * # Errors
 *
 * Fails if `items` has the wrong shape.
 */
export function planWidgetData(items: any, include_done: boolean, limit: number | null | undefined, now_ms: number): any;

/**
 * [`plan_wiki_pages`](wiki_plan::plan_wiki_pages) for a `PlanWikiPagesInput` object; returns the plans.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape, or the plans cannot be converted.
 */
export function planWikiPages(input: any): any;

/**
 * [`plot_height`](plot_size::plot_height).
 */
export function plotHeight(width: number, base: number): number;

/**
 * [`plot_tier`](plot_size::plot_tier): `"full"`, `"medium"` or `"compact"`.
 */
export function plotTier(width: number): string;

/**
 * [`plural`](panel_labels::plural): "n word" with the right plural.
 */
export function plural(n: number, word: string, many?: string | null): string;

/**
 * [`wf_core::papers::open_access::pmc_candidates`]: PubMed Central's PDF and HTML copies.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function pmcCandidates(pmcid: string, license?: string | null): any;

/**
 * [`point_in_area`](clip::point_in_area).
 */
export function pointInArea(area: any, x: number, y: number): boolean;

/**
 * [`point_in_polygon`]: is `(x, y)` inside the flat `x, y` polygon.
 */
export function pointInPolygon(polygon: Float64Array, x: number, y: number): boolean;

/**
 * [`error_info`] for JS (TS `postgrestErrorInfo`): `{ code, firstLine }` of an error body.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function postgrestErrorInfo(body: string): any;

/**
 * [`keyed_column_spec`]: the keyed-column spec named `name`, or `null` when there is none.
 */
export function postgrestKeyedColumnSpec(name: string): any;

/**
 * [`row_spec`]: the row spec named `name`, or `null` when there is none.
 */
export function postgrestRowSpec(name: string): any;

/**
 * [`writable`] for JS (TS `postgrestWritable`): the payload minus the table's generated columns.
 *
 * # Errors
 *
 * Fails when `payload` is not an object.
 */
export function postgrestWritable(table: string, payload: any): any;

/**
 * [`wf_core::papers::open_access::parse_doaj`]: DOAJ's answer as candidates.
 *
 * # Errors
 *
 * [`wf_core::papers::open_access::preprint_server_for`]: the preprint server for a DOI, or `None`.
 */
export function preprintServerFor(doi: string): string | undefined;

/**
 * [`wf_core::ink::pressure_byte`].
 */
export function pressureByte(pressure?: number | null): number;

/**
 * [`preview_open`](pane::preview_open).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function previewOpen(layout: any): boolean;

/**
 * [`preview_reader_href`](paper_preview::preview_reader_href) (TS `previewReaderHref`).
 *
 * # Errors
 *
 * Fails if `preview` is not a preview object, or the result cannot be converted.
 */
export function previewReaderHref(remote_href: string | null | undefined, preview: any, local_href: string): any;

/**
 * [`preview_source`](pane::preview_source). `previous` may be `undefined`.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function previewSource(layout: any, previous: any): any;

/**
 * [`preview_tab`](pane::preview_tab).
 *
 * # Errors
 *
 * Never fails in practice; returns the serializer's result type.
 */
export function previewTab(): any;

/**
 * [`primary_paper_ref`]: the arXiv id, else the DOI, else `null`. Blank strings count as unset.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function primaryPaperRef(arxiv_id?: string | null, doi?: string | null): any;

/**
 * [`prisma_caveat`](prisma_figure::prisma_caveat) (TS `prismaCaveat`). `None` becomes `undefined`.
 *
 * # Errors
 *
 * Fails if `counts` has the wrong shape.
 */
export function prismaCaveat(counts: any): string | undefined;

/**
 * [`prisma_counts`](screening::prisma_counts) (TS `prismaCounts`).
 *
 * # Errors
 *
 * Fails if `items` or `decisions` has the wrong shape.
 */
export function prismaCounts(items: any, decisions: any): any;

/**
 * [`prisma_figure_tex`](prisma_figure::prisma_figure_tex) (TS `prismaFigureTex`).
 *
 * # Errors
 *
 * Fails if `counts` or `options` has the wrong shape.
 */
export function prismaFigureTex(counts: any, options: any): string;

/**
 * [`wf_core::sync::folder_layout::project_dir`] for JS.
 *
 * # Errors
 *
 * Fails when `id` or `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function projectDir(id: string, name: string): string;

/**
 * [`to_project`]: a `projects` row as the app's project.
 */
export function projectFromRow(row: any): any;

/**
 * [`project_gate_open`].
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 */
export function projectGateOpen(config: any, gate: any): any;

/**
 * [`wf_core::sync::folder_layout::project_meta_dir`] for JS.
 *
 * # Errors
 *
 * Fails when `project_root` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function projectMetaDir(project_root: string): string;

/**
 * [`project_name`](project_name): the trimmed name, or `undefined` when blank.
 */
export function projectName(name: string): string | undefined;

/**
 * [`project_search_documents`](projection::project_search_documents). `graph` is a wiki graph or
 * `null`; `pdfTexts` is the extracted PDF text array.
 *
 * # Errors
 *
 * Fails if an argument or a reader annotation does not match the expected shape.
 */
export function projectSearchDocuments(snapshot: any, graph: any, pdf_texts: any): any;

/**
 * [`project_stored_pdf_texts`](projection::project_stored_pdf_texts): the worker's build.
 *
 * # Errors
 *
 * Fails if an argument or a reader annotation does not match the expected shape.
 */
export function projectStoredPdfTexts(snapshot: any, stored: any): any;

/**
 * [`project_zotero_annotations`](zotero_projection::project_zotero_annotations).
 *
 * # Errors
 *
 * Fails when `annotations` is not a list of cached Zotero annotations.
 */
export function projectZoteroAnnotations(annotations: any, content_hash?: string | null, now?: string | null): any;

/**
 * [`projected_page_size`] as `{ width, height }` (TS `projectedPageSize`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function projectedPageSize(p: any): any;

/**
 * [`pglite_sql::projection`] (TS `projection`): a `select` column list.
 *
 * # Errors
 *
 * Returns an error for a column name [`pglite_sql::ident`] refuses.
 */
export function projection(columns: string): string;

/**
 * [`proposal_applies`](proposal_apply::proposal_applies). `null` or `undefined` for the stored
 * revision means the row is missing.
 */
export function proposalApplies(stored_updated_at?: string | null, expected_revision?: string | null): boolean;

/**
 * [`prune_layout`](pane::prune_layout). `open_keys` is an array of tab keys.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function pruneLayout(layout: any, open_keys: any): any;

/**
 * [`push_figure_step`]: `before` and `after` are the page's figure arrays;
 * `key` is the press number, or `null` when the edit is not from a press.
 */
export function pushFigureStep(history: any, before: any, after: any, key: any): any;

/**
 * [`push_ink_undo`](ink_undo::push_ink_undo).
 *
 * # Errors
 *
 * Fails if `state` or `entry` has the wrong shape.
 */
export function pushInkUndo(state: any, entry: any): any;

/**
 * [`quantize_ink_path`]; `decimals` defaults to 2.
 */
export function quantizeInkPath(path: Float64Array, decimals?: number | null): Float64Array;

/**
 * [`query_term_count`](hybrid_fusion::query_term_count).
 *
 * # Errors
 *
 * Fails if `terms` is not an array of strings.
 */
export function queryTermCount(terms: any): number;

/**
 * [`quick_open_results`](quick::quick_open_results) as an array of `{ node, score, matched }`.
 *
 * # Errors
 *
 * Fails if `documents` is not an array of tree rows.
 */
export function quickOpenResults(documents: any, query: string): any;

/**
 * [`quote_awkward_labels`](markdown_mermaid_labels::quote_awkward_labels): quote labels Mermaid cannot parse.
 */
export function quoteAwkwardMermaidLabels(code: string): string;

/**
 * [`quote_ident`] (TS `quoteIdent`): the name in double quotes, embedded quotes doubled.
 */
export function quoteIdent(name: string): string;

/**
 * [`r2_blob_client_config`]. `null` when any R2 field is unset or empty.
 *
 * # Errors
 *
 * Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
 */
export function r2BlobClientConfig(fields: any): any;

/**
 * [`rail_group_text`](rail_group_text::rail_group_text). `group` is a `RailGroupWords`,
 * `visible` and `integrationTitles` are string arrays.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 */
export function railGroupText(group: any, visible: any, integration_titles: any): any;

/**
 * [`ramp_colour`](node_colouring::ramp_colour): a colour `t` of the way along the ramp.
 */
export function rampColour(t: number): string;

/**
 * [`rank_filter_order`](rank_filter::rank_filter_order) as an array of indices
 * into `items`.
 *
 * # Errors
 *
 * Fails if `hit_entity_ids` is not an array of strings or `items` is not an
 * array of `{id, fallbackText}` records.
 */
export function rankFilterOrder(query: string, hit_entity_ids: any, items: any): any;

/**
 * [`wf_core::papers::open_access::rank_open_access_candidates`]: deduplicated, PDFs first.
 *
 * # Errors
 *
 * Fails if `candidates` is not a candidate list, or the result cannot be converted.
 */
export function rankOpenAccessCandidates(candidates: any): any;

/**
 * [`read_failure_reason`]: why a read failed. `status` is the HTTP status when there was a response.
 */
export function readFailureReason(message: string, status?: number | null): string;

/**
 * [`wf_core::sync::frontmatter::read_frontmatter`] for JS, as `ParsedDocument`.
 *
 * # Errors
 *
 * Fails when `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function readFrontmatter(content: string): any;

/**
 * [`read_ink_chunk_header`](chunk::read_ink_chunk_header): the 16-byte header.
 *
 * # Errors
 *
 * Fails on a header the format refuses.
 */
export function readInkChunkHeader(bytes: Uint8Array): any;

/**
 * [`wf_core::sync::ink_note::read_ink_note_body`] for JS, as `{ meta, text }`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function readInkNoteBody(body: string): any;

/**
 * [`read_ink_note_meta`](wf_core::sync::ink_note::read_ink_note_meta) of a frontmatter
 * object (TS `readInkNoteMeta`).
 *
 * # Errors
 *
 * Fails if `frontmatter` is not a plain object.
 */
export function readInkNoteMeta(frontmatter: any): any;

/**
 * [`read_ink_request`]: the page's request checked whole, or `null` when it is malformed.
 * Never throws, as the TS did not: input that is not convertible to JSON is `null` too.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function readInkRequest(request: any): any;

/**
 * [`read_storage_config`]. `env` is a plain object of env name to string value.
 *
 * # Errors
 *
 * Fails if `env` is not an object of strings, or the result cannot be converted to JS.
 */
export function readStorageConfig(env: any): any;

/**
 * [`wf_core::sync::ink_note::readable_text`] for JS: a note's words, ink pages joined.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function readableText(body: string): string;

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
 * [`reader_print_document`]: the paper as an HTML document for a print frame's `srcdoc`.
 */
export function readerPrintDocument(doc: any): string;

/**
 * [`reader_print_orientation`]: `"portrait"` or `"landscape"` for the sheet.
 */
export function readerPrintOrientation(input: any): string;

/**
 * [`to_item_domain`]: a `reading_list_items` row as a domain item.
 */
export function readingListItemToDomain(row: any): any;

/**
 * [`to_item_row`]: a domain item as a `reading_list_items` row.
 */
export function readingListItemToRow(item: any): any;

/**
 * [`to_list_domain`]: a `reading_lists` row as a domain list.
 */
export function readingListToDomain(row: any): any;

/**
 * [`to_list_row`]: a domain list as a `reading_lists` row.
 */
export function readingListToRow(list: any): any;

/**
 * [`recently_approved_wiki_pages`]: the wiki's pages, newest first, capped at `limit`.
 */
export function recentlyApprovedWikiPages(pages: any, limit: number): any;

/**
 * [`recolour_nodes`](graph_colour::recolour_nodes): one colour per node in order, or
 * `null` when the mode leaves node colours as built.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function recolourNodes(nodes: any, links: any, color_by: string, groups: any, ctx: any): any;

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
 * [`redact_error_text`](error_redact::redact_error_text): the token and URL credentials removed,
 * capped at 500 UTF-16 units. An empty or missing token is ignored.
 */
export function redactOverleafErrorText(raw: string, token?: string | null): string;

/**
 * [`wf_core::error_report::redact::redact`] for JS, as `{ text, redactions }`.
 *
 * # Errors
 *
 * Fails when `input` is over the text cap.
 */
export function redactReport(input: string): any;

/**
 * [`wf_core::error_report::redact::redact_and_cap`] for JS, as `{ text, redactions }`.
 * `limit` is in UTF-16 units.
 *
 * # Errors
 *
 * Fails when `input` is over the text cap.
 */
export function redactReportAndCap(input: string, limit: number): any;

/**
 * [`wf_core::sync::git_remote::redact_secret`] for JS.
 *
 * # Errors
 *
 * Fails when `text` or `secret` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function redactSecret(text: string, secret?: string | null): string;

/**
 * [`reference_for_destination`](link_citations::reference_for_destination) (TS
 * `referenceForDestination`); `null` when no entry is found.
 *
 * # Errors
 *
 * Fails if `dest` or `refs` do not have the expected shape.
 */
export function referenceForDestination(dest: any, refs: any): any;

/**
 * [`refresh_ink_undo_annotation`](ink_undo::refresh_ink_undo_annotation).
 *
 * # Errors
 *
 * Fails if `state` or `annotation` has the wrong shape.
 */
export function refreshInkUndoAnnotation(state: any, annotation: any): any;

/**
 * [`related_by_ppr`](personalized_pagerank::related_by_ppr); `[{ id, score }]`, best first.
 *
 * # Errors
 *
 * Fails if `graph` or `options` has the wrong shape.
 */
export function relatedByPpr(graph: any, seed: string, limit: number, options: any, rng: () => number): any;

/**
 * [`related_concepts`](graph_tags::related_concepts): the top `limit` tags seen beside `name`.
 *
 * # Errors
 *
 * Fails if `papers` or `notes` has the wrong shape.
 */
export function relatedConcepts(name: string, papers: any, notes: any, limit: number): any;

/**
 * [`wf_core::sync::blob_links::relative_asset_paths`] for JS, as `[{ scope, path }]`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function relativeAssetPaths(body: string): any;

/**
 * [`remember_search_query`](search_history::remember_search_query).
 */
export function rememberSearchQuery(history: string[], query: string, max: number): string[];

/**
 * [`remove_hashtag_from_body`](note_tags::remove_hashtag_from_body).
 */
export function removeHashtagFromBody(body: string, tag: string): string;

/**
 * [`rename_ink_undo_id`](ink_undo::rename_ink_undo_id).
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 */
export function renameInkUndoId(state: any, from: string, to: string): any;

/**
 * [`rename_sources`](folder_diff::rename_sources) over the parsed entities and the
 * folder and current texts by path. Returns new path to old path.
 *
 * # Errors
 *
 * Fails if the inputs do not match the shape, or the result cannot be serialized.
 */
export function renameSources(parsed: any, folder: any, current: any): any;

/**
 * [`renamed_paths`](outside_edits::renamed_paths) over `seen` and the diff's `paths`.
 *
 * # Errors
 *
 * Fails if the inputs do not match the shape, or the result cannot be serialized.
 */
export function renamedOutsidePaths(seen: any, paths: any): any;

/**
 * [`render_template`](tpl::render_template).
 *
 * # Errors
 *
 * Fails if the context is not a plain object.
 */
export function renderTemplate(template: string, context_value: any): string;

/**
 * [`reorder_figure_indices`](figure::reorder_figure_indices): the new order as old indices.
 *
 * # Errors
 *
 * Fails if `step` is not a known step.
 */
export function reorderFigureIndices(len: number, index: number, step: any): Uint32Array;

/**
 * [`reordered_ids`]: `ids` with `dragId` moved into `targetId`'s place, or `undefined`.
 */
export function reorderedIds(ids: any, drag_id: string, target_id: string): any;

/**
 * [`replace_vault_asset_paths`](page::replace_vault_asset_paths): `old_paths[i]` becomes `new_paths[i]`.
 */
export function replaceVaultAssetPaths(body: string, old_paths: string[], new_paths: string[]): string;

/**
 * [`replace_wiki_index`](wiki_index::replace_wiki_index).
 */
export function replaceWikiIndex(body: string, index: string): string;

/**
 * [`repo_web_url`](repo_web_url::repo_web_url): the trimmed repo URL when it is
 * http(s), otherwise `undefined`.
 */
export function repoWebUrl(repo_url?: string | null): string | undefined;

/**
 * [`wf_core::error_report::issue_url::report_markdown`] for JS.
 *
 * # Errors
 *
 * Fails when `input` is not a valid `ReportMarkdown` object, or its text is over the cap.
 */
export function reportMarkdown(input: any): string;

/**
 * [`validate_report_section_input`](report_section::validate_report_section_input): the
 * validation message, or `undefined` when the input is valid.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function reportSectionInputError(input: any): string | undefined;

/**
 * [`resample_ink_stroke`] as `{ points, pressures }`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function resampleInkStroke(points: Float64Array, pressures: Float64Array, spacing?: number | null): any;

/**
 * [`resize_figure_box`](figure::resize_figure_box): a box resized by dragging `handle`.
 *
 * # Errors
 *
 * Fails if `rect` or `handle` has the wrong shape.
 */
export function resizeFigureBox(rect: any, handle: any, dx: number, dy: number, free: boolean, min_side: number): any;

/**
 * [`resolve_annotation_conflict`] for a row and a choice string (any other choice merges).
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 */
export function resolveAnnotationConflict(row: any, choice: string): any;

/**
 * [`resolve_artifact_refs_markdown`](artifact_markdown::resolve_artifact_refs_markdown)
 * (TS `resolveArtifactRefsMarkdown`). `now_ms` is `Date.now()`.
 *
 * # Errors
 *
 * Fails if `experiments` is not a list of experiment objects.
 */
export function resolveArtifactRefsMarkdown(body: string, experiments: any, now_ms: number): string;

/**
 * [`wf_core::papers::open_access::resolve_arxiv_id`]: the arXiv id to ask about.
 */
export function resolveArxivId(arxiv_id?: string | null, doi?: string | null): string | undefined;

/**
 * [`resolve_cite_key`](cite_key::resolve_cite_key) (TS `resolveCiteKey`).
 *
 * # Errors
 *
 * Fails if `paper` is not an object with a string `id`.
 */
export function resolveCiteKey(paper: any): string;

/**
 * [`resolve_display_role`](member::resolve_display_role).
 */
export function resolveDisplayRole(role: string, in_lab: boolean, owns_org: boolean): string;

/**
 * [`resolve_ink_page_order`](ink_page::resolve_ink_page_order): the reconciled page order.
 *
 * # Errors
 *
 * Fails if either list is not an array of strings.
 */
export function resolveInkPageOrder(declared: any, present: any): any;

/**
 * [`resolve_integration_config`]. `env` is the five `NEXT_PUBLIC_*` provider values, `ids`
 * the registered ids per kind.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 */
export function resolveIntegrationConfig(env: any, ids: any): any;

/**
 * [`resolve_join_assignment`](org::resolve_join_assignment). Returns `{ role, supervisorId }`.
 *
 * # Errors
 *
 * Fails with the message if the lab cannot take this invite type.
 */
export function resolveOrgJoinAssignment(target_role: string, professor_ids: any, phd_ids: any, professor_supervisor_id?: string | null, phd_supervisor_id?: string | null): any;

/**
 * [`resolve_paper_pdf_url`]: `source` is `{ url, arxivId, openAccessPdf }`, each optional.
 * Unknown fields such as `pdfPath` are ignored, as the TS version ignores them.
 *
 * # Errors
 *
 * Fails if `source` is not an object of strings or `null`.
 */
export function resolvePaperPdfUrl(source: any): string | undefined;

/**
 * [`resolve_position_selector`] as `{ start, end }`, or `null` when unusable.
 *
 * # Errors
 *
 * Fails if `position` is not a position selector object.
 */
export function resolvePositionSelector(text: string, position: any): any;

/**
 * [`resolve_related_paper_url`](related_paper_url::resolve_related_paper_url) (TS
 * `resolveRelatedPaperUrl`). `None` becomes `undefined`.
 */
export function resolveRelatedPaperUrl(url?: string | null, doi?: string | null, arxiv_id?: string | null): string | undefined;

/**
 * [`resolve_supervisor_id`](member::resolve_supervisor_id).
 */
export function resolveSupervisorId(creator_id: string): string;

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
 * [`resolve_with_row`] for JS (TS `resolveWithRow`). `picks` maps a field to `"local"` or
 * `"remote"`; `overrides` is a row or `null`.
 *
 * # Errors
 *
 * Fails when a row or `picks` is not a plain object, or a pick is not `"local"`/`"remote"`.
 */
export function resolveWithRow(base: any, local: any, remote: any, picks: any, overrides: any): any;

/**
 * Every mapped resource type, in table order.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialized.
 */
export function resourceTypes(): any;

/**
 * [`results_table`](experiment_status::results_table): the header and rows of the runs table.
 *
 * # Errors
 *
 * Fails if `experiments` is not an array of run objects, or the result cannot be serialised.
 */
export function resultsTable(experiments: any): any;

/**
 * [`retrieve_ai_excerpts`](retrieval::retrieve_ai_excerpts). `options` is an object; `{}` takes the defaults.
 *
 * # Errors
 *
 * Fails if `documents` or `options` has the wrong shape.
 */
export function retrieveAiExcerpts(documents: any, query: string, options: any): any;

/**
 * [`retry_fuzziness_for_term`](search_retry::retry_fuzziness_for_term).
 */
export function retryFuzzinessForTerm(term: string, retry: boolean): number;

/**
 * [`verdict_for`](screening::verdict_for) (TS `verdictFor`).
 *
 * # Errors
 *
 * Fails if `decisions` has the wrong shape.
 */
export function reviewers(decisions: any): string[];

/**
 * [`rewrite_mcp_config`](mcp_config_rewrite::rewrite_mcp_config) as `{ changed, config }`.
 *
 * # Errors
 *
 * Fails when `launch` is not an object with `command`, `args` and `env`.
 */
export function rewriteMcpConfig(config: any, key: string, launch: any): any;

/**
 * [`rewrite_wikilinks`](import_links::rewrite_wikilinks). `renames` is a plain JS object mapping a
 * normalised old title to its new title.
 *
 * # Errors
 *
 * Fails if `renames` is not an object of string values.
 */
export function rewriteWikilinks(body: string, renames: any): string;

/**
 * [`role_rank`](member::role_rank). `undefined` for a role the rank table does not know.
 */
export function roleRank(role: string): number | undefined;

/**
 * [`root_folder_id_of`](upload::root_folder_id_of): the writable project's root folder id, or
 * `undefined` when read-only or the answer has none.
 */
export function rootFolderIdOf(join: any): string | undefined;

/**
 * [`root_key`](edit::root_key).
 *
 * # Errors
 *
 * Fails if the argument is not an editable root, or the result cannot be serialised.
 */
export function rootKey(root: any): any;

/**
 * [`root_of`](edit::root_of).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 */
export function rootOf(node: any): any;

/**
 * [`root_of_kind`](edit::root_of_kind). `kind` is a snake_case tree kind name.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 */
export function rootOfKind(kind: string): any;

/**
 * [`row_slots`](window::row_slots). `viewport` is `null` before measuring,
 * `pinned` is an array of row indices, `metrics` the TS row constants.
 *
 * # Errors
 *
 * Fails if an argument does not have the expected shape, or the result cannot be serialised.
 */
export function rowSlots(count: number, viewport: any, pinned: any, metrics: any): any;

/**
 * [`rows_for_height`](fit::rows_for_height): grid rows that show `px` of card.
 */
export function rowsForHeight(px: number, row_height: number, margin: number): number;

/**
 * [`s2_nested_fields`](related_paper_hit::s2_nested_fields): the S2 field list for a nested paper.
 */
export function s2NestedFields(key: string): string;

/**
 * [`s2_paper_id`](semantic_scholar_citation::s2_paper_id): the Semantic Scholar id for a reference.
 *
 * # Errors
 *
 * Fails if `reference` has the wrong shape.
 */
export function s2PaperId(reference: any): string;

/**
 * [`s2_to_hit`](related_paper_hit::s2_to_hit): the hit for a Semantic Scholar paper, or nothing
 * when it has no title.
 *
 * # Errors
 *
 * Fails if `paper` cannot be read as a Semantic Scholar paper object.
 */
export function s2ToHit(paper: any): any;

/**
 * [`safe_artifact_caption`](artifact_markdown::safe_artifact_caption) (TS `safeArtifactCaption`).
 * `undefined` or `null` counts as no caption.
 */
export function safeArtifactCaption(alt?: string | null): string;

/**
 * [`safe_image_destination`](artifact_markdown::safe_image_destination) (TS `safeImageDestination`).
 * `undefined` when the URL is not allowed.
 */
export function safeImageDestination(url: string): string | undefined;

/**
 * [`safe_label`](untrusted_context::safe_label).
 */
export function safeLabel(label: string, nonce: string): string;

/**
 * [`safe_name`](experiment_artifacts::safe_name).
 */
export function safeName(name: string): string;

/**
 * [`safe_relative`]: the normalised path inside the build directory.
 *
 * # Errors
 *
 * Throws an `Error` with the refusal message when the path leaves the build directory or names a
 * latexmk rc file.
 */
export function safeRelative(candidate: string): string;

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
 * [`same_peers`](collab::same_peers).
 *
 * # Errors
 *
 * Fails when either list is not a list of peers.
 */
export function samePeers(a: any, b: any): boolean;

/**
 * [`same_row`] for JS (TS `sameRow`).
 *
 * # Errors
 *
 * Fails when a row is not a plain object.
 */
export function sameRow(a: any, b: any): boolean;

/**
 * [`wf_core::sync::merge::same_value`] for JS.
 *
 * # Errors
 *
 * Fails when a value is not JSON.
 */
export function sameValue(a: any, b: any): boolean;

/**
 * [`sanitize_app_href`]: a same-origin app path on a known root, or `None`.
 */
export function sanitizeAppHref(raw?: string | null): string | undefined;

/**
 * [`sanitize_pdf_url`]: `None` (`undefined` in JS) when the URL is refused.
 */
export function sanitizePdfUrl(raw?: string | null): string | undefined;

/**
 * [`sanitize_reader_href`]: a same-origin `/reader` path, or `None`.
 */
export function sanitizeReaderHref(raw?: string | null): string | undefined;

/**
 * [`sanitize_section_targets`](overleaf::sanitize_section_targets); `null` when malformed.
 *
 * # Errors
 *
 * Fails if `input` cannot be read as JSON.
 */
export function sanitizeSectionTargets(input: any): any;

/**
 * [`scope_notes`](page::scope_notes) (TS `scopeNotes`): the indices of the notes that pass the
 * list and tag filters. `membership` is an object of list id to an array of note ids.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function scopeNoteIndices(notes: any, list_filter: string[], tag_filter: string[], membership: any): any;

/**
 * [`screen_for_path::screen_for_path`]: the screen cache id for a pathname, or `undefined`.
 */
export function screenForPath(pathname: string): string | undefined;

/**
 * [`screen_point_to_pdf`] as `{ x, y }` (TS `screenPointToPdf`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function screenPointToPdf(sx: number, sy: number, p: any): any;

/**
 * [`decision_error`](screening::decision_error) (TS `checkDecision`). The message, or
 * `undefined` when the decision may be recorded.
 *
 * # Errors
 *
 * Fails if `next` or `existing` has the wrong shape.
 */
export function screeningDecisionError(next: any, existing: any): string | undefined;

/**
 * [`decision_from_row`](screening::decision_from_row) (TS `PostgrestScreeningRepository`
 * `toDomain`): a stored `screening_decisions` row as a decision.
 *
 * # Errors
 *
 * Fails if `row` has the wrong shape, or its stage or state is not one the enums know.
 */
export function screeningDecisionFromRow(row: any): any;

/**
 * [`decision_to_row`](screening::decision_to_row) (TS `PostgrestScreeningRepository`
 * `record`): a decision as the `screening_decisions` row the table takes.
 *
 * # Errors
 *
 * Fails if `decision` has the wrong shape.
 */
export function screeningDecisionToRow(decision: any): any;

/**
 * [`search_revision`](search_document::search_revision).
 *
 * # Errors
 *
 * Fails if `docs` is not an array of search documents.
 */
export function searchRevision(docs: any): string;

/**
 * [`search_text_from_items`](analysis_text::search_text_from_items) (TS `searchTextFromItems`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 */
export function searchTextFromItems(items: any): any;

/**
 * [`section_progress`](section_progress::section_progress) (TS `sectionProgress`).
 *
 * # Errors
 *
 * Fails if `node` is not a section tree node.
 */
export function sectionProgress(node: any): any;

/**
 * [`seed_doi`](related_paper_hit::seed_doi): the seed's DOI, or the arXiv DOI, or nothing.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JavaScript value.
 */
export function seedDoi(doi?: string | null, arxiv_id?: string | null): any;

/**
 * [`seen_files`](folder_diff::seen_files) over the folder and current texts, the
 * base digests by path, and the renames from [`renameSources`].
 *
 * # Errors
 *
 * Fails if the inputs do not match the shape, or the result cannot be serialized.
 */
export function seenFiles(folder: any, current: any, base: any, renamed: any): any;

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
 * [`rules::segments_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function segmentsFor(kind: string): any;

/**
 * [`select_model_provider`](model_router::select_model_provider); a refusal throws its message as text.
 *
 * # Errors
 *
 * Fails if `providers` is not a list of `{ provider, available }`, or the selection is refused.
 */
export function selectModelProvider(providers: any, selected: string): string;

/**
 * [`selected_pdf_pages`](pdf_pages::selected_pdf_pages) as an array of page numbers.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function selectedPdfPages(answer: string, count: number): any;

/**
 * [`selected_text`](page_math::selected_text): the text of the lines the chosen strokes
 * belong to, one per line.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of lines or `indices` is not an array of numbers.
 */
export function selectedText(lines: any, indices: any): string;

/**
 * [`selection_to_anchor`] as a `CombinedPdfAnchor`, or `null` when the selection is empty or out of range.
 *
 * # Errors
 *
 * Fails if `selection` or `page` is not the expected object shape, or the result cannot be converted.
 */
export function selectionToAnchor(selection: any, page: any): any;

/**
 * [`semantic_scholar_target`](semantic_scholar_relay::semantic_scholar_target): the upstream
 * URL for a relay path, or `undefined` when the path is not one.
 */
export function semanticScholarTarget(pathname: string, search: string): string | undefined;

/**
 * [`semantic_scholar_to_metadata`] (TS `semanticScholarToMetadata`). A Semantic Scholar paper
 * as a paper.
 *
 * # Errors
 *
 * Fails if `paper` is not a Semantic Scholar paper.
 */
export function semanticScholarToMetadata(paper: any): any;

/**
 * [`semantic_status_text`](semantic_status_text::semantic_status_text). `status` is a
 * `SemanticStatus` (tagged by `phase`).
 *
 * # Errors
 *
 * Fails if `status` cannot be read as the expected shape.
 */
export function semanticStatusText(status: any): string;

/**
 * [`serialise_artifact_ref`](artifact_refs::serialise_artifact_ref) (TS `serialiseArtifactRef`).
 *
 * # Errors
 *
 * Fails if `artifact_ref` has the wrong shape.
 */
export function serialiseArtifactRef(artifact_ref: any): string;

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
 * [`session_action`] for JS (TS `sessionAction`): `"idle"`, `"adopt"`, `"drive"` or `"foreign"`.
 */
export function sessionAction(signed_in_user_id?: string | null, adopted_account_id?: string | null): string;

/**
 * [`set_image_placement`](markdown_image_width::set_image_placement): rewrite the `ordinal`-th
 * image whose alt is `alt` to the patched placement.
 *
 * # Errors
 *
 * Fails if `body` or `alt` is too long, or `patch` has the wrong shape.
 */
export function setImagePlacement(body: string, alt: string, ordinal: number, patch: any): string;

/**
 * [`set_ratio`](pane::set_ratio). `target` is the split being resized.
 *
 * # Errors
 *
 * Fails if `layout` or `target` has the wrong shape.
 */
export function setRatio(layout: any, target: any, ratio: number): any;

/**
 * [`set_tab_mode`](pane::set_tab_mode). `mode` is `"edit"`, `"read"` or `"ink"`.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 */
export function setTabMode(layout: any, target: any, mode: any): any;

/**
 * [`settle_plan`] for JS (TS `settleConflictPlan`). `kind` is `"edit"`, `"deleted_remote"` or
 * `"deleted_local"`. Returns `{ action, ... }`.
 *
 * # Errors
 *
 * Fails when `kind` is not one of those strings or a row is not a plain object.
 */
export function settleConflictPlan(kind: any, base: any, local: any, remote: any): any;

/**
 * [`share_allows_comment`](sharing::share_allows_comment).
 *
 * # Errors
 *
 * Fails if `share` or `resource_type` has the wrong shape.
 */
export function shareAllowsComment(share: any, resource_type: any, resource_id: string, owner_id: string): boolean;

/**
 * [`share_allows_edit`](sharing::share_allows_edit).
 *
 * # Errors
 *
 * Fails if `share` or `resource_type` has the wrong shape.
 */
export function shareAllowsEdit(share: any, resource_type: any, resource_id: string, owner_id: string): boolean;

/**
 * [`share_covers_resource`](sharing::share_covers_resource).
 *
 * # Errors
 *
 * Fails if `share` or `resource_type` has the wrong shape.
 */
export function shareCoversResource(share: any, resource_type: any, resource_id: string, owner_id: string): boolean;

/**
 * [`share_from_row`](sharing::share_from_row): a `shares` row as the app's `Share`.
 *
 * # Errors
 *
 * Fails if `row` does not have the `shares` columns.
 */
export function shareFromRow(row: any): any;

/**
 * [`share_link_from_row`](sharing::share_link_from_row): a `share_links` row as the app's `ShareLink`.
 *
 * # Errors
 *
 * Fails if `row` does not have the `share_links` columns.
 */
export function shareLinkFromRow(row: any): any;

/**
 * [`share_supports_edit_access`](sharing::share_supports_edit_access).
 *
 * # Errors
 *
 * Fails if `resource_type` is not a shareable type.
 */
export function shareSupportsEditAccess(resource_type: any, resource_id?: string | null): boolean;

/**
 * [`share_targets`](sharing::share_targets): the ids and blanket owners of one type in a grant list.
 *
 * # Errors
 *
 * Fails if `kind` is not a shareable type or `shares` is not a list of shares.
 */
export function shareTargets(shares: any, kind: any): any;

/**
 * [`shared_item`](sharing::shared_item): one table row as a `SharedItem`.
 *
 * # Errors
 *
 * Fails if `kind` is not a shareable type or `source` lacks `title`.
 */
export function sharedItem(kind: any, row: any, source: any): any;

/**
 * [`shared_item_href`](sharing::shared_item_href).
 *
 * # Errors
 *
 * Fails when `item` is not a shared item.
 */
export function sharedItemHref(item: any): string;

/**
 * [`shared_item_type_label`](sharing::shared_item_type_label).
 *
 * # Errors
 *
 * Fails when `kind` is not a shareable type.
 */
export function sharedItemTypeLabel(kind: any): string;

/**
 * [`shared_paper_annotation_summary`](sharing::shared_paper_annotation_summary).
 *
 * # Errors
 *
 * Fails when `metadata` is not JSON, or the summary cannot be converted to a JS value.
 */
export function sharedPaperAnnotationSummary(metadata: any): any;

/**
 * [`shared_provider_hint`]. `descriptor` and `all` carry `id`, `provider` and `title`;
 * other fields are ignored.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 */
export function sharedProviderHint(descriptor: any, all: any): any;

/**
 * [`shared_read_plan`](sharing::shared_read_plan): the PostgREST table, columns and filter for
 * one shared read, or `null` when there is no id and no owner.
 *
 * # Errors
 *
 * Fails if `kind` is not a shareable type or `ids`/`owners` are not string lists.
 */
export function sharedReadPlan(kind: any, ids: any, owners: any): any;

/**
 * [`shared_resource_href`](sharing::shared_resource_href).
 *
 * # Errors
 *
 * Fails when `kind` is not a shareable type.
 */
export function sharedResourceHref(kind: any, resource_id: string): string;

/**
 * [`short_sha`](experiment_status::short_sha); `undefined` when absent or empty.
 */
export function shortSha(sha?: string | null): string | undefined;

/**
 * [`shortcut_label::shortcut_label`]: a whole chord, `⌘⇧F` reads `Ctrl+Shift+F` off a Mac.
 */
export function shortcutLabel(chord: string, mac: boolean): string;

/**
 * [`should_append_ink_point`]; `minDistance` defaults to 0.75.
 */
export function shouldAppendInkPoint(path: Float64Array, x: number, y: number, min_distance?: number | null): boolean;

/**
 * [`should_mount_shell_children`](gate::should_mount_shell_children).
 */
export function shouldMountShellChildren(loading: boolean, needs_privacy_accept: boolean, container_ready: boolean): boolean;

/**
 * [`should_persist_body`](collab::should_persist_body).
 */
export function shouldPersistBody(ready: boolean, next: string, last_saved: string): boolean;

/**
 * [`should_persist_index`](index_cache_policy::should_persist_index).
 */
export function shouldPersistIndex(installed_app: boolean, document_count: number): boolean;

/**
 * [`should_retry`](search_retry::should_retry).
 */
export function shouldRetrySearch(result_count: number, term_count: number): boolean;

/**
 * [`should_show_workspace_loader`](gate::should_show_workspace_loader). `error` is the startup
 * error text, or nothing; an empty string counts as no error, as it does in JS.
 */
export function shouldShowWorkspaceLoader(loading: boolean, needs_privacy_accept: boolean, container_ready: boolean, error?: string | null): boolean;

/**
 * [`should_sync_standalone`](org::should_sync_standalone). `labs` is `null` when the
 * memberships could not be read.
 *
 * # Errors
 *
 * Fails if `profile` or `labs` has the wrong shape.
 */
export function shouldSyncStandalone(profile: any, labs: any): boolean;

/**
 * [`show_concept_edges`](graph_settings::show_concept_edges).
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function showConceptEdges(settings: any): boolean;

/**
 * [`show_relation_edges`](graph_settings::show_relation_edges).
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function showRelationEdges(settings: any): boolean;

/**
 * [`simplify_ink_path`]; `tolerance` defaults to 0.35.
 */
export function simplifyInkPath(path: Float64Array, tolerance?: number | null): Float64Array;

/**
 * [`simplify_path_indices`]; `tolerance` defaults to 0.35. Returns a JS array of indices.
 */
export function simplifyPathIndices(path: Float64Array, tolerance?: number | null): any;

/**
 * [`site_of`](paper_preview::site_of) (TS `siteOf`).
 */
export function siteOf(url: string): string;

/**
 * [`slug_for`](wf_core::sync::folder_layout::slug_for); `fallback` defaults to
 * `"untitled"` (TS `slugFor`).
 */
export function slugFor(title: string, fallback?: string | null): string;

/**
 * [`slug_segment`](tree::slug_segment).
 */
export function slugSegment(title: string): string;

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
 * Fit a line, rect, ellipse or arrow to a finished mark (Rust `snap_ink_shape`).
 * `null` when the recogniser abstains.
 */
export function snapInkShape(points: Float64Array): any;

/**
 * [`snap_to_text`]: `runs` is `{ left, top, right, bottom }[]` (plain boxes, not DOMRects).
 * Returns `{ index, x, y }` or `null`.
 *
 * # Errors
 *
 * Fails if `runs` is not an array of `{ left, top, right, bottom }` objects.
 */
export function snapToText(runs: any, x: number, y: number): any;

/**
 * [`sort_by_citations`](related_paper_hit::sort_by_citations): most cited first, stable.
 *
 * # Errors
 *
 * Fails if `hits` cannot be read as a list of hits.
 */
export function sortByCitations(hits: any): any;

/**
 * [`sort_by_due`](screen::sort_by_due): dated milestones soonest first, undated after.
 *
 * # Errors
 *
 * Fails if `milestones` has the wrong shape, or the result cannot be serialised.
 */
export function sortByDue(milestones: any): any;

/**
 * [`sort_by_reading_order_indices`] as an array of input indices in reading order.
 *
 * # Errors
 *
 * Fails if `tagged` is not an array of `{ line, column }` objects.
 */
export function sortByReadingOrder(tagged: any): any;

/**
 * [`sort_hit_order`](palette_sort::sort_hit_order): the indices of `rows` in the chosen order.
 *
 * # Errors
 *
 * Fails if `rows` or `order` has the wrong shape.
 */
export function sortHitOrder(rows: any, order: any): any;

/**
 * [`source_note_template_context`]: the `{{...}}` values for a paper's source note.
 */
export function sourceNoteTemplateContext(input: any): any;

/**
 * [`span_distance`](vocab_match::span_distance); `Infinity` when refused.
 *
 * # Errors
 *
 * Fails if `words` or `entry_words` is not an array of strings.
 */
export function spanDistance(words: any, entry_words: any): number;

/**
 * [`span_points`](text_anchor::span_points): `lengths` are the text node lengths, in order.
 *
 * # Errors
 *
 * Fails when `lengths` is not a list of counts or `span` is not a text span.
 */
export function spanPoints(lengths: any, span: any): any;

/**
 * [`splitBibliographyEntries`](bibliography::split_bibliography_entries): first format with three or more entries.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function splitBibliographyEntries(lines: any): any;

/**
 * [`splitByAuthorStart`](bibliography::split_by_author_start): entries by opening author name.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function splitByAuthorStart(lines: any): any;

/**
 * [`splitByMargins`](bibliography::split_by_margins): unnumbered entries by left margin.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function splitByMargins(lines: any): any;

/**
 * [`split_headline`] for JS (TS `splitHeadline`): `{ headline, rest }`.
 */
export function splitHeadline(body: string): any;

/**
 * [`split_ink_text_layer`](wf_core::sync::ink_note::split_ink_text_layer): one string per
 * page (TS `splitInkTextLayer`).
 *
 * # Errors
 *
 * Fails if `body` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function splitInkTextLayer(body: string): any;

/**
 * [`splitNumberedEntries`](bibliography::split_numbered_entries): entries by label.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function splitNumberedEntries(lines: any): any;

/**
 * [`split_outside_edits`](outside_edits::split_outside_edits) on `{ notes, rows, seen }`,
 * returning `{ noteHeld, rowHeld, reasons }`.
 *
 * # Errors
 *
 * Fails if the input does not match the shape, or the result cannot be serialized.
 */
export function splitOutsideEdits(input: any): any;

/**
 * [`split_pane`](pane::split_pane). `direction` is `"row"` or `"column"`.
 *
 * # Errors
 *
 * Fails if `layout` or `direction` has the wrong shape.
 */
export function splitPane(layout: any, pane_id: string, direction: any, new_pane_id: string): any;

/**
 * [`split_proposal_content`](preview::split_proposal_content).
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 */
export function splitProposalContent(content: string): any;

/**
 * [`pglite_sql::split_top_level`] (TS `splitTopLevel`): the top-level comma-separated pieces.
 *
 * # Errors
 *
 * Returns an error if the result cannot be converted to JS.
 */
export function splitTopLevel(expression: string): any;

/**
 * [`stack_margin_notes`]: `anchorTops` is a number array; returns `{ index, top, anchorTop }[]`
 * in ascending `anchorTop` order.
 *
 * # Errors
 *
 * Fails if `anchorTops` is not an array of numbers.
 */
export function stackMarginNotes(anchor_tops: any, card_height: number): any;

/**
 * [`wf_core::sync::stamp_workspace_id::stamp_workspace_id`] for JS; `null` when already stamped.
 *
 * # Errors
 *
 * Fails when `content` or `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function stampWorkspaceId(content: string, id: string): string | undefined;

/**
 * [`status_patch_for_experiment`](experiment_status::status_patch_for_experiment).
 *
 * # Errors
 *
 * Fails if `experiment` or `status` has the wrong shape.
 */
export function statusPatchForExperiment(experiment: any, status: any, now: string): any;

/**
 * [`step_cursor`](quick::step_cursor): the row an arrow key lands on.
 */
export function stepCursor(cursor: number, delta: number, length: number): number;

/**
 * [`steps_to_prune`](experiments::steps_to_prune).
 */
export function stepsToPrune(stored_steps: Float64Array): Float64Array;

/**
 * [`streak_days`] for JS (TS `streakDays`).
 *
 * # Errors
 *
 * Fails when `entryDates` is not an array of strings.
 */
export function streakDays(entry_dates: any, today: string): number;

/**
 * [`stride_for_step`](experiments::stride_for_step).
 */
export function strideForStep(step: number): number;

/**
 * [`strip_archive_root`](archive::strip_archive_root). `paths` is a `string[]`.
 *
 * # Errors
 *
 * Fails if `paths` has the wrong shape.
 */
export function stripArchiveRoot(paths: any): any;

/**
 * [`strip_frontmatter`](page::strip_frontmatter) (TS `stripFrontmatter`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function stripFrontmatter(md: string): any;

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
 * [`strip_region_markers`](tpl::strip_region_markers).
 */
export function stripRegionMarkers(document: string): string;

/**
 * [`strip_stopwords`](hybrid_fusion::strip_stopwords).
 */
export function stripStopwords(query: string): string;

/**
 * [`strip_unresolved_image_refs`](markdown_image_refs::strip_unresolved_image_refs).
 * `paths` and `resolved` are JS string arrays.
 */
export function stripUnresolvedImageRefs(body: string, prefix: string, paths: any, resolved: any): string;

/**
 * [`stroke_base_width`].
 */
export function strokeBaseWidth(samples: Float64Array, base: number): number;

/**
 * [`stroke_clip_text`]: the clipboard text for a set of `InkStroke`s.
 */
export function strokeClipText(strokes: any): string;

/**
 * [`stroke_path`] over a flat `[x0, y0, x1, y1, ...]` array; `undefined` for fewer than two numbers.
 */
export function strokePath(points: Float64Array): string | undefined;

/**
 * [`students_of`](member::students_of). Returns indices into `team`.
 *
 * # Errors
 *
 * Fails if `team` has the wrong shape.
 */
export function studentsOf(viewer_id: string | null | undefined, team: any): any;

/**
 * [`substitute_variables`](tpl::substitute_variables).
 *
 * # Errors
 *
 * Fails if the context is not a plain object.
 */
export function substituteVariables(template: string, context_value: any): string;

/**
 * [`subtree_ids`]: the id of `node` and of every list below it.
 */
export function subtreeIds(node: any): any;

/**
 * [`summarize_pdf_drop`](paper_drop::summarize_pdf_drop) (TS `summarizePdfDrop`).
 *
 * # Errors
 *
 * Fails if `entries` is not an array of drop entries, or the result cannot be converted.
 */
export function summarizePdfDrop(entries: any): any;

/**
 * [`surname_key`](analysis_text::surname_key) (TS `surnameKey`).
 */
export function surnameKey(name: string): string;

/**
 * [`sync_dot`] for JS (TS `syncDot`). `null` when the account does not sync and is online.
 *
 * # Errors
 *
 * Fails when `input` is not a sync state with the expected fields.
 */
export function syncDot(input: any): any;

/**
 * [`field_shown`]: whether the connection field with `key` is asked for in this sign-in mode.
 */
export function syncFieldShown(key: string, mattermost_sign_in: boolean): boolean;

/**
 * [`sync_stroke_steps`]: `history` is the page log, `depth` the worker's stroke count.
 */
export function syncStrokeSteps(history: any, depth: number): any;

/**
 * [`local_first_route::synced_tables`] as an array of table names.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 */
export function syncedTables(): any;

/**
 * [`tab_at`](pane::tab_at).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function tabAt(layout: any, pane_id: string, index: number): any;

/**
 * [`tab_key`](pane::tab_key).
 *
 * # Errors
 *
 * Fails if `tab` has the wrong shape.
 */
export function tabKey(tab: any): string;

/**
 * [`tab_mode`](pane::tab_mode). Returns `"edit"`, `"read"` or `"ink"`.
 *
 * # Errors
 *
 * Fails if `tab` has the wrong shape.
 */
export function tabMode(tab: any): any;

/**
 * [`tab_separated_to_markdown_table`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `input` is over the text cap.
 */
export function tabSeparatedToMarkdownTable(input: string): any;

/**
 * [`tag_colour`](graph_colour::tag_colour): the hue for a tag.
 */
export function tagColor(tag: string): string;

/**
 * [`to_tag`]: a `tags` row as the app's tag.
 */
export function tagFromRow(row: any): any;

/**
 * [`tag_to_hashtag`](note_tags::tag_to_hashtag). Empty when the name has no usable characters.
 */
export function tagToHashtag(name: string): string;

/**
 * [`tag_tone`](tag_tone::tag_tone): colour slot `1..=6` for a tag.
 */
export function tagTone(tag: string): number;

/**
 * [`take_ink_redo`](ink_undo::take_ink_redo); `null` when there is no step.
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 */
export function takeInkRedo(state: any): any;

/**
 * [`take_ink_undo`](ink_undo::take_ink_undo); `null` when there is no step.
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 */
export function takeInkUndo(state: any): any;

/**
 * [`take_page_step`]: `direction` is `"undo"` or `"redo"`; gives
 * `{ history, step }`, or `null` when that stack is empty.
 */
export function takePageStep(history: any, direction: string): any;

/**
 * [`engine_args`]: the argument vector for `engine` (`"latexmk"`, `"tectonic"` or `"pdflatex"`)
 * compiling `entry`.
 *
 * # Errors
 *
 * Fails if `engine` is not one of the known engine names, or the result cannot be converted to
 * JS.
 */
export function texEngineArgs(engine: any, entry: string): any;

/**
 * [`parse_tex_log`]: the errors in a TeX log, one per place.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 */
export function texLogErrors(log: string, entry: string): any;

/**
 * [`text_fingerprint`](analysis_text::text_fingerprint) (TS `textFingerprint`).
 *
 * # Errors
 *
 * Fails if `texts` is not an array of strings.
 */
export function textFingerprint(texts: any): string;

/**
 * [`text_hash`](semantic_fingerprint::text_hash): the stored fingerprint of a document's embedded text.
 */
export function textHash(text: string): string;

/**
 * [`theme_config_template`](theme_config::theme_config_template): the starter file.
 */
export function themeConfigTemplate(): string;

/**
 * [`tick_format`]: how the tick labels are rendered for these values.
 */
export function tickFormat(values: any): any;

/**
 * [`timeline_lane_offset`](timeline::timeline_lane_offset).
 */
export function timelineLaneOffset(mid: number, year?: number | null): number | undefined;

/**
 * [`timeline_mid_year`](timeline::timeline_mid_year). `years` is an array of years, `null` where unknown.
 *
 * # Errors
 *
 * Fails if `years` is not an array of optional numbers.
 */
export function timelineMidYear(layout: string, years: any): number | undefined;

/**
 * [`title_fixes`] (TS `titleFixes`). Only papers whose title needs a fix are listed.
 *
 * # Errors
 *
 * Fails if `papers` is not a list of paper summaries, or the result cannot be converted.
 */
export function titleFixes(papers: any): any;

/**
 * [`route_title::title_for_path`]. `navItems` is an array of `{ path, label }`.
 *
 * # Errors
 *
 * Fails if `nav_items` is not an array of `{ path, label }` objects.
 */
export function titleForPath(pathname: string, nav_items: any): string;

/**
 * [`title_from_file_name`](paper_title::title_from_file_name) (TS `titleFromFileName`).
 */
export function titleFromFileName(title: string): string;

/**
 * [`title_key`](paper_title::title_key) (TS `titleKey`). `None` becomes `undefined` in JS.
 */
export function titleKey(title?: string | null): string | undefined;

/**
 * [`title_of`](quick::title_of): the title a row is shown under.
 *
 * # Errors
 *
 * Fails if `node` is not a tree row.
 */
export function titleOf(node: any): string;

/**
 * [`title_similarity`](analysis_text::title_similarity) (TS `titleSimilarity`).
 */
export function titleSimilarity(left: string, right: string): number;

/**
 * [`to_annotation_search_docs`](search_document::to_annotation_search_docs).
 * `paper_titles` is a plain `{ paperId: title }` object.
 *
 * # Errors
 *
 * Fails if an argument does not match the expected shape.
 */
export function toAnnotationSearchDocs(annotations: any, paper_titles: any, degrees: any): any;

/**
 * [`to_extraction_result`](model_concepts::to_extraction_result), checking ids against `batchIds`.
 *
 * # Errors
 *
 * Fails if `raw` is not an array.
 */
export function toExtractionResult(raw: any, batch_ids: string[]): any;

/**
 * [`to_pdf_search_docs`](search_document::to_pdf_search_docs).
 *
 * # Errors
 *
 * Fails if `sources` or `degrees` do not match the expected shape.
 */
export function toPdfSearchDocs(sources: any, degrees: any): any;

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
 * [`to_render_strokes`]: `strokes` is an `InkRenderSource[]`, `palette` an
 * `InkSvgPalette`, and `hidden` the positions to leave out.
 */
export function toRenderStrokes(strokes: any, palette: any, hidden: Uint32Array): any;

/**
 * [`to_search_docs`](search_document::to_search_docs). `degrees` is a plain
 * `{ "kind:id": count }` object.
 *
 * # Errors
 *
 * Fails if `snapshot` or `degrees` do not match the expected shape.
 */
export function toSearchDocs(snapshot: any, degrees: any): any;

/**
 * [`to_zotero_item`] (TS `toZoteroItem`). The `journalArticle` written to Zotero for a paper.
 *
 * # Errors
 *
 * Fails if `paper` is not a paper.
 */
export function toZoteroItem(paper: any): any;

/**
 * [`to_zotero_write_payload`] for one annotation under a parent item key.
 *
 * # Errors
 *
 * Fails if `ann` is not a `ZoteroAnnotationLocal` object.
 */
export function toZoteroWritePayload(ann: any, parent_item_key: string): any;

/**
 * [`toggle_key`](state::toggle_key) for the expanded rows.
 *
 * # Errors
 *
 * Fails if the expanded argument is not an array of strings, or the result cannot be serialised.
 */
export function toggleExpanded(expanded: any, key: string): any;

/**
 * [`nav_open_groups::toggle_group`]: `groups` with `key` added when closed, removed when open.
 *
 * # Errors
 *
 * Fails if `groups` is not an array of strings, or the result cannot be converted to JS.
 */
export function toggleGroup(groups: any, key: string): any;

/**
 * [`toggle_preview`](pane::toggle_preview).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 */
export function togglePreview(layout: any, new_pane_id: string): any;

/**
 * [`toggle_key`](state::toggle_key) for the open sections.
 *
 * # Errors
 *
 * Fails if the open argument is not an array of strings, or the result cannot be serialised.
 */
export function toggleSection(open: any, id: string): any;

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
 * [`tool_owns_the_page`]: every tool but `select` takes the page from the text selection.
 */
export function toolOwnsThePage(tool: string): boolean;

/**
 * [`trail_diameter_px`](trail::trail_diameter_px): the trail's diameter in CSS px for a
 * nib width in 0.1 mm on a page `page_width_px` wide.
 */
export function trailDiameterPx(width: number, page_width_px: number): number;

/**
 * [`transform_x`](text_ot::transform_x): `[ours, theirs]` rewritten to apply after each other.
 *
 * # Errors
 *
 * Fails when the ops cannot be read or two overlapping deletes disagree.
 */
export function transformTextOps(left: any, right: any): any;

/**
 * [`translate_ink_paths`]; `decimals` defaults to 2. Returns an array of number arrays.
 */
export function translateInkPaths(paths: any, dx: number, dy: number, decimals?: number | null): any;

/**
 * [`tree_paths`](wf_core::sync::folder_layout::tree_paths) as `[id, path]` pairs in
 * first-seen order (TS `treePaths`; the TS wrapper makes them a `Map`).
 *
 * # Errors
 *
 * Fails if `nodes` is not an array of `FolderNode`s or `entity` is not a known type.
 */
export function treePathPairs(nodes: any, entity: any, project_root: string): any;

/**
 * [`uncropped_figure_box`](figure::uncropped_figure_box): the box with the crop lifted.
 *
 * # Errors
 *
 * Fails if `value` has the wrong shape.
 */
export function uncroppedFigureBox(value: any): any;

/**
 * [`union_rect`]: the box around a set of rects, or `null` when there are none.
 *
 * # Errors
 *
 * Fails if `rects` is not an array of `[x1, y1, x2, y2]` arrays.
 */
export function unionRect(rects: any): any;

/**
 * [`unique_cite_key`](cite_key::unique_cite_key) (TS `uniqueCiteKey`). `used` is a JS array of
 * strings; the caller records the returned key.
 *
 * # Errors
 *
 * Fails if `paper` is not an object with a string `id`, or `used` is not an array of strings.
 */
export function uniqueCiteKey(paper: any, used: any): string;

/**
 * [`unique_device_name`](panel_labels::unique_device_name): an adoption label no taken name matches.
 *
 * # Errors
 *
 * Fails if `taken` is not an array of strings.
 */
export function uniqueDeviceName(name: string, device_label: string, taken: any): string;

/**
 * [`unique_figure_name`](markdown_to_latex::unique_figure_name) over a list of the names
 * already used (TS `uniqueFigureName`; the TS wrapper adds the result to its `Set`).
 *
 * # Errors
 *
 * Fails if `used` is not an array of strings.
 */
export function uniqueFigureNameIn(raw: string, used: any): string;

/**
 * [`unique_title`](page::unique_title) (TS `uniqueTitle`). `used` holds normalized keys.
 */
export function uniqueTitle(base: string, used: string[]): string;

/**
 * The blob of [`unpack_vectors`](codec::unpack_vectors), or `undefined` for a torn file.
 */
export function unpackVectorBlob(file: Uint8Array): Uint8Array | undefined;

/**
 * [`unpack_head`](codec::unpack_head): the head, or `null` for a torn file.
 *
 * # Errors
 *
 * Fails only if the head cannot be serialised.
 */
export function unpackVectorHead(file: Uint8Array): any;

/**
 * [`UNTRUSTED_CONTEXT_RULE`](untrusted_context::UNTRUSTED_CONTEXT_RULE).
 */
export function untrustedContextRule(): string;

/**
 * [`url_meta_to_metadata`] (TS `urlMetaToMetadata`). A page's own metadata as a paper.
 *
 * # Errors
 *
 * Fails when the page has no title, or its title names the page rather than a paper.
 */
export function urlMetaToMetadata(meta: any): any;

/**
 * [`usable_status`](zotero_local_status::usable_status) (TS `usableStatus`).
 */
export function usableStatus(status: number): number;

/**
 * [`user_gate_open`]. `gate` is `null` or `undefined` for an ungated descriptor.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 */
export function userGateOpen(config: any, gate: any): any;

/**
 * [`validate_compute`](milestone::validate_compute): the validation message, or `undefined`
 * when the list is valid.
 *
 * # Errors
 *
 * Fails if `compute` has the wrong shape.
 */
export function validateComputeError(compute: any): string | undefined;

/**
 * [`validate_dependencies`](milestone::validate_dependencies): the validation message, or
 * `undefined` when the list is valid.
 *
 * # Errors
 *
 * Fails if `deps` has the wrong shape.
 */
export function validateDependenciesError(deps: any): string | undefined;

/**
 * [`validate_new_member`](member::validate_new_member). Throws the validation message.
 *
 * # Errors
 *
 * Fails with the message if the request is invalid.
 */
export function validateNewMember(email: string, password: string, full_name: string | null | undefined, role: string, supervisor_id?: string | null): any;

/**
 * [`validate_org_name`](org::validate_org_name). Throws the validation message.
 *
 * # Errors
 *
 * Fails with the message if the name is blank or too long.
 */
export function validateOrgName(name: string): string;

/**
 * [`validate_snapshot_title`](lab_snapshot::validate_snapshot_title). Throws on a blank title.
 */
export function validateSnapshotTitle(title: string): string;

/**
 * [`vault_asset_paths_in_body`](page::vault_asset_paths_in_body) (TS `vaultAssetPathsInBody`).
 */
export function vaultAssetPathsInBody(body: string): string[];

/**
 * [`vault_body_preview`](page::vault_body_preview) (TS `vaultBodyPreview`). `max` counts UTF-16
 * units.
 */
export function vaultBodyPreview(body: string, max: number): string;

/**
 * [`vault_image_markdown`](page::vault_image_markdown) (TS `vaultImageMarkdown`).
 */
export function vaultImageMarkdown(path: string, alt: string): string;

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
 * [`to_domain`]: a `vault_pages` row as a full page.
 */
export function vaultPageToDomain(row: any): any;

/**
 * [`to_row`]: a page as the `vault_pages` row it is written as.
 */
export function vaultPageToRow(page: any): any;

/**
 * [`to_summary_domain`]: a `vault_pages` row as a summary page (no body, a preview).
 */
export function vaultPageToSummaryDomain(row: any): any;

/**
 * [`vault_root_from_text`](home_config::vault_root_from_text): the `vaultRoot` string, or `undefined`
 * when there is none. The TS wrapper maps `undefined` to `null`.
 */
export function vaultRootFromText(text: string): string | undefined;

/**
 * Rebuild an index from `VectorIndex.toBytes()` output.
 *
 * # Errors
 *
 * Fails when the bytes are truncated, have trailing data, or repeat an id.
 */
export function vectorIndexFromBytes(bytes: Uint8Array): VectorIndex;

/**
 * Fails if `decisions` or `stage` has the wrong shape.
 */
export function verdictFor(decisions: any, item_id: string, stage: any): any;

/**
 * [`verdicts_for`](screening::verdicts_for): both stages' verdicts per item, in item order.
 *
 * # Errors
 *
 * Fails if `items` or `decisions` have the wrong shape.
 */
export function verdictsFor(items: any, decisions: any): any;

/**
 * [`viewable_artifact_url`](experiment_artifacts::viewable_artifact_url); `undefined` when refused.
 */
export function viewableArtifactUrl(entry: string, in_shell: boolean): string | undefined;

/**
 * [`visible_rows`](tree::visible_rows). `expanded` is an array of keys.
 *
 * # Errors
 *
 * Fails if either argument has the wrong shape.
 */
export function visibleRows(nodes: any, expanded: any): any;

/**
 * [`visual_page_size`] as `{ width, height }` (TS `visualPageSize`).
 *
 * # Errors
 *
 * Fails if `page` is not an object with `width` and `height`.
 */
export function visualPageSize(page: any, rotation: number): any;

/**
 * [`vscode_json`](mcp_client_config::vscode_json) for a `McpLaunchLine`.
 *
 * # Errors
 *
 * Fails if `launch` has the wrong shape.
 */
export function vscodeJson(launch: any): string;

/**
 * [`walk_sections`] over the report outline: body lines, warnings, figures and counts.
 */
export function walkOverleafSections(tree: any, opts: any): any;

/**
 * [`WEB_CACHE_DOCUMENT_LIMIT`](index_cache_policy::WEB_CACHE_DOCUMENT_LIMIT), the single source
 * the web app reads instead of keeping its own copy.
 */
export function webCacheDocumentLimit(): number;

/**
 * [`wiki_page_refs`]: the wiki's pages as `{ id, title, body }`.
 */
export function wikiPageRefs(pages: any): any;

/**
 * [`wiki_proposal_content`](wiki_plan::wiki_proposal_content) for a `WikiPagePlan` object.
 *
 * # Errors
 *
 * Fails if `plan` is not a wiki page plan object.
 */
export function wikiProposalContent(plan: any): any;

/**
 * [`wiki_source_documents`]: notes and papers as extraction documents. `sourceIds` is
 * optional; omitted means every note and paper.
 */
export function wikiSourceDocuments(pages: any, papers: any, source_ids: any): any;

/**
 * [`nav_open_groups::with_active`]: `groups` with `active` appended when it is not already listed.
 *
 * # Errors
 *
 * Fails if `groups` is not an array of strings, or the result cannot be converted to JS.
 */
export function withActive(groups: any, active?: string | null): any;

/**
 * [`with_image_width`](markdown_image_width::with_image_width): the alt for a width, keeping any
 * crop or side. `null` clears the width.
 *
 * # Errors
 *
 * Fails if `alt` is longer than the index text limit.
 */
export function withImageWidth(alt: string, width?: string | null): string;

/**
 * [`with_ink_page_background`](ink_page::with_ink_page_background): the text with its
 * background line set to `path`, or removed for `null`.
 */
export function withInkPageBackground(text: string, path?: string | null): string;

/**
 * [`with_ink_page_figures`](figure::with_ink_page_figures): a page's text with its figure block set.
 *
 * # Errors
 *
 * Fails if `text` is too long or `figures` has the wrong shape.
 */
export function withInkPageFigures(text: string, figures: any): string;

/**
 * [`with_md_image_alt`](markdown_figure_alt::with_md_image_alt): the alt text for a figure's own
 * text and placement.
 *
 * # Errors
 *
 * Fails if `alt` is too long or `placement` has the wrong shape.
 */
export function withMdImageAlt(alt: string, placement: any): string;

/**
 * [`with_missing_figures`]: the package files with `manifest.json` rewritten for missing figures.
 */
export function withMissingFigures(files: any, missing: any): any;

/**
 * [`stored_heights`](fit::stored_heights): `heights[i]`, or the saved height of card `ids[i]`.
 *
 * # Errors
 *
 * Fails when an argument is not the expected shape.
 */
export function withStoredHeights(ids: any, heights: any, stored: any): any;

/**
 * [`without_existing`](extraction::without_existing).
 *
 * # Errors
 *
 * Fails when `result` is not an extraction result.
 */
export function withoutExisting(result: any, existing: string[]): any;

/**
 * [`without_group`](groups::without_group).
 *
 * # Errors
 *
 * Fails if `tab` has the wrong shape.
 */
export function withoutGroup(tab: any): any;

/**
 * [`wf_core::sync::workspace_snapshot::workspace_snapshot_counts`] for JS.
 *
 * # Errors
 *
 * Fails when the snapshot JSON is invalid.
 */
export function workspaceSnapshotCounts(snapshot_json: string): any;

/**
 * [`wrap_region`](tpl::wrap_region). Throws on an unknown kind.
 *
 * # Errors
 *
 * Fails if `kind` is neither `generated` nor `editable`.
 */
export function wrapRegion(kind: string, name: string, body: string): string;

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
 * [`write_ink_note_meta`](ink_note::write_ink_note_meta) as a plain object, keys in TS order.
 *
 * # Errors
 *
 * Fails if `meta` has the wrong shape.
 */
export function writeInkNoteMeta(meta: any): any;

/**
 * [`year_colours`](node_colouring::year_colours): `[id, colour]` pairs for `[id, year]` pairs.
 *
 * # Errors
 *
 * Fails if `years` is not an array of `[id, number]` pairs.
 */
export function yearColours(years: any): any;

/**
 * [`YEAR_SPACING`](timeline::YEAR_SPACING): canvas units between one publication year and the next.
 */
export function yearSpacing(): number;

/**
 * [`wf_core::papers::open_access::zenodo_record_id`]: the Zenodo record id in a DOI, or `None`.
 */
export function zenodoRecordId(doi: string): string | undefined;

/**
 * [`zoom_in`] (TS `zoomIn`); `step` defaults to 1.25 in the TS wrapper.
 */
export function zoomIn(scale: number, step: number): number;

/**
 * [`zoom_out`] (TS `zoomOut`); `step` defaults to 1.25 in the TS wrapper.
 */
export function zoomOut(scale: number, step: number): number;

/**
 * [`annotation_from_item`] (TS `zoteroAnnotationFromItem`).
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroAnnotationFromItem(item: any): any;

/**
 * [`zotero_arxiv_id`] (TS `zoteroArxivId`). The arXiv id of a Zotero item, or null.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroArxivId(item: any): any;

/**
 * [`zotero_content_keys`] (TS `zoteroContentKeys`). The keys a paper matches on.
 */
export function zoteroContentKeys(doi?: string | null, arxiv_id?: string | null, title?: string | null): any;

/**
 * [`zotero_headers`](zotero_library::zotero_headers): the API key and version headers for a
 * request, as a plain object.
 *
 * # Errors
 *
 * Fails only if the headers cannot be converted to a JS value.
 */
export function zoteroHeaders(api_key: string): any;

/**
 * [`is_pdf_attachment`] (TS `zoteroIsPdfAttachment`).
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroIsPdfAttachment(item: any): any;

/**
 * [`item_key`] (TS `zoteroItemKey`). The key, or null.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroItemKey(item: any): any;

/**
 * [`zotero_key_of`] (TS `zoteroKeyOf`): the paper's Zotero item key, or `null`.
 *
 * # Errors
 *
 * Fails if `metadata` is not an object of JSON values.
 */
export function zoteroKeyOf(metadata: any): any;

/**
 * [`zotero_library_url`](zotero_library::zotero_library_url): the API URL for a library path.
 */
export function zoteroLibraryUrl(library: string, api_origin: string): string;

/**
 * The message for the 403 the local API answers when its preference is off (TS
 * `ZOTERO_LOCAL_API_OFF`).
 */
export function zoteroLocalApiOff(): string;

/**
 * [`zotero_local_status_message`](zotero_local_status::zotero_local_status_message)
 * (TS `zoteroLocalStatusMessage`).
 *
 * # Errors
 *
 * Fails if the result cannot be converted.
 */
export function zoteroLocalStatusMessage(status: number): any;

/**
 * [`note_from_item`] (TS `zoteroNoteFromItem`). The note, or null when it has no text.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroNoteFromItem(item: any): any;

/**
 * [`pick_main_pdf`] (TS `zoteroPickMainPdf`). The main PDF's key, or null.
 *
 * # Errors
 *
 * Fails if `pdfs` is not an array of Zotero items.
 */
export function zoteroPickMainPdf(pdfs: any): any;

/**
 * [`zotero_remote_to_input`] (TS `zoteroRemoteToInput`). A paper read from a Zotero item,
 * with its key kept under `metadata.zoteroKey`.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroRemoteToInput(item: any): any;

/**
 * [`zotero_remote_to_metadata`] (TS `zoteroRemoteToMetadata`). The metadata a metadata
 * lookup returns for a Zotero item.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 */
export function zoteroRemoteToMetadata(item: any): any;

/**
 * [`zotero_top_level_path`](zotero_library::zotero_top_level_path): the top-level items path,
 * inside a collection when one is given.
 */
export function zoteroTopLevelPath(collection?: string | null): string;

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
    readonly __wbg_archivebudget_free: (a: number, b: number) => void;
    readonly __wbg_inkstrokepacker_free: (a: number, b: number) => void;
    readonly __wbg_nibfilter_free: (a: number, b: number) => void;
    readonly __wbg_nibfiltersnapshot_free: (a: number, b: number) => void;
    readonly __wbg_oneeurofilter_free: (a: number, b: number) => void;
    readonly __wbg_vectorindex_free: (a: number, b: number) => void;
    readonly accountAttention: (a: any) => [number, number, number];
    readonly accountLinks: (a: any) => [number, number, number];
    readonly acronymsForTitle: (a: number, b: number) => [number, number, number];
    readonly activateTab: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly activeTab: (a: any) => [number, number, number];
    readonly activeTabKey: (a: any) => [number, number, number];
    readonly activeTabRef: (a: any) => [number, number, number];
    readonly addCounts: (a: any, b: any) => [number, number, number];
    readonly addDays: (a: number, b: number, c: number) => [number, number, number, number];
    readonly addedNotice: (a: number) => [number, number];
    readonly agreementBetween: (a: any, b: any, c: any) => [number, number, number];
    readonly aiReadCategoryForResource: (a: any) => [number, number, number];
    readonly alignSeries: (a: any) => [number, number, number];
    readonly analyzePdfDocument: (a: any, b: any) => [number, number, number];
    readonly anchorAt: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly annotationDocId: (a: number, b: number) => [number, number];
    readonly annotationIdentity: (a: any) => [number, number, number, number];
    readonly annotationPinToDomain: (a: any) => [number, number, number];
    readonly annotationQuotationTypeRowToDomain: (a: any) => [number, number, number];
    readonly appendPaperNote: (a: number, b: number, c: number, d: number) => [number, number];
    readonly appendTagHashtags: (a: number, b: number, c: any) => [number, number, number, number];
    readonly applyCommaPlacement: (a: number, b: number, c: any) => [number, number, number];
    readonly applyDelta: (a: any, b: any, c: any) => [number, number, number];
    readonly applyGroupCommand: (a: any, b: number, c: any) => [number, number, number];
    readonly applyTemplate: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly applyTextOp: (a: number, b: number, c: any) => [number, number, number, number];
    readonly applyUserIntegrationFields: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly archivebudget_admit: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly archivebudget_new: (a: any) => [number, number, number];
    readonly archivebudget_oversize: (a: number) => [number, number];
    readonly artifactBasename: (a: number, b: number) => [number, number];
    readonly arxivCandidates: (a: number, b: number) => [number, number, number];
    readonly arxivEntryToMetadata: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly askPrompt: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly assemblePageCitations: (a: any, b: any, c: any, d: any, e: any) => [number, number, number];
    readonly assertSafeExportPath: (a: number, b: number) => [number, number];
    readonly assetExtension: (a: number, b: number) => [number, number];
    readonly assetMimeType: (a: number, b: number) => [number, number];
    readonly assetPath: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly axisSpec: (a: number, b: number) => [number, number, number];
    readonly backlinksForAnnotation: (a: any, b: number, c: number) => [number, number, number];
    readonly bibImportMessage: (a: number, b: number, c: number) => [number, number];
    readonly bibPaperInput: (a: any) => [number, number, number];
    readonly binomialSmooth: (a: number, b: number, c: number, d: number) => [number, number];
    readonly blankInkPage: (a: any) => [number, number, number];
    readonly blobProviderForRuntime: (a: number, b: number, c: any) => [number, number, number];
    readonly bodyFontSize: (a: any) => [number, number, number];
    readonly bodyLinksTo: (a: number, b: number, c: number, d: number) => number;
    readonly bodyStats: (a: number, b: number) => [number, number, number];
    readonly bothEndsMerge: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly boundedBody: (a: number, b: number) => [number, number];
    readonly breadcrumbs: (a: any, b: any, c: any) => [number, number, number];
    readonly buildAnnotationSortIndex: (a: number, b: number, c: number) => [number, number];
    readonly buildExcerpt: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly buildGraphData: (a: any) => [number, number, number];
    readonly buildLabSnapshotContent: (a: any) => [number, number, number];
    readonly buildListTree: (a: any) => [number, number, number];
    readonly buildListsTree: (a: any) => [number, number, number];
    readonly buildPageTree: (a: any) => [number, number, number];
    readonly buildPaperHtmlDocument: (a: any, b: any) => [number, number, number, number];
    readonly buildProposeFillPrompt: (a: any) => [number, number, number, number];
    readonly buildReferenceIndex: (a: any, b: any) => [number, number, number];
    readonly buildSectionTree: (a: any) => [number, number, number];
    readonly buildWikiGraph: (a: any) => [number, number, number];
    readonly buildWikiIndex: (a: any, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly buildWorkspaceTree: (a: any) => [number, number, number];
    readonly cachePathSegments: (a: number, b: number) => [number, number, number, number];
    readonly canCreateRole: (a: number, b: number, c: number, d: number) => number;
    readonly canDrop: (a: any, b: any) => [number, number, number];
    readonly canJoinInkGroup: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly canRename: (a: any) => [number, number, number];
    readonly canonicalAiToolName: (a: number, b: number) => [number, number];
    readonly cardSnippet: (a: number, b: number, c: number) => [number, number, number, number];
    readonly changedSide: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly checkBibliography: (a: any) => [number, number, number];
    readonly checkGitRemoteUrl: (a: any) => [number, number, number];
    readonly checkInkChunkBody: (a: number, b: number) => [number, number, number];
    readonly checkOverleafLinkFolder: (a: number, b: number) => [number, number, number];
    readonly checkUrlShape: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly chooseAnchorStrategy: (a: any, b: number, c: number) => [number, number, number];
    readonly chunkForEmbedding: (a: number, b: number, c: any) => [number, number, number];
    readonly citationAlertMessage: (a: any) => [number, number, number, number];
    readonly citationAlertScores: (a: any) => [number, number, number, number];
    readonly citationAlertTrackFromRow: (a: any) => [number, number, number];
    readonly citationContexts: (a: any) => [number, number, number];
    readonly citationExternalIdRef: (a: any) => [number, number, number];
    readonly citationIntentLabel: (a: any) => [number, number, number, number];
    readonly citationIntents: (a: any) => [number, number, number];
    readonly citationItemToRect: (a: any, b: number, c: number) => [number, number, number];
    readonly citeKeyOf: (a: any) => [number, number, number];
    readonly citedSourceNumbers: (a: number, b: number, c: number) => [number, number, number];
    readonly clampInkNoteWidth: (a: number, b: number, c: number) => number;
    readonly clampInkPageSize: (a: number, b: number) => [number, number, number];
    readonly clampInkWidth: (a: number) => number;
    readonly clampInkZoom: (a: number) => number;
    readonly clampPage: (a: number, b: number) => number;
    readonly clampScale: (a: number) => number;
    readonly clampZoomFactor: (a: number, b: number) => number;
    readonly claudeCodeCommands: () => [number, number];
    readonly cleanArxivId: (a: number, b: number) => [number, number];
    readonly cleanGroups: (a: any) => [number, number, number];
    readonly cleanPastedText: (a: number, b: number, c: any) => [number, number, number];
    readonly cleanPdfText: (a: number, b: number, c: any) => [number, number, number];
    readonly cleanPmcid: (a: number, b: number) => [number, number];
    readonly cleanUrlsWithRules: (a: number, b: number, c: any) => [number, number, number];
    readonly cleanWidgetPalette: (a: any) => [number, number, number];
    readonly cleanWrappedText: (a: number, b: number, c: any) => [number, number, number];
    readonly clipSegmentToArea: (a: any, b: any, c: any) => [number, number, number];
    readonly cloneLinks: (a: any) => [number, number, number];
    readonly closeTab: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly closedTabs: (a: any, b: any) => [number, number, number];
    readonly clusterMarks: (a: any, b: number) => [number, number, number];
    readonly coalesceMentions: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly codexToml: (a: any) => [number, number, number, number];
    readonly coercePaperFieldValue: (a: any, b: any) => [number, number, number];
    readonly coldBlobClientConfig: (a: any) => [number, number, number];
    readonly collapseAlert: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly collapseToEntities: (a: any, b: number, c: number) => [number, number, number];
    readonly collectAnnotationImageRegions: (a: any) => [number, number, number];
    readonly collectCitedKeys: (a: number, b: number) => [number, number, number];
    readonly collectListIds: (a: any) => [number, number, number];
    readonly collectNewHits: (a: any) => [number, number, number];
    readonly colourToolFor: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly commandForChord: (a: any, b: number) => [number, number, number];
    readonly commandMatchIndices: (a: any, b: number, c: number) => [number, number, number];
    readonly commentFromRow: (a: any) => [number, number, number];
    readonly commitUrl: (a: number, b: number, c: number, d: number) => [number, number];
    readonly communities: (a: any, b: any) => [number, number, number];
    readonly compactInkPath: (a: number, b: number, c: any) => [number, number, number, number];
    readonly composeSpacingAccents: (a: number, b: number) => [number, number];
    readonly computeFitPageScale: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly computeFitWidthScale: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly computeRollupsForPapers: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly conceptKey: (a: number, b: number) => [number, number];
    readonly conflictRoute: (a: any) => [number, number, number];
    readonly containerResize: (a: any, b: any) => [number, number, number, number];
    readonly contextNonceFrom: (a: number, b: number) => [number, number];
    readonly coreInfo: () => [number, number, number];
    readonly countActionList: (a: any) => [number, number, number];
    readonly countActions: (a: any) => [number, number, number];
    readonly countJsonActions: (a: any) => [number, number, number];
    readonly countSectionSources: (a: number, b: number) => number;
    readonly countWords: (a: number, b: number) => number;
    readonly coveredHitMask: (a: any, b: number, c: number) => [number, number, number];
    readonly coveredTextSpans: (a: any, b: any) => [number, number, number];
    readonly creatableRoles: (a: number, b: number) => [number, number, number];
    readonly creatableUnder: (a: any) => [number, number, number];
    readonly createExperimentWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createInkStrokePacker: (a: any) => [number, number, number];
    readonly createLogEntry: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createMilestoneWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createPaperRelationWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createReadingListWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createReportSectionWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createVaultPageWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createVectorIndex: (a: number) => [number, number, number];
    readonly createdPageIndex: (a: any, b: any) => [number, number, number];
    readonly creationKindFor: (a: number, b: number) => [number, number, number];
    readonly creationTarget: (a: any, b: any, c: any) => [number, number, number];
    readonly cropFigureTo: (a: any, b: any) => [number, number, number];
    readonly crossrefToMetadata: (a: any, b: number, c: number) => [number, number, number];
    readonly damerauLevenshtein: (a: number, b: number, c: number, d: number) => number;
    readonly dashboardAppendCardPair: (a: any, b: number, c: number, d: number, e: number, f: any) => [number, number, number];
    readonly dashboardBuildStats: (a: any, b: number, c: number) => [number, number, number];
    readonly dashboardCloseGaps: (a: any, b: any, c: number) => [number, number, number];
    readonly dashboardCompactVertical: (a: any, b: number) => [number, number, number];
    readonly dashboardDefaultLayout: (a: number) => [number, number, number];
    readonly dashboardFinalizeLayout: (a: any, b: any) => [number, number, number];
    readonly dashboardLayoutFloors: (a: any, b: number) => [number, number, number];
    readonly dashboardLayoutSignature: (a: any) => [number, number, number, number];
    readonly dashboardLgNeedsRepair: (a: any, b: any) => [number, number, number];
    readonly dashboardMergeRglPositions: (a: any, b: any, c: any, d: number) => [number, number, number];
    readonly dashboardMergeSupervisorCards: (a: any, b: any, c: any) => [number, number, number];
    readonly dashboardNeedsAttention: (a: any, b: any, c: any, d: number, e: number) => [number, number, number];
    readonly dashboardNormalizeItem: (a: any, b: any, c: number) => [number, number, number];
    readonly dashboardPackSm: (a: any, b: any) => [number, number, number];
    readonly dashboardSmNeedsRepack: (a: any, b: any) => [number, number, number];
    readonly dashboardSuperviseeCounts: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly dashboardSyncLayouts: (a: any, b: any) => [number, number, number];
    readonly dashboardTeamAttention: (a: any, b: number, c: number) => [number, number, number];
    readonly dashboardTopTags: (a: any, b: number) => [number, number, number];
    readonly daysUntilDate: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly decideAnnotationSync: (a: any, b: number, c: number) => [number, number, number];
    readonly decideGitSyncPath: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly decideVaultCommit: (a: number, b: any) => [number, number, number];
    readonly declaredCharset: (a: number, b: number, c: number, d: number) => [number, number];
    readonly decodeHtmlEntities: (a: number, b: number) => [number, number, number, number];
    readonly decodeInkWords: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly decodeLocus: (a: number, b: number) => [number, number, number];
    readonly decodeShareLinkToken: (a: number, b: number) => [number, number, number, number];
    readonly deepestFirstListIds: (a: number, b: number, c: any) => [number, number, number, number];
    readonly defaultExpanded: (a: any) => [number, number, number];
    readonly defaultGraphSettings: () => [number, number, number];
    readonly defaultInkNoteMeta: () => [number, number, number];
    readonly defaultModeFor: (a: number, b: number) => [number, number, number];
    readonly defaultOpenSections: (a: any) => [number, number, number];
    readonly defaultPasteSettings: () => [number, number, number];
    readonly defaultShareLinkExpiresAt: (a: number) => [number, number];
    readonly defaultSourceNoteTemplate: () => [number, number];
    readonly degreeColours: (a: any) => [number, number, number];
    readonly deletedLocalBase: (a: any) => [number, number, number];
    readonly deletedRemoteSides: (a: any, b: any) => [number, number, number];
    readonly deletionAction: (a: any, b: any, c: any, d: number, e: number, f: any) => [number, number, number];
    readonly deletionFor: (a: any, b: any) => [number, number, number];
    readonly describeChanges: (a: any) => [number, number, number, number];
    readonly describeFreeCopyFailure: (a: any, b: number) => [number, number, number, number];
    readonly describePull: (a: any) => [number, number, number, number];
    readonly describePush: (a: any) => [number, number, number, number];
    readonly describeRemoteStatus: (a: any) => [number, number, number, number];
    readonly detectCitationStyle: (a: any) => [number, number, number];
    readonly detectColumns: (a: any) => [number, number, number];
    readonly deviceMarkers: (a: number, b: number, c: number, d: number) => [number, number];
    readonly diffAnnotationFields: (a: any) => [number, number, number];
    readonly diffBody: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly diffJsonData: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly diffRefreshPlan: (a: any, b: any, c: any) => [number, number, number];
    readonly diffWorkspace: (a: any, b: any, c: any) => [number, number, number];
    readonly digestText: (a: number, b: number) => [number, number];
    readonly distanceToSegmentSquared: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly distinctRelated: (a: any) => [number, number, number];
    readonly documentBoost: (a: any, b: any, c: number) => [number, number, number];
    readonly documentIdOf: (a: number, b: number) => [number, number];
    readonly documentIdOfPath: (a: number, b: number) => [number, number];
    readonly documentKind: (a: number, b: number) => [number, number, number];
    readonly documentSuffix: (a: number, b: number) => [number, number, number];
    readonly doubleClickFigure: (a: any, b: any, c: number) => [number, number, number];
    readonly draftIcon: (a: any) => [number, number, number];
    readonly draftMakes: (a: any) => [number, number, number];
    readonly draftPlaceholder: (a: any) => [number, number, number];
    readonly draftReadingLog: (a: any, b: any, c: number, d: number) => [number, number, number, number];
    readonly dropParentId: (a: any) => [number, number, number];
    readonly duplicatePlan: (a: any, b: any) => [number, number, number];
    readonly editSides: (a: any) => [number, number, number];
    readonly editedRelativeLabel: (a: number) => [number, number];
    readonly effectiveFieldBoosts: (a: any) => [number, number, number];
    readonly effectiveRelationTypes: (a: any) => [number, number, number];
    readonly emaSmooth: (a: any, b: number) => [number, number, number];
    readonly embedTitles: (a: number, b: number) => [number, number];
    readonly embeddableText: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly emptyCellPaperIds: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly emptyIntegration: (a: any) => [number, number, number];
    readonly emptyLayout: (a: number, b: number) => [number, number, number];
    readonly emptyPageHistory: () => [number, number, number];
    readonly emptyToNull: (a: number, b: number) => [number, number, number];
    readonly encodeInkChunkBody: (a: any) => [number, number, number, number];
    readonly encodeLocus: (a: any) => [number, number, number, number];
    readonly encodeOpenGroups: (a: any) => [number, number, number, number];
    readonly encodeRollupOptions: (a: any) => [number, number, number, number];
    readonly encodeShareLinkToken: (a: number, b: number) => [number, number];
    readonly entityDir: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly entryFileError: (a: number, b: number) => [number, number];
    readonly enumLabel: (a: number, b: number, c: number, d: number) => [number, number];
    readonly enumOptions: (a: number, b: number) => [number, number, number];
    readonly escapeHtml: (a: number, b: number) => [number, number];
    readonly escapeLatexText: (a: number, b: number) => [number, number];
    readonly evaluateAiAccess: (a: any, b: number, c: number) => [number, number, number];
    readonly excerptOf: (a: number, b: number, c: any) => [number, number, number];
    readonly excerptSegments: (a: any) => [number, number, number];
    readonly exclusionReasons: (a: any, b: any) => [number, number, number];
    readonly expandEmbeds: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly expandIpv6: (a: number, b: number) => [number, number, number];
    readonly experimentActivityAt: (a: any) => [number, number, number];
    readonly experimentHref: (a: number, b: number, c: number) => [number, number];
    readonly experimentRowToDomain: (a: any) => [number, number, number];
    readonly experimentToRow: (a: any) => [number, number, number];
    readonly experimentsListHref: () => [number, number];
    readonly explainArm: (a: any) => [number, number, number, number];
    readonly exportAssetPath: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly exportManifestJson: (a: number, b: number, c: any) => [number, number, number, number];
    readonly exportReadme: (a: number, b: number) => [number, number];
    readonly extractDoi: (a: number, b: number) => [number, number, number, number];
    readonly extractHashtagRefs: (a: number, b: number) => [number, number, number];
    readonly extractHashtags: (a: number, b: number) => [number, number];
    readonly extractHeadings: (a: number, b: number) => [number, number];
    readonly extractPageMetadata: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly extractPageTitle: (a: number, b: number) => [number, number, number];
    readonly extractVenue: (a: number, b: number) => [number, number];
    readonly extractWikilinks: (a: number, b: number) => [number, number, number];
    readonly extractionCsv: (a: any, b: any, c: any) => [number, number, number, number];
    readonly extractionMarkdown: (a: any, b: any, c: any) => [number, number, number, number];
    readonly extractionValueRows: (a: any, b: any, c: any) => [number, number, number];
    readonly fenceUntrusted: (a: any, b: number, c: number) => [number, number, number, number];
    readonly figureAltFor: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly figureClipText: (a: any) => [number, number, number, number];
    readonly figureCornerHit: (a: number) => number;
    readonly figureImageFrame: (a: any) => [number, number, number];
    readonly figureLabel: (a: number, b: number, c: number) => [number, number];
    readonly figureUnder: (a: any, b: any, c: number) => [number, number, number];
    readonly filterGraphByNodes: (a: any, b: any, c: any) => [number, number, number];
    readonly filterLabMembers: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly filterRows: (a: any, b: number, c: number) => [number, number, number];
    readonly filterTeamMembers: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly findAnnotationBacklinks: (a: any) => [number, number, number];
    readonly findCitationCandidates: (a: any) => [number, number, number];
    readonly findDocumentMatches: (a: any, b: number, c: number) => [number, number, number];
    readonly findDuplicateGroups: (a: any) => [number, number, number];
    readonly findFigureMentions: (a: any, b: any) => [number, number, number];
    readonly findHeadingLines: (a: any, b: number, c: any) => [number, number, number];
    readonly findImageRefs: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly findMarks: (a: any, b: number, c: any) => [number, number, number];
    readonly findPatternCitationMentions: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly findQuoteMatches: (a: number, b: number, c: any) => [number, number, number];
    readonly findReferenceSection: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly findRelated: (a: any, b: number, c: number, d: number, e: any, f: any, g: any, h: any) => [number, number, number];
    readonly findWikiRoot: (a: any) => [number, number, number];
    readonly fitCols: (a: number, b: number) => number;
    readonly fitLayoutToContent: (a: any, b: any, c: any) => [number, number, number];
    readonly fitScale: (a: number, b: number) => number;
    readonly fitsInkNoteBudget: (a: number, b: number) => number;
    readonly flatPath: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number, number];
    readonly flattenOverleafDocs: (a: any) => [number, number, number];
    readonly flattenOverleafFiles: (a: any) => [number, number, number];
    readonly flattenTree: (a: any) => [number, number, number];
    readonly focusPane: (a: any, b: number, c: number) => [number, number, number];
    readonly focusedTabCount: (a: any) => [number, number, number];
    readonly folderIdsOf: (a: any) => [number, number, number];
    readonly folderKey: (a: number, b: number) => [number, number];
    readonly folderKeys: (a: number, b: number) => [number, number];
    readonly folderTitleFromPath: (a: number, b: number) => [number, number];
    readonly fontSizeOf: (a: any) => [number, number, number];
    readonly forgetSearchQuery: (a: number, b: number, c: number, d: number) => [number, number];
    readonly formatCitation: (a: number, b: number, c: number, d: number) => [number, number];
    readonly formatCount: (a: number) => [number, number];
    readonly formatCursorLabel: (a: number, b: number) => [number, number];
    readonly formatFigureTokens: (a: any) => [number, number, number, number];
    readonly formatInviteCode: (a: number, b: number) => [number, number];
    readonly formatLogLine: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number];
    readonly formatMetricCell: (a: number, b: number, c: any) => [number, number, number, number];
    readonly formatMetricValue: (a: number, b: number, c: number) => [number, number];
    readonly formatPaperCitation: (a: any, b: number, c: number) => [number, number, number, number];
    readonly formatQuoteBlock: (a: number, b: number) => [number, number, number, number];
    readonly formatQuoteCiteClipboard: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly formatReference: (a: any) => [number, number, number, number];
    readonly formatWords: (a: number) => [number, number];
    readonly fromRelativeBlobLinks: (a: number, b: number, c: any) => [number, number, number, number];
    readonly frontmatterList: (a: any, b: number, c: number) => [number, number, number];
    readonly frontmatterString: (a: any, b: number, c: number) => [number, number, number, number];
    readonly furnitureKey: (a: number, b: number) => [number, number];
    readonly furnitureLines: (a: any) => [number, number, number];
    readonly fuseRankings: (a: any, b: number, c: number) => [number, number, number];
    readonly fuzzinessForTerm: (a: number, b: number) => number;
    readonly gateVectorMask: (a: any, b: number, c: number) => [number, number, number];
    readonly geminiInstall: () => [number, number];
    readonly getUserIntegrationField: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly gitConnection: (a: any) => [number, number, number];
    readonly gitConnectionReady: (a: any) => [number, number, number];
    readonly gitReason: (a: number, b: number) => [number, number];
    readonly githubRepoPdfPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly gitlabCombinedActive: (a: any) => [number, number, number];
    readonly graphDegrees: (a: any) => [number, number, number];
    readonly graphDensity: (a: any) => [number, number, number];
    readonly graphFilterCountFor: (a: number, b: number, c: any) => [number, number, number];
    readonly graphPalette: () => [number, number, number];
    readonly graphTagNames: (a: any, b: any, c: any, d: number) => [number, number, number];
    readonly graphTopologyKey: (a: any, b: number, c: number, d: number) => [number, number, number, number];
    readonly groupByDay: (a: any) => [number, number, number];
    readonly groupHunks: (a: any) => [number, number, number];
    readonly groupPaletteRows: (a: any) => [number, number, number];
    readonly groupProposals: (a: any, b: any, c: any) => [number, number, number];
    readonly groupRecurringLines: (a: any, b: any) => [number, number, number];
    readonly groupResults: (a: any) => [number, number, number];
    readonly groupRuns: (a: any) => [number, number, number];
    readonly groupSubtreeItems: (a: any, b: any) => [number, number, number];
    readonly guessBlobContentType: (a: number, b: number) => [number, number, number, number];
    readonly guessTitle: (a: number, b: number) => [number, number];
    readonly hasActiveLab: (a: number, b: number, c: any, d: number) => [number, number, number];
    readonly hasConflictMarkers: (a: number, b: number) => [number, number, number];
    readonly hasInkView: (a: number, b: number) => number;
    readonly hasLazyBody: (a: number, b: number) => number;
    readonly hasPdfMagic: (a: number, b: number) => number;
    readonly hasPdfView: (a: number, b: number) => number;
    readonly headingOutline: (a: any) => [number, number, number];
    readonly headingSlug: (a: number, b: number) => [number, number];
    readonly highlightWithinExcerpt: (a: number, b: number, c: any) => [number, number, number];
    readonly highlightsDigest: (a: any, b: number, c: number) => [number, number, number, number];
    readonly hostOf: (a: number, b: number) => [number, number];
    readonly humanise: (a: number, b: number) => [number, number];
    readonly humanize: (a: number, b: number) => [number, number];
    readonly hydrateTabModes: (a: any, b: any) => [number, number, number];
    readonly hydrateUserSettings: (a: any) => [number, number, number];
    readonly idSuffix: (a: number, b: number) => [number, number, number, number];
    readonly ident: (a: number, b: number) => [number, number, number, number];
    readonly imageAltFromFilename: (a: number, b: number) => [number, number, number, number];
    readonly imageExtensionForMime: (a: number, b: number) => [number, number, number, number];
    readonly imagePathsInBody: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly imagesOf: (a: any) => [number, number, number, number];
    readonly inReferenceList: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly inboxLinks: (a: any) => [number, number, number];
    readonly incomingRelationLabel: (a: number, b: number) => [number, number];
    readonly indexFromAnalysis: (a: any, b: any) => [number, number, number];
    readonly indexTerms: (a: number, b: number, c: any) => [number, number, number];
    readonly indexTermsOf: (a: number, b: number) => [number, number];
    readonly initialReaderViewport: (a: number) => [number, number, number];
    readonly inkAttachmentIndex: (a: number, b: number, c: number, d: number) => number;
    readonly inkChunkBodySize: (a: any) => [number, number, number];
    readonly inkChunkHeaderBytes: (a: number, b: number, c: number) => [number, number];
    readonly inkChunkPath: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly inkCurveAt: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly inkEngineInfo: (a: number, b: number) => [number, number, number];
    readonly inkEnumIndex: (a: any, b: number, c: number) => [number, number, number];
    readonly inkEnumValue: (a: any, b: number) => [number, number, number, number];
    readonly inkLineRecords: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly inkLineStrokes: (a: any, b: any) => [number, number, number];
    readonly inkNoteWidthToPdfPoints: (a: number) => number;
    readonly inkPageBackground: (a: number, b: number) => [number, number, number];
    readonly inkPageConfidence: (a: number, b: number) => number;
    readonly inkPageFigures: (a: number, b: number) => [number, number, number];
    readonly inkPageMarker: (a: number) => [number, number];
    readonly inkPageOverBudget: (a: any) => [number, number, number];
    readonly inkPageSvg: (a: any, b: any) => [number, number, number, number];
    readonly inkPathJsonSize: (a: number, b: number) => number;
    readonly inkPathsBounds: (a: any) => [number, number, number];
    readonly inkPathsHitTest: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly inkPathsInPolygon: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly inkPointInPolygon: (a: number, b: number, c: any) => [number, number, number];
    readonly inkPressureFactor: (a: number, b: number) => number;
    readonly inkPrintDocument: (a: any) => [number, number, number, number];
    readonly inkSidecarDir: (a: number, b: number) => [number, number, number, number];
    readonly inkStrokeBandOf: (a: number, b: number) => [number, number];
    readonly inkTangentAt: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number];
    readonly inkVelocityBetween: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly inkVelocityFactor: (a: number, b: number, c: number) => number;
    readonly inkVocabularyHints: (a: any, b: number, c: number) => [number, number, number];
    readonly inkVocabularyWordList: (a: any) => [number, number, number];
    readonly inkWidthForPressure: (a: number, b: number, c: number, d: number) => number;
    readonly inkZoomIn: (a: number) => number;
    readonly inkZoomOut: (a: number) => number;
    readonly inkstrokepacker_points: (a: number) => [number, number];
    readonly inkstrokepacker_pressures: (a: number) => [number, number];
    readonly inkstrokepacker_push: (a: number, b: number, c: number, d: number, e: number) => void;
    readonly integrationsBagFromLegacy: (a: any) => [number, number, number];
    readonly invalidationMap: () => [number, number, number];
    readonly invalidationPlan: (a: number, b: number) => [number, number, number];
    readonly invertedAbstract: (a: any) => [number, number, number];
    readonly isAllPages: (a: number, b: number) => number;
    readonly isAllowedPdfProxyUrl: (a: number, b: number) => number;
    readonly isAnnotationSyncState: (a: any) => number;
    readonly isApiHost: (a: number, b: number) => number;
    readonly isAppOwnedPath: (a: number, b: number) => [number, number, number];
    readonly isBibFile: (a: number, b: number) => number;
    readonly isBibliographicMatch: (a: any, b: any) => [number, number, number];
    readonly isBlanketShare: (a: number, b: number) => number;
    readonly isBoldFont: (a: number, b: number) => number;
    readonly isBothEndsRpc: (a: number, b: number) => number;
    readonly isCitationDestination: (a: any) => [number, number, number];
    readonly isConferenceCopy: (a: any) => [number, number, number];
    readonly isCreatableKind: (a: number, b: number) => number;
    readonly isDismissTap: (a: any, b: any, c: number) => [number, number, number];
    readonly isDocumentKind: (a: number, b: number) => number;
    readonly isDocumentNode: (a: any) => [number, number, number];
    readonly isEditableReaderTarget: (a: number, b: number, c: number) => number;
    readonly isElectronMcpEntry: (a: any) => [number, number, number];
    readonly isEmptyPaperSummary: (a: number, b: number) => number;
    readonly isExplicitLabMembership: (a: any) => [number, number, number];
    readonly isHighlighterInk: (a: number, b: number) => number;
    readonly isHtmlContentType: (a: number, b: number) => number;
    readonly isInkChunkId: (a: number, b: number) => [number, number, number];
    readonly isInkEngineId: (a: number, b: number) => number;
    readonly isInkNoteBody: (a: number, b: number) => [number, number, number];
    readonly isInkNoteFrontmatter: (a: any) => [number, number, number];
    readonly isInkNoteId: (a: number, b: number) => number;
    readonly isInkTool: (a: number, b: number) => number;
    readonly isIpAddress: (a: number, b: number) => number;
    readonly isIsoDay: (a: number, b: number) => number;
    readonly isKnownResourceType: (a: number, b: number) => number;
    readonly isLiteral: (a: number, b: number) => [number, number, number, number];
    readonly isLocalZoteroUrl: (a: number, b: number) => number;
    readonly isMissingServiceRole: (a: number, b: number) => number;
    readonly isNewerVersion: (a: any, b: any) => [number, number, number];
    readonly isNoteImportFile: (a: number, b: number) => number;
    readonly isOnSamplingGrid: (a: number) => number;
    readonly isOverleafProjectId: (a: number, b: number) => number;
    readonly isPaperFieldKind: (a: number, b: number) => number;
    readonly isPdfContentType: (a: number, b: number) => number;
    readonly isPdfFile: (a: number, b: number, c: number, d: number) => number;
    readonly isPenBarrelPointer: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly isPenEraserPointer: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly isPlaceholderTitle: (a: number, b: number) => number;
    readonly isPreviewKey: (a: any, b: number) => [number, number, number];
    readonly isPrivateHost: (a: number, b: number) => number;
    readonly isPublicAddress: (a: number, b: number) => number;
    readonly isPublicHttpsUrl: (a: number, b: number) => number;
    readonly isQuotationType: (a: number, b: number) => number;
    readonly isReaderAnnotationType: (a: any) => number;
    readonly isRotatedText: (a: number, b: number) => number;
    readonly isSafeWorkspacePath: (a: number, b: number) => [number, number, number];
    readonly isSectionOpen: (a: any, b: number, c: number) => [number, number, number];
    readonly isSettled: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly isStaleRunningExperiment: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly isSubstantialPaperText: (a: number, b: number, c: number) => number;
    readonly isSupervisorRole: (a: number, b: number) => number;
    readonly isSyncedTable: (a: number, b: number) => number;
    readonly isUnderIgnoredFolder: (a: number, b: number) => [number, number, number];
    readonly isUnsureConfidence: (a: number) => number;
    readonly isUserIntegrationConnected: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly isWebArticle: (a: any) => [number, number, number];
    readonly isZoteroChildItem: (a: any) => [number, number, number];
    readonly isZoteroLibrarySyncMode: (a: any) => number;
    readonly itemToRect: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly joinBibtex: (a: any) => [number, number, number, number];
    readonly joinInkTextLayer: (a: any) => [number, number, number, number];
    readonly jsonDataPath: (a: number, b: number, c: any) => [number, number, number, number];
    readonly jsonEditSince: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly jsonKindOfPath: (a: number, b: number) => [number, number, number, number];
    readonly keepFigureOnPage: (a: any, b: number, c: number) => [number, number, number, number];
    readonly keyLabel: (a: number, b: number, c: number) => [number, number];
    readonly kindIcon: (a: number, b: number) => [number, number, number];
    readonly kindIconClass: (a: number, b: number, c: number) => [number, number, number];
    readonly kindMultiplier: (a: number, b: number, c: any) => [number, number, number];
    readonly kindNames: () => [number, number, number];
    readonly kindOf: (a: number, b: number) => [number, number];
    readonly kindOwner: (a: number, b: number) => [number, number, number];
    readonly kindSuffix: (a: number, b: number) => [number, number, number];
    readonly kindTintClass: (a: number, b: number) => [number, number, number];
    readonly kindsForResource: (a: number, b: number) => [number, number, number];
    readonly knownCandidates: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly labSnapshotRowToDomain: (a: any) => [number, number, number];
    readonly labelForPath: (a: number, b: number, c: any) => [number, number, number, number];
    readonly labelNumber: (a: any) => [number, number, number];
    readonly labelSize: (a: number, b: number, c: number) => [number, number, number];
    readonly ladderOrder: (a: any) => [number, number, number];
    readonly latestByReviewerList: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly layoutForCommand: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly layoutForTabMenu: (a: any, b: number, c: number, d: number, e: any, f: number, g: number) => [number, number, number];
    readonly layoutFromRecord: (a: number, b: number) => [number, number, number];
    readonly layoutMarginNotes: (a: any, b: any, c: number) => [number, number, number];
    readonly leaves: (a: any) => [number, number, number];
    readonly levenshtein: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly libraryBibtex: (a: any) => [number, number, number, number];
    readonly libraryPinRowToDomain: (a: any) => [number, number, number];
    readonly linkCitationMentions: (a: any, b: any, c: any) => [number, number, number];
    readonly linkGroupOf: (a: number, b: number) => [number, number, number];
    readonly linkNodeId: (a: any) => [number, number, number];
    readonly lintWiki: (a: any, b: any) => [number, number, number];
    readonly listDisplayColor: (a: any) => [number, number, number, number];
    readonly listMembership: (a: any, b: any) => [number, number, number];
    readonly listMembershipByKey: (a: any, b: any, c: any) => [number, number, number];
    readonly loadOpenGroups: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly localKeys: (a: any) => [number, number, number];
    readonly localSubgraph: (a: number, b: number, c: number, d: any) => [number, number, number];
    readonly locateAnchor: (a: number, b: number, c: any) => [number, number, number];
    readonly locateMention: (a: any, b: number, c: number) => [number, number, number];
    readonly logEntryInputError: (a: any) => [number, number, number, number];
    readonly logEntryMessage: (a: any) => [number, number, number, number];
    readonly logEntryToDomain: (a: any) => [number, number, number];
    readonly logEntryToRow: (a: any) => [number, number, number];
    readonly logEyebrow: (a: any, b: number, c: number) => [number, number, number];
    readonly logPath: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly looksLikeImageUrl: (a: number, b: number) => number;
    readonly looksLikePdfUrl: (a: number, b: number) => number;
    readonly makeInkStroke: (a: any) => [number, number, number];
    readonly mapInkConfidence: (a: number, b: number, c: number) => number;
    readonly markActions: (a: any) => [number, number, number];
    readonly markColourTool: (a: number, b: number) => [number, number];
    readonly markPopoverShown: (a: number, b: number, c: number, d: number) => number;
    readonly markdownImage: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly markdownToLatex: (a: number, b: number, c: any) => [number, number, number];
    readonly matchAuthorYearText: (a: number, b: number, c: any) => [number, number, number];
    readonly matchPageCitations: (a: any, b: any, c: any) => [number, number, number];
    readonly matchVocabulary: (a: number, b: number, c: any) => [number, number, number];
    readonly matchingPageIndices: (a: any, b: number, c: number) => [number, number, number];
    readonly mattermostChannelFor: (a: any, b: any) => [number, number, number, number];
    readonly mattermostConnection: (a: any) => [number, number, number];
    readonly mattermostConnectionReady: (a: any) => [number, number, number];
    readonly mattermostEvents: () => [number, number, number];
    readonly mattermostOptions: (a: any) => [number, number, number];
    readonly maxFusionIds: () => number;
    readonly maxIndexTextUtf16: () => number;
    readonly maxReportChars: () => number;
    readonly maxSignedUrlPaths: () => number;
    readonly mayDriveDevice: (a: number, b: number, c: number, d: number) => number;
    readonly mayOpenExternally: (a: number, b: number) => number;
    readonly mcpFileOf: (a: any) => [number, number, number, number];
    readonly mcpReadResult: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly mcpServersJson: (a: any) => [number, number, number, number];
    readonly meanPressure: (a: number, b: number) => [number, number];
    readonly mediaTypeEssence: (a: number, b: number) => [number, number];
    readonly memberNameMap: (a: any) => [number, number, number];
    readonly memberRank: (a: number, b: number) => number;
    readonly memberRoleLabelOf: (a: any, b: number, c: number) => [number, number, number, number];
    readonly memberRowToDomain: (a: any) => [number, number, number];
    readonly membershipViewFromRow: (a: any) => [number, number, number];
    readonly mentionItemRanges: (a: any, b: number, c: number) => [number, number, number];
    readonly mentionRects: (a: any, b: number, c: number) => [number, number, number];
    readonly mergeBothChanged: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly mergeExtractions: (a: any) => [number, number, number];
    readonly mergeGraphPersistedState: (a: any) => [number, number, number];
    readonly mergeHunks: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly mergePaperInto: (a: any, b: any) => [number, number, number];
    readonly mergeReaderAnnotations: (a: any, b: any) => [number, number, number];
    readonly mergeRows: (a: any, b: any, c: any) => [number, number, number];
    readonly mergeSeenIds: (a: number, b: number, c: number, d: number) => [number, number];
    readonly mergeTemplate: (a: number, b: number, c: number, d: number) => [number, number];
    readonly mergeVaultPage: (a: any, b: any, c: any) => [number, number, number];
    readonly mergeWikiPages: (a: any, b: any) => [number, number, number];
    readonly metadataTitle: (a: number, b: number) => [number, number];
    readonly metricKeys: (a: any) => [number, number, number];
    readonly metricRowToDomain: (a: any) => [number, number, number];
    readonly migratedExpanded: (a: any, b: any) => [number, number, number];
    readonly migratedNotice: (a: number, b: number) => [number, number];
    readonly milestoneFromRow: (a: any) => [number, number, number];
    readonly milestoneInputError: (a: any) => [number, number, number, number];
    readonly milestoneMessage: (a: any) => [number, number, number, number];
    readonly milestoneToRow: (a: any) => [number, number, number];
    readonly milestonesToIcs: (a: any, b: number, c: number, d: number) => [number, number, number, number];
    readonly minArticleTextChars: () => number;
    readonly minPaperTextChars: () => number;
    readonly missingConfigMessage: (a: any, b: any) => [number, number, number];
    readonly missingFigureWarning: (a: number, b: number, c: number, d: number) => [number, number];
    readonly missingPagePlans: (a: any) => [number, number, number];
    readonly missingR2ConfigMessage: (a: any) => [number, number, number];
    readonly modelCacheUrl: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly modesFor: (a: number, b: number) => [number, number, number];
    readonly moveTab: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly movedIds: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly nameOf: (a: any, b: any) => [number, number, number, number];
    readonly nativeCitationMentions: (a: any, b: any, c: any) => [number, number, number];
    readonly needsDisclaimerAcceptance: (a: any) => [number, number, number];
    readonly needsMigrationHint: (a: number, b: number) => number;
    readonly needsOrgSetup: (a: any) => [number, number, number];
    readonly needsStandaloneRoleSync: (a: any, b: any, c: number) => [number, number, number];
    readonly neutraliseContext: (a: number, b: number, c: number, d: number) => [number, number];
    readonly newInkChunkId: (a: number, b: number, c: number) => [number, number, number, number];
    readonly newIssueUrl: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly newestDesktopRelease: (a: any) => [number, number, number];
    readonly newestFirstOrder: (a: any) => [number, number, number];
    readonly nextAuthStep: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number) => [number, number, number];
    readonly nextCitationPageOffset: (a: number, b: any, c: number) => [number, number, number];
    readonly nextManifest: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly nextMatchIndex: (a: number, b: number, c: number) => number;
    readonly nextRotation: (a: number, b: number) => number;
    readonly nibWidth: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly nibfilter_filter: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly nibfilter_new: (a: any, b: any) => [number, number, number];
    readonly nibfilter_reset: (a: number) => void;
    readonly nibfilter_restore: (a: number, b: number) => void;
    readonly nibfilter_save: (a: number) => number;
    readonly nibfilter_speed: (a: number) => number;
    readonly nodeSize: (a: number, b: number, c: number) => [number, number, number];
    readonly normalisePageRotation: (a: number) => number;
    readonly normaliseWhitespace: (a: number, b: number, c: any) => [number, number, number];
    readonly normalizeAiAccessSettings: (a: any) => [number, number, number];
    readonly normalizeAppearance: (a: any) => [number, number, number];
    readonly normalizeArxivId: (a: number, b: number) => [number, number, number, number];
    readonly normalizeColorValue: (a: any) => [number, number];
    readonly normalizeCommentInput: (a: any) => [number, number, number];
    readonly normalizeDoi: (a: number, b: number) => [number, number];
    readonly normalizeFieldName: (a: number, b: number) => [number, number];
    readonly normalizeFontStack: (a: any) => [number, number];
    readonly normalizeGraphViewSettings: (a: any) => [number, number, number];
    readonly normalizeHighlightRects: (a: any) => [number, number, number];
    readonly normalizeLengthValue: (a: any, b: number, c: number) => [number, number];
    readonly normalizeMarkdownImageSyntax: (a: number, b: number) => [number, number, number, number];
    readonly normalizeOrgInviteCode: (a: number, b: number) => [number, number];
    readonly normalizePasteSettings: (a: number, b: number) => [number, number, number];
    readonly normalizeProjectPath: (a: number, b: number) => [number, number];
    readonly normalizeSearchHistory: (a: any, b: number) => [number, number, number, number];
    readonly normalizeSearchSettings: (a: any) => [number, number, number];
    readonly normalizeSelectOptions: (a: number, b: number) => [number, number];
    readonly normalizeShareInput: (a: any) => [number, number, number];
    readonly normalizeTags: (a: number, b: number) => [number, number];
    readonly normalizeThemeConfig: (a: any) => [number, number, number];
    readonly normalizeTitleKey: (a: number, b: number) => [number, number];
    readonly normalizeUserSettings: (a: any) => [number, number, number];
    readonly normalizeVector: (a: number, b: number) => [number, number];
    readonly normalizeZoteroLibrary: (a: any) => [number, number, number];
    readonly noteBacklinks: (a: any, b: number, c: number) => [number, number, number];
    readonly noteTags: (a: any) => [number, number, number, number];
    readonly notesTagged: (a: any, b: any) => [number, number, number];
    readonly noticeFor: (a: any, b: number) => [number, number, number];
    readonly oneEuroAlpha: (a: number, b: number) => number;
    readonly oneeurofilter_filter: (a: number, b: number, c: number) => number;
    readonly oneeurofilter_last: (a: number) => [number, number];
    readonly oneeurofilter_new: (a: any) => [number, number, number];
    readonly oneeurofilter_reset: (a: number) => void;
    readonly oneeurofilter_speed: (a: number) => number;
    readonly openAccessIdsOf: (a: any) => [number, number, number];
    readonly openAlexToHit: (a: any) => [number, number, number];
    readonly openAlexToMetadata: (a: any) => [number, number, number];
    readonly openModeFor: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly openTab: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly openTabKeys: (a: any) => [number, number, number];
    readonly openingTab: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly originalRange: (a: any, b: number, c: number) => [number, number, number];
    readonly outlineFromText: (a: any) => [number, number, number];
    readonly outlineIsPlausible: (a: any, b: number) => [number, number, number];
    readonly outlineItemOf: (a: any, b: number) => [number, number, number];
    readonly outlineItemsFor: (a: any) => [number, number, number];
    readonly outlineOf: (a: number, b: number, c: number) => [number, number, number];
    readonly outlineProgress: (a: any) => [number, number, number];
    readonly outlineTextLines: (a: any) => [number, number, number];
    readonly overleafExternalUrl: (a: number, b: number) => [number, number];
    readonly overleafGitUrl: (a: number, b: number) => [number, number];
    readonly ownedAssetFolderPaths: (a: any) => [number, number, number];
    readonly packInkStroke: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly packVectors: (a: any, b: number, c: number) => [number, number, number, number];
    readonly pageFromChunkBody: (a: number, b: number) => [number, number, number];
    readonly pageImportRefusal: (a: any) => [number, number, number, number];
    readonly pageListProblem: (a: number, b: number, c: number) => [number, number, number];
    readonly pageTextAfterRecognition: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly pageTextFromItems: (a: any) => [number, number, number, number];
    readonly pagesToEvict: (a: any, b: any, c: number) => [number, number, number];
    readonly paintedOrder: (a: any) => [number, number, number];
    readonly paletteModeFor: (a: any) => [number, number, number];
    readonly paperCiteKeys: (a: any) => [number, number, number];
    readonly paperCountsForTags: (a: any, b: any) => [number, number, number];
    readonly paperFieldDefRowToDomain: (a: any) => [number, number, number];
    readonly paperFieldValueRowToDomain: (a: any) => [number, number, number];
    readonly paperHtmlCsp: () => [number, number];
    readonly paperHtmlPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly paperImageThumbnailPath: (a: number, b: number) => [number, number];
    readonly paperPdfPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly paperRelationFromRow: (a: any) => [number, number, number];
    readonly paperRelationInputError: (a: any) => [number, number, number, number];
    readonly paperRelationToRow: (a: any) => [number, number, number];
    readonly paperRowToDomain: (a: any) => [number, number, number];
    readonly paperRowToSummary: (a: any) => [number, number, number];
    readonly paperTagFromRow: (a: any) => [number, number, number];
    readonly paperToBibtex: (a: any, b: number, c: number) => [number, number, number, number];
    readonly paperToRow: (a: any) => [number, number, number];
    readonly parseAppVersion: (a: number, b: number) => [number, number, number];
    readonly parseArtifactRefs: (a: number, b: number) => [number, number, number];
    readonly parseBibEntries: (a: any) => [number, number, number];
    readonly parseBibliography: (a: any, b: number) => [number, number, number];
    readonly parseBibliographyEntry: (a: any, b: number, c: number) => [number, number, number];
    readonly parseBiorxiv: (a: any, b: number, c: number) => [number, number, number];
    readonly parseDashboardLayout: (a: any) => [number, number, number];
    readonly parseDoaj: (a: any) => [number, number, number];
    readonly parseEuropePmc: (a: any) => [number, number, number];
    readonly parseExplorerKeys: (a: number, b: number) => [number, number, number];
    readonly parseExtractionJson: (a: number, b: number) => [number, number, number];
    readonly parseFigureClip: (a: number, b: number) => [number, number, number];
    readonly parseFigureCrop: (a: number, b: number) => [number, number, number];
    readonly parseFigureTokens: (a: number, b: number) => [number, number, number];
    readonly parseFolderDraft: (a: number, b: number) => [number, number, number];
    readonly parseGraphPersistedState: (a: any) => [number, number, number];
    readonly parseHal: (a: any) => [number, number, number];
    readonly parseInkChunkPath: (a: number, b: number) => [number, number, number];
    readonly parseJsonData: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly parseKindSuffix: (a: number, b: number) => [number, number, number];
    readonly parseLatexSectionTree: (a: any, b: number, c: number) => [number, number, number];
    readonly parseLinkRemovalText: (a: number, b: number) => [number, number, number];
    readonly parseMdImageAlt: (a: number, b: number) => [number, number, number];
    readonly parseOpenalex: (a: any) => [number, number, number];
    readonly parseOverleafLinks: (a: number, b: number) => [number, number, number];
    readonly parseOverleafProjectId: (a: number, b: number) => [number, number];
    readonly parsePageList: (a: number, b: number, c: number) => [number, number, number];
    readonly parsePaperFieldValue: (a: any, b: number, c: number) => [number, number, number];
    readonly parsePaperHtmlDocument: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly parsePaperRef: (a: any, b: number, c: number) => [number, number, number];
    readonly parsePlanWidgetBounds: (a: number, b: number) => [number, number, number];
    readonly parseQuery: (a: number, b: number) => [number, number, number];
    readonly parseReaderSplitPane: (a: number, b: number) => [number, number, number];
    readonly parseRegions: (a: number, b: number) => [number, number, number];
    readonly parseReleaseTag: (a: number, b: number) => [number, number, number];
    readonly parseRollupOptions: (a: number, b: number) => [number, number, number];
    readonly parseSemanticScholar: (a: any) => [number, number, number];
    readonly parseStrokeClip: (a: number, b: number) => [number, number, number];
    readonly parseTaskbarCreatedId: (a: number, b: number) => [number, number, number];
    readonly parseThemeConfig: (a: any) => [number, number, number];
    readonly parseUnpaywall: (a: any) => [number, number, number];
    readonly parseWikilinkInner: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly parseWorkspaceFolder: (a: any) => [number, number, number];
    readonly parseZenodo: (a: any) => [number, number, number];
    readonly partitionPdfTexts: (a: any, b: any) => [number, number, number];
    readonly pasteLandsInVerbatimContext: (a: number, b: number, c: number) => [number, number, number];
    readonly pastedFigurePlace: (a: any, b: any, c: any) => [number, number, number];
    readonly pastedStrokesPlace: (a: any, b: any, c: any) => [number, number, number];
    readonly pdfDocId: (a: number, b: number, c: number) => [number, number];
    readonly pdfDocIdsFor: (a: number, b: number, c: number) => [number, number];
    readonly pdfPageHref: (a: number, b: number, c: number) => [number, number];
    readonly pdfPointToScreen: (a: number, b: number, c: any) => [number, number, number];
    readonly pdfRectToScreenBox: (a: number, b: number, c: any) => [number, number, number];
    readonly peersFromUsers: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly pendingFieldFills: (a: any, b: number, c: number) => [number, number, number];
    readonly personalizedPageRank: (a: any, b: number, c: number, d: any, e: any) => [number, number, number];
    readonly pgArray: (a: any) => [number, number, number, number];
    readonly pickKeeper: (a: any) => [number, number, number, number];
    readonly pickKeysToEvict: (a: any, b: number) => [number, number, number];
    readonly pickNearestMatch: (a: any, b: any) => [number, number, number];
    readonly pickProject: (a: any, b: number, c: number) => [number, number, number];
    readonly pickProjectFolder: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly picturePath: (a: any) => [number, number, number];
    readonly pinnedScreenIndex: (a: any) => [number, number, number];
    readonly placeOnSheet: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly placePlanWidget: (a: any, b: any) => [number, number, number];
    readonly planArchiveEntries: (a: any, b: any) => [number, number, number];
    readonly planAssetReanchor: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly planBibImport: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly planBibliographyAnnotations: (a: any, b: any) => [number, number, number];
    readonly planChipTarget: (a: any, b: any, c: any, d: number) => [number, number, number];
    readonly planCitationSegments: (a: any, b: any) => [number, number, number];
    readonly planDelta: (a: any, b: any) => [number, number, number];
    readonly planEmbeddingStart: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly planEyebrow: (a: number, b: number) => [number, number, number];
    readonly planFeedOrigin: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly planFeedUrls: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly planFixOrder: (a: any) => [number, number, number];
    readonly planItemOrder: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly planMirror: (a: any, b: any, c: any, d: any, e: any) => [number, number, number];
    readonly planPace: (a: any, b: number, c: number) => [number, number, number, number];
    readonly planSeriesIngestIndices: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly planTimeline: (a: any, b: number, c: number) => [number, number, number];
    readonly planWidgetData: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly planWikiPages: (a: any) => [number, number, number];
    readonly plotHeight: (a: number, b: number) => number;
    readonly plotTier: (a: number) => [number, number];
    readonly plural: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly pmcCandidates: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pointInArea: (a: any, b: number, c: number) => [number, number, number];
    readonly pointInPolygon: (a: number, b: number, c: number, d: number) => number;
    readonly postgrestErrorInfo: (a: number, b: number) => [number, number, number];
    readonly postgrestKeyedColumnSpec: (a: number, b: number) => [number, number, number];
    readonly postgrestRowSpec: (a: number, b: number) => [number, number, number];
    readonly postgrestWritable: (a: number, b: number, c: any) => [number, number, number];
    readonly preprintServerFor: (a: number, b: number) => [number, number];
    readonly pressureByte: (a: number, b: number) => number;
    readonly previewOpen: (a: any) => [number, number, number];
    readonly previewReaderHref: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly previewSource: (a: any, b: any) => [number, number, number];
    readonly previewTab: () => [number, number, number];
    readonly primaryPaperRef: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly prismaCaveat: (a: any) => [number, number, number, number];
    readonly prismaCounts: (a: any, b: any) => [number, number, number];
    readonly prismaFigureTex: (a: any, b: any) => [number, number, number, number];
    readonly projectDir: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly projectFromRow: (a: any) => [number, number, number];
    readonly projectGateOpen: (a: any, b: any) => [number, number, number];
    readonly projectMetaDir: (a: number, b: number) => [number, number, number, number];
    readonly projectName: (a: number, b: number) => [number, number];
    readonly projectSearchDocuments: (a: any, b: any, c: any) => [number, number, number];
    readonly projectStoredPdfTexts: (a: any, b: any) => [number, number, number];
    readonly projectZoteroAnnotations: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly projectedPageSize: (a: any) => [number, number, number];
    readonly projection: (a: number, b: number) => [number, number, number, number];
    readonly proposalApplies: (a: number, b: number, c: number, d: number) => number;
    readonly pruneLayout: (a: any, b: any) => [number, number, number];
    readonly pushFigureStep: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly pushInkUndo: (a: any, b: any) => [number, number, number];
    readonly quantizeInkPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly queryTermCount: (a: any) => [number, number, number];
    readonly quickOpenResults: (a: any, b: number, c: number) => [number, number, number];
    readonly quoteAwkwardMermaidLabels: (a: number, b: number) => [number, number];
    readonly quoteIdent: (a: number, b: number) => [number, number];
    readonly r2BlobClientConfig: (a: any) => [number, number, number];
    readonly railGroupText: (a: any, b: any, c: any) => [number, number, number];
    readonly rampColour: (a: number) => [number, number];
    readonly rankFilterOrder: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly rankOpenAccessCandidates: (a: any) => [number, number, number];
    readonly readFailureReason: (a: number, b: number, c: number) => [number, number];
    readonly readFrontmatter: (a: number, b: number) => [number, number, number];
    readonly readInkChunkHeader: (a: number, b: number) => [number, number, number];
    readonly readInkNoteBody: (a: number, b: number) => [number, number, number];
    readonly readInkNoteMeta: (a: any) => [number, number, number];
    readonly readInkRequest: (a: any) => [number, number, number];
    readonly readStorageConfig: (a: any) => [number, number, number];
    readonly readableText: (a: number, b: number) => [number, number, number, number];
    readonly readerKeyboardCommand: (a: any) => [number, number, number];
    readonly readerPrintDocument: (a: any) => [number, number, number, number];
    readonly readerPrintOrientation: (a: any) => [number, number, number, number];
    readonly readingListItemToDomain: (a: any) => [number, number, number];
    readonly readingListItemToRow: (a: any) => [number, number, number];
    readonly readingListToDomain: (a: any) => [number, number, number];
    readonly readingListToRow: (a: any) => [number, number, number];
    readonly recentlyApprovedWikiPages: (a: any, b: number) => [number, number, number];
    readonly recolourNodes: (a: any, b: any, c: number, d: number, e: any, f: any) => [number, number, number];
    readonly reconstructLines: (a: number, b: any, c: any) => [number, number, number];
    readonly rectanglesOverlap: (a: number, b: number, c: number, d: number) => number;
    readonly redactOverleafErrorText: (a: number, b: number, c: number, d: number) => [number, number];
    readonly redactReport: (a: number, b: number) => [number, number, number];
    readonly redactReportAndCap: (a: number, b: number, c: number) => [number, number, number];
    readonly redactSecret: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly referenceForDestination: (a: any, b: any) => [number, number, number];
    readonly refreshInkUndoAnnotation: (a: any, b: any) => [number, number, number];
    readonly relatedByPpr: (a: any, b: number, c: number, d: number, e: any, f: any) => [number, number, number];
    readonly relatedConcepts: (a: number, b: number, c: any, d: any, e: number) => [number, number, number];
    readonly relativeAssetPaths: (a: number, b: number) => [number, number, number];
    readonly rememberSearchQuery: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly removeHashtagFromBody: (a: number, b: number, c: number, d: number) => [number, number];
    readonly renameInkUndoId: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly renameSources: (a: any, b: any, c: any) => [number, number, number];
    readonly renamedOutsidePaths: (a: any, b: any) => [number, number, number];
    readonly renderTemplate: (a: number, b: number, c: any) => [number, number, number, number];
    readonly reorderFigureIndices: (a: number, b: number, c: any) => [number, number, number, number];
    readonly reorderedIds: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly replaceVaultAssetPaths: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly replaceWikiIndex: (a: number, b: number, c: number, d: number) => [number, number];
    readonly repoWebUrl: (a: number, b: number) => [number, number];
    readonly reportMarkdown: (a: any) => [number, number, number, number];
    readonly reportSectionInputError: (a: any) => [number, number, number, number];
    readonly resampleInkStroke: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly resizeFigureBox: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly resolveAnnotationConflict: (a: any, b: number, c: number) => [number, number, number];
    readonly resolveArtifactRefsMarkdown: (a: number, b: number, c: any, d: number) => [number, number, number, number];
    readonly resolveArxivId: (a: number, b: number, c: number, d: number) => [number, number];
    readonly resolveCiteKey: (a: any) => [number, number, number, number];
    readonly resolveDisplayRole: (a: number, b: number, c: number, d: number) => [number, number];
    readonly resolveInkPageOrder: (a: any, b: any) => [number, number, number];
    readonly resolveIntegrationConfig: (a: any, b: any) => [number, number, number];
    readonly resolveOrgJoinAssignment: (a: number, b: number, c: any, d: any, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly resolvePaperPdfUrl: (a: any) => [number, number, number, number];
    readonly resolvePositionSelector: (a: number, b: number, c: any) => [number, number, number];
    readonly resolveRelatedPaperUrl: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number];
    readonly resolveSupervisorId: (a: number, b: number) => [number, number];
    readonly resolveTextAnchor: (a: number, b: number, c: any) => [number, number, number];
    readonly resolveViewportScale: (a: any, b: any, c: any) => [number, number, number];
    readonly resolveWithRow: (a: any, b: any, c: any, d: any, e: any) => [number, number, number];
    readonly resourceTypes: () => [number, number, number];
    readonly resultsTable: (a: any) => [number, number, number];
    readonly retrieveAiExcerpts: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly retryFuzzinessForTerm: (a: number, b: number, c: number) => number;
    readonly reviewers: (a: any) => [number, number, number, number];
    readonly rewriteMcpConfig: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly rewriteWikilinks: (a: number, b: number, c: any) => [number, number, number, number];
    readonly roleRank: (a: number, b: number) => number;
    readonly rootFolderIdOf: (a: any) => [number, number, number, number];
    readonly rootKey: (a: any) => [number, number, number];
    readonly rootOf: (a: any) => [number, number, number];
    readonly rootOfKind: (a: number, b: number) => [number, number, number];
    readonly rowSlots: (a: number, b: any, c: any, d: any) => [number, number, number];
    readonly rowsForHeight: (a: number, b: number, c: number) => number;
    readonly s2NestedFields: (a: number, b: number) => [number, number];
    readonly s2PaperId: (a: any) => [number, number, number, number];
    readonly s2ToHit: (a: any) => [number, number, number];
    readonly safeArtifactCaption: (a: number, b: number) => [number, number];
    readonly safeImageDestination: (a: number, b: number) => [number, number];
    readonly safeLabel: (a: number, b: number, c: number, d: number) => [number, number];
    readonly safeName: (a: number, b: number) => [number, number];
    readonly safeRelative: (a: number, b: number) => [number, number, number, number];
    readonly safeWorkspacePath: (a: number, b: number) => [number, number, number, number];
    readonly samePeers: (a: any, b: any) => [number, number, number];
    readonly sameRow: (a: any, b: any) => [number, number, number];
    readonly sameValue: (a: any, b: any) => [number, number, number];
    readonly sanitizeAppHref: (a: number, b: number) => [number, number];
    readonly sanitizePdfUrl: (a: number, b: number) => [number, number];
    readonly sanitizeReaderHref: (a: number, b: number) => [number, number];
    readonly sanitizeSectionTargets: (a: any) => [number, number, number];
    readonly scopeNoteIndices: (a: any, b: number, c: number, d: number, e: number, f: any) => [number, number, number];
    readonly screenForPath: (a: number, b: number) => [number, number];
    readonly screenPointToPdf: (a: number, b: number, c: any) => [number, number, number];
    readonly screeningDecisionError: (a: any, b: any) => [number, number, number, number];
    readonly screeningDecisionFromRow: (a: any) => [number, number, number];
    readonly screeningDecisionToRow: (a: any) => [number, number, number];
    readonly searchRevision: (a: any) => [number, number, number, number];
    readonly searchTextFromItems: (a: any) => [number, number, number];
    readonly sectionProgress: (a: any) => [number, number, number];
    readonly seedDoi: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly seenFiles: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly segmentInkLines: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
    readonly segmentsFor: (a: number, b: number) => [number, number, number];
    readonly selectModelProvider: (a: any, b: number, c: number) => [number, number, number, number];
    readonly selectedPdfPages: (a: number, b: number, c: number) => [number, number, number];
    readonly selectedText: (a: any, b: any) => [number, number, number, number];
    readonly selectionToAnchor: (a: any, b: any) => [number, number, number];
    readonly semanticScholarTarget: (a: number, b: number, c: number, d: number) => [number, number];
    readonly semanticScholarToMetadata: (a: any) => [number, number, number];
    readonly semanticStatusText: (a: any) => [number, number, number, number];
    readonly serialiseArtifactRef: (a: any) => [number, number, number, number];
    readonly serializeWorkspace: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly sessionAction: (a: number, b: number, c: number, d: number) => [number, number];
    readonly setImagePlacement: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number, number, number];
    readonly setRatio: (a: any, b: any, c: number) => [number, number, number];
    readonly setTabMode: (a: any, b: any, c: any) => [number, number, number];
    readonly settleConflictPlan: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly shareAllowsComment: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly shareAllowsEdit: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly shareCoversResource: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly shareFromRow: (a: any) => [number, number, number];
    readonly shareLinkFromRow: (a: any) => [number, number, number];
    readonly shareSupportsEditAccess: (a: any, b: number, c: number) => [number, number, number];
    readonly shareTargets: (a: any, b: any) => [number, number, number];
    readonly sharedItem: (a: any, b: any, c: any) => [number, number, number];
    readonly sharedItemHref: (a: any) => [number, number, number, number];
    readonly sharedItemTypeLabel: (a: any) => [number, number, number, number];
    readonly sharedPaperAnnotationSummary: (a: any) => [number, number, number];
    readonly sharedProviderHint: (a: any, b: any) => [number, number, number];
    readonly sharedReadPlan: (a: any, b: any, c: any) => [number, number, number];
    readonly sharedResourceHref: (a: any, b: number, c: number) => [number, number, number, number];
    readonly shortSha: (a: number, b: number) => [number, number];
    readonly shortcutLabel: (a: number, b: number, c: number) => [number, number];
    readonly shouldAppendInkPoint: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly shouldMountShellChildren: (a: number, b: number, c: number) => number;
    readonly shouldPersistBody: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly shouldPersistIndex: (a: number, b: number) => number;
    readonly shouldRetrySearch: (a: number, b: number) => number;
    readonly shouldShowWorkspaceLoader: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly shouldSyncStandalone: (a: any, b: any) => [number, number, number];
    readonly showConceptEdges: (a: any) => [number, number, number];
    readonly showRelationEdges: (a: any) => [number, number, number];
    readonly simplifyInkPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly simplifyPathIndices: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly siteOf: (a: number, b: number) => [number, number];
    readonly slugFor: (a: number, b: number, c: number, d: number) => [number, number];
    readonly slugSegment: (a: number, b: number) => [number, number];
    readonly smoothInkStroke: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly snapInkShape: (a: number, b: number) => [number, number, number];
    readonly snapToText: (a: any, b: number, c: number) => [number, number, number];
    readonly sortByCitations: (a: any) => [number, number, number];
    readonly sortByDue: (a: any) => [number, number, number];
    readonly sortByReadingOrder: (a: any) => [number, number, number];
    readonly sortHitOrder: (a: any, b: any) => [number, number, number];
    readonly sourceNoteTemplateContext: (a: any) => [number, number, number];
    readonly spanDistance: (a: any, b: any) => [number, number, number];
    readonly spanPoints: (a: any, b: any) => [number, number, number];
    readonly splitBibliographyEntries: (a: any) => [number, number, number];
    readonly splitByAuthorStart: (a: any) => [number, number, number];
    readonly splitByMargins: (a: any) => [number, number, number];
    readonly splitHeadline: (a: number, b: number) => [number, number, number];
    readonly splitInkTextLayer: (a: number, b: number) => [number, number, number];
    readonly splitNumberedEntries: (a: any) => [number, number, number];
    readonly splitOutsideEdits: (a: any) => [number, number, number];
    readonly splitPane: (a: any, b: number, c: number, d: any, e: number, f: number) => [number, number, number];
    readonly splitProposalContent: (a: number, b: number) => [number, number, number];
    readonly splitTopLevel: (a: number, b: number) => [number, number, number];
    readonly stackMarginNotes: (a: any, b: number) => [number, number, number];
    readonly stampWorkspaceId: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly statusPatchForExperiment: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly stepCursor: (a: number, b: number, c: number) => number;
    readonly stepsToPrune: (a: number, b: number) => [number, number];
    readonly streakDays: (a: any, b: number, c: number) => [number, number, number];
    readonly strideForStep: (a: number) => number;
    readonly stripArchiveRoot: (a: any) => [number, number, number];
    readonly stripFrontmatter: (a: number, b: number) => [number, number, number];
    readonly stripInvisible: (a: number, b: number) => [number, number];
    readonly stripKindSuffix: (a: number, b: number) => [number, number, number, number];
    readonly stripRegionMarkers: (a: number, b: number) => [number, number];
    readonly stripStopwords: (a: number, b: number) => [number, number];
    readonly stripUnresolvedImageRefs: (a: number, b: number, c: number, d: number, e: any, f: any) => [number, number, number, number];
    readonly strokeBaseWidth: (a: number, b: number, c: number) => number;
    readonly strokeClipText: (a: any) => [number, number, number, number];
    readonly strokePath: (a: number, b: number) => [number, number];
    readonly studentsOf: (a: number, b: number, c: any) => [number, number, number];
    readonly substituteVariables: (a: number, b: number, c: any) => [number, number, number, number];
    readonly subtreeIds: (a: any) => [number, number, number];
    readonly summarizePdfDrop: (a: any) => [number, number, number];
    readonly surnameKey: (a: number, b: number) => [number, number];
    readonly syncDot: (a: any) => [number, number, number];
    readonly syncFieldShown: (a: number, b: number, c: number) => number;
    readonly syncStrokeSteps: (a: any, b: number) => [number, number, number];
    readonly syncedTables: () => [number, number, number];
    readonly tabAt: (a: any, b: number, c: number, d: number) => [number, number, number];
    readonly tabKey: (a: any) => [number, number, number, number];
    readonly tabMode: (a: any) => [number, number, number];
    readonly tabSeparatedToMarkdownTable: (a: number, b: number) => [number, number, number];
    readonly tagColor: (a: number, b: number) => [number, number];
    readonly tagFromRow: (a: any) => [number, number, number];
    readonly tagToHashtag: (a: number, b: number) => [number, number];
    readonly tagTone: (a: number, b: number) => number;
    readonly takeInkRedo: (a: any) => [number, number, number];
    readonly takeInkUndo: (a: any) => [number, number, number];
    readonly takePageStep: (a: any, b: number, c: number) => [number, number, number];
    readonly texEngineArgs: (a: any, b: number, c: number) => [number, number, number];
    readonly texLogErrors: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly textFingerprint: (a: any) => [number, number, number, number];
    readonly textHash: (a: number, b: number) => [number, number];
    readonly themeConfigTemplate: () => [number, number];
    readonly tickFormat: (a: any) => [number, number, number];
    readonly timelineLaneOffset: (a: number, b: number, c: number) => [number, number];
    readonly timelineMidYear: (a: number, b: number, c: any) => [number, number, number, number];
    readonly titleFixes: (a: any) => [number, number, number];
    readonly titleForPath: (a: number, b: number, c: any) => [number, number, number, number];
    readonly titleFromFileName: (a: number, b: number) => [number, number];
    readonly titleKey: (a: number, b: number) => [number, number];
    readonly titleOf: (a: any) => [number, number, number, number];
    readonly titleSimilarity: (a: number, b: number, c: number, d: number) => number;
    readonly toAnnotationSearchDocs: (a: any, b: any, c: any) => [number, number, number];
    readonly toExtractionResult: (a: any, b: number, c: number) => [number, number, number];
    readonly toPdfSearchDocs: (a: any, b: any) => [number, number, number];
    readonly toRelativeBlobLinks: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly toRenderStrokes: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly toSearchDocs: (a: any, b: any) => [number, number, number];
    readonly toZoteroItem: (a: any) => [number, number, number];
    readonly toZoteroWritePayload: (a: any, b: number, c: number) => [number, number, number];
    readonly toggleExpanded: (a: any, b: number, c: number) => [number, number, number];
    readonly toggleGroup: (a: any, b: number, c: number) => [number, number, number];
    readonly togglePreview: (a: any, b: number, c: number) => [number, number, number];
    readonly toggleSection: (a: any, b: number, c: number) => [number, number, number];
    readonly tokenize: (a: number, b: number, c: any) => [number, number, number];
    readonly toolOwnsThePage: (a: number, b: number) => number;
    readonly trailDiameterPx: (a: number, b: number) => number;
    readonly transformTextOps: (a: any, b: any) => [number, number, number];
    readonly translateInkPaths: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly treePathPairs: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly uncroppedFigureBox: (a: any) => [number, number, number];
    readonly unionRect: (a: any) => [number, number, number];
    readonly uniqueCiteKey: (a: any, b: any) => [number, number, number, number];
    readonly uniqueDeviceName: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly uniqueFigureNameIn: (a: number, b: number, c: any) => [number, number, number, number];
    readonly uniqueTitle: (a: number, b: number, c: number, d: number) => [number, number];
    readonly unpackVectorBlob: (a: number, b: number) => [number, number];
    readonly unpackVectorHead: (a: number, b: number) => [number, number, number];
    readonly untrustedContextRule: () => [number, number];
    readonly urlMetaToMetadata: (a: any) => [number, number, number];
    readonly usableStatus: (a: number) => number;
    readonly userGateOpen: (a: any, b: any) => [number, number, number];
    readonly validateComputeError: (a: any) => [number, number, number, number];
    readonly validateDependenciesError: (a: any) => [number, number, number, number];
    readonly validateNewMember: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number) => [number, number, number];
    readonly validateOrgName: (a: number, b: number) => [number, number, number, number];
    readonly validateSnapshotTitle: (a: number, b: number) => [number, number, number, number];
    readonly vaultAssetPathsInBody: (a: number, b: number) => [number, number];
    readonly vaultBodyPreview: (a: number, b: number, c: number) => [number, number];
    readonly vaultImageMarkdown: (a: number, b: number, c: number, d: number) => [number, number];
    readonly vaultPageBase: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly vaultPageSide: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly vaultPageToDomain: (a: any) => [number, number, number];
    readonly vaultPageToRow: (a: any) => [number, number, number];
    readonly vaultPageToSummaryDomain: (a: any) => [number, number, number];
    readonly vaultRootFromText: (a: number, b: number) => [number, number];
    readonly vectorIndexFromBytes: (a: number, b: number) => [number, number, number];
    readonly vectorindex_add: (a: number, b: any, c: number, d: number) => [number, number];
    readonly vectorindex_allIds: (a: number) => [number, number, number];
    readonly vectorindex_clear: (a: number) => void;
    readonly vectorindex_dimensions: (a: number) => number;
    readonly vectorindex_has: (a: number, b: number, c: number) => number;
    readonly vectorindex_remove: (a: number, b: any) => [number, number];
    readonly vectorindex_search: (a: number, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly vectorindex_size: (a: number) => number;
    readonly vectorindex_toBytes: (a: number) => [number, number];
    readonly vectorindex_vectorOf: (a: number, b: number, c: number) => [number, number];
    readonly verdictFor: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly verdictsFor: (a: any, b: any) => [number, number, number];
    readonly viewableArtifactUrl: (a: number, b: number, c: number) => [number, number];
    readonly visibleRows: (a: any, b: any) => [number, number, number];
    readonly visualPageSize: (a: any, b: number) => [number, number, number];
    readonly vscodeJson: (a: any) => [number, number, number, number];
    readonly walkOverleafSections: (a: any, b: any) => [number, number, number];
    readonly webCacheDocumentLimit: () => number;
    readonly wikiPageRefs: (a: any) => [number, number, number];
    readonly wikiProposalContent: (a: any) => [number, number, number];
    readonly wikiSourceDocuments: (a: any, b: any, c: any) => [number, number, number];
    readonly withActive: (a: any, b: number, c: number) => [number, number, number];
    readonly withImageWidth: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly withInkPageBackground: (a: number, b: number, c: number, d: number) => [number, number];
    readonly withInkPageFigures: (a: number, b: number, c: any) => [number, number, number, number];
    readonly withMdImageAlt: (a: number, b: number, c: any) => [number, number, number, number];
    readonly withMissingFigures: (a: any, b: any) => [number, number, number];
    readonly withStoredHeights: (a: any, b: any, c: any) => [number, number, number];
    readonly withoutExisting: (a: any, b: number, c: number) => [number, number, number];
    readonly withoutGroup: (a: any) => [number, number, number];
    readonly workspaceSnapshotCounts: (a: number, b: number) => [number, number, number];
    readonly wrapRegion: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number, number];
    readonly writeConflictMarkers: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly writeFrontmatter: (a: any, b: number, c: number) => [number, number, number, number];
    readonly writeInkNoteBody: (a: any, b: number, c: number) => [number, number, number, number];
    readonly writeInkNoteMeta: (a: any) => [number, number, number];
    readonly yearColours: (a: any) => [number, number, number];
    readonly yearSpacing: () => number;
    readonly zenodoRecordId: (a: number, b: number) => [number, number];
    readonly zoomIn: (a: number, b: number) => number;
    readonly zoomOut: (a: number, b: number) => number;
    readonly zoteroAnnotationFromItem: (a: any) => [number, number, number];
    readonly zoteroArxivId: (a: any) => [number, number, number];
    readonly zoteroContentKeys: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly zoteroHeaders: (a: number, b: number) => [number, number, number];
    readonly zoteroIsPdfAttachment: (a: any) => [number, number, number];
    readonly zoteroItemKey: (a: any) => [number, number, number];
    readonly zoteroKeyOf: (a: any) => [number, number, number];
    readonly zoteroLibraryUrl: (a: number, b: number, c: number, d: number) => [number, number];
    readonly zoteroLocalApiOff: () => [number, number];
    readonly zoteroLocalStatusMessage: (a: number) => [number, number, number];
    readonly zoteroNoteFromItem: (a: any) => [number, number, number];
    readonly zoteroPickMainPdf: (a: any) => [number, number, number];
    readonly zoteroRemoteToInput: (a: any) => [number, number, number];
    readonly zoteroRemoteToMetadata: (a: any) => [number, number, number];
    readonly zoteroTopLevelPath: (a: number, b: number) => [number, number];
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
