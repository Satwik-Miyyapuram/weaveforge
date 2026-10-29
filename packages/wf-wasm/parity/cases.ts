/**
 * Every TS function that has a Rust replacement in flight. Add a case in the
 * PR that ports the function; delete it in the PR that deletes the TS copy.
 */
import { readFileSync } from "node:fs";
import { processTerm, tokenize as tsTokenize } from "@weaveforge/core";
import { coreInfo, indexTerms, tokenize, type TokenizerOptions } from "../src/index.js";
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

export const CASES: ParityCase[] = [
  { name: "core-info", ts: tsCoreInfo, rust: () => coreInfo() },
  tokenizeCase as ParityCase,
  indexTermsCase as ParityCase,
];
