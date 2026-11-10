/**
 * PostgREST table specs (Rust `postgrest_spec`): which table, columns, project scope, order and
 * filters a generic repository uses.
 */
import {
  postgrestKeyedColumnSpec as rawPostgrestKeyedColumnSpec,
  postgrestRowSpec as rawPostgrestRowSpec,
} from "../pkg/wf_wasm.js";
import type { KeyedColumnSpec, RowSpec } from "./bindings.js";

export type { KeyedColumnSpec, OrderSpec, RowSpec } from "./bindings.js";

/** The row spec named `name`, or `null` when there is none. */
export function postgrestRowSpec(name: string): RowSpec | null {
  return (rawPostgrestRowSpec(name) as RowSpec | null) ?? null;
}

/** The keyed-column spec named `name`, or `null` when there is none. */
export function postgrestKeyedColumnSpec(name: string): KeyedColumnSpec | null {
  return (rawPostgrestKeyedColumnSpec(name) as KeyedColumnSpec | null) ?? null;
}
