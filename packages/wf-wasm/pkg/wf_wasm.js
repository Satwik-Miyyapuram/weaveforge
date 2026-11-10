/* @ts-self-types="./wf_wasm.d.ts" */

/**
 * [`ArchiveBudget`](archive::ArchiveBudget): the caps an import is held to, checked as
 * entries are inflated. `limits` is `{ maxTotalBytes, maxFileBytes, maxEntries }`.
 */
export class ArchiveBudget {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ArchiveBudgetFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_archivebudget_free(ptr, 0);
    }
    /**
     * [`admit`](archive::ArchiveBudget::admit). `original_size` is a JS number; the
     * cast saturates, so a huge declared size is refused rather than wrapped.
     *
     * # Errors
     *
     * Throws past the entry count or the total cap.
     * @param {string} name
     * @param {number} original_size
     * @returns {boolean}
     */
    admit(name, original_size) {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.archivebudget_admit(this.__wbg_ptr, ptr0, len0, original_size);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return ret[0] !== 0;
    }
    /**
     * # Errors
     *
     * Fails if `limits` has the wrong shape.
     * @param {any} limits
     */
    constructor(limits) {
        const ret = wasm.archivebudget_new(limits);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        ArchiveBudgetFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Names refused as over the file cap, in archive order.
     * @returns {string[]}
     */
    get oversize() {
        const ret = wasm.archivebudget_oversize(this.__wbg_ptr);
        var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v1;
    }
}
if (Symbol.dispose) ArchiveBudget.prototype[Symbol.dispose] = ArchiveBudget.prototype.free;

/**
 * The live packer: [`CorePacker`] fed one pen sample at a time, so the
 * stroke drawn while writing is the one saved on lift.
 */
