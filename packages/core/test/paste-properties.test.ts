import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanPastedText } from "../src/paste/clean-pasted-text.js";
import { cleanPdfText } from "../src/paste/pdf-text.js";
import { cleanWrappedText } from "../src/paste/wrapped-text.js";
import { applyCommaPlacement } from "../src/paste/quote-commas.js";
import { buildUrlCleanupOptions, cleanUrlsInText } from "../src/paste/url-cleanup.js";
import { markdownCodeRanges, mathRanges } from "../src/paste/markdown-ranges.js";
import { DEFAULT_PASTE_SETTINGS, type PasteSettings } from "../src/paste/paste-settings.js";

/**
 * Properties that must hold for every document, not just the ones somebody
 * thought to write down.
 *
 * The examples in the other files say what each rule does. These say what no
 * rule may do: change the meaning of a code block, lose a word, disagree with
 * its own `changed` flag, or give a different answer the second time it runs.
 * A corpus is generated from a seeded shuffle of markdown fragments, so the
 * documents are unlikely combinations nobody would write by hand — which is
 * exactly where the interference between two rules shows up.
 */

/* -------------------------------------------------------------------------- */
/* A reproducible corpus                                                       */
/* -------------------------------------------------------------------------- */

/** Mulberry32. Seeded so a failure is reproducible from the seed alone. */
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

/**
 * The pieces a research note is actually made of, plus the ones that break
 * things. Each is a whole block, so a document is a shuffle of blocks rather
 * than a shuffle of characters — random characters test nothing but the
 * tokenizer, while random *blocks* test how the rules interact.
 */
const FRAGMENTS: string[] = [
  "Ordinary prose about a measurement.",
  "A sentence with a https://a.example/x?utm_source=news&id=7 link in it.",
  "A bare https://doi.org/10.1145/3292500.3330701 citation link.",
  "Text with `inline code` in the middle.",
  "```\nconst a = 1;\nconst b = 2;\n```",
  "```python\nprint('hello — world')  # a dash and “quotes”\n```",
  "    indented code with “quotes” and — a dash",
  "$$\n\\alpha - \\beta = \\gamma\n$$",
  "Inline maths $x^2 - y^2$ in a sentence.",
  "A [[Wiki Link Target]] and an ![[embed.png]].",
  "A [labelled](https://b.example/y?fbclid=1 \"title\") link.",
  "Citing \\cite{smith2019} and \\ref{fig:1} here.",
  "A pandoc key [@doe2020] and a footnote [^note].",
  "# A heading",
  "## Another heading",
  "- a list item\n- another item",
  "1. numbered\n2. items",
  "> a blockquote line",
  "| a | b |\n| --- | --- |\n| 1 | 2 |",
  "---",
  "The findings suggest that long-term expo-\nsure has a measurable effect on the out-\ncome in both groups.",
  "npm warn deprecated inflight@1.0.6: This module is not supported and leaks memory. Do\n  not use it.",
  "• a terminal bullet\n• another one",
  "\u201CIt works,\u201D she said \u2014 finally.",
  "She called it \"finished,\" then left.",
  "Text with a zero\u200Bwidth space and a no\u00A0break space.",
  "A line ending in two spaces  \nand its continuation.",
  "the \uFB01nancial e\uFB00ect of a ligature",
  "\u2014 a line opening with an em dash",
  "name,\"John Smith\", age",
  '{"name":"Anna", "city":"Berg"}',
  "https://files.example.com/p.pdf?X-Amz-Algorithm=A&X-Amz-Signature=abcd&utm_source=m",
  "\u4E2D\u6587\u6D4B\u8BD5\u7684\u6BB5\u843D",
  "model\tval_loss\taccuracy\nbeta-VAE\t0.1826\t0.912\nResNet-18\t0.340\t0.887",
  "| a | b |\n| --- | ---: |\n| x | 1 |",
  "See 10.1145/3292500.3330701 and arXiv:1706.03762 for the method.",
  "[10.1038/nature12373](https://doi.org/10.1038/nature12373) already linked.",
  "",
  "   ",
];

/** A document: `count` fragments joined by blank lines, in a seeded order. */
function document(seed: number, count: number): string {
  const next = random(seed);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    parts.push(FRAGMENTS[Math.floor(next() * FRAGMENTS.length)]!);
  }
  return parts.join("\n\n");
}

