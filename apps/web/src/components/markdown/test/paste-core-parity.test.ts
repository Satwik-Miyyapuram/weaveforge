import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import * as ts from "@weaveforge/core";
import type { PasteSettings } from "@weaveforge/wasm";
import type { RustCore } from "@/lib/rust-core";
import { loadTestCore } from "@/lib/test/load-test-core";

let rs: RustCore;
before(async () => {
  rs = await loadTestCore();
});

// Rust and TS must agree on every input, so the TS paste copy can be deleted.
// The corpus is every string literal in the TS paste tests (the cases someone
// thought of), edge cases they do not cover, and seeded mixes of fragments.

const TS_TESTS = new URL("../../../../../../packages/core/test/paste/", import.meta.url);

/** A JS string literal's value, or null for one with escapes JSON cannot read. */
function literalValue(body: string): string | null {
  try {
    return JSON.parse(`"${body.replace(/\\'/g, "'").replace(/\\`/g, "`").replace(/\n/g, "\\n").replace(/(?<!\\)"/g, '\\"')}"`) as string;
  } catch {
    return null;
  }
}

function testLiterals(): string[] {
  const out: string[] = [];
  for (const name of readdirSync(TS_TESTS)) {
    const src = readFileSync(new URL(name, TS_TESTS), "utf8");
    for (const m of src.matchAll(/"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.|\$(?!\{))*)`/g)) {
      const value = literalValue(m[1] ?? m[2] ?? "");
      if (value !== null && value.length > 0) out.push(value);
    }
  }
  return out;
}

const EDGE_CASES = [
  "",
  "\r\n",
  "a\r\nb\r\n",
  "😀 “quoted”, — dash",
  "\ud800 lone surrogate",
  "x\udc00y",
  "é\u0301\u200b\u00ad\ufeff",
  "a\tb\n1\t2\n",
  "a\tb\n😀\t2\nlong\tlonger\tlongest",
  "https://example.com/a?utm_source=x&id=1#frag",
  "see https://www.example.com/path?fbclid=abc).",
  "<https://example.com/?ref=hn>",
  "[label](https://example.com/?gclid=1&q=2)",
  "`https://example.com/?utm_medium=code`",
  "```\nhttps://example.com/?utm_source=x\n```",
  "---\ntitle: “x”\n---\nbody",
  "$$\nx -- y\n$$",
  "\u001b[31mred\u001b[0m",
  "word-\nwrapped line that goes on\nand on",
  "• one\n• two\n◦ three",
  "doi:10.1145/3290605.3300233 and arXiv:2305.12345",
  "He said \"yes\", and 'no', then “maybe”,",
  "  indented\n    more\n  back",
  "12\n\nPage text\n\n13",
];

const FRAGMENTS = [
  "Plain words here.",
  "“Smart” ‘quotes’ — and – dashes…",
  "https://example.com/x?utm_source=a&keep=1",
  "```js\nconst a = \"--\";\n```",
  "`inline -- code`",
  "$$\na -- b\n$$",
  "$x$ and \\(y\\)",
  "a\tb\tc",
  "1\t2\t3",
  "> quoted line",
  "- bullet\n- list",
  "• pdf bullet",
  "hyphen-\nated",
  "😀🎉 astral",
  "\u200b\u00a0\u2009",
  "\r\n",
  "  ",
  "\n\n",
  "---",
  "[[Wiki link]]",
  "![img](https://example.com/i.png?utm_campaign=z)",
  "\u001b[1mbold\u001b[0m",
  "42",
  "doi.org/10.1000/xyz",
];

/** Mulberry32, so a failure reproduces from the seed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function mixes(count: number): string[] {
  const next = random(0x5eed);
  return Array.from({ length: count }, () => {
    const parts = Array.from({ length: 1 + Math.floor(next() * 6) }, () => FRAGMENTS[Math.floor(next() * FRAGMENTS.length)]);
    const glue = ["\n", " ", "\n\n", ""][Math.floor(next() * 4)];
    return parts.join(glue);
  });
}

/**
 * `input` with each lone surrogate as U+FFFD. Rust strings are UTF-8, so the
 * WASM boundary replaces lone surrogates before Rust sees them; comparing on
 * well-formed text keeps that one known difference out of the corpus.
 */
function wellFormed(input: string): string {
  return input.replace(/\p{Cs}/gu, "\ufffd");
}

const CORPUS = [...new Set([...testLiterals(), ...EDGE_CASES, ...mixes(400)].map(wellFormed))];

/** Collects mismatches so one run reports them all, not just the first. */
function compare(): { check: (label: string, input: unknown, a: unknown, b: unknown) => void; done: () => void } {
  const failures: string[] = [];
  let total = 0;
  return {
    check(label, input, a, b) {
      total += 1;
      try {
        assert.deepStrictEqual(b, a);
      } catch {
        if (failures.length < 25) failures.push(`${label} ${JSON.stringify(input)}\n  ts: ${JSON.stringify(a)}\n  rs: ${JSON.stringify(b)}`);
        else failures.push("");
      }
    },
    done() {
      assert.ok(total > 0);
      assert.equal(failures.length, 0, `${failures.length} of ${total} differ:\n${failures.filter(Boolean).join("\n")}`);
    },
  };
}

function settingsVariants(): PasteSettings[] {
  const base = { ...ts.DEFAULT_PASTE_SETTINGS, linkRemovals: [...ts.DEFAULT_PASTE_SETTINGS.linkRemovals] };
  const flags = Object.keys(base).filter((k) => typeof base[k as keyof PasteSettings] === "boolean");
  const all = (on: boolean) => ({ ...base, ...Object.fromEntries(flags.map((k) => [k, on])), cleanOnPaste: true });
  return [
    base,
    all(true),
    all(false),
    { ...all(true), linkRemovals: ["example.com", "keep", "*.tracker.io"] },
  ];
}

test("the paste defaults agree", () => {
  assert.deepStrictEqual(rs.defaultPasteSettings(), ts.DEFAULT_PASTE_SETTINGS);
});

test("lone surrogates reach Rust as U+FFFD", () => {
  assert.equal(rs.cleanPastedText("a\ud800b", rs.defaultPasteSettings()).text, "a\ufffdb");
});

test("cleanPastedText agrees on the corpus under each settings variant", () => {
  const c = compare();
  const variants = settingsVariants();
  for (const input of CORPUS) {
    for (const [i, settings] of variants.entries()) {
      c.check(`cleanPastedText#${i}`, input, ts.cleanPastedText(input, settings), rs.cleanPastedText(input, settings));
    }
  }
  c.done();
});

test("cleanWrappedText and cleanPdfText agree on the corpus", () => {
  const c = compare();
  const wrapped: ts.WrappedTextOptions[] = [
    { rejoin: "any", bullets: "markdown", protectMath: false },
    { rejoin: "indented", bullets: "preserve" },
    { rejoin: "never", bullets: "markdown", mergeHyphens: true, collapseSpaces: true },
    { rejoin: "any", bullets: "preserve", mergeHyphens: true, collapseSpaces: true, minWrapWidth: 35, protectMath: true },
  ];
  const pdf = [false, true].flatMap((removePageNumbers) =>
    [false, true].map((singleParagraph) => ({ removePageNumbers, singleParagraph })),
  );
  for (const input of CORPUS) {
    for (const [i, options] of wrapped.entries()) {
      c.check(`cleanWrappedText#${i}`, input, ts.cleanWrappedText(input, options), rs.cleanWrappedText(input, options));
    }
    for (const [i, options] of pdf.entries()) {
      c.check(`cleanPdfText#${i}`, input, ts.cleanPdfText(input, options), rs.cleanPdfText(input, options));
    }
  }
  c.done();
});

test("commas, tables, URLs and link rules agree on the corpus", () => {
  const c = compare();
  const ruleSets = [[], ["example.com", "keep", "*.tracker.io", "utm_*"]];
  for (const input of CORPUS) {
    for (const placement of ["inside", "outside"] as const) {
      c.check(`applyCommaPlacement:${placement}`, input, ts.applyCommaPlacement(input, placement), rs.applyCommaPlacement(input, placement));
    }
    c.check("tabSeparatedToMarkdownTable", input, ts.tabSeparatedToMarkdownTable(input), rs.tabSeparatedToMarkdownTable(input));
    for (const [i, rules] of ruleSets.entries()) {
      c.check(`cleanUrls#${i}`, input, ts.cleanUrlsInText(input, ts.buildUrlCleanupOptions(rules)), rs.cleanUrlsWithRules(input, rules));
    }
    c.check("parseLinkRemovalText", input, ts.parseLinkRemovalText(input), rs.parseLinkRemovalText(input));
  }
  c.done();
});

test("pasteLandsInVerbatimContext agrees at every UTF-16 offset", () => {
  const c = compare();
  for (const input of CORPUS.filter((s) => s.length <= 300)) {
    for (let offset = 0; offset <= input.length; offset += 1) {
      c.check(`pasteLandsInVerbatimContext@${offset}`, input, ts.pasteLandsInVerbatimContext(input, offset), rs.pasteLandsInVerbatimContext(input, offset));
    }
  }
  c.done();
});

test("normalizePasteSettings agrees on stored values of any shape", () => {
  const c = compare();
  const base = ts.DEFAULT_PASTE_SETTINGS;
  const stored: unknown[] = [
    undefined,
    null,
    0,
    "text",
    [],
    [true],
    {},
    base,
    { ...base, cleanOnPaste: "yes" },
    { ...base, linkRemovals: "a.com" },
    { ...base, linkRemovals: [" a.com ", "", 3, null, "b.org"] },
    { ...base, linkRemovals: Array.from({ length: 600 }, (_, i) => `r${i}.com`) },
    { cleanOnPaste: false, unknownField: 1 },
    { ...base, trimWhitespace: null, straightenQuotes: 1 },
  ];
  for (const value of stored) {
    c.check("normalizePasteSettings", value, ts.normalizePasteSettings(value), rs.normalizePasteSettings(value));
  }
  c.done();
});
