/* tslint:disable */
/* eslint-disable */

/**
 * [`acronyms_for_title`](acronyms::acronyms_for_title) as a JS array of strings.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function acronymsForTitle(title: string): any;

/**
 * [`wf_core::sync::json_entities::add_counts`] for JS.
 *
 * # Errors
 *
 * Fails when either argument is not action counts.
 */
export function addCounts(a: any, b: any): any;

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
 * [`analyze_pdf_document`](document_analysis::analyze_pdf_document) (TS `analyzePdfDocument`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of analysis pages or `outline` not an array of outline items.
 */
export function analyzePdfDocument(pages: any, outline: any): any;

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
 * [`apply_user_integration_fields`](user_settings::apply_user_integration_fields).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON or `fields` is not a string map.
 */
export function applyUserIntegrationFields(settings: any, provider_id: string, fields: any): any;

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
 * [`assemble_page_citations`] (TS `assemblePageCitations`). `candidates` is optional.
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function assemblePageCitations(page: any, native: any, patterns: any, excluded: any, candidates: any): any;

/**
 * [`binomial_smooth`].
 */
export function binomialSmooth(values: Float64Array, stride: number, passes: number): Float64Array;

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
 * [`can_create_role`](member::can_create_role).
 */
export function canCreateRole(creator: string, target: string): boolean;

/**
 * [`can_join_ink_group`]; `group` may be `null`, `windowMs` defaults to 2000.
 */
export function canJoinInkGroup(group: any, next: any, window_ms?: number | null): boolean;

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
 * [`wf_core::papers::open_access::clean_arxiv_id`]: the cleaned arXiv id, or `None`.
 */
export function cleanArxivId(id?: string | null): string | undefined;

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
 * [`clean_wrapped_text`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `options` is not a `WrappedTextOptions` object, or `input` is over the text cap.
 */
export function cleanWrappedText(input: string, options: any): any;

/**
 * [`coalesce_mentions`] (TS `coalesceMentions`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function coalesceMentions(mentions: any, text: string, items: any): any;

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
 * [`create_report_section`](report_section::create_report_section) with the id and time
 * supplied. Call [`report_section_input_error_js`] first: invalid input fails here.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 */
export function createReportSectionWith(input: any, id: string, now_iso: string): any;

/**
 * [`crossref_to_metadata`] (TS `crossrefToMetadata`). A Crossref `message` as a paper.
 *
 * # Errors
 *
 * Fails if `message` is not a Crossref message.
 */
export function crossrefToMetadata(message: any, doi: string): any;

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
 * The default paste settings (TS `DEFAULT_PASTE_SETTINGS`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 */
export function defaultPasteSettings(): any;

/**
 * [`wf_core::sync::git_policy::describe_changes`] for JS, from `[{ state: "added" | "modified" | "deleted" }]`.
 *
 * # Errors
 *
 * Fails when `status` is not that shape.
 */
export function describeChanges(status: any): string;

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
 * [`document_boost`](search_tuning::document_boost). `now` is epoch milliseconds.
 *
 * # Errors
 *
 * Fails if `doc` or `options` has the wrong shape.
 */
export function documentBoost(doc: any, options: any, now: number): number;

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
 * [`encode_locus`] as raw JSON (encode at the URL layer, not here).
 *
 * # Errors
 *
 * Fails if `locus` is not a locus object.
 */
export function encodeLocus(locus: any): string;

/**
 * [`encode_rollup_options`](paper_field::encode_rollup_options) (TS `encodeRollupOptions`).
 *
 * # Errors
 *
 * Fails if `config` is not a rollup config object.
 */
export function encodeRollupOptions(config: any): string[];

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
 * [`exclusion_reasons`](screening::exclusion_reasons) (TS `exclusionReasons`).
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 */
export function exclusionReasons(decisions: any, stage: any): any;

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
 * [`explain_arm`](related::explain_arm).
 *
 * # Errors
 *
 * Fails if `arm` is not a known arm name.
 */
export function explainArm(arm: any): string;

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
 * [`wf_core::papers::page_metadata::extract_page_metadata`]: metadata of a
 * fetched page (`PageMetadata` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails if `html` or `url` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function extractPageMetadata(html: string, url: string): any;

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
 * [`fence_untrusted`](untrusted_context::fence_untrusted).
 *
 * # Errors
 *
 * Fails if `items` is not an array of `{ label, text }` objects.
 */
export function fenceUntrusted(items: any, nonce: string): string;

/**
 * [`filter_lab_members`](member::filter_lab_members). Returns indices into `members`.
 *
 * # Errors
 *
 * Fails if `members` or `options` has the wrong shape.
 */
export function filterLabMembers(viewer_id: string, members: any, options: any): any;

/**
 * [`filter_team_members`](member::filter_team_members). Returns indices into `members`.
 *
 * # Errors
 *
 * Fails if `members` or `options` has the wrong shape.
 */
export function filterTeamMembers(viewer_id: string, members: any, options: any): any;

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
 * [`format_invite_code`](org::format_invite_code).
 */
export function formatInviteCode(raw: string): string;

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
 * [`get_user_integration_field`](integration_credentials::get_user_integration_field);
 * `undefined` when empty.
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 */
export function getUserIntegrationField(settings: any, provider_id: string, field_id: string): any;

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
 * [`group_palette_rows`](palette_groups::group_palette_rows): the headings present, each with the
 * indices of its rows, from the group of each row.
 *
 * # Errors
 *
 * Fails if `groups` has the wrong shape.
 */
export function groupPaletteRows(groups: any): any;

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
 * [`wf_core::storage::blob::guess_blob_content_type`]: MIME type for `path`
 * by its extension.
 *
 * # Errors
 *
 * Fails if `path` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 */
export function guessBlobContentType(path: string): string;

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
 * [`in_reference_list`](analysis_citations::in_reference_list) (TS `inReferenceList`).
 *
 * # Errors
 *
 * Fails if `ranges` is not an array of page text ranges.
 */
export function inReferenceList(page: number, start: number, end: number, ranges: any): boolean;

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
 * [`is_blanket_share`](sharing::is_blanket_share); `null` or `undefined` means every resource.
 */
export function isBlanketShare(resource_id?: string | null): boolean;

/**
 * [`is_bold_font`]; `fontName` may be undefined.
 */
export function isBoldFont(font_name?: string | null): boolean;

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
 * [`is_paper_field_kind`](paper_field::is_paper_field_kind) (TS `isPaperFieldKind`).
 */
export function isPaperFieldKind(value: string): boolean;

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
 * [`is_public_address`](url_safety::is_public_address).
 */
export function isPublicAddress(address: string): boolean;

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
 * [`is_stale_running_experiment`](experiment_status::is_stale_running_experiment); `undefined` last metric time means none.
 *
 * # Errors
 *
 * Fails if `experiment` has the wrong shape.
 */
export function isStaleRunningExperiment(experiment: any, now_ms: number, stale_ms: number, last_metric_at_ms?: number | null): boolean;

/**
 * [`is_supervisor_role`](member::is_supervisor_role).
 */
export function isSupervisorRole(role?: string | null): boolean;

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
 * [`kind_multiplier`](search_settings::kind_multiplier); an unknown `kind` reads as `1`.
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 */
export function kindMultiplier(kind: string, settings: any): number;

/**
 * [`wf_core::papers::open_access::known_candidates`]: the paper's own PDF and page.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function knownCandidates(known_pdf?: string | null, page?: string | null): any;

/**
 * [`labelNumber`](bibliography::label_number): entry number from the exec groups.
 *
 * # Errors
 *
 * Returns an error when `groups` is not an array of strings or `undefined`.
 */
export function labelNumber(groups: any): number;

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
 * [`levenshtein`](analysis_outline::levenshtein) (TS `levenshtein`).
 */
export function levenshtein(a: string, b: string, limit: number): number;

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
 * [`validate_new_log_entry`](log_entry::validate_new_log_entry): the error message, or `None`.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 */
export function logEntryInputError(input: any): string | undefined;

/**
 * [`looks_like_image_url`](wf_core::net::image_url::looks_like_image_url): the URL's own
 * path names a picture, so a pasted link is worth downloading.
 */
export function looksLikeImageUrl(url: string): boolean;

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
 * [`matching_page_indices`](palette_groups::matching_page_indices): the indices of the labels that
 * hold `query`, names that start with it first.
 *
 * # Errors
 *
 * Fails if `query` is too long or `labels` is not an array of strings.
 */
export function matchingPageIndices(labels: any, query: string): any;

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
 * [`mcp_read_result`](mcp_result::mcp_read_result), as a plain JS `McpResult` object.
 *
 * # Errors
 *
 * Fails if `items` is not an array of `{ label, text }` objects.
 */
export function mcpReadResult(items: any, max_item_chars: number | null | undefined, max_result_chars: number | null | undefined, nonce: string): any;

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
 * [`merge_paper_into`] (TS `mergePaperInto`). The kept paper with the duplicate's gaps filled.
 *
 * # Errors
 *
 * Fails if either argument is not a paper, or the result cannot be converted.
 */
export function mergePaperInto(keep: any, dup: any): any;

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
 * [`merge_wiki_pages`](wiki_merge::merge_wiki_pages).
 *
 * # Errors
 *
 * Fails if `primary` or `secondary` is not a `{ id, title, body, aliases?, sources? }` object.
 */
export function mergeWikiPages(primary: any, secondary: any): any;

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
 * [`native_citation_mentions`] (TS `nativeCitationMentions`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 */
export function nativeCitationMentions(page: any, refs: any, excluded: any): any;

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
 * [`openalex_to_metadata`] (TS `openAlexToMetadata`). An OpenAlex work as a paper.
 *
 * # Errors
 *
 * Fails if `work` is not an OpenAlex work.
 */
export function openAlexToMetadata(work: any): any;

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
 * [`outline_text_lines`](analysis_outline::outline_text_lines) (TS `outlineTextLines`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of arrays of text items.
 */
export function outlineTextLines(pages: any): any;

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
 * [`palette_mode_for`](palette_groups::palette_mode_for): the mode a key press opens, or `null`.
 *
 * # Errors
 *
 * Fails if `event` has the wrong shape.
 */
export function paletteModeFor(event: any): any;

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
 * [`wf_core::papers::open_access::parse_doaj`]: DOAJ's answer as candidates.
 *
 * # Errors
 *
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
 * [`parse_paper_field_value`] (TS `parsePaperFieldValue`). A refusal throws an `Error`
 * with the caller's `name` in the message.
 */
export function parsePaperFieldValue(value: any, name: string): any;

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
 * [`personalized_page_rank`](personalized_pagerank::personalized_page_rank); `[{ node, score }]`
 * in first-visit order.
 *
 * # Errors
 *
 * Fails if `graph` or `options` has the wrong shape.
 */
export function personalizedPageRank(graph: any, seed: string, options: any, rng: () => number): any;

/**
 * [`pick_keeper`] (TS `pickKeeper`), returning the kept paper's id.
 *
 * # Errors
 *
 * Fails if `group` is not a list of paper summaries, or it is empty.
 */
export function pickKeeper(group: any): string;

/**
 * [`pick_nearest_match`] as `{ start, end }`, or `null` when there is no match.
 *
 * # Errors
 *
 * Fails if `matches` or `position` has the wrong shape.
 */
export function pickNearestMatch(matches: any, position: any): any;

/**
 * [`plan_bib_import`](bib_import::plan_bib_import) (TS `planBibImport`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function planBibImport(file_name: string, text: string, existing_dois: string[], existing_keys: string[]): any;

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
 * [`wf_core::papers::open_access::pmc_candidates`]: PubMed Central's PDF and HTML copies.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 */
export function pmcCandidates(pmcid: string, license?: string | null): any;

/**
 * [`point_in_polygon`]: is `(x, y)` inside the flat `x, y` polygon.
 */
export function pointInPolygon(polygon: Float64Array, x: number, y: number): boolean;

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
 * [`projected_page_size`] as `{ width, height }` (TS `projectedPageSize`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 */
export function projectedPageSize(p: any): any;

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
 * [`wf_core::papers::open_access::rank_open_access_candidates`]: deduplicated, PDFs first.
 *
 * # Errors
 *
 * Fails if `candidates` is not a candidate list, or the result cannot be converted.
 */
export function rankOpenAccessCandidates(candidates: any): any;

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
 * [`rename_ink_undo_id`](ink_undo::rename_ink_undo_id).
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 */
export function renameInkUndoId(state: any, from: string, to: string): any;

/**
 * [`replace_wiki_index`](wiki_index::replace_wiki_index).
 */
export function replaceWikiIndex(body: string, index: string): string;

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
 * [`resolve_annotation_conflict`] for a row and a choice string (any other choice merges).
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 */
export function resolveAnnotationConflict(row: any, choice: string): any;

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
 * [`resolve_join_assignment`](org::resolve_join_assignment). Returns `{ role, supervisorId }`.
 *
 * # Errors
 *
 * Fails with the message if the lab cannot take this invite type.
 */
export function resolveOrgJoinAssignment(target_role: string, professor_ids: any, phd_ids: any, professor_supervisor_id?: string | null, phd_supervisor_id?: string | null): any;

/**
 * [`resolve_position_selector`] as `{ start, end }`, or `null` when unusable.
 *
 * # Errors
 *
 * Fails if `position` is not a position selector object.
 */
export function resolvePositionSelector(text: string, position: any): any;

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
 * [`retry_fuzziness_for_term`](search_retry::retry_fuzziness_for_term).
 */
export function retryFuzzinessForTerm(term: string, retry: boolean): number;

/**
 * [`safe_label`](untrusted_context::safe_label).
 */
export function safeLabel(label: string, nonce: string): string;

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
 * [`decision_error`](screening::decision_error) (TS `checkDecision`). The message, or
 * `undefined` when the decision may be recorded.
 *
 * # Errors
 *
 * Fails if `next` or `existing` has the wrong shape.
 */
export function screeningDecisionError(next: any, existing: any): string | undefined;

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
 * [`semantic_scholar_to_metadata`] (TS `semanticScholarToMetadata`). A Semantic Scholar paper
 * as a paper.
 *
 * # Errors
 *
 * Fails if `paper` is not a Semantic Scholar paper.
 */
export function semanticScholarToMetadata(paper: any): any;

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
 * [`set_image_placement`](markdown_image_width::set_image_placement): rewrite the `ordinal`-th
 * image whose alt is `alt` to the patched placement.
 *
 * # Errors
 *
 * Fails if `body` or `alt` is too long, or `patch` has the wrong shape.
 */
export function setImagePlacement(body: string, alt: string, ordinal: number, patch: any): string;

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
 * [`share_supports_edit_access`](sharing::share_supports_edit_access).
 *
 * # Errors
 *
 * Fails if `resource_type` is not a shareable type.
 */
export function shareSupportsEditAccess(resource_type: any, resource_id?: string | null): boolean;

/**
 * [`short_sha`](experiment_status::short_sha); `undefined` when absent or empty.
 */
export function shortSha(sha?: string | null): string | undefined;

/**
 * [`should_append_ink_point`]; `minDistance` defaults to 0.75.
 */
export function shouldAppendInkPoint(path: Float64Array, x: number, y: number, min_distance?: number | null): boolean;

/**
 * [`should_retry`](search_retry::should_retry).
 */
export function shouldRetrySearch(result_count: number, term_count: number): boolean;

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
 * [`sort_hit_order`](palette_sort::sort_hit_order): the indices of `rows` in the chosen order.
 *
 * # Errors
 *
 * Fails if `rows` or `order` has the wrong shape.
 */
export function sortHitOrder(rows: any, order: any): any;

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
 * [`splitNumberedEntries`](bibliography::split_numbered_entries): entries by label.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 */
export function splitNumberedEntries(lines: any): any;

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
 * [`students_of`](member::students_of). Returns indices into `team`.
 *
 * # Errors
 *
 * Fails if `team` has the wrong shape.
 */
export function studentsOf(viewer_id: string | null | undefined, team: any): any;

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
 * [`text_fingerprint`](analysis_text::text_fingerprint) (TS `textFingerprint`).
 *
 * # Errors
 *
 * Fails if `texts` is not an array of strings.
 */
export function textFingerprint(texts: any): string;

/**
 * [`theme_config_template`](theme_config::theme_config_template): the starter file.
 */
export function themeConfigTemplate(): string;

/**
 * [`title_fixes`] (TS `titleFixes`). Only papers whose title needs a fix are listed.
 *
 * # Errors
 *
 * Fails if `papers` is not a list of paper summaries, or the result cannot be converted.
 */
export function titleFixes(papers: any): any;

/**
 * [`title_from_file_name`](paper_title::title_from_file_name) (TS `titleFromFileName`).
 */
export function titleFromFileName(title: string): string;

/**
 * [`title_key`](paper_title::title_key) (TS `titleKey`). `None` becomes `undefined` in JS.
 */
export function titleKey(title?: string | null): string | undefined;

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
 * [`unique_cite_key`](cite_key::unique_cite_key) (TS `uniqueCiteKey`). `used` is a JS array of
 * strings; the caller records the returned key.
 *
 * # Errors
 *
 * Fails if `paper` is not an object with a string `id`, or `used` is not an array of strings.
 */
export function uniqueCiteKey(paper: any, used: any): string;

/**
 * [`unique_title`](page::unique_title) (TS `uniqueTitle`). `used` holds normalized keys.
 */
export function uniqueTitle(base: string, used: string[]): string;

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
 * [`verdict_for`](screening::verdict_for) (TS `verdictFor`).
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 */
export function verdictFor(decisions: any, item_id: string, stage: any): any;

/**
 * [`visual_page_size`] as `{ width, height }` (TS `visualPageSize`).
 *
 * # Errors
 *
 * Fails if `page` is not an object with `width` and `height`.
 */
export function visualPageSize(page: any, rotation: number): any;

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
 * [`with_md_image_alt`](markdown_figure_alt::with_md_image_alt): the alt text for a figure's own
 * text and placement.
 *
 * # Errors
 *
 * Fails if `alt` is too long or `placement` has the wrong shape.
 */
export function withMdImageAlt(alt: string, placement: any): string;

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
    readonly acronymsForTitle: (a: number, b: number) => [number, number, number];
    readonly addCounts: (a: any, b: any) => [number, number, number];
    readonly agreementBetween: (a: any, b: any, c: any) => [number, number, number];
    readonly aiReadCategoryForResource: (a: any) => [number, number, number];
    readonly analyzePdfDocument: (a: any, b: any) => [number, number, number];
    readonly applyCommaPlacement: (a: number, b: number, c: any) => [number, number, number];
    readonly applyDelta: (a: any, b: any, c: any) => [number, number, number];
    readonly applyUserIntegrationFields: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly arxivCandidates: (a: number, b: number) => [number, number, number];
    readonly arxivEntryToMetadata: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly assemblePageCitations: (a: any, b: any, c: any, d: any, e: any) => [number, number, number];
    readonly binomialSmooth: (a: number, b: number, c: number, d: number) => [number, number];
    readonly bodyFontSize: (a: any) => [number, number, number];
    readonly bodyLinksTo: (a: number, b: number, c: number, d: number) => number;
    readonly buildAnnotationSortIndex: (a: number, b: number, c: number) => [number, number];
    readonly buildExcerpt: (a: number, b: number, c: any, d: number, e: number) => [number, number, number];
    readonly buildLabSnapshotContent: (a: any) => [number, number, number];
    readonly buildListTree: (a: any) => [number, number, number];
    readonly buildSectionTree: (a: any) => [number, number, number];
    readonly buildWikiGraph: (a: any) => [number, number, number];
    readonly buildWikiIndex: (a: any, b: number, c: number, d: number, e: number) => [number, number, number, number];
    readonly canCreateRole: (a: number, b: number, c: number, d: number) => number;
    readonly canJoinInkGroup: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly cardSnippet: (a: number, b: number, c: number) => [number, number, number, number];
    readonly changedSide: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly checkBibliography: (a: any) => [number, number, number];
    readonly checkUrlShape: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly chooseAnchorStrategy: (a: any, b: number, c: number) => [number, number, number];
    readonly chunkForEmbedding: (a: number, b: number, c: any) => [number, number, number];
    readonly citationItemToRect: (a: any, b: number, c: number) => [number, number, number];
    readonly clampInkNoteWidth: (a: number, b: number, c: number) => number;
    readonly clampInkWidth: (a: number) => number;
    readonly clampInkZoom: (a: number) => number;
    readonly clampPage: (a: number, b: number) => number;
    readonly clampScale: (a: number) => number;
    readonly clampZoomFactor: (a: number, b: number) => number;
    readonly cleanArxivId: (a: number, b: number) => [number, number];
    readonly cleanPastedText: (a: number, b: number, c: any) => [number, number, number];
    readonly cleanPdfText: (a: number, b: number, c: any) => [number, number, number];
    readonly cleanPmcid: (a: number, b: number) => [number, number];
    readonly cleanUrlsWithRules: (a: number, b: number, c: any) => [number, number, number];
    readonly cleanWrappedText: (a: number, b: number, c: any) => [number, number, number];
    readonly coalesceMentions: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly commandMatchIndices: (a: any, b: number, c: number) => [number, number, number];
    readonly compactInkPath: (a: number, b: number, c: any) => [number, number, number, number];
    readonly composeSpacingAccents: (a: number, b: number) => [number, number];
    readonly computeFitPageScale: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly computeFitWidthScale: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly computeRollupsForPapers: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly coreInfo: () => [number, number, number];
    readonly countJsonActions: (a: any) => [number, number, number];
    readonly countWords: (a: number, b: number) => number;
    readonly coveredHitMask: (a: any, b: number, c: number) => [number, number, number];
    readonly coveredTextSpans: (a: any, b: any) => [number, number, number];
    readonly creatableRoles: (a: number, b: number) => [number, number, number];
    readonly createLogEntry: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createMilestoneWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createPaperRelationWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly createReportSectionWith: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly crossrefToMetadata: (a: any, b: number, c: number) => [number, number, number];
    readonly decideAnnotationSync: (a: any, b: number, c: number) => [number, number, number];
    readonly decideGitSyncPath: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly decideVaultCommit: (a: number, b: any) => [number, number, number];
    readonly decodeInkWords: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly decodeLocus: (a: number, b: number) => [number, number, number];
    readonly defaultGraphSettings: () => [number, number, number];
    readonly defaultInkNoteMeta: () => [number, number, number];
    readonly defaultPasteSettings: () => [number, number, number];
    readonly describeChanges: (a: any) => [number, number, number, number];
    readonly describePull: (a: any) => [number, number, number, number];
    readonly describePush: (a: any) => [number, number, number, number];
    readonly detectCitationStyle: (a: any) => [number, number, number];
    readonly detectColumns: (a: any) => [number, number, number];
    readonly diffAnnotationFields: (a: any) => [number, number, number];
    readonly diffBody: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly diffJsonData: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly diffWorkspace: (a: any, b: any, c: any) => [number, number, number];
    readonly documentBoost: (a: any, b: any, c: number) => [number, number, number];
    readonly effectiveFieldBoosts: (a: any) => [number, number, number];
    readonly effectiveRelationTypes: (a: any) => [number, number, number];
    readonly encodeLocus: (a: any) => [number, number, number, number];
    readonly encodeRollupOptions: (a: any) => [number, number, number, number];
    readonly entityDir: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly escapeLatexText: (a: number, b: number) => [number, number];
    readonly evaluateAiAccess: (a: any, b: number, c: number) => [number, number, number];
    readonly exclusionReasons: (a: any, b: any) => [number, number, number];
    readonly expandIpv6: (a: number, b: number) => [number, number, number];
    readonly experimentActivityAt: (a: any) => [number, number, number];
    readonly explainArm: (a: any) => [number, number, number, number];
    readonly extractDoi: (a: number, b: number) => [number, number, number, number];
    readonly extractHashtagRefs: (a: number, b: number) => [number, number, number];
    readonly extractHashtags: (a: number, b: number) => [number, number];
    readonly extractPageMetadata: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly extractVenue: (a: number, b: number) => [number, number];
    readonly extractWikilinks: (a: number, b: number) => [number, number, number];
    readonly fenceUntrusted: (a: any, b: number, c: number) => [number, number, number, number];
    readonly filterLabMembers: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly filterTeamMembers: (a: number, b: number, c: any, d: any) => [number, number, number];
    readonly findCitationCandidates: (a: any) => [number, number, number];
    readonly findDocumentMatches: (a: any, b: number, c: number) => [number, number, number];
    readonly findDuplicateGroups: (a: any) => [number, number, number];
    readonly findFigureMentions: (a: any, b: any) => [number, number, number];
    readonly findHeadingLines: (a: any, b: number, c: any) => [number, number, number];
    readonly findPatternCitationMentions: (a: any, b: any, c: any, d: any) => [number, number, number];
    readonly findQuoteMatches: (a: number, b: number, c: any) => [number, number, number];
    readonly findReferenceSection: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly fontSizeOf: (a: any) => [number, number, number];
    readonly forgetSearchQuery: (a: number, b: number, c: number, d: number) => [number, number];
    readonly formatCitation: (a: number, b: number, c: number, d: number) => [number, number];
    readonly formatInviteCode: (a: number, b: number) => [number, number];
    readonly formatMetricCell: (a: number, b: number, c: any) => [number, number, number, number];
    readonly formatMetricValue: (a: number, b: number, c: number) => [number, number];
    readonly formatPaperCitation: (a: any, b: number, c: number) => [number, number, number, number];
    readonly fromRelativeBlobLinks: (a: number, b: number, c: any) => [number, number, number, number];
    readonly furnitureKey: (a: number, b: number) => [number, number];
    readonly furnitureLines: (a: any) => [number, number, number];
    readonly fuseRankings: (a: any, b: number, c: number) => [number, number, number];
    readonly fuzzinessForTerm: (a: number, b: number) => number;
    readonly gateVectorMask: (a: any, b: number, c: number) => [number, number, number];
    readonly getUserIntegrationField: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly graphDegrees: (a: any) => [number, number, number];
    readonly graphDensity: (a: any) => [number, number, number];
    readonly graphFilterCountFor: (a: number, b: number, c: any) => [number, number, number];
    readonly groupPaletteRows: (a: any) => [number, number, number];
    readonly groupRecurringLines: (a: any, b: any) => [number, number, number];
    readonly guessBlobContentType: (a: number, b: number) => [number, number, number, number];
    readonly hasActiveLab: (a: number, b: number, c: any, d: number) => [number, number, number];
    readonly hasConflictMarkers: (a: number, b: number) => [number, number, number];
    readonly headingOutline: (a: any) => [number, number, number];
    readonly headingSlug: (a: number, b: number) => [number, number];
    readonly hydrateUserSettings: (a: any) => [number, number, number];
    readonly idSuffix: (a: number, b: number) => [number, number, number, number];
    readonly imageAltFromFilename: (a: number, b: number) => [number, number, number, number];
    readonly imageExtensionForMime: (a: number, b: number) => [number, number, number, number];
    readonly imagePathsInBody: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly inReferenceList: (a: number, b: number, c: number, d: any) => [number, number, number];
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
    readonly integrationsBagFromLegacy: (a: any) => [number, number, number];
    readonly invalidationMap: () => [number, number, number];
    readonly invalidationPlan: (a: number, b: number) => [number, number, number];
    readonly isAnnotationSyncState: (a: any) => number;
    readonly isAppOwnedPath: (a: number, b: number) => [number, number, number];
    readonly isBibliographicMatch: (a: any, b: any) => [number, number, number];
    readonly isBlanketShare: (a: number, b: number) => number;
    readonly isBoldFont: (a: number, b: number) => number;
    readonly isCitationDestination: (a: any) => [number, number, number];
    readonly isConferenceCopy: (a: any) => [number, number, number];
    readonly isEmptyPaperSummary: (a: number, b: number) => number;
    readonly isExplicitLabMembership: (a: any) => [number, number, number];
    readonly isHighlighterInk: (a: number, b: number) => number;
    readonly isInkChunkId: (a: number, b: number) => [number, number, number];
    readonly isInkNoteBody: (a: number, b: number) => [number, number, number];
    readonly isIpAddress: (a: number, b: number) => number;
    readonly isIsoDay: (a: number, b: number) => number;
    readonly isKnownResourceType: (a: number, b: number) => number;
    readonly isPaperFieldKind: (a: number, b: number) => number;
    readonly isPlaceholderTitle: (a: number, b: number) => number;
    readonly isPreviewKey: (a: any, b: number) => [number, number, number];
    readonly isPublicAddress: (a: number, b: number) => number;
    readonly isQuotationType: (a: number, b: number) => number;
    readonly isReaderAnnotationType: (a: any) => number;
    readonly isRotatedText: (a: number, b: number) => number;
    readonly isSafeWorkspacePath: (a: number, b: number) => [number, number, number];
    readonly isStaleRunningExperiment: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly isSupervisorRole: (a: number, b: number) => number;
    readonly isUnderIgnoredFolder: (a: number, b: number) => [number, number, number];
    readonly isUnsureConfidence: (a: number) => number;
    readonly isUserIntegrationConnected: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly isZoteroLibrarySyncMode: (a: any) => number;
    readonly itemToRect: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly jsonDataPath: (a: number, b: number, c: any) => [number, number, number, number];
    readonly jsonKindOfPath: (a: number, b: number) => [number, number, number, number];
    readonly kindMultiplier: (a: number, b: number, c: any) => [number, number, number];
    readonly knownCandidates: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly labelNumber: (a: any) => [number, number, number];
    readonly ladderOrder: (a: any) => [number, number, number];
    readonly latestByReviewerList: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly levenshtein: (a: number, b: number, c: number, d: number, e: number) => number;
    readonly linkCitationMentions: (a: any, b: any, c: any) => [number, number, number];
    readonly logEntryInputError: (a: any) => [number, number, number, number];
    readonly looksLikeImageUrl: (a: number, b: number) => number;
    readonly mapInkConfidence: (a: number, b: number, c: number) => number;
    readonly markdownImage: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly markdownToLatex: (a: number, b: number, c: any) => [number, number, number];
    readonly matchAuthorYearText: (a: number, b: number, c: any) => [number, number, number];
    readonly matchPageCitations: (a: any, b: any, c: any) => [number, number, number];
    readonly matchingPageIndices: (a: any, b: number, c: number) => [number, number, number];
    readonly maxFusionIds: () => number;
    readonly maxIndexTextUtf16: () => number;
    readonly mcpReadResult: (a: any, b: number, c: number, d: number, e: number, f: number, g: number) => [number, number, number];
    readonly meanPressure: (a: number, b: number) => [number, number];
    readonly mentionRects: (a: any, b: number, c: number) => [number, number, number];
    readonly mergeHunks: (a: number, b: number, c: number, d: number, e: any) => [number, number, number, number];
    readonly mergePaperInto: (a: any, b: any) => [number, number, number];
    readonly mergeRows: (a: any, b: any, c: any) => [number, number, number];
    readonly mergeVaultPage: (a: any, b: any, c: any) => [number, number, number];
    readonly mergeWikiPages: (a: any, b: any) => [number, number, number];
    readonly milestoneInputError: (a: any) => [number, number, number, number];
    readonly nativeCitationMentions: (a: any, b: any, c: any) => [number, number, number];
    readonly needsOrgSetup: (a: any) => [number, number, number];
    readonly needsStandaloneRoleSync: (a: any, b: any, c: number) => [number, number, number];
    readonly neutraliseContext: (a: number, b: number, c: number, d: number) => [number, number];
    readonly nextMatchIndex: (a: number, b: number, c: number) => number;
    readonly nextRotation: (a: number, b: number) => number;
    readonly nibWidth: (a: number, b: number, c: number, d: number, e: number, f: number, g: number) => number;
    readonly normalisePageRotation: (a: number) => number;
    readonly normaliseWhitespace: (a: number, b: number, c: any) => [number, number, number];
    readonly normalizeAiAccessSettings: (a: any) => [number, number, number];
    readonly normalizeAppearance: (a: any) => [number, number, number];
    readonly normalizeArxivId: (a: number, b: number) => [number, number, number, number];
    readonly normalizeColorValue: (a: any) => [number, number];
    readonly normalizeCommentInput: (a: any) => [number, number, number];
    readonly normalizeDoi: (a: number, b: number) => [number, number];
    readonly normalizeFontStack: (a: any) => [number, number];
    readonly normalizeGraphViewSettings: (a: any) => [number, number, number];
    readonly normalizeLengthValue: (a: any, b: number, c: number) => [number, number];
    readonly normalizeMarkdownImageSyntax: (a: number, b: number) => [number, number, number, number];
    readonly normalizeOrgInviteCode: (a: number, b: number) => [number, number];
    readonly normalizePasteSettings: (a: number, b: number) => [number, number, number];
    readonly normalizeProjectPath: (a: number, b: number) => [number, number];
    readonly normalizeSearchHistory: (a: any, b: number) => [number, number, number, number];
    readonly normalizeSearchSettings: (a: any) => [number, number, number];
    readonly normalizeShareInput: (a: any) => [number, number, number];
    readonly normalizeTags: (a: number, b: number) => [number, number];
    readonly normalizeThemeConfig: (a: any) => [number, number, number];
    readonly normalizeTitleKey: (a: number, b: number) => [number, number];
    readonly normalizeUserSettings: (a: any) => [number, number, number];
    readonly normalizeVector: (a: number, b: number) => [number, number];
    readonly openAlexToMetadata: (a: any) => [number, number, number];
    readonly originalRange: (a: any, b: number, c: number) => [number, number, number];
    readonly outlineFromText: (a: any) => [number, number, number];
    readonly outlineIsPlausible: (a: any, b: number) => [number, number, number];
    readonly outlineItemOf: (a: any, b: number) => [number, number, number];
    readonly outlineTextLines: (a: any) => [number, number, number];
    readonly packInkStroke: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly pageImportRefusal: (a: any) => [number, number, number, number];
    readonly pageTextFromItems: (a: any) => [number, number, number, number];
    readonly paletteModeFor: (a: any) => [number, number, number];
    readonly paperRelationInputError: (a: any) => [number, number, number, number];
    readonly parseBibEntries: (a: any) => [number, number, number];
    readonly parseBibliography: (a: any, b: number) => [number, number, number];
    readonly parseBibliographyEntry: (a: any, b: number, c: number) => [number, number, number];
    readonly parseBiorxiv: (a: any, b: number, c: number) => [number, number, number];
    readonly parseDashboardLayout: (a: any) => [number, number, number];
    readonly parseDoaj: (a: any) => [number, number, number];
    readonly parseEuropePmc: (a: any) => [number, number, number];
    readonly parseGraphPersistedState: (a: any) => [number, number, number];
    readonly parseHal: (a: any) => [number, number, number];
    readonly parseJsonData: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly parseLinkRemovalText: (a: number, b: number) => [number, number, number];
    readonly parseMdImageAlt: (a: number, b: number) => [number, number, number];
    readonly parseOpenalex: (a: any) => [number, number, number];
    readonly parsePaperFieldValue: (a: any, b: number, c: number) => [number, number, number];
    readonly parsePaperRef: (a: any, b: number, c: number) => [number, number, number];
    readonly parseQuery: (a: number, b: number) => [number, number, number];
    readonly parseRollupOptions: (a: number, b: number) => [number, number, number];
    readonly parseSemanticScholar: (a: any) => [number, number, number];
    readonly parseThemeConfig: (a: any) => [number, number, number];
    readonly parseUnpaywall: (a: any) => [number, number, number];
    readonly parseWikilinkInner: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly parseWorkspaceFolder: (a: any) => [number, number, number];
    readonly parseZenodo: (a: any) => [number, number, number];
    readonly pasteLandsInVerbatimContext: (a: number, b: number, c: number) => [number, number, number];
    readonly pdfPointToScreen: (a: number, b: number, c: any) => [number, number, number];
    readonly pdfRectToScreenBox: (a: number, b: number, c: any) => [number, number, number];
    readonly personalizedPageRank: (a: any, b: number, c: number, d: any, e: any) => [number, number, number];
    readonly pickKeeper: (a: any) => [number, number, number, number];
    readonly pickNearestMatch: (a: any, b: any) => [number, number, number];
    readonly planBibImport: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly planDelta: (a: any, b: any) => [number, number, number];
    readonly planMirror: (a: any, b: any, c: any, d: any, e: any) => [number, number, number];
    readonly pmcCandidates: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly pointInPolygon: (a: number, b: number, c: number, d: number) => number;
    readonly prismaCaveat: (a: any) => [number, number, number, number];
    readonly prismaCounts: (a: any, b: any) => [number, number, number];
    readonly prismaFigureTex: (a: any, b: any) => [number, number, number, number];
    readonly projectDir: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly projectMetaDir: (a: number, b: number) => [number, number, number, number];
    readonly projectName: (a: number, b: number) => [number, number];
    readonly projectedPageSize: (a: any) => [number, number, number];
    readonly pushInkUndo: (a: any, b: any) => [number, number, number];
    readonly quantizeInkPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly queryTermCount: (a: any) => [number, number, number];
    readonly rankOpenAccessCandidates: (a: any) => [number, number, number];
    readonly readFrontmatter: (a: number, b: number) => [number, number, number];
    readonly readInkNoteBody: (a: number, b: number) => [number, number, number];
    readonly readableText: (a: number, b: number) => [number, number, number, number];
    readonly readerKeyboardCommand: (a: any) => [number, number, number];
    readonly reconstructLines: (a: number, b: any, c: any) => [number, number, number];
    readonly rectanglesOverlap: (a: number, b: number, c: number, d: number) => number;
    readonly redactSecret: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly referenceForDestination: (a: any, b: any) => [number, number, number];
    readonly refreshInkUndoAnnotation: (a: any, b: any) => [number, number, number];
    readonly relatedByPpr: (a: any, b: number, c: number, d: number, e: any, f: any) => [number, number, number];
    readonly relativeAssetPaths: (a: number, b: number) => [number, number, number];
    readonly rememberSearchQuery: (a: number, b: number, c: number, d: number, e: number) => [number, number];
    readonly renameInkUndoId: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly replaceWikiIndex: (a: number, b: number, c: number, d: number) => [number, number];
    readonly reportSectionInputError: (a: any) => [number, number, number, number];
    readonly resampleInkStroke: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly resolveAnnotationConflict: (a: any, b: number, c: number) => [number, number, number];
    readonly resolveArxivId: (a: number, b: number, c: number, d: number) => [number, number];
    readonly resolveCiteKey: (a: any) => [number, number, number, number];
    readonly resolveDisplayRole: (a: number, b: number, c: number, d: number) => [number, number];
    readonly resolveOrgJoinAssignment: (a: number, b: number, c: any, d: any, e: number, f: number, g: number, h: number) => [number, number, number];
    readonly resolvePositionSelector: (a: number, b: number, c: any) => [number, number, number];
    readonly resolveSupervisorId: (a: number, b: number) => [number, number];
    readonly resolveTextAnchor: (a: number, b: number, c: any) => [number, number, number];
    readonly resolveViewportScale: (a: any, b: any, c: any) => [number, number, number];
    readonly retryFuzzinessForTerm: (a: number, b: number, c: number) => number;
    readonly safeLabel: (a: number, b: number, c: number, d: number) => [number, number];
    readonly safeWorkspacePath: (a: number, b: number) => [number, number, number, number];
    readonly sameValue: (a: any, b: any) => [number, number, number];
    readonly screenPointToPdf: (a: number, b: number, c: any) => [number, number, number];
    readonly screeningDecisionError: (a: any, b: any) => [number, number, number, number];
    readonly searchTextFromItems: (a: any) => [number, number, number];
    readonly segmentInkLines: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: number) => [number, number, number];
    readonly selectionToAnchor: (a: any, b: any) => [number, number, number];
    readonly semanticScholarToMetadata: (a: any) => [number, number, number];
    readonly serializeWorkspace: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly setImagePlacement: (a: number, b: number, c: number, d: number, e: number, f: any) => [number, number, number, number];
    readonly shareAllowsComment: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly shareAllowsEdit: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly shareCoversResource: (a: any, b: any, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly shareSupportsEditAccess: (a: any, b: number, c: number) => [number, number, number];
    readonly shortSha: (a: number, b: number) => [number, number];
    readonly shouldAppendInkPoint: (a: number, b: number, c: number, d: number, e: number, f: number) => number;
    readonly shouldRetrySearch: (a: number, b: number) => number;
    readonly shouldSyncStandalone: (a: any, b: any) => [number, number, number];
    readonly showConceptEdges: (a: any) => [number, number, number];
    readonly showRelationEdges: (a: any) => [number, number, number];
    readonly simplifyInkPath: (a: number, b: number, c: number, d: number) => [number, number];
    readonly simplifyPathIndices: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly smoothInkStroke: (a: number, b: number, c: number, d: number, e: any) => [number, number, number];
    readonly sortByReadingOrder: (a: any) => [number, number, number];
    readonly sortHitOrder: (a: any, b: any) => [number, number, number];
    readonly splitBibliographyEntries: (a: any) => [number, number, number];
    readonly splitByAuthorStart: (a: any) => [number, number, number];
    readonly splitByMargins: (a: any) => [number, number, number];
    readonly splitNumberedEntries: (a: any) => [number, number, number];
    readonly stampWorkspaceId: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly statusPatchForExperiment: (a: any, b: any, c: number, d: number) => [number, number, number];
    readonly stripFrontmatter: (a: number, b: number) => [number, number, number];
    readonly stripInvisible: (a: number, b: number) => [number, number];
    readonly stripKindSuffix: (a: number, b: number) => [number, number, number, number];
    readonly stripStopwords: (a: number, b: number) => [number, number];
    readonly stripUnresolvedImageRefs: (a: number, b: number, c: number, d: number, e: any, f: any) => [number, number, number, number];
    readonly strokeBaseWidth: (a: number, b: number, c: number) => number;
    readonly studentsOf: (a: number, b: number, c: any) => [number, number, number];
    readonly surnameKey: (a: number, b: number) => [number, number];
    readonly tabSeparatedToMarkdownTable: (a: number, b: number) => [number, number, number];
    readonly tagTone: (a: number, b: number) => number;
    readonly takeInkRedo: (a: any) => [number, number, number];
    readonly takeInkUndo: (a: any) => [number, number, number];
    readonly textFingerprint: (a: any) => [number, number, number, number];
    readonly themeConfigTemplate: () => [number, number];
    readonly titleFixes: (a: any) => [number, number, number];
    readonly titleFromFileName: (a: number, b: number) => [number, number];
    readonly titleKey: (a: number, b: number) => [number, number];
    readonly titleSimilarity: (a: number, b: number, c: number, d: number) => number;
    readonly toRelativeBlobLinks: (a: number, b: number, c: number, d: number) => [number, number, number];
    readonly toZoteroItem: (a: any) => [number, number, number];
    readonly toZoteroWritePayload: (a: any, b: number, c: number) => [number, number, number];
    readonly tokenize: (a: number, b: number, c: any) => [number, number, number];
    readonly translateInkPaths: (a: any, b: number, c: number, d: number, e: number) => [number, number, number];
    readonly uniqueCiteKey: (a: any, b: any) => [number, number, number, number];
    readonly uniqueTitle: (a: number, b: number, c: number, d: number) => [number, number];
    readonly untrustedContextRule: () => [number, number];
    readonly urlMetaToMetadata: (a: any) => [number, number, number];
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
    readonly verdictFor: (a: any, b: number, c: number, d: any) => [number, number, number];
    readonly visualPageSize: (a: any, b: number) => [number, number, number];
    readonly withImageWidth: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly withMdImageAlt: (a: number, b: number, c: any) => [number, number, number, number];
    readonly workspaceSnapshotCounts: (a: number, b: number) => [number, number, number];
    readonly writeConflictMarkers: (a: number, b: number, c: number, d: number) => [number, number, number, number];
    readonly writeFrontmatter: (a: any, b: number, c: number) => [number, number, number, number];
    readonly writeInkNoteBody: (a: any, b: number, c: number) => [number, number, number, number];
    readonly zoomIn: (a: number, b: number) => number;
    readonly zoomOut: (a: number, b: number) => number;
    readonly zoteroArxivId: (a: any) => [number, number, number];
    readonly zoteroContentKeys: (a: number, b: number, c: number, d: number, e: number, f: number) => [number, number, number];
    readonly zoteroRemoteToInput: (a: any) => [number, number, number];
    readonly zoteroRemoteToMetadata: (a: any) => [number, number, number];
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