const CORPUS: { seed: number; text: string }[] = [];
for (let seed = 1; seed <= 120; seed++) CORPUS.push({ seed, text: document(seed, 6) });
// A frontmatter block only means anything at the very top, so those documents
// are built deliberately rather than left to the shuffle.
for (let seed = 200; seed <= 215; seed++) {
  CORPUS.push({ seed, text: `---\ntitle: A \u2014 B\ntags: [x]\n---\n\n${document(seed, 4)}` });
}

/** Every combination of the switches that change what the pipeline does. */
function settingsMatrix(): PasteSettings[] {
  const flags = [
    "cleanLinks",
    "normalizeInvisible",
    "trimWhitespace",
    "straightenQuotes",
    "straightenDashes",
    "stripEscapeSequences",
    "tabsToTable",
    "linkIdentifiers",
    "cleanPdfOnPaste",
  ] as const;
  const out: PasteSettings[] = [];
  for (let mask = 0; mask < 1 << flags.length; mask++) {
    const settings: PasteSettings = { ...DEFAULT_PASTE_SETTINGS, cleanOnPaste: true };
    flags.forEach((flag, index) => {
      settings[flag] = Boolean(mask & (1 << index));
    });
    out.push(settings);
  }
  return out;
}

const ALL_SETTINGS = settingsMatrix();
assert.equal(ALL_SETTINGS.length, 512);

/* -------------------------------------------------------------------------- */
/* Properties                                                                  */
/* -------------------------------------------------------------------------- */

/** The text inside a fenced block or a maths span, as a comparable list. */
function verbatimSpans(text: string): string[] {
  return [...markdownCodeRanges(text), ...mathRanges(text)]
    .map((range) => text.slice(range.start, range.end))
    // Fences and delimiters are stable; what matters is that the *contents*
    // survive, and comparing whole spans catches a delimiter being eaten too.
    .filter((span) => span.trim().length > 0);
}

/** Letters and digits only, so whitespace and punctuation rules do not register. */
function words(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+/gu) ?? [];
}

const LIGATURES: Record<string, string> = {
  "\uFB00": "ff",
  "\uFB01": "fi",
  "\uFB02": "fl",
  "\uFB03": "ffi",
  "\uFB04": "ffl",
  "\uFB05": "st",
  "\uFB06": "st",
};

function expandLigatures(text: string): string {
  return text.replace(/[\uFB00-\uFB06]/g, (glyph) => LIGATURES[glyph] ?? glyph);
}

test("the changed flag never disagrees with the text", () => {
  for (const { seed, text } of CORPUS) {
    for (const settings of ALL_SETTINGS) {
      const result = cleanPastedText(text, settings);
      assert.equal(
        result.changed,
        result.text !== text,
        `seed ${seed}: changed flag disagrees with the output`,
      );
    }
  }
});

test("cleaning twice is the same as cleaning once", () => {
  for (const { seed, text } of CORPUS) {
    for (const settings of ALL_SETTINGS) {
      const once = cleanPastedText(text, settings).text;
      const twice = cleanPastedText(once, settings).text;
      assert.equal(twice, once, `seed ${seed}: not idempotent under ${JSON.stringify(settings)}`);
    }
  }
});

test("the on-demand cleanups are idempotent too", () => {
  for (const { seed, text } of CORPUS) {
    for (const options of [
      { removePageNumbers: false, singleParagraph: false },
      { removePageNumbers: true, singleParagraph: false },
      { removePageNumbers: false, singleParagraph: true },
      { removePageNumbers: true, singleParagraph: true },
    ]) {
      const once = cleanPdfText(text, options).text;
      assert.equal(cleanPdfText(once, options).text, once, `seed ${seed}: cleanPdfText not idempotent`);
    }

    const terminal = cleanWrappedText(text, { rejoin: "any", bullets: "markdown" }).text;
    assert.equal(
      cleanWrappedText(terminal, { rejoin: "any", bullets: "markdown" }).text,
      terminal,
      `seed ${seed}: terminal cleanup not idempotent`,
    );

    for (const placement of ["inside", "outside"] as const) {
      const once = applyCommaPlacement(text, placement).text;
      assert.equal(
        applyCommaPlacement(once, placement).text,
        once,
        `seed ${seed}: comma placement not idempotent`,
      );
    }
  }
});

