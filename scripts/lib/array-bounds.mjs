/**
 * Does this route source actually bound an array?
 *
 * The rule this backs used to be `/\.length\s*>/`, which is satisfied by any
 * comparison at all. A route whose only one was `if (toInsert.length > 0)`
 * passed while the cap two lines above it — the thing the rule exists to
 * require — could be deleted without the gate noticing.
 *
 * What counts as a bound here:
 *
 *   - `.length > MAX_SIGNED_URL_PATHS` — a named constant in caps;
 *   - `.length > 200` — a numeric literal;
 *   - either of those with `>=`, `<` or `<=`.
 *
 * What does not: `> 0` and `=== 0`, which are emptiness tests rather than
 * limits, and a plain lowercase identifier, which is far more likely to be
 * `i > items.length` — a loop condition written the wrong way round than a cap.
 * A config field (`opts.maxItems`) would be a real bound, and this cannot tell
 * it from an ordinary property read; the convention the rule's message states
 * is the one the gate can actually check.
 *
 * Comments are stripped first, because the rule is about code. An explanatory
 * comment quoting the fix — "compare `.length > MAX_PATHS`" — must not satisfy
 * the rule it is describing, which is exactly how a rule rots into a formality.
 *
 * Only block comments and whole-line `//` comments are removed. A stripper that
 * searches a line for `//` has to understand string and regex literals to avoid
 * cutting a URL or a pattern in half, and a subtle mistake there would be a new
 * way for the gate to be wrong — a worse outcome than not stripping a trailing
 * `// cap: MAX_PATHS` on a code line, which is inert because the code on that
 * line is still tested as written.
 *
 * Exported from its own module rather than inlined in check-hygiene.mjs so it
 * can be asserted on directly: which strings count as a bound is the whole
 * behaviour, and it is worth being able to test without a checkout.
 */

/** Source without block comments, and without whole-line comments. */
export function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((line) => !/^\s*(?:\/\/|\*)/.test(line))
    .join("\n");
}

const BOUND = /\.length\s*(?:>=|>|<=|<)\s*(?:[A-Z][A-Z0-9_]*|[1-9][0-9]*)\b/;

/**
 * @param {string} source the route file's contents
 * @returns {boolean} whether it compares a `.length` against a real limit
 */
export function boundsArrayLength(source) {
  return BOUND.test(withoutComments(source));
}
