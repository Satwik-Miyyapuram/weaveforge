import type { SupabaseClient } from "@supabase/supabase-js";
import { ProjectRepository } from "@/backend/providers/postgrest/project-scoped-repository";
import { deleteRowById, rowById, rows, run } from "@/backend/providers/postgrest/row-access";
import type { ProjectContext } from "@/lib/project-context";
import { readyCore } from "@/lib/rust-core";

/*
 * Generic PostgREST repositories driven by Rust specs (`crates/wf-core/src/postgrest_spec.rs`).
 * Rust names the table, columns, project scope, order and filters; this file runs them.
 * Specs are looked up when a method runs, not at construction, so the core need not be loaded yet.
 */

type Core = ReturnType<typeof readyCore>;
export type RowSpec = NonNullable<ReturnType<Core["postgrestRowSpec"]>>;
export type KeyedColumnSpec = NonNullable<ReturnType<Core["postgrestKeyedColumnSpec"]>>;

/** The row spec named `name`. Throws when Rust has none, since that is a code error. */
export function requireRowSpec(name: string): RowSpec {
  const spec = readyCore().postgrestRowSpec(name);
  if (!spec) throw new Error(`No PostgREST row spec named ${name}`);
  return spec;
}

function requireKeyedColumnSpec(name: string): KeyedColumnSpec {
  const spec = readyCore().postgrestKeyedColumnSpec(name);
  if (!spec) throw new Error(`No PostgREST keyed-column spec named ${name}`);
  return spec;
}

/** Converts between a stored row and the domain entity, for what Rust does not own. */
export interface RowMapper<D, R> {
  toDomain(row: R): D;
  toRow(entity: D): Record<string, unknown>;
}

/**
 * A table of rows read and written by id. `F` is the list filter type; only the keys the spec
 * names as `eqFilters` are applied, so any other filter field is ignored, as the repositories it
 * replaces ignored it.
 */
export class SpecRepository<D, R, F extends object = object> extends ProjectRepository {
  constructor(
    db: SupabaseClient,
    ctx: ProjectContext,
    private readonly specName: string,
    private readonly mapper: RowMapper<D, R>,
  ) {
    super(db, ctx);
  }

  async getById(id: string): Promise<D | null> {
    const spec = requireRowSpec(this.specName);
    const row = await rowById<R>(this.db, spec.table, id);
    return row ? this.mapper.toDomain(row) : null;
  }

  async list(filter?: F): Promise<D[]> {
    const spec = requireRowSpec(this.specName);
    const pid = this.pid;
    if (spec.projectScoped && !pid) return [];
    let q = this.db.from(spec.table).select(spec.columns);
    if (spec.projectScoped && pid) q = q.eq("project_id", pid);
    const values = (filter ?? {}) as unknown as Record<string, unknown>;
    for (const key of spec.eqFilters) {
      const value = values[key];
      if (value) q = q.eq(key, value as string);
    }
    if (spec.order) {
      q = q.order(spec.order.column, { ascending: spec.order.ascending, nullsFirst: spec.order.nullsFirst });
    }
    return (await rows<R>(q)).map((row) => this.mapper.toDomain(row));
  }

  async save(entity: D): Promise<void> {
    const spec = requireRowSpec(this.specName);
    const row = this.mapper.toRow(entity);
    const pid = this.pid;
    if (spec.projectScoped && pid) row.project_id = pid;
    await run(this.db.from(spec.table).upsert(row));
  }

  async delete(id: string): Promise<void> {
    await deleteRowById(this.db, requireRowSpec(this.specName).table, id);
  }
}

/**
 * One JSON column of a row keyed by id, read as a parsed value and written whole. `parse` turns
 * the stored JSON into the domain value, or `null` when Rust rejects it.
 */
export class KeyedColumnRepository<T> {
  constructor(
    private readonly db: SupabaseClient,
    private readonly specName: string,
    private readonly parse: (raw: unknown) => T | null,
  ) {}

  async get(projectId: string): Promise<T | null> {
    const { table, column } = requireKeyedColumnSpec(this.specName);
    const row = await rowById<Record<string, unknown>>(this.db, table, projectId, column);
    const raw = row?.[column];
    if (!raw) return null;
    return this.parse(raw);
  }

  async save(projectId: string, value: T): Promise<void> {
    const { table, column } = requireKeyedColumnSpec(this.specName);
    await run(this.db.from(table).update({ [column]: value }).eq("id", projectId));
  }
}