export class InkStrokePacker {
    static __wrap(ptr) {
        const obj = Object.create(InkStrokePacker.prototype);
        obj.__wbg_ptr = ptr;
        InkStrokePackerFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        InkStrokePackerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_inkstrokepacker_free(ptr, 0);
    }
    /**
     * The kept points so far, then the pen's latest sample, as flat x,y pairs.
     * @returns {Float64Array}
     */
    points() {
        const ret = wasm.inkstrokepacker_points(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * One pressure byte per point of [`InkStrokePacker::points`].
     * @returns {Float64Array}
     */
    pressures() {
        const ret = wasm.inkstrokepacker_pressures(this.__wbg_ptr);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * Adds the pen's next sample, in 0.1 mm, with its 0-255 pressure if it
     * has one. A non-finite sample is skipped.
     * @param {number} x
     * @param {number} y
     * @param {number | null} [pressure]
     */
    push(x, y, pressure) {
        wasm.inkstrokepacker_push(this.__wbg_ptr, x, y, !isLikeNone(pressure), isLikeNone(pressure) ? 0 : pressure);
    }
}
if (Symbol.dispose) InkStrokePacker.prototype[Symbol.dispose] = InkStrokePacker.prototype.free;

/**
 * [`NibFilter`](CoreNibFilter): the pen-level filter (position and pressure, one state).
 */
export class NibFilter {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        NibFilterFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_nibfilter_free(ptr, 0);
    }
    /**
     * Filter one raw sample. Returns `[x, y, pressure, velocity, t]`.
     * @param {number} x
     * @param {number} y
     * @param {number} pressure
     * @param {number} t
     * @returns {Float64Array}
     */
    filter(x, y, pressure, t) {
        const ret = wasm.nibfilter_filter(this.__wbg_ptr, x, y, pressure, t);
        var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
        return v1;
    }
    /**
     * `position` and `pressure` are each `{ minCutoff, beta, derivativeCutoff }`.
     * @param {any} position
     * @param {any} pressure
     */
    constructor(position, pressure) {
        const ret = wasm.nibfilter_new(position, pressure);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        NibFilterFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Start a new stroke: no state carries over from the last one.
     */
    reset() {
        wasm.nibfilter_reset(this.__wbg_ptr);
    }
    /**
     * Put back a state from [`Self::save`].
     * @param {NibFilterSnapshot} snapshot
     */
    restore(snapshot) {
        _assertClass(snapshot, NibFilterSnapshot);
        wasm.nibfilter_restore(this.__wbg_ptr, snapshot.__wbg_ptr);
    }
    /**
     * Snapshot the state, to pass to [`Self::restore`] later.
     * @returns {NibFilterSnapshot}
     */
    save() {
        const ret = wasm.nibfilter_save(this.__wbg_ptr);
        return NibFilterSnapshot.__wrap(ret);
    }
    /**
     * The filter's own speed estimate for the newest sample, for diagnostics.
     * @returns {number}
     */
    get speed() {
        const ret = wasm.nibfilter_speed(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) NibFilter.prototype[Symbol.dispose] = NibFilter.prototype.free;

/**
 * An opaque snapshot of a [`NibFilter`], for [`NibFilter::restore`].
 */
export class NibFilterSnapshot {
    static __wrap(ptr) {
        const obj = Object.create(NibFilterSnapshot.prototype);
        obj.__wbg_ptr = ptr;
        NibFilterSnapshotFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        NibFilterSnapshotFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_nibfiltersnapshot_free(ptr, 0);
    }
}
if (Symbol.dispose) NibFilterSnapshot.prototype[Symbol.dispose] = NibFilterSnapshot.prototype.free;

/**
 * [`OneEuroFilter`](CoreOneEuroFilter): one scalar channel, held across calls.
 */
export class OneEuroFilter {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        OneEuroFilterFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_oneeurofilter_free(ptr, 0);
    }
    /**
     * Filter one sample taken at `time` milliseconds; returns the filtered value.
     * @param {number} value
     * @param {number} time
     * @returns {number}
     */
    filter(value, time) {
        const ret = wasm.oneeurofilter_filter(this.__wbg_ptr, value, time);
        return ret;
    }
    /**
     * The last filtered value, or `undefined` before the first sample.
     * @returns {number | undefined}
     */
    get last() {
        const ret = wasm.oneeurofilter_last(this.__wbg_ptr);
        return ret[0] === 0 ? undefined : ret[1];
    }
    /**
     * `options` is `{ minCutoff, beta, derivativeCutoff }`.
     * @param {any} options
     */
    constructor(options) {
        const ret = wasm.oneeurofilter_new(options);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        this.__wbg_ptr = ret[0];
        OneEuroFilterFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * Forget everything, as at pen-down.
     */
    reset() {
        wasm.oneeurofilter_reset(this.__wbg_ptr);
    }
    /**
     * The last estimated speed, in value units per millisecond.
     * @returns {number}
     */
    get speed() {
        const ret = wasm.oneeurofilter_speed(this.__wbg_ptr);
        return ret;
    }
}
if (Symbol.dispose) OneEuroFilter.prototype[Symbol.dispose] = OneEuroFilter.prototype.free;

/**
 * Brute-force cosine index over normalized vectors.
 */
export class VectorIndex {
    static __wrap(ptr) {
        const obj = Object.create(VectorIndex.prototype);
        obj.__wbg_ptr = ptr;
        VectorIndexFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VectorIndexFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_vectorindex_free(ptr, 0);
    }
    /**
     * Insert or replace; `values` is `ids.length * dimensions` long and is all-or-nothing.
     *
     * # Errors
     *
     * Fails when `ids` is not a string array or `values` has the wrong length.
     * @param {string[]} ids
     * @param {Float32Array} values
     */
    add(ids, values) {
        const ptr0 = passArrayF32ToWasm0(values, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vectorindex_add(this.__wbg_ptr, ids, ptr0, len0);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Every id held, in slot order.
     * @returns {string[]}
     */
    allIds() {
        const ret = wasm.vectorindex_allIds(this.__wbg_ptr);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * Drop every vector.
     */
    clear() {
        wasm.vectorindex_clear(this.__wbg_ptr);
    }
    /**
     * The width every vector must have.
     * @returns {number}
     */
    get dimensions() {
        const ret = wasm.vectorindex_dimensions(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * Whether `id` is held.
     * @param {string} id
     * @returns {boolean}
     */
    has(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vectorindex_has(this.__wbg_ptr, ptr0, len0);
        return ret !== 0;
    }
    /**
     * Remove by id; unknown ids are ignored.
     *
     * # Errors
     *
     * Fails when `ids` is not a string array.
     * @param {string[]} ids
     */
    remove(ids) {
        const ret = wasm.vectorindex_remove(this.__wbg_ptr, ids);
        if (ret[1]) {
            throw takeFromExternrefTable0(ret[0]);
        }
    }
    /**
     * Top `limit` by cosine similarity, best first; scores below `minScore` are dropped.
     *
     * # Errors
     *
     * Fails when `query` is not the index width.
     * @param {Float32Array} query
     * @param {number} limit
     * @param {number} min_score
     * @returns {{ id: string; score: number }[]}
     */
    search(query, limit, min_score) {
        const ptr0 = passArrayF32ToWasm0(query, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vectorindex_search(this.__wbg_ptr, ptr0, len0, limit, min_score);
        if (ret[2]) {
            throw takeFromExternrefTable0(ret[1]);
        }
        return takeFromExternrefTable0(ret[0]);
    }
    /**
     * How many vectors are held.
     * @returns {number}
     */
    get size() {
        const ret = wasm.vectorindex_size(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * The packed bytes; read back with `vectorIndexFromBytes`.
     * @returns {Uint8Array}
     */
    toBytes() {
        const ret = wasm.vectorindex_toBytes(this.__wbg_ptr);
        var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
        return v1;
    }
    /**
     * The stored unit vector for `id`; empty when absent (dimensions are at least 1).
     * @param {string} id
     * @returns {Float32Array}
     */
    vectorOf(id) {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.vectorindex_vectorOf(this.__wbg_ptr, ptr0, len0);
        var v2 = getArrayF32FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
        return v2;
    }
}
if (Symbol.dispose) VectorIndex.prototype[Symbol.dispose] = VectorIndex.prototype.free;

/**
 * [`account_menu::account_attention`]: the menu rows and the icon total as `{ rows, total }`.
 *
 * # Errors
 *
 * Fails if `input` is not an `AccountAttentionInput`-shaped object, or the result cannot be converted to JS.
 * @param {any} input
 * @returns {any}
 */
export function accountAttention(input) {
    const ret = wasm.accountAttention(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`account_links::account_links`]: the account block's rows as `{ id, label, href?, external? }`.
 *
 * # Errors
 *
 * Fails if `input` is not an `AccountLinksInput`-shaped object, or the result cannot be converted to JS.
 * @param {any} input
 * @returns {any}
 */
export function accountLinks(input) {
    const ret = wasm.accountLinks(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

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
 * [`activate_tab`](pane::activate_tab).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @param {string} pane_id
 * @param {number} index
 * @returns {any}
 */
export function activateTab(layout, pane_id, index) {
    const ptr0 = passStringToWasm0(pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.activateTab(layout, ptr0, len0, index);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`active_tab`](pane::active_tab). Takes a leaf.
 *
 * # Errors
 *
 * Fails if `leaf` has the wrong shape.
 * @param {any} leaf
 * @returns {any}
 */
export function activeTab(leaf) {
    const ret = wasm.activeTab(leaf);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`active_tab_key`](pane::active_tab_key).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @returns {any}
 */
export function activeTabKey(layout) {
    const ret = wasm.activeTabKey(layout);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`active_tab_ref`](pane::active_tab_ref).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @returns {any}
 */
export function activeTabRef(layout) {
    const ret = wasm.activeTabRef(layout);
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
 * [`add_days`](feed::add_days): `iso` moved by `days` calendar days.
 *
 * # Errors
 *
 * Throws if `iso` is not a real `yyyy-mm-dd` date.
 * @param {string} iso
 * @param {number} days
 * @returns {string}
 */
export function addDays(iso, days) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(iso, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.addDays(ptr0, len0, days);
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
 * [`added_notice`]: what an add says.
 * @param {boolean} created
 * @returns {string}
 */
export function addedNotice(created) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.addedNotice(created);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
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
 * [`align_series`]: overlaid runs on one union step axis, gaps as `null`.
 * @param {any} series
 * @returns {any}
 */
export function alignSeries(series) {
    const ret = wasm.alignSeries(series);
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
 * [`anchor_at`](text_anchor::anchor_at): the anchor, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string} text
 * @param {number} start
 * @param {number} end
 * @returns {any}
 */
export function anchorAt(text, start, end) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.anchorAt(ptr0, len0, start, end);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`annotation_doc_id`](search_document::annotation_doc_id).
 * @param {string} annotation_id
 * @returns {string}
 */
export function annotationDocId(annotation_id) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(annotation_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.annotationDocId(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`annotation_identity`] (TS `sameAnnotation`): the key two annotations share when they are
 * the same mark.
 *
 * # Errors
 *
 * Fails if `annotation` is not a JSON-like object.
 * @param {any} annotation
 * @returns {string}
 */
export function annotationIdentity(annotation) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.annotationIdentity(annotation);
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
 * [`to_domain`](annotation_pin::to_domain) (TS `annotationPinToDomain`).
 *
 * # Errors
 *
 * Fails if `row` is not an annotation pin row, or the result cannot be converted.
 * @param {any} row
 * @returns {any}
 */
export function annotationPinToDomain(row) {
    const ret = wasm.annotationPinToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_domain`]: an `annotation_quotation_types` row as a domain value. Throws on an unknown type.
 * @param {any} row
 * @returns {any}
 */
export function annotationQuotationTypeRowToDomain(row) {
    const ret = wasm.annotationQuotationTypeRowToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`append_paper_note`]: the note with `addition` appended, or `undefined` when the addition is
 * blank.
 * @param {string | null | undefined} existing
 * @param {string} addition
 * @returns {string | undefined}
 */
export function appendPaperNote(existing, addition) {
    var ptr0 = isLikeNone(existing) ? 0 : passStringToWasm0(existing, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(addition, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.appendPaperNote(ptr0, len0, ptr1, len1);
    let v3;
    if (ret[0] !== 0) {
        v3 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}

/**
 * [`append_tag_hashtags`](note_tags::append_tag_hashtags). `tag_names` is an array of tag names.
 *
 * # Errors
 *
 * Fails if `tag_names` is not an array of strings.
 * @param {string} body
 * @param {any} tag_names
 * @returns {string}
 */
export function appendTagHashtags(body, tag_names) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.appendTagHashtags(ptr0, len0, tag_names);
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
 * [`apply_group_command`](groups::apply_group_command).
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 * @param {any} leaf
 * @param {number} index
 * @param {any} command
 * @returns {any}
 */
export function applyGroupCommand(leaf, index, command) {
    const ret = wasm.applyGroupCommand(leaf, index, command);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`apply_template`](tpl::apply_template). A null or undefined `existing` counts as empty.
 *
 * # Errors
 *
 * Fails if the context is not a plain object.
 * @param {string | null | undefined} existing
 * @param {string} template
 * @param {any} context_value
 * @returns {string}
 */
export function applyTemplate(existing, template, context_value) {
    let deferred4_0;
    let deferred4_1;
    try {
        var ptr0 = isLikeNone(existing) ? 0 : passStringToWasm0(existing, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(template, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.applyTemplate(ptr0, len0, ptr1, len1, context_value);
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
 * [`apply_op`](text_ot::apply_op): `text` with `op` applied.
 *
 * # Errors
 *
 * Fails when the op does not fit the text, or the op cannot be read.
 * @param {string} text
 * @param {any} op
 * @returns {string}
 */
export function applyTextOp(text, op) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.applyTextOp(ptr0, len0, op);
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
 * [`artifact_basename`](artifact_refs::artifact_basename) (TS `artifactBasename`).
 * @param {string} name
 * @returns {string}
 */
export function artifactBasename(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.artifactBasename(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`wf_core::papers::open_access::arxiv_candidates`]: arXiv's PDF and HTML copies.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string} arxiv_id
 * @returns {any}
 */
export function arxivCandidates(arxiv_id) {
    const ptr0 = passStringToWasm0(arxiv_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.arxivCandidates(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`arxiv_entry_to_metadata`] (TS `arxivEntryToMetadata`). The first entry of an arXiv Atom
 * feed as a paper.
 *
 * # Errors
 *
 * Fails when the feed has no usable entry for `arxiv_id`.
 * @param {string} xml
 * @param {string} arxiv_id
 * @returns {any}
 */
export function arxivEntryToMetadata(xml, arxiv_id) {
    const ptr0 = passStringToWasm0(xml, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(arxiv_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.arxivEntryToMetadata(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`ask_prompt`](ask_library::ask_prompt): `{ system, user }` for the sources as passed.
 * @param {string} question
 * @param {any} sources
 * @param {string} nonce
 * @returns {any}
 */
export function askPrompt(question, sources, nonce) {
    const ptr0 = passStringToWasm0(question, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(nonce, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.askPrompt(ptr0, len0, sources, ptr1, len1);
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
 * [`unsafe_export_path_error`](export_path::unsafe_export_path_error): the refusal message, or
 * `undefined` when the path is a safe relative ZIP entry name.
 * @param {string} path
 * @returns {string | undefined}
 */
export function assertSafeExportPath(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.assertSafeExportPath(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`asset_extension`](asset_mime::asset_extension): lowercased extension of a path, `png` when none.
 * @param {string} path
 * @returns {string}
 */
export function assetExtension(path) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.assetExtension(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`asset_mime_type`](asset_mime::asset_mime_type): content type for an imported asset's extension.
 * @param {string} ext
 * @returns {string}
 */
export function assetMimeType(ext) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(ext, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.assetMimeType(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`asset_path`](folder_layout::asset_path). `scope` is `"notes"`, `"papers"` or `"report"`.
 *
 * # Errors
 *
 * Fails on any other scope.
 * @param {string} scope
 * @param {string} storage_path
 * @returns {string}
 */
export function assetPath(scope, storage_path) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(scope, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(storage_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.assetPath(ptr0, len0, ptr1, len1);
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
 * [`axis_spec`](plot_size::axis_spec) for a tier name (`PlotTier` in `bindings.ts`).
 *
 * # Errors
 *
 * Fails if `tier` is not one of the three tier names.
 * @param {string} tier
 * @returns {any}
 */
export function axisSpec(tier) {
    const ptr0 = passStringToWasm0(tier, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.axisSpec(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`backlinks_for_annotation`](backlinks::backlinks_for_annotation) as an array of targets.
 *
 * # Errors
 *
 * Fails if `hits` is not an array of hits.
 * @param {any} hits
 * @param {string} annotation_id
 * @returns {any}
 */
export function backlinksForAnnotation(hits, annotation_id) {
    const ptr0 = passStringToWasm0(annotation_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.backlinksForAnnotation(hits, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`bib_import_message`](paper_drop::bib_import_message) (TS `bibImportMessage`).
 * @param {number} added
 * @param {number} skipped
 * @param {number} problems
 * @returns {string}
 */
export function bibImportMessage(added, skipped, problems) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.bibImportMessage(added, skipped, problems);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`bib_paper_input`](bib_import::bib_paper_input) (TS `bibPaperInput`).
 *
 * # Errors
 *
 * Fails if `entry` cannot be read as a planned `.bib` entry.
 * @param {any} entry
 * @returns {any}
 */
export function bibPaperInput(entry) {
    const ret = wasm.bibPaperInput(entry);
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
 * [`blank_ink_page`](ink_page::blank_ink_page): an empty A4 page on `paper`, `blank` by default.
 *
 * # Errors
 *
 * Fails if `paper` is not a known paper name.
 * @param {any} paper
 * @returns {any}
 */
export function blankInkPage(paper) {
    const ret = wasm.blankInkPage(paper);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`blob_provider_for_runtime`]. `configured` is `tiered` or anything else for Supabase.
 *
 * # Errors
 *
 * Fails if `runtime` is not `{ inBrowser, publicProvider? }`, or the result cannot be converted to JS.
 * @param {string} configured
 * @param {any} runtime
 * @returns {any}
 */
export function blobProviderForRuntime(configured, runtime) {
    const ptr0 = passStringToWasm0(configured, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.blobProviderForRuntime(ptr0, len0, runtime);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`body_stats`](stats::body_stats).
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {string} body
 * @returns {any}
 */
export function bodyStats(body) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.bodyStats(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`local_first_route::both_ends_merge`]: `"serverError"`, `"preferLocalRows"` or `"concatRows"`.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 * @param {string} name
 * @param {boolean} here_failed
 * @param {boolean} there_failed
 * @returns {any}
 */
export function bothEndsMerge(name, here_failed, there_failed) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.bothEndsMerge(ptr0, len0, here_failed, there_failed);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`bounded_body`](search_document::bounded_body).
 * @param {string} body
 * @returns {string}
 */
export function boundedBody(body) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.boundedBody(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`breadcrumbs`](crumbs::breadcrumbs) as an array of crumbs.
 *
 * # Errors
 *
 * Fails if `tab`, `files` or `lists` does not have the shape of its type.
 * @param {any} tab
 * @param {any} files
 * @param {any} lists
 * @returns {any}
 */
export function breadcrumbs(tab, files, lists) {
    const ret = wasm.breadcrumbs(tab, files, lists);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`build_graph_data`](graph_build::build_graph_data): nodes, links and lookups for one graph view.
 *
 * # Errors
 *
 * Fails if the input has the wrong shape, or the result cannot be serialised.
 * @param {any} input
 * @returns {any}
 */
export function buildGraphData(input) {
    const ret = wasm.buildGraphData(input);
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
 * [`build_lists_tree`](tree::build_lists_tree). `input` is a `ListsTreeInput`.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 * @param {any} input
 * @returns {any}
 */
export function buildListsTree(input) {
    const ret = wasm.buildListsTree(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`build_page_tree`](page::build_page_tree) over the summary fields of each page.
 *
 * # Errors
 *
 * Fails if `pages` has the wrong shape.
 * @param {any} pages
 * @returns {any}
 */
export function buildPageTree(pages) {
    const ret = wasm.buildPageTree(pages);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`build_paper_html_document`]: the framed, self-contained document for one kept paper.
 *
 * # Errors
 *
 * Fails if `page` is not a paper page object, or `options` is not an options object.
 * @param {any} page
 * @param {any} options
 * @returns {string}
 */
export function buildPaperHtmlDocument(page, options) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.buildPaperHtmlDocument(page, options);
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
 * [`build_propose_fill_prompt`]: the prompt that asks the AI to fill one column.
 * @param {any} input
 * @returns {string}
 */
export function buildProposeFillPrompt(input) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.buildProposeFillPrompt(input);
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
 * [`build_reference_index`]: analyzes the pages and shapes the overlay's index.
 *
 * # Errors
 *
 * Fails if `pages` or `outline` do not have the expected shape.
 * @param {any} pages
 * @param {any} outline
 * @returns {any}
 */
export function buildReferenceIndex(pages, outline) {
    const ret = wasm.buildReferenceIndex(pages, outline);
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
 * [`build_workspace_tree`](tree::build_workspace_tree).
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 * @param {any} input
 * @returns {any}
 */
export function buildWorkspaceTree(input) {
    const ret = wasm.buildWorkspaceTree(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`try_cache_path_segments`](model_cache::try_cache_path_segments): the segments a cache URL
 * names under the cache root, or `null` when it names none or would leave the root.
 *
 * # Errors
 *
 * Throws on a URL that does not parse, or a path escape `decodeURIComponent` rejects, as the
 * TS did.
 * @param {string} url
 * @returns {string[] | undefined}
 */
export function cachePathSegments(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.cachePathSegments(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    let v2;
    if (ret[0] !== 0) {
        v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    }
    return v2;
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
 * [`can_drop`](edit::can_drop).
 *
 * # Errors
 *
 * Fails if an argument does not have the expected shape, or the result cannot be serialised.
 * @param {any} source
 * @param {any} target
 * @returns {any}
 */
export function canDrop(source, target) {
    const ret = wasm.canDrop(source, target);
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
 * [`can_rename`](edit::can_rename).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 * @param {any} node
 * @returns {any}
 */
export function canRename(node) {
    const ret = wasm.canRename(node);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`canonical_ai_tool_name`](ai_tool_name::canonical_ai_tool_name).
 * @param {string} name
 * @returns {string}
 */
export function canonicalAiToolName(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.canonicalAiToolName(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`card_snippet::card_snippet`]: plain-text preview of `body`, cut to `max` UTF-16 units.
 *
 * # Errors
 *
 * Fails if `body` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} body
 * @param {number} max
 * @returns {string}
 */
export function cardSnippet(body, max) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.cardSnippet(ptr0, len0, max);
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
 * [`check_git_remote_url`](wf_core::sync::git_remote::check_git_remote_url); a
 * non-string `raw` is refused (TS `checkGitRemoteUrl`).
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {any} raw
 * @returns {any}
 */
export function checkGitRemoteUrl(raw) {
    const ret = wasm.checkGitRemoteUrl(raw);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`check_ink_chunk_body`](chunk::check_ink_chunk_body): the layout and page header of a body
 * that passed every check.
 *
 * # Errors
 *
 * Fails on a body whose tables do not add up.
 * @param {Uint8Array} body
 * @returns {any}
 */
export function checkInkChunkBody(body) {
    const ptr0 = passArray8ToWasm0(body, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.checkInkChunkBody(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`check_link_folder`]: whether a vault-relative folder may be linked, and its normalised form.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 * @param {string} raw
 * @returns {any}
 */
export function checkOverleafLinkFolder(raw) {
    const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.checkOverleafLinkFolder(ptr0, len0);
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
 * [`citation_alert_message`] for JS (TS `citationAlertMessage`).
 *
 * # Errors
 *
 * Fails when `input` is not a citation alert input with the expected fields.
 * @param {any} input
 * @returns {string}
 */
export function citationAlertMessage(input) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.citationAlertMessage(input);
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
 * [`citation_alert_score`](citation_alerts::citation_alert_score) of each candidate, in order.
 *
 * # Errors
 *
 * Fails if `candidates` has the wrong shape.
 * @param {any} candidates
 * @returns {Float64Array}
 */
export function citationAlertScores(candidates) {
    const ret = wasm.citationAlertScores(candidates);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * [`citation_alert_track_from_row`](citation_alert_track::citation_alert_track_from_row):
 * the domain track for a stored row (null `last_checked_at` reads as absent, null
 * `seen_citing_ids` as empty).
 *
 * # Errors
 *
 * Fails if `row` has the wrong shape.
 * @param {any} row
 * @returns {any}
 */
export function citationAlertTrackFromRow(row) {
    const ret = wasm.citationAlertTrackFromRow(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`citation_contexts`](semantic_scholar_citation::citation_contexts): trimmed snippets, or
 * nothing when none remain.
 *
 * # Errors
 *
 * Fails if the value cannot be read as JSON.
 * @param {any} raw
 * @returns {any}
 */
export function citationContexts(raw) {
    const ret = wasm.citationContexts(raw);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`external_id_ref`](semantic_scholar_citation::external_id_ref): the lookup reference for
 * a paper's external ids, or nothing.
 *
 * # Errors
 *
 * Fails if `ids` has the wrong shape.
 * @param {any} ids
 * @returns {any}
 */
export function citationExternalIdRef(ids) {
    const ret = wasm.citationExternalIdRef(ids);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`intent_label`](citation_alerts::intent_label) of one candidate, or `undefined` when it has no intents.
 *
 * # Errors
 *
 * Fails if `candidate` has the wrong shape.
 * @param {any} candidate
 * @returns {string | undefined}
 */
export function citationIntentLabel(candidate) {
    const ret = wasm.citationIntentLabel(candidate);
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
 * [`citation_intents`](semantic_scholar_citation::citation_intents): the known intents, or
 * nothing when none remain.
 *
 * # Errors
 *
 * Fails if the value cannot be read as JSON.
 * @param {any} raw
 * @returns {any}
 */
export function citationIntents(raw) {
    const ret = wasm.citationIntents(raw);
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
 * [`cite_key_of`](bib_import::cite_key_of) (TS `citeKeyOf`).
 *
 * # Errors
 *
 * Fails if `metadata` cannot be read as a JSON value.
 * @param {any} metadata
 * @returns {any}
 */
export function citeKeyOf(metadata) {
    const ret = wasm.citeKeyOf(metadata);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`cited_sources`](retrieval::cited_sources): the 1-based source numbers an answer cites, in
 * first-citation order, out of `count` sources.
 *
 * # Errors
 *
 * Fails if the numbers cannot be converted to a JS value.
 * @param {string} answer
 * @param {number} count
 * @returns {any}
 */
export function citedSourceNumbers(answer, count) {
    const ptr0 = passStringToWasm0(answer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.citedSourceNumbers(ptr0, len0, count);
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
 * [`clamp_ink_page_size`](ink_page::clamp_ink_page_size): `{ width, height }` clamped to `Int16`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {number} width
 * @param {number} height
 * @returns {any}
 */
export function clampInkPageSize(width, height) {
    const ret = wasm.clampInkPageSize(width, height);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`claude_code_commands`](mcp_client_config::claude_code_commands).
 * @returns {string}
 */
export function claudeCodeCommands() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.claudeCodeCommands();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`wf_core::papers::open_access::clean_arxiv_id`]: the cleaned arXiv id, or `None`.
 * @param {string | null} [id]
 * @returns {string | undefined}
 */
export function cleanArxivId(id) {
    var ptr0 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.cleanArxivId(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`clean_groups`](groups::clean_groups).
 *
 * # Errors
 *
 * Fails if `leaf` has the wrong shape.
 * @param {any} leaf
 * @returns {any}
 */
export function cleanGroups(leaf) {
    const ret = wasm.cleanGroups(leaf);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`wf_core::papers::open_access::clean_pmcid`]: the cleaned PMCID, or `None`.
 * @param {string | null} [id]
 * @returns {string | undefined}
 */
export function cleanPmcid(id) {
    var ptr0 = isLikeNone(id) ? 0 : passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.cleanPmcid(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
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
 * [`clean_widget_palette`]: the palette if every key is valid, else `null`.
 *
 * # Errors
 *
 * Fails if `value` cannot be read as JSON, or the result cannot be converted to JS.
 * @param {any} value
 * @returns {any}
 */
export function cleanWidgetPalette(value) {
    const ret = wasm.cleanWidgetPalette(value);
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
 * [`clip_segment_to_area`](clip::clip_segment_to_area) as `{ from, to }`, or `null`.
 *
 * # Errors
 *
 * Fails only if the arguments cannot be read or the result cannot be serialised.
 * @param {any} area
 * @param {any} from
 * @param {any} to
 * @returns {any}
 */
export function clipSegmentToArea(area, from, to) {
    const ret = wasm.clipSegmentToArea(area, from, to);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`clone_links`] (TS `cloneLinks`): links with string endpoints, every other field kept.
 *
 * # Errors
 *
 * Fails if `links` is not an array of JSON values.
 * @param {any} links
 * @returns {any}
 */
export function cloneLinks(links) {
    const ret = wasm.cloneLinks(links);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`close_tab`](pane::close_tab).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @param {string} pane_id
 * @param {number} index
 * @returns {any}
 */
export function closeTab(layout, pane_id, index) {
    const ptr0 = passStringToWasm0(pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.closeTab(layout, ptr0, len0, index);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`closed_tabs`](pane::closed_tabs).
 *
 * # Errors
 *
 * Fails if a layout has the wrong shape.
 * @param {any} before
 * @param {any} after
 * @returns {any}
 */
export function closedTabs(before, after) {
    const ret = wasm.closedTabs(before, after);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`cluster_marks`](timeline::cluster_marks): marks nearer than `min_gap` stacked into clusters.
 *
 * # Errors
 *
 * Fails if `marks` has the wrong shape.
 * @param {any} marks
 * @param {number} min_gap
 * @returns {any}
 */
export function clusterMarks(marks, min_gap) {
    const ret = wasm.clusterMarks(marks, min_gap);
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
 * [`codex_toml`](mcp_client_config::codex_toml) for a `McpLaunchLine`.
 *
 * # Errors
 *
 * Fails if `launch` has the wrong shape.
 * @param {any} launch
 * @returns {string}
 */
export function codexToml(launch) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.codexToml(launch);
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
 * [`coerce_paper_field_value`] (TS `coercePaperFieldValue`). `null` or blank clears the value
 * (returns `null`); a refusal throws an `Error` with the wf-core message.
 *
 * # Errors
 *
 * Fails if `kind` is not a field kind, if `value` is not a string, number, or string list,
 * or if the value is refused for `kind`.
 * @param {any} kind
 * @param {any} value
 * @returns {any}
 */
export function coercePaperFieldValue(kind, value) {
    const ret = wasm.coercePaperFieldValue(kind, value);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`cold_blob_client_config`]. `null` when any cold-tier field is unset or empty.
 *
 * # Errors
 *
 * Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
 * @param {any} fields
 * @returns {any}
 */
export function coldBlobClientConfig(fields) {
    const ret = wasm.coldBlobClientConfig(fields);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`collapse_alert`]: the short form of a citation alert as `{ shown, hidden }`, or
 * `undefined` when the entry is not a long citation alert.
 * @param {string} headline
 * @param {string} rest
 * @returns {any}
 */
export function collapseAlert(headline, rest) {
    const ptr0 = passStringToWasm0(headline, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(rest, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.collapseAlert(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`collapse_hits`](result_dedupe::collapse_hits) as `{id, score}` objects.
 *
 * # Errors
 *
 * Fails if `hits` is not an array of hit records.
 * @param {any} hits
 * @param {string} seed_entity_id
 * @returns {any}
 */
export function collapseToEntities(hits, seed_entity_id) {
    const ptr0 = passStringToWasm0(seed_entity_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.collapseToEntities(hits, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`collect_annotation_image_regions`](ops::collect_annotation_image_regions).
 *
 * # Errors
 *
 * Fails if the annotations do not have the shape of a TS `ReaderAnnotation`,
 * or the result cannot be serialised.
 * @param {any} annotations
 * @returns {any}
 */
export function collectAnnotationImageRegions(annotations) {
    const ret = wasm.collectAnnotationImageRegions(annotations);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`collect_cited_keys`](bibtex::collect_cited_keys): the keys a LaTeX body cites, as an array.
 * @param {string} latex
 * @returns {any}
 */
export function collectCitedKeys(latex) {
    const ptr0 = passStringToWasm0(latex, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.collectCitedKeys(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`collect_list_ids`]: every list id in the tree, parents before children.
 * @param {any} tree
 * @returns {any}
 */
export function collectListIds(tree) {
    const ret = wasm.collectListIds(tree);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`collect_new_hits`](related_paper_hit::collect_new_hits): adds the new candidates up to the limit.
 *
 * # Errors
 *
 * Fails if `input` cannot be read as a collect input.
 * @param {any} input
 * @returns {any}
 */
export function collectNewHits(input) {
    const ret = wasm.collectNewHits(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`colour_tool_for`]: returns `"pen"`, `"highlighter"`, `"text"` or `"highlight"`.
 * @param {boolean} pen_open
 * @param {string} pen_tool
 * @param {string} picked_tool
 * @returns {string}
 */
export function colourToolFor(pen_open, pen_tool, picked_tool) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(pen_tool, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(picked_tool, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.colourToolFor(pen_open, ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`command_for_chord`](keys::command_for_chord). `tab_count` is omitted for an unbounded count.
 *
 * # Errors
 *
 * Fails if `chord` has the wrong shape.
 * @param {any} chord
 * @param {number | null} [tab_count]
 * @returns {any}
 */
export function commandForChord(chord, tab_count) {
    const ret = wasm.commandForChord(chord, isLikeNone(tab_count) ? Number.MAX_SAFE_INTEGER : (tab_count) >>> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`command_match_indices`](palette_groups::command_match_indices): every index for an empty
 * query, else the page rule.
 *
 * # Errors
 *
 * Fails if `query` is too long or `labels` is not an array of strings.
 * @param {any} labels
 * @param {string} query
 * @returns {any}
 */
export function commandMatchIndices(labels, query) {
    const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.commandMatchIndices(labels, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`comment_from_row`](sharing::comment_from_row): a `comments` row as the app's `Comment`.
 *
 * # Errors
 *
 * Fails if `row` does not have the `comments` columns.
 * @param {any} row
 * @returns {any}
 */
export function commentFromRow(row) {
    const ret = wasm.commentFromRow(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`commit_url`](repo_web_url::commit_url): a commit's web URL, or `undefined`.
 * @param {string | null} [repo_url]
 * @param {string | null} [sha]
 * @returns {string | undefined}
 */
export function commitUrl(repo_url, sha) {
    var ptr0 = isLikeNone(repo_url) ? 0 : passStringToWasm0(repo_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(sha) ? 0 : passStringToWasm0(sha, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.commitUrl(ptr0, len0, ptr1, len1);
    let v3;
    if (ret[0] !== 0) {
        v3 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}

/**
 * [`communities`](node_colouring::communities): `[id, rank]` pairs, rank 0 for the biggest.
 *
 * # Errors
 *
 * Fails if `ids` or `edges` has the wrong shape.
 * @param {any} ids
 * @param {any} edges
 * @returns {any}
 */
export function communities(ids, edges) {
    const ret = wasm.communities(ids, edges);
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
 * [`compute_rollup_for_papers`] (TS `computeRollupsForPapers`). One call fills a rollup column
 * for every listed paper; `null` where the rollup has no value.
 * @param {any} paper_ids
 * @param {any} rollup
 * @param {any} defs
 * @param {any} values
 * @returns {any}
 */
export function computeRollupsForPapers(paper_ids, rollup, defs, values) {
    const ret = wasm.computeRollupsForPapers(paper_ids, rollup, defs, values);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`concept_key`](extraction::concept_key).
 * @param {string} name
 * @returns {string}
 */
export function conceptKey(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.conceptKey(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`conflict_route`] for JS (TS `conflictRoute`).
 *
 * # Errors
 *
 * Fails when `input` is not a conflict input.
 * @param {any} input
 * @returns {any}
 */
export function conflictRoute(input) {
    const ret = wasm.conflictRoute(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`container_resize`]: `last` and `next` are `{ width, height }`. Returns `"ignore"`, `"now"` or `"settle"`.
 *
 * # Errors
 *
 * Fails if either argument is not a `{ width, height }` object of numbers.
 * @param {any} last
 * @param {any} next
 * @returns {string}
 */
export function containerResize(last, next) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.containerResize(last, next);
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
 * [`context_nonce_from`](ai_tool_name::context_nonce_from): the caller passes the
 * `Math.random()` values.
 * @param {Float64Array} randoms
 * @returns {string}
 */
export function contextNonceFrom(randoms) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArrayF64ToWasm0(randoms, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.contextNonceFrom(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
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
 * [`count_action_list`](folder_merge::count_action_list): the tally over bare actions.
 *
 * # Errors
 *
 * Fails when `actions` is not a list of import actions.
 * @param {any} actions
 * @returns {any}
 */
export function countActionList(actions) {
    const ret = wasm.countActionList(actions);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`count_actions`](folder_merge::count_actions).
 *
 * # Errors
 *
 * Fails when `entries` is not a list of import entries.
 * @param {any} entries
 * @returns {any}
 */
export function countActions(entries) {
    const ret = wasm.countActions(entries);
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
 * [`count_section_sources`](section_sources::count_section_sources) (TS `countSectionSources`).
 * An absent or empty body counts 0.
 * @param {string | null} [body]
 * @returns {number}
 */
export function countSectionSources(body) {
    var ptr0 = isLikeNone(body) ? 0 : passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.countSectionSources(ptr0, len0);
    return ret >>> 0;
}

/**
 * [`count_words`](text::count_words): runs of non-whitespace in `text`.
 * @param {string} text
 * @returns {number}
 */
export function countWords(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.countWords(ptr0, len0);
    return ret >>> 0;
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
 * [`creatable_under`](edit::creatable_under).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 * @param {any} node
 * @returns {any}
 */
export function creatableUnder(node) {
    const ret = wasm.creatableUnder(node);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`create_experiment`](experiments::create_experiment) with the id and time supplied. Invalid
 * input fails with the TS validation message.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or its name is blank.
 * @param {any} input
 * @param {string} id
 * @param {string} now
 * @returns {any}
 */
export function createExperimentWith(input, id, now) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(now, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.createExperimentWith(input, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * A new [`InkStrokePacker`]; `options` is the TS `InkStrokePackerOptions`
 * or undefined.
 *
 * # Errors
 *
 * Fails if `options` is not an options object.
 * @param {any} options
 * @returns {InkStrokePacker}
 */
export function createInkStrokePacker(options) {
    const ret = wasm.createInkStrokePacker(options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return InkStrokePacker.__wrap(ret[0]);
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
 * [`create_reading_list`](reading_list::create_reading_list) with the id and time supplied.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape or the name is blank.
 * @param {any} input
 * @param {string} id
 * @param {string} now
 * @returns {any}
 */
export function createReadingListWith(input, id, now) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(now, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.createReadingListWith(input, ptr0, len0, ptr1, len1);
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
 * [`create_vault_page`](page::create_vault_page) with the id and time supplied.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape, or with the validation message when the title is blank.
 * @param {any} input
 * @param {string} id
 * @param {string} now
 * @returns {any}
 */
export function createVaultPageWith(input, id, now) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(now, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.createVaultPageWith(input, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * An empty index `dimensions` wide.
 *
 * # Errors
 *
 * Fails when `dimensions` is zero.
 * @param {number} dimensions
 * @returns {VectorIndex}
 */
export function createVectorIndex(dimensions) {
    const ret = wasm.createVectorIndex(dimensions);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return VectorIndex.__wrap(ret[0]);
}

/**
 * [`created_page_index`](proposal_created_page::created_page_index). `item` is a proposal with
 * `kind` and `payload`; `pages` is a list of pages with `title` and `parentId`. Returns the
 * index into `pages`, or `null`.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 * @param {any} item
 * @param {any} pages
 * @returns {any}
 */
export function createdPageIndex(item, pages) {
    const ret = wasm.createdPageIndex(item, pages);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`creation_kind_for`](edit::creation_kind_for). `activeKind` is `null` when no document is open.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 * @param {string | null} [active_kind]
 * @returns {any}
 */
export function creationKindFor(active_kind) {
    var ptr0 = isLikeNone(active_kind) ? 0 : passStringToWasm0(active_kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.creationKindFor(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`creation_target`](edit::creation_target). `active` is `null` when no document is open,
 * `folders` the ids of the notes made as folders.
 *
 * # Errors
 *
 * Fails if an argument does not have the expected shape, or the result cannot be serialised.
 * @param {any} kind
 * @param {any} active
 * @param {any} folders
 * @returns {any}
 */
export function creationTarget(kind, active, folders) {
    const ret = wasm.creationTarget(kind, active, folders);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`crop_figure_to`](figure::crop_figure_to): a figure re-cropped to `kept` inside `full`.
 *
 * # Errors
 *
 * Fails if `full` or `kept` has the wrong shape.
 * @param {any} full
 * @param {any} kept
 * @returns {any}
 */
export function cropFigureTo(full, kept) {
    const ret = wasm.cropFigureTo(full, kept);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`crossref_to_metadata`] (TS `crossrefToMetadata`). A Crossref `message` as a paper.
 *
 * # Errors
 *
 * Fails if `message` is not a Crossref message.
 * @param {any} message
 * @param {string} doi
 * @returns {any}
 */
export function crossrefToMetadata(message, doi) {
    const ptr0 = passStringToWasm0(doi, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.crossrefToMetadata(message, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`damerau_levenshtein`](vocab_match::damerau_levenshtein) as a number.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function damerauLevenshtein(a, b) {
    const ptr0 = passStringToWasm0(a, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(b, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.damerauLevenshtein(ptr0, len0, ptr1, len1);
    return ret >>> 0;
}

/**
 * [`append_card_pair`](layout::append_card_pair): append one card to both breakpoints.
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 * @param {any} layout_value
 * @param {string} card_type
 * @param {string} id
 * @param {any} limits
 * @returns {any}
 */
export function dashboardAppendCardPair(layout_value, card_type, id, limits) {
    const ptr0 = passStringToWasm0(card_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.dashboardAppendCardPair(layout_value, ptr0, len0, ptr1, len1, limits);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`build_dashboard_stats`](stats::build_dashboard_stats) for the whole dashboard.
 *
 * # Errors
 *
 * Fails if `input` cannot be read as the expected shape.
 * @param {any} input
 * @param {string} today
 * @returns {any}
 */
export function dashboardBuildStats(input, today) {
    const ptr0 = passStringToWasm0(today, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.dashboardBuildStats(input, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`close_gaps`](packing::close_gaps).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 * @param {any} items
 * @param {any} limits
 * @param {number} cols
 * @returns {any}
 */
export function dashboardCloseGaps(items, limits, cols) {
    const ret = wasm.dashboardCloseGaps(items, limits, cols);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`compact_vertical`](packing::compact_vertical).
 *
 * # Errors
 *
 * Fails on a bad input shape.
 * @param {any} items
 * @param {number} cols
 * @returns {any}
 */
export function dashboardCompactVertical(items, cols) {
    const ret = wasm.dashboardCompactVertical(items, cols);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`default_layout`](layout::default_layout): the supervisor or the student default.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 * @param {boolean} supervisor
 * @returns {any}
 */
export function dashboardDefaultLayout(supervisor) {
    const ret = wasm.dashboardDefaultLayout(supervisor);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`finalize_dashboard_layout`](layout::finalize_dashboard_layout).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 * @param {any} layout_value
 * @param {any} limits
 * @returns {any}
 */
export function dashboardFinalizeLayout(layout_value, limits) {
    const ret = wasm.dashboardFinalizeLayout(layout_value, limits);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`floors`](packing::floors) for one card type on a grid `cols` wide.
 *
 * # Errors
 *
 * Fails if `limit` is not a card limit.
 * @param {any} limit
 * @param {number} cols
 * @returns {any}
 */
export function dashboardLayoutFloors(limit, cols) {
    const ret = wasm.dashboardLayoutFloors(limit, cols);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`layout_signature`](layout::layout_signature).
 *
 * # Errors
 *
 * Fails on a bad input shape.
 * @param {any} items
 * @returns {string}
 */
export function dashboardLayoutSignature(items) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.dashboardLayoutSignature(items);
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
 * [`lg_layout_needs_repair`](layout::lg_layout_needs_repair).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 * @param {any} items
 * @param {any} limits
 * @returns {boolean}
 */
export function dashboardLgNeedsRepair(items, limits) {
    const ret = wasm.dashboardLgNeedsRepair(items, limits);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`merge_rgl_positions`](layout::merge_rgl_positions): the grid's positions, normalized to `cols`.
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 * @param {any} items
 * @param {any} rgl
 * @param {any} limits
 * @param {number} cols
 * @returns {any}
 */
export function dashboardMergeRglPositions(items, rgl, limits, cols) {
    const ret = wasm.dashboardMergeRglPositions(items, rgl, limits, cols);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`merge_supervisor_cards`](layout::merge_supervisor_cards). `ids` holds one new card id per
 * supervisor-only card type, in order.
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 * @param {any} layout_value
 * @param {any} limits
 * @param {any} ids
 * @returns {any}
 */
export function dashboardMergeSupervisorCards(layout_value, limits, ids) {
    const ret = wasm.dashboardMergeSupervisorCards(layout_value, limits, ids);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`needs_attention`](stats::needs_attention) for the given papers, milestones, experiments,
 * and `today` (`yyyy-mm-dd`).
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 * @param {any} papers
 * @param {any} milestones
 * @param {any} experiments
 * @param {string} today
 * @returns {any}
 */
export function dashboardNeedsAttention(papers, milestones, experiments, today) {
    const ptr0 = passStringToWasm0(today, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.dashboardNeedsAttention(papers, milestones, experiments, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`normalize_item`](packing::normalize_item).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 * @param {any} item
 * @param {any} limits
 * @param {number} cols
 * @returns {any}
 */
export function dashboardNormalizeItem(item, limits, cols) {
    const ret = wasm.dashboardNormalizeItem(item, limits, cols);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`pack_sm`](packing::pack_sm).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 * @param {any} items
 * @param {any} limits
 * @returns {any}
 */
export function dashboardPackSm(items, limits) {
    const ret = wasm.dashboardPackSm(items, limits);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`sm_layout_needs_repack`](layout::sm_layout_needs_repack).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 * @param {any} items
 * @param {any} limits
 * @returns {boolean}
 */
export function dashboardSmNeedsRepack(items, limits) {
    const ret = wasm.dashboardSmNeedsRepack(items, limits);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`supervisee_counts`](stats::supervisee_counts) for one supervisee.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 * @param {any} milestones
 * @param {any} logs
 * @param {string} today
 * @returns {any}
 */
export function dashboardSuperviseeCounts(milestones, logs, today) {
    const ptr0 = passStringToWasm0(today, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.dashboardSuperviseeCounts(milestones, logs, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`sync_dashboard_layouts`](layout::sync_dashboard_layouts).
 *
 * # Errors
 *
 * Fails on a bad input shape or an unknown card type.
 * @param {any} layout_value
 * @param {any} limits
 * @returns {any}
 */
export function dashboardSyncLayouts(layout_value, limits) {
    const ret = wasm.dashboardSyncLayouts(layout_value, limits);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`team_attention`](stats::team_attention) across all supervisees.
 *
 * # Errors
 *
 * Fails if `supervisees` cannot be read as the expected shape.
 * @param {any} supervisees
 * @param {string} today
 * @returns {any}
 */
export function dashboardTeamAttention(supervisees, today) {
    const ptr0 = passStringToWasm0(today, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.dashboardTeamAttention(supervisees, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`top_tags`](stats::top_tags) with the `limit` most-used tags.
 *
 * # Errors
 *
 * Fails if `tags` cannot be read as the expected shape.
 * @param {any} tags
 * @param {number} limit
 * @returns {any}
 */
export function dashboardTopTags(tags, limit) {
    const ret = wasm.dashboardTopTags(tags, limit);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`days_until_date`](timeline::days_until_date): the whole days from `today`, or `undefined`
 * unless both are real dates.
 * @param {string} iso
 * @param {string} today
 * @returns {any}
 */
export function daysUntilDate(iso, today) {
    const ptr0 = passStringToWasm0(iso, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(today, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.daysUntilDate(ptr0, len0, ptr1, len1);
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
 * [`declared_charset`]: the charset a page declares, lowercased, else `utf-8`.
 * @param {string | null | undefined} content_type
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function declaredCharset(content_type, bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        var ptr0 = isLikeNone(content_type) ? 0 : passStringToWasm0(content_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ptr1 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.declaredCharset(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`decode_html_entities`]: the named and numeric entities in `value`, decoded once.
 *
 * # Errors
 *
 * Fails if `value` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} value
 * @returns {string}
 */
export function decodeHtmlEntities(value) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.decodeHtmlEntities(ptr0, len0);
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
 * [`decode_share_link_token`](sharing::decode_share_link_token); a bad token throws its message.
 *
 * # Errors
 *
 * Fails if `encoded` is not valid base64 (either alphabet).
 * @param {string} encoded
 * @returns {Uint8Array}
 */
export function decodeShareLinkToken(encoded) {
    const ptr0 = passStringToWasm0(encoded, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.decodeShareLinkToken(ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * [`deepest_first_list_ids`](reading_list::deepest_first_list_ids) (TS `removeList` order).
 *
 * # Errors
 *
 * Fails if `lists` has the wrong shape.
 * @param {string} list_id
 * @param {any} lists
 * @returns {string[]}
 */
export function deepestFirstListIds(list_id, lists) {
    const ptr0 = passStringToWasm0(list_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.deepestFirstListIds(ptr0, len0, lists);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * [`default_expanded`](state::default_expanded).
 *
 * # Errors
 *
 * Fails if the argument is not an array of strings, or the result cannot be serialised.
 * @param {any} roots
 * @returns {any}
 */
export function defaultExpanded(roots) {
    const ret = wasm.defaultExpanded(roots);
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
 * [`rules::default_mode_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @returns {any}
 */
export function defaultModeFor(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.defaultModeFor(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`default_open_sections`](state::default_open_sections). Takes `{ id, collapsedByDefault }`
 * objects; extra fields are ignored.
 *
 * # Errors
 *
 * Fails if the argument is not an array of section declarations, or the result cannot be serialised.
 * @param {any} sections
 * @returns {any}
 */
export function defaultOpenSections(sections) {
    const ret = wasm.defaultOpenSections(sections);
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
 * [`default_share_link_expires_at`](sharing::default_share_link_expires_at): the default expiry
 * of a new view link. `now_ms` is the JS `Date.now()` value.
 * @param {number} now_ms
 * @returns {string}
 */
export function defaultShareLinkExpiresAt(now_ms) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.defaultShareLinkExpiresAt(now_ms);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`default_source_note_template`](tpl::default_source_note_template): the default source-note
 * template text, with generated metadata and editable summary, key points and notes.
 * @returns {string}
 */
export function defaultSourceNoteTemplate() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.defaultSourceNoteTemplate();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`degree_colours`](node_colouring::degree_colours): `[id, colour]` pairs for `[id, degree]` pairs.
 *
 * # Errors
 *
 * Fails if `degree` is not an array of `[id, number]` pairs.
 * @param {any} degree
 * @returns {any}
 */
export function degreeColours(degree) {
    const ret = wasm.degreeColours(degree);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`deleted_local_base`] for JS (TS `deletedLocalBase`). Empty when there are no ops.
 *
 * # Errors
 *
 * Fails when `ops` is not a list of outbox ops.
 * @param {any} ops
 * @returns {any}
 */
export function deletedLocalBase(ops) {
    const ret = wasm.deletedLocalBase(ops);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`deleted_remote_sides`] for JS (TS `deletedRemoteSides`). `stored` is the local row or
 * `null`; `null` is returned when neither it nor an owed op is available.
 *
 * # Errors
 *
 * Fails when `ops` is not a list of outbox ops or `stored` is not a plain object.
 * @param {any} ops
 * @param {any} stored
 * @returns {any}
 */
export function deletedRemoteSides(ops, stored) {
    const ret = wasm.deletedRemoteSides(ops, stored);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`deletion_action`] for JS (TS `deletionAction`). `kind` is `"deleted_remote"` or
 * `"deleted_local"`, `choice` is `"keep"` or `"delete"`, and `remote` is the server row or `null`.
 *
 * # Errors
 *
 * Fails when `kind` or `choice` is not one of its strings, or a row is not a plain object.
 * @param {any} kind
 * @param {any} choice
 * @param {any} local
 * @param {string} row_id
 * @param {any} remote
 * @returns {any}
 */
export function deletionAction(kind, choice, local, row_id, remote) {
    const ptr0 = passStringToWasm0(row_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.deletionAction(kind, choice, local, ptr0, len0, remote);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`deletion_for`] (TS `deletionFor`). `kind` is `"deleted_remote"` or `"deleted_local"`,
 * `side` is `"local"` or `"remote"`; returns `"keep"` or `"delete"`.
 *
 * # Errors
 *
 * Fails if `kind` or `side` is not one of those strings.
 * @param {any} kind
 * @param {any} side
 * @returns {any}
 */
export function deletionFor(kind, side) {
    const ret = wasm.deletionFor(kind, side);
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
 * [`describe_free_copy_failure`]: `outcome` is the `"none"` outcome of a search.
 *
 * # Errors
 *
 * Fails if `outcome` does not have the expected shape.
 * @param {any} outcome
 * @param {boolean} web_article
 * @returns {string}
 */
export function describeFreeCopyFailure(outcome, web_article) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.describeFreeCopyFailure(outcome, web_article);
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
 * [`wf_core::sync::git_remote::describe_status`] for JS.
 *
 * # Errors
 *
 * Fails when `status` is not a valid `{ url, branch, ahead, behind }` object.
 * @param {any} status
 * @returns {string}
 */
export function describeRemoteStatus(status) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.describeRemoteStatus(status);
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
 * [`device_markers`](panel_labels::device_markers): conflict markers named for this device and the cloud.
 * @param {string} ours
 * @param {string} theirs
 * @returns {string}
 */
export function deviceMarkers(ours, theirs) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(ours, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(theirs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.deviceMarkers(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
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
 * [`diff_refresh`](refresh_diff::diff_refresh) as `{remove, add, prints}`.
 *
 * # Errors
 *
 * Fails if `prints` or `fresh` is not an array of `{id, print}` records, or
 * `held` is not an array of strings.
 * @param {any} prints
 * @param {any} held
 * @param {any} fresh
 * @returns {any}
 */
export function diffRefreshPlan(prints, held, fresh) {
    const ret = wasm.diffRefreshPlan(prints, held, fresh);
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
 * [`wf_core::sync::change_origin::digest_text`] for JS.
 * @param {string} text
 * @returns {string}
 */
export function digestText(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.digestText(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`distance_to_segment_squared`](hit_test::distance_to_segment_squared).
 * @param {number} px
 * @param {number} py
 * @param {number} ax
 * @param {number} ay
 * @param {number} bx
 * @param {number} by
 * @returns {number}
 */
export function distanceToSegmentSquared(px, py, ax, ay, bx, by) {
    const ret = wasm.distanceToSegmentSquared(px, py, ax, ay, bx, by);
    return ret;
}

/**
 * [`distinct_related`](result_dedupe::distinct_related) as kept indices and
 * merge pairs.
 *
 * # Errors
 *
 * Fails if `input` is not a distinct-input record.
 * @param {any} input
 * @returns {any}
 */
export function distinctRelated(input) {
    const ret = wasm.distinctRelated(input);
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
 * [`document_id_of`](semantic_fingerprint::document_id_of): the document a passage id belongs to.
 * @param {string} passage
 * @returns {string}
 */
export function documentIdOf(passage) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(passage, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.documentIdOf(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`document_id_of_path`](semantic_fingerprint::document_id_of_path): the document id behind a workspace file name.
 * @param {string} file
 * @returns {string}
 */
export function documentIdOfPath(file) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(file, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.documentIdOfPath(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`rules::document_kind`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @returns {any}
 */
export function documentKind(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.documentKind(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rules::document_suffix`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @returns {any}
 */
export function documentSuffix(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.documentSuffix(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`double_click_figure`](page_math::double_click_figure): the figure every press lands in.
 *
 * # Errors
 *
 * Fails if `figures` is not an array of boxes or `points` is not an array of points.
 * @param {any} figures
 * @param {any} points
 * @param {number | null} [skip]
 * @returns {number | undefined}
 */
export function doubleClickFigure(figures, points, skip) {
    const ret = wasm.doubleClickFigure(figures, points, isLikeNone(skip) ? Number.MAX_SAFE_INTEGER : (skip) >>> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] === Number.MAX_SAFE_INTEGER ? undefined : ret[0];
}

/**
 * [`draft_icon`](edit::draft_icon).
 *
 * # Errors
 *
 * Fails if the argument is not a create kind, or the result cannot be serialised.
 * @param {any} kind
 * @returns {any}
 */
export function draftIcon(kind) {
    const ret = wasm.draftIcon(kind);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`draft_makes`](edit::draft_makes).
 *
 * # Errors
 *
 * Fails if the argument is not a create kind, or the result cannot be serialised.
 * @param {any} kind
 * @returns {any}
 */
export function draftMakes(kind) {
    const ret = wasm.draftMakes(kind);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`draft_placeholder`](edit::draft_placeholder).
 *
 * # Errors
 *
 * Fails if the argument is not a create kind, or the result cannot be serialised.
 * @param {any} kind
 * @returns {any}
 */
export function draftPlaceholder(kind) {
    const ret = wasm.draftPlaceholder(kind);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`draft_reading_log`](reading_digest::draft_reading_log) (TS `draftReadingLog`).
 *
 * # Errors
 *
 * Fails if `papers` or `marks` are not lists of the right shape.
 * @param {any} papers
 * @param {any} marks
 * @param {string} day
 * @returns {string}
 */
export function draftReadingLog(papers, marks, day) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(day, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.draftReadingLog(papers, marks, ptr0, len0);
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
 * [`drop_parent_id`](edit::drop_parent_id).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 * @param {any} target
 * @returns {any}
 */
export function dropParentId(target) {
    const ret = wasm.dropParentId(target);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`duplicate_plan`](duplicate::duplicate_plan) as `{ title, parentId, body }`, or `null`.
 *
 * # Errors
 *
 * Fails if `doc` or `documents` does not have the shape of a duplicate source.
 * @param {any} doc
 * @param {any} documents
 * @returns {any}
 */
export function duplicatePlan(doc, documents) {
    const ret = wasm.duplicatePlan(doc, documents);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`edit_sides`] for JS (TS `editSides`). `null` when no non-delete op is owed.
 *
 * # Errors
 *
 * Fails when `ops` is not a list of outbox ops.
 * @param {any} ops
 * @returns {any}
 */
export function editSides(ops) {
    const ret = wasm.editSides(ops);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`edited_relative_label`](edited_label::edited_relative_label) (TS `editedRelativeLabel`).
 * `None` (a week or more, or NaN) becomes `undefined`; the caller then shows the date.
 * @param {number} seconds
 * @returns {string | undefined}
 */
export function editedRelativeLabel(seconds) {
    const ret = wasm.editedRelativeLabel(seconds);
    let v1;
    if (ret[0] !== 0) {
        v1 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v1;
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
 * [`ema_smooth`]: debiased EMA over the values; `null` gaps stay gaps.
 * @param {any} values
 * @param {number} alpha
 * @returns {any}
 */
export function emaSmooth(values, alpha) {
    const ret = wasm.emaSmooth(values, alpha);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`embed_titles`](page::embed_titles): the trimmed title of each `![[...]]` in `body`.
 * @param {string} body
 * @returns {string[]}
 */
export function embedTitles(body) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.embedTitles(ptr0, len0);
    var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * [`embeddable_text`](semantic_fingerprint::embeddable_text): the text a document is embedded from.
 * @param {string} title
 * @param {string[]} aliases
 * @param {string} body
 * @returns {string}
 */
export function embeddableText(title, aliases, body) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(aliases, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.embeddableText(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * [`empty_cell_paper_ids`]: the papers whose cell for `field_id` is empty and not pending.
 * @param {any} rows
 * @param {string} field_id
 * @param {any} pending_paper_ids
 * @returns {any}
 */
export function emptyCellPaperIds(rows, field_id, pending_paper_ids) {
    const ptr0 = passStringToWasm0(field_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.emptyCellPaperIds(rows, ptr0, len0, pending_paper_ids);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`empty_integration`](fields::empty_integration): the integration a provider starts from.
 *
 * # Errors
 *
 * Fails if `provider` is not `"github"`, `"gitlab"` or `"mattermost"`.
 * @param {any} provider
 * @returns {any}
 */
export function emptyIntegration(provider) {
    const ret = wasm.emptyIntegration(provider);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`empty_layout`](pane::empty_layout).
 *
 * # Errors
 *
 * Never fails in practice; returns the serializer's result type.
 * @param {string} pane_id
 * @returns {any}
 */
export function emptyLayout(pane_id) {
    const ptr0 = passStringToWasm0(pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.emptyLayout(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`empty_page_history`] as `{ undo: [], redo: [] }`.
 * @returns {any}
 */
export function emptyPageHistory() {
    const ret = wasm.emptyPageHistory();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`empty_to_null`]: the text as stored, with an absent or empty value as `null`.
 * @param {string | null} [value]
 * @returns {any}
 */
export function emptyToNull(value) {
    var ptr0 = isLikeNone(value) ? 0 : passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.emptyToNull(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`encode_ink_chunk_body`](chunk::encode_ink_chunk_body): a page packed into an uncompressed body.
 *
 * # Errors
 *
 * Fails on a page the format cannot hold, or one that is not an `InkPage`.
 * @param {any} page
 * @returns {Uint8Array}
 */
export function encodeInkChunkBody(page) {
    const ret = wasm.encodeInkChunkBody(page);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
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
 * [`nav_open_groups::encode_open_groups`]: the stored JSON for an open-groups list.
 *
 * # Errors
 *
 * Fails if `groups` is not an array of strings.
 * @param {any} groups
 * @returns {string}
 */
export function encodeOpenGroups(groups) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.encodeOpenGroups(groups);
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
 * [`encode_share_link_token`](sharing::encode_share_link_token): unpadded base64url.
 * @param {Uint8Array} token
 * @returns {string}
 */
export function encodeShareLinkToken(token) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passArray8ToWasm0(token, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.encodeShareLinkToken(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
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
 * [`entry_file_error`](overleaf::entry_file_error).
 * @param {string} entry_file
 * @returns {string | undefined}
 */
export function entryFileError(entry_file) {
    const ptr0 = passStringToWasm0(entry_file, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.entryFileError(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`enum_label::enum_label`]: the label for `value` under `kind`, humanised when unknown.
 * @param {string} kind
 * @param {string} value
 * @returns {string}
 */
export function enumLabel(kind, value) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.enumLabel(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`enum_label::enum_options`] as `{ value, label }` objects, in the fixed order.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 * @param {string} kind
 * @returns {any}
 */
export function enumOptions(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.enumOptions(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`escape_html`](text::escape_html): `&`, `<`, `>` and `"` made safe for markup.
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.escapeHtml(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
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
 * [`excerptOf`]: a 200-character excerpt of `body` around `terms`, cut like [`index_terms_of_js`].
 *
 * # Errors
 *
 * Fails if `terms` is not an array of strings, or if the terms together need more than
 * `MAX_INDEX_TEXT_UTF16` units (each counts its length + 1), as the TS `buildExcerpt` does.
 * @param {string} body
 * @param {any} terms
 * @returns {any}
 */
export function excerptOf(body, terms) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.excerptOf(ptr0, len0, terms);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`excerpt_segments`](excerpt_segments::excerpt_segments) as `{text,
 * highlighted}` runs.
 *
 * # Errors
 *
 * Fails if `excerpt` is not a `{text, highlights}` record.
 * @param {any} excerpt
 * @returns {any}
 */
export function excerptSegments(excerpt) {
    const ret = wasm.excerptSegments(excerpt);
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
 * [`expand_embeds`](page::expand_embeds): `bodies[i]` is the body that `titles[i]` resolves to.
 * @param {string} body
 * @param {string[]} titles
 * @param {string[]} bodies
 * @returns {string}
 */
export function expandEmbeds(body, titles, bodies) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(titles, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(bodies, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.expandEmbeds(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
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
 * [`experiment_href`](experiment_status::experiment_href): where an experiment opens.
 * @param {string} id
 * @param {boolean} is_offline_build
 * @returns {string}
 */
export function experimentHref(id, is_offline_build) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.experimentHref(ptr0, len0, is_offline_build);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`to_domain`]: an `experiments` row as an experiment.
 * @param {any} row
 * @returns {any}
 */
export function experimentRowToDomain(row) {
    const ret = wasm.experimentRowToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_row`]: an experiment as the `experiments` row it is written as.
 * @param {any} experiment
 * @returns {any}
 */
export function experimentToRow(experiment) {
    const ret = wasm.experimentToRow(experiment);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`EXPERIMENTS_HREF`](experiment_status::EXPERIMENTS_HREF): the experiments list.
 * @returns {string}
 */
export function experimentsListHref() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.experimentsListHref();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
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
 * [`export_asset_path`]: the folder a stored asset is written to in the export.
 * @param {string} root
 * @param {string} prefix
 * @param {string} storage_path
 * @returns {string}
 */
export function exportAssetPath(root, prefix, storage_path) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(root, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(prefix, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(storage_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.exportAssetPath(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * [`export_manifest_json`]: the export's `manifest.json` text.
 * @param {string} exported_at
 * @param {any} stats
 * @returns {string}
 */
export function exportManifestJson(exported_at, stats) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(exported_at, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.exportManifestJson(ptr0, len0, stats);
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
 * [`export_readme`]: the export's `README.txt` text.
 * @param {string} exported_at
 * @returns {string}
 */
export function exportReadme(exported_at) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(exported_at, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.exportReadme(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
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
 * [`extract_headings`](search_document::extract_headings).
 * @param {string | null} [body]
 * @returns {string[]}
 */
export function extractHeadings(body) {
    var ptr0 = isLikeNone(body) ? 0 : passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.extractHeadings(ptr0, len0);
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
 * [`extract_page_title`](page_title::extract_page_title): `{ title, suspect }`, or
 * `null` when the HTML has no title.
 *
 * # Errors
 *
 * Fails if `html` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} html
 * @returns {any}
 */
export function extractPageTitle(html) {
    const ptr0 = passStringToWasm0(html, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.extractPageTitle(ptr0, len0);
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
 * [`extraction_csv`]: the table as CSV, with a header line.
 * @param {any} rows
 * @param {any} defs
 * @param {any} columns
 * @returns {string}
 */
export function extractionCsv(rows, defs, columns) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.extractionCsv(rows, defs, columns);
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
 * [`extraction_markdown`]: the table as a Markdown table.
 * @param {any} rows
 * @param {any} defs
 * @param {any} columns
 * @returns {string}
 */
export function extractionMarkdown(rows, defs, columns) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.extractionMarkdown(rows, defs, columns);
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
 * [`paper_value_rows`]: each listed paper's stored and rollup values, in list order.
 * @param {any} paper_ids
 * @param {any} values
 * @param {any} defs
 * @returns {any}
 */
export function extractionValueRows(paper_ids, values, defs) {
    const ret = wasm.extractionValueRows(paper_ids, values, defs);
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
 * [`figure_alt_for`](figure::figure_alt_for): the figure alt of the image at `path`, or `undefined`.
 *
 * # Errors
 *
 * Fails if `body` is longer than the index text limit.
 * @param {string} body
 * @param {string} path
 * @returns {string | undefined}
 */
export function figureAltFor(body, path) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.figureAltFor(ptr0, len0, ptr1, len1);
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
 * [`figure_clip_text`]: the clipboard text for a copied figure.
 * @param {any} clip
 * @returns {string}
 */
export function figureClipText(clip) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.figureClipText(clip);
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
 * [`figure_corner_hit`](figure::figure_corner_hit): the corner grab distance at `scale`.
 * @param {number} scale
 * @returns {number}
 */
export function figureCornerHit(scale) {
    const ret = wasm.figureCornerHit(scale);
    return ret;
}

/**
 * [`figure_image_frame`](figure::figure_image_frame): the whole picture inside the frame, in percent.
 *
 * # Errors
 *
 * Fails if `value` has the wrong shape.
 * @param {any} value
 * @returns {any}
 */
export function figureImageFrame(value) {
    const ret = wasm.figureImageFrame(value);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`figure_label`](figure_label::figure_label): the label for an artifact URL. `index` is 0-based.
 * @param {string} url
 * @param {number} index
 * @returns {string}
 */
export function figureLabel(url, index) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.figureLabel(ptr0, len0, index);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`figure_under`](page_math::figure_under): the topmost figure holding `at`, ignoring `skip`.
 *
 * # Errors
 *
 * Fails if `figures` is not an array of boxes or `at` is not a point.
 * @param {any} figures
 * @param {any} at
 * @param {number | null} [skip]
 * @returns {number | undefined}
 */
export function figureUnder(figures, at, skip) {
    const ret = wasm.figureUnder(figures, at, isLikeNone(skip) ? Number.MAX_SAFE_INTEGER : (skip) >>> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] === Number.MAX_SAFE_INTEGER ? undefined : ret[0];
}

/**
 * [`filter_graph_by_nodes`] (TS `filterGraphByNodes`). `allowed` is an array of node ids, or
 * `null` to keep everything. Returns `{ nodes, links }`.
 *
 * # Errors
 *
 * Fails if `nodes` or `links` is not an array of JSON values, or `allowed` is not an array of
 * strings or `null`.
 * @param {any} nodes
 * @param {any} links
 * @param {any} allowed
 * @returns {any}
 */
export function filterGraphByNodes(nodes, links, allowed) {
    const ret = wasm.filterGraphByNodes(nodes, links, allowed);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`filter_rows`](tree::filter_rows). `rows` is an array of `VisibleRow`.
 *
 * # Errors
 *
 * Fails if `rows` has the wrong shape.
 * @param {any} rows
 * @param {string} query
 * @returns {any}
 */
export function filterRows(rows, query) {
    const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.filterRows(rows, ptr0, len0);
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
 * [`find_annotation_backlinks`](backlinks::find_annotation_backlinks) as an array of hits.
 *
 * # Errors
 *
 * Fails if `input` lacks the `annotations`, `pins`, `sections` or `vaultPages` arrays.
 * @param {any} input
 * @returns {any}
 */
export function findAnnotationBacklinks(input) {
    const ret = wasm.findAnnotationBacklinks(input);
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
 * [`find_duplicate_groups`] (TS `findDuplicateGroups`). Groups of two or more papers.
 *
 * # Errors
 *
 * Fails if `papers` is not a list of paper summaries, or the result cannot be converted.
 * @param {any} papers
 * @returns {any}
 */
export function findDuplicateGroups(papers) {
    const ret = wasm.findDuplicateGroups(papers);
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
 * [`wf_core::sync::markdown_image::find_image_refs`] for JS, with one `head`.
 *
 * # Errors
 *
 * Fails when `body` or `head` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} body
 * @param {string} head
 * @param {boolean} allow_space
 * @returns {any}
 */
export function findImageRefs(body, head, allow_space) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(head, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.findImageRefs(ptr0, len0, ptr1, len1, allow_space);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`find_marks`]: where each match falls in the document, as a fraction of its height.
 *
 * # Errors
 *
 * Fails if `matches` or `pages` do not have the expected shape.
 * @param {any} matches
 * @param {number} num_pages
 * @param {any} pages
 * @returns {any}
 */
export function findMarks(matches, num_pages, pages) {
    const ret = wasm.findMarks(matches, num_pages, pages);
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
 * [`find_related`](related::find_related); `[{ id, score, arm, arms?, similarity? }]`, best first.
 *
 * # Errors
 *
 * Fails if `graph` or `options` has the wrong shape.
 * @param {any} graph
 * @param {string} seed
 * @param {number} limit
 * @param {any} options
 * @param {() => number} rng
 * @param {(seedId: string, limit: number) => { id: string; score: number }[]} lexical
 * @param {(seedId: string, limit: number) => { id: string; score: number }[]} tagged
 * @returns {any}
 */
export function findRelated(graph, seed, limit, options, rng, lexical, tagged) {
    const ptr0 = passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.findRelated(graph, ptr0, len0, limit, options, rng, lexical, tagged);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`find_wiki_root`]: the note titled `Wiki`, or nothing.
 * @param {any} pages
 * @returns {any}
 */
export function findWikiRoot(pages) {
    const ret = wasm.findWikiRoot(pages);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`fit_cols`](plot_size::fit_cols).
 * @param {number} grid_width
 * @param {number} gap
 * @returns {number}
 */
export function fitCols(grid_width, gap) {
    const ret = wasm.fitCols(grid_width, gap);
    return ret >>> 0;
}

/**
 * [`fit_layout_to_content`](fit::fit_layout_to_content). `measured` and `maxHeights` map a card id
 * (or card type) to rows; only card types in `maxHeights` fit their content.
 *
 * # Errors
 *
 * Fails when an argument is not the expected shape.
 * @param {any} items
 * @param {any} measured
 * @param {any} max_heights
 * @returns {any}
 */
export function fitLayoutToContent(items, measured, max_heights) {
    const ret = wasm.fitLayoutToContent(items, measured, max_heights);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`fit_scale`](page_math::fit_scale): CSS pixels per 0.1 mm unit, `1` with no width.
 * @param {number} container_width
 * @param {number} page_width
 * @returns {number}
 */
export function fitScale(container_width, page_width) {
    const ret = wasm.fitScale(container_width, page_width);
    return ret;
}

/**
 * [`fits_ink_note_budget`](chunk::fits_ink_note_budget): whether these chunk sizes fit a note.
 * @param {Float64Array} sizes
 * @returns {boolean}
 */
export function fitsInkNoteBudget(sizes) {
    const ptr0 = passArrayF64ToWasm0(sizes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.fitsInkNoteBudget(ptr0, len0);
    return ret !== 0;
}

/**
 * [`flat_path`](folder_layout::flat_path). `entity` is a `WorkspaceEntityType` string.
 *
 * # Errors
 *
 * Fails if `entity` is not a known entity type.
 * @param {any} entity
 * @param {string} id
 * @param {string} title
 * @param {string} project_root
 * @returns {string}
 */
export function flatPath(entity, id, title, project_root) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(project_root, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.flatPath(entity, ptr0, len0, ptr1, len1, ptr2, len2);
        var ptr4 = ret[0];
        var len4 = ret[1];
        if (ret[3]) {
            ptr4 = 0; len4 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred5_0 = ptr4;
        deferred5_1 = len4;
        return getStringFromWasm0(ptr4, len4);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * [`flatten`] over `docs`: the project's text files as paths, in walk order.
 * @param {any} root_folder
 * @returns {any}
 */
export function flattenOverleafDocs(root_folder) {
    const ret = wasm.flattenOverleafDocs(root_folder);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`flatten`] over `fileRefs`: the project's binary files as paths, in walk order.
 * @param {any} root_folder
 * @returns {any}
 */
export function flattenOverleafFiles(root_folder) {
    const ret = wasm.flattenOverleafFiles(root_folder);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`flatten_tree`](tree::flatten_tree).
 *
 * # Errors
 *
 * Fails if `nodes` has the wrong shape.
 * @param {any} nodes
 * @returns {any}
 */
export function flattenTree(nodes) {
    const ret = wasm.flattenTree(nodes);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`focus_pane`](pane::focus_pane).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @param {string} pane_id
 * @returns {any}
 */
export function focusPane(layout, pane_id) {
    const ptr0 = passStringToWasm0(pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.focusPane(layout, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`focused_tab_count`](pane::focused_tab_count).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @returns {number}
 */
export function focusedTabCount(layout) {
    const ret = wasm.focusedTabCount(layout);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`folder_ids_of`](tree::folder_ids_of). Returns an array; the TS wrapper makes the `Set`.
 *
 * # Errors
 *
 * Fails if `nodes` has the wrong shape.
 * @param {any} nodes
 * @returns {any}
 */
export function folderIdsOf(nodes) {
    const ret = wasm.folderIdsOf(nodes);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`folder_key`](folder_layout::folder_key) (TS `folderSegments` joined with `/`): the folder
 * of one picked file's relative path.
 * @param {string} relative_path
 * @returns {string}
 */
export function folderKey(relative_path) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(relative_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.folderKey(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`folder_keys`](folder_layout::folder_keys) (TS `folderKeys`): every folder the picked files
 * lead to, shallowest first.
 * @param {string[]} relative_paths
 * @returns {string[]}
 */
export function folderKeys(relative_paths) {
    const ptr0 = passArrayJsValueToWasm0(relative_paths, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.folderKeys(ptr0, len0);
    var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * [`folder_title_from_path`](folder_layout::folder_title_from_path).
 * @param {string} path
 * @returns {string}
 */
export function folderTitleFromPath(path) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.folderTitleFromPath(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
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
 * [`format_count`](stats::format_count).
 * @param {number} value
 * @returns {string}
 */
export function formatCount(value) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.formatCount(value);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`format_cursor`](stats::format_cursor).
 * @param {number} line
 * @param {number} col
 * @returns {string}
 */
export function formatCursorLabel(line, col) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.formatCursorLabel(line, col);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`format_figure_tokens`](figure::format_figure_tokens): the tokens written in an alt.
 *
 * # Errors
 *
 * Fails if `geometry` has the wrong shape.
 * @param {any} geometry
 * @returns {string}
 */
export function formatFigureTokens(geometry) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.formatFigureTokens(geometry);
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
 * [`format_log_line`]: one log entry as the text the panel and the log file both show.
 * @param {string} at
 * @param {string} level
 * @param {string} source
 * @param {string} message
 * @param {string | null} [detail]
 * @returns {string}
 */
export function formatLogLine(at, level, source, message, detail) {
    let deferred6_0;
    let deferred6_1;
    try {
        const ptr0 = passStringToWasm0(at, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(level, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(source, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ptr3 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len3 = WASM_VECTOR_LEN;
        var ptr4 = isLikeNone(detail) ? 0 : passStringToWasm0(detail, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len4 = WASM_VECTOR_LEN;
        const ret = wasm.formatLogLine(ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
        deferred6_0 = ret[0];
        deferred6_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred6_0, deferred6_1, 1);
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
 * [`format_quote_block`] for JS (TS `formatQuoteBlock`).
 *
 * # Errors
 *
 * Fails when `quote` is over the text cap.
 * @param {string} quote
 * @returns {string}
 */
export function formatQuoteBlock(quote) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(quote, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.formatQuoteBlock(ptr0, len0);
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
 * [`format_quote_cite_clipboard`] for JS (TS `formatQuoteCiteClipboard`).
 *
 * # Errors
 *
 * Fails when `quote` is over the text cap.
 * @param {string} quote
 * @param {string} paper_title
 * @returns {string}
 */
export function formatQuoteCiteClipboard(quote, paper_title) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(quote, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(paper_title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.formatQuoteCiteClipboard(ptr0, len0, ptr1, len1);
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
 * [`format_reference`](reference_text::format_reference).
 *
 * # Errors
 *
 * Fails when `paper` is not a paper.
 * @param {any} paper
 * @returns {string}
 */
export function formatReference(paper) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.formatReference(paper);
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
 * [`format_words`](stats::format_words).
 * @param {number} words
 * @returns {string}
 */
export function formatWords(words) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.formatWords(words);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`wf_core::sync::blob_links::from_relative_blob_links_mapped`] for JS. `resolved`
 * is `{ "assets/<scope>/<path>": storagePath }`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `resolved` is
 * not an object of strings.
 * @param {string} body
 * @param {any} resolved
 * @returns {string}
 */
export function fromRelativeBlobLinks(body, resolved) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.fromRelativeBlobLinks(ptr0, len0, resolved);
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
 * [`frontmatter_list`](wf_core::sync::frontmatter::frontmatter_list) for JS: a list field
 * as its entries as text, or a non-blank scalar string as one entry.
 *
 * # Errors
 *
 * Fails when `frontmatter` is not an object.
 * @param {any} frontmatter
 * @param {string} key
 * @returns {any}
 */
export function frontmatterList(frontmatter, key) {
    const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.frontmatterList(frontmatter, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`frontmatter_string`](wf_core::sync::frontmatter::frontmatter_string) for JS: the
 * field as text, or `undefined` when it is absent, a list, or blank.
 *
 * # Errors
 *
 * Fails when `frontmatter` is not an object.
 * @param {any} frontmatter
 * @param {string} key
 * @returns {string | undefined}
 */
export function frontmatterString(frontmatter, key) {
    const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.frontmatterString(frontmatter, ptr0, len0);
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
 * [`gemini_install`](mcp_client_config::gemini_install).
 * @returns {string}
 */
export function geminiInstall() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.geminiInstall();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
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
 * [`git_connection`](fields::git_connection).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 * @param {any} integration
 * @returns {any}
 */
export function gitConnection(integration) {
    const ret = wasm.gitConnection(integration);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`git_connection_ready`](fields::git_connection_ready).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 * @param {any} integration
 * @returns {boolean}
 */
export function gitConnectionReady(integration) {
    const ret = wasm.gitConnectionReady(integration);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`git_reason`](git_reason::git_reason): git's `fatal:`/`error:` lines from a failed command's text.
 * @param {string} text
 * @returns {string}
 */
export function gitReason(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.gitReason(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`github_repo_pdf_path`] (TS `githubRepoPdfPath`): the repo-relative PDF path, or none.
 * @param {string | null | undefined} given_pdf_path
 * @param {string} paper_id
 * @returns {string | undefined}
 */
export function githubRepoPdfPath(given_pdf_path, paper_id) {
    var ptr0 = isLikeNone(given_pdf_path) ? 0 : passStringToWasm0(given_pdf_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(paper_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.githubRepoPdfPath(ptr0, len0, ptr1, len1);
    let v3;
    if (ret[0] !== 0) {
        v3 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}

/**
 * [`gitlab_combined_active`].
 *
 * # Errors
 *
 * Fails if `config` has the wrong shape, or the result cannot be converted to JS.
 * @param {any} config
 * @returns {any}
 */
export function gitlabCombinedActive(config) {
    const ret = wasm.gitlabCombinedActive(config);
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
 * [`graph_palette`](graph_colour::graph_palette): every fixed colour the graph draws.
 *
 * # Errors
 *
 * Fails only if the palette cannot be serialised.
 * @returns {any}
 */
export function graphPalette() {
    const ret = wasm.graphPalette();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`graph_tag_names`](graph_tags::graph_tag_names): every filterable tag, sorted.
 *
 * # Errors
 *
 * Fails if `papers`, `notes` or `lists` has the wrong shape.
 * @param {any} papers
 * @param {any} notes
 * @param {any} lists
 * @param {boolean} include_lists
 * @returns {any}
 */
export function graphTagNames(papers, notes, lists, include_lists) {
    const ret = wasm.graphTagNames(papers, notes, lists, include_lists);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`graph_topology_key`](topology::graph_topology_key). `shown` is `{ nodes, links }` with `id` on each entry.
 *
 * # Errors
 *
 * Fails if `shown` has the wrong shape.
 * @param {any} shown
 * @param {string | null | undefined} local_seed
 * @param {number} local_depth
 * @returns {string}
 */
export function graphTopologyKey(shown, local_seed, local_depth) {
    let deferred3_0;
    let deferred3_1;
    try {
        var ptr0 = isLikeNone(local_seed) ? 0 : passStringToWasm0(local_seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.graphTopologyKey(shown, ptr0, len0, local_depth);
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
 * [`group_by_day`] for JS (TS `groupByDay`): `{ day, indexes }[]`, newest day first.
 *
 * # Errors
 *
 * Fails when `entryDates` is not an array of strings.
 * @param {any} entry_dates
 * @returns {any}
 */
export function groupByDay(entry_dates) {
    const ret = wasm.groupByDay(entry_dates);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`group_hunks`](panel_labels::group_hunks): unchanged and changed runs of a body diff.
 *
 * # Errors
 *
 * Fails if `lines` has the wrong shape, or the result cannot be serialised.
 * @param {any} lines
 * @returns {any}
 */
export function groupHunks(lines) {
    const ret = wasm.groupHunks(lines);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`group_palette_rows`](palette_groups::group_palette_rows): the headings present, each with the
 * indices of its rows, from the group of each row.
 *
 * # Errors
 *
 * Fails if `groups` has the wrong shape.
 * @param {any} groups
 * @returns {any}
 */
export function groupPaletteRows(groups) {
    const ret = wasm.groupPaletteRows(groups);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`group_proposals`](proposal_groups::group_proposals). `items` is a list of objects with
 * `kind` and `resourceId`; `by` is `"document"` or `"kind"`; `knownIds` is an optional string
 * array. Returns `{ key, indices }[]`, with indices into `items`.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 * @param {any} items
 * @param {any} by
 * @param {any} known_ids
 * @returns {any}
 */
export function groupProposals(items, by, known_ids) {
    const ret = wasm.groupProposals(items, by, known_ids);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`group_results`](quick::group_results) as an array of `{ kind, label, results }`.
 *
 * # Errors
 *
 * Fails if `results` is not an array of quick-open results.
 * @param {any} results
 * @returns {any}
 */
export function groupResults(results) {
    const ret = wasm.groupResults(results);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`group_runs`](groups::group_runs).
 *
 * # Errors
 *
 * Fails if `leaf` has the wrong shape.
 * @param {any} leaf
 * @returns {any}
 */
export function groupRuns(leaf) {
    const ret = wasm.groupRuns(leaf);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`group_subtree_items`]: the subtree's items grouped by list, in subtree order.
 * @param {any} node
 * @param {any} items
 * @returns {any}
 */
export function groupSubtreeItems(node, items) {
    const ret = wasm.groupSubtreeItems(node, items);
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
 * [`guess_title`](paper_drop::guess_title) (TS `guessTitle`).
 * @param {string} text
 * @returns {string | undefined}
 */
export function guessTitle(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.guessTitle(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
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
 * [`rules::has_ink_view`].
 * @param {string} kind
 * @returns {boolean}
 */
export function hasInkView(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hasInkView(ptr0, len0);
    return ret !== 0;
}

/**
 * [`rules::has_lazy_body`].
 * @param {string} kind
 * @returns {boolean}
 */
export function hasLazyBody(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hasLazyBody(ptr0, len0);
    return ret !== 0;
}

/**
 * [`has_pdf_magic`]: whether the first bytes carry the `%PDF-` signature.
 * @param {Uint8Array} bytes
 * @returns {boolean}
 */
export function hasPdfMagic(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hasPdfMagic(ptr0, len0);
    return ret !== 0;
}

/**
 * [`rules::has_pdf_view`].
 * @param {string} kind
 * @returns {boolean}
 */
export function hasPdfView(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.hasPdfView(ptr0, len0);
    return ret !== 0;
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
 * [`heading_slug`](heading_slug::heading_slug): the anchor id for a heading.
 * @param {string} text
 * @returns {string}
 */
export function headingSlug(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.headingSlug(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`highlight_within_excerpt`](evidence::highlight_within_excerpt). `locus` is a PDF locus object or
 * `undefined`; the result is `{ before, match, after, confidence }`, or `null` when nothing matches.
 *
 * # Errors
 *
 * Fails if `locus` is not a PDF locus object, or the result cannot be converted.
 * @param {string} excerpt
 * @param {any} locus
 * @returns {any}
 */
export function highlightWithinExcerpt(excerpt, locus) {
    const ptr0 = passStringToWasm0(excerpt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.highlightWithinExcerpt(ptr0, len0, locus);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`highlights_digest`](reading_digest::highlights_digest) (TS `highlightsDigest`).
 *
 * # Errors
 *
 * Fails if `marks` is not a list of digest marks.
 * @param {any} marks
 * @param {string} existing
 * @returns {string}
 */
export function highlightsDigest(marks, existing) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(existing, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.highlightsDigest(marks, ptr0, len0);
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
 * [`host_of`]: the host and port of a PDF address for a failure line, or the address when it has none.
 * @param {string} url
 * @returns {string}
 */
export function hostOf(url) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.hostOf(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`enum_label::humanise`]: `made_up_kind` reads `Made up kind`.
 * @param {string} value
 * @returns {string}
 */
export function humanise(value) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.humanise(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`humanize`](panel_labels::humanize): a field name as a label.
 * @param {string} field
 * @returns {string}
 */
export function humanize(field) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(field, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.humanize(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`hydrate_tab_modes`](pane::hydrate_tab_modes). `modes` is an object of tab key to mode.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 * @param {any} layout
 * @param {any} modes
 * @returns {any}
 */
export function hydrateTabModes(layout, modes) {
    const ret = wasm.hydrateTabModes(layout, modes);
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
 * [`pglite_sql::ident`] (TS `ident`): a trimmed, double-quoted column name.
 *
 * # Errors
 *
 * Returns an error for a name the local database will not accept.
 * @param {string} name
 * @returns {string}
 */
export function ident(name) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.ident(ptr0, len0);
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
 * [`images_of`](paper_image::images_of) (TS `imagesOf`). `null` metadata has no images.
 *
 * # Errors
 *
 * Fails if `metadata` is not an object of JSON values.
 * @param {any} metadata
 * @returns {string[]}
 */
export function imagesOf(metadata) {
    const ret = wasm.imagesOf(metadata);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
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
 * [`account_menu::inbox_links`]: the Inbox rows as `{ key, label, path, icon, badge? }`.
 *
 * # Errors
 *
 * Fails if `input` is not an `InboxInput`-shaped object, or the result cannot be converted to JS.
 * @param {any} input
 * @returns {any}
 */
export function inboxLinks(input) {
    const ret = wasm.inboxLinks(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`enum_label::incoming_relation_label`]: `cites` reads `Cited by`.
 * @param {string} relation
 * @returns {string}
 */
export function incomingRelationLabel(relation) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(relation, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.incomingRelationLabel(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`index_from_analysis`]: shapes an analysis the worker already ran into the overlay's index.
 *
 * # Errors
 *
 * Fails if `analysis` or `pages` do not have the expected shape.
 * @param {any} analysis
 * @param {any} pages
 * @returns {any}
 */
export function indexFromAnalysis(analysis, pages) {
    const ret = wasm.indexFromAnalysis(analysis, pages);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`indexTermsOf`]: the index terms of `text`, cut to the longest text the index accepts rather
 * than throwing. Rust `index_terms` with the search tokenizer defaults.
 * @param {string} text
 * @returns {string[]}
 */
export function indexTermsOf(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.indexTermsOf(ptr0, len0);
    var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
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
 * [`ink_attachment_index`](ink_page::ink_attachment_index): the attachment index of `path`, or `0`.
 * @param {string} body
 * @param {string | null} [path]
 * @returns {number}
 */
export function inkAttachmentIndex(body, path) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(path) ? 0 : passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.inkAttachmentIndex(ptr0, len0, ptr1, len1);
    return ret;
}

/**
 * [`ink_chunk_body_size`](chunk::ink_chunk_body_size): the body length a page would take.
 *
 * # Errors
 *
 * Fails on a body over `u32`, or a value that is not an `InkPage`.
 * @param {any} page
 * @returns {number}
 */
export function inkChunkBodySize(page) {
    const ret = wasm.inkChunkBodySize(page);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * [`ink_chunk_header_bytes`](chunk::ink_chunk_header_bytes): the header for a payload.
 * @param {number} body_size
 * @param {number} payload_size
 * @param {boolean} compressed
 * @returns {Uint8Array}
 */
export function inkChunkHeaderBytes(body_size, payload_size, compressed) {
    const ret = wasm.inkChunkHeaderBytes(body_size, payload_size, compressed);
    var v1 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v1;
}

/**
 * [`ink_chunk_path`](ink_paths::ink_chunk_path).
 *
 * # Errors
 *
 * Fails when `chunkId` or `noteId` is unusable.
 * @param {string} note_id
 * @param {string} chunk_id
 * @returns {string}
 */
export function inkChunkPath(note_id, chunk_id) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(note_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(chunk_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.inkChunkPath(ptr0, len0, ptr1, len1);
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
 * [`ink_engine_info`](ink_engine::ink_engine_info): the engine's declared facts, or
 * `null` for an unknown id.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} id
 * @returns {any}
 */
export function inkEngineInfo(id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.inkEngineInfo(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`ink_enum_index`](ink_page::ink_enum_index): the position of `value` in `values`, or `0`.
 *
 * # Errors
 *
 * Fails if `values` is not an array of strings.
 * @param {any} values
 * @param {string} value
 * @returns {number}
 */
export function inkEnumIndex(values, value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.inkEnumIndex(values, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * [`ink_enum_value`](ink_page::ink_enum_value): the name at `index`, or the first entry
 * where out of range; `undefined` for an empty list.
 *
 * # Errors
 *
 * Fails if `values` is not an array of strings.
 * @param {any} values
 * @param {number} index
 * @returns {string | undefined}
 */
export function inkEnumValue(values, index) {
    const ret = wasm.inkEnumValue(values, index);
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
 * [`ink_line_strokes`](ink_engine::ink_line_strokes): the strokes of one line, given
 * the line record `{ strokeStart, strokeCount, ... }`. Strokes pass through as JS values.
 *
 * # Errors
 *
 * Fails if `strokes` is not an array or `line` lacks `strokeStart` / `strokeCount`.
 * @param {any} strokes
 * @param {any} line
 * @returns {any}
 */
export function inkLineStrokes(strokes, line) {
    const ret = wasm.inkLineStrokes(strokes, line);
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
 * [`ink_page_background`](ink_page::ink_page_background): the background path, or `null`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} text
 * @returns {any}
 */
export function inkPageBackground(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.inkPageBackground(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`ink_page_figures`](figure::ink_page_figures): the figures a page's text places.
 *
 * # Errors
 *
 * Fails if `text` is longer than the index text limit.
 * @param {string} text
 * @returns {any}
 */
export function inkPageFigures(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.inkPageFigures(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`ink_page_marker`](ink_page::ink_page_marker): the `<!-- page N -->` line for page `page`.
 * @param {number} page
 * @returns {string}
 */
export function inkPageMarker(page) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.inkPageMarker(page);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`ink_page_over_budget`](ink_page::ink_page_over_budget): whether the page has too many strokes.
 *
 * # Errors
 *
 * Fails if `page` has the wrong shape.
 * @param {any} page
 * @returns {boolean}
 */
export function inkPageOverBudget(page) {
    const ret = wasm.inkPageOverBudget(page);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`ink_page_svg`]: `page` is an `InkSvgPage`, `options` an `InkSvgOptions` (may be `{}`).
 * @param {any} page
 * @param {any} options
 * @returns {string}
 */
export function inkPageSvg(page, options) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.inkPageSvg(page, options);
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
 * [`point_in_polygon`](hit_test::point_in_polygon) over a flat `x,y` array.
 *
 * # Errors
 *
 * Fails if `polygon` is not an array of numbers.
 * @param {number} px
 * @param {number} py
 * @param {any} polygon
 * @returns {boolean}
 */
export function inkPointInPolygon(px, py, polygon) {
    const ret = wasm.inkPointInPolygon(px, py, polygon);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
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
 * [`ink_print_document`]: the page as an HTML document for a print frame's `srcdoc`.
 * @param {any} doc
 * @returns {string}
 */
export function inkPrintDocument(doc) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.inkPrintDocument(doc);
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
 * [`ink_sidecar_dir`](ink_paths::ink_sidecar_dir).
 *
 * # Errors
 *
 * Fails when `noteId` is not a safe id.
 * @param {string} note_id
 * @returns {string}
 */
export function inkSidecarDir(note_id) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(note_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.inkSidecarDir(ptr0, len0);
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
 * [`ink_stroke_band`](wf_core::ink::segment::ink_stroke_band): `[yMin, yMax]` over a
 * stroke's flat x,y points, or `undefined` when no y is finite.
 * @param {Float64Array} points
 * @returns {Float64Array | undefined}
 */
export function inkStrokeBandOf(points) {
    const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.inkStrokeBandOf(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    }
    return v2;
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
 * [`ink_vocabulary_words`](wf_core::ink::decode::ink_vocabulary_words), sorted
 * (TS `inkVocabularyWords`; the TS wrapper makes it a `Set`).
 *
 * # Errors
 *
 * Fails if `vocabulary` is not an array of strings.
 * @param {any} vocabulary
 * @returns {any}
 */
export function inkVocabularyWordList(vocabulary) {
    const ret = wasm.inkVocabularyWordList(vocabulary);
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
 * [`cache_invalidation::invalidation_map`]: one entry per resource type.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @returns {any}
 */
export function invalidationMap() {
    const ret = wasm.invalidationMap();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`cache_invalidation::plan`] for the resource type named `resource_type`, or `undefined` for an
 * unknown name.
 *
 * # Errors
 *
 * Fails if `resource_type` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} resource_type
 * @returns {any}
 */
export function invalidationPlan(resource_type) {
    const ptr0 = passStringToWasm0(resource_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.invalidationPlan(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`inverted_abstract`](related_paper_hit::inverted_abstract): the abstract text, or nothing.
 *
 * # Errors
 *
 * Fails if `index` is neither an object nor missing.
 * @param {any} index
 * @returns {any}
 */
export function invertedAbstract(index) {
    const ret = wasm.invertedAbstract(index);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`is_all_pages`](pdf_pages::is_all_pages).
 * @param {string} answer
 * @returns {boolean}
 */
export function isAllPages(answer) {
    const ptr0 = passStringToWasm0(answer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isAllPages(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_allowed_pdf_proxy_url`]: https, no credentials, and an allowlisted host.
 * @param {string} raw
 * @returns {boolean}
 */
export function isAllowedPdfProxyUrl(raw) {
    const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isAllowedPdfProxyUrl(ptr0, len0);
    return ret !== 0;
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
 * [`is_api_host`](api_host::is_api_host): the URL's host is `weaveforge.org` or a subdomain of it.
 * @param {string} url
 * @returns {boolean}
 */
export function isApiHost(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isApiHost(ptr0, len0);
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
 * [`is_bib_file`](paper_drop::is_bib_file) (TS `isBibFile`).
 * @param {string} name
 * @returns {boolean}
 */
export function isBibFile(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isBibFile(ptr0, len0);
    return ret !== 0;
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
 * [`local_first_route::is_both_ends_rpc`].
 * @param {string} name
 * @returns {boolean}
 */
export function isBothEndsRpc(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isBothEndsRpc(ptr0, len0);
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
 * [`is_conference_copy`] (TS `isConferenceCopy`).
 *
 * # Errors
 *
 * Fails if `paper` is not a paper summary.
 * @param {any} paper
 * @returns {boolean}
 */
export function isConferenceCopy(paper) {
    const ret = wasm.isConferenceCopy(paper);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`rules::is_creatable_kind`].
 * @param {string} kind
 * @returns {boolean}
 */
export function isCreatableKind(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isCreatableKind(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_dismiss_tap`]: `down` and `up` are `{ x, y, time }`; `down` may be `null`.
 *
 * # Errors
 *
 * Fails if `down` or `up` is not a press object of numbers.
 * @param {any} down
 * @param {any} up
 * @param {boolean} bar_open
 * @returns {boolean}
 */
export function isDismissTap(down, up, bar_open) {
    const ret = wasm.isDismissTap(down, up, bar_open);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`rules::is_document_kind`].
 * @param {string} kind
 * @returns {boolean}
 */
export function isDocumentKind(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isDocumentKind(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_document_node`](tree::is_document_node).
 *
 * # Errors
 *
 * Fails if `node` has the wrong shape.
 * @param {any} node
 * @returns {boolean}
 */
export function isDocumentNode(node) {
    const ret = wasm.isDocumentNode(node);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_editable_reader_target`]: whether a target with this `tagName` and
 * `isContentEditable` owns its keystrokes.
 * @param {string | null | undefined} tag_name
 * @param {boolean} content_editable
 * @returns {boolean}
 */
export function isEditableReaderTarget(tag_name, content_editable) {
    var ptr0 = isLikeNone(tag_name) ? 0 : passStringToWasm0(tag_name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.isEditableReaderTarget(ptr0, len0, content_editable);
    return ret !== 0;
}

/**
 * [`is_electron_entry`](mcp_config_rewrite::is_electron_entry): an entry the Electron app wrote.
 * @param {any} entry
 * @returns {boolean}
 */
export function isElectronMcpEntry(entry) {
    const ret = wasm.isElectronMcpEntry(entry);
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
 * [`is_html_content_type`]: whether a response counts as a web page.
 * @param {string | null} [value]
 * @returns {boolean}
 */
export function isHtmlContentType(value) {
    var ptr0 = isLikeNone(value) ? 0 : passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.isHtmlContentType(ptr0, len0);
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
 * [`is_ink_engine_id`](ink_engine::is_ink_engine_id).
 * @param {string} id
 * @returns {boolean}
 */
export function isInkEngineId(id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isInkEngineId(ptr0, len0);
    return ret !== 0;
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
 * [`is_ink_note_frontmatter`](ink_note::is_ink_note_frontmatter).
 *
 * # Errors
 *
 * Fails if `frontmatter` is not an object.
 * @param {any} frontmatter
 * @returns {boolean}
 */
export function isInkNoteFrontmatter(frontmatter) {
    const ret = wasm.isInkNoteFrontmatter(frontmatter);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_ink_note_id`](ink_paths::is_ink_note_id).
 * @param {string} id
 * @returns {boolean}
 */
export function isInkNoteId(id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isInkNoteId(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_ink_tool`]: `ink` and `highlighter` draw on the page.
 * @param {string} tool
 * @returns {boolean}
 */
export function isInkTool(tool) {
    const ptr0 = passStringToWasm0(tool, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isInkTool(ptr0, len0);
    return ret !== 0;
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
 * [`cache_invalidation::is_known_resource_type`]: whether `value` names a resource type.
 * @param {string} value
 * @returns {boolean}
 */
export function isKnownResourceType(value) {
    const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isKnownResourceType(ptr0, len0);
    return ret !== 0;
}

/**
 * [`pglite_sql::is_literal`] (TS `isLiteral`): `null`, `true` or `false`.
 *
 * # Errors
 *
 * Returns an error for any other operand.
 * @param {string} text
 * @returns {string}
 */
export function isLiteral(text) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.isLiteral(ptr0, len0);
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
 * [`is_local_zotero_url`]: whether `url` is the local Zotero API's own path with no credentials.
 * @param {string} url
 * @returns {boolean}
 */
export function isLocalZoteroUrl(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isLocalZoteroUrl(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_missing_service_role`](org::is_missing_service_role).
 * @param {string} message
 * @returns {boolean}
 */
export function isMissingServiceRole(message) {
    const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isMissingServiceRole(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_newer`]: whether `candidate` is later than `current`, both `[major, minor, patch]`.
 *
 * # Errors
 *
 * Fails if either argument is not three numbers.
 * @param {any} candidate
 * @param {any} current
 * @returns {boolean}
 */
export function isNewerVersion(candidate, current) {
    const ret = wasm.isNewerVersion(candidate, current);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_note_import_file`](import_links::is_note_import_file).
 * @param {string} name
 * @returns {boolean}
 */
export function isNoteImportFile(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isNoteImportFile(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_on_sampling_grid`](experiments::is_on_sampling_grid).
 * @param {number} step
 * @returns {boolean}
 */
export function isOnSamplingGrid(step) {
    const ret = wasm.isOnSamplingGrid(step);
    return ret !== 0;
}

/**
 * [`is_valid_project_id`](overleaf::is_valid_project_id).
 * @param {string} id
 * @returns {boolean}
 */
export function isOverleafProjectId(id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isOverleafProjectId(ptr0, len0);
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
 * [`is_pdf_content_type`]: whether a `Content-Type` value names a PDF. `null` or empty is not.
 * @param {string | null} [value]
 * @returns {boolean}
 */
export function isPdfContentType(value) {
    var ptr0 = isLikeNone(value) ? 0 : passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.isPdfContentType(ptr0, len0);
    return ret !== 0;
}

/**
 * [`is_pdf_file`](paper_drop::is_pdf_file) (TS `isPdfFile`).
 * @param {string} name
 * @param {string} mime_type
 * @returns {boolean}
 */
export function isPdfFile(name, mime_type) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(mime_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.isPdfFile(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * [`is_pen_barrel_pointer`](pen_pointer::is_pen_barrel_pointer): whether a pen touched
 * down with its barrel button held.
 * @param {string} pointer_type
 * @param {number | null} [button]
 * @param {number | null} [buttons]
 * @returns {boolean}
 */
export function isPenBarrelPointer(pointer_type, button, buttons) {
    const ptr0 = passStringToWasm0(pointer_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isPenBarrelPointer(ptr0, len0, !isLikeNone(button), isLikeNone(button) ? 0 : button, !isLikeNone(buttons), isLikeNone(buttons) ? 0 : buttons);
    return ret !== 0;
}

/**
 * [`is_pen_eraser_pointer`](pen_pointer::is_pen_eraser_pointer): whether a pointer
 * event is the pen's eraser end.
 * @param {string} pointer_type
 * @param {number | null} [button]
 * @param {number | null} [buttons]
 * @returns {boolean}
 */
export function isPenEraserPointer(pointer_type, button, buttons) {
    const ptr0 = passStringToWasm0(pointer_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isPenEraserPointer(ptr0, len0, !isLikeNone(button), isLikeNone(button) ? 0 : button, !isLikeNone(buttons), isLikeNone(buttons) ? 0 : buttons);
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
 * [`is_preview_key`](palette_sort::is_preview_key): whether a key press opens the preview.
 *
 * # Errors
 *
 * Fails if `event` has the wrong shape.
 * @param {any} event
 * @param {boolean} in_text_box
 * @returns {boolean}
 */
export function isPreviewKey(event, in_text_box) {
    const ret = wasm.isPreviewKey(event, in_text_box);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_private_host`](private_host::is_private_host): a host this machine or its network answers for.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isPrivateHost(hostname) {
    const ptr0 = passStringToWasm0(hostname, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isPrivateHost(ptr0, len0);
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
 * [`is_public_https_url`](private_host::is_public_https_url): https, no credentials, public host.
 * `false` for text that does not parse, as the TS `catch` did.
 * @param {string} raw
 * @returns {boolean}
 */
export function isPublicHttpsUrl(raw) {
    const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isPublicHttpsUrl(ptr0, len0);
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
 * [`is_open`](state::is_open).
 *
 * # Errors
 *
 * Fails if the open argument is not an array of strings.
 * @param {any} open
 * @param {string} id
 * @returns {boolean}
 */
export function isSectionOpen(open, id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isSectionOpen(open, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_settled`](panel_labels::is_settled): whether a field's choice is complete.
 *
 * # Errors
 *
 * Fails if `choice` has the wrong shape.
 * @param {any} choice
 * @param {string} ours
 * @param {string} theirs
 * @returns {boolean}
 */
export function isSettled(choice, ours, theirs) {
    const ptr0 = passStringToWasm0(ours, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(theirs, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.isSettled(choice, ptr0, len0, ptr1, len1);
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
 * [`is_substantial_paper_text`]: whether the text reaches `min_chars` once whitespace is collapsed.
 * @param {string} text
 * @param {number} min_chars
 * @returns {boolean}
 */
export function isSubstantialPaperText(text, min_chars) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isSubstantialPaperText(ptr0, len0, min_chars);
    return ret !== 0;
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
 * [`local_first_route::is_synced_table`].
 * @param {string} table
 * @returns {boolean}
 */
export function isSyncedTable(table) {
    const ptr0 = passStringToWasm0(table, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.isSyncedTable(ptr0, len0);
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
 * [`is_web_article`]: `ids` is an `OpenAccessIds`.
 *
 * # Errors
 *
 * Fails if `ids` does not have the expected shape.
 * @param {any} ids
 * @returns {boolean}
 */
export function isWebArticle(ids) {
    const ret = wasm.isWebArticle(ids);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`is_child_item`](zotero_library::is_child_item): true for an attachment, note, annotation or
 * an item with a parent.
 *
 * # Errors
 *
 * Fails if `item` cannot be read as an object.
 * @param {any} item
 * @returns {boolean}
 */
export function isZoteroChildItem(item) {
    const ret = wasm.isZoteroChildItem(item);
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
 * [`join_bibtex`](bibtex::join_bibtex): entries joined with a blank line, or `% (empty)`.
 *
 * # Errors
 *
 * Fails if `entries` is not an array of strings.
 * @param {any} entries
 * @returns {string}
 */
export function joinBibtex(entries) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.joinBibtex(entries);
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
 * [`join_ink_text_layer`](ink_page::join_ink_text_layer): one text layer per page, joined.
 *
 * # Errors
 *
 * Fails if `pages` is not an array of strings.
 * @param {any} pages
 * @returns {string}
 */
export function joinInkTextLayer(pages) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.joinInkTextLayer(pages);
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
 * [`json_edit_since`](folder_mirror::json_edit_since). `base` is the recorded digest map.
 *
 * # Errors
 *
 * Fails when `base` is not an object of string digests.
 * @param {any} base
 * @param {string} path
 * @param {string} text
 * @returns {boolean}
 */
export function jsonEditSince(base, path, text) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.jsonEditSince(base, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
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
 * [`keep_figure_on_page`](figure::keep_figure_on_page): the box's `[x, y]` kept half on the page.
 *
 * # Errors
 *
 * Fails if `rect` has the wrong shape.
 * @param {any} rect
 * @param {number} width
 * @param {number} height
 * @returns {Float64Array}
 */
export function keepFigureOnPage(rect, width, height) {
    const ret = wasm.keepFigureOnPage(rect, width, height);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v1;
}

/**
 * [`shortcut_label::key_label`]: one keycap, `⌘` reads `Ctrl` off a Mac.
 * @param {string} key
 * @param {boolean} mac
 * @returns {string}
 */
export function keyLabel(key, mac) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.keyLabel(ptr0, len0, mac);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`rules::kind_icon`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @returns {any}
 */
export function kindIcon(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.kindIcon(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rules::kind_icon_class`]. `open` defaults to false.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @param {boolean | null} [open]
 * @returns {any}
 */
export function kindIconClass(kind, open) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.kindIconClass(ptr0, len0, isLikeNone(open) ? 0xFFFFFF : open ? 1 : 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`rules::KINDS`] as a string array.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @returns {any}
 */
export function kindNames() {
    const ret = wasm.kindNames();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`kind_of`](panel_labels::kind_of): the label for a synced table.
 * @param {string} table
 * @returns {string}
 */
export function kindOf(table) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(table, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.kindOf(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`rules::kind_owner`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @returns {any}
 */
export function kindOwner(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.kindOwner(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rules::kind_suffix`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @returns {any}
 */
export function kindSuffix(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.kindSuffix(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rules::kind_tint_class`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @returns {any}
 */
export function kindTintClass(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.kindTintClass(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`kinds_for_resource`](search_index_state::kinds_for_resource): the kinds a write can change, or `null` when unmapped.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialized.
 * @param {string} resource_type
 * @returns {any}
 */
export function kindsForResource(resource_type) {
    const ptr0 = passStringToWasm0(resource_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.kindsForResource(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::papers::open_access::known_candidates`]: the paper's own PDF and page.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string | null} [known_pdf]
 * @param {string | null} [page]
 * @returns {any}
 */
export function knownCandidates(known_pdf, page) {
    var ptr0 = isLikeNone(known_pdf) ? 0 : passStringToWasm0(known_pdf, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(page) ? 0 : passStringToWasm0(page, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.knownCandidates(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_domain`]: a `lab_snapshots` row as a published snapshot.
 * @param {any} row
 * @returns {any}
 */
export function labSnapshotRowToDomain(row) {
    const ret = wasm.labSnapshotRowToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`route_title::label_for_path`]: the screen's own name, or `undefined` for a route with none.
 *
 * # Errors
 *
 * Fails if `nav_items` is not an array of `{ path, label }` objects.
 * @param {string} pathname
 * @param {any} nav_items
 * @returns {string | undefined}
 */
export function labelForPath(pathname, nav_items) {
    const ptr0 = passStringToWasm0(pathname, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.labelForPath(ptr0, len0, nav_items);
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
 * [`label_size`](graph_sizing::label_size) as `{ font, line, gap }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {boolean} is_tag
 * @param {number} zoom
 * @param {boolean} bounded
 * @returns {any}
 */
export function labelSize(is_tag, zoom, bounded) {
    const ret = wasm.labelSize(is_tag, zoom, bounded);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`layout_for_command`](pane::layout_for_command). `command` is a chord name such as `"split-right"`.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 * @param {any} layout
 * @param {any} command
 * @param {string} new_pane_id
 * @returns {any}
 */
export function layoutForCommand(layout, command, new_pane_id) {
    const ptr0 = passStringToWasm0(new_pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.layoutForCommand(layout, command, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`layout_for_tab_menu`](pane::layout_for_tab_menu).
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 * @param {any} layout
 * @param {string} pane_id
 * @param {number} index
 * @param {any} command
 * @param {string} new_pane_id
 * @returns {any}
 */
export function layoutForTabMenu(layout, pane_id, index, command, new_pane_id) {
    const ptr0 = passStringToWasm0(pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(new_pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.layoutForTabMenu(layout, ptr0, len0, index, command, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`layout_from_record`](layout_record::layout_from_record). A missing or
 * unusable record is one empty pane, so this never fails on content.
 *
 * # Errors
 *
 * Never fails in practice; returns the serializer's result type.
 * @param {string | null} [raw]
 * @returns {any}
 */
export function layoutFromRecord(raw) {
    var ptr0 = isLikeNone(raw) ? 0 : passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.layoutFromRecord(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`layout_margin_notes`]: `marks` is one `{ hasComment, hasPicture, geometry }` per
 * annotation and `projection` a page projection. Returns `{ index, top, anchorTop }[]` in
 * ascending `anchorTop` order, where `index` is the mark's position in `marks`.
 *
 * # Errors
 *
 * Fails if `marks` or `projection` do not have the expected shape.
 * @param {any} marks
 * @param {any} projection
 * @param {number} card_height
 * @returns {any}
 */
export function layoutMarginNotes(marks, projection, card_height) {
    const ret = wasm.layoutMarginNotes(marks, projection, card_height);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`leaves`](pane::leaves). Returns owned copies of the leaves.
 *
 * # Errors
 *
 * Fails if `node` has the wrong shape.
 * @param {any} node
 * @returns {any}
 */
export function leaves(node) {
    const ret = wasm.leaves(node);
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
 * [`library_bibtex`](bibtex::library_bibtex): the whole library as one `.bib`.
 *
 * # Errors
 *
 * Fails if `papers` is not an array of paper objects.
 * @param {any} papers_value
 * @returns {string}
 */
export function libraryBibtex(papers_value) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.libraryBibtex(papers_value);
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
 * [`to_domain`]: a `library_pins` row as a library pin.
 *
 * # Errors
 *
 * Fails if the row cannot be read as a `library_pins` row.
 * @param {any} row
 * @returns {any}
 */
export function libraryPinRowToDomain(row) {
    const ret = wasm.libraryPinRowToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`rules::link_group_of`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @returns {any}
 */
export function linkGroupOf(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.linkGroupOf(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`link_node_id`] (TS `linkNodeId`). `source` is a string endpoint or an endpoint object; the
 * result is the id, or `null` when there is none.
 *
 * # Errors
 *
 * Fails if `source` cannot be read as a JSON value.
 * @param {any} source
 * @returns {any}
 */
export function linkNodeId(source) {
    const ret = wasm.linkNodeId(source);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`lint_wiki`](wiki_lint::lint_wiki). A missing `otherTitles` means none, as in the TS default.
 *
 * # Errors
 *
 * Fails if `pages` is not a list of `{ id, title, body, aliases? }` objects, or `otherTitles`
 * is not a list of strings.
 * @param {any} pages
 * @param {any} other_titles
 * @returns {any}
 */
export function lintWiki(pages, other_titles) {
    const ret = wasm.lintWiki(pages, other_titles);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`list_display_colour`](reading_list::list_display_colour).
 *
 * # Errors
 *
 * Fails if `list` has the wrong shape.
 * @param {any} list
 * @returns {string}
 */
export function listDisplayColor(list) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.listDisplayColor(list);
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
 * [`list_membership`](tree::list_membership). Returns a JS `Map` of `kind:id` to list titles.
 *
 * # Errors
 *
 * Fails if either argument has the wrong shape.
 * @param {any} items
 * @param {any} titles
 * @returns {any}
 */
export function listMembership(items, titles) {
    const ret = wasm.listMembership(items, titles);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`list_membership`](reading_list::list_membership) (TS `buildListMembership`). `key` is
 * `"paper"`, `"vaultPage"` or `"either"`. Returns `[listId, resourceIds[]]` pairs in list order.
 *
 * # Errors
 *
 * Fails if `lists`, `items` or `key` has the wrong shape.
 * @param {any} lists
 * @param {any} items
 * @param {any} key
 * @returns {any}
 */
export function listMembershipByKey(lists, items, key) {
    const ret = wasm.listMembershipByKey(lists, items, key);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`nav_open_groups::load_open_groups`]: the open groups from stored JSON, with `active` forced open.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 * @param {string | null} [raw]
 * @param {string | null} [active]
 * @returns {any}
 */
export function loadOpenGroups(raw, active) {
    var ptr0 = isLikeNone(raw) ? 0 : passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(active) ? 0 : passStringToWasm0(active, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.loadOpenGroups(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`local_keys`](related_paper_hit::local_keys): the dedupe keys of a library.
 *
 * # Errors
 *
 * Fails if `papers` cannot be read as a list of library papers.
 * @param {any} papers
 * @returns {any}
 */
export function localKeys(papers) {
    const ret = wasm.localKeys(papers);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`local_subgraph`] (TS `localSubgraph`). `neighbors` is an array of `[id, neighbourIds]` pairs.
 *
 * # Errors
 *
 * Fails if `neighbors` is not an array of `[string, string[]]` pairs.
 * @param {string | null | undefined} seed
 * @param {number} depth
 * @param {any} neighbors
 * @returns {any}
 */
export function localSubgraph(seed, depth, neighbors) {
    var ptr0 = isLikeNone(seed) ? 0 : passStringToWasm0(seed, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.localSubgraph(ptr0, len0, depth, neighbors);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`locate_anchor`](text_anchor::locate_anchor): `{ start, end }`, or `null`.
 *
 * # Errors
 *
 * Fails when `anchor` is not a comment anchor.
 * @param {string} text
 * @param {any} anchor
 * @returns {any}
 */
export function locateAnchor(text, anchor) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.locateAnchor(ptr0, len0, anchor);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`locate_mention`]: the rects and bounds a mention covers on its page.
 *
 * # Errors
 *
 * Fails if `items` is not an array of page text items.
 * @param {any} items
 * @param {number} start
 * @param {number} end
 * @returns {any}
 */
export function locateMention(items, start, end) {
    const ret = wasm.locateMention(items, start, end);
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
 * [`log_entry_message`] for JS (TS `logEntryMessage`).
 *
 * # Errors
 *
 * Fails when `input` is not a log entry message input with the expected fields.
 * @param {any} input
 * @returns {string}
 */
export function logEntryMessage(input) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.logEntryMessage(input);
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
 * [`to_domain`]: a `log_entries` row as a domain entry.
 * @param {any} row
 * @returns {any}
 */
export function logEntryToDomain(row) {
    const ret = wasm.logEntryToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_row`]: a domain entry as the `log_entries` row it is written as.
 * @param {any} entry
 * @returns {any}
 */
export function logEntryToRow(entry) {
    const ret = wasm.logEntryToRow(entry);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`log_eyebrow`] for JS (TS `logEyebrow`): the line, or `undefined` with no entries.
 *
 * # Errors
 *
 * Fails when `entryDates` is not an array of strings.
 * @param {any} entry_dates
 * @param {string} today
 * @returns {any}
 */
export function logEyebrow(entry_dates, today) {
    const ptr0 = passStringToWasm0(today, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.logEyebrow(entry_dates, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`log_path`](folder_layout::log_path).
 * @param {string} id
 * @param {string} entry_date
 * @param {string} project_root
 * @returns {string}
 */
export function logPath(id, entry_date, project_root) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(entry_date, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(project_root, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.logPath(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
}

/**
 * [`looks_like_image_url`](wf_core::net::image_url::looks_like_image_url): the URL's own
 * path names a picture, so a pasted link is worth downloading.
 * @param {string} url
 * @returns {boolean}
 */
export function looksLikeImageUrl(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.looksLikeImageUrl(ptr0, len0);
    return ret !== 0;
}

/**
 * [`looks_like_pdf_url`]: `true` for a direct PDF path, `false` for an HTML landing page.
 * @param {string} url
 * @returns {boolean}
 */
export function looksLikePdfUrl(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.looksLikePdfUrl(ptr0, len0);
    return ret !== 0;
}

/**
 * [`make_ink_stroke`](ink_page::make_ink_stroke) with the defaults filled in.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape.
 * @param {any} input
 * @returns {any}
 */
export function makeInkStroke(input) {
    const ret = wasm.makeInkStroke(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`mark_actions`]: what the popover on a tapped mark offers, or `null` when it offers nothing.
 *
 * # Errors
 *
 * Fails if `target` is not a mark's `{ type, origin, comment }` object.
 * @param {any} target
 * @returns {any}
 */
export function markActions(target) {
    const ret = wasm.markActions(target);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`mark_colour_tool`]: returns `"pen"`, `"highlight"`, `"underline"` or `"text"`.
 * @param {string} mark_type
 * @returns {string}
 */
export function markColourTool(mark_type) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(mark_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.markColourTool(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`mark_popover_shown`]: whether a mark's popover shows under the current tool.
 * @param {string} annotation_type
 * @param {string} tool
 * @returns {boolean}
 */
export function markPopoverShown(annotation_type, tool) {
    const ptr0 = passStringToWasm0(annotation_type, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(tool, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.markPopoverShown(ptr0, len0, ptr1, len1);
    return ret !== 0;
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
 * [`match_vocabulary`](vocab_match::match_vocabulary) as `{ text, matches }`.
 *
 * # Errors
 *
 * Fails if `vocabulary` is not an array of strings, or the result cannot be serialised.
 * @param {string} text
 * @param {any} vocabulary
 * @returns {any}
 */
export function matchVocabulary(text, vocabulary) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.matchVocabulary(ptr0, len0, vocabulary);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`matching_page_indices`](palette_groups::matching_page_indices): the indices of the labels that
 * hold `query`, names that start with it first.
 *
 * # Errors
 *
 * Fails if `query` is too long or `labels` is not an array of strings.
 * @param {any} labels
 * @param {string} query
 * @returns {any}
 */
export function matchingPageIndices(labels, query) {
    const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.matchingPageIndices(labels, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`mattermost_channel_for`](options::mattermost_channel_for); `undefined` when the event is off.
 *
 * # Errors
 *
 * Fails if `integration` or `event` has the wrong shape.
 * @param {any} integration
 * @param {any} event
 * @returns {string | undefined}
 */
export function mattermostChannelFor(integration, event) {
    const ret = wasm.mattermostChannelFor(integration, event);
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
 * [`mattermost_connection`](fields::mattermost_connection).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 * @param {any} integration
 * @returns {any}
 */
export function mattermostConnection(integration) {
    const ret = wasm.mattermostConnection(integration);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`mattermost_connection_ready`](fields::mattermost_connection_ready).
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 * @param {any} integration
 * @returns {boolean}
 */
export function mattermostConnectionReady(integration) {
    const ret = wasm.mattermostConnectionReady(integration);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`mattermost_events`](options::mattermost_events): the settings rows, in panel order.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @returns {any}
 */
export function mattermostEvents() {
    const ret = wasm.mattermostEvents();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`mattermost_options`](options::mattermost_options) with the defaults applied.
 *
 * # Errors
 *
 * Fails if `integration` has the wrong shape.
 * @param {any} integration
 * @returns {any}
 */
export function mattermostOptions(integration) {
    const ret = wasm.mattermostOptions(integration);
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
 * [`MAX_REPORT_CHARS`] for JS, so the wrapper's default cap matches Rust.
 * @returns {number}
 */
export function maxReportChars() {
    const ret = wasm.maxReportChars();
    return ret >>> 0;
}

/**
 * [`blob_access::MAX_SIGNED_URL_PATHS`]: most paths one signed-url request may ask for.
 * @returns {number}
 */
export function maxSignedUrlPaths() {
    const ret = wasm.maxSignedUrlPaths();
    return ret >>> 0;
}

/**
 * [`may_drive_device`] for JS (TS `mayDriveDevice`).
 * @param {string | null} [signed_in_user_id]
 * @param {string | null} [adopted_account_id]
 * @returns {boolean}
 */
export function mayDriveDevice(signed_in_user_id, adopted_account_id) {
    var ptr0 = isLikeNone(signed_in_user_id) ? 0 : passStringToWasm0(signed_in_user_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(adopted_account_id) ? 0 : passStringToWasm0(adopted_account_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.mayDriveDevice(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * [`may_open_externally`](open_external::may_open_externally): a plain web address, with no
 * credentials, on an allowed port and not a private host. Scheme-less input is read as https.
 * @param {string} url
 * @returns {boolean}
 */
export function mayOpenExternally(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.mayOpenExternally(ptr0, len0);
    return ret !== 0;
}

/**
 * [`mcp_file_of`](mcp_config_rewrite::mcp_file_of): the MCP file name an env points at.
 * @param {any} env
 * @returns {string}
 */
export function mcpFileOf(env) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.mcpFileOf(env);
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
 * [`mcp_servers_json`](mcp_client_config::mcp_servers_json) for a `McpLaunchLine`.
 *
 * # Errors
 *
 * Fails if `launch` has the wrong shape.
 * @param {any} launch
 * @returns {string}
 */
export function mcpServersJson(launch) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.mcpServersJson(launch);
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
 * [`media_type_essence`]: the media type without parameters, lowercased.
 * @param {string} value
 * @returns {string}
 */
export function mediaTypeEssence(value) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(value, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.mediaTypeEssence(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`member_name_map`](wf_core::member::member_name_map).
 *
 * # Errors
 *
 * Fails when `members` is not a list of member sources.
 * @param {any} members
 * @returns {any}
 */
export function memberNameMap(members) {
    const ret = wasm.memberNameMap(members);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rules::member_rank`].
 * @param {string} kind
 * @returns {number}
 */
export function memberRank(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.memberRank(ptr0, len0);
    return ret;
}

/**
 * [`member_role_label`](member::member_role_label): the label, or `undefined` when the role has none.
 *
 * # Errors
 *
 * Fails if `member` has the wrong shape.
 * @param {any} member
 * @param {boolean} in_lab
 * @param {boolean} owns_org
 * @returns {string | undefined}
 */
export function memberRoleLabelOf(member, in_lab, owns_org) {
    const ret = wasm.memberRoleLabelOf(member, in_lab, owns_org);
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
 * [`to_domain`]: a `profiles` row as a lab member.
 * @param {any} row
 * @returns {any}
 */
export function memberRowToDomain(row) {
    const ret = wasm.memberRowToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_view`]: an `org_memberships` row with its embedded organisation as a membership view.
 * @param {any} row
 * @returns {any}
 */
export function membershipViewFromRow(row) {
    const ret = wasm.membershipViewFromRow(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`mention_item_ranges`]: where a mention's offsets fall in each run it covers.
 *
 * # Errors
 *
 * Fails if `items` is not an array of page text items.
 * @param {any} items
 * @param {number} start
 * @param {number} end
 * @returns {any}
 */
export function mentionItemRanges(items, start, end) {
    const ret = wasm.mentionItemRanges(items, start, end);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`merge_both_changed`](folder_merge::merge_both_changed). `base` and `workspace_content`
 * may be absent, which keeps the entry as it was.
 *
 * # Errors
 *
 * Fails when `entry` or `base` is not the shape the folder import produces.
 * @param {any} entry
 * @param {any} base
 * @param {string | null} [workspace_content]
 * @returns {any}
 */
export function mergeBothChanged(entry, base, workspace_content) {
    var ptr0 = isLikeNone(workspace_content) ? 0 : passStringToWasm0(workspace_content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.mergeBothChanged(entry, base, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`merge_extractions`](extraction::merge_extractions).
 *
 * # Errors
 *
 * Fails when `results` is not a list of extraction results.
 * @param {any} results
 * @returns {any}
 */
export function mergeExtractions(results) {
    const ret = wasm.mergeExtractions(results);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`merge_graph_persisted_state`](graph_settings::merge_graph_persisted_state): `stored` is the
 * parsed state, or `null` for the defaults.
 *
 * # Errors
 *
 * Fails if `stored` has the wrong shape.
 * @param {any} stored
 * @returns {any}
 */
export function mergeGraphPersistedState(stored) {
    const ret = wasm.mergeGraphPersistedState(stored);
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
 * [`merge_paper_into`] (TS `mergePaperInto`). The kept paper with the duplicate's gaps filled.
 *
 * # Errors
 *
 * Fails if either argument is not a paper, or the result cannot be converted.
 * @param {any} keep
 * @param {any} dup
 * @returns {any}
 */
export function mergePaperInto(keep, dup) {
    const ret = wasm.mergePaperInto(keep, dup);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`merge_reader_annotations`](merge_annotations::merge_reader_annotations): Zotero and
 * local rows as one list sorted by `sortIndex`. Rows come back as copies, not the same
 * objects, and an `undefined` field reads back as `null`.
 *
 * # Errors
 *
 * Fails if either argument is not an array, or the result cannot be converted to JS.
 * @param {any} zotero
 * @param {any} local
 * @returns {any}
 */
export function mergeReaderAnnotations(zotero, local) {
    const ret = wasm.mergeReaderAnnotations(zotero, local);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`merge_seen_ids`](citation_alerts::merge_seen_ids): prior ids, then new ones, each once.
 * @param {string[]} prior
 * @param {string[]} current
 * @returns {string[]}
 */
export function mergeSeenIds(prior, current) {
    const ptr0 = passArrayJsValueToWasm0(prior, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(current, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.mergeSeenIds(ptr0, len0, ptr1, len1);
    var v3 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v3;
}

/**
 * [`merge_template`](tpl::merge_template).
 * @param {string} existing
 * @param {string} rendered
 * @returns {string}
 */
export function mergeTemplate(existing, rendered) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(existing, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(rendered, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.mergeTemplate(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
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
 * [`metadata_title`](paper_drop::metadata_title) (TS `metadataTitle`).
 * @param {string | null} [raw]
 * @returns {string | undefined}
 */
export function metadataTitle(raw) {
    var ptr0 = isLikeNone(raw) ? 0 : passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.metadataTitle(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`metric_keys`](experiment_status::metric_keys): the metric names across runs, in UTF-16 order.
 *
 * # Errors
 *
 * Fails if `experiments` is not an array of run objects.
 * @param {any} experiments
 * @returns {any}
 */
export function metricKeys(experiments) {
    const ret = wasm.metricKeys(experiments);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_domain`]: a metric row as a metric point.
 * @param {any} row
 * @returns {any}
 */
export function metricRowToDomain(row) {
    const ret = wasm.metricRowToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`migrated_expanded`](state::migrated_expanded).
 *
 * # Errors
 *
 * Fails if an argument is not an array of strings, or the result cannot be serialised.
 * @param {any} saved
 * @param {any} roots
 * @returns {any}
 */
export function migratedExpanded(saved, roots) {
    const ret = wasm.migratedExpanded(saved, roots);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`migrated_notice`](migrated_notice::migrated_notice): the warning for the marker's text, or
 * `undefined` when there is no marker. The TS wrapper maps `undefined` to `null`.
 * @param {string | null} [raw]
 * @returns {string | undefined}
 */
export function migratedNotice(raw) {
    var ptr0 = isLikeNone(raw) ? 0 : passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.migratedNotice(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`to_milestone`]: a `milestones` row as the app's milestone.
 * @param {any} row
 * @returns {any}
 */
export function milestoneFromRow(row) {
    const ret = wasm.milestoneFromRow(row);
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
 * [`milestone_message`] for JS (TS `milestoneMessage`).
 *
 * # Errors
 *
 * Fails when `input` is not a milestone message input with the expected fields.
 * @param {any} input
 * @returns {string}
 */
export function milestoneMessage(input) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.milestoneMessage(input);
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
 * [`to_row`]: a milestone as the `milestones` row it is written as.
 * @param {any} milestone
 * @returns {any}
 */
export function milestoneToRow(milestone) {
    const ret = wasm.milestoneToRow(milestone);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`milestones_to_ics`](feed::milestones_to_ics): the `.ics` text for `items`.
 *
 * # Errors
 *
 * Fails if `items` has the wrong shape.
 * @param {any} items
 * @param {boolean} include_done
 * @param {number} reminder_days
 * @param {number} now_ms
 * @returns {string}
 */
export function milestonesToIcs(items, include_done, reminder_days, now_ms) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.milestonesToIcs(items, include_done, reminder_days, now_ms);
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
 * [`MIN_ARTICLE_TEXT_CHARS`]: the text a paper's own web page must carry.
 * @returns {number}
 */
export function minArticleTextChars() {
    const ret = wasm.minArticleTextChars();
    return ret;
}

/**
 * [`MIN_PAPER_TEXT_CHARS`]: how much text a page must carry to count as the paper.
 * @returns {number}
 */
export function minPaperTextChars() {
    const ret = wasm.minPaperTextChars();
    return ret;
}

/**
 * [`missing_config_message`]: names the absent required env vars, never values.
 * `cfg` is the backend config object; `required` is an array of camelCase field names.
 *
 * # Errors
 *
 * Fails if `cfg` is not an object of optional strings, `required` is not an array of
 * known field names, or the result cannot be converted to JS.
 * @param {any} cfg
 * @param {any} required
 * @returns {any}
 */
export function missingConfigMessage(cfg, required) {
    const ret = wasm.missingConfigMessage(cfg, required);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`missing_figure_warning`](export_path::missing_figure_warning).
 * @param {string} zip_path
 * @param {string} storage_path
 * @returns {string}
 */
export function missingFigureWarning(zip_path, storage_path) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(zip_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(storage_path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.missingFigureWarning(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`missing_page_plans`]: one placeholder plan per distinct, non-blank dead-link target.
 * @param {any} targets
 * @returns {any}
 */
export function missingPagePlans(targets) {
    const ret = wasm.missingPagePlans(targets);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`missing_r2_config_message`]: names the unset R2 env vars, never values.
 *
 * # Errors
 *
 * Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
 * @param {any} fields
 * @returns {any}
 */
export function missingR2ConfigMessage(fields) {
    const ret = wasm.missingR2ConfigMessage(fields);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`try_model_cache_url`](model_cache::try_model_cache_url): the cache URL a request names, or
 * `null` when it is not a weights request.
 *
 * # Errors
 *
 * Throws on a URL that does not parse, as `new URL` did in the TS.
 * @param {string} url
 * @param {string} app_host
 * @returns {string | undefined}
 */
export function modelCacheUrl(url, app_host) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(app_host, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.modelCacheUrl(ptr0, len0, ptr1, len1);
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
 * [`rules::modes_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @returns {any}
 */
export function modesFor(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.modesFor(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`move_tab`](pane::move_tab).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @param {string} from_pane_id
 * @param {number} from_index
 * @param {string} to_pane_id
 * @param {number | null} [to_index]
 * @returns {any}
 */
export function moveTab(layout, from_pane_id, from_index, to_pane_id, to_index) {
    const ptr0 = passStringToWasm0(from_pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(to_pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.moveTab(layout, ptr0, len0, from_index, ptr1, len1, isLikeNone(to_index) ? Number.MAX_SAFE_INTEGER : (to_index) >> 0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`moved_ids`]: `ids` with `id` moved one step (`-1` or `1`), or `undefined` at either end.
 * @param {any} ids
 * @param {string} id
 * @param {number} step
 * @returns {any}
 */
export function movedIds(ids, id, step) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.movedIds(ids, ptr0, len0, step);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`name_of`](panel_labels::name_of): a conflict's title, or "Untitled".
 *
 * # Errors
 *
 * Fails if `local` or `remote` is not an object (or null for `remote`).
 * @param {any} local
 * @param {any} remote
 * @returns {string}
 */
export function nameOf(local, remote) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.nameOf(local, remote);
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
 * [`needs_disclaimer_acceptance`](user_settings::needs_disclaimer_acceptance).
 *
 * # Errors
 *
 * Fails if `settings` cannot be read as JSON.
 * @param {any} settings
 * @returns {boolean}
 */
export function needsDisclaimerAcceptance(settings) {
    const ret = wasm.needsDisclaimerAcceptance(settings);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`needs_migration_hint`](org::needs_migration_hint).
 * @param {string} message
 * @returns {boolean}
 */
export function needsMigrationHint(message) {
    const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.needsMigrationHint(ptr0, len0);
    return ret !== 0;
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
 * [`new_ink_chunk_id`](ink_paths::new_ink_chunk_id). JS passes `Date.now()` as `nowMs` and a
 * 10-byte `Uint8Array` filled by `crypto.getRandomValues` as `randomBytes`.
 *
 * # Errors
 *
 * Fails when `nowMs` is not finite.
 * @param {number} now_ms
 * @param {Uint8Array} random_bytes
 * @returns {string}
 */
export function newInkChunkId(now_ms, random_bytes) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passArray8ToWasm0(random_bytes, wasm.__wbindgen_malloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.newInkChunkId(now_ms, ptr0, len0);
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
 * [`wf_core::error_report::issue_url::new_issue_url`] for JS: the address for
 * `body`, cut to fit the length limit.
 *
 * # Errors
 *
 * Fails when `title`, `body` or `repo` is over the text cap.
 * @param {string} title
 * @param {string} body
 * @param {string} repo
 * @returns {string}
 */
export function newIssueUrl(title, body, repo) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(repo, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.newIssueUrl(ptr0, len0, ptr1, len1, ptr2, len2);
        var ptr4 = ret[0];
        var len4 = ret[1];
        if (ret[3]) {
            ptr4 = 0; len4 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred5_0 = ptr4;
        deferred5_1 = len4;
        return getStringFromWasm0(ptr4, len4);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
}

/**
 * [`newest_release`]: the newest stable desktop release in `releases`, or `null`.
 *
 * # Errors
 *
 * Fails if `releases` does not match the release list shape, or the result cannot be converted
 * to JS.
 * @param {any} releases
 * @returns {any}
 */
export function newestDesktopRelease(releases) {
    const ret = wasm.newestDesktopRelease(releases);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`newest_first_order`] for JS (TS `newestFirstOrder`): indexes, latest stamp first.
 *
 * # Errors
 *
 * Fails when `publishedAt` is not an array of strings.
 * @param {any} published_at
 * @returns {any}
 */
export function newestFirstOrder(published_at) {
    const ret = wasm.newestFirstOrder(published_at);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`next_auth_step`] (TS `nextAuthStep`): the step as `{ kind, ... }`.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to a JS value.
 * @param {string | null | undefined} user_id
 * @param {string | null | undefined} previous_id
 * @param {boolean} signing_out
 * @param {boolean} was_expired
 * @param {boolean} desktop
 * @param {string | null} [local_account_id]
 * @returns {any}
 */
export function nextAuthStep(user_id, previous_id, signing_out, was_expired, desktop, local_account_id) {
    var ptr0 = isLikeNone(user_id) ? 0 : passStringToWasm0(user_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(previous_id) ? 0 : passStringToWasm0(previous_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(local_account_id) ? 0 : passStringToWasm0(local_account_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.nextAuthStep(ptr0, len0, ptr1, len1, signing_out, was_expired, desktop, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`next_page_offset`](semantic_scholar_citation::next_page_offset): the next offset, or `-1`
 * to stop. A non-number `next` is read as missing, as the TS did.
 *
 * # Errors
 *
 * Fails if `next` cannot be read as JSON.
 * @param {number} current_offset
 * @param {any} next
 * @param {number} pages_fetched
 * @returns {number}
 */
export function nextCitationPageOffset(current_offset, next, pages_fetched) {
    const ret = wasm.nextCitationPageOffset(current_offset, next, pages_fetched);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`next_manifest`](folder_mirror::next_manifest).
 * @param {string[]} previous
 * @param {string[]} written
 * @param {string[]} removed
 * @returns {string[]}
 */
export function nextManifest(previous, written, removed) {
    const ptr0 = passArrayJsValueToWasm0(previous, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(written, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passArrayJsValueToWasm0(removed, wasm.__wbindgen_malloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.nextManifest(ptr0, len0, ptr1, len1, ptr2, len2);
    var v4 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v4;
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
 * [`node_size`](graph_sizing::node_size) as `{ r, line, drop, hit }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {number} base_r
 * @param {number} zoom
 * @param {boolean} bounded
 * @returns {any}
 */
export function nodeSize(base_r, zoom, bounded) {
    const ret = wasm.nodeSize(base_r, zoom, bounded);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`normalize_field_name`](paper_field::normalize_field_name) (TS `normalizeFieldName`).
 * @param {string} raw
 * @returns {string}
 */
export function normalizeFieldName(raw) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.normalizeFieldName(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
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
 * [`normalize_highlight_rects`]: one clean band per line of a text highlight.
 *
 * # Errors
 *
 * Fails if `rects` is not an array of number arrays.
 * @param {any} rects
 * @returns {any}
 */
export function normalizeHighlightRects(rects) {
    const ret = wasm.normalizeHighlightRects(rects);
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
 * [`normalize_select_options`](paper_field::normalize_select_options) (TS `normalizeSelectOptions`).
 * @param {string[]} raw
 * @returns {string[]}
 */
export function normalizeSelectOptions(raw) {
    const ptr0 = passArrayJsValueToWasm0(raw, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.normalizeSelectOptions(ptr0, len0);
    var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
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
 * [`normalize_zotero_library`](zotero_library::normalize_zotero_library): the library path, or
 * nothing when the input is not a library.
 *
 * # Errors
 *
 * Fails if `library` is neither a string nor missing.
 * @param {any} library
 * @returns {any}
 */
export function normalizeZoteroLibrary(library) {
    const ret = wasm.normalizeZoteroLibrary(library);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`note_backlinks`](page::note_backlinks) (TS `noteBacklinks`), as `{ id, title }` objects.
 *
 * # Errors
 *
 * Fails if `notes` has the wrong shape.
 * @param {any} notes
 * @param {string | null} [selected_id]
 * @returns {any}
 */
export function noteBacklinks(notes, selected_id) {
    var ptr0 = isLikeNone(selected_id) ? 0 : passStringToWasm0(selected_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.noteBacklinks(notes, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`note_tags`](page::note_tags) (TS `noteTags`): the distinct hashtags, sorted by UTF-16 order.
 *
 * # Errors
 *
 * Fails if `notes` has the wrong shape.
 * @param {any} notes
 * @returns {string[]}
 */
export function noteTags(notes) {
    const ret = wasm.noteTags(notes);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * [`notes_tagged`](graph_tags::notes_tagged): indices of the notes matching `tags`.
 *
 * # Errors
 *
 * Fails if `notes` or `tags` has the wrong shape.
 * @param {any} notes
 * @param {any} tags
 * @returns {any}
 */
export function notesTagged(notes, tags) {
    const ret = wasm.notesTagged(notes, tags);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`notice_for`]: the text under `entry_index`, or `null` when the notice is about another entry.
 *
 * # Errors
 *
 * Fails if `notice` is neither `null` nor a `{ index, text }` object.
 * @param {any} notice
 * @param {number} entry_index
 * @returns {any}
 */
export function noticeFor(notice, entry_index) {
    const ret = wasm.noticeFor(notice, entry_index);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`one_euro_alpha`](one_euro::one_euro_alpha): the smoothing factor for a cutoff in
 * hertz and a timestep in milliseconds.
 * @param {number} cutoff
 * @param {number} dt_ms
 * @returns {number}
 */
export function oneEuroAlpha(cutoff, dt_ms) {
    const ret = wasm.oneEuroAlpha(cutoff, dt_ms);
    return ret;
}

/**
 * [`open_access_ids_of`]: `paper` carries `doi`, `arxivId`, `url` and `metadata`.
 *
 * # Errors
 *
 * Fails if `paper` does not have the expected shape.
 * @param {any} paper
 * @returns {any}
 */
export function openAccessIdsOf(paper) {
    const ret = wasm.openAccessIdsOf(paper);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`openalex_to_hit`](related_paper_hit::openalex_to_hit): the hit for an OpenAlex work, or
 * nothing when it has no title.
 *
 * # Errors
 *
 * Fails if `work` cannot be read as an OpenAlex work object.
 * @param {any} work
 * @returns {any}
 */
export function openAlexToHit(work) {
    const ret = wasm.openAlexToHit(work);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`openalex_to_metadata`] (TS `openAlexToMetadata`). An OpenAlex work as a paper.
 *
 * # Errors
 *
 * Fails if `work` is not an OpenAlex work.
 * @param {any} work
 * @returns {any}
 */
export function openAlexToMetadata(work) {
    const ret = wasm.openAlexToMetadata(work);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rules::open_mode_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @param {string} body
 * @returns {any}
 */
export function openModeFor(kind, body) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.openModeFor(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`open_tab`](pane::open_tab).
 *
 * # Errors
 *
 * Fails if `layout` or `tab` has the wrong shape.
 * @param {any} layout
 * @param {any} tab
 * @param {string} pane_id
 * @returns {any}
 */
export function openTab(layout, tab, pane_id) {
    const ptr0 = passStringToWasm0(pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.openTab(layout, tab, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`open_tab_keys`](pane::open_tab_keys).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @returns {any}
 */
export function openTabKeys(layout) {
    const ret = wasm.openTabKeys(layout);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rules::opening_tab`]. `body` absent reads as an empty body.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @param {string} id
 * @param {string | null} [body]
 * @returns {any}
 */
export function openingTab(kind, id, body) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(body) ? 0 : passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.openingTab(ptr0, len0, ptr1, len1, ptr2, len2);
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
 * [`outline_items_for`]: each page's runs as outline items.
 *
 * # Errors
 *
 * Fails if `pages` does not have the expected shape.
 * @param {any} pages
 * @returns {any}
 */
export function outlineItemsFor(pages) {
    const ret = wasm.outlineItemsFor(pages);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`outline_of`](outline::outline_of) as an array of `{ level, text, slug }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string} body
 * @param {number} max_level
 * @returns {any}
 */
export function outlineOf(body, max_level) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.outlineOf(ptr0, len0, max_level);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`outline_progress`](section_progress::outline_progress) (TS `outlineProgress`).
 *
 * # Errors
 *
 * Fails if `roots` is not a list of section tree nodes.
 * @param {any} roots
 * @returns {any}
 */
export function outlineProgress(roots) {
    const ret = wasm.outlineProgress(roots);
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
 * [`external_url`](overleaf::external_url).
 * @param {string} id
 * @returns {string}
 */
export function overleafExternalUrl(id) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.overleafExternalUrl(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`overleaf_git_url`](overleaf::overleaf_git_url).
 * @param {string} id
 * @returns {string}
 */
export function overleafGitUrl(id) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.overleafGitUrl(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`wf_core::sync::blob_links::owned_asset_folder_paths`] for JS. `bodies` is an array
 * of strings; the result is the sorted array of folder paths they point at.
 *
 * # Errors
 *
 * Fails when `bodies` is not an array of strings, or a body is over `MAX_INDEX_TEXT_UTF16`
 * UTF-16 units.
 * @param {any} bodies
 * @returns {any}
 */
export function ownedAssetFolderPaths(bodies) {
    const ret = wasm.ownedAssetFolderPaths(bodies);
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
 * [`pack_vectors`](codec::pack_vectors).
 *
 * # Errors
 *
 * Fails if the head argument is not an object with `model`, `dimensions` and `revision`.
 * @param {any} head
 * @param {Uint8Array} bytes
 * @returns {Uint8Array}
 */
export function packVectors(head, bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.packVectors(head, ptr0, len0);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    return v2;
}

/**
 * [`page_from_chunk_body`](chunk_read::page_from_chunk_body): a checked body as the page model.
 *
 * # Errors
 *
 * Fails on a body whose tables do not add up.
 * @param {Uint8Array} body
 * @returns {any}
 */
export function pageFromChunkBody(body) {
    const ptr0 = passArray8ToWasm0(body, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pageFromChunkBody(ptr0, len0);
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
 * [`page_list_problem`](pdf_pages::page_list_problem): the message, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {string} answer
 * @param {number} count
 * @returns {any}
 */
export function pageListProblem(answer, count) {
    const ptr0 = passStringToWasm0(answer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pageListProblem(ptr0, len0, count);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`page_text_after_recognition`]: the page text once handwriting has been recognised.
 * @param {string} was
 * @param {string} prior
 * @param {string} recognised
 * @returns {string}
 */
export function pageTextAfterRecognition(was, prior, recognised) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(was, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(prior, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(recognised, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.pageTextAfterRecognition(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
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
 * [`pages_to_evict`]: `rendered` and `visible` are number arrays; returns a sorted number array.
 *
 * # Errors
 *
 * Fails if `rendered` or `visible` is not an array of numbers.
 * @param {any} rendered
 * @param {any} visible
 * @param {number} radius
 * @returns {any}
 */
export function pagesToEvict(rendered, visible, radius) {
    const ret = wasm.pagesToEvict(rendered, visible, radius);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`painted_order`](quick::painted_order): the results group by group.
 *
 * # Errors
 *
 * Fails if `results` is not an array of quick-open results.
 * @param {any} results
 * @returns {any}
 */
export function paintedOrder(results) {
    const ret = wasm.paintedOrder(results);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`palette_mode_for`](palette_groups::palette_mode_for): the mode a key press opens, or `null`.
 *
 * # Errors
 *
 * Fails if `event` has the wrong shape.
 * @param {any} event
 * @returns {any}
 */
export function paletteModeFor(event) {
    const ret = wasm.paletteModeFor(event);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`paper_cite_keys`](bibtex::paper_cite_keys) (TS `buildCiteByTitle`'s key list): one key per
 * paper, in order, unique across the list.
 *
 * # Errors
 *
 * Fails if `papers` is not an array of paper objects.
 * @param {any} papers_value
 * @returns {any}
 */
export function paperCiteKeys(papers_value) {
    const ret = wasm.paperCiteKeys(papers_value);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`paper_counts_for_tags`](tag_counts::paper_counts_for_tags): one count per `tagIds` entry, in order.
 *
 * # Errors
 *
 * Fails if `tagIds` or `links` has the wrong shape.
 * @param {any} tag_ids
 * @param {any} links
 * @returns {any}
 */
export function paperCountsForTags(tag_ids, links) {
    const ret = wasm.paperCountsForTags(tag_ids, links);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_def_domain`]: a `paper_fields` row as a domain field definition.
 * @param {any} row
 * @returns {any}
 */
export function paperFieldDefRowToDomain(row) {
    const ret = wasm.paperFieldDefRowToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_value_domain`]: a `paper_field_values` row as a domain value. Throws on a bad payload.
 * @param {any} row
 * @returns {any}
 */
export function paperFieldValueRowToDomain(row) {
    const ret = wasm.paperFieldValueRowToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`PAPER_HTML_CSP`]: the frame's own content security policy.
 * @returns {string}
 */
export function paperHtmlCsp() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.paperHtmlCsp();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`paper_html_path`](folder_layout::paper_html_path).
 * @param {string} paper_id
 * @param {string} project_root
 * @returns {string}
 */
export function paperHtmlPath(paper_id, project_root) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(paper_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(project_root, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.paperHtmlPath(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`paper_image_thumbnail_path`](paper_image::paper_image_thumbnail_path) (TS `paperImageThumbnailPath`).
 * @param {string} path
 * @returns {string}
 */
export function paperImageThumbnailPath(path) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.paperImageThumbnailPath(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`paper_pdf_path`](folder_layout::paper_pdf_path).
 * @param {string} paper_id
 * @param {string} project_root
 * @returns {string}
 */
export function paperPdfPath(paper_id, project_root) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(paper_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(project_root, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.paperPdfPath(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`paper_relation_from_row`](paper_relation::paper_relation_from_row): the domain relation
 * for a stored row (a null note reads as absent).
 *
 * # Errors
 *
 * Fails if `row` has the wrong shape.
 * @param {any} row
 * @returns {any}
 */
export function paperRelationFromRow(row) {
    const ret = wasm.paperRelationFromRow(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`paper_relation_to_row`](paper_relation::paper_relation_to_row): the stored row for a
 * relation (an absent note is stored as null).
 *
 * # Errors
 *
 * Fails if `relation` has the wrong shape.
 * @param {any} relation
 * @returns {any}
 */
export function paperRelationToRow(relation) {
    const ret = wasm.paperRelationToRow(relation);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`paper_to_domain`]: a `papers` row as a domain paper.
 * @param {any} row
 * @returns {any}
 */
export function paperRowToDomain(row) {
    const ret = wasm.paperRowToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`paper_to_summary`]: a `papers` row read with the card projection, as a summary.
 * @param {any} row
 * @returns {any}
 */
export function paperRowToSummary(row) {
    const ret = wasm.paperRowToSummary(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_paper_tag`]: a `paper_tags` row as the app's paper-tag link.
 * @param {any} row
 * @returns {any}
 */
export function paperTagFromRow(row) {
    const ret = wasm.paperTagFromRow(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`paper_to_bibtex`](bibtex::paper_to_bibtex): one `.bib` entry under `key`.
 *
 * # Errors
 *
 * Fails if `paper` is not a paper object.
 * @param {any} paper
 * @param {string} key
 * @returns {string}
 */
export function paperToBibtex(paper, key) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.paperToBibtex(paper, ptr0, len0);
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
 * [`paper_to_row`]: a domain paper as the `papers` row it is written as.
 * @param {any} paper
 * @returns {any}
 */
export function paperToRow(paper) {
    const ret = wasm.paperToRow(paper);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_version`]: `0.5.2` to `[0, 5, 2]`, or `null`.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} version
 * @returns {any}
 */
export function parseAppVersion(version) {
    const ptr0 = passStringToWasm0(version, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseAppVersion(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_artifact_refs`](artifact_refs::parse_artifact_refs) (TS `parseArtifactRefs`). Offsets
 * are UTF-16 code units.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 * @param {string} markdown
 * @returns {any}
 */
export function parseArtifactRefs(markdown) {
    const ptr0 = passStringToWasm0(markdown, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseArtifactRefs(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`wf_core::papers::open_access::parse_biorxiv`]: a bioRxiv or medRxiv answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 * @param {any} body
 * @param {string} server
 * @returns {any}
 */
export function parseBiorxiv(body, server) {
    const ptr0 = passStringToWasm0(server, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseBiorxiv(body, ptr0, len0);
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
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 * @param {any} body
 * @returns {any}
 */
export function parseDoaj(body) {
    const ret = wasm.parseDoaj(body);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::papers::open_access::parse_europe_pmc`]: Europe PMC's answer as `{ candidates, pmcid }`.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 * @param {any} body
 * @returns {any}
 */
export function parseEuropePmc(body) {
    const ret = wasm.parseEuropePmc(body);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_explorer_keys`](state::parse_explorer_keys). Takes the raw stored
 * string (or `null` when absent) and returns the keys, or `null` when the
 * record is unusable.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {string | null} [raw]
 * @returns {any}
 */
export function parseExplorerKeys(raw) {
    var ptr0 = isLikeNone(raw) ? 0 : passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseExplorerKeys(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_extraction_json`](model_concepts::parse_extraction_json): the reply's `concepts` list, or `[]`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string} text
 * @returns {any}
 */
export function parseExtractionJson(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseExtractionJson(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_figure_clip`]: the figure a clipboard text names, or `null`.
 * @param {string | null} [text]
 * @returns {any}
 */
export function parseFigureClip(text) {
    var ptr0 = isLikeNone(text) ? 0 : passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseFigureClip(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_figure_crop`](figure::parse_figure_crop): a `c=` value as four insets, or `undefined`.
 *
 * # Errors
 *
 * Fails if `raw` is longer than the index text limit.
 * @param {string} raw
 * @returns {any}
 */
export function parseFigureCrop(raw) {
    const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseFigureCrop(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_figure_tokens`](figure::parse_figure_tokens): an alt's box and crop, or `undefined`.
 *
 * # Errors
 *
 * Fails if `alt` is longer than the index text limit.
 * @param {string} alt
 * @returns {any}
 */
export function parseFigureTokens(alt) {
    const ptr0 = passStringToWasm0(alt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseFigureTokens(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_folder_draft`](folder_draft::parse_folder_draft): the draft, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string} raw
 * @returns {any}
 */
export function parseFolderDraft(raw) {
    const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseFolderDraft(ptr0, len0);
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
 * [`wf_core::papers::open_access::parse_hal`]: HAL's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 * @param {any} body
 * @returns {any}
 */
export function parseHal(body) {
    const ret = wasm.parseHal(body);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_ink_chunk_path`](ink_paths::parse_ink_chunk_path): `{ noteId, chunkId }`, or `null`.
 * @param {string} path
 * @returns {any}
 */
export function parseInkChunkPath(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseInkChunkPath(ptr0, len0);
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
 * [`parse_kind_suffix`](folder_layout::parse_kind_suffix): the entity type, or `null`.
 * @param {string} path
 * @returns {any}
 */
export function parseKindSuffix(path) {
    const ptr0 = passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseKindSuffix(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_latex_section_tree`](wf_core::latex_section_tree::parse_latex_section_tree)
 * (TS `parseLatexSectionTree`). `entry_file` defaults to `main.tex`.
 *
 * # Errors
 *
 * Fails if `files` is not an array of `{ path, content }`.
 * @param {any} files
 * @param {string | null} [entry_file]
 * @returns {any}
 */
export function parseLatexSectionTree(files, entry_file) {
    var ptr0 = isLikeNone(entry_file) ? 0 : passStringToWasm0(entry_file, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseLatexSectionTree(files, ptr0, len0);
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
 * [`parse_md_image_alt`](markdown_figure_alt::parse_md_image_alt): an alt split into text, crop,
 * side and width.
 *
 * # Errors
 *
 * Fails if `raw` is longer than the index text limit.
 * @param {string} raw
 * @returns {any}
 */
export function parseMdImageAlt(raw) {
    const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseMdImageAlt(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::papers::open_access::parse_openalex`]: OpenAlex's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 * @param {any} body
 * @returns {any}
 */
export function parseOpenalex(body) {
    const ret = wasm.parseOpenalex(body);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_links`]: the well-formed links in the stored JSON.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 * @param {string} stored
 * @returns {any}
 */
export function parseOverleafLinks(stored) {
    const ptr0 = passStringToWasm0(stored, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseOverleafLinks(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_overleaf_project_id`](overleaf::parse_overleaf_project_id).
 * @param {string} raw
 * @returns {string | undefined}
 */
export function parseOverleafProjectId(raw) {
    const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseOverleafProjectId(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`parse_page_list`](pdf_pages::parse_page_list) as `{ pages, outOfRange? }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {string} answer
 * @param {number} count
 * @returns {any}
 */
export function parsePageList(answer, count) {
    const ptr0 = passStringToWasm0(answer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parsePageList(ptr0, len0, count);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_paper_field_value`] (TS `parsePaperFieldValue`). A refusal throws an `Error`
 * with the caller's `name` in the message.
 * @param {any} value
 * @param {string} name
 * @returns {any}
 */
export function parsePaperFieldValue(value, name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parsePaperFieldValue(value, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_paper_html_document`]: the paper a kept file holds, or `null` for a file this app did not write.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string} paper_id
 * @param {string} text
 * @returns {any}
 */
export function parsePaperHtmlDocument(paper_id, text) {
    const ptr0 = passStringToWasm0(paper_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.parsePaperHtmlDocument(ptr0, len0, ptr1, len1);
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
 * [`parse_bounds`]: the saved position from the preference JSON, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 * @param {string} stored
 * @returns {any}
 */
export function parsePlanWidgetBounds(stored) {
    const ptr0 = passStringToWasm0(stored, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parsePlanWidgetBounds(ptr0, len0);
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
 * [`parse_reader_split_pane`](split::parse_reader_split_pane); `null` for any value
 * other than `report` or `vault`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 * @param {string | null} [raw]
 * @returns {any}
 */
export function parseReaderSplitPane(raw) {
    var ptr0 = isLikeNone(raw) ? 0 : passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseReaderSplitPane(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_regions`](tpl::parse_regions) as `{ ok, segments }` or `{ ok: false, reason }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {string} document
 * @returns {any}
 */
export function parseRegions(document) {
    const ptr0 = passStringToWasm0(document, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseRegions(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_tag`]: `v0.5.2` to `[0, 5, 2]`, or `null` for any other tag.
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} tag
 * @returns {any}
 */
export function parseReleaseTag(tag) {
    const ptr0 = passStringToWasm0(tag, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseReleaseTag(ptr0, len0);
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
 * [`wf_core::papers::open_access::parse_semantic_scholar`]: Semantic Scholar's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 * @param {any} body
 * @returns {any}
 */
export function parseSemanticScholar(body) {
    const ret = wasm.parseSemanticScholar(body);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_stroke_clip`]: the strokes a clipboard text carries, or `null`.
 * @param {string | null} [text]
 * @returns {any}
 */
export function parseStrokeClip(text) {
    var ptr0 = isLikeNone(text) ? 0 : passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseStrokeClip(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_taskbar_created`]: the `TaskbarCreated` message id the helper printed, or `null`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 * @param {string} stdout
 * @returns {any}
 */
export function parseTaskbarCreatedId(stdout) {
    const ptr0 = passStringToWasm0(stdout, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.parseTaskbarCreatedId(ptr0, len0);
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
 * [`wf_core::papers::open_access::parse_unpaywall`]: Unpaywall's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 * @param {any} body
 * @returns {any}
 */
export function parseUnpaywall(body) {
    const ret = wasm.parseUnpaywall(body);
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
 * [`wf_core::papers::open_access::parse_zenodo`]: a Zenodo record's answer as candidates.
 *
 * # Errors
 *
 * Fails if `body` is not valid JSON, or the result cannot be converted.
 * @param {any} body
 * @returns {any}
 */
export function parseZenodo(body) {
    const ret = wasm.parseZenodo(body);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`partition_pdf_texts`](pdf_text_prune::partition_pdf_texts): which stored PDF texts survive and which to delete.
 *
 * # Errors
 *
 * Fails if `stored` is not an array of PDF sources or `paper_ids` is not an array of strings.
 * @param {any} stored
 * @param {any} paper_ids
 * @returns {any}
 */
export function partitionPdfTexts(stored, paper_ids) {
    const ret = wasm.partitionPdfTexts(stored, paper_ids);
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
 * [`pasted_figure_place`]: `figure` is a `FigurePlacement`, `on_page` the page's figures, `page` an `InkPageSize`.
 * @param {any} figure
 * @param {any} on_page
 * @param {any} page
 * @returns {any}
 */
export function pastedFigurePlace(figure, on_page, page) {
    const ret = wasm.pastedFigurePlace(figure, on_page, page);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`pasted_strokes_place`]: `strokes` are the pasted ones, `on_page` the page's, `page` an `InkPageSize`.
 * @param {any} strokes
 * @param {any} on_page
 * @param {any} page
 * @returns {any}
 */
export function pastedStrokesPlace(strokes, on_page, page) {
    const ret = wasm.pastedStrokesPlace(strokes, on_page, page);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`pdf_doc_id`](search_document::pdf_doc_id).
 * @param {string} paper_id
 * @param {number} page_index
 * @returns {string}
 */
export function pdfDocId(paper_id, page_index) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(paper_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.pdfDocId(ptr0, len0, page_index);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`pdf_doc_ids_for`](search_document::pdf_doc_ids_for).
 * @param {string} paper_id
 * @param {number} page_count
 * @returns {string[]}
 */
export function pdfDocIdsFor(paper_id, page_count) {
    const ptr0 = passStringToWasm0(paper_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.pdfDocIdsFor(ptr0, len0, page_count);
    var v2 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v2;
}

/**
 * [`pdf_page_href`](search_document::pdf_page_href).
 * @param {string} paper_id
 * @param {number} page_index
 * @returns {string}
 */
export function pdfPageHref(paper_id, page_index) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(paper_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.pdfPageHref(ptr0, len0, page_index);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
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
 * [`peers_from_states`](collab::peers_from_states); `users` is `[clientId, user][]`.
 *
 * # Errors
 *
 * Fails when `users` is not a list of pairs.
 * @param {any} users
 * @param {number} self_client_id
 * @param {string} self_author_id
 * @returns {any}
 */
export function peersFromUsers(users, self_client_id, self_author_id) {
    const ptr0 = passStringToWasm0(self_author_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.peersFromUsers(users, self_client_id, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`pending_field_fills`]: the pending `paper_field_value` proposals, optionally for one field.
 * @param {any} proposals
 * @param {string | null} [field_id]
 * @returns {any}
 */
export function pendingFieldFills(proposals, field_id) {
    var ptr0 = isLikeNone(field_id) ? 0 : passStringToWasm0(field_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.pendingFieldFills(proposals, ptr0, len0);
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
 * [`pglite_sql::pg_array`] (TS `pgArray`): the values as a Postgres array literal.
 *
 * # Errors
 *
 * Returns an error if `values` is not an array of strings.
 * @param {any} values
 * @returns {string}
 */
export function pgArray(values) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.pgArray(values);
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
 * [`pick_keeper`] (TS `pickKeeper`), returning the kept paper's id.
 *
 * # Errors
 *
 * Fails if `group` is not a list of paper summaries, or it is empty.
 * @param {any} group
 * @returns {string}
 */
export function pickKeeper(group) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.pickKeeper(group);
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
 * [`pick_keys_to_evict`]: the keys to drop, oldest first. Throws an `Error` when
 * `maxEntries` is not a positive integer.
 *
 * # Errors
 *
 * Fails if `maxEntries` is not a positive integer, or `entries` has the wrong shape.
 * @param {any} entries
 * @param {number} max_entries
 * @returns {any}
 */
export function pickKeysToEvict(entries, max_entries) {
    const ret = wasm.pickKeysToEvict(entries, max_entries);
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
 * [`pick_project`](project_pick::pick_project): the index of the picked project. A miss or an
 * ambiguous match throws the message as a string; the TS wrapper turns it into an `Error`.
 * @param {any} projects
 * @param {string | null} [needle]
 * @returns {number}
 */
export function pickProject(projects, needle) {
    var ptr0 = isLikeNone(needle) ? 0 : passStringToWasm0(needle, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.pickProject(projects, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * [`pick_project_folder`](folder_layout::pick_project_folder). `undefined` when no folder fits.
 * @param {string[]} dirs
 * @param {string} exact
 * @param {string} tail
 * @returns {string | undefined}
 */
export function pickProjectFolder(dirs, exact, tail) {
    const ptr0 = passArrayJsValueToWasm0(dirs, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(exact, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(tail, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.pickProjectFolder(ptr0, len0, ptr1, len1, ptr2, len2);
    let v4;
    if (ret[0] !== 0) {
        v4 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v4;
}

/**
 * [`picture_path`]: the stored file behind a placed picture, or `null`.
 *
 * # Errors
 *
 * Fails if `target` is not a mark's `{ type, origin, comment }` object.
 * @param {any} target
 * @returns {any}
 */
export function picturePath(target) {
    const ret = wasm.picturePath(target);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`pinned_screen_index`]: the pure half of merging pinned shared rows into a screen.
 *
 * # Errors
 *
 * Fails if `input` does not match the pinned-screen input shape, or the result cannot be
 * converted to JS.
 * @param {any} input
 * @returns {any}
 */
export function pinnedScreenIndex(input) {
    const ret = wasm.pinnedScreenIndex(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`place_on_sheet`](page_background::place_on_sheet) as `{ x, y, width, height }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {number} source_width
 * @param {number} source_height
 * @param {number} sheet_width
 * @param {number} sheet_height
 * @returns {any}
 */
export function placeOnSheet(source_width, source_height, sheet_width, sheet_height) {
    const ret = wasm.placeOnSheet(source_width, source_height, sheet_width, sheet_height);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`place_widget`]: the saved spot if it is on a screen, else the top-right of the first one.
 *
 * # Errors
 *
 * Fails if `saved` is not a position or `areas` is not a list of work areas, or the result
 * cannot be converted to JS.
 * @param {any} saved
 * @param {any} areas
 * @returns {any}
 */
export function placePlanWidget(saved, areas) {
    const ret = wasm.placePlanWidget(saved, areas);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plan_entries`](archive::plan_entries). `entries` is `{ name, size }[]` in archive order;
 * the result is `{ name, action }[]` in the same order, where `action` is `keep`,
 * `empty`, `unsafe-name` or `too-big`.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or past the entry count or the total cap.
 * @param {any} entries
 * @param {any} limits
 * @returns {any}
 */
export function planArchiveEntries(entries, limits) {
    const ret = wasm.planArchiveEntries(entries, limits);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::blob_links::plan_asset_reanchor`] for JS. `owned` and `available` are
 * arrays of folder paths; the result is `{ keep, upload, unresolved }`.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units, or `owned` or `available`
 * is not an array of strings.
 * @param {string} body
 * @param {any} owned
 * @param {any} available
 * @returns {any}
 */
export function planAssetReanchor(body, owned, available) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.planAssetReanchor(ptr0, len0, owned, available);
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
 * [`plan_bibliography_annotations`]. `papers` is an array of paper snapshots,
 * `pull` the pulled annotations keyed by Zotero item key.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 * @param {any} papers
 * @param {any} pull
 * @returns {any}
 */
export function planBibliographyAnnotations(papers, pull) {
    const ret = wasm.planBibliographyAnnotations(papers, pull);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`chip_target`](chip::chip_target): where a dependency chip goes when tapped.
 *
 * # Errors
 *
 * Fails if `dep` or `milestones` has the wrong shape, or the result cannot be serialised.
 * @param {any} dep
 * @param {any} known
 * @param {any} milestones
 * @param {boolean} is_offline_build
 * @returns {any}
 */
export function planChipTarget(dep, known, milestones, is_offline_build) {
    const ret = wasm.planChipTarget(dep, known, milestones, is_offline_build);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plan_citation_segments`]: each run split at the mention boundaries inside it.
 *
 * # Errors
 *
 * Fails if `items` or `mentions` do not have the expected shape.
 * @param {any} items
 * @param {any} mentions
 * @returns {any}
 */
export function planCitationSegments(items, mentions) {
    const ret = wasm.planCitationSegments(items, mentions);
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
 * [`plan_embedding_start`](embedding_models::plan_embedding_start) as `"reuse" | "swap" | "rebuild"`.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialized.
 * @param {string | null | undefined} stored_model
 * @param {string} target
 * @returns {any}
 */
export function planEmbeddingStart(stored_model, target) {
    var ptr0 = isLikeNone(stored_model) ? 0 : passStringToWasm0(stored_model, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(target, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.planEmbeddingStart(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plan_eyebrow`](screen::plan_eyebrow): the line above the plan title, or `undefined` for none.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {number} total
 * @param {number} done
 * @returns {any}
 */
export function planEyebrow(total, done) {
    const ret = wasm.planEyebrow(total, done);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plan_feed_origin`](feed_urls::plan_feed_origin): where the calendar feed is served.
 * @param {boolean} server_routes
 * @param {string | null} [here]
 * @param {string | null} [configured]
 * @returns {string}
 */
export function planFeedOrigin(server_routes, here, configured) {
    let deferred3_0;
    let deferred3_1;
    try {
        var ptr0 = isLikeNone(here) ? 0 : passStringToWasm0(here, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(configured) ? 0 : passStringToWasm0(configured, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.planFeedOrigin(server_routes, ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`plan_feed_urls`](feed_urls::plan_feed_urls): the calendar, https and widget links for `token`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS object.
 * @param {string} origin
 * @param {string} token
 * @param {boolean} include_done
 * @param {number} reminder_days
 * @returns {any}
 */
export function planFeedUrls(origin, token, include_done, reminder_days) {
    const ptr0 = passStringToWasm0(origin, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(token, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.planFeedUrls(ptr0, len0, ptr1, len1, include_done, reminder_days);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plan_fix_order`](wiki_lint::plan_fix_order).
 *
 * # Errors
 *
 * Fails if `report` is not a `LintReport` object.
 * @param {any} report
 * @returns {any}
 */
export function planFixOrder(report) {
    const ret = wasm.planFixOrder(report);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plan_item_order`]: the writes for a new item order, or the message that refuses it.
 * @param {string} list_id
 * @param {any} items
 * @param {string[]} ordered_ids
 * @returns {any}
 */
export function planItemOrder(list_id, items, ordered_ids) {
    const ptr0 = passStringToWasm0(list_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(ordered_ids, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.planItemOrder(ptr0, len0, items, ptr1, len1);
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
 * [`plan_pace`](timeline::plan_pace): `"on track"` or the overdue and due-soon counts.
 * @param {any} milestones
 * @param {string} today
 * @returns {string}
 */
export function planPace(milestones, today) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(today, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.planPace(milestones, ptr0, len0);
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
 * [`plan_series_ingest`](experiments::plan_series_ingest): `{ keep: indices, supersededTipStep }`.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {Float64Array} steps
 * @param {number | null} [previous_max_step]
 * @returns {any}
 */
export function planSeriesIngestIndices(steps, previous_max_step) {
    const ptr0 = passArrayF64ToWasm0(steps, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.planSeriesIngestIndices(ptr0, len0, !isLikeNone(previous_max_step), isLikeNone(previous_max_step) ? 0 : previous_max_step);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plan_timeline`](timeline::plan_timeline): the laid-out plan, or `null` when no milestone is
 * dated.
 *
 * # Errors
 *
 * Fails if `milestones` has the wrong shape.
 * @param {any} milestones
 * @param {string} today
 * @returns {any}
 */
export function planTimeline(milestones, today) {
    const ptr0 = passStringToWasm0(today, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.planTimeline(milestones, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plan_widget`](feed::plan_widget): the summary a widget draws.
 *
 * # Errors
 *
 * Fails if `items` has the wrong shape.
 * @param {any} items
 * @param {boolean} include_done
 * @param {number | null | undefined} limit
 * @param {number} now_ms
 * @returns {any}
 */
export function planWidgetData(items, include_done, limit, now_ms) {
    const ret = wasm.planWidgetData(items, include_done, isLikeNone(limit) ? Number.MAX_SAFE_INTEGER : (limit) >>> 0, now_ms);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plan_wiki_pages`](wiki_plan::plan_wiki_pages) for a `PlanWikiPagesInput` object; returns the plans.
 *
 * # Errors
 *
 * Fails if `input` has the wrong shape, or the plans cannot be converted.
 * @param {any} input
 * @returns {any}
 */
export function planWikiPages(input) {
    const ret = wasm.planWikiPages(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`plot_height`](plot_size::plot_height).
 * @param {number} width
 * @param {number} base
 * @returns {number}
 */
export function plotHeight(width, base) {
    const ret = wasm.plotHeight(width, base);
    return ret;
}

/**
 * [`plot_tier`](plot_size::plot_tier): `"full"`, `"medium"` or `"compact"`.
 * @param {number} width
 * @returns {string}
 */
export function plotTier(width) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.plotTier(width);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`plural`](panel_labels::plural): "n word" with the right plural.
 * @param {number} n
 * @param {string} word
 * @param {string | null} [many]
 * @returns {string}
 */
export function plural(n, word, many) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(word, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(many) ? 0 : passStringToWasm0(many, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.plural(n, ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`wf_core::papers::open_access::pmc_candidates`]: PubMed Central's PDF and HTML copies.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string} pmcid
 * @param {string | null} [license]
 * @returns {any}
 */
export function pmcCandidates(pmcid, license) {
    const ptr0 = passStringToWasm0(pmcid, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(license) ? 0 : passStringToWasm0(license, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.pmcCandidates(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`point_in_area`](clip::point_in_area).
 * @param {any} area
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
export function pointInArea(area, x, y) {
    const ret = wasm.pointInArea(area, x, y);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
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
 * [`error_info`] for JS (TS `postgrestErrorInfo`): `{ code, firstLine }` of an error body.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {string} body
 * @returns {any}
 */
export function postgrestErrorInfo(body) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.postgrestErrorInfo(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`keyed_column_spec`]: the keyed-column spec named `name`, or `null` when there is none.
 * @param {string} name
 * @returns {any}
 */
export function postgrestKeyedColumnSpec(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.postgrestKeyedColumnSpec(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`row_spec`]: the row spec named `name`, or `null` when there is none.
 * @param {string} name
 * @returns {any}
 */
export function postgrestRowSpec(name) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.postgrestRowSpec(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`writable`] for JS (TS `postgrestWritable`): the payload minus the table's generated columns.
 *
 * # Errors
 *
 * Fails when `payload` is not an object.
 * @param {string} table
 * @param {any} payload
 * @returns {any}
 */
export function postgrestWritable(table, payload) {
    const ptr0 = passStringToWasm0(table, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.postgrestWritable(ptr0, len0, payload);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::papers::open_access::parse_doaj`]: DOAJ's answer as candidates.
 *
 * # Errors
 *
 * [`wf_core::papers::open_access::preprint_server_for`]: the preprint server for a DOI, or `None`.
 * @param {string} doi
 * @returns {string | undefined}
 */
export function preprintServerFor(doi) {
    const ptr0 = passStringToWasm0(doi, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.preprintServerFor(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`wf_core::ink::pressure_byte`].
 * @param {number | null} [pressure]
 * @returns {number}
 */
export function pressureByte(pressure) {
    const ret = wasm.pressureByte(!isLikeNone(pressure), isLikeNone(pressure) ? 0 : pressure);
    return ret;
}

/**
 * [`preview_open`](pane::preview_open).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @returns {boolean}
 */
export function previewOpen(layout) {
    const ret = wasm.previewOpen(layout);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`preview_reader_href`](paper_preview::preview_reader_href) (TS `previewReaderHref`).
 *
 * # Errors
 *
 * Fails if `preview` is not a preview object, or the result cannot be converted.
 * @param {string | null | undefined} remote_href
 * @param {any} preview
 * @param {string} local_href
 * @returns {any}
 */
export function previewReaderHref(remote_href, preview, local_href) {
    var ptr0 = isLikeNone(remote_href) ? 0 : passStringToWasm0(remote_href, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(local_href, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.previewReaderHref(ptr0, len0, preview, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`preview_source`](pane::preview_source). `previous` may be `undefined`.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 * @param {any} layout
 * @param {any} previous
 * @returns {any}
 */
export function previewSource(layout, previous) {
    const ret = wasm.previewSource(layout, previous);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`preview_tab`](pane::preview_tab).
 *
 * # Errors
 *
 * Never fails in practice; returns the serializer's result type.
 * @returns {any}
 */
export function previewTab() {
    const ret = wasm.previewTab();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`primary_paper_ref`]: the arXiv id, else the DOI, else `null`. Blank strings count as unset.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 * @param {string | null} [arxiv_id]
 * @param {string | null} [doi]
 * @returns {any}
 */
export function primaryPaperRef(arxiv_id, doi) {
    var ptr0 = isLikeNone(arxiv_id) ? 0 : passStringToWasm0(arxiv_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(doi) ? 0 : passStringToWasm0(doi, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.primaryPaperRef(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`to_project`]: a `projects` row as the app's project.
 * @param {any} row
 * @returns {any}
 */
export function projectFromRow(row) {
    const ret = wasm.projectFromRow(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`project_gate_open`].
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 * @param {any} config
 * @param {any} gate
 * @returns {any}
 */
export function projectGateOpen(config, gate) {
    const ret = wasm.projectGateOpen(config, gate);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`project_search_documents`](projection::project_search_documents). `graph` is a wiki graph or
 * `null`; `pdfTexts` is the extracted PDF text array.
 *
 * # Errors
 *
 * Fails if an argument or a reader annotation does not match the expected shape.
 * @param {any} snapshot
 * @param {any} graph
 * @param {any} pdf_texts
 * @returns {any}
 */
export function projectSearchDocuments(snapshot, graph, pdf_texts) {
    const ret = wasm.projectSearchDocuments(snapshot, graph, pdf_texts);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`project_stored_pdf_texts`](projection::project_stored_pdf_texts): the worker's build.
 *
 * # Errors
 *
 * Fails if an argument or a reader annotation does not match the expected shape.
 * @param {any} snapshot
 * @param {any} stored
 * @returns {any}
 */
export function projectStoredPdfTexts(snapshot, stored) {
    const ret = wasm.projectStoredPdfTexts(snapshot, stored);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`project_zotero_annotations`](zotero_projection::project_zotero_annotations).
 *
 * # Errors
 *
 * Fails when `annotations` is not a list of cached Zotero annotations.
 * @param {any} annotations
 * @param {string | null} [content_hash]
 * @param {string | null} [now]
 * @returns {any}
 */
export function projectZoteroAnnotations(annotations, content_hash, now) {
    var ptr0 = isLikeNone(content_hash) ? 0 : passStringToWasm0(content_hash, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(now) ? 0 : passStringToWasm0(now, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.projectZoteroAnnotations(annotations, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`pglite_sql::projection`] (TS `projection`): a `select` column list.
 *
 * # Errors
 *
 * Returns an error for a column name [`pglite_sql::ident`] refuses.
 * @param {string} columns
 * @returns {string}
 */
export function projection(columns) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(columns, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.projection(ptr0, len0);
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
 * [`proposal_applies`](proposal_apply::proposal_applies). `null` or `undefined` for the stored
 * revision means the row is missing.
 * @param {string | null} [stored_updated_at]
 * @param {string | null} [expected_revision]
 * @returns {boolean}
 */
export function proposalApplies(stored_updated_at, expected_revision) {
    var ptr0 = isLikeNone(stored_updated_at) ? 0 : passStringToWasm0(stored_updated_at, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(expected_revision) ? 0 : passStringToWasm0(expected_revision, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.proposalApplies(ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * [`prune_layout`](pane::prune_layout). `open_keys` is an array of tab keys.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 * @param {any} layout
 * @param {any} open_keys
 * @returns {any}
 */
export function pruneLayout(layout, open_keys) {
    const ret = wasm.pruneLayout(layout, open_keys);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`push_figure_step`]: `before` and `after` are the page's figure arrays;
 * `key` is the press number, or `null` when the edit is not from a press.
 * @param {any} history
 * @param {any} before
 * @param {any} after
 * @param {any} key
 * @returns {any}
 */
export function pushFigureStep(history, before, after, key) {
    const ret = wasm.pushFigureStep(history, before, after, key);
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
 * [`quick_open_results`](quick::quick_open_results) as an array of `{ node, score, matched }`.
 *
 * # Errors
 *
 * Fails if `documents` is not an array of tree rows.
 * @param {any} documents
 * @param {string} query
 * @returns {any}
 */
export function quickOpenResults(documents, query) {
    const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.quickOpenResults(documents, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`quote_awkward_labels`](markdown_mermaid_labels::quote_awkward_labels): quote labels Mermaid cannot parse.
 * @param {string} code
 * @returns {string}
 */
export function quoteAwkwardMermaidLabels(code) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(code, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.quoteAwkwardMermaidLabels(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`quote_ident`] (TS `quoteIdent`): the name in double quotes, embedded quotes doubled.
 * @param {string} name
 * @returns {string}
 */
export function quoteIdent(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.quoteIdent(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`r2_blob_client_config`]. `null` when any R2 field is unset or empty.
 *
 * # Errors
 *
 * Fails if `fields` is not an object of optional strings, or the result cannot be converted to JS.
 * @param {any} fields
 * @returns {any}
 */
export function r2BlobClientConfig(fields) {
    const ret = wasm.r2BlobClientConfig(fields);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rail_group_text`](rail_group_text::rail_group_text). `group` is a `RailGroupWords`,
 * `visible` and `integrationTitles` are string arrays.
 *
 * # Errors
 *
 * Fails if an input cannot be read as the expected shape.
 * @param {any} group
 * @param {any} visible
 * @param {any} integration_titles
 * @returns {any}
 */
export function railGroupText(group, visible, integration_titles) {
    const ret = wasm.railGroupText(group, visible, integration_titles);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`ramp_colour`](node_colouring::ramp_colour): a colour `t` of the way along the ramp.
 * @param {number} t
 * @returns {string}
 */
export function rampColour(t) {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.rampColour(t);
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`rank_filter_order`](rank_filter::rank_filter_order) as an array of indices
 * into `items`.
 *
 * # Errors
 *
 * Fails if `hit_entity_ids` is not an array of strings or `items` is not an
 * array of `{id, fallbackText}` records.
 * @param {string} query
 * @param {any} hit_entity_ids
 * @param {any} items
 * @returns {any}
 */
export function rankFilterOrder(query, hit_entity_ids, items) {
    const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rankFilterOrder(ptr0, len0, hit_entity_ids, items);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::papers::open_access::rank_open_access_candidates`]: deduplicated, PDFs first.
 *
 * # Errors
 *
 * Fails if `candidates` is not a candidate list, or the result cannot be converted.
 * @param {any} candidates
 * @returns {any}
 */
export function rankOpenAccessCandidates(candidates) {
    const ret = wasm.rankOpenAccessCandidates(candidates);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`read_failure_reason`]: why a read failed. `status` is the HTTP status when there was a response.
 * @param {string} message
 * @param {number | null} [status]
 * @returns {string}
 */
export function readFailureReason(message, status) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(message, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.readFailureReason(ptr0, len0, isLikeNone(status) ? 0xFFFFFF : status);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
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
 * [`read_ink_chunk_header`](chunk::read_ink_chunk_header): the 16-byte header.
 *
 * # Errors
 *
 * Fails on a header the format refuses.
 * @param {Uint8Array} bytes
 * @returns {any}
 */
export function readInkChunkHeader(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.readInkChunkHeader(ptr0, len0);
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
 * [`read_ink_note_meta`](wf_core::sync::ink_note::read_ink_note_meta) of a frontmatter
 * object (TS `readInkNoteMeta`).
 *
 * # Errors
 *
 * Fails if `frontmatter` is not a plain object.
 * @param {any} frontmatter
 * @returns {any}
 */
export function readInkNoteMeta(frontmatter) {
    const ret = wasm.readInkNoteMeta(frontmatter);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`read_ink_request`]: the page's request checked whole, or `null` when it is malformed.
 * Never throws, as the TS did not: input that is not convertible to JSON is `null` too.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JS value.
 * @param {any} request
 * @returns {any}
 */
export function readInkRequest(request) {
    const ret = wasm.readInkRequest(request);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`read_storage_config`]. `env` is a plain object of env name to string value.
 *
 * # Errors
 *
 * Fails if `env` is not an object of strings, or the result cannot be converted to JS.
 * @param {any} env
 * @returns {any}
 */
export function readStorageConfig(env) {
    const ret = wasm.readStorageConfig(env);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::sync::ink_note::readable_text`] for JS: a note's words, ink pages joined.
 *
 * # Errors
 *
 * Fails when `body` is over `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} body
 * @returns {string}
 */
export function readableText(body) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.readableText(ptr0, len0);
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
 * [`reader_print_document`]: the paper as an HTML document for a print frame's `srcdoc`.
 * @param {any} doc
 * @returns {string}
 */
export function readerPrintDocument(doc) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.readerPrintDocument(doc);
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
 * [`reader_print_orientation`]: `"portrait"` or `"landscape"` for the sheet.
 * @param {any} input
 * @returns {string}
 */
export function readerPrintOrientation(input) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.readerPrintOrientation(input);
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
 * [`to_item_domain`]: a `reading_list_items` row as a domain item.
 * @param {any} row
 * @returns {any}
 */
export function readingListItemToDomain(row) {
    const ret = wasm.readingListItemToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_item_row`]: a domain item as a `reading_list_items` row.
 * @param {any} item
 * @returns {any}
 */
export function readingListItemToRow(item) {
    const ret = wasm.readingListItemToRow(item);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_list_domain`]: a `reading_lists` row as a domain list.
 * @param {any} row
 * @returns {any}
 */
export function readingListToDomain(row) {
    const ret = wasm.readingListToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_list_row`]: a domain list as a `reading_lists` row.
 * @param {any} list
 * @returns {any}
 */
export function readingListToRow(list) {
    const ret = wasm.readingListToRow(list);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`recently_approved_wiki_pages`]: the wiki's pages, newest first, capped at `limit`.
 * @param {any} pages
 * @param {number} limit
 * @returns {any}
 */
export function recentlyApprovedWikiPages(pages, limit) {
    const ret = wasm.recentlyApprovedWikiPages(pages, limit);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`recolour_nodes`](graph_colour::recolour_nodes): one colour per node in order, or
 * `null` when the mode leaves node colours as built.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 * @param {any} nodes
 * @param {any} links
 * @param {string} color_by
 * @param {any} groups
 * @param {any} ctx
 * @returns {any}
 */
export function recolourNodes(nodes, links, color_by, groups, ctx) {
    const ptr0 = passStringToWasm0(color_by, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.recolourNodes(nodes, links, ptr0, len0, groups, ctx);
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
 * [`redact_error_text`](error_redact::redact_error_text): the token and URL credentials removed,
 * capped at 500 UTF-16 units. An empty or missing token is ignored.
 * @param {string} raw
 * @param {string | null} [token]
 * @returns {string}
 */
export function redactOverleafErrorText(raw, token) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(token) ? 0 : passStringToWasm0(token, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.redactOverleafErrorText(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`wf_core::error_report::redact::redact`] for JS, as `{ text, redactions }`.
 *
 * # Errors
 *
 * Fails when `input` is over the text cap.
 * @param {string} input
 * @returns {any}
 */
export function redactReport(input) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.redactReport(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wf_core::error_report::redact::redact_and_cap`] for JS, as `{ text, redactions }`.
 * `limit` is in UTF-16 units.
 *
 * # Errors
 *
 * Fails when `input` is over the text cap.
 * @param {string} input
 * @param {number} limit
 * @returns {any}
 */
export function redactReportAndCap(input, limit) {
    const ptr0 = passStringToWasm0(input, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.redactReportAndCap(ptr0, len0, limit);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`related_concepts`](graph_tags::related_concepts): the top `limit` tags seen beside `name`.
 *
 * # Errors
 *
 * Fails if `papers` or `notes` has the wrong shape.
 * @param {string} name
 * @param {any} papers
 * @param {any} notes
 * @param {number} limit
 * @returns {any}
 */
export function relatedConcepts(name, papers, notes, limit) {
    const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.relatedConcepts(ptr0, len0, papers, notes, limit);
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
 * [`remove_hashtag_from_body`](note_tags::remove_hashtag_from_body).
 * @param {string} body
 * @param {string} tag
 * @returns {string}
 */
export function removeHashtagFromBody(body, tag) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(tag, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.removeHashtagFromBody(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
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
 * [`rename_sources`](folder_diff::rename_sources) over the parsed entities and the
 * folder and current texts by path. Returns new path to old path.
 *
 * # Errors
 *
 * Fails if the inputs do not match the shape, or the result cannot be serialized.
 * @param {any} parsed
 * @param {any} folder
 * @param {any} current
 * @returns {any}
 */
export function renameSources(parsed, folder, current) {
    const ret = wasm.renameSources(parsed, folder, current);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`renamed_paths`](outside_edits::renamed_paths) over `seen` and the diff's `paths`.
 *
 * # Errors
 *
 * Fails if the inputs do not match the shape, or the result cannot be serialized.
 * @param {any} seen
 * @param {any} paths
 * @returns {any}
 */
export function renamedOutsidePaths(seen, paths) {
    const ret = wasm.renamedOutsidePaths(seen, paths);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`render_template`](tpl::render_template).
 *
 * # Errors
 *
 * Fails if the context is not a plain object.
 * @param {string} template
 * @param {any} context_value
 * @returns {string}
 */
export function renderTemplate(template, context_value) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(template, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.renderTemplate(ptr0, len0, context_value);
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
 * [`reorder_figure_indices`](figure::reorder_figure_indices): the new order as old indices.
 *
 * # Errors
 *
 * Fails if `step` is not a known step.
 * @param {number} len
 * @param {number} index
 * @param {any} step
 * @returns {Uint32Array}
 */
export function reorderFigureIndices(len, index, step) {
    const ret = wasm.reorderFigureIndices(len, index, step);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayU32FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * [`reordered_ids`]: `ids` with `dragId` moved into `targetId`'s place, or `undefined`.
 * @param {any} ids
 * @param {string} drag_id
 * @param {string} target_id
 * @returns {any}
 */
export function reorderedIds(ids, drag_id, target_id) {
    const ptr0 = passStringToWasm0(drag_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(target_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.reorderedIds(ids, ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`replace_vault_asset_paths`](page::replace_vault_asset_paths): `old_paths[i]` becomes `new_paths[i]`.
 * @param {string} body
 * @param {string[]} old_paths
 * @param {string[]} new_paths
 * @returns {string}
 */
export function replaceVaultAssetPaths(body, old_paths, new_paths) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passArrayJsValueToWasm0(old_paths, wasm.__wbindgen_malloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passArrayJsValueToWasm0(new_paths, wasm.__wbindgen_malloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.replaceVaultAssetPaths(ptr0, len0, ptr1, len1, ptr2, len2);
        deferred4_0 = ret[0];
        deferred4_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred4_0, deferred4_1, 1);
    }
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
 * [`repo_web_url`](repo_web_url::repo_web_url): the trimmed repo URL when it is
 * http(s), otherwise `undefined`.
 * @param {string | null} [repo_url]
 * @returns {string | undefined}
 */
export function repoWebUrl(repo_url) {
    var ptr0 = isLikeNone(repo_url) ? 0 : passStringToWasm0(repo_url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.repoWebUrl(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`wf_core::error_report::issue_url::report_markdown`] for JS.
 *
 * # Errors
 *
 * Fails when `input` is not a valid `ReportMarkdown` object, or its text is over the cap.
 * @param {any} input
 * @returns {string}
 */
export function reportMarkdown(input) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.reportMarkdown(input);
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
 * [`resize_figure_box`](figure::resize_figure_box): a box resized by dragging `handle`.
 *
 * # Errors
 *
 * Fails if `rect` or `handle` has the wrong shape.
 * @param {any} rect
 * @param {any} handle
 * @param {number} dx
 * @param {number} dy
 * @param {boolean} free
 * @param {number} min_side
 * @returns {any}
 */
export function resizeFigureBox(rect, handle, dx, dy, free, min_side) {
    const ret = wasm.resizeFigureBox(rect, handle, dx, dy, free, min_side);
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
 * [`resolve_artifact_refs_markdown`](artifact_markdown::resolve_artifact_refs_markdown)
 * (TS `resolveArtifactRefsMarkdown`). `now_ms` is `Date.now()`.
 *
 * # Errors
 *
 * Fails if `experiments` is not a list of experiment objects.
 * @param {string} body
 * @param {any} experiments
 * @param {number} now_ms
 * @returns {string}
 */
export function resolveArtifactRefsMarkdown(body, experiments, now_ms) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.resolveArtifactRefsMarkdown(ptr0, len0, experiments, now_ms);
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
 * [`wf_core::papers::open_access::resolve_arxiv_id`]: the arXiv id to ask about.
 * @param {string | null} [arxiv_id]
 * @param {string | null} [doi]
 * @returns {string | undefined}
 */
export function resolveArxivId(arxiv_id, doi) {
    var ptr0 = isLikeNone(arxiv_id) ? 0 : passStringToWasm0(arxiv_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(doi) ? 0 : passStringToWasm0(doi, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.resolveArxivId(ptr0, len0, ptr1, len1);
    let v3;
    if (ret[0] !== 0) {
        v3 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
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
 * [`resolve_ink_page_order`](ink_page::resolve_ink_page_order): the reconciled page order.
 *
 * # Errors
 *
 * Fails if either list is not an array of strings.
 * @param {any} declared
 * @param {any} present
 * @returns {any}
 */
export function resolveInkPageOrder(declared, present) {
    const ret = wasm.resolveInkPageOrder(declared, present);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`resolve_integration_config`]. `env` is the five `NEXT_PUBLIC_*` provider values, `ids`
 * the registered ids per kind.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 * @param {any} env
 * @param {any} ids
 * @returns {any}
 */
export function resolveIntegrationConfig(env, ids) {
    const ret = wasm.resolveIntegrationConfig(env, ids);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`resolve_paper_pdf_url`]: `source` is `{ url, arxivId, openAccessPdf }`, each optional.
 * Unknown fields such as `pdfPath` are ignored, as the TS version ignores them.
 *
 * # Errors
 *
 * Fails if `source` is not an object of strings or `null`.
 * @param {any} source
 * @returns {string | undefined}
 */
export function resolvePaperPdfUrl(source) {
    const ret = wasm.resolvePaperPdfUrl(source);
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
 * [`resolve_related_paper_url`](related_paper_url::resolve_related_paper_url) (TS
 * `resolveRelatedPaperUrl`). `None` becomes `undefined`.
 * @param {string | null} [url]
 * @param {string | null} [doi]
 * @param {string | null} [arxiv_id]
 * @returns {string | undefined}
 */
export function resolveRelatedPaperUrl(url, doi, arxiv_id) {
    var ptr0 = isLikeNone(url) ? 0 : passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(doi) ? 0 : passStringToWasm0(doi, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(arxiv_id) ? 0 : passStringToWasm0(arxiv_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.resolveRelatedPaperUrl(ptr0, len0, ptr1, len1, ptr2, len2);
    let v4;
    if (ret[0] !== 0) {
        v4 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v4;
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
 * [`resolve_with_row`] for JS (TS `resolveWithRow`). `picks` maps a field to `"local"` or
 * `"remote"`; `overrides` is a row or `null`.
 *
 * # Errors
 *
 * Fails when a row or `picks` is not a plain object, or a pick is not `"local"`/`"remote"`.
 * @param {any} base
 * @param {any} local
 * @param {any} remote
 * @param {any} picks
 * @param {any} overrides
 * @returns {any}
 */
export function resolveWithRow(base, local, remote, picks, overrides) {
    const ret = wasm.resolveWithRow(base, local, remote, picks, overrides);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * Every mapped resource type, in table order.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialized.
 * @returns {any}
 */
export function resourceTypes() {
    const ret = wasm.resourceTypes();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`results_table`](experiment_status::results_table): the header and rows of the runs table.
 *
 * # Errors
 *
 * Fails if `experiments` is not an array of run objects, or the result cannot be serialised.
 * @param {any} experiments
 * @returns {any}
 */
export function resultsTable(experiments) {
    const ret = wasm.resultsTable(experiments);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`retrieve_ai_excerpts`](retrieval::retrieve_ai_excerpts). `options` is an object; `{}` takes the defaults.
 *
 * # Errors
 *
 * Fails if `documents` or `options` has the wrong shape.
 * @param {any} documents
 * @param {string} query
 * @param {any} options
 * @returns {any}
 */
export function retrieveAiExcerpts(documents, query, options) {
    const ptr0 = passStringToWasm0(query, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.retrieveAiExcerpts(documents, ptr0, len0, options);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`verdict_for`](screening::verdict_for) (TS `verdictFor`).
 *
 * # Errors
 *
 * Fails if `decisions` has the wrong shape.
 * @param {any} decisions
 * @returns {string[]}
 */
export function reviewers(decisions) {
    const ret = wasm.reviewers(decisions);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    var v1 = getArrayJsValueFromWasm0(ret[0], ret[1]);
    wasm.__wbindgen_free(ret[0], ret[1] * 4, 4);
    return v1;
}

/**
 * [`rewrite_mcp_config`](mcp_config_rewrite::rewrite_mcp_config) as `{ changed, config }`.
 *
 * # Errors
 *
 * Fails when `launch` is not an object with `command`, `args` and `env`.
 * @param {any} config
 * @param {string} key
 * @param {any} launch
 * @returns {any}
 */
export function rewriteMcpConfig(config, key, launch) {
    const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rewriteMcpConfig(config, ptr0, len0, launch);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rewrite_wikilinks`](import_links::rewrite_wikilinks). `renames` is a plain JS object mapping a
 * normalised old title to its new title.
 *
 * # Errors
 *
 * Fails if `renames` is not an object of string values.
 * @param {string} body
 * @param {any} renames
 * @returns {string}
 */
export function rewriteWikilinks(body, renames) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.rewriteWikilinks(ptr0, len0, renames);
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
 * [`role_rank`](member::role_rank). `undefined` for a role the rank table does not know.
 * @param {string} role
 * @returns {number | undefined}
 */
export function roleRank(role) {
    const ptr0 = passStringToWasm0(role, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.roleRank(ptr0, len0);
    return ret === 0xFFFFFF ? undefined : ret;
}

/**
 * [`root_folder_id_of`](upload::root_folder_id_of): the writable project's root folder id, or
 * `undefined` when read-only or the answer has none.
 * @param {any} join
 * @returns {string | undefined}
 */
export function rootFolderIdOf(join) {
    const ret = wasm.rootFolderIdOf(join);
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
 * [`root_key`](edit::root_key).
 *
 * # Errors
 *
 * Fails if the argument is not an editable root, or the result cannot be serialised.
 * @param {any} root
 * @returns {any}
 */
export function rootKey(root) {
    const ret = wasm.rootKey(root);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`root_of`](edit::root_of).
 *
 * # Errors
 *
 * Fails if the node does not have the expected shape, or the result cannot be serialised.
 * @param {any} node
 * @returns {any}
 */
export function rootOf(node) {
    const ret = wasm.rootOf(node);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`root_of_kind`](edit::root_of_kind). `kind` is a snake_case tree kind name.
 *
 * # Errors
 *
 * Fails if the result cannot be serialised.
 * @param {string} kind
 * @returns {any}
 */
export function rootOfKind(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.rootOfKind(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`row_slots`](window::row_slots). `viewport` is `null` before measuring,
 * `pinned` is an array of row indices, `metrics` the TS row constants.
 *
 * # Errors
 *
 * Fails if an argument does not have the expected shape, or the result cannot be serialised.
 * @param {number} count
 * @param {any} viewport
 * @param {any} pinned
 * @param {any} metrics
 * @returns {any}
 */
export function rowSlots(count, viewport, pinned, metrics) {
    const ret = wasm.rowSlots(count, viewport, pinned, metrics);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`rows_for_height`](fit::rows_for_height): grid rows that show `px` of card.
 * @param {number} px
 * @param {number} row_height
 * @param {number} margin
 * @returns {number}
 */
export function rowsForHeight(px, row_height, margin) {
    const ret = wasm.rowsForHeight(px, row_height, margin);
    return ret;
}

/**
 * [`s2_nested_fields`](related_paper_hit::s2_nested_fields): the S2 field list for a nested paper.
 * @param {string} key
 * @returns {string}
 */
export function s2NestedFields(key) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.s2NestedFields(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`s2_paper_id`](semantic_scholar_citation::s2_paper_id): the Semantic Scholar id for a reference.
 *
 * # Errors
 *
 * Fails if `reference` has the wrong shape.
 * @param {any} reference
 * @returns {string}
 */
export function s2PaperId(reference) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.s2PaperId(reference);
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
 * [`s2_to_hit`](related_paper_hit::s2_to_hit): the hit for a Semantic Scholar paper, or nothing
 * when it has no title.
 *
 * # Errors
 *
 * Fails if `paper` cannot be read as a Semantic Scholar paper object.
 * @param {any} paper
 * @returns {any}
 */
export function s2ToHit(paper) {
    const ret = wasm.s2ToHit(paper);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`safe_artifact_caption`](artifact_markdown::safe_artifact_caption) (TS `safeArtifactCaption`).
 * `undefined` or `null` counts as no caption.
 * @param {string | null} [alt]
 * @returns {string}
 */
export function safeArtifactCaption(alt) {
    let deferred2_0;
    let deferred2_1;
    try {
        var ptr0 = isLikeNone(alt) ? 0 : passStringToWasm0(alt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.safeArtifactCaption(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`safe_image_destination`](artifact_markdown::safe_image_destination) (TS `safeImageDestination`).
 * `undefined` when the URL is not allowed.
 * @param {string} url
 * @returns {string | undefined}
 */
export function safeImageDestination(url) {
    const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.safeImageDestination(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
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
 * [`safe_name`](experiment_artifacts::safe_name).
 * @param {string} name
 * @returns {string}
 */
export function safeName(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.safeName(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`safe_relative`]: the normalised path inside the build directory.
 *
 * # Errors
 *
 * Throws an `Error` with the refusal message when the path leaves the build directory or names a
 * latexmk rc file.
 * @param {string} candidate
 * @returns {string}
 */
export function safeRelative(candidate) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(candidate, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.safeRelative(ptr0, len0);
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
 * [`same_peers`](collab::same_peers).
 *
 * # Errors
 *
 * Fails when either list is not a list of peers.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export function samePeers(a, b) {
    const ret = wasm.samePeers(a, b);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
}

/**
 * [`same_row`] for JS (TS `sameRow`).
 *
 * # Errors
 *
 * Fails when a row is not a plain object.
 * @param {any} a
 * @param {any} b
 * @returns {boolean}
 */
export function sameRow(a, b) {
    const ret = wasm.sameRow(a, b);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] !== 0;
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
 * [`sanitize_app_href`]: a same-origin app path on a known root, or `None`.
 * @param {string | null} [raw]
 * @returns {string | undefined}
 */
export function sanitizeAppHref(raw) {
    var ptr0 = isLikeNone(raw) ? 0 : passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.sanitizeAppHref(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`sanitize_pdf_url`]: `None` (`undefined` in JS) when the URL is refused.
 * @param {string | null} [raw]
 * @returns {string | undefined}
 */
export function sanitizePdfUrl(raw) {
    var ptr0 = isLikeNone(raw) ? 0 : passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.sanitizePdfUrl(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`sanitize_reader_href`]: a same-origin `/reader` path, or `None`.
 * @param {string | null} [raw]
 * @returns {string | undefined}
 */
export function sanitizeReaderHref(raw) {
    var ptr0 = isLikeNone(raw) ? 0 : passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.sanitizeReaderHref(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`sanitize_section_targets`](overleaf::sanitize_section_targets); `null` when malformed.
 *
 * # Errors
 *
 * Fails if `input` cannot be read as JSON.
 * @param {any} input
 * @returns {any}
 */
export function sanitizeSectionTargets(input) {
    const ret = wasm.sanitizeSectionTargets(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`scope_notes`](page::scope_notes) (TS `scopeNotes`): the indices of the notes that pass the
 * list and tag filters. `membership` is an object of list id to an array of note ids.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 * @param {any} notes
 * @param {string[]} list_filter
 * @param {string[]} tag_filter
 * @param {any} membership
 * @returns {any}
 */
export function scopeNoteIndices(notes, list_filter, tag_filter, membership) {
    const ptr0 = passArrayJsValueToWasm0(list_filter, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passArrayJsValueToWasm0(tag_filter, wasm.__wbindgen_malloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.scopeNoteIndices(notes, ptr0, len0, ptr1, len1, membership);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`screen_for_path::screen_for_path`]: the screen cache id for a pathname, or `undefined`.
 * @param {string} pathname
 * @returns {string | undefined}
 */
export function screenForPath(pathname) {
    const ptr0 = passStringToWasm0(pathname, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.screenForPath(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
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
 * [`decision_from_row`](screening::decision_from_row) (TS `PostgrestScreeningRepository`
 * `toDomain`): a stored `screening_decisions` row as a decision.
 *
 * # Errors
 *
 * Fails if `row` has the wrong shape, or its stage or state is not one the enums know.
 * @param {any} row
 * @returns {any}
 */
export function screeningDecisionFromRow(row) {
    const ret = wasm.screeningDecisionFromRow(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`decision_to_row`](screening::decision_to_row) (TS `PostgrestScreeningRepository`
 * `record`): a decision as the `screening_decisions` row the table takes.
 *
 * # Errors
 *
 * Fails if `decision` has the wrong shape.
 * @param {any} decision
 * @returns {any}
 */
export function screeningDecisionToRow(decision) {
    const ret = wasm.screeningDecisionToRow(decision);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`search_revision`](search_document::search_revision).
 *
 * # Errors
 *
 * Fails if `docs` is not an array of search documents.
 * @param {any} docs
 * @returns {string}
 */
export function searchRevision(docs) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.searchRevision(docs);
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
 * [`section_progress`](section_progress::section_progress) (TS `sectionProgress`).
 *
 * # Errors
 *
 * Fails if `node` is not a section tree node.
 * @param {any} node
 * @returns {any}
 */
export function sectionProgress(node) {
    const ret = wasm.sectionProgress(node);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`seed_doi`](related_paper_hit::seed_doi): the seed's DOI, or the arXiv DOI, or nothing.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to a JavaScript value.
 * @param {string | null} [doi]
 * @param {string | null} [arxiv_id]
 * @returns {any}
 */
export function seedDoi(doi, arxiv_id) {
    var ptr0 = isLikeNone(doi) ? 0 : passStringToWasm0(doi, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(arxiv_id) ? 0 : passStringToWasm0(arxiv_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    const ret = wasm.seedDoi(ptr0, len0, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`seen_files`](folder_diff::seen_files) over the folder and current texts, the
 * base digests by path, and the renames from [`renameSources`].
 *
 * # Errors
 *
 * Fails if the inputs do not match the shape, or the result cannot be serialized.
 * @param {any} folder
 * @param {any} current
 * @param {any} base
 * @param {any} renamed
 * @returns {any}
 */
export function seenFiles(folder, current, base, renamed) {
    const ret = wasm.seenFiles(folder, current, base, renamed);
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
 * [`rules::segments_for`].
 *
 * # Errors
 *
 * Fails only if the value cannot be converted to a JS value.
 * @param {string} kind
 * @returns {any}
 */
export function segmentsFor(kind) {
    const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.segmentsFor(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`select_model_provider`](model_router::select_model_provider); a refusal throws its message as text.
 *
 * # Errors
 *
 * Fails if `providers` is not a list of `{ provider, available }`, or the selection is refused.
 * @param {any} providers
 * @param {string} selected
 * @returns {string}
 */
export function selectModelProvider(providers, selected) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(selected, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.selectModelProvider(providers, ptr0, len0);
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
 * [`selected_pdf_pages`](pdf_pages::selected_pdf_pages) as an array of page numbers.
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {string} answer
 * @param {number} count
 * @returns {any}
 */
export function selectedPdfPages(answer, count) {
    const ptr0 = passStringToWasm0(answer, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.selectedPdfPages(ptr0, len0, count);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`selected_text`](page_math::selected_text): the text of the lines the chosen strokes
 * belong to, one per line.
 *
 * # Errors
 *
 * Fails if `lines` is not an array of lines or `indices` is not an array of numbers.
 * @param {any} lines
 * @param {any} indices
 * @returns {string}
 */
export function selectedText(lines, indices) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.selectedText(lines, indices);
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
 * [`semantic_scholar_target`](semantic_scholar_relay::semantic_scholar_target): the upstream
 * URL for a relay path, or `undefined` when the path is not one.
 * @param {string} pathname
 * @param {string} search
 * @returns {string | undefined}
 */
export function semanticScholarTarget(pathname, search) {
    const ptr0 = passStringToWasm0(pathname, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(search, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.semanticScholarTarget(ptr0, len0, ptr1, len1);
    let v3;
    if (ret[0] !== 0) {
        v3 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v3;
}

/**
 * [`semantic_scholar_to_metadata`] (TS `semanticScholarToMetadata`). A Semantic Scholar paper
 * as a paper.
 *
 * # Errors
 *
 * Fails if `paper` is not a Semantic Scholar paper.
 * @param {any} paper
 * @returns {any}
 */
export function semanticScholarToMetadata(paper) {
    const ret = wasm.semanticScholarToMetadata(paper);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`semantic_status_text`](semantic_status_text::semantic_status_text). `status` is a
 * `SemanticStatus` (tagged by `phase`).
 *
 * # Errors
 *
 * Fails if `status` cannot be read as the expected shape.
 * @param {any} status
 * @returns {string}
 */
export function semanticStatusText(status) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.semanticStatusText(status);
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
 * [`serialise_artifact_ref`](artifact_refs::serialise_artifact_ref) (TS `serialiseArtifactRef`).
 *
 * # Errors
 *
 * Fails if `artifact_ref` has the wrong shape.
 * @param {any} artifact_ref
 * @returns {string}
 */
export function serialiseArtifactRef(artifact_ref) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.serialiseArtifactRef(artifact_ref);
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
 * [`session_action`] for JS (TS `sessionAction`): `"idle"`, `"adopt"`, `"drive"` or `"foreign"`.
 * @param {string | null} [signed_in_user_id]
 * @param {string | null} [adopted_account_id]
 * @returns {string}
 */
export function sessionAction(signed_in_user_id, adopted_account_id) {
    let deferred3_0;
    let deferred3_1;
    try {
        var ptr0 = isLikeNone(signed_in_user_id) ? 0 : passStringToWasm0(signed_in_user_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(adopted_account_id) ? 0 : passStringToWasm0(adopted_account_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.sessionAction(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`set_image_placement`](markdown_image_width::set_image_placement): rewrite the `ordinal`-th
 * image whose alt is `alt` to the patched placement.
 *
 * # Errors
 *
 * Fails if `body` or `alt` is too long, or `patch` has the wrong shape.
 * @param {string} body
 * @param {string} alt
 * @param {number} ordinal
 * @param {any} patch
 * @returns {string}
 */
export function setImagePlacement(body, alt, ordinal, patch) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(alt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.setImagePlacement(ptr0, len0, ptr1, len1, ordinal, patch);
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
 * [`set_ratio`](pane::set_ratio). `target` is the split being resized.
 *
 * # Errors
 *
 * Fails if `layout` or `target` has the wrong shape.
 * @param {any} layout
 * @param {any} target
 * @param {number} ratio
 * @returns {any}
 */
export function setRatio(layout, target, ratio) {
    const ret = wasm.setRatio(layout, target, ratio);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`set_tab_mode`](pane::set_tab_mode). `mode` is `"edit"`, `"read"` or `"ink"`.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape.
 * @param {any} layout
 * @param {any} target
 * @param {any} mode
 * @returns {any}
 */
export function setTabMode(layout, target, mode) {
    const ret = wasm.setTabMode(layout, target, mode);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`settle_plan`] for JS (TS `settleConflictPlan`). `kind` is `"edit"`, `"deleted_remote"` or
 * `"deleted_local"`. Returns `{ action, ... }`.
 *
 * # Errors
 *
 * Fails when `kind` is not one of those strings or a row is not a plain object.
 * @param {any} kind
 * @param {any} base
 * @param {any} local
 * @param {any} remote
 * @returns {any}
 */
export function settleConflictPlan(kind, base, local, remote) {
    const ret = wasm.settleConflictPlan(kind, base, local, remote);
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
 * [`share_from_row`](sharing::share_from_row): a `shares` row as the app's `Share`.
 *
 * # Errors
 *
 * Fails if `row` does not have the `shares` columns.
 * @param {any} row
 * @returns {any}
 */
export function shareFromRow(row) {
    const ret = wasm.shareFromRow(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`share_link_from_row`](sharing::share_link_from_row): a `share_links` row as the app's `ShareLink`.
 *
 * # Errors
 *
 * Fails if `row` does not have the `share_links` columns.
 * @param {any} row
 * @returns {any}
 */
export function shareLinkFromRow(row) {
    const ret = wasm.shareLinkFromRow(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`share_targets`](sharing::share_targets): the ids and blanket owners of one type in a grant list.
 *
 * # Errors
 *
 * Fails if `kind` is not a shareable type or `shares` is not a list of shares.
 * @param {any} shares
 * @param {any} kind
 * @returns {any}
 */
export function shareTargets(shares, kind) {
    const ret = wasm.shareTargets(shares, kind);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`shared_item`](sharing::shared_item): one table row as a `SharedItem`.
 *
 * # Errors
 *
 * Fails if `kind` is not a shareable type or `source` lacks `title`.
 * @param {any} kind
 * @param {any} row
 * @param {any} source
 * @returns {any}
 */
export function sharedItem(kind, row, source) {
    const ret = wasm.sharedItem(kind, row, source);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`shared_item_href`](sharing::shared_item_href).
 *
 * # Errors
 *
 * Fails when `item` is not a shared item.
 * @param {any} item
 * @returns {string}
 */
export function sharedItemHref(item) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.sharedItemHref(item);
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
 * [`shared_item_type_label`](sharing::shared_item_type_label).
 *
 * # Errors
 *
 * Fails when `kind` is not a shareable type.
 * @param {any} kind
 * @returns {string}
 */
export function sharedItemTypeLabel(kind) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.sharedItemTypeLabel(kind);
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
 * [`shared_paper_annotation_summary`](sharing::shared_paper_annotation_summary).
 *
 * # Errors
 *
 * Fails when `metadata` is not JSON, or the summary cannot be converted to a JS value.
 * @param {any} metadata
 * @returns {any}
 */
export function sharedPaperAnnotationSummary(metadata) {
    const ret = wasm.sharedPaperAnnotationSummary(metadata);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`shared_provider_hint`]. `descriptor` and `all` carry `id`, `provider` and `title`;
 * other fields are ignored.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 * @param {any} descriptor
 * @param {any} all
 * @returns {any}
 */
export function sharedProviderHint(descriptor, all) {
    const ret = wasm.sharedProviderHint(descriptor, all);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`shared_read_plan`](sharing::shared_read_plan): the PostgREST table, columns and filter for
 * one shared read, or `null` when there is no id and no owner.
 *
 * # Errors
 *
 * Fails if `kind` is not a shareable type or `ids`/`owners` are not string lists.
 * @param {any} kind
 * @param {any} ids
 * @param {any} owners
 * @returns {any}
 */
export function sharedReadPlan(kind, ids, owners) {
    const ret = wasm.sharedReadPlan(kind, ids, owners);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`shared_resource_href`](sharing::shared_resource_href).
 *
 * # Errors
 *
 * Fails when `kind` is not a shareable type.
 * @param {any} kind
 * @param {string} resource_id
 * @returns {string}
 */
export function sharedResourceHref(kind, resource_id) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(resource_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.sharedResourceHref(kind, ptr0, len0);
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
 * [`shortcut_label::shortcut_label`]: a whole chord, `⌘⇧F` reads `Ctrl+Shift+F` off a Mac.
 * @param {string} chord
 * @param {boolean} mac
 * @returns {string}
 */
export function shortcutLabel(chord, mac) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(chord, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.shortcutLabel(ptr0, len0, mac);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
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
 * [`should_mount_shell_children`](gate::should_mount_shell_children).
 * @param {boolean} loading
 * @param {boolean} needs_privacy_accept
 * @param {boolean} container_ready
 * @returns {boolean}
 */
export function shouldMountShellChildren(loading, needs_privacy_accept, container_ready) {
    const ret = wasm.shouldMountShellChildren(loading, needs_privacy_accept, container_ready);
    return ret !== 0;
}

/**
 * [`should_persist_body`](collab::should_persist_body).
 * @param {boolean} ready
 * @param {string} next
 * @param {string} last_saved
 * @returns {boolean}
 */
export function shouldPersistBody(ready, next, last_saved) {
    const ptr0 = passStringToWasm0(next, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(last_saved, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.shouldPersistBody(ready, ptr0, len0, ptr1, len1);
    return ret !== 0;
}

/**
 * [`should_persist_index`](index_cache_policy::should_persist_index).
 * @param {boolean} installed_app
 * @param {number} document_count
 * @returns {boolean}
 */
export function shouldPersistIndex(installed_app, document_count) {
    const ret = wasm.shouldPersistIndex(installed_app, document_count);
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
 * [`should_show_workspace_loader`](gate::should_show_workspace_loader). `error` is the startup
 * error text, or nothing; an empty string counts as no error, as it does in JS.
 * @param {boolean} loading
 * @param {boolean} needs_privacy_accept
 * @param {boolean} container_ready
 * @param {string | null} [error]
 * @returns {boolean}
 */
export function shouldShowWorkspaceLoader(loading, needs_privacy_accept, container_ready, error) {
    var ptr0 = isLikeNone(error) ? 0 : passStringToWasm0(error, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.shouldShowWorkspaceLoader(loading, needs_privacy_accept, container_ready, ptr0, len0);
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
 * [`site_of`](paper_preview::site_of) (TS `siteOf`).
 * @param {string} url
 * @returns {string}
 */
export function siteOf(url) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(url, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.siteOf(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`slug_for`](wf_core::sync::folder_layout::slug_for); `fallback` defaults to
 * `"untitled"` (TS `slugFor`).
 * @param {string} title
 * @param {string | null} [fallback]
 * @returns {string}
 */
export function slugFor(title, fallback) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(fallback) ? 0 : passStringToWasm0(fallback, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.slugFor(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`slug_segment`](tree::slug_segment).
 * @param {string} title
 * @returns {string}
 */
export function slugSegment(title) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.slugSegment(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
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
 * Fit a line, rect, ellipse or arrow to a finished mark (Rust `snap_ink_shape`).
 * `null` when the recogniser abstains.
 * @param {Float64Array} points
 * @returns {any}
 */
export function snapInkShape(points) {
    const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.snapInkShape(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`snap_to_text`]: `runs` is `{ left, top, right, bottom }[]` (plain boxes, not DOMRects).
 * Returns `{ index, x, y }` or `null`.
 *
 * # Errors
 *
 * Fails if `runs` is not an array of `{ left, top, right, bottom }` objects.
 * @param {any} runs
 * @param {number} x
 * @param {number} y
 * @returns {any}
 */
export function snapToText(runs, x, y) {
    const ret = wasm.snapToText(runs, x, y);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`sort_by_citations`](related_paper_hit::sort_by_citations): most cited first, stable.
 *
 * # Errors
 *
 * Fails if `hits` cannot be read as a list of hits.
 * @param {any} hits
 * @returns {any}
 */
export function sortByCitations(hits) {
    const ret = wasm.sortByCitations(hits);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`sort_by_due`](screen::sort_by_due): dated milestones soonest first, undated after.
 *
 * # Errors
 *
 * Fails if `milestones` has the wrong shape, or the result cannot be serialised.
 * @param {any} milestones
 * @returns {any}
 */
export function sortByDue(milestones) {
    const ret = wasm.sortByDue(milestones);
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
 * [`sort_hit_order`](palette_sort::sort_hit_order): the indices of `rows` in the chosen order.
 *
 * # Errors
 *
 * Fails if `rows` or `order` has the wrong shape.
 * @param {any} rows
 * @param {any} order
 * @returns {any}
 */
export function sortHitOrder(rows, order) {
    const ret = wasm.sortHitOrder(rows, order);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`source_note_template_context`]: the `{{...}}` values for a paper's source note.
 * @param {any} input
 * @returns {any}
 */
export function sourceNoteTemplateContext(input) {
    const ret = wasm.sourceNoteTemplateContext(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`span_distance`](vocab_match::span_distance); `Infinity` when refused.
 *
 * # Errors
 *
 * Fails if `words` or `entry_words` is not an array of strings.
 * @param {any} words
 * @param {any} entry_words
 * @returns {number}
 */
export function spanDistance(words, entry_words) {
    const ret = wasm.spanDistance(words, entry_words);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0];
}

/**
 * [`span_points`](text_anchor::span_points): `lengths` are the text node lengths, in order.
 *
 * # Errors
 *
 * Fails when `lengths` is not a list of counts or `span` is not a text span.
 * @param {any} lengths
 * @param {any} span
 * @returns {any}
 */
export function spanPoints(lengths, span) {
    const ret = wasm.spanPoints(lengths, span);
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
 * [`split_headline`] for JS (TS `splitHeadline`): `{ headline, rest }`.
 * @param {string} body
 * @returns {any}
 */
export function splitHeadline(body) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.splitHeadline(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`split_ink_text_layer`](wf_core::sync::ink_note::split_ink_text_layer): one string per
 * page (TS `splitInkTextLayer`).
 *
 * # Errors
 *
 * Fails if `body` exceeds `MAX_INDEX_TEXT_UTF16` UTF-16 units.
 * @param {string} body
 * @returns {any}
 */
export function splitInkTextLayer(body) {
    const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.splitInkTextLayer(ptr0, len0);
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
 * [`split_outside_edits`](outside_edits::split_outside_edits) on `{ notes, rows, seen }`,
 * returning `{ noteHeld, rowHeld, reasons }`.
 *
 * # Errors
 *
 * Fails if the input does not match the shape, or the result cannot be serialized.
 * @param {any} input
 * @returns {any}
 */
export function splitOutsideEdits(input) {
    const ret = wasm.splitOutsideEdits(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`split_pane`](pane::split_pane). `direction` is `"row"` or `"column"`.
 *
 * # Errors
 *
 * Fails if `layout` or `direction` has the wrong shape.
 * @param {any} layout
 * @param {string} pane_id
 * @param {any} direction
 * @param {string} new_pane_id
 * @returns {any}
 */
export function splitPane(layout, pane_id, direction, new_pane_id) {
    const ptr0 = passStringToWasm0(pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(new_pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.splitPane(layout, ptr0, len0, direction, ptr1, len1);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`split_proposal_content`](preview::split_proposal_content).
 *
 * # Errors
 *
 * Fails only if the result cannot be serialised.
 * @param {string} content
 * @returns {any}
 */
export function splitProposalContent(content) {
    const ptr0 = passStringToWasm0(content, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.splitProposalContent(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`pglite_sql::split_top_level`] (TS `splitTopLevel`): the top-level comma-separated pieces.
 *
 * # Errors
 *
 * Returns an error if the result cannot be converted to JS.
 * @param {string} expression
 * @returns {any}
 */
export function splitTopLevel(expression) {
    const ptr0 = passStringToWasm0(expression, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.splitTopLevel(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`stack_margin_notes`]: `anchorTops` is a number array; returns `{ index, top, anchorTop }[]`
 * in ascending `anchorTop` order.
 *
 * # Errors
 *
 * Fails if `anchorTops` is not an array of numbers.
 * @param {any} anchor_tops
 * @param {number} card_height
 * @returns {any}
 */
export function stackMarginNotes(anchor_tops, card_height) {
    const ret = wasm.stackMarginNotes(anchor_tops, card_height);
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
 * [`step_cursor`](quick::step_cursor): the row an arrow key lands on.
 * @param {number} cursor
 * @param {number} delta
 * @param {number} length
 * @returns {number}
 */
export function stepCursor(cursor, delta, length) {
    const ret = wasm.stepCursor(cursor, delta, length);
    return ret;
}

/**
 * [`steps_to_prune`](experiments::steps_to_prune).
 * @param {Float64Array} stored_steps
 * @returns {Float64Array}
 */
export function stepsToPrune(stored_steps) {
    const ptr0 = passArrayF64ToWasm0(stored_steps, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.stepsToPrune(ptr0, len0);
    var v2 = getArrayF64FromWasm0(ret[0], ret[1]).slice();
    wasm.__wbindgen_free(ret[0], ret[1] * 8, 8);
    return v2;
}

/**
 * [`streak_days`] for JS (TS `streakDays`).
 *
 * # Errors
 *
 * Fails when `entryDates` is not an array of strings.
 * @param {any} entry_dates
 * @param {string} today
 * @returns {number}
 */
export function streakDays(entry_dates, today) {
    const ptr0 = passStringToWasm0(today, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.streakDays(entry_dates, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return ret[0] >>> 0;
}

/**
 * [`stride_for_step`](experiments::stride_for_step).
 * @param {number} step
 * @returns {number}
 */
export function strideForStep(step) {
    const ret = wasm.strideForStep(step);
    return ret;
}

/**
 * [`strip_archive_root`](archive::strip_archive_root). `paths` is a `string[]`.
 *
 * # Errors
 *
 * Fails if `paths` has the wrong shape.
 * @param {any} paths
 * @returns {any}
 */
export function stripArchiveRoot(paths) {
    const ret = wasm.stripArchiveRoot(paths);
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
 * [`strip_region_markers`](tpl::strip_region_markers).
 * @param {string} document
 * @returns {string}
 */
export function stripRegionMarkers(document) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(document, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.stripRegionMarkers(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
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
 * [`strip_unresolved_image_refs`](markdown_image_refs::strip_unresolved_image_refs).
 * `paths` and `resolved` are JS string arrays.
 * @param {string} body
 * @param {string} prefix
 * @param {any} paths
 * @param {any} resolved
 * @returns {string}
 */
export function stripUnresolvedImageRefs(body, prefix, paths, resolved) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(prefix, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.stripUnresolvedImageRefs(ptr0, len0, ptr1, len1, paths, resolved);
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
 * [`stroke_clip_text`]: the clipboard text for a set of `InkStroke`s.
 * @param {any} strokes
 * @returns {string}
 */
export function strokeClipText(strokes) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.strokeClipText(strokes);
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
 * [`stroke_path`] over a flat `[x0, y0, x1, y1, ...]` array; `undefined` for fewer than two numbers.
 * @param {Float64Array} points
 * @returns {string | undefined}
 */
export function strokePath(points) {
    const ptr0 = passArrayF64ToWasm0(points, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.strokePath(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
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
 * [`substitute_variables`](tpl::substitute_variables).
 *
 * # Errors
 *
 * Fails if the context is not a plain object.
 * @param {string} template
 * @param {any} context_value
 * @returns {string}
 */
export function substituteVariables(template, context_value) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(template, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.substituteVariables(ptr0, len0, context_value);
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
 * [`subtree_ids`]: the id of `node` and of every list below it.
 * @param {any} node
 * @returns {any}
 */
export function subtreeIds(node) {
    const ret = wasm.subtreeIds(node);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`summarize_pdf_drop`](paper_drop::summarize_pdf_drop) (TS `summarizePdfDrop`).
 *
 * # Errors
 *
 * Fails if `entries` is not an array of drop entries, or the result cannot be converted.
 * @param {any} entries
 * @returns {any}
 */
export function summarizePdfDrop(entries) {
    const ret = wasm.summarizePdfDrop(entries);
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
 * [`sync_dot`] for JS (TS `syncDot`). `null` when the account does not sync and is online.
 *
 * # Errors
 *
 * Fails when `input` is not a sync state with the expected fields.
 * @param {any} input
 * @returns {any}
 */
export function syncDot(input) {
    const ret = wasm.syncDot(input);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`field_shown`]: whether the connection field with `key` is asked for in this sign-in mode.
 * @param {string} key
 * @param {boolean} mattermost_sign_in
 * @returns {boolean}
 */
export function syncFieldShown(key, mattermost_sign_in) {
    const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.syncFieldShown(ptr0, len0, mattermost_sign_in);
    return ret !== 0;
}

/**
 * [`sync_stroke_steps`]: `history` is the page log, `depth` the worker's stroke count.
 * @param {any} history
 * @param {number} depth
 * @returns {any}
 */
export function syncStrokeSteps(history, depth) {
    const ret = wasm.syncStrokeSteps(history, depth);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`local_first_route::synced_tables`] as an array of table names.
 *
 * # Errors
 *
 * Fails if the result cannot be converted to JS.
 * @returns {any}
 */
export function syncedTables() {
    const ret = wasm.syncedTables();
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`tab_at`](pane::tab_at).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @param {string} pane_id
 * @param {number} index
 * @returns {any}
 */
export function tabAt(layout, pane_id, index) {
    const ptr0 = passStringToWasm0(pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.tabAt(layout, ptr0, len0, index);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`tab_key`](pane::tab_key).
 *
 * # Errors
 *
 * Fails if `tab` has the wrong shape.
 * @param {any} tab
 * @returns {string}
 */
export function tabKey(tab) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.tabKey(tab);
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
 * [`tab_mode`](pane::tab_mode). Returns `"edit"`, `"read"` or `"ink"`.
 *
 * # Errors
 *
 * Fails if `tab` has the wrong shape.
 * @param {any} tab
 * @returns {any}
 */
export function tabMode(tab) {
    const ret = wasm.tabMode(tab);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`tag_colour`](graph_colour::tag_colour): the hue for a tag.
 * @param {string} tag
 * @returns {string}
 */
export function tagColor(tag) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(tag, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tagColor(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`to_tag`]: a `tags` row as the app's tag.
 * @param {any} row
 * @returns {any}
 */
export function tagFromRow(row) {
    const ret = wasm.tagFromRow(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`tag_to_hashtag`](note_tags::tag_to_hashtag). Empty when the name has no usable characters.
 * @param {string} name
 * @returns {string}
 */
export function tagToHashtag(name) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.tagToHashtag(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
}

/**
 * [`tag_tone`](tag_tone::tag_tone): colour slot `1..=6` for a tag.
 * @param {string} tag
 * @returns {number}
 */
export function tagTone(tag) {
    const ptr0 = passStringToWasm0(tag, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.tagTone(ptr0, len0);
    return ret >>> 0;
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
 * [`take_page_step`]: `direction` is `"undo"` or `"redo"`; gives
 * `{ history, step }`, or `null` when that stack is empty.
 * @param {any} history
 * @param {string} direction
 * @returns {any}
 */
export function takePageStep(history, direction) {
    const ptr0 = passStringToWasm0(direction, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.takePageStep(history, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`engine_args`]: the argument vector for `engine` (`"latexmk"`, `"tectonic"` or `"pdflatex"`)
 * compiling `entry`.
 *
 * # Errors
 *
 * Fails if `engine` is not one of the known engine names, or the result cannot be converted to
 * JS.
 * @param {any} engine
 * @param {string} entry
 * @returns {any}
 */
export function texEngineArgs(engine, entry) {
    const ptr0 = passStringToWasm0(entry, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.texEngineArgs(engine, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`parse_tex_log`]: the errors in a TeX log, one per place.
 *
 * # Errors
 *
 * Fails only if the result cannot be converted to JS.
 * @param {string} log
 * @param {string} entry
 * @returns {any}
 */
export function texLogErrors(log, entry) {
    const ptr0 = passStringToWasm0(log, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(entry, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.texLogErrors(ptr0, len0, ptr1, len1);
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
 * [`text_hash`](semantic_fingerprint::text_hash): the stored fingerprint of a document's embedded text.
 * @param {string} text
 * @returns {string}
 */
export function textHash(text) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.textHash(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
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
 * [`tick_format`]: how the tick labels are rendered for these values.
 * @param {any} values
 * @returns {any}
 */
export function tickFormat(values) {
    const ret = wasm.tickFormat(values);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`timeline_lane_offset`](timeline::timeline_lane_offset).
 * @param {number} mid
 * @param {number | null} [year]
 * @returns {number | undefined}
 */
export function timelineLaneOffset(mid, year) {
    const ret = wasm.timelineLaneOffset(mid, !isLikeNone(year), isLikeNone(year) ? 0 : year);
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * [`timeline_mid_year`](timeline::timeline_mid_year). `years` is an array of years, `null` where unknown.
 *
 * # Errors
 *
 * Fails if `years` is not an array of optional numbers.
 * @param {string} layout
 * @param {any} years
 * @returns {number | undefined}
 */
export function timelineMidYear(layout, years) {
    const ptr0 = passStringToWasm0(layout, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.timelineMidYear(ptr0, len0, years);
    if (ret[3]) {
        throw takeFromExternrefTable0(ret[2]);
    }
    return ret[0] === 0 ? undefined : ret[1];
}

/**
 * [`title_fixes`] (TS `titleFixes`). Only papers whose title needs a fix are listed.
 *
 * # Errors
 *
 * Fails if `papers` is not a list of paper summaries, or the result cannot be converted.
 * @param {any} papers
 * @returns {any}
 */
export function titleFixes(papers) {
    const ret = wasm.titleFixes(papers);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`route_title::title_for_path`]. `navItems` is an array of `{ path, label }`.
 *
 * # Errors
 *
 * Fails if `nav_items` is not an array of `{ path, label }` objects.
 * @param {string} pathname
 * @param {any} nav_items
 * @returns {string}
 */
export function titleForPath(pathname, nav_items) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(pathname, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.titleForPath(ptr0, len0, nav_items);
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
 * [`title_of`](quick::title_of): the title a row is shown under.
 *
 * # Errors
 *
 * Fails if `node` is not a tree row.
 * @param {any} node
 * @returns {string}
 */
export function titleOf(node) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.titleOf(node);
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
 * [`to_annotation_search_docs`](search_document::to_annotation_search_docs).
 * `paper_titles` is a plain `{ paperId: title }` object.
 *
 * # Errors
 *
 * Fails if an argument does not match the expected shape.
 * @param {any} annotations
 * @param {any} paper_titles
 * @param {any} degrees
 * @returns {any}
 */
export function toAnnotationSearchDocs(annotations, paper_titles, degrees) {
    const ret = wasm.toAnnotationSearchDocs(annotations, paper_titles, degrees);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_extraction_result`](model_concepts::to_extraction_result), checking ids against `batchIds`.
 *
 * # Errors
 *
 * Fails if `raw` is not an array.
 * @param {any} raw
 * @param {string[]} batch_ids
 * @returns {any}
 */
export function toExtractionResult(raw, batch_ids) {
    const ptr0 = passArrayJsValueToWasm0(batch_ids, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.toExtractionResult(raw, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_pdf_search_docs`](search_document::to_pdf_search_docs).
 *
 * # Errors
 *
 * Fails if `sources` or `degrees` do not match the expected shape.
 * @param {any} sources
 * @param {any} degrees
 * @returns {any}
 */
export function toPdfSearchDocs(sources, degrees) {
    const ret = wasm.toPdfSearchDocs(sources, degrees);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`to_render_strokes`]: `strokes` is an `InkRenderSource[]`, `palette` an
 * `InkSvgPalette`, and `hidden` the positions to leave out.
 * @param {any} strokes
 * @param {any} palette
 * @param {Uint32Array} hidden
 * @returns {any}
 */
export function toRenderStrokes(strokes, palette, hidden) {
    const ptr0 = passArray32ToWasm0(hidden, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.toRenderStrokes(strokes, palette, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_search_docs`](search_document::to_search_docs). `degrees` is a plain
 * `{ "kind:id": count }` object.
 *
 * # Errors
 *
 * Fails if `snapshot` or `degrees` do not match the expected shape.
 * @param {any} snapshot
 * @param {any} degrees
 * @returns {any}
 */
export function toSearchDocs(snapshot, degrees) {
    const ret = wasm.toSearchDocs(snapshot, degrees);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_zotero_item`] (TS `toZoteroItem`). The `journalArticle` written to Zotero for a paper.
 *
 * # Errors
 *
 * Fails if `paper` is not a paper.
 * @param {any} paper
 * @returns {any}
 */
export function toZoteroItem(paper) {
    const ret = wasm.toZoteroItem(paper);
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
 * [`toggle_key`](state::toggle_key) for the expanded rows.
 *
 * # Errors
 *
 * Fails if the expanded argument is not an array of strings, or the result cannot be serialised.
 * @param {any} expanded
 * @param {string} key
 * @returns {any}
 */
export function toggleExpanded(expanded, key) {
    const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.toggleExpanded(expanded, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`nav_open_groups::toggle_group`]: `groups` with `key` added when closed, removed when open.
 *
 * # Errors
 *
 * Fails if `groups` is not an array of strings, or the result cannot be converted to JS.
 * @param {any} groups
 * @param {string} key
 * @returns {any}
 */
export function toggleGroup(groups, key) {
    const ptr0 = passStringToWasm0(key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.toggleGroup(groups, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`toggle_preview`](pane::toggle_preview).
 *
 * # Errors
 *
 * Fails if `layout` has the wrong shape.
 * @param {any} layout
 * @param {string} new_pane_id
 * @returns {any}
 */
export function togglePreview(layout, new_pane_id) {
    const ptr0 = passStringToWasm0(new_pane_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.togglePreview(layout, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`toggle_key`](state::toggle_key) for the open sections.
 *
 * # Errors
 *
 * Fails if the open argument is not an array of strings, or the result cannot be serialised.
 * @param {any} open
 * @param {string} id
 * @returns {any}
 */
export function toggleSection(open, id) {
    const ptr0 = passStringToWasm0(id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.toggleSection(open, ptr0, len0);
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
 * [`tool_owns_the_page`]: every tool but `select` takes the page from the text selection.
 * @param {string} tool
 * @returns {boolean}
 */
export function toolOwnsThePage(tool) {
    const ptr0 = passStringToWasm0(tool, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.toolOwnsThePage(ptr0, len0);
    return ret !== 0;
}

/**
 * [`trail_diameter_px`](trail::trail_diameter_px): the trail's diameter in CSS px for a
 * nib width in 0.1 mm on a page `page_width_px` wide.
 * @param {number} width
 * @param {number} page_width_px
 * @returns {number}
 */
export function trailDiameterPx(width, page_width_px) {
    const ret = wasm.trailDiameterPx(width, page_width_px);
    return ret;
}

/**
 * [`transform_x`](text_ot::transform_x): `[ours, theirs]` rewritten to apply after each other.
 *
 * # Errors
 *
 * Fails when the ops cannot be read or two overlapping deletes disagree.
 * @param {any} left
 * @param {any} right
 * @returns {any}
 */
export function transformTextOps(left, right) {
    const ret = wasm.transformTextOps(left, right);
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
 * [`tree_paths`](wf_core::sync::folder_layout::tree_paths) as `[id, path]` pairs in
 * first-seen order (TS `treePaths`; the TS wrapper makes them a `Map`).
 *
 * # Errors
 *
 * Fails if `nodes` is not an array of `FolderNode`s or `entity` is not a known type.
 * @param {any} nodes
 * @param {any} entity
 * @param {string} project_root
 * @returns {any}
 */
export function treePathPairs(nodes, entity, project_root) {
    const ptr0 = passStringToWasm0(project_root, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.treePathPairs(nodes, entity, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`uncropped_figure_box`](figure::uncropped_figure_box): the box with the crop lifted.
 *
 * # Errors
 *
 * Fails if `value` has the wrong shape.
 * @param {any} value
 * @returns {any}
 */
export function uncroppedFigureBox(value) {
    const ret = wasm.uncroppedFigureBox(value);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`union_rect`]: the box around a set of rects, or `null` when there are none.
 *
 * # Errors
 *
 * Fails if `rects` is not an array of `[x1, y1, x2, y2]` arrays.
 * @param {any} rects
 * @returns {any}
 */
export function unionRect(rects) {
    const ret = wasm.unionRect(rects);
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
 * [`unique_device_name`](panel_labels::unique_device_name): an adoption label no taken name matches.
 *
 * # Errors
 *
 * Fails if `taken` is not an array of strings.
 * @param {string} name
 * @param {string} device_label
 * @param {any} taken
 * @returns {string}
 */
export function uniqueDeviceName(name, device_label, taken) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(device_label, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.uniqueDeviceName(ptr0, len0, ptr1, len1, taken);
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
 * [`unique_figure_name`](markdown_to_latex::unique_figure_name) over a list of the names
 * already used (TS `uniqueFigureName`; the TS wrapper adds the result to its `Set`).
 *
 * # Errors
 *
 * Fails if `used` is not an array of strings.
 * @param {string} raw
 * @param {any} used
 * @returns {string}
 */
export function uniqueFigureNameIn(raw, used) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(raw, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.uniqueFigureNameIn(ptr0, len0, used);
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
 * The blob of [`unpack_vectors`](codec::unpack_vectors), or `undefined` for a torn file.
 * @param {Uint8Array} file
 * @returns {Uint8Array | undefined}
 */
export function unpackVectorBlob(file) {
    const ptr0 = passArray8ToWasm0(file, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.unpackVectorBlob(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getArrayU8FromWasm0(ret[0], ret[1]).slice();
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`unpack_head`](codec::unpack_head): the head, or `null` for a torn file.
 *
 * # Errors
 *
 * Fails only if the head cannot be serialised.
 * @param {Uint8Array} file
 * @returns {any}
 */
export function unpackVectorHead(file) {
    const ptr0 = passArray8ToWasm0(file, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.unpackVectorHead(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`url_meta_to_metadata`] (TS `urlMetaToMetadata`). A page's own metadata as a paper.
 *
 * # Errors
 *
 * Fails when the page has no title, or its title names the page rather than a paper.
 * @param {any} meta
 * @returns {any}
 */
export function urlMetaToMetadata(meta) {
    const ret = wasm.urlMetaToMetadata(meta);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`usable_status`](zotero_local_status::usable_status) (TS `usableStatus`).
 * @param {number} status
 * @returns {number}
 */
export function usableStatus(status) {
    const ret = wasm.usableStatus(status);
    return ret;
}

/**
 * [`user_gate_open`]. `gate` is `null` or `undefined` for an ungated descriptor.
 *
 * # Errors
 *
 * Fails if an argument has the wrong shape, or the result cannot be converted to JS.
 * @param {any} config
 * @param {any} gate
 * @returns {any}
 */
export function userGateOpen(config, gate) {
    const ret = wasm.userGateOpen(config, gate);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
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
 * [`to_domain`]: a `vault_pages` row as a full page.
 * @param {any} row
 * @returns {any}
 */
export function vaultPageToDomain(row) {
    const ret = wasm.vaultPageToDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_row`]: a page as the `vault_pages` row it is written as.
 * @param {any} page
 * @returns {any}
 */
export function vaultPageToRow(page) {
    const ret = wasm.vaultPageToRow(page);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`to_summary_domain`]: a `vault_pages` row as a summary page (no body, a preview).
 * @param {any} row
 * @returns {any}
 */
export function vaultPageToSummaryDomain(row) {
    const ret = wasm.vaultPageToSummaryDomain(row);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`vault_root_from_text`](home_config::vault_root_from_text): the `vaultRoot` string, or `undefined`
 * when there is none. The TS wrapper maps `undefined` to `null`.
 * @param {string} text
 * @returns {string | undefined}
 */
export function vaultRootFromText(text) {
    const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.vaultRootFromText(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * Rebuild an index from `VectorIndex.toBytes()` output.
 *
 * # Errors
 *
 * Fails when the bytes are truncated, have trailing data, or repeat an id.
 * @param {Uint8Array} bytes
 * @returns {VectorIndex}
 */
export function vectorIndexFromBytes(bytes) {
    const ptr0 = passArray8ToWasm0(bytes, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.vectorIndexFromBytes(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return VectorIndex.__wrap(ret[0]);
}

/**
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
 * [`verdicts_for`](screening::verdicts_for): both stages' verdicts per item, in item order.
 *
 * # Errors
 *
 * Fails if `items` or `decisions` have the wrong shape.
 * @param {any} items
 * @param {any} decisions
 * @returns {any}
 */
export function verdictsFor(items, decisions) {
    const ret = wasm.verdictsFor(items, decisions);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`viewable_artifact_url`](experiment_artifacts::viewable_artifact_url); `undefined` when refused.
 * @param {string} entry
 * @param {boolean} in_shell
 * @returns {string | undefined}
 */
export function viewableArtifactUrl(entry, in_shell) {
    const ptr0 = passStringToWasm0(entry, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.viewableArtifactUrl(ptr0, len0, in_shell);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
}

/**
 * [`visible_rows`](tree::visible_rows). `expanded` is an array of keys.
 *
 * # Errors
 *
 * Fails if either argument has the wrong shape.
 * @param {any} nodes
 * @param {any} expanded
 * @returns {any}
 */
export function visibleRows(nodes, expanded) {
    const ret = wasm.visibleRows(nodes, expanded);
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
 * [`vscode_json`](mcp_client_config::vscode_json) for a `McpLaunchLine`.
 *
 * # Errors
 *
 * Fails if `launch` has the wrong shape.
 * @param {any} launch
 * @returns {string}
 */
export function vscodeJson(launch) {
    let deferred2_0;
    let deferred2_1;
    try {
        const ret = wasm.vscodeJson(launch);
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
 * [`walk_sections`] over the report outline: body lines, warnings, figures and counts.
 * @param {any} tree
 * @param {any} opts
 * @returns {any}
 */
export function walkOverleafSections(tree, opts) {
    const ret = wasm.walkOverleafSections(tree, opts);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`WEB_CACHE_DOCUMENT_LIMIT`](index_cache_policy::WEB_CACHE_DOCUMENT_LIMIT), the single source
 * the web app reads instead of keeping its own copy.
 * @returns {number}
 */
export function webCacheDocumentLimit() {
    const ret = wasm.webCacheDocumentLimit();
    return ret >>> 0;
}

/**
 * [`wiki_page_refs`]: the wiki's pages as `{ id, title, body }`.
 * @param {any} pages
 * @returns {any}
 */
export function wikiPageRefs(pages) {
    const ret = wasm.wikiPageRefs(pages);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wiki_proposal_content`](wiki_plan::wiki_proposal_content) for a `WikiPagePlan` object.
 *
 * # Errors
 *
 * Fails if `plan` is not a wiki page plan object.
 * @param {any} plan
 * @returns {any}
 */
export function wikiProposalContent(plan) {
    const ret = wasm.wikiProposalContent(plan);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`wiki_source_documents`]: notes and papers as extraction documents. `sourceIds` is
 * optional; omitted means every note and paper.
 * @param {any} pages
 * @param {any} papers
 * @param {any} source_ids
 * @returns {any}
 */
export function wikiSourceDocuments(pages, papers, source_ids) {
    const ret = wasm.wikiSourceDocuments(pages, papers, source_ids);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`nav_open_groups::with_active`]: `groups` with `active` appended when it is not already listed.
 *
 * # Errors
 *
 * Fails if `groups` is not an array of strings, or the result cannot be converted to JS.
 * @param {any} groups
 * @param {string | null} [active]
 * @returns {any}
 */
export function withActive(groups, active) {
    var ptr0 = isLikeNone(active) ? 0 : passStringToWasm0(active, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    const ret = wasm.withActive(groups, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`with_image_width`](markdown_image_width::with_image_width): the alt for a width, keeping any
 * crop or side. `null` clears the width.
 *
 * # Errors
 *
 * Fails if `alt` is longer than the index text limit.
 * @param {string} alt
 * @param {string | null} [width]
 * @returns {string}
 */
export function withImageWidth(alt, width) {
    let deferred4_0;
    let deferred4_1;
    try {
        const ptr0 = passStringToWasm0(alt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(width) ? 0 : passStringToWasm0(width, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.withImageWidth(ptr0, len0, ptr1, len1);
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
 * [`with_ink_page_background`](ink_page::with_ink_page_background): the text with its
 * background line set to `path`, or removed for `null`.
 * @param {string} text
 * @param {string | null} [path]
 * @returns {string}
 */
export function withInkPageBackground(text, path) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        var ptr1 = isLikeNone(path) ? 0 : passStringToWasm0(path, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.withInkPageBackground(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * [`with_ink_page_figures`](figure::with_ink_page_figures): a page's text with its figure block set.
 *
 * # Errors
 *
 * Fails if `text` is too long or `figures` has the wrong shape.
 * @param {string} text
 * @param {any} figures
 * @returns {string}
 */
export function withInkPageFigures(text, figures) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(text, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.withInkPageFigures(ptr0, len0, figures);
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
 * [`with_md_image_alt`](markdown_figure_alt::with_md_image_alt): the alt text for a figure's own
 * text and placement.
 *
 * # Errors
 *
 * Fails if `alt` is too long or `placement` has the wrong shape.
 * @param {string} alt
 * @param {any} placement
 * @returns {string}
 */
export function withMdImageAlt(alt, placement) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(alt, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.withMdImageAlt(ptr0, len0, placement);
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
 * [`with_missing_figures`]: the package files with `manifest.json` rewritten for missing figures.
 * @param {any} files
 * @param {any} missing
 * @returns {any}
 */
export function withMissingFigures(files, missing) {
    const ret = wasm.withMissingFigures(files, missing);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`stored_heights`](fit::stored_heights): `heights[i]`, or the saved height of card `ids[i]`.
 *
 * # Errors
 *
 * Fails when an argument is not the expected shape.
 * @param {any} ids
 * @param {any} heights
 * @param {any} stored
 * @returns {any}
 */
export function withStoredHeights(ids, heights, stored) {
    const ret = wasm.withStoredHeights(ids, heights, stored);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`without_existing`](extraction::without_existing).
 *
 * # Errors
 *
 * Fails when `result` is not an extraction result.
 * @param {any} result
 * @param {string[]} existing
 * @returns {any}
 */
export function withoutExisting(result, existing) {
    const ptr0 = passArrayJsValueToWasm0(existing, wasm.__wbindgen_malloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.withoutExisting(result, ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`without_group`](groups::without_group).
 *
 * # Errors
 *
 * Fails if `tab` has the wrong shape.
 * @param {any} tab
 * @returns {any}
 */
export function withoutGroup(tab) {
    const ret = wasm.withoutGroup(tab);
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
 * [`wrap_region`](tpl::wrap_region). Throws on an unknown kind.
 *
 * # Errors
 *
 * Fails if `kind` is neither `generated` nor `editable`.
 * @param {string} kind
 * @param {string} name
 * @param {string} body
 * @returns {string}
 */
export function wrapRegion(kind, name, body) {
    let deferred5_0;
    let deferred5_1;
    try {
        const ptr0 = passStringToWasm0(kind, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(name, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ptr2 = passStringToWasm0(body, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len2 = WASM_VECTOR_LEN;
        const ret = wasm.wrapRegion(ptr0, len0, ptr1, len1, ptr2, len2);
        var ptr4 = ret[0];
        var len4 = ret[1];
        if (ret[3]) {
            ptr4 = 0; len4 = 0;
            throw takeFromExternrefTable0(ret[2]);
        }
        deferred5_0 = ptr4;
        deferred5_1 = len4;
        return getStringFromWasm0(ptr4, len4);
    } finally {
        wasm.__wbindgen_free(deferred5_0, deferred5_1, 1);
    }
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
 * [`write_ink_note_meta`](ink_note::write_ink_note_meta) as a plain object, keys in TS order.
 *
 * # Errors
 *
 * Fails if `meta` has the wrong shape.
 * @param {any} meta
 * @returns {any}
 */
export function writeInkNoteMeta(meta) {
    const ret = wasm.writeInkNoteMeta(meta);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`year_colours`](node_colouring::year_colours): `[id, colour]` pairs for `[id, year]` pairs.
 *
 * # Errors
 *
 * Fails if `years` is not an array of `[id, number]` pairs.
 * @param {any} years
 * @returns {any}
 */
export function yearColours(years) {
    const ret = wasm.yearColours(years);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`YEAR_SPACING`](timeline::YEAR_SPACING): canvas units between one publication year and the next.
 * @returns {number}
 */
export function yearSpacing() {
    const ret = wasm.yearSpacing();
    return ret;
}

/**
 * [`wf_core::papers::open_access::zenodo_record_id`]: the Zenodo record id in a DOI, or `None`.
 * @param {string} doi
 * @returns {string | undefined}
 */
export function zenodoRecordId(doi) {
    const ptr0 = passStringToWasm0(doi, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.zenodoRecordId(ptr0, len0);
    let v2;
    if (ret[0] !== 0) {
        v2 = getStringFromWasm0(ret[0], ret[1]);
        wasm.__wbindgen_free(ret[0], ret[1] * 1, 1);
    }
    return v2;
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
 * [`annotation_from_item`] (TS `zoteroAnnotationFromItem`).
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 * @param {any} item
 * @returns {any}
 */
export function zoteroAnnotationFromItem(item) {
    const ret = wasm.zoteroAnnotationFromItem(item);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`zotero_arxiv_id`] (TS `zoteroArxivId`). The arXiv id of a Zotero item, or null.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 * @param {any} item
 * @returns {any}
 */
export function zoteroArxivId(item) {
    const ret = wasm.zoteroArxivId(item);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`zotero_content_keys`] (TS `zoteroContentKeys`). The keys a paper matches on.
 * @param {string | null} [doi]
 * @param {string | null} [arxiv_id]
 * @param {string | null} [title]
 * @returns {any}
 */
export function zoteroContentKeys(doi, arxiv_id, title) {
    var ptr0 = isLikeNone(doi) ? 0 : passStringToWasm0(doi, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len0 = WASM_VECTOR_LEN;
    var ptr1 = isLikeNone(arxiv_id) ? 0 : passStringToWasm0(arxiv_id, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len1 = WASM_VECTOR_LEN;
    var ptr2 = isLikeNone(title) ? 0 : passStringToWasm0(title, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    var len2 = WASM_VECTOR_LEN;
    const ret = wasm.zoteroContentKeys(ptr0, len0, ptr1, len1, ptr2, len2);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`zotero_headers`](zotero_library::zotero_headers): the API key and version headers for a
 * request, as a plain object.
 *
 * # Errors
 *
 * Fails only if the headers cannot be converted to a JS value.
 * @param {string} api_key
 * @returns {any}
 */
export function zoteroHeaders(api_key) {
    const ptr0 = passStringToWasm0(api_key, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
    const len0 = WASM_VECTOR_LEN;
    const ret = wasm.zoteroHeaders(ptr0, len0);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`is_pdf_attachment`] (TS `zoteroIsPdfAttachment`).
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 * @param {any} item
 * @returns {any}
 */
export function zoteroIsPdfAttachment(item) {
    const ret = wasm.zoteroIsPdfAttachment(item);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`item_key`] (TS `zoteroItemKey`). The key, or null.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 * @param {any} item
 * @returns {any}
 */
export function zoteroItemKey(item) {
    const ret = wasm.zoteroItemKey(item);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`zotero_key_of`] (TS `zoteroKeyOf`): the paper's Zotero item key, or `null`.
 *
 * # Errors
 *
 * Fails if `metadata` is not an object of JSON values.
 * @param {any} metadata
 * @returns {any}
 */
export function zoteroKeyOf(metadata) {
    const ret = wasm.zoteroKeyOf(metadata);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`zotero_library_url`](zotero_library::zotero_library_url): the API URL for a library path.
 * @param {string} library
 * @param {string} api_origin
 * @returns {string}
 */
export function zoteroLibraryUrl(library, api_origin) {
    let deferred3_0;
    let deferred3_1;
    try {
        const ptr0 = passStringToWasm0(library, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(api_origin, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.zoteroLibraryUrl(ptr0, len0, ptr1, len1);
        deferred3_0 = ret[0];
        deferred3_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred3_0, deferred3_1, 1);
    }
}

/**
 * The message for the 403 the local API answers when its preference is off (TS
 * `ZOTERO_LOCAL_API_OFF`).
 * @returns {string}
 */
export function zoteroLocalApiOff() {
    let deferred1_0;
    let deferred1_1;
    try {
        const ret = wasm.zoteroLocalApiOff();
        deferred1_0 = ret[0];
        deferred1_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred1_0, deferred1_1, 1);
    }
}

/**
 * [`zotero_local_status_message`](zotero_local_status::zotero_local_status_message)
 * (TS `zoteroLocalStatusMessage`).
 *
 * # Errors
 *
 * Fails if the result cannot be converted.
 * @param {number} status
 * @returns {any}
 */
export function zoteroLocalStatusMessage(status) {
    const ret = wasm.zoteroLocalStatusMessage(status);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`note_from_item`] (TS `zoteroNoteFromItem`). The note, or null when it has no text.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 * @param {any} item
 * @returns {any}
 */
export function zoteroNoteFromItem(item) {
    const ret = wasm.zoteroNoteFromItem(item);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`pick_main_pdf`] (TS `zoteroPickMainPdf`). The main PDF's key, or null.
 *
 * # Errors
 *
 * Fails if `pdfs` is not an array of Zotero items.
 * @param {any} pdfs
 * @returns {any}
 */
export function zoteroPickMainPdf(pdfs) {
    const ret = wasm.zoteroPickMainPdf(pdfs);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`zotero_remote_to_input`] (TS `zoteroRemoteToInput`). A paper read from a Zotero item,
 * with its key kept under `metadata.zoteroKey`.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 * @param {any} item
 * @returns {any}
 */
export function zoteroRemoteToInput(item) {
    const ret = wasm.zoteroRemoteToInput(item);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`zotero_remote_to_metadata`] (TS `zoteroRemoteToMetadata`). The metadata a metadata
 * lookup returns for a Zotero item.
 *
 * # Errors
 *
 * Fails if `item` is not a Zotero item.
 * @param {any} item
 * @returns {any}
 */
export function zoteroRemoteToMetadata(item) {
    const ret = wasm.zoteroRemoteToMetadata(item);
    if (ret[2]) {
        throw takeFromExternrefTable0(ret[1]);
    }
    return takeFromExternrefTable0(ret[0]);
}

/**
 * [`zotero_top_level_path`](zotero_library::zotero_top_level_path): the top-level items path,
 * inside a collection when one is given.
 * @param {string | null} [collection]
 * @returns {string}
 */
export function zoteroTopLevelPath(collection) {
    let deferred2_0;
    let deferred2_1;
    try {
        var ptr0 = isLikeNone(collection) ? 0 : passStringToWasm0(collection, wasm.__wbindgen_malloc, wasm.__wbindgen_realloc);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.zoteroTopLevelPath(ptr0, len0);
        deferred2_0 = ret[0];
        deferred2_1 = ret[1];
        return getStringFromWasm0(ret[0], ret[1]);
    } finally {
        wasm.__wbindgen_free(deferred2_0, deferred2_1, 1);
    }
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
        __wbg_call_16afc35a43d64f2a: function(arg0, arg1, arg2, arg3, arg4) {
            const ret = arg0.call(arg1, getStringFromWasm0(arg2, arg3), arg4 >>> 0);
            return ret;
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

const ArchiveBudgetFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_archivebudget_free(ptr, 1));
const InkStrokePackerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_inkstrokepacker_free(ptr, 1));
const NibFilterFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_nibfilter_free(ptr, 1));
const NibFilterSnapshotFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_nibfiltersnapshot_free(ptr, 1));
const OneEuroFilterFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_oneeurofilter_free(ptr, 1));
const VectorIndexFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_vectorindex_free(ptr, 1));

function addToExternrefTable0(obj) {
    const idx = wasm.__externref_table_alloc();
    wasm.__wbindgen_externrefs.set(idx, obj);
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
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

function getArrayU32FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint32ArrayMemory0().subarray(ptr / 4, ptr / 4 + len);
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
