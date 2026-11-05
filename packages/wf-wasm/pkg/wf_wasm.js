/* @ts-self-types="./wf_wasm.d.ts" */

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
 * [`is_reader_annotation_type`] for any JS value: false unless `value` is a string.
 * @param {any} value
 * @returns {boolean}
 */
export function isReaderAnnotationType(value) {
    const ret = wasm.isReaderAnnotationType(value);
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

function passArrayF64ToWasm0(arg, malloc) {
    const ptr = malloc(arg.length * 8, 8) >>> 0;
    getFloat64ArrayMemory0().set(arg, ptr / 8);
    WASM_VECTOR_LEN = arg.length;
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