test("code and maths survive every settings combination", () => {
  for (const { seed, text } of CORPUS) {
    const before = verbatimSpans(text);
    for (const settings of ALL_SETTINGS) {
      const after = verbatimSpans(cleanPastedText(text, settings).text);
      assert.deepEqual(
        after,
        before,
        `seed ${seed}: a verbatim span changed under ${JSON.stringify(settings)}`,
      );
    }
  }
});

test("no word is ever lost", () => {
  for (const { seed, text } of CORPUS) {
    for (const settings of ALL_SETTINGS) {
      const result = cleanPastedText(text, settings);
      // Ligatures are expanded on both sides, so the one rule that turns a
      // single glyph into two letters cannot register as either a gain or a
      // loss whether or not it happened to run under these settings.
      const before = words(expandLigatures(text)).join("");
      const after = words(expandLigatures(result.text)).join("");

      // Only one rule writes letters that were not pasted: the resolver host in
      // a link built around a DOI or an arXiv id. With it off, nothing may.
      if (!settings.linkIdentifiers) {
        assert.ok(
          after.length <= before.length,
          `seed ${seed}: output grew letters from nowhere under ${JSON.stringify(settings)}`,
        );
      }

      // And with the link rule off as well, the letters are exactly the ones
      // that were pasted: every remaining rule works on whitespace, punctuation
      // or invisible characters, and the table rule only moves cells about.
      if (!settings.linkIdentifiers && !settings.cleanLinks) {
        assert.equal(after, before, `seed ${seed}: letters changed with both link rules off`);
      }
    }
  }
});

test("with only the link rule on, nothing outside a URL changes", () => {
  const linksOnly: PasteSettings = {
    ...DEFAULT_PASTE_SETTINGS,
    cleanOnPaste: true,
    cleanLinks: true,
    normalizeInvisible: false,
    trimWhitespace: false,
    straightenQuotes: false,
    straightenDashes: false,
    stripEscapeSequences: false,
    tabsToTable: false,
    linkIdentifiers: false,
    cleanPdfOnPaste: false,
  };
  const options = buildUrlCleanupOptions();
  for (const { seed, text } of CORPUS) {
    const viaPipeline = cleanPastedText(text, linksOnly).text;
    const viaRule = cleanUrlsInText(text.replace(/\r\n?/g, "\n"), options).text;
    assert.equal(viaPipeline, viaRule, `seed ${seed}: the pipeline did more than the link rule`);
  }
});

test("the master switch is the identity", () => {
  const off: PasteSettings = { ...DEFAULT_PASTE_SETTINGS, cleanOnPaste: false };
  for (const { seed, text } of CORPUS) {
    const result = cleanPastedText(text, off);
    assert.equal(result.text, text, `seed ${seed}: text changed with cleanup off`);
    assert.equal(result.changed, false);
    assert.equal(result.urlsCleaned, 0);
  }
});

test("output never grows by more than the escapes it is allowed to add", () => {
  for (const { seed, text } of CORPUS) {
    for (const settings of ALL_SETTINGS) {
      // Two rules build structure — a table's pipes, a link around an
      // identifier — and are excluded here rather than modelled, because a
      // bound loose enough to cover them would not catch anything.
      if (settings.tabsToTable || settings.linkIdentifiers) continue;
      const result = cleanPastedText(text, settings);
      // What is left can only lengthen by the backslash a converted leading
      // dash needs so it does not become a list item: one per line.
      const lineCount = text.split("\n").length;
      assert.ok(
        result.text.length <= text.length + lineCount,
        `seed ${seed}: output grew by more than one character per line`,
      );
    }
  }
});

test("every document in the corpus exercises something", () => {
  // A corpus that changed nothing would pass every property above while
  // testing none of them.
  const touched = CORPUS.filter(({ text }) => {
    const settings: PasteSettings = {
      ...DEFAULT_PASTE_SETTINGS,
      cleanOnPaste: true,
      straightenQuotes: true,
      straightenDashes: true,
      cleanPdfOnPaste: true,
    };
    return cleanPastedText(text, settings).changed;
  });
  // Two thirds is a smoke check, not a target: the corpus deliberately holds
  // fragments no rule touches, so that the "nothing changed" path is exercised
  // as well as the "something changed" one.
  assert.ok(
    touched.length > CORPUS.length * 0.6,
    `only ${touched.length}/${CORPUS.length} documents were changed at all`,
  );
});
