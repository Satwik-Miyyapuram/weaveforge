/**
 * Every TS function that has a Rust replacement in flight. Add a case in the
 * PR that ports the function; delete it in the PR that deletes the TS copy.
 */
import { readFileSync } from "node:fs";
import { coreInfo } from "../src/index.js";
import type { ParityCase } from "./harness.js";

/** The TS side of coreInfo: the workspace version, read from Cargo.toml. */
function tsCoreInfo(): { version: string } {
  const cargo = readFileSync(new URL("../../../Cargo.toml", import.meta.url), "utf8");
  const version = cargo.match(/^version = "([^"]+)"/m)?.[1];
  if (!version) throw new Error("Cargo.toml has no workspace version");
  return { version };
}

export const CASES: ParityCase[] = [{ name: "core-info", ts: tsCoreInfo, rust: () => coreInfo() }];
