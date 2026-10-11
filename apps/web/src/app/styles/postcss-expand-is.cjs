/**
 * Splits a selector whose last compound is keyed only by `:is(.a, .b)` into
 * `.a, .b`. Chromium files a rule under its last compound's class, id, tag or
 * attribute; an `:is()` there has none, so the rule was tried on every element
 * of every style recalc (about half of a 120ms recalc on /papers).
 *
 * What matches and which rule wins stay the same: an argument short of the
 * `:is()`'s specificity is padded with `:not()`s that match everything, and an
 * argument with combinators is only split out under a bare `:root` prefix.
 */

const PAD = [":not(#wf-pad)", ":not(.wf-pad)", ":not(wf-pad)"];

/** Splits at commas outside brackets and strings. */
function splitList(s) {
  const out = [];
  let depth = 0, quote = null, start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) { out.push(s.slice(start, i).trim()); start = i + 1; }
  }
  out.push(s.slice(start).trim());
  return out;
}

/** Index where the last compound starts (after the last top-level combinator). */
function lastCompoundStart(s) {
  let depth = 0, quote = null, cut = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && /[\s>+~]/.test(c)) cut = i + 1;
  }
  return cut;
}

/** Index of the bracket closing the one opened at `open`. */
function closing(s, open) {
  let depth = 0, quote = null;
  for (let i = open; i < s.length; i++) {
    const c = s[i];
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = null; continue; }
    if (c === "\\") { i++; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

/** Splits a complex selector into its compounds, dropping the combinators. */
function compounds(s) {
  const out = [];
  let rest = s.trim();
  while (rest) {
    const cut = lastCompoundStart(rest);
    out.unshift(rest.slice(cut));
    rest = rest.slice(0, cut).replace(/[\s>+~]+$/, "");
  }
  return out;
}

const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];

/** [ids, classes, types] of a selector list's most specific entry, or null if it holds anything unknown. */
function listSpecificity(list) {
  let max = null;
  for (const s of splitList(list)) {
    const spec = specificity(s);
    if (!spec) return null;
    if (!max || cmp(spec, max) > 0) max = spec;
  }
  return max;
}

/** [ids, classes, types] of one complex selector, or null if it holds anything unknown. */
function specificity(sel) {
  let total = [0, 0, 0];
  for (const s of compounds(sel)) {
    let i = 0;
    while (i < s.length) {
      const c = s[i];
      const rest = s.slice(i);
      let m;
      if (c === "[") {
        const end = closing(s, i);
        if (end < 0) return null;
        total = add(total, [0, 1, 0]); i = end + 1;
      } else if ((m = /^[.#](?:\\.|[\w-])+/.exec(rest))) {
        total = add(total, c === "#" ? [1, 0, 0] : [0, 1, 0]); i += m[0].length;
      } else if ((m = /^:(is|not|has|where)\(/.exec(rest))) {
        const end = closing(s, i + m[0].length - 1);
        if (end < 0) return null;
        if (m[1] !== "where") {
          const inner = listSpecificity(s.slice(i + m[0].length, end));
          if (!inner) return null;
          total = add(total, inner);
        }
        i = end + 1;
      } else if ((m = /^:[\w-]+/.exec(rest)) && s[i + m[0].length] !== "(") {
        total = add(total, [0, 1, 0]); i += m[0].length;
      } else if (i === 0 && (m = /^(?:\*|[\w-]+)/.exec(rest))) {
        if (m[0] !== "*") total = add(total, [0, 0, 1]);
        i += m[0].length;
      } else return null;
    }
  }
  return total;
}

/** True when the compound outside any `:x(...)` names a class, id, tag or attribute Chromium can file it under. */
function hasKey(compound) {
  let depth = 0;
  for (let i = 0; i < compound.length; i++) {
    const c = compound[i];
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && (c === "." || c === "#" || c === "[" || (i === 0 && /[\w-]/.test(c)))) return true;
  }
  return false;
}

/** Flattens `:is(:is(a, b), c)` arguments into `a, b, c`. */
function flatArgs(inner) {
  return splitList(inner).flatMap((a) => {
    if (a.startsWith(":is(") && closing(a, 3) === a.length - 1) return flatArgs(a.slice(4, -1));
    return [a];
  });
}

/**
 * Where each `:is(` sits outside any bracket. One inside `:not()` must stay put,
 * and one inside another `:is()` would clone a rule that is still unkeyed.
 */
function topLevelIs(compound) {
  const at = [];
  for (let i = 0, depth = 0; i < compound.length; i++) {
    const c = compound[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (depth === 0 && compound.startsWith(":is(", i)) at.push(i);
  }
  return at;
}

/** `:root` alone, as the only ancestor: nothing sits above it, so `:root :is(a b)` is `:root a b`. */
function rootOnly(prefix) {
  const p = prefix.trim();
  return p === "" || (/^\s/.test(prefix.slice(p.length)) && lastCompoundStart(p) === 0 && p.startsWith(":root"));
}

/** One complex selector, expanded, or the selector as it was. */
function expandOne(sel) {
  const start = lastCompoundStart(sel);
  const prefix = sel.slice(0, start);
  const compound = sel.slice(start);
  if (hasKey(compound)) return [sel];
  for (const i of topLevelIs(compound)) {
    const end = closing(compound, i + 3);
    if (end < 0) return [sel];
    const texts = flatArgs(compound.slice(i + 4, end));
    const args = texts.map(compounds);
    if (!args.every((a) => hasKey(a[a.length - 1]) && !a[a.length - 1].includes("::"))) continue;
    // Html carries no class, so an argument led by a class or tag never starts at :root itself.
    if (args.some((a) => a.length > 1 && (!rootOnly(prefix) || !/^[.\w-]/.test(a[0]) || /^(html|:root)\b/.test(a[0])))) return [sel];
    const specs = texts.map(specificity);
    if (specs.some((s) => !s)) return [sel];
    const max = specs.reduce((m, s) => (cmp(s, m) > 0 ? s : m));
    // Padding only adds, so an arg past the max in any column can't be matched exactly.
    if (specs.some((s) => s.some((v, n) => v > max[n]))) return [sel];
    const rest = compound.slice(0, i).replace(/^\*/, "") + compound.slice(end + 1);
    const pe = rest.indexOf("::");
    const [pseudos, element] = pe < 0 ? [rest, ""] : [rest.slice(0, pe), rest.slice(pe)];
    // The arg leads, so a type selector stays first; pads lift each arg to the `:is()`'s specificity.
    return texts.map((t, k) => prefix + t + pseudos + [0, 1, 2].map((n) => PAD[n].repeat(max[n] - specs[k][n])).join("") + element);
  }
  return [sel];
}

function expandSelector(selector) {
  const parts = splitList(selector);
  const out = parts.flatMap(expandOne);
  return out.length === parts.length && out.every((s, i) => s === parts[i]) ? selector : out.join(",\n");
}

const plugin = () => ({
  postcssPlugin: "expand-is",
  Rule(rule) {
    if (rule.parent?.type === "atrule" && /keyframes$/i.test(rule.parent.name)) return;
    const next = expandSelector(rule.selector);
    if (next !== rule.selector) rule.selector = next;
  },
});
plugin.postcss = true;

module.exports = plugin;
module.exports.expandSelector = expandSelector;
module.exports.specificity = specificity;
