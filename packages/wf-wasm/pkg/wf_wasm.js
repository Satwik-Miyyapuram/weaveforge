/* @ts-self-types="./wf_wasm.d.ts" */

/**
 * [`acronyms_for_title`](acronyms::acronyms_for_title) as a JS array of strings.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string} title
 * @returns {any}
 */
export function acronymsForTitle(title) {
    const ptr0 = passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.acronymsForTitle(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::json_entities::add_counts`] for JS.
 *
 * # Errors
 *
 * Fails when either argument is not action counts.
 * @param {any} a
 * @param {any} b
 * @returns {any}
 */
export function addCounts(a, b) {
    const ret = wasm.addCounts(a, b);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`agreement_between`](screening::agreement_between) (TS `agreementBetween`).
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 * @param {any} decisions
 * @param {any} reviewers
 * @param {any} stage
 * @returns {any}
 */
export function agreementBetween(decisions, reviewers, stage) {
    const ret = wasm.agreementBetween(decisions, reviewers, stage);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`ai_read_category_for_resource`](access_policy::ai_read_category_for_resource).
 *
 * # Errors
 *
 * Fails if `resourceType` is not a known resource type.
 * @param {any} resource_type
 * @returns {any}
 */
export function aiReadCategoryForResource(resource_type) {
    const ret = wasm.aiReadCategoryForResource(resource_type);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`analyze_pdf_document`](document_analysis::analyze_pdf_document) (TS `analyzePdfDocument`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of analysis pages or `outline` not an array of outline items.
 * @param {any} pages
 * @param {any} outline
 * @returns {any}
 */
export function analyzePdfDocument(pages, outline) {
    const ret = wasm.analyzePdfDocument(pages, outline);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`apply_comma_placement`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `placement` is not `"inside"` or `"outside"`, or `input` is over the text cap.
 * @param {string} input
 * @param {any} placement
 * @returns {any}
 */
export function applyCommaPlacement(input, placement) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.applyCommaPlacement(ptr0, len0, placement);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::snapshot_delta::apply_delta`] for JS over rows that carry an `id`.
 * `order` is `{ id, updatedAt }[]`; the result follows it.
 *
 * # Errors
 *
 * Fails when an argument does not have the expected shape.
 * @param {any} held
 * @param {any} fetched
 * @param {any} order
 * @returns {any}
 */
export function applyDelta(held, fetched, order) {
    const ret = wasm.applyDelta(held, fetched, order);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`apply_user_integration_fields`](user_settings::apply_user_integration_fields).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON or `fields` is not a string map.
 * @param {any} settings
 * @param {string} provider_id
 * @param {any} fields
 * @returns {any}
 */
export function applyUserIntegrationFields(settings, provider_id, fields) {
    const ptr0 = passStringToWasm0(provider_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.applyUserIntegrationFields(settings, ptr0, len0, fields);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`assemble_page_citations`] (TS `assemblePageCitations`). `candidates` is optional.
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 * @param {any} page
 * @param {any} native
 * @param {any} patterns
 * @param {any} excluded
 * @param {any} candidates
 * @returns {any}
 */
export function assemblePageCitations(page, native, patterns, excluded, candidates) {
    const ret = wasm.assemblePageCitations(page, native, patterns, excluded, candidates);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`binomial_smooth`].
 * @param {Float64Array} values
 * @param {number} stride
 * @param {number} passes
 * @returns {Float64Array}
 */
export function binomialSmooth(values, stride, passes) {
    const ptr0 = passArrayF64ToWasm0(values, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.binomialSmooth(ptr0, len0, stride, passes);
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * [`body_font_size`](analysis_outline::body_font_size) (TS `bodyFontSize`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of arrays of text items.
 * @param {any} pages
 * @returns {number}
 */
export function bodyFontSize(pages) {
    const ret = wasm.bodyFontSize(pages);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`body_links_to`](page::body_links_to) (TS `bodyLinksTo`).
 * @param {string} body
 * @param {string} target_key
 * @returns {boolean}
 */
export function bodyLinksTo(body, target_key) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(target_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.bodyLinksTo(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * [`build_annotation_sort_index`] (TS `buildAnnotationSortIndex`).
 * @param {number} page_index
 * @param {number} char_offset
 * @param {number} top_pdf_units
 * @returns {string}
 */
export function buildAnnotationSortIndex(page_index, char_offset, top_pdf_units) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.buildAnnotationSortIndex(page_index, char_offset, top_pdf_units);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

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
 * @param {string} body
 * @param {any} terms
 * @param {number | null} [max_chars]
 * @param {boolean | null} [single_line]
 * @returns {any}
 */
export function buildExcerpt(body, terms, max_chars, single_line) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.buildExcerpt(ptr0, len0, terms, isLikeNone(max_chars) ? Number.MAX_SAFE_INTEGER : (max_chars) >>> 0, isLikeNone(single_line) ? 0xFFFFFF : single_line ? 1 : 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`build_lab_snapshot_content`](lab_snapshot::build_lab_snapshot_content).
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 * @param {any} input
 * @returns {any}
 */
export function buildLabSnapshotContent(input) {
    const ret = wasm.buildLabSnapshotContent(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`build_list_tree`](reading_list::build_list_tree).
 *
 * # Errors
 *
 * Fails if `lists` has the wrong shape.
 * @param {any} lists
 * @returns {any}
 */
export function buildListTree(lists) {
    const ret = wasm.buildListTree(lists);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`build_section_tree`](report_section::build_section_tree) (TS `buildSectionTree`).
 *
 * # Errors
 *
 * Fails if `sections` is not a list of sections.
 * @param {any} sections
 * @returns {any}
 */
export function buildSectionTree(sections) {
    const ret = wasm.buildSectionTree(sections);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`build_wiki_graph`](wiki_graph::build_wiki_graph).
 *
 * # Errors
 *
 * Fails if `snapshot` has the wrong shape.
 * @param {any} snapshot
 * @returns {any}
 */
export function buildWikiGraph(snapshot) {
    const ret = wasm.buildWikiGraph(snapshot);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`build_wiki_index`](wiki_index::build_wiki_index); `heading` defaults to `Index` when `undefined`.
 *
 * # Errors
 *
 * Fails if `pages` is not an array of `{ title, aliases? }` objects.
 * @param {any} pages
 * @param {string | null | undefined} heading
 * @param {string} generated_at
 * @returns {string}
 */
export function buildWikiIndex(pages, heading, generated_at) {
    let deferred4_0;
    let deferred4_1;
    try {
        var ptr0 = isLikeNone(heading) ? 0 : passStringToWasm0(heading, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(generated_at, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.buildWikiIndex(pages, ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * [`can_create_role`](member::can_create_role).
 * @param {string} creator
 * @param {string} target
 * @returns {boolean}
 */
export function canCreateRole(creator, target) {
    const ptr0 = passStringToWasm0(creator, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.canCreateRole(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * [`can_join_ink_group`]; `group` may be `null`, `windowMs` defaults to 2000.
 * @param {any} group
 * @param {any} next
 * @param {number | null} [window_ms]
 * @returns {boolean}
 */
export function canJoinInkGroup(group, next, window_ms) {
    const ret = wasm.canJoinInkGroup(group, next, !isLikeNone(window_ms), isLikeNone(window_ms) ? 0 : window_ms);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`wf_core::sync::change_origin::changed_side`] for JS, as a `ChangeSide` string.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string | null} [base]
 * @param {string | null} [folder]
 * @param {string | null} [workspace]
 * @returns {any}
 */
export function changedSide(base, folder, workspace) {
    var ptr0 = isLikeNone(base) ? 0 : passStringToWasm0(base, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(folder) ? 0 : passStringToWasm0(folder, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(workspace) ? 0 : passStringToWasm0(workspace, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.changedSide(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`check_bibliography`](bibliography_report::check_bibliography) (TS `checkBibliography`).
 * Each entry's fields cross as an ordered `{ name, value }` list.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 * @param {any} input
 * @returns {any}
 */
export function checkBibliography(input) {
    const ret = wasm.checkBibliography(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`check_url_shape`](url_safety::check_url_shape) on the parts of a parsed URL.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 * @param {string} protocol
 * @param {boolean} has_credentials
 * @param {string} port
 * @param {string} hostname
 * @returns {any}
 */
export function checkUrlShape(protocol, has_credentials, port, hostname) {
    const ptr0 = passStringToWasm0(protocol, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(port, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(hostname, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.checkUrlShape(ptr0, len0, has_credentials, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`choose_anchor_strategy`] as `{ kind, position | locus, confidence }`.
 *
 * # Errors
 *
 * Fails if `anchor` is not a combined anchor object, or the result cannot be converted.
 * @param {any} anchor
 * @param {string} current_content_hash
 * @returns {any}
 */
export function chooseAnchorStrategy(anchor, current_content_hash) {
    const ptr0 = passStringToWasm0(current_content_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.chooseAnchorStrategy(anchor, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`chunk_for_embedding`](text_chunks::chunk_for_embedding); `undefined` options take the defaults.
 *
 * # Errors
 *
 * Fails if `options` has the wrong shape.
 * @param {string} text
 * @param {any} options
 * @returns {any}
 */
export function chunkForEmbedding(text, options) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.chunkForEmbedding(ptr0, len0, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`item_to_rect`](analysis_text::item_to_rect) as `[x0, y0, x1, y1]` or null (TS `itemToRect`,
 * exported as `citationItemToRect` because `itemToRect` belongs to another lane).
 *
 * # Errors
 *
 * Fails if `item` is not a text item with `str`, `transform`, `width` and `height`.
 * @param {any} item
 * @param {number} from
 * @param {number} to
 * @returns {any}
 */
export function citationItemToRect(item, from, to) {
    const ret = wasm.citationItemToRect(item, from, to);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`clamp_ink_note_width`]; `fallback` defaults to the default pen.
 * @param {number} width
 * @param {number | null} [fallback]
 * @returns {number}
 */
export function clampInkNoteWidth(width, fallback) {
    const ret = wasm.clampInkNoteWidth(width, !isLikeNone(fallback), isLikeNone(fallback) ? 0 : fallback);
    return ret;
}

/**
 * [`clamp_ink_width`].
 * @param {number} width
 * @returns {number}
 */
export function clampInkWidth(width) {
    const ret = wasm.clampInkWidth(width);
    return ret;
}

/**
 * [`clamp_ink_zoom`].
 * @param {number} zoom
 * @returns {number}
 */
export function clampInkZoom(zoom) {
    const ret = wasm.clampInkZoom(zoom);
    return ret;
}

/**
 * [`clamp_page`] (TS `clampPage`).
 * @param {number} page
 * @param {number} num_pages
 * @returns {number}
 */
export function clampPage(page, num_pages) {
    const ret = wasm.clampPage(page, num_pages);
    return ret;
}

/**
 * [`clamp_scale`]: a non-finite or non-positive scale gives 1, else clamps to the zoom range.
 * @param {number} scale
 * @returns {number}
 */
export function clampScale(scale) {
    const ret = wasm.clampScale(scale);
    return ret;
}

/**
 * [`clamp_zoom_factor`] (TS `clampZoomFactor`).
 * @param {number} factor
 * @param {number} base_scale
 * @returns {number}
 */
export function clampZoomFactor(factor, base_scale) {
    const ret = wasm.clampZoomFactor(factor, base_scale);
    return ret;
}

/**
 * [`clean_pasted_text`] for JS, as `{ text, changed, urlsCleaned }`.
 *
 * # Errors
 *
 * Fails when `settings` is not a `PasteSettings` object, or `input` is over the text cap.
 * @param {string} input
 * @param {any} settings
 * @returns {any}
 */
export function cleanPastedText(input, settings) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.cleanPastedText(ptr0, len0, settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`clean_pdf_text`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `options` is not a `PdfTextOptions` object, or `input` is over the text cap.
 * @param {string} input
 * @param {any} options
 * @returns {any}
 */
export function cleanPdfText(input, options) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.cleanPdfText(ptr0, len0, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Cleans the URLs in `text` with the built-in rules plus the user's `rules`
 * (TS `cleanUrlsInText(text, buildUrlCleanupOptions(rules))`), as `{ text, count }`.
 *
 * # Errors
 *
 * Fails when `rules` is not a string array, or `text` is over the text cap.
 * @param {string} text
 * @param {any} rules
 * @returns {any}
 */
export function cleanUrlsWithRules(text, rules) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.cleanUrlsWithRules(ptr0, len0, rules);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`clean_wrapped_text`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `options` is not a `WrappedTextOptions` object, or `input` is over the text cap.
 * @param {string} input
 * @param {any} options
 * @returns {any}
 */
export function cleanWrappedText(input, options) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.cleanWrappedText(ptr0, len0, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`coalesce_mentions`] (TS `coalesceMentions`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 * @param {any} mentions
 * @param {string} text
 * @param {any} items
 * @returns {any}
 */
export function coalesceMentions(mentions, text, items) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.coalesceMentions(mentions, ptr0, len0, items);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`compact_ink_path`]; `options` is `{ tolerance?, maxPoints?, decimals? }` or absent.
 * @param {Float64Array} path
 * @param {any} options
 * @returns {Float64Array}
 */
export function compactInkPath(path, options) {
    const ptr0 = passArrayF64ToWasm0(path, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.compactInkPath(ptr0, len0, options);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * [`compose_spacing_accents`](analysis_text::compose_spacing_accents) (TS `composeSpacingAccents`).
 * @param {string} text
 * @returns {string}
 */
export function composeSpacingAccents(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.composeSpacingAccents(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`compute_fit_page_scale`] (TS `computeFitPageScale`).
 *
 * # Errors
 *
 * Fails if `page` or `container` is not an object with `width` and `height`.
 * @param {any} page
 * @param {any} container
 * @param {number} rotation
 * @param {number} gutter_px
 * @returns {number}
 */
export function computeFitPageScale(page, container, rotation, gutter_px) {
    const ret = wasm.computeFitPageScale(page, container, rotation, gutter_px);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`compute_fit_width_scale`] (TS `computeFitWidthScale`).
 *
 * # Errors
 *
 * Fails if `page` or `container` is not an object with `width` and `height`.
 * @param {any} page
 * @param {any} container
 * @param {number} rotation
 * @param {number} gutter_px
 * @returns {number}
 */
export function computeFitWidthScale(page, container, rotation, gutter_px) {
    const ret = wasm.computeFitWidthScale(page, container, rotation, gutter_px);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`wf_core::core_info`] as a plain JS object (`CoreInfo` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @returns {any}
 */
export function coreInfo() {
    const ret = wasm.coreInfo();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::json_entities::count_json_actions`] for JS.
 *
 * # Errors
 *
 * Fails when `entries` does not match the diff entry shape.
 * @param {any} entries
 * @returns {any}
 */
export function countJsonActions(entries) {
    const ret = wasm.countJsonActions(entries);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`covered_hit_mask`](hybrid_fusion::covered_hit_mask) as a boolean array.
 *
 * # Errors
 *
 * Fails if `query_term_counts` is not an array of numbers or `null`.
 * @param {any} query_term_counts
 * @param {number} term_count
 * @param {number} min_coverage
 * @returns {any}
 */
export function coveredHitMask(query_term_counts, term_count, min_coverage) {
    const ret = wasm.coveredHitMask(query_term_counts, term_count, min_coverage);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`covered_text_spans`](link_citations::covered_text_spans) (TS `coveredTextSpans`).
 *
 * # Errors
 *
 * Fails if `page` or `links` do not have the expected shape.
 * @param {any} page
 * @param {any} links
 * @returns {any}
 */
export function coveredTextSpans(page, links) {
    const ret = wasm.coveredTextSpans(page, links);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`creatable_roles`](member::creatable_roles).
 * @param {string} creator
 * @returns {any}
 */
export function creatableRoles(creator) {
    const ptr0 = passStringToWasm0(creator, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.creatableRoles(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`create_log_entry`](log_entry::create_log_entry). `id` and `now` come from the TS clock and
 * id generator, which the caller runs before this call.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape, or the body is blank after trimming.
 * @param {any} input
 * @param {string} id
 * @param {string} now
 * @returns {any}
 */
export function createLogEntry(input, id, now) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(now, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.createLogEntry(input, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`create_milestone`](milestone::create_milestone) with the id and time supplied. Call
 * [`milestone_input_error_js`] first: invalid input fails here.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or is invalid.
 * @param {any} input
 * @param {string} id
 * @param {string} created_at
 * @returns {any}
 */
export function createMilestoneWith(input, id, created_at) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(created_at, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.createMilestoneWith(input, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`create_paper_relation`](paper_relation::create_paper_relation) with the id and time
 * supplied. Call [`paper_relation_input_error_js`] first: invalid input fails here.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 * @param {any} input
 * @param {string} id
 * @param {string} created_at
 * @returns {any}
 */
export function createPaperRelationWith(input, id, created_at) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(created_at, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.createPaperRelationWith(input, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`create_report_section`](report_section::create_report_section) with the id and time
 * supplied. Call [`report_section_input_error_js`] first: invalid input fails here.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 * @param {any} input
 * @param {string} id
 * @param {string} now_iso
 * @returns {any}
 */
export function createReportSectionWith(input, id, now_iso) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(now_iso, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.createReportSectionWith(input, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`decide_annotation_sync`] for a row and a mode string (unknown modes act as `bidirectional`).
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 * @param {any} row
 * @param {string} mode
 * @returns {any}
 */
export function decideAnnotationSync(row, mode) {
    const ptr0 = passStringToWasm0(mode, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decideAnnotationSync(row, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::git_policy::decide_git_sync_path`] for JS, as `{ include, reason? }`.
 *
 * # Errors
 *
 * Fails when `rel_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or the
 * decision cannot be converted to a JS value.
 * @param {string} rel_path
 * @param {number} size_bytes
 * @param {number} max_file_bytes
 * @returns {any}
 */
export function decideGitSyncPath(rel_path, size_bytes, max_file_bytes) {
    const ptr0 = passStringToWasm0(rel_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decideGitSyncPath(ptr0, len0, size_bytes, max_file_bytes);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::git_gate::decide_vault_commit`] for JS, as `{ ok, action? | reason? }`.
 *
 * # Errors
 *
 * Fails when `state` is not a valid repo state, or the verdict cannot be converted to a JS value.
 * @param {boolean} enabled
 * @param {any} state
 * @returns {any}
 */
export function decideVaultCommit(enabled, state) {
    const ret = wasm.decideVaultCommit(enabled, state);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`decode_ink_words`]: `words` is an array of `{ candidates, known?, join? }`,
 * `vocabulary` an array of strings.
 *
 * # Errors
 *
 * Fails if `words` or `vocabulary` is not such an array.
 * @param {any} words
 * @param {any} vocabulary
 * @param {string | null} [engine_text]
 * @returns {any}
 */
export function decodeInkWords(words, vocabulary, engine_text) {
    var ptr0 = isLikeNone(engine_text) ? 0 : passStringToWasm0(engine_text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.decodeInkWords(words, vocabulary, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`decode_locus_value`] as a locus object, or `null` when malformed.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string | null} [raw]
 * @returns {any}
 */
export function decodeLocus(raw) {
    var ptr0 = isLikeNone(raw) ? 0 : passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.decodeLocus(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`default_graph_settings`](graph_settings::default_graph_settings).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @returns {any}
 */
export function defaultGraphSettings() {
    const ret = wasm.defaultGraphSettings();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::ink_note::default_ink_note_meta`] for JS.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @returns {any}
 */
export function defaultInkNoteMeta() {
    const ret = wasm.defaultInkNoteMeta();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * The default paste settings (TS `DEFAULT_PASTE_SETTINGS`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @returns {any}
 */
export function defaultPasteSettings() {
    const ret = wasm.defaultPasteSettings();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::git_policy::describe_changes`] for JS, from `[{ state: "added" | "modified" | "deleted" }]`.
 *
 * # Errors
 *
 * Fails when `status` is not that shape.
 * @param {any} status
 * @returns {string}
 */
export function describeChanges(status) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.describeChanges(status);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`wf_core::sync::git_remote::describe_pull`] for JS.
 *
 * # Errors
 *
 * Fails when `result` is not a valid `GitPullResult` object.
 * @param {any} result
 * @returns {string}
 */
export function describePull(result) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.describePull(result);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`wf_core::sync::git_remote::describe_push`] for JS.
 *
 * # Errors
 *
 * Fails when `result` is not a valid `GitPushResult` object.
 * @param {any} result
 * @returns {string}
 */
export function describePush(result) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.describePush(result);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`detect_citation_style`] (TS `detectCitationStyle`). `texts` is the page texts as an array of
 * strings; the result is `"numeric"`, `"author-year"`, `"both"`, or `undefined` for neither.
 *
 * # Errors
 *
 * Fails if `texts` is not an array of strings.
 * @param {any} texts
 * @returns {any}
 */
export function detectCitationStyle(texts) {
    const ret = wasm.detectCitationStyle(texts);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`detect_columns`] as an array of 0-based column indices.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of `TextLine` objects.
 * @param {any} lines
 * @returns {any}
 */
export function detectColumns(lines) {
    const ret = wasm.detectColumns(lines);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`diff_annotation_fields`] for a row: the fields that differ, in TS order.
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 * @param {any} row
 * @returns {any}
 */
export function diffAnnotationFields(row) {
    const ret = wasm.diffAnnotationFields(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::text_diff::diff_body`] for JS, as `BodyDiff`.
 *
 * # Errors
 *
 * Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} ours
 * @param {string} theirs
 * @returns {any}
 */
export function diffBody(ours, theirs) {
    const ptr0 = passStringToWasm0(ours, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(theirs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.diffBody(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::json_entities::diff_json_data`] for JS. `side` is who changed `parsed.path`;
 * the TS wrapper asks `origin` for it.
 *
 * # Errors
 *
 * Fails when an argument does not match its shape.
 * @param {any} parsed
 * @param {string} existing_json
 * @param {any} side
 * @returns {any}
 */
export function diffJsonData(parsed, existing_json, side) {
    const ptr0 = passStringToWasm0(existing_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.diffJsonData(parsed, ptr0, len0, side);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::deserialize::diff_workspace`] for JS. `sides` maps a parsed path to who
 * changed it; the TS wrapper fills it from `origin`. A path it lacks is `Unknown`. Without
 * `sides`, there is no origin.
 *
 * # Errors
 *
 * Fails when an argument does not match its shape.
 * @param {any} parsed
 * @param {any} existing
 * @param {any} sides
 * @returns {any}
 */
export function diffWorkspace(parsed, existing, sides) {
    const ret = wasm.diffWorkspace(parsed, existing, sides);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`document_boost`](search_tuning::document_boost). `now` is epoch milliseconds.
 *
 * # Errors
 *
 * Fails if `doc` or `options` has the wrong shape.
 * @param {any} doc
 * @param {any} options
 * @param {number} now
 * @returns {number}
 */
export function documentBoost(doc, options, now) {
    const ret = wasm.documentBoost(doc, options, now);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`effective_field_boosts`](search_settings::effective_field_boosts).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 * @param {any} settings
 * @returns {any}
 */
export function effectiveFieldBoosts(settings) {
    const ret = wasm.effectiveFieldBoosts(settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`effective_relation_types`](graph_settings::effective_relation_types).
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 * @param {any} settings
 * @returns {any}
 */
export function effectiveRelationTypes(settings) {
    const ret = wasm.effectiveRelationTypes(settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`encode_locus`] as raw JSON (encode at the URL layer, not here).
 *
 * # Errors
 *
 * Fails if `locus` is not a locus object.
 * @param {any} locus
 * @returns {string}
 */
export function encodeLocus(locus) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.encodeLocus(locus);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`encode_rollup_options`](paper_field::encode_rollup_options) (TS `encodeRollupOptions`).
 *
 * # Errors
 *
 * Fails if `config` is not a rollup config object.
 * @param {any} config
 * @returns {string[]}
 */
export function encodeRollupOptions(config) {
    const ret = wasm.encodeRollupOptions(config);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * [`wf_core::sync::folder_layout::entity_dir`] for JS.
 *
 * # Errors
 *
 * Fails when `entity` is not a workspace entity type, or `project_root` is
 * over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} entity
 * @param {string} project_root
 * @returns {string}
 */
export function entityDir(entity, project_root) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(entity, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(project_root, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.entityDir(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * [`escape_latex_text`](markdown_to_latex::escape_latex_text) (TS `escapeLatexText`).
 * @param {string} s
 * @returns {string}
 */
export function escapeLatexText(s) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.escapeLatexText(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`evaluate_ai_access`](access_policy::evaluate_ai_access); `now` is the ISO 8601 clock time.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 * @param {any} input
 * @param {string} now
 * @returns {any}
 */
export function evaluateAiAccess(input, now) {
    const ptr0 = passStringToWasm0(now, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.evaluateAiAccess(input, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`exclusion_reasons`](screening::exclusion_reasons) (TS `exclusionReasons`).
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 * @param {any} decisions
 * @param {any} stage
 * @returns {any}
 */
export function exclusionReasons(decisions, stage) {
    const ret = wasm.exclusionReasons(decisions, stage);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`expand_ipv6`](url_safety::expand_ipv6); `undefined` when the text is not IPv6.
 *
 * # Errors
 *
 * Fails if the groups cannot be converted to a JS value.
 * @param {string} value
 * @returns {any}
 */
export function expandIpv6(value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.expandIpv6(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`experiment_activity_at`](experiment_status::experiment_activity_at).
 *
 * # Errors
 *
 * Fails if `experiment` has the wrong shape.
 * @param {any} experiment
 * @returns {number}
 */
export function experimentActivityAt(experiment) {
    const ret = wasm.experimentActivityAt(experiment);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`explain_arm`](related::explain_arm).
 *
 * # Errors
 *
 * Fails if `arm` is not a known arm name.
 * @param {any} arm
 * @returns {string}
 */
export function explainArm(arm) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.explainArm(arm);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`wf_core::papers::paper_ref::extract_doi`]: the DOI found in `value`, or `None`.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} value
 * @returns {string | undefined}
 */
export function extractDoi(value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.extractDoi(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`extract_hashtag_refs`](paper::extract_hashtag_refs) (TS `extractHashtagRefs`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string | null} [text]
 * @returns {any}
 */
export function extractHashtagRefs(text) {
    var ptr0 = isLikeNone(text) ? 0 : passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.extractHashtagRefs(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`extract_hashtags`](paper::extract_hashtags) (TS `extractHashtags`).
 * @param {string | null} [text]
 * @returns {string[]}
 */
export function extractHashtags(text) {
    var ptr0 = isLikeNone(text) ? 0 : passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.extractHashtags(ptr0, len0);
    var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * [`wf_core::papers::page_metadata::extract_page_metadata`]: metadata of a
 * fetched page (`PageMetadata` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails if `html` or `url` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} html
 * @param {string} url
 * @returns {any}
 */
export function extractPageMetadata(html, url) {
    const ptr0 = passStringToWasm0(html, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.extractPageMetadata(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`extractVenue`](bibliography::extract_venue): venue named after the title, if any.
 * @param {string} after_title
 * @returns {string | undefined}
 */
export function extractVenue(after_title) {
    const ptr0 = passStringToWasm0(after_title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.extractVenue(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`extract_wikilinks`](page::extract_wikilinks) (TS `extractWikilinks`). Offsets are UTF-16.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} body
 * @returns {any}
 */
export function extractWikilinks(body) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.extractWikilinks(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`fence_untrusted`](untrusted_context::fence_untrusted).
 *
 * # Errors
 *
 * Fails if `items` is not an array of `{ label, text }` objects.
 * @param {any} items
 * @param {string} nonce
 * @returns {string}
 */
export function fenceUntrusted(items, nonce) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.fenceUntrusted(items, ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`filter_lab_members`](member::filter_lab_members). Returns indices into `members`.
 *
 * # Errors
 *
 * Fails if `members` or `options` has the wrong shape.
 * @param {string} viewer_id
 * @param {any} members
 * @param {any} options
 * @returns {any}
 */
export function filterLabMembers(viewer_id, members, options) {
    const ptr0 = passStringToWasm0(viewer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.filterLabMembers(ptr0, len0, members, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`filter_team_members`](member::filter_team_members). Returns indices into `members`.
 *
 * # Errors
 *
 * Fails if `members` or `options` has the wrong shape.
 * @param {string} viewer_id
 * @param {any} members
 * @param {any} options
 * @returns {any}
 */
export function filterTeamMembers(viewer_id, members, options) {
    const ptr0 = passStringToWasm0(viewer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.filterTeamMembers(ptr0, len0, members, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`find_citation_candidates`](analysis_citations::find_citation_candidates) (TS `findCitationCandidates`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 * @param {any} items
 * @returns {any}
 */
export function findCitationCandidates(items) {
    const ret = wasm.findCitationCandidates(items);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`find_document_matches`] as an array of `{ pageIndex, start, end }`; `pages` is `{ pageIndex, text }[]`.
 *
 * # Errors
 *
 * Fails if `pages` is not an array of `{ pageIndex, text }` objects.
 * @param {any} pages
 * @param {string} query
 * @returns {any}
 */
export function findDocumentMatches(pages, query) {
    const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.findDocumentMatches(pages, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`find_figure_mentions`] (TS `findFigureMentions`). `outline` is optional.
 *
 * # Errors
 *
 * Fails if `pages` or `outline` do not have the expected shape.
 * @param {any} pages
 * @param {any} outline
 * @returns {any}
 */
export function findFigureMentions(pages, outline) {
    const ret = wasm.findFigureMentions(pages, outline);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`find_heading_lines`] (TS `findHeadingLines`). `furniture_indices` are the positions in
 * `lines` that count as furniture (never headings); the TS wrapper maps flags to indices.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of text lines or `furnitureIndices` is not an array of
 * non-negative integers.
 * @param {any} lines
 * @param {number} body
 * @param {any} furniture_indices
 * @returns {any}
 */
export function findHeadingLines(lines, body, furniture_indices) {
    const ret = wasm.findHeadingLines(lines, body, furniture_indices);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`find_pattern_citation_mentions`](analysis_citations::find_pattern_citation_mentions) (TS
 * `findPatternCitationMentions`). The TS wrapper always passes `excluded` and `candidates`.
 *
 * # Errors
 *
 * Fails if `page`, `refs`, `excluded` or `candidates` do not have the expected shape.
 * @param {any} page
 * @param {any} refs
 * @param {any} excluded
 * @param {any} candidates
 * @returns {any}
 */
export function findPatternCitationMentions(page, refs, excluded, candidates) {
    const ret = wasm.findPatternCitationMentions(page, refs, excluded, candidates);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`find_quote_matches`] as an array of `{ start, end }`.
 *
 * # Errors
 *
 * Fails if `quote` is not a quote selector object.
 * @param {string} text
 * @param {any} quote
 * @returns {any}
 */
export function findQuoteMatches(text, quote) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.findQuoteMatches(ptr0, len0, quote);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`find_reference_section`] (TS `findReferenceSection`). `furniture` is an optional
 * per-line boolean array, `undefined` or `null` for none.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of text lines or `furniture` is not an array of booleans.
 * @param {any} lines
 * @param {number} body_font_size
 * @param {number} page_count
 * @param {any} furniture
 * @returns {any}
 */
export function findReferenceSection(lines, body_font_size, page_count, furniture) {
    const ret = wasm.findReferenceSection(lines, body_font_size, page_count, furniture);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`font_size_of`](analysis_text::font_size_of) (TS `fontSizeOf`).
 *
 * # Errors
 *
 * Fails if `item` is not a text item with `str`, `transform`, `width` and `height`.
 * @param {any} item
 * @returns {number}
 */
export function fontSizeOf(item) {
    const ret = wasm.fontSizeOf(item);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`forget_search_query`](search_history::forget_search_query).
 * @param {string[]} history
 * @param {string} query
 * @returns {string[]}
 */
export function forgetSearchQuery(history, query) {
    const ptr0 = passArrayJsValueToWasm0(history, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.forgetSearchQuery(ptr0, len0, ptr1, len1);
    var v3 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * [`format_citation`](cite_key::format_citation) (TS `formatCitation`).
 * @param {string} key
 * @param {string} format
 * @returns {string}
 */
export function formatCitation(key, format) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.formatCitation(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`format_invite_code`](org::format_invite_code).
 * @param {string} raw
 * @returns {string}
 */
export function formatInviteCode(raw) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.formatInviteCode(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`format_metric_cell`](experiment_status::format_metric_cell).
 *
 * # Errors
 *
 * Fails if `value` cannot be read as JSON.
 * @param {string} metric
 * @param {any} value
 * @returns {string}
 */
export function formatMetricCell(metric, value) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(metric, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.formatMetricCell(ptr0, len0, value);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`format_metric_value`](experiment_status::format_metric_value).
 * @param {string} metric
 * @param {number} value
 * @returns {string}
 */
export function formatMetricValue(metric, value) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(metric, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.formatMetricValue(ptr0, len0, value);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`format_paper_citation`](cite_key::format_paper_citation) (TS `formatPaperCitation`).
 *
 * # Errors
 *
 * Fails if `paper` is not an object with a string `id`.
 * @param {any} paper
 * @param {string} format
 * @returns {string}
 */
export function formatPaperCitation(paper, format) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(format, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.formatPaperCitation(paper, ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`furniture_key`].
 * @param {string} s
 * @returns {string}
 */
export function furnitureKey(s) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(s, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.furnitureKey(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`furniture_lines`] (TS `furnitureLines`): one boolean per line, `true` for running heads
 * and folios.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of text lines.
 * @param {any} lines
 * @returns {any}
 */
export function furnitureLines(lines) {
    const ret = wasm.furnitureLines(lines);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::search::fusion::fuse_rankings`]: distinct ids, best fused rank first.
 * `k` defaults to [`RRF_K`]; `limit` of `None` or 0 means no limit.
 *
 * # Errors
 *
 * Fails if a list is malformed, the lists have more than `MAX_FUSION_IDS` ids
 * in total, or a weight is not finite and >= 0.
 * @param {any} lists
 * @param {number | null} [k]
 * @param {number | null} [limit]
 * @returns {any}
 */
export function fuseRankings(lists, k, limit) {
    const ret = wasm.fuseRankings(lists, isLikeNone(k) ? Number.MAX_SAFE_INTEGER : (k) >>> 0, isLikeNone(limit) ? Number.MAX_SAFE_INTEGER : (limit) >>> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`fuzziness_for_term`](search_tuning::fuzziness_for_term).
 * @param {string} term
 * @returns {number}
 */
export function fuzzinessForTerm(term) {
    const ptr0 = passStringToWasm0(term, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fuzzinessForTerm(ptr0, len0);
    return ret;
}

/**
 * [`gate_vector_mask`](hybrid_fusion::gate_vector_mask) as a boolean array.
 *
 * # Errors
 *
 * Fails if `scores` is not an array of numbers.
 * @param {any} scores
 * @param {number} floor
 * @param {number} keep_top
 * @returns {any}
 */
export function gateVectorMask(scores, floor, keep_top) {
    const ret = wasm.gateVectorMask(scores, floor, keep_top);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`get_user_integration_field`](integration_credentials::get_user_integration_field);
 * `undefined` when empty.
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 * @param {any} settings
 * @param {string} provider_id
 * @param {string} field_id
 * @returns {any}
 */
export function getUserIntegrationField(settings, provider_id, field_id) {
    const ptr0 = passStringToWasm0(provider_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(field_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.getUserIntegrationField(settings, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`graph_degrees`](wiki_graph::graph_degrees), as `{ node, degree }` rows.
 *
 * # Errors
 *
 * Fails if `graph` has the wrong shape.
 * @param {any} graph
 * @returns {any}
 */
export function graphDegrees(graph) {
    const ret = wasm.graphDegrees(graph);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`graph_density`](wiki_graph::graph_density).
 *
 * # Errors
 *
 * Fails if `graph` has the wrong shape.
 * @param {any} graph
 * @returns {any}
 */
export function graphDensity(graph) {
    const ret = wasm.graphDensity(graph);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`graph_filter_count`](graph_settings::graph_filter_count), given the two selection sizes.
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 * @param {number} selected_tags
 * @param {number} selected_lists
 * @param {any} settings
 * @returns {number}
 */
export function graphFilterCountFor(selected_tags, selected_lists, settings) {
    const ret = wasm.graphFilterCountFor(selected_tags, selected_lists, settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * [`group_recurring_lines`](analysis_outline::group_recurring_lines) (TS `groupRecurringLines`).
 * The TS wrapper passes each line's text and page; members come back as indices.
 *
 * # Errors
 *
 * Fails if `texts` is not an array of strings or `pages` is not an array of numbers.
 * @param {any} texts
 * @param {any} pages
 * @returns {any}
 */
export function groupRecurringLines(texts, pages) {
    const ret = wasm.groupRecurringLines(texts, pages);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::storage::blob::guess_blob_content_type`]: MIME type for `path`
 * by its extension.
 *
 * # Errors
 *
 * Fails if `path` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} path
 * @returns {string}
 */
export function guessBlobContentType(path) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.guessBlobContentType(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`has_active_lab`](org::has_active_lab).
 *
 * # Errors
 *
 * Fails if `memberships` has the wrong shape.
 * @param {string | null | undefined} active_org_id
 * @param {any} memberships
 * @param {boolean} owns_active_org
 * @returns {boolean}
 */
export function hasActiveLab(active_org_id, memberships, owns_active_org) {
    var ptr0 = isLikeNone(active_org_id) ? 0 : passStringToWasm0(active_org_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.hasActiveLab(ptr0, len0, memberships, owns_active_org);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`wf_core::sync::text_diff::has_conflict_markers`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} text
 * @returns {boolean}
 */
export function hasConflictMarkers(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hasConflictMarkers(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`heading_outline`] (TS `headingOutline`).
 *
 * # Errors
 *
 * Fails if `headings` is not an array of text lines.
 * @param {any} headings
 * @returns {any}
 */
export function headingOutline(headings) {
    const ret = wasm.headingOutline(headings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`hydrate_user_settings`](user_settings::hydrate_user_settings).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 * @param {any} settings
 * @returns {any}
 */
export function hydrateUserSettings(settings) {
    const ret = wasm.hydrateUserSettings(settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::folder_layout::id_suffix`] for JS.
 *
 * # Errors
 *
 * Fails when `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} id
 * @returns {string}
 */
export function idSuffix(id) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.idSuffix(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`wf_core::sync::markdown_image::image_alt_from_filename`] for JS.
 *
 * # Errors
 *
 * Fails when `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string | null} [name]
 * @returns {string}
 */
export function imageAltFromFilename(name) {
    let deferred3_0;
    let deferred3_1;
    try {
        var ptr0 = isLikeNone(name) ? 0 : passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.imageAltFromFilename(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`wf_core::sync::markdown_image::image_extension_for_mime`] for JS.
 *
 * # Errors
 *
 * Fails when `mime` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} mime
 * @returns {string}
 */
export function imageExtensionForMime(mime) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(mime, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.imageExtensionForMime(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`wf_core::sync::markdown_image::image_paths_in_body`] for JS. The body is
 * always normalised with `normalize_markdown_image_syntax` first, as every
 * TS caller does; `prefix` is literal text, not a regex.
 *
 * # Errors
 *
 * Fails when `body` or `prefix` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} body
 * @param {string} prefix
 * @returns {string[]}
 */
export function imagePathsInBody(body, prefix) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(prefix, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.imagePathsInBody(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v3 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * [`in_reference_list`](analysis_citations::in_reference_list) (TS `inReferenceList`).
 *
 * # Errors
 *
 * Fails if `ranges` is not an array of page text ranges.
 * @param {number} page
 * @param {number} start
 * @param {number} end
 * @param {any} ranges
 * @returns {boolean}
 */
export function inReferenceList(page, start, end, ranges) {
    const ret = wasm.inReferenceList(page, start, end, ranges);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`wf_core::search::tokenizer::index_terms`]: what MiniSearch indexes for `text`.
 *
 * # Errors
 *
 * Fails if `text` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or if
 * `options` is not a valid `TokenizerOptions` object.
 * @param {string} text
 * @param {any} options
 * @returns {any}
 */
export function indexTerms(text, options) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.indexTerms(ptr0, len0, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`initial_reader_viewport`] as `{ scale, fit, rotation, page }` (TS `initialReaderViewport`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {number} page
 * @returns {any}
 */
export function initialReaderViewport(page) {
    const ret = wasm.initialReaderViewport(page);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`ink_curve_at`] as `[x, y]`. A span past the end gives `[NaN, NaN]`, as
 * the TS copy's out-of-range reads do.
 * @param {Float64Array} xs
 * @param {Float64Array} ys
 * @param {number} i
 * @param {number} u
 * @returns {Float64Array}
 */
export function inkCurveAt(xs, ys, i, u) {
    const ptr0 = passArrayF64ToWasm0(xs, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(ys, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.inkCurveAt(ptr0, len0, ptr1, len1, i, u);
    var v3 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v3;
}

/**
 * [`ink_line_records`]: `counts[i]` strokes per line, `bands` as flat
 * `yMin, yMax` pairs, `recognised` an array of `{ text, confidence }` or
 * undefined per line.
 *
 * # Errors
 *
 * Fails if `recognised` is not such an array.
 * @param {Uint32Array} counts
 * @param {Float64Array} bands
 * @param {any} recognised
 * @returns {any}
 */
export function inkLineRecords(counts, bands, recognised) {
    const ptr0 = passArray32ToWasm0(counts, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(bands, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.inkLineRecords(ptr0, len0, ptr1, len1, recognised);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`ink_note_width_to_pdf_points`].
 * @param {number} tenths
 * @returns {number}
 */
export function inkNoteWidthToPdfPoints(tenths) {
    const ret = wasm.inkNoteWidthToPdfPoints(tenths);
    return ret;
}

/**
 * [`ink_page_confidence`] over the lines' `conf` values.
 * @param {Float64Array} confs
 * @returns {number}
 */
export function inkPageConfidence(confs) {
    const ptr0 = passArrayF64ToWasm0(confs, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.inkPageConfidence(ptr0, len0);
    return ret;
}

/**
 * [`ink_path_json_size`].
 * @param {Float64Array} path
 * @returns {number}
 */
export function inkPathJsonSize(path) {
    const ptr0 = passArrayF64ToWasm0(path, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.inkPathJsonSize(ptr0, len0);
    return ret >>> 0;
}

/**
 * [`ink_paths_bounds`]; `[x1, y1, x2, y2]` or `null`.
 * @param {any} paths
 * @returns {any}
 */
export function inkPathsBounds(paths) {
    const ret = wasm.inkPathsBounds(paths);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`ink_paths_hit_test`]; `paths` is an array of number arrays.
 * @param {any} paths
 * @param {number} x
 * @param {number} y
 * @param {number} radius
 * @returns {boolean}
 */
export function inkPathsHitTest(paths, x, y, radius) {
    const ret = wasm.inkPathsHitTest(paths, x, y, radius);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`ink_paths_in_polygon`]. `paths` is every path's flat `x, y` pairs back to back; `pathLengths`
 * gives each path's value count. A length that runs past `paths` is skipped.
 * @param {Float64Array} paths
 * @param {Uint32Array} path_lengths
 * @param {Float64Array} polygon
 * @param {number} share
 * @returns {boolean}
 */
export function inkPathsInPolygon(paths, path_lengths, polygon, share) {
    const ptr0 = passArrayF64ToWasm0(paths, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(path_lengths, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayF64ToWasm0(polygon, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.inkPathsInPolygon(ptr0, len0, ptr1, len1, ptr2, len2, share);
    return ret !== 0;
}

/**
 * [`ink_pressure_factor`].
 * @param {number | null} [pressure]
 * @returns {number}
 */
export function inkPressureFactor(pressure) {
    const ret = wasm.inkPressureFactor(!isLikeNone(pressure), isLikeNone(pressure) ? 0 : pressure);
    return ret;
}

/**
 * [`ink_tangent_at`] as `[x, y]`; `side` is `"in"` or `"out"` (anything else is `"out"`).
 * An index past the end gives `[0, 0]`, as the TS copy does.
 * @param {Float64Array} xs
 * @param {Float64Array} ys
 * @param {number} i
 * @param {string} side
 * @returns {Float64Array}
 */
export function inkTangentAt(xs, ys, i, side) {
    const ptr0 = passArrayF64ToWasm0(xs, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(ys, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(side, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.inkTangentAt(ptr0, len0, ptr1, len1, i, ptr2, len2);
    var v4 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v4;
}

/**
 * [`ink_velocity_between`].
 * @param {number} x0
 * @param {number} y0
 * @param {number} t0
 * @param {number} x1
 * @param {number} y1
 * @param {number} t1
 * @returns {number}
 */
export function inkVelocityBetween(x0, y0, t0, x1, y1, t1) {
    const ret = wasm.inkVelocityBetween(x0, y0, t0, x1, y1, t1);
    return ret;
}

/**
 * [`ink_velocity_factor`]; `fullTaper` defaults to `INK_VELOCITY_FULL_TAPER`.
 * @param {number} velocity
 * @param {number | null} [full_taper]
 * @returns {number}
 */
export function inkVelocityFactor(velocity, full_taper) {
    const ret = wasm.inkVelocityFactor(velocity, !isLikeNone(full_taper), isLikeNone(full_taper) ? 0 : full_taper);
    return ret;
}

/**
 * [`ink_vocabulary_hints`]; `limit` defaults to 500.
 *
 * # Errors
 *
 * Fails if `sources` is not an array of string arrays.
 * @param {any} sources
 * @param {number | null} [limit]
 * @returns {any}
 */
export function inkVocabularyHints(sources, limit) {
    const ret = wasm.inkVocabularyHints(sources, !isLikeNone(limit), isLikeNone(limit) ? 0 : limit);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`ink_width_for_pressure`]; `base` defaults to `INK_DEFAULT_WIDTH`.
 * @param {number | null} [pressure]
 * @param {number | null} [base]
 * @returns {number}
 */
export function inkWidthForPressure(pressure, base) {
    const ret = wasm.inkWidthForPressure(!isLikeNone(pressure), isLikeNone(pressure) ? 0 : pressure, !isLikeNone(base), isLikeNone(base) ? 0 : base);
    return ret;
}

/**
 * [`ink_zoom_in`].
 * @param {number} zoom
 * @returns {number}
 */
export function inkZoomIn(zoom) {
    const ret = wasm.inkZoomIn(zoom);
    return ret;
}

/**
 * [`ink_zoom_out`].
 * @param {number} zoom
 * @returns {number}
 */
export function inkZoomOut(zoom) {
    const ret = wasm.inkZoomOut(zoom);
    return ret;
}

/**
 * [`integrations_bag_from_legacy`](integration_credentials::integrations_bag_from_legacy);
 * `undefined` when no legacy field is set.
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 * @param {any} settings
 * @returns {any}
 */
export function integrationsBagFromLegacy(settings) {
    const ret = wasm.integrationsBagFromLegacy(settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`is_annotation_sync_state`] for any JS value: false unless `value` is a string.
 * @param {any} value
 * @returns {boolean}
 */
export function isAnnotationSyncState(value) {
    const ret = wasm.isAnnotationSyncState(value);
    return ret !== 0;
}

/**
 * [`wf_core::sync::json_entities::is_app_owned_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} path
 * @returns {boolean}
 */
export function isAppOwnedPath(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isAppOwnedPath(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_bibliographic_match`](analysis_text::is_bibliographic_match) (TS `isBibliographicMatch`).
 *
 * # Errors
 *
 * Fails if `hints` or `candidate` is not an object of the expected shape.
 * @param {any} hints
 * @param {any} candidate
 * @returns {boolean}
 */
export function isBibliographicMatch(hints, candidate) {
    const ret = wasm.isBibliographicMatch(hints, candidate);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_blanket_share`](sharing::is_blanket_share); `null` or `undefined` means every resource.
 * @param {string | null} [resource_id]
 * @returns {boolean}
 */
export function isBlanketShare(resource_id) {
    var ptr0 = isLikeNone(resource_id) ? 0 : passStringToWasm0(resource_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.isBlanketShare(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_bold_font`]; `fontName` may be undefined.
 * @param {string | null} [font_name]
 * @returns {boolean}
 */
export function isBoldFont(font_name) {
    var ptr0 = isLikeNone(font_name) ? 0 : passStringToWasm0(font_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.isBoldFont(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_citation_destination`] (TS `isCitationDestination`). `name` is optional.
 *
 * # Errors
 *
 * Fails if `name` is neither a string nor `undefined`/`null`.
 * @param {any} name
 * @returns {boolean}
 */
export function isCitationDestination(name) {
    const ret = wasm.isCitationDestination(name);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_empty_paper_summary`](paper::is_empty_paper_summary) (TS `isEmptyPaperSummary`).
 * @param {string | null} [summary]
 * @returns {boolean}
 */
export function isEmptyPaperSummary(summary) {
    var ptr0 = isLikeNone(summary) ? 0 : passStringToWasm0(summary, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.isEmptyPaperSummary(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_explicit_lab_membership`](org::is_explicit_lab_membership).
 *
 * # Errors
 *
 * Fails if `membership` has the wrong shape.
 * @param {any} membership
 * @returns {boolean}
 */
export function isExplicitLabMembership(membership) {
    const ret = wasm.isExplicitLabMembership(membership);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_highlighter_ink`]; `undefined` is `None`.
 * @param {number | null} [width]
 * @returns {boolean}
 */
export function isHighlighterInk(width) {
    const ret = wasm.isHighlighterInk(!isLikeNone(width), isLikeNone(width) ? 0 : width);
    return ret !== 0;
}

/**
 * [`wf_core::sync::ink_note::is_ink_chunk_id`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} text
 * @returns {boolean}
 */
export function isInkChunkId(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isInkChunkId(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`wf_core::sync::ink_note::is_ink_note_body`] for JS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} body
 * @returns {boolean}
 */
export function isInkNoteBody(body) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isInkNoteBody(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_ip_address`](url_safety::is_ip_address).
 * @param {string} value
 * @returns {boolean}
 */
export function isIpAddress(value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isIpAddress(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_iso_day`](milestone::is_iso_day).
 * @param {string} value
 * @returns {boolean}
 */
export function isIsoDay(value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isIsoDay(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_paper_field_kind`](paper_field::is_paper_field_kind) (TS `isPaperFieldKind`).
 * @param {string} value
 * @returns {boolean}
 */
export function isPaperFieldKind(value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isPaperFieldKind(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_placeholder_title`](paper_title::is_placeholder_title) (TS `isPlaceholderTitle`).
 * @param {string | null} [title]
 * @returns {boolean}
 */
export function isPlaceholderTitle(title) {
    var ptr0 = isLikeNone(title) ? 0 : passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.isPlaceholderTitle(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_public_address`](url_safety::is_public_address).
 * @param {string} address
 * @returns {boolean}
 */
export function isPublicAddress(address) {
    const ptr0 = passStringToWasm0(address, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isPublicAddress(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_quotation_type`](annotation_quotation_type::is_quotation_type) (TS `isQuotationType`).
 * @param {string} value
 * @returns {boolean}
 */
export function isQuotationType(value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isQuotationType(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_reader_annotation_type`] for any JS value: false unless `value` is a string.
 * @param {any} value
 * @returns {boolean}
 */
export function isReaderAnnotationType(value) {
    const ret = wasm.isReaderAnnotationType(value);
    return ret !== 0;
}

/**
 * [`is_rotated_text`](analysis_outline::is_rotated_text) (TS `isRotatedText`).
 * @param {Float64Array} transform
 * @returns {boolean}
 */
export function isRotatedText(transform) {
    const ptr0 = passArrayF64ToWasm0(transform, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isRotatedText(ptr0, len0);
    return ret !== 0;
}

/**
 * [`wf_core::workspace::is_safe_workspace_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} path
 * @returns {boolean}
 */
export function isSafeWorkspacePath(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isSafeWorkspacePath(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_stale_running_experiment`](experiment_status::is_stale_running_experiment); `undefined` last metric time means none.
 *
 * # Errors
 *
 * Fails if `experiment` has the wrong shape.
 * @param {any} experiment
 * @param {number} now_ms
 * @param {number} stale_ms
 * @param {number | null} [last_metric_at_ms]
 * @returns {boolean}
 */
export function isStaleRunningExperiment(experiment, now_ms, stale_ms, last_metric_at_ms) {
    const ret = wasm.isStaleRunningExperiment(experiment, now_ms, stale_ms, !isLikeNone(last_metric_at_ms), isLikeNone(last_metric_at_ms) ? 0 : last_metric_at_ms);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_supervisor_role`](member::is_supervisor_role).
 * @param {string | null} [role]
 * @returns {boolean}
 */
export function isSupervisorRole(role) {
    var ptr0 = isLikeNone(role) ? 0 : passStringToWasm0(role, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.isSupervisorRole(ptr0, len0);
    return ret !== 0;
}

/**
 * [`wf_core::sync::git_policy::is_under_ignored_folder`] for JS.
 *
 * # Errors
 *
 * Fails when `rel_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} rel_path
 * @returns {boolean}
 */
export function isUnderIgnoredFolder(rel_path) {
    const ptr0 = passStringToWasm0(rel_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isUnderIgnoredFolder(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_unsure_confidence`].
 * @param {number} conf
 * @returns {boolean}
 */
export function isUnsureConfidence(conf) {
    const ret = wasm.isUnsureConfidence(conf);
    return ret !== 0;
}

/**
 * [`is_user_integration_connected`](integration_credentials::is_user_integration_connected).
 *
 * # Errors
 *
 * Fails if `settings` or `field_ids` has the wrong shape.
 * @param {any} settings
 * @param {string} provider_id
 * @param {any} field_ids
 * @returns {boolean}
 */
export function isUserIntegrationConnected(settings, provider_id, field_ids) {
    const ptr0 = passStringToWasm0(provider_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isUserIntegrationConnected(settings, ptr0, len0, field_ids);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_zotero_library_sync_mode`] for any JS value: false unless `value` is a string.
 * @param {any} value
 * @returns {boolean}
 */
export function isZoteroLibrarySyncMode(value) {
    const ret = wasm.isZoteroLibrarySyncMode(value);
    return ret !== 0;
}

/**
 * [`item_to_rect`] as `[x1, y1, x2, y2]`, or `null`. Omitted bounds take the TS defaults (`0` and `Infinity`).
 *
 * # Errors
 *
 * Fails if `item` is not a text item object, or the result cannot be converted.
 * @param {any} item
 * @param {number | null} [char_from]
 * @param {number | null} [char_to]
 * @returns {any}
 */
export function itemToRect(item, char_from, char_to) {
    const ret = wasm.itemToRect(item, !isLikeNone(char_from), isLikeNone(char_from) ? 0 : char_from, !isLikeNone(char_to), isLikeNone(char_to) ? 0 : char_to);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::json_entities::json_data_path`] for JS.
 *
 * # Errors
 *
 * Fails when `project_root` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units or `kind` is not a
 * known kind.
 * @param {string} project_root
 * @param {any} kind
 * @returns {string}
 */
export function jsonDataPath(project_root, kind) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(project_root, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.jsonDataPath(ptr0, len0, kind);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`wf_core::sync::json_entities::json_kind_of_path`] for JS; `undefined` for none.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} path
 * @returns {string | undefined}
 */
export function jsonKindOfPath(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.jsonKindOfPath(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`kind_multiplier`](search_settings::kind_multiplier); an unknown `kind` reads as `1`.
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 * @param {string} kind
 * @param {any} settings
 * @returns {number}
 */
export function kindMultiplier(kind, settings) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.kindMultiplier(ptr0, len0, settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`labelNumber`](bibliography::label_number): entry number from the exec groups.
 *
 * # Errors
 *
 * Returns an error when `groups` is not an array of strings or `undefined`.
 * @param {any} groups
 * @returns {number}
 */
export function labelNumber(groups) {
    const ret = wasm.labelNumber(groups);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`ladder_order`] (TS `ladderOrder`): the indexes of the supporting resolvers, in order.
 *
 * # Errors
 *
 * Fails if `supports` is not an array of booleans.
 * @param {any} supports
 * @returns {any}
 */
export function ladderOrder(supports) {
    const ret = wasm.ladderOrder(supports);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`latest_by_reviewer`](screening::latest_by_reviewer) (TS `latestByReviewer`), as the
 * decisions in `Map` order.
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 * @param {any} decisions
 * @param {string} item_id
 * @param {any} stage
 * @returns {any}
 */
export function latestByReviewerList(decisions, item_id, stage) {
    const ptr0 = passStringToWasm0(item_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.latestByReviewerList(decisions, ptr0, len0, stage);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`levenshtein`](analysis_outline::levenshtein) (TS `levenshtein`).
 * @param {string} a
 * @param {string} b
 * @param {number} limit
 * @returns {number}
 */
export function levenshtein(a, b, limit) {
    const ptr0 = passStringToWasm0(a, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(b, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.levenshtein(ptr0, len0, ptr1, len1, limit);
    return ret;
}

/**
 * [`link_citation_mentions`](link_citations::link_citation_mentions) (TS
 * `linkCitationMentions`).
 *
 * # Errors
 *
 * Fails if `page`, `links` or `refs` do not have the expected shape.
 * @param {any} page
 * @param {any} links
 * @param {any} refs
 * @returns {any}
 */
export function linkCitationMentions(page, links, refs) {
    const ret = wasm.linkCitationMentions(page, links, refs);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`validate_new_log_entry`](log_entry::validate_new_log_entry): the error message, or `None`.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 * @param {any} input
 * @returns {string | undefined}
 */
export function logEntryInputError(input) {
    const ret = wasm.logEntryInputError(input);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`map_ink_confidence`]; `scale` defaults to 1.
 * @param {number} raw
 * @param {number | null} [scale]
 * @returns {number}
 */
export function mapInkConfidence(raw, scale) {
    const ret = wasm.mapInkConfidence(raw, !isLikeNone(scale), isLikeNone(scale) ? 0 : scale);
    return ret;
}

/**
 * [`wf_core::sync::markdown_image::markdown_image`] for JS.
 *
 * # Errors
 *
 * Fails when an argument is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} target
 * @param {string} alt
 * @returns {string}
 */
export function markdownImage(target, alt) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(alt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.markdownImage(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * [`markdown_to_latex`](markdown_to_latex::markdown_to_latex) (TS `markdownToLatex`).
 *
 * # Errors
 *
 * Fails if `opts` is not an options object.
 * @param {string} md
 * @param {any} opts
 * @returns {any}
 */
export function markdownToLatex(md, opts) {
    const ptr0 = passStringToWasm0(md, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.markdownToLatex(ptr0, len0, opts);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`match_author_year_text`](analysis_citations::match_author_year_text) (TS `matchAuthorYearText`).
 *
 * # Errors
 *
 * Fails if `refs` is not an array of parsed references.
 * @param {string} text
 * @param {any} refs
 * @returns {any}
 */
export function matchAuthorYearText(text, refs) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.matchAuthorYearText(ptr0, len0, refs);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`match_page_citations`] (TS `matchPageCitations`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 * @param {any} page
 * @param {any} references
 * @param {any} reference_ranges
 * @returns {any}
 */
export function matchPageCitations(page, references, reference_ranges) {
    const ret = wasm.matchPageCitations(page, references, reference_ranges);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`MAX_FUSION_IDS`] for JS.
 * @returns {number}
 */
export function maxFusionIds() {
    const ret = wasm.maxFusionIds();
    return ret >>> 0;
}

/**
 * [`MAX_INDEX_TEXT_UTF16`] for JS, so the wrappers check the cap before the
 * text is copied into linear memory.
 * @returns {number}
 */
export function maxIndexTextUtf16() {
    const ret = wasm.maxIndexTextUtf16();
    return ret >>> 0;
}

/**
 * [`mcp_read_result`](mcp_result::mcp_read_result), as a plain JS `McpResult` object.
 *
 * # Errors
 *
 * Fails if `items` is not an array of `{ label, text }` objects.
 * @param {any} items
 * @param {number | null | undefined} max_item_chars
 * @param {number | null | undefined} max_result_chars
 * @param {string} nonce
 * @returns {any}
 */
export function mcpReadResult(items, max_item_chars, max_result_chars, nonce) {
    const ptr0 = passStringToWasm0(nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.mcpReadResult(items, !isLikeNone(max_item_chars), isLikeNone(max_item_chars) ? 0 : max_item_chars, !isLikeNone(max_result_chars), isLikeNone(max_result_chars) ? 0 : max_result_chars, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`mean_pressure`]; `undefined` when no sample reports pressure.
 * @param {Float64Array} samples
 * @returns {number | undefined}
 */
export function meanPressure(samples) {
    const ptr0 = passArrayF64ToWasm0(samples, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.meanPressure(ptr0, len0);
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * [`mention_rects`](analysis_text::mention_rects) as an array of rects (TS `mentionRects`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 * @param {any} items
 * @param {number} start
 * @param {number} end
 * @returns {any}
 */
export function mentionRects(items, start, end) {
    const ret = wasm.mentionRects(items, start, end);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::text_diff::merge_hunks`] for JS. Picks are keyed by hunk
 * index; only canonical decimal keys (`"0"`, not `"00"`) count, as in the TS.
 *
 * # Errors
 *
 * Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
 * `picks` is not an object of `HunkPick` values.
 * @param {string} ours
 * @param {string} theirs
 * @param {any} picks
 * @returns {string}
 */
export function mergeHunks(ours, theirs, picks) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(ours, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(theirs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.mergeHunks(ptr0, len0, ptr1, len1, picks);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * [`wf_core::sync::merge::merge_rows`] for JS, as `{ merged, conflicts }`.
 *
 * # Errors
 *
 * Fails when a row is not a plain object of JSON values.
 * @param {any} base
 * @param {any} local
 * @param {any} remote
 * @returns {any}
 */
export function mergeRows(base, local, remote) {
    const ret = wasm.mergeRows(base, local, remote);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::merge_vault_page::merge_vault_page`] for JS, as `VaultPageMerge`.
 *
 * # Errors
 *
 * Fails when a body or the base digest is over `MAX_INDEX_TEXT_UTF16` UTF-16
 * units, or when an argument is not a valid vault page shape.
 * @param {any} base
 * @param {any} folder
 * @param {any} workspace
 * @returns {any}
 */
export function mergeVaultPage(base, folder, workspace) {
    const ret = wasm.mergeVaultPage(base, folder, workspace);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`merge_wiki_pages`](wiki_merge::merge_wiki_pages).
 *
 * # Errors
 *
 * Fails if `primary` or `secondary` is not a `{ id, title, body, aliases?, sources? }` object.
 * @param {any} primary
 * @param {any} secondary
 * @returns {any}
 */
export function mergeWikiPages(primary, secondary) {
    const ret = wasm.mergeWikiPages(primary, secondary);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`validate_new_milestone`](milestone::validate_new_milestone): the validation message, or
 * `undefined` when the input is valid.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 * @param {any} input
 * @returns {string | undefined}
 */
export function milestoneInputError(input) {
    const ret = wasm.milestoneInputError(input);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`native_citation_mentions`] (TS `nativeCitationMentions`).
 *
 * # Errors
 *
 * Fails if any argument does not have the expected shape.
 * @param {any} page
 * @param {any} refs
 * @param {any} excluded
 * @returns {any}
 */
export function nativeCitationMentions(page, refs, excluded) {
    const ret = wasm.nativeCitationMentions(page, refs, excluded);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`needs_org_setup`](org::needs_org_setup).
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 * @param {any} state
 * @returns {boolean}
 */
export function needsOrgSetup(state) {
    const ret = wasm.needsOrgSetup(state);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`needs_standalone_role_sync`](member::needs_standalone_role_sync).
 *
 * # Errors
 *
 * Fails if `profile` or `memberships` has the wrong shape.
 * @param {any} profile
 * @param {any} memberships
 * @param {boolean} in_lab
 * @returns {boolean}
 */
export function needsStandaloneRoleSync(profile, memberships, in_lab) {
    const ret = wasm.needsStandaloneRoleSync(profile, memberships, in_lab);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`neutralise_context`](untrusted_context::neutralise_context).
 * @param {string} text
 * @param {string} nonce
 * @returns {string}
 */
export function neutraliseContext(text, nonce) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.neutraliseContext(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`next_match_index`]: wraparound step; -1 when `total` is 0.
 * @param {number} current
 * @param {number} total
 * @param {number} direction
 * @returns {number}
 */
export function nextMatchIndex(current, total, direction) {
    const ret = wasm.nextMatchIndex(current, total, direction);
    return ret;
}

/**
 * [`next_rotation`] (TS `nextRotation`); `delta` defaults to 90 in the TS wrapper.
 * @param {number} current
 * @param {number} delta
 * @returns {number}
 */
export function nextRotation(current, delta) {
    const ret = wasm.nextRotation(current, delta);
    return ret;
}

/**
 * [`nib_width`]; `velocity` defaults to 0.
 * @param {number} base
 * @param {number | null} [pressure]
 * @param {number | null} [velocity]
 * @param {number | null} [full_taper]
 * @returns {number}
 */
export function nibWidth(base, pressure, velocity, full_taper) {
    const ret = wasm.nibWidth(base, !isLikeNone(pressure), isLikeNone(pressure) ? 0 : pressure, !isLikeNone(velocity), isLikeNone(velocity) ? 0 : velocity, !isLikeNone(full_taper), isLikeNone(full_taper) ? 0 : full_taper);
    return ret;
}

/**
 * [`normalise_page_rotation`] (TS `normalisePageRotation`): 0, 90, 180 or 270.
 * @param {number} rotation
 * @returns {number}
 */
export function normalisePageRotation(rotation) {
    const ret = wasm.normalisePageRotation(rotation);
    return ret;
}

/**
 * [`normalise_whitespace`] as `{ normalised, map }`; `options` is `{ trim? }` or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object, or the result cannot be converted.
 * @param {string} text
 * @param {any} options
 * @returns {any}
 */
export function normaliseWhitespace(text, options) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.normaliseWhitespace(ptr0, len0, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`normalize_ai_access_settings`](access_policy::normalize_ai_access_settings); `undefined` reads as none.
 *
 * # Errors
 *
 * Fails if a field has the wrong JS type (for example a non-boolean `enabled`).
 * @param {any} input
 * @returns {any}
 */
export function normalizeAiAccessSettings(input) {
    const ret = wasm.normalizeAiAccessSettings(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`normalize_appearance`](user_appearance::normalize_appearance); `undefined` when
 * nothing is valid.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 * @param {any} raw
 * @returns {any}
 */
export function normalizeAppearance(raw) {
    const ret = wasm.normalizeAppearance(raw);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::papers::paper_ref::normalize_arxiv_id`]: the bare arXiv id in
 * `value`, or `None`.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} value
 * @returns {string | undefined}
 */
export function normalizeArxivId(value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.normalizeArxivId(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`normalize_color_value`](theme_config::normalize_color_value); `undefined` for a
 * non-string or a rejected color.
 * @param {any} raw
 * @returns {string | undefined}
 */
export function normalizeColorValue(raw) {
    const ret = wasm.normalizeColorValue(raw);
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`normalize_comment_input`](sharing::normalize_comment_input); a message throws as text.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 * @param {any} input
 * @returns {any}
 */
export function normalizeCommentInput(input) {
    const ret = wasm.normalizeCommentInput(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`normalize_doi`](paper::normalize_doi) (TS `normalizeDoi`). `None` becomes `undefined`.
 * @param {string | null} [doi]
 * @returns {string | undefined}
 */
export function normalizeDoi(doi) {
    var ptr0 = isLikeNone(doi) ? 0 : passStringToWasm0(doi, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.normalizeDoi(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`normalize_font_stack`](theme_config::normalize_font_stack); `undefined` for a
 * non-string or a rejected stack.
 * @param {any} raw
 * @returns {string | undefined}
 */
export function normalizeFontStack(raw) {
    const ret = wasm.normalizeFontStack(raw);
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`normalize_graph_view_settings`](graph_settings::normalize_graph_view_settings).
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 * @param {any} raw
 * @returns {any}
 */
export function normalizeGraphViewSettings(raw) {
    const ret = wasm.normalizeGraphViewSettings(raw);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * A length from a number (px) or a string, limited to `max_px` (default 64).
 * @param {any} raw
 * @param {number | null} [max_px]
 * @returns {string | undefined}
 */
export function normalizeLengthValue(raw, max_px) {
    const ret = wasm.normalizeLengthValue(raw, !isLikeNone(max_px), isLikeNone(max_px) ? 0 : max_px);
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`wf_core::sync::markdown_image::normalize_markdown_image_syntax`] for JS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} body
 * @returns {string}
 */
export function normalizeMarkdownImageSyntax(body) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.normalizeMarkdownImageSyntax(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`normalize_invite_code`](org::normalize_invite_code).
 * @param {string} input
 * @returns {string}
 */
export function normalizeOrgInviteCode(input) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.normalizeOrgInviteCode(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`normalize_paste_settings`] for JS. `json` is `JSON.stringify` of whatever was stored.
 *
 * # Errors
 *
 * Fails when `json` is not valid JSON or is over the text cap.
 * @param {string} json
 * @returns {any}
 */
export function normalizePasteSettings(json) {
    const ptr0 = passStringToWasm0(json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.normalizePasteSettings(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`normalize_project_path`](project_path::normalize_project_path) (TS `normalizeProjectPath`).
 * `None` becomes `undefined`.
 * @param {string} path
 * @returns {string | undefined}
 */
export function normalizeProjectPath(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.normalizeProjectPath(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`normalize_search_history`](search_history::normalize_search_history). Any
 * non-array input yields an empty list.
 *
 * # Errors
 *
 * Fails only if `raw` cannot be read as JSON-like data.
 * @param {any} raw
 * @param {number} max
 * @returns {string[]}
 */
export function normalizeSearchHistory(raw, max) {
    const ret = wasm.normalizeSearchHistory(raw, max);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * [`normalize_search_settings`](search_settings::normalize_search_settings); `undefined` when nothing valid remains.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 * @param {any} raw
 * @returns {any}
 */
export function normalizeSearchSettings(raw) {
    const ret = wasm.normalizeSearchSettings(raw);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`normalize_share_input`](sharing::normalize_share_input); a validation message throws as text.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or does not validate.
 * @param {any} input
 * @returns {any}
 */
export function normalizeShareInput(input) {
    const ret = wasm.normalizeShareInput(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`normalize_tags`](paper::normalize_tags) (TS `normalizeTags`).
 * @param {string[]} tags
 * @returns {string[]}
 */
export function normalizeTags(tags) {
    const ptr0 = passArrayJsValueToWasm0(tags, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.normalizeTags(ptr0, len0);
    var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * [`normalize_theme_config`](theme_config::normalize_theme_config): a stored config
 * re-checked, `null` when it no longer passes.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 * @param {any} raw
 * @returns {any}
 */
export function normalizeThemeConfig(raw) {
    const ret = wasm.normalizeThemeConfig(raw);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`normalize_title_key`](page::normalize_title_key) (TS `normalizeTitleKey`).
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitleKey(title) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.normalizeTitleKey(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`normalize_user_settings`](user_settings::normalize_user_settings).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 * @param {any} settings
 * @returns {any}
 */
export function normalizeUserSettings(settings) {
    const ret = wasm.normalizeUserSettings(settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`normalize_vector`](embedding::normalize_vector). Returns a new `Float32Array`.
 * @param {Float32Array} vector
 * @returns {Float32Array}
 */
export function normalizeVector(vector) {
    const ptr0 = passArrayF32ToWasm0(vector, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.normalizeVector(ptr0, len0);
    var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * [`original_range`](analysis_text::original_range) as `[start, end]` (TS `originalRange`).
 *
 * # Errors
 *
 * Fails if `view` is not a search text with `text`, `starts` and `ends`.
 * @param {any} view
 * @param {number} start
 * @param {number} end
 * @returns {any}
 */
export function originalRange(view, start, end) {
    const ret = wasm.originalRange(view, start, end);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`outline_from_text`](analysis_outline::outline_from_text) (TS `outlineFromText`).
 *
 * # Errors
 *
 * Fails if `allPages` is not an array of arrays of text items.
 * @param {any} all_pages
 * @returns {any}
 */
export function outlineFromText(all_pages) {
    const ret = wasm.outlineFromText(all_pages);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`outline_is_plausible`](analysis_outline::outline_is_plausible) (TS `outlineIsPlausible`).
 *
 * # Errors
 *
 * Fails if `headings` is not an array of `{ page }` objects.
 * @param {any} headings
 * @param {number} page_count
 * @returns {boolean}
 */
export function outlineIsPlausible(headings, page_count) {
    const ret = wasm.outlineIsPlausible(headings, page_count);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`outline_item_of`](document_analysis::outline_item_of) (TS `outlineItemOf`).
 *
 * # Errors
 *
 * Fails if `item` is not a pdf.js text item with a `transform` array.
 * @param {any} item
 * @param {number} page
 * @returns {any}
 */
export function outlineItemOf(item, page) {
    const ret = wasm.outlineItemOf(item, page);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`outline_text_lines`](analysis_outline::outline_text_lines) (TS `outlineTextLines`).
 *
 * # Errors
 *
 * Fails if `pages` is not an array of arrays of text items.
 * @param {any} pages
 * @returns {any}
 */
export function outlineTextLines(pages) {
    const ret = wasm.outlineTextLines(pages);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`pack_ink_stroke`] as `{ points, pressures }`; `options` is the TS
 * `InkStrokePackerOptions` or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object.
 * @param {Float64Array} points
 * @param {Float64Array} pressures
 * @param {any} options
 * @returns {any}
 */
export function packInkStroke(points, pressures, options) {
    const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(pressures, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.packInkStroke(ptr0, len0, ptr1, len1, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::papers::page_metadata::page_import_refusal`]: why `meta` cannot be
 * imported, or `None` when it can.
 *
 * # Errors
 *
 * Fails if `meta` is not a valid `PageMetadata` object.
 * @param {any} meta
 * @returns {string | undefined}
 */
export function pageImportRefusal(meta) {
    const ret = wasm.pageImportRefusal(meta);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`page_text_from_items`] over `{ str, hasEOL? }[]`.
 *
 * # Errors
 *
 * Fails if `items` is not an array of run objects.
 * @param {any} items
 * @returns {string}
 */
export function pageTextFromItems(items) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.pageTextFromItems(items);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`validate_new_paper_relation`](paper_relation::validate_new_paper_relation): the
 * validation message, or `undefined` when the input is valid.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 * @param {any} input
 * @returns {string | undefined}
 */
export function paperRelationInputError(input) {
    const ret = wasm.paperRelationInputError(input);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`parse_bib_entries`](bib_entries::parse_bib_entries) (TS `parseBibEntries`).
 *
 * # Errors
 *
 * Fails if `files` is not an array of `{ path, content }`.
 * @param {any} files
 * @returns {any}
 */
export function parseBibEntries(files) {
    const ret = wasm.parseBibEntries(files);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parseBibliography`](bibliography::parse_bibliography): every entry, or none when fewer than three.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 * @param {any} lines
 * @param {boolean} with_offsets
 * @returns {any}
 */
export function parseBibliography(lines, with_offsets) {
    const ret = wasm.parseBibliography(lines, with_offsets);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parseBibliographyEntry`](bibliography::parse_bibliography_entry): fields of one entry.
 *
 * # Errors
 *
 * Returns an error when `lines` is empty or does not deserialize as text lines, or the result fails to convert.
 * @param {any} lines
 * @param {number} index
 * @param {boolean} with_offsets
 * @returns {any}
 */
export function parseBibliographyEntry(lines, index, with_offsets) {
    const ret = wasm.parseBibliographyEntry(lines, index, with_offsets);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_dashboard_layout`](layout::parse_dashboard_layout); `null` when `lg` or `sm`
 * is not an array.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 * @param {any} raw
 * @returns {any}
 */
export function parseDashboardLayout(raw) {
    const ret = wasm.parseDashboardLayout(raw);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_graph_persisted_state`](graph_settings::parse_graph_persisted_state); `null` when absent.
 *
 * # Errors
 *
 * Fails if `raw` cannot be read as JSON.
 * @param {any} raw
 * @returns {any}
 */
export function parseGraphPersistedState(raw) {
    const ret = wasm.parseGraphPersistedState(raw);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::json_entities::parse_json_data`] for JS, as `null` when it is not a JSON array.
 *
 * # Errors
 *
 * Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `kind` is
 * not a known kind.
 * @param {string} path
 * @param {string} content
 * @param {any} kind
 * @returns {any}
 */
export function parseJsonData(path, content, kind) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.parseJsonData(ptr0, len0, ptr1, len1, kind);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_link_removal_text`] for JS: the textarea's rules, one per line.
 *
 * # Errors
 *
 * Fails when `text` is over the text cap.
 * @param {string} text
 * @returns {any}
 */
export function parseLinkRemovalText(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseLinkRemovalText(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::papers::paper_ref::parse_paper_ref`]: `value` as a `PaperRef`
 * (`PaperRef` in `bindings.ts`) of the given `kind`.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or if `kind`
 * is not a valid `PaperRefKind`.
 * @param {any} kind
 * @param {string} value
 * @returns {any}
 */
export function parsePaperRef(kind, value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parsePaperRef(kind, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::search::query::parse_query`]: the query split into terms, phrases,
 * exclusions and filters.
 *
 * # Errors
 *
 * Fails if `query` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} query
 * @returns {any}
 */
export function parseQuery(query) {
    const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseQuery(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_rollup_options`](paper_field::parse_rollup_options) (TS `parseRollupOptions`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string[]} options
 * @returns {any}
 */
export function parseRollupOptions(options) {
    const ptr0 = passArrayJsValueToWasm0(options, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseRollupOptions(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_theme_config`](theme_config::parse_theme_config); a non-string reads as empty.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 * @param {any} text
 * @returns {any}
 */
export function parseThemeConfig(text) {
    const ret = wasm.parseThemeConfig(text);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_wikilink_inner`](page::parse_wikilink_inner) (TS `parseWikilinkInner`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} inner
 * @param {string} raw
 * @returns {any}
 */
export function parseWikilinkInner(inner, raw) {
    const ptr0 = passStringToWasm0(inner, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.parseWikilinkInner(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::deserialize::parse_workspace_folder`] for JS, over `[path, content][]`.
 *
 * # Errors
 *
 * Fails when a path or content is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {any} files
 * @returns {any}
 */
export function parseWorkspaceFolder(files) {
    const ret = wasm.parseWorkspaceFolder(files);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`paste_lands_in_verbatim_context`] for JS. `offset` is in UTF-16 code units.
 *
 * # Errors
 *
 * Fails when `document` is over the text cap.
 * @param {string} document
 * @param {number} offset
 * @returns {boolean}
 */
export function pasteLandsInVerbatimContext(document, offset) {
    const ptr0 = passStringToWasm0(document, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pasteLandsInVerbatimContext(ptr0, len0, offset);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`pdf_point_to_screen`] as `{ x, y }` (TS `pdfPointToScreen`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 * @param {number} x
 * @param {number} y
 * @param {any} p
 * @returns {any}
 */
export function pdfPointToScreen(x, y, p) {
    const ret = wasm.pdfPointToScreen(x, y, p);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`pdf_rect_to_screen_box`] as `{ left, top, width, height }` (TS `pdfRectToScreenBox`).
 * `rect` is flat `[x1, y1, x2, y2]`; a short array reads missing entries as NaN.
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 * @param {Float64Array} rect
 * @param {any} p
 * @returns {any}
 */
export function pdfRectToScreenBox(rect, p) {
    const ptr0 = passArrayF64ToWasm0(rect, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pdfRectToScreenBox(ptr0, len0, p);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`personalized_page_rank`](personalized_pagerank::personalized_page_rank); `[{ node, score }]`
 * in first-visit order.
 *
 * # Errors
 *
 * Fails if `graph` or `options` has the wrong shape.
 * @param {any} graph
 * @param {string} seed
 * @param {any} options
 * @param {() => number} rng
 * @returns {any}
 */
export function personalizedPageRank(graph, seed, options, rng) {
    const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.personalizedPageRank(graph, ptr0, len0, options, rng);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`pick_nearest_match`] as `{ start, end }`, or `null` when there is no match.
 *
 * # Errors
 *
 * Fails if `matches` or `position` has the wrong shape.
 * @param {any} matches
 * @param {any} position
 * @returns {any}
 */
export function pickNearestMatch(matches, position) {
    const ret = wasm.pickNearestMatch(matches, position);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plan_bib_import`](bib_import::plan_bib_import) (TS `planBibImport`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string} file_name
 * @param {string} text
 * @param {string[]} existing_dois
 * @param {string[]} existing_keys
 * @returns {any}
 */
export function planBibImport(file_name, text, existing_dois, existing_keys) {
    const ptr0 = passStringToWasm0(file_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayJsValueToWasm0(existing_dois, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayJsValueToWasm0(existing_keys, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.planBibImport(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::snapshot_delta::plan_delta`] for JS. `remote` is `{ id, updatedAt }[]`
 * and `held` is `[id, stamp][]`, as the TS shell passes them.
 *
 * # Errors
 *
 * Fails when either argument does not have the expected shape.
 * @param {any} remote
 * @param {any} held
 * @returns {any}
 */
export function planDelta(remote, held) {
    const ret = wasm.planDelta(remote, held);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::folder_mirror::plan_mirror`] for JS: `files` is `[path, content][]`,
 * `asset_paths` and `previous_paths` are `string[]`, `base` is an optional
 * `{ [path]: digest }` and `disk` is `{ [path]: text }` for the paths the plan reads.
 * Returns the `MirrorResult` (`mirrored` and `bases` as `[path, value][]`).
 *
 * # Errors
 *
 * Fails when an argument has the wrong shape.
 * @param {any} files
 * @param {any} asset_paths
 * @param {any} previous_paths
 * @param {any} base
 * @param {any} disk
 * @returns {any}
 */
export function planMirror(files, asset_paths, previous_paths, base, disk) {
    const ret = wasm.planMirror(files, asset_paths, previous_paths, base, disk);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`point_in_polygon`]: is `(x, y)` inside the flat `x, y` polygon.
 * @param {Float64Array} polygon
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function pointInPolygon(polygon, x, y) {
    const ptr0 = passArrayF64ToWasm0(polygon, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pointInPolygon(ptr0, len0, x, y);
    return ret !== 0;
}

/**
 * [`prisma_caveat`](prisma_figure::prisma_caveat) (TS `prismaCaveat`). `None` becomes `undefined`.
 *
 * # Errors
 *
 * Fails if `counts` has the wrong shape.
 * @param {any} counts
 * @returns {string | undefined}
 */
export function prismaCaveat(counts) {
    const ret = wasm.prismaCaveat(counts);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`prisma_counts`](screening::prisma_counts) (TS `prismaCounts`).
 *
 * # Errors
 *
 * Fails if `items` or `decisions` has the wrong shape.
 * @param {any} items
 * @param {any} decisions
 * @returns {any}
 */
export function prismaCounts(items, decisions) {
    const ret = wasm.prismaCounts(items, decisions);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`prisma_figure_tex`](prisma_figure::prisma_figure_tex) (TS `prismaFigureTex`).
 *
 * # Errors
 *
 * Fails if `counts` or `options` has the wrong shape.
 * @param {any} counts
 * @param {any} options
 * @returns {string}
 */
export function prismaFigureTex(counts, options) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.prismaFigureTex(counts, options);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`wf_core::sync::folder_layout::project_dir`] for JS.
 *
 * # Errors
 *
 * Fails when `id` or `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} id
 * @param {string} name
 * @returns {string}
 */
export function projectDir(id, name) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.projectDir(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * [`wf_core::sync::folder_layout::project_meta_dir`] for JS.
 *
 * # Errors
 *
 * Fails when `project_root` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} project_root
 * @returns {string}
 */
export function projectMetaDir(project_root) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(project_root, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.projectMetaDir(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`project_name`](project_name): the trimmed name, or `undefined` when blank.
 * @param {string} name
 * @returns {string | undefined}
 */
export function projectName(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.projectName(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`projected_page_size`] as `{ width, height }` (TS `projectedPageSize`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 * @param {any} p
 * @returns {any}
 */
export function projectedPageSize(p) {
    const ret = wasm.projectedPageSize(p);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`push_ink_undo`](ink_undo::push_ink_undo).
 *
 * # Errors
 *
 * Fails if `state` or `entry` has the wrong shape.
 * @param {any} state
 * @param {any} entry
 * @returns {any}
 */
export function pushInkUndo(state, entry) {
    const ret = wasm.pushInkUndo(state, entry);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`quantize_ink_path`]; `decimals` defaults to 2.
 * @param {Float64Array} path
 * @param {number | null} [decimals]
 * @returns {Float64Array}
 */
export function quantizeInkPath(path, decimals) {
    const ptr0 = passArrayF64ToWasm0(path, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.quantizeInkPath(ptr0, len0, !isLikeNone(decimals), isLikeNone(decimals) ? 0 : decimals);
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * [`query_term_count`](hybrid_fusion::query_term_count).
 *
 * # Errors
 *
 * Fails if `terms` is not an array of strings.
 * @param {any} terms
 * @returns {number}
 */
export function queryTermCount(terms) {
    const ret = wasm.queryTermCount(terms);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`wf_core::sync::frontmatter::read_frontmatter`] for JS, as `ParsedDocument`.
 *
 * # Errors
 *
 * Fails when `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} content
 * @returns {any}
 */
export function readFrontmatter(content) {
    const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readFrontmatter(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::ink_note::read_ink_note_body`] for JS, as `{ meta, text }`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} body
 * @returns {any}
 */
export function readInkNoteBody(body) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readInkNoteBody(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`reader_keyboard_command`]: the `ReaderKeyboardCommand` for `event`, or `null`
 * when the event passes through.
 *
 * # Errors
 *
 * Fails if `event` is not a `ReaderKeyEvent` object.
 * @param {any} event
 * @returns {any}
 */
export function readerKeyboardCommand(event) {
    const ret = wasm.readerKeyboardCommand(event);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`reconstruct_lines`] as an array of `TextLine`. `keep` is an array of
 * per-item flags (the TS predicate, already applied) or undefined to keep all.
 *
 * # Errors
 *
 * Fails if `items` or `keep` is not an array of the expected shape.
 * @param {number} page
 * @param {any} items
 * @param {any} keep
 * @returns {any}
 */
export function reconstructLines(page, items, keep) {
    const ret = wasm.reconstructLines(page, items, keep);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rectangles_overlap`](analysis_text::rectangles_overlap) (TS `rectanglesOverlap`).
 * @param {Float64Array} a
 * @param {Float64Array} b
 * @returns {boolean}
 */
export function rectanglesOverlap(a, b) {
    const ptr0 = passArrayF64ToWasm0(a, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(b, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rectanglesOverlap(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * [`wf_core::sync::git_remote::redact_secret`] for JS.
 *
 * # Errors
 *
 * Fails when `text` or `secret` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} text
 * @param {string | null} [secret]
 * @returns {string}
 */
export function redactSecret(text, secret) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(secret) ? 0 : passStringToWasm0(secret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.redactSecret(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * [`reference_for_destination`](link_citations::reference_for_destination) (TS
 * `referenceForDestination`); `null` when no entry is found.
 *
 * # Errors
 *
 * Fails if `dest` or `refs` do not have the expected shape.
 * @param {any} dest
 * @param {any} refs
 * @returns {any}
 */
export function referenceForDestination(dest, refs) {
    const ret = wasm.referenceForDestination(dest, refs);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`refresh_ink_undo_annotation`](ink_undo::refresh_ink_undo_annotation).
 *
 * # Errors
 *
 * Fails if `state` or `annotation` has the wrong shape.
 * @param {any} state
 * @param {any} annotation
 * @returns {any}
 */
export function refreshInkUndoAnnotation(state, annotation) {
    const ret = wasm.refreshInkUndoAnnotation(state, annotation);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`related_by_ppr`](personalized_pagerank::related_by_ppr); `[{ id, score }]`, best first.
 *
 * # Errors
 *
 * Fails if `graph` or `options` has the wrong shape.
 * @param {any} graph
 * @param {string} seed
 * @param {number} limit
 * @param {any} options
 * @param {() => number} rng
 * @returns {any}
 */
export function relatedByPpr(graph, seed, limit, options, rng) {
    const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.relatedByPpr(graph, ptr0, len0, limit, options, rng);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::blob_links::relative_asset_paths`] for JS, as `[{ scope, path }]`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} body
 * @returns {any}
 */
export function relativeAssetPaths(body) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.relativeAssetPaths(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`remember_search_query`](search_history::remember_search_query).
 * @param {string[]} history
 * @param {string} query
 * @param {number} max
 * @returns {string[]}
 */
export function rememberSearchQuery(history, query, max) {
    const ptr0 = passArrayJsValueToWasm0(history, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.rememberSearchQuery(ptr0, len0, ptr1, len1, max);
    var v3 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * [`rename_ink_undo_id`](ink_undo::rename_ink_undo_id).
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 * @param {any} state
 * @param {string} from
 * @param {string} to
 * @returns {any}
 */
export function renameInkUndoId(state, from, to) {
    const ptr0 = passStringToWasm0(from, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(to, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.renameInkUndoId(state, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`replace_wiki_index`](wiki_index::replace_wiki_index).
 * @param {string} body
 * @param {string} index
 * @returns {string}
 */
export function replaceWikiIndex(body, index) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(index, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.replaceWikiIndex(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`validate_report_section_input`](report_section::validate_report_section_input): the
 * validation message, or `undefined` when the input is valid.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 * @param {any} input
 * @returns {string | undefined}
 */
export function reportSectionInputError(input) {
    const ret = wasm.reportSectionInputError(input);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`resample_ink_stroke`] as `{ points, pressures }`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {Float64Array} points
 * @param {Float64Array} pressures
 * @param {number | null} [spacing]
 * @returns {any}
 */
export function resampleInkStroke(points, pressures, spacing) {
    const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(pressures, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.resampleInkStroke(ptr0, len0, ptr1, len1, !isLikeNone(spacing), isLikeNone(spacing) ? 0 : spacing);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`resolve_annotation_conflict`] for a row and a choice string (any other choice merges).
 *
 * # Errors
 *
 * Fails if `row` is not a `ZoteroAnnotationSyncRow` object.
 * @param {any} row
 * @param {string} choice
 * @returns {any}
 */
export function resolveAnnotationConflict(row, choice) {
    const ptr0 = passStringToWasm0(choice, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.resolveAnnotationConflict(row, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`resolve_cite_key`](cite_key::resolve_cite_key) (TS `resolveCiteKey`).
 *
 * # Errors
 *
 * Fails if `paper` is not an object with a string `id`.
 * @param {any} paper
 * @returns {string}
 */
export function resolveCiteKey(paper) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.resolveCiteKey(paper);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`resolve_display_role`](member::resolve_display_role).
 * @param {string} role
 * @param {boolean} in_lab
 * @param {boolean} owns_org
 * @returns {string}
 */
export function resolveDisplayRole(role, in_lab, owns_org) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(role, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.resolveDisplayRole(ptr0, len0, in_lab, owns_org);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`resolve_join_assignment`](org::resolve_join_assignment). Returns `{ role, supervisorId }`.
 *
 * # Errors
 *
 * Fails with the message if the lab cannot take this invite type.
 * @param {string} target_role
 * @param {any} professor_ids
 * @param {any} phd_ids
 * @param {string | null} [professor_supervisor_id]
 * @param {string | null} [phd_supervisor_id]
 * @returns {any}
 */
export function resolveOrgJoinAssignment(target_role, professor_ids, phd_ids, professor_supervisor_id, phd_supervisor_id) {
    const ptr0 = passStringToWasm0(target_role, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(professor_supervisor_id) ? 0 : passStringToWasm0(professor_supervisor_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(phd_supervisor_id) ? 0 : passStringToWasm0(phd_supervisor_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.resolveOrgJoinAssignment(ptr0, len0, professor_ids, phd_ids, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`resolve_position_selector`] as `{ start, end }`, or `null` when unusable.
 *
 * # Errors
 *
 * Fails if `position` is not a position selector object.
 * @param {string} text
 * @param {any} position
 * @returns {any}
 */
export function resolvePositionSelector(text, position) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.resolvePositionSelector(ptr0, len0, position);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`resolve_supervisor_id`](member::resolve_supervisor_id).
 * @param {string} creator_id
 * @returns {string}
 */
export function resolveSupervisorId(creator_id) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(creator_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.resolveSupervisorId(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`resolve_text_anchor`] as `{ start, end, via, confidence }`, or `null`.
 *
 * # Errors
 *
 * Fails if `locus` is not a locus object.
 * @param {string} text
 * @param {any} locus
 * @returns {any}
 */
export function resolveTextAnchor(text, locus) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.resolveTextAnchor(ptr0, len0, locus);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`resolve_viewport_scale`] (TS `resolveViewportScale`); `state` is `{ scale, fit, rotation }`.
 *
 * # Errors
 *
 * Fails if an argument is not an object of the expected shape.
 * @param {any} state
 * @param {any} page
 * @param {any} container
 * @returns {number}
 */
export function resolveViewportScale(state, page, container) {
    const ret = wasm.resolveViewportScale(state, page, container);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`retry_fuzziness_for_term`](search_retry::retry_fuzziness_for_term).
 * @param {string} term
 * @param {boolean} retry
 * @returns {number}
 */
export function retryFuzzinessForTerm(term, retry) {
    const ptr0 = passStringToWasm0(term, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.retryFuzzinessForTerm(ptr0, len0, retry);
    return ret;
}

/**
 * [`safe_label`](untrusted_context::safe_label).
 * @param {string} label
 * @param {string} nonce
 * @returns {string}
 */
export function safeLabel(label, nonce) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.safeLabel(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`wf_core::workspace::safe_workspace_path`] for JS.
 *
 * # Errors
 *
 * Fails when `path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when the
 * path could leave the workspace root (`Unsafe workspace path: <path>`).
 * @param {string} path
 * @returns {string}
 */
export function safeWorkspacePath(path) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.safeWorkspacePath(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`wf_core::sync::merge::same_value`] for JS.
 *
 * # Errors
 *
 * Fails when a value is not JSON.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export function sameValue(a, b) {
    const ret = wasm.sameValue(a, b);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`screen_point_to_pdf`] as `{ x, y }` (TS `screenPointToPdf`).
 *
 * # Errors
 *
 * Fails if `p` is not a page projection object.
 * @param {number} sx
 * @param {number} sy
 * @param {any} p
 * @returns {any}
 */
export function screenPointToPdf(sx, sy, p) {
    const ret = wasm.screenPointToPdf(sx, sy, p);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`decision_error`](screening::decision_error) (TS `checkDecision`). The message, or
 * `undefined` when the decision may be recorded.
 *
 * # Errors
 *
 * Fails if `next` or `existing` has the wrong shape.
 * @param {any} next
 * @param {any} existing
 * @returns {string | undefined}
 */
export function screeningDecisionError(next, existing) {
    const ret = wasm.screeningDecisionError(next, existing);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`search_text_from_items`](analysis_text::search_text_from_items) (TS `searchTextFromItems`).
 *
 * # Errors
 *
 * Fails if `items` is not an array of text items.
 * @param {any} items
 * @returns {any}
 */
export function searchTextFromItems(items) {
    const ret = wasm.searchTextFromItems(items);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`segment_ink_lines`] over strokes passed flat: stroke `i`'s points are
 * `points[offsets[i]..offsets[i + 1]]`, `pen[i]` is 1 for a pen stroke, and
 * `t0s[i]` its start (NaN when missing). Returns line indices into the strokes.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {Float64Array} points
 * @param {Uint32Array} offsets
 * @param {Uint8Array} pen
 * @param {Float64Array} t0s
 * @param {number | null} [window_ms]
 * @param {number | null} [band_ratio]
 * @returns {any}
 */
export function segmentInkLines(points, offsets, pen, t0s, window_ms, band_ratio) {
    const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArray32ToWasm0(offsets, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArray8ToWasm0(pen, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ptr3 = passArrayF64ToWasm0(t0s, wasm.__wbindgen_malloc);
    const len3 = WASM_VECTOR_LEN;
    const ret = wasm.segmentInkLines(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, !isLikeNone(window_ms), isLikeNone(window_ms) ? 0 : window_ms, !isLikeNone(band_ratio), isLikeNone(band_ratio) ? 0 : band_ratio);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`selection_to_anchor`] as a `CombinedPdfAnchor`, or `null` when the selection is empty or out of range.
 *
 * # Errors
 *
 * Fails if `selection` or `page` is not the expected object shape, or the result cannot be converted.
 * @param {any} selection
 * @param {any} page
 * @returns {any}
 */
export function selectionToAnchor(selection, page) {
    const ret = wasm.selectionToAnchor(selection, page);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::serialize::serialize_workspace`] for JS, as `{ files, assets }`.
 *
 * # Errors
 *
 * Fails when the snapshot JSON is invalid, or the project id or name is over
 * `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} snapshot_json
 * @param {string} project_id
 * @param {string} project_name
 * @returns {any}
 */
export function serializeWorkspace(snapshot_json, project_id, project_name) {
    const ptr0 = passStringToWasm0(snapshot_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(project_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(project_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.serializeWorkspace(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`share_allows_comment`](sharing::share_allows_comment).
 *
 * # Errors
 *
 * Fails if `share` or `resource_type` has the wrong shape.
 * @param {any} share
 * @param {any} resource_type
 * @param {string} resource_id
 * @param {string} owner_id
 * @returns {boolean}
 */
export function shareAllowsComment(share, resource_type, resource_id, owner_id) {
    const ptr0 = passStringToWasm0(resource_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(owner_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.shareAllowsComment(share, resource_type, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`share_allows_edit`](sharing::share_allows_edit).
 *
 * # Errors
 *
 * Fails if `share` or `resource_type` has the wrong shape.
 * @param {any} share
 * @param {any} resource_type
 * @param {string} resource_id
 * @param {string} owner_id
 * @returns {boolean}
 */
export function shareAllowsEdit(share, resource_type, resource_id, owner_id) {
    const ptr0 = passStringToWasm0(resource_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(owner_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.shareAllowsEdit(share, resource_type, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`share_covers_resource`](sharing::share_covers_resource).
 *
 * # Errors
 *
 * Fails if `share` or `resource_type` has the wrong shape.
 * @param {any} share
 * @param {any} resource_type
 * @param {string} resource_id
 * @param {string} owner_id
 * @returns {boolean}
 */
export function shareCoversResource(share, resource_type, resource_id, owner_id) {
    const ptr0 = passStringToWasm0(resource_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(owner_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.shareCoversResource(share, resource_type, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`share_supports_edit_access`](sharing::share_supports_edit_access).
 *
 * # Errors
 *
 * Fails if `resource_type` is not a shareable type.
 * @param {any} resource_type
 * @param {string | null} [resource_id]
 * @returns {boolean}
 */
export function shareSupportsEditAccess(resource_type, resource_id) {
    var ptr0 = isLikeNone(resource_id) ? 0 : passStringToWasm0(resource_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.shareSupportsEditAccess(resource_type, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`short_sha`](experiment_status::short_sha); `undefined` when absent or empty.
 * @param {string | null} [sha]
 * @returns {string | undefined}
 */
export function shortSha(sha) {
    var ptr0 = isLikeNone(sha) ? 0 : passStringToWasm0(sha, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.shortSha(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`should_append_ink_point`]; `minDistance` defaults to 0.75.
 * @param {Float64Array} path
 * @param {number} x
 * @param {number} y
 * @param {number | null} [min_distance]
 * @returns {boolean}
 */
export function shouldAppendInkPoint(path, x, y, min_distance) {
    const ptr0 = passArrayF64ToWasm0(path, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.shouldAppendInkPoint(ptr0, len0, x, y, !isLikeNone(min_distance), isLikeNone(min_distance) ? 0 : min_distance);
    return ret !== 0;
}

/**
 * [`should_retry`](search_retry::should_retry).
 * @param {number} result_count
 * @param {number} term_count
 * @returns {boolean}
 */
export function shouldRetrySearch(result_count, term_count) {
    const ret = wasm.shouldRetrySearch(result_count, term_count);
    return ret !== 0;
}

/**
 * [`should_sync_standalone`](org::should_sync_standalone). `labs` is `null` when the
 * memberships could not be read.
 *
 * # Errors
 *
 * Fails if `profile` or `labs` has the wrong shape.
 * @param {any} profile
 * @param {any} labs
 * @returns {boolean}
 */
export function shouldSyncStandalone(profile, labs) {
    const ret = wasm.shouldSyncStandalone(profile, labs);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`show_concept_edges`](graph_settings::show_concept_edges).
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 * @param {any} settings
 * @returns {boolean}
 */
export function showConceptEdges(settings) {
    const ret = wasm.showConceptEdges(settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`show_relation_edges`](graph_settings::show_relation_edges).
 *
 * # Errors
 *
 * Fails if `settings` has the wrong shape.
 * @param {any} settings
 * @returns {boolean}
 */
export function showRelationEdges(settings) {
    const ret = wasm.showRelationEdges(settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`simplify_ink_path`]; `tolerance` defaults to 0.35.
 * @param {Float64Array} path
 * @param {number | null} [tolerance]
 * @returns {Float64Array}
 */
export function simplifyInkPath(path, tolerance) {
    const ptr0 = passArrayF64ToWasm0(path, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.simplifyInkPath(ptr0, len0, !isLikeNone(tolerance), isLikeNone(tolerance) ? 0 : tolerance);
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * [`simplify_path_indices`]; `tolerance` defaults to 0.35. Returns a JS array of indices.
 * @param {Float64Array} path
 * @param {number | null} [tolerance]
 * @returns {any}
 */
export function simplifyPathIndices(path, tolerance) {
    const ptr0 = passArrayF64ToWasm0(path, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.simplifyPathIndices(ptr0, len0, !isLikeNone(tolerance), isLikeNone(tolerance) ? 0 : tolerance);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`smooth_ink_stroke`] as `{ points, pressures }`; `options` is
 * `{ spacing?, passes? }` or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object.
 * @param {Float64Array} points
 * @param {Float64Array} pressures
 * @param {any} options
 * @returns {any}
 */
export function smoothInkStroke(points, pressures, options) {
    const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayF64ToWasm0(pressures, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.smoothInkStroke(ptr0, len0, ptr1, len1, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`sort_by_reading_order_indices`] as an array of input indices in reading order.
 *
 * # Errors
 *
 * Fails if `tagged` is not an array of `{ line, column }` objects.
 * @param {any} tagged
 * @returns {any}
 */
export function sortByReadingOrder(tagged) {
    const ret = wasm.sortByReadingOrder(tagged);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`splitBibliographyEntries`](bibliography::split_bibliography_entries): first format with three or more entries.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 * @param {any} lines
 * @returns {any}
 */
export function splitBibliographyEntries(lines) {
    const ret = wasm.splitBibliographyEntries(lines);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`splitByAuthorStart`](bibliography::split_by_author_start): entries by opening author name.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 * @param {any} lines
 * @returns {any}
 */
export function splitByAuthorStart(lines) {
    const ret = wasm.splitByAuthorStart(lines);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`splitByMargins`](bibliography::split_by_margins): unnumbered entries by left margin.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 * @param {any} lines
 * @returns {any}
 */
export function splitByMargins(lines) {
    const ret = wasm.splitByMargins(lines);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`splitNumberedEntries`](bibliography::split_numbered_entries): entries by label.
 *
 * # Errors
 *
 * Returns an error when `lines` does not deserialize as text lines, or the result fails to convert.
 * @param {any} lines
 * @returns {any}
 */
export function splitNumberedEntries(lines) {
    const ret = wasm.splitNumberedEntries(lines);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::stamp_workspace_id::stamp_workspace_id`] for JS; `null` when already stamped.
 *
 * # Errors
 *
 * Fails when `content` or `id` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} content
 * @param {string} id
 * @returns {string | undefined}
 */
export function stampWorkspaceId(content, id) {
    const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.stampWorkspaceId(ptr0, len0, ptr1, len1);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v3;
    if (ret[0] !== 0) {
        v3 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}

/**
 * [`status_patch_for_experiment`](experiment_status::status_patch_for_experiment).
 *
 * # Errors
 *
 * Fails if `experiment` or `status` has the wrong shape.
 * @param {any} experiment
 * @param {any} status
 * @param {string} now
 * @returns {any}
 */
export function statusPatchForExperiment(experiment, status, now) {
    const ptr0 = passStringToWasm0(now, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.statusPatchForExperiment(experiment, status, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`strip_frontmatter`](page::strip_frontmatter) (TS `stripFrontmatter`).
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} md
 * @returns {any}
 */
export function stripFrontmatter(md) {
    const ptr0 = passStringToWasm0(md, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.stripFrontmatter(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`strip_invisible`](analysis_text::strip_invisible) (TS `stripInvisible`).
 * @param {string} text
 * @returns {string}
 */
export function stripInvisible(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.stripInvisible(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`wf_core::sync::folder_layout::strip_kind_suffix`] for JS.
 *
 * # Errors
 *
 * Fails when `name` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} name
 * @returns {string}
 */
export function stripKindSuffix(name) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.stripKindSuffix(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`strip_stopwords`](hybrid_fusion::strip_stopwords).
 * @param {string} query
 * @returns {string}
 */
export function stripStopwords(query) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.stripStopwords(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`stroke_base_width`].
 * @param {Float64Array} samples
 * @param {number} base
 * @returns {number}
 */
export function strokeBaseWidth(samples, base) {
    const ptr0 = passArrayF64ToWasm0(samples, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.strokeBaseWidth(ptr0, len0, base);
    return ret;
}

/**
 * [`students_of`](member::students_of). Returns indices into `team`.
 *
 * # Errors
 *
 * Fails if `team` has the wrong shape.
 * @param {string | null | undefined} viewer_id
 * @param {any} team
 * @returns {any}
 */
export function studentsOf(viewer_id, team) {
    var ptr0 = isLikeNone(viewer_id) ? 0 : passStringToWasm0(viewer_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.studentsOf(ptr0, len0, team);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`surname_key`](analysis_text::surname_key) (TS `surnameKey`).
 * @param {string} name
 * @returns {string}
 */
export function surnameKey(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.surnameKey(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`tab_separated_to_markdown_table`] for JS, as `{ text, changed }`.
 *
 * # Errors
 *
 * Fails when `input` is over the text cap.
 * @param {string} input
 * @returns {any}
 */
export function tabSeparatedToMarkdownTable(input) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.tabSeparatedToMarkdownTable(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`take_ink_redo`](ink_undo::take_ink_redo); `null` when there is no step.
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 * @param {any} state
 * @returns {any}
 */
export function takeInkRedo(state) {
    const ret = wasm.takeInkRedo(state);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`take_ink_undo`](ink_undo::take_ink_undo); `null` when there is no step.
 *
 * # Errors
 *
 * Fails if `state` has the wrong shape.
 * @param {any} state
 * @returns {any}
 */
export function takeInkUndo(state) {
    const ret = wasm.takeInkUndo(state);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`text_fingerprint`](analysis_text::text_fingerprint) (TS `textFingerprint`).
 *
 * # Errors
 *
 * Fails if `texts` is not an array of strings.
 * @param {any} texts
 * @returns {string}
 */
export function textFingerprint(texts) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.textFingerprint(texts);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`theme_config_template`](theme_config::theme_config_template): the starter file.
 * @returns {string}
 */
export function themeConfigTemplate() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.themeConfigTemplate();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`title_from_file_name`](paper_title::title_from_file_name) (TS `titleFromFileName`).
 * @param {string} title
 * @returns {string}
 */
export function titleFromFileName(title) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.titleFromFileName(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`title_key`](paper_title::title_key) (TS `titleKey`). `None` becomes `undefined` in JS.
 * @param {string | null} [title]
 * @returns {string | undefined}
 */
export function titleKey(title) {
    var ptr0 = isLikeNone(title) ? 0 : passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.titleKey(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`title_similarity`](analysis_text::title_similarity) (TS `titleSimilarity`).
 * @param {string} left
 * @param {string} right
 * @returns {number}
 */
export function titleSimilarity(left, right) {
    const ptr0 = passStringToWasm0(left, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(right, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.titleSimilarity(ptr0, len0, ptr1, len1);
    return ret;
}

/**
 * [`wf_core::sync::blob_links::to_relative_blob_links`] for JS, as
 * `{ body, assets: [{ scheme, storagePath, folderPath }] }`.
 *
 * # Errors
 *
 * Fails when `body` or `file_path` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} body
 * @param {string} file_path
 * @returns {any}
 */
export function toRelativeBlobLinks(body, file_path) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(file_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.toRelativeBlobLinks(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_zotero_write_payload`] for one annotation under a parent item key.
 *
 * # Errors
 *
 * Fails if `ann` is not a `ZoteroAnnotationLocal` object.
 * @param {any} ann
 * @param {string} parent_item_key
 * @returns {any}
 */
export function toZoteroWritePayload(ann, parent_item_key) {
    const ptr0 = passStringToWasm0(parent_item_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.toZoteroWritePayload(ann, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::search::tokenizer::tokenize`]: search terms of `text`, deduplicated.
 *
 * # Errors
 *
 * Fails if `text` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units, or if
 * `options` is not a valid `TokenizerOptions` object.
 * @param {string} text
 * @param {any} options
 * @returns {any}
 */
export function tokenize(text, options) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.tokenize(ptr0, len0, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`translate_ink_paths`]; `decimals` defaults to 2. Returns an array of number arrays.
 * @param {any} paths
 * @param {number} dx
 * @param {number} dy
 * @param {number | null} [decimals]
 * @returns {any}
 */
export function translateInkPaths(paths, dx, dy, decimals) {
    const ret = wasm.translateInkPaths(paths, dx, dy, !isLikeNone(decimals), isLikeNone(decimals) ? 0 : decimals);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`unique_cite_key`](cite_key::unique_cite_key) (TS `uniqueCiteKey`). `used` is a JS array of
 * strings; the caller records the returned key.
 *
 * # Errors
 *
 * Fails if `paper` is not an object with a string `id`, or `used` is not an array of strings.
 * @param {any} paper
 * @param {any} used
 * @returns {string}
 */
export function uniqueCiteKey(paper, used) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.uniqueCiteKey(paper, used);
        var ptr1 = ret[0];
        var len1 = ret[1];
        if (ret[3]) {
            ptr1 = 0; len1 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred2_0 = ptr1;
        deferred2_1 = len1;
        return getStringFromWasm0(ptr1, len1);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`unique_title`](page::unique_title) (TS `uniqueTitle`). `used` holds normalized keys.
 * @param {string} base
 * @param {string[]} used
 * @returns {string}
 */
export function uniqueTitle(base, used) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(base, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(used, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.uniqueTitle(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`UNTRUSTED_CONTEXT_RULE`](untrusted_context::UNTRUSTED_CONTEXT_RULE).
 * @returns {string}
 */
export function untrustedContextRule() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.untrustedContextRule();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`validate_compute`](milestone::validate_compute): the validation message, or `undefined`
 * when the list is valid.
 *
 * # Errors
 *
 * Fails if `compute` has the wrong shape.
 * @param {any} compute
 * @returns {string | undefined}
 */
export function validateComputeError(compute) {
    const ret = wasm.validateComputeError(compute);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`validate_dependencies`](milestone::validate_dependencies): the validation message, or
 * `undefined` when the list is valid.
 *
 * # Errors
 *
 * Fails if `deps` has the wrong shape.
 * @param {any} deps
 * @returns {string | undefined}
 */
export function validateDependenciesError(deps) {
    const ret = wasm.validateDependenciesError(deps);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
}

/**
 * [`validate_new_member`](member::validate_new_member). Throws the validation message.
 *
 * # Errors
 *
 * Fails with the message if the request is invalid.
 * @param {string} email
 * @param {string} password
 * @param {string | null | undefined} full_name
 * @param {string} role
 * @param {string | null} [supervisor_id]
 * @returns {any}
 */
export function validateNewMember(email, password, full_name, role, supervisor_id) {
    const ptr0 = passStringToWasm0(email, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(password, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(full_name) ? 0 : passStringToWasm0(full_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ptr3 = passStringToWasm0(role, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len3 = WASM_VECTOR_LEN;
    var ptr4 = isLikeNone(supervisor_id) ? 0 : passStringToWasm0(supervisor_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len4 = WASM_VECTOR_LEN;
    const ret = wasm.validateNewMember(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`validate_org_name`](org::validate_org_name). Throws the validation message.
 *
 * # Errors
 *
 * Fails with the message if the name is blank or too long.
 * @param {string} name
 * @returns {string}
 */
export function validateOrgName(name) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.validateOrgName(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`validate_snapshot_title`](lab_snapshot::validate_snapshot_title). Throws on a blank title.
 * @param {string} title
 * @returns {string}
 */
export function validateSnapshotTitle(title) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.validateSnapshotTitle(ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`vault_asset_paths_in_body`](page::vault_asset_paths_in_body) (TS `vaultAssetPathsInBody`).
 * @param {string} body
 * @returns {string[]}
 */
export function vaultAssetPathsInBody(body) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.vaultAssetPathsInBody(ptr0, len0);
    var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * [`vault_body_preview`](page::vault_body_preview) (TS `vaultBodyPreview`). `max` counts UTF-16
 * units.
 * @param {string} body
 * @param {number} max
 * @returns {string}
 */
export function vaultBodyPreview(body, max) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vaultBodyPreview(ptr0, len0, max);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`vault_image_markdown`](page::vault_image_markdown) (TS `vaultImageMarkdown`).
 * @param {string} path
 * @param {string} alt
 * @returns {string}
 */
export function vaultImageMarkdown(path, alt) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(alt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.vaultImageMarkdown(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`wf_core::sync::merge_vault_page::vault_page_base`] for JS; `null` when the file is not a note.
 *
 * # Errors
 *
 * Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} path
 * @param {string} content
 * @returns {any}
 */
export function vaultPageBase(path, content) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.vaultPageBase(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::merge_vault_page::vault_page_side`] for JS; `null` when the file is not a note.
 *
 * # Errors
 *
 * Fails when `path` or `content` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} path
 * @param {string} content
 * @returns {any}
 */
export function vaultPageSide(path, content) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.vaultPageSide(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`verdict_for`](screening::verdict_for) (TS `verdictFor`).
 *
 * # Errors
 *
 * Fails if `decisions` or `stage` has the wrong shape.
 * @param {any} decisions
 * @param {string} item_id
 * @param {any} stage
 * @returns {any}
 */
export function verdictFor(decisions, item_id, stage) {
    const ptr0 = passStringToWasm0(item_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.verdictFor(decisions, ptr0, len0, stage);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`visual_page_size`] as `{ width, height }` (TS `visualPageSize`).
 *
 * # Errors
 *
 * Fails if `page` is not an object with `width` and `height`.
 * @param {any} page
 * @param {number} rotation
 * @returns {any}
 */
export function visualPageSize(page, rotation) {
    const ret = wasm.visualPageSize(page, rotation);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::workspace_snapshot::workspace_snapshot_counts`] for JS.
 *
 * # Errors
 *
 * Fails when the snapshot JSON is invalid.
 * @param {string} snapshot_json
 * @returns {any}
 */
export function workspaceSnapshotCounts(snapshot_json) {
    const ptr0 = passStringToWasm0(snapshot_json, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.workspaceSnapshotCounts(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::text_diff::write_conflict_markers`] for JS.
 *
 * # Errors
 *
 * Fails when either text is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} ours
 * @param {string} theirs
 * @returns {string}
 */
export function writeConflictMarkers(ours, theirs) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(ours, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(theirs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.writeConflictMarkers(ptr0, len0, ptr1, len1);
        var ptr3 = ret[0];
        var len3 = ret[1];
        if (ret[3]) {
            ptr3 = 0; len3 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * [`wf_core::sync::frontmatter::write_frontmatter`] for JS. Fields are written
 * in object key order; a `null` (JS `undefined`) value is skipped, as in the TS.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
 * `fields` is not an object.
 * @param {any} fields
 * @param {string} body
 * @returns {string}
 */
export function writeFrontmatter(fields, body) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.writeFrontmatter(fields, ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`wf_core::sync::ink_note::write_ink_note_body`] for JS.
 *
 * # Errors
 *
 * Fails when `text` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or when
 * `meta` is not an `InkNoteMeta` (unknown paper or hand included).
 * @param {any} meta
 * @param {string} text
 * @returns {string}
 */
export function writeInkNoteBody(meta, text) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.writeInkNoteBody(meta, ptr0, len0);
        var ptr2 = ret[0];
        var len2 = ret[1];
        if (ret[3]) {
            ptr2 = 0; len2 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred3_0 = ptr2;
        deferred3_1 = len2;
        return getStringFromWasm0(ptr2, len2);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`zoom_in`] (TS `zoomIn`); `step` defaults to 1.25 in the TS wrapper.
 * @param {number} scale
 * @param {number} step
 * @returns {number}
 */
export function zoomIn(scale, step) {
    const ret = wasm.zoomIn(scale, step);
    return ret;
}

/**
 * [`zoom_out`] (TS `zoomOut`); `step` defaults to 1.25 in the TS wrapper.
 * @param {number} scale
 * @param {number} step
 * @returns {number}
 */
export function zoomOut(scale, step) {
    const ret = wasm.zoomOut(scale, step);
    return ret;
}

/**
 * [`zotero_write_back_annotations`]: indices of the annotations a write-back sends.
 *
 * # Errors
 *
 * Fails if `annotations` is not an array of `ZoteroAnnotationLocal` objects.
 * @param {any} annotations
 * @returns {any}
 */
export function zoteroWriteBackAnnotations(annotations) {
    const ret = wasm.zoteroWriteBackAnnotations(annotations);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_30c8987f7c2ed4e2: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return ret;
        },
        __wbg_Number_14af1003b8dd5ead: function(arg0) {
            const ret = Number(arg0);
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_a2383202b9353e4c: function(arg0, arg1) {
            const v = arg1;
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_5b446f51afd21013: function(arg0) {
            const v = arg0;
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_4687d8d8c2017d52: function(arg0, arg1) {
            const ret = debugString(arg1);
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_92f62ee1427d9e49: function(arg0, arg1) {
            const ret = arg0 in arg1;
            return ret;
        },
        __wbg___wbindgen_is_bigint_b123553bed3bb382: function(arg0) {
            const ret = typeof(arg0) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_1f9d30630b8b1d3d: function(arg0) {
            const ret = typeof(arg0) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_e343b7d08827ba72: function(arg0) {
            const ret = arg0 === null;
            return ret;
        },
        __wbg___wbindgen_is_object_3c45d4f2dde4e749: function(arg0) {
            const val = arg0;
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_90b56bc79aad6f6c: function(arg0) {
            const ret = typeof(arg0) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_8865fb403f8fe9d8: function(arg0) {
            const ret = arg0 === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_02babf21faa37971: function(arg0, arg1) {
            const ret = arg0 === arg1;
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_677f21e468d6b461: function(arg0, arg1) {
            const ret = arg0 == arg1;
            return ret;
        },
        __wbg___wbindgen_number_get_2e0e7dee9f701a71: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_string_get_0380ccaa2f57f0d9: function(arg0, arg1) {
            const obj = arg1;
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_41e9ee4f547fc59a: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg_call_6137034ef55c9d0f: function() { return handleError(function (arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        }, arguments); },
        __wbg_call_76331f27d05f75b0: function(arg0, arg1) {
            const ret = arg0.call(arg1);
            return ret;
        },
        __wbg_done_b41a1d26cdb37fb6: function(arg0) {
            const ret = arg0.done;
            return ret;
        },
        __wbg_entries_fb6397112b1de25f: function(arg0) {
            const ret = Object.entries(arg0);
            return ret;
        },
        __wbg_get_658f6698067d9515: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(arg0, arg1);
            return ret;
        }, arguments); },
        __wbg_get_6c896e0571ddae51: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_unchecked_288889d017702237: function(arg0, arg1) {
            const ret = arg0[arg1 >>> 0];
            return ret;
        },
        __wbg_get_with_ref_key_6412cf3094599694: function(arg0, arg1) {
            const ret = arg0[arg1];
            return ret;
        },
        __wbg_instanceof_ArrayBuffer_a99f175873e5d9b8: function(arg0) {
            let result;
            try {
                result = arg0 instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Map_b2611749102d7ba3: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Map;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_828cef2aaacafc31: function(arg0) {
            let result;
            try {
                result = arg0 instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_e15a2ff68ffdbef2: function(arg0) {
            const ret = Array.isArray(arg0);
            return ret;
        },
        __wbg_isSafeInteger_717808ad6a54bd9e: function(arg0) {
            const ret = Number.isSafeInteger(arg0);
            return ret;
        },
        __wbg_iterator_e3c31c892080e444: function() {
            const ret = Symbol.iterator;
            return ret;
        },
        __wbg_length_7f3c00c40364105e: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_length_d4bdea10311bd9cf: function(arg0) {
            const ret = arg0.length;
            return ret;
        },
        __wbg_new_1dbf7428bba60a42: function(arg0) {
            const ret = new Uint8Array(arg0);
            return ret;
        },
        __wbg_new_28744009d011f847: function() {
            const ret = new Map();
            return ret;
        },
        __wbg_new_617a8cdb8bb1130e: function() {
            const ret = new Object();
            return ret;
        },
        __wbg_new_ee2291f50781bf1d: function() {
            const ret = new Array();
            return ret;
        },
        __wbg_next_33784799010f1bbe: function(arg0) {
            const ret = arg0.next;
            return ret;
        },
        __wbg_next_f4aac29c42af995c: function() { return handleError(function (arg0) {
            const ret = arg0.next();
            return ret;
        }, arguments); },
        __wbg_prototypesetcall_bc27214492979395: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), arg2);
        },
        __wbg_set_6ae97e73113c4f0b: function(arg0, arg1, arg2) {
            const ret = arg0.set(arg1, arg2);
            return ret;
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            arg0[arg1] = arg2;
        },
        __wbg_set_bea140a88be9b277: function(arg0, arg1, arg2) {
            arg0[arg1 >>> 0] = arg2;
        },
        __wbg_value_f3c585ee8f5ba40c: function(arg0) {
            const ret = arg0.value;
            return ret;
        },
        __wbindgen_generic_0000000000000001: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000002: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return ret;
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return ret;
        },
        __wbindgen_generic_0000000000000004: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return ret;
        },
        __wbindgen_init_externref_table: function() {
            const table = wasm.__wbindgen_externrefs;
            const offset = table.grow(4);
            table.set(0, undefined);
            table.set(offset + 0, undefined);
            table.set(offset + 1, null);
            table.set(offset + 2, true);
            table.set(offset + 3, false);
        },
    };
    return {
        __proto__: null,
        "./wf_wasm_bg.js": import0,
    };
}

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function getArrayF32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
}

function getArrayF64FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getFloat64ArrayMemory0().subarray(ptr / 8, ptr / 8 + len);
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(wasm.__wbindgen_externrefs.get(mem.getUint32(i, true)));
    }
    wasm.__externref_drop_slice(ptr, len);
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

let cachedFloat32ArrayMemory0 = null;
function getFloat32ArrayMemory0() {
    if (cachedFloat32ArrayMemory0 === null || cachedFloat32ArrayMemory0.byteLength === 0) {
        cachedFloat32ArrayMemory0 = new Float32Array(wasm.memory.buffer);
    }
    return cachedFloat32ArrayMemory0;
}

let cachedFloat64ArrayMemory0 = null;
function getFloat64ArrayMemory0() {
    if (cachedFloat64ArrayMemory0 === null || cachedFloat64ArrayMemory0.byteLength === 0) {
        cachedFloat64ArrayMemory0 = new Float64Array(wasm.memory.buffer);
    }
    return cachedFloat64ArrayMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint32ArrayMemory0 = null;
function getUint32ArrayMemory0() {
    if (cachedUint32ArrayMemory0 === null || cachedUint32ArrayMemory0.byteLength === 0) {
        cachedUint32ArrayMemory0 = new Uint32Array(wasm.memory.buffer);
    }
    return cachedUint32ArrayMemory0;
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        const idx = addToExternrefTable0(e);
        wasm.__wbindgen_exn_store(idx);
    }
}

function isLikeNone(x) {
    return x === undefined || x === null;
}

function passArray32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getUint32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArray8ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 1, 1) >>> 0;
    getUint8ArrayMemory0().set(arg, ptr / 1);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF32ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 4, 4) >>> 0;
    getFloat32ArrayMemory0().set(arg, ptr / 4);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
    return ptr;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    for (let i = 0; i < array.length; i++) {
        const add = addToExternrefTable0(array[i]);
        getDataViewMemory0().setUint32(ptr + 4 * i, add, true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeFromExternrefTable0(idx) {
    const value = wasm.__wbindgen_externrefs.get(idx);
    wasm.__externref_table_dealloc(idx);
    return value;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedFloat32ArrayMemory0 = null;
    cachedFloat64ArrayMemory0 = null;
    cachedUint32ArrayMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    wasm.__wbindgen_start();
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('wf_wasm_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
