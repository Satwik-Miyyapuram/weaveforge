/**
 * Every TS function that has a Rust replacement in flight. Add a case in the
 * PR that ports the function; delete it in the PR that deletes the TS copy.
 */
import { readFileSync } from "node:fs";
import { fuseRankings as tsFuseRankings, parseSearchQuery, processTerm, tokenize as tsTokenize } from "@weaveforge/core";
import { coreInfo, fuseRankings, indexTerms, parseQuery, tokenize, type TokenizerOptions } from "../src/index.js";
import type { ParityCase } from "./harness.js";

/** Input of the tokenizer cases: every text runs under one options object. */
interface TextsInput {
  texts: string[];
  options: TokenizerOptions;
}

/** The TS side of coreInfo: the workspace version, read from Cargo.toml. */
function tsCoreInfo(): { version: string } {
  const cargo = readFileSync(new URL("../../../Cargo.toml", import.meta.url), "utf8");
  const version = cargo.match(/^version = "([^"]+)"/m)?.[1];
  if (!version) throw new Error("Cargo.toml has no workspace version");
  return { version };
}

const tokenizeCase: ParityCase<TextsInput, string[][]> = {
  name: "tokenize",
  ts: ({ texts, options }) => texts.map((t) => tsTokenize(t, options)),
  rust: ({ texts, options }) => texts.map((t) => tokenize(t, options)),
};

/** TS has no indexTerms: MiniSearch runs tokenize, then processTerm on each. */
const indexTermsCase: ParityCase<TextsInput, string[][]> = {
  name: "index-terms",
  ts: ({ texts, options }) => texts.map((t) => tsTokenize(t, options).map((term) => processTerm(term, options))),
  rust: ({ texts, options }) => texts.map((t) => indexTerms(t, options)),
};

/**
 * TS has no `modifiedWithinDays`, so the Rust side drops it when null. The
 * fixtures hold only the grammar the TS knows (no `type:`, `in:`, `modified:`),
 * so a non-null value is a meaning change and fails the comparison.
 */
function rustParse(query: string): unknown {
  const { modifiedWithinDays, ...rest } = parseQuery(query);
  return modifiedWithinDays === null ? rest : { ...rest, modifiedWithinDays };
}

const parseQueryCase: ParityCase<{ queries: string[] }, unknown[]> = {
  name: "parse-query",
  ts: ({ queries }) => queries.map((q) => parseSearchQuery(q)),
  rust: ({ queries }) => queries.map(rustParse),
};

/** One fusion call: lists of ids, plus the options the call passes. */
interface FusionRun {
  lists: { items: string[]; weight?: number }[];
  k?: number;
  limit?: number;
}

/**
 * The ids are lowercase ASCII letters, where localeCompare and code point
 * order agree, so the Rust tie order (code point) matches the TS one.
 */
const fuseRankingsCase: ParityCase<{ runs: FusionRun[] }, string[][]> = {
  name: "fuse-rankings",
  ts: ({ runs }) => runs.map(({ lists, k, limit }) => tsFuseRankings(lists, (id) => id, { k, limit })),
  rust: ({ runs }) => runs.map(({ lists, k, limit }) => fuseRankings(lists, (id) => id, { k, limit })),
};

export const CASES: ParityCase[] = [
  { name: "core-info", ts: tsCoreInfo, rust: () => coreInfo() },
  tokenizeCase as ParityCase,
  indexTermsCase as ParityCase,
  parseQueryCase as ParityCase,
  fuseRankingsCase as ParityCase,
];
