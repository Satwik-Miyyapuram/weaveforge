/**
 * Every function the Rust port replaced. The fixtures are frozen goldens from the
 * deleted TS; core-info alone still has a live reference.
 */
import { readFileSync } from "node:fs";
import { buildExcerpt, coreInfo, fuseRankings, indexTerms, parseQuery, tokenize, type TokenizerOptions } from "../src/index.js";
import type { ParityCase } from "./harness.js";

/** Input of the tokenizer cases: every text runs under one options object. */
interface TextsInput {
  texts: string[];
  options: TokenizerOptions;
}

/** The live reference for coreInfo: the workspace version, read from Cargo.toml. */
function tsCoreInfo(): { version: string } {
  const cargo = readFileSync(new URL("../../../Cargo.toml", import.meta.url), "utf8");
  const version = cargo.match(/^version = "([^"]+)"/m)?.[1];
  if (!version) throw new Error("Cargo.toml has no workspace version");
  return { version };
}

const tokenizeCase: ParityCase<TextsInput, string[][]> = {
  name: "tokenize",
  rust: ({ texts, options }) => texts.map((t) => tokenize(t, options)),
};

const indexTermsCase: ParityCase<TextsInput, string[][]> = {
  name: "index-terms",
  rust: ({ texts, options }) => texts.map((t) => indexTerms(t, options)),
};

/**
 * The goldens predate `modifiedWithinDays`, so the Rust side drops it when null.
 * The fixtures hold only the old grammar (no `type:`, `in:`, `modified:`), so a
 * non-null value is a meaning change and fails the comparison.
 */
function rustParse(query: string): unknown {
  const { modifiedWithinDays, ...rest } = parseQuery(query);
  return modifiedWithinDays === null ? rest : { ...rest, modifiedWithinDays };
}

const parseQueryCase: ParityCase<{ queries: string[] }, unknown[]> = {
  name: "parse-query",
  rust: ({ queries }) => queries.map(rustParse),
};

/** One fusion call: lists of ids, plus the options the call passes. */
interface FusionRun {
  lists: { items: string[]; weight?: number }[];
  k?: number;
  limit?: number;
}

/** The ids are lowercase ASCII letters, so code point tie order matches the goldens. */
const fuseRankingsCase: ParityCase<{ runs: FusionRun[] }, string[][]> = {
  name: "fuse-rankings",
  rust: ({ runs }) => runs.map(({ lists, k, limit }) => fuseRankings(lists, (id) => id, { k, limit })),
};

/** One excerpt call; `options` holds only the keys the call passes. */
interface ExcerptRun {
  body: string;
  terms: string[];
  options: { maxChars?: number; singleLine?: boolean };
}

/**
 * Golden texts can hold a lone surrogate half where the window splits a pair; the
 * Rust side returns UTF-16 units, so the half survives and compares.
 */
const excerptCase: ParityCase<{ runs: ExcerptRun[] }, unknown[]> = {
  name: "excerpt",
  rust: ({ runs }) => runs.map(({ body, terms, options }) => buildExcerpt(body, terms, options)),
};

export const CASES: ParityCase[] = [
  { name: "core-info", reference: tsCoreInfo, rust: () => coreInfo() },
  tokenizeCase as ParityCase,
  indexTermsCase as ParityCase,
  parseQueryCase as ParityCase,
  fuseRankingsCase as ParityCase,
  excerptCase as ParityCase,
];
