import { LOCAL_USER_ID } from "@weaveforge/core";

import { decodeBytea } from "@/lib/bytea";

/**
 * A PostgREST-shaped client over the local database.
 *
 * Every repository in this app talks to `db.from(table)` and stops there: a
 * short, measured slice of supabase-js — filters, ordering, `single()`, and
 * `upsert(..., { onConflict })` — with no embedded joins anywhere. That is
 * small enough to compile to SQL, and compiling it is what lets the whole app
 * run with no account and no server: the same thirty repositories, the same
 * queries, pointed at PGlite in the desktop shell instead of at PostgREST.
 *
 * The alternative was a second implementation of every repository. This is one
 * file instead, and it fails loudly on anything it was not built for rather
 * than quietly returning the wrong rows.
 *
 * Errors are returned, never thrown, because that is how PostgREST answers and
 * every caller above is written for it.
 */

export type LocalQuery = (sql: string, params: unknown[]) => Promise<unknown[]>;

export interface PostgrestError {
  message: string;
  code?: string;
}

/** The SQLSTATE a database error carries, when it carries one. */
function postgresCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}

/**
 * A PGlite failure, shaped the way PostgREST shapes one.
 *
 * `code` is the load-bearing part. Callers branch on it — a permission refusal
 * is `42501`, a missing function `PGRST202`, a unique violation `23505` — and
 * dropping it meant the same failure arrived differently depending on which
 * provider was running. That is how a SQLSTATE mapping written against PostgREST
 * quietly became a `throw` on the local backend: the mapping found no code, fell
 * through to `throw`, and the caller saw a raw message instead of a refusal.
 *
 * One function for both paths, because there were two — `execute` for the query
 * builder and `rpc` for functions — and they had drifted: neither passed the code
 * on, and only one of them was wrong about anything else.
 */
function toPostgrestError(error: unknown): PostgrestError {
  return {
    message: error instanceof Error ? error.message : String(error),
    code: postgresCode(error),
  };
}

interface Reply<T> {
  data: T;
  error: PostgrestError | null;
  count?: number | null;
}

type Row = Record<string, unknown>;

const NOT_FOUND = "PGRST116";

/** Only these operators reach SQL. An unknown one is a bug, not a fallback. */
const OPERATORS: Record<string, string> = {
  eq: "=",
  neq: "<>",
  gt: ">",
  gte: ">=",
  lt: "<",
  lte: "<=",
  like: "like",
  ilike: "ilike",
};

/** Column and table names are never parameters, so they are checked instead. */
function ident(name: string): string {
  const trimmed = name.trim();
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed)) {
    throw new Error(`Not a column name the local database will accept: ${name}`);
  }
  return `"${trimmed}"`;
}

/** `"id, title"` and `"*"` both mean a projection; nothing here has joins. */
function projection(columns: string): string {
  const trimmed = columns.trim();
  if (trimmed === "" || trimmed === "*") return "*";
  return trimmed
    .split(",")
    .map((c) => (c.trim() === "*" ? "*" : ident(c)))
    .join(", ");
}

const BYTEA_HEX = /^\\x(?:[0-9a-fA-F]{2})*$/;

/**
 * The `text[]` columns in the schema. Every other column that takes an array
 * is `jsonb`, and the two want different spellings: `{"a","b"}` for the one,
 * `["a","b"]` for the other. A value cannot tell them apart — `[]` written to
 * `papers.authors` was "malformed array literal" and no paper could be added
 * — so the array columns are named here, from the migrations.
 */
export const ARRAY_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  papers: ["authors", "tags"],
  reader_annotations: ["tags"],
  citation_alert_tracks: ["seen_citing_ids"],
  api_tokens: ["scopes"],
};

/**
 * The `jsonb` columns that hold scalars as well as objects. A string or
 * number written as itself reads as a bare token, not JSON — a select field
 * set to `core` was "invalid input syntax for type json" — so values bound
 * for these columns always travel as JSON text.
 */
export const JSON_COLUMNS: Readonly<Record<string, readonly string[]>> = {
  paper_field_values: ["value"],
};

/** A Postgres array literal, each element quoted with `"` and `\` escaped. */
export function pgArray(values: readonly unknown[]): string {
  return `{${values.map((v) => `"${String(v).replace(/(["\\])/g, "\\$1")}"`).join(",")}}`;
}

/**
 * A value bound to a function argument.
 *
 * PostgREST takes a JSON array for an array-typed parameter — that is how
 * `record_blob_access_many` is called with its `p_paths text[]` — but Postgres
 * is what parses it here, and `["a"]` is not an array literal, so every call
 * with an array argument failed with "malformed array literal". That affected
 * `latest_metric_activity` and also `record_blob_access_many`, on the local
 * backend only, where nothing had exercised it.
 *
 * The element type is the only signal available — `encode` learns a column's
 * type from the table it is writing to, and an argument has no table. A `uuid[]`,
 * `text[]` or `int[]` holds scalars and wants the literal form; an array of
 * objects can only be destined for a `jsonb` parameter
 * (`create_organization_atomic`'s `p_codes`), which wants JSON.
 */
function encodeArgument(value: unknown): string | number | boolean | Uint8Array | null {
  if (Array.isArray(value) && value.every((item) => item === null || typeof item !== "object")) {
    return pgArray(value);
  }
  return encode(value);
}

/**
 * A value on its way into a statement.
 *
 * The bridge carries only primitives, so anything structured travels as JSON
 * text and is coerced by the column it lands in — an unknown-typed parameter
 * takes the target's type, which is exactly what a `jsonb` column wants.
 */
function encode(
  value: unknown,
  column?: { table: string; name: string },
): string | number | boolean | Uint8Array | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value) && column && ARRAY_COLUMNS[column.table]?.includes(column.name)) {
    return pgArray(value);
  }
  if (column && JSON_COLUMNS[column.table]?.includes(column.name)) return JSON.stringify(value);
  if (value instanceof Date) return value.toISOString();
  // PostgREST takes bytea as `\x`-hex text, which is how every repository
  // writes it (`encodeBytea`). PGlite types each parameter from the column it
  // lands in and wants bytes, not their spelling, for a bytea one — the CRDT
  // log's every append failed with "Invalid input for bytea type" — so the
  // spelling is turned back into bytes here. A text column holding a string
  // that is `\x` and hex digits and nothing else would be misread, and no
  // column holds one.
  if (typeof value === "string" && BYTEA_HEX.test(value)) return decodeBytea(value);
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "bigint") return Number(value);
  return value as string | number | boolean;
}

class Builder<T> implements PromiseLike<Reply<T>> {
  private readonly wheres: string[] = [];
  private readonly params: unknown[] = [];
  private readonly orders: string[] = [];
  private limitTo: number | null = null;
  private offsetTo = 0;
  private columns = "*";
  private returning = false;
  private rowMode: "many" | "one" | "maybe" = "many";
  private counting = false;
  private headOnly = false;
  private mutation:
    | { verb: "insert" | "upsert" | "update" | "delete"; rows?: Row[]; patch?: Row; onConflict?: string }
    | null = null;

  constructor(
    private readonly table: string,
    private readonly run: LocalQuery,
  ) {}

  private hold(value: unknown, column?: string): string {
    this.params.push(encode(value, column ? { table: this.table, name: column } : undefined));
    return `$${this.params.length}`;
  }

  // — reads —

  select(columns = "*", options?: { count?: "exact" | "planned" | "estimated"; head?: boolean }): this {
    this.columns = columns;
    this.returning = true;
    if (options?.count) this.counting = true;
    if (options?.head) this.headOnly = true;
    return this;
  }

  // — filters —

  eq(column: string, value: unknown): this {
    return this.filter(column, "eq", value);
  }
  neq(column: string, value: unknown): this {
    return this.filter(column, "neq", value);
  }
  gt(column: string, value: unknown): this {
    return this.filter(column, "gt", value);
  }
  gte(column: string, value: unknown): this {
    return this.filter(column, "gte", value);
  }
  lt(column: string, value: unknown): this {
    return this.filter(column, "lt", value);
  }
  lte(column: string, value: unknown): this {
    return this.filter(column, "lte", value);
  }
  ilike(column: string, pattern: string): this {
    return this.filter(column, "ilike", pattern);
  }

  is(column: string, value: null | boolean): this {
    this.wheres.push(`${ident(column)} is ${value === null ? "null" : String(value)}`);
    return this;
  }

  in(column: string, values: readonly unknown[]): this {
    // An empty set is a legitimate ask — "none of these" — and `in ()` is a
    // syntax error, so it becomes a predicate that is simply false.
    if (values.length === 0) {
      this.wheres.push("false");
      return this;
    }
    this.wheres.push(`${ident(column)} in (${values.map((v) => this.hold(v)).join(", ")})`);
    return this;
  }

  not(column: string, operator: string, value: unknown): this {
    if (operator === "is") {
      this.wheres.push(`${ident(column)} is not ${value === null ? "null" : String(value)}`);
      return this;
    }
    const sql = OPERATORS[operator];
    if (!sql) throw new Error(`The local database has no "${operator}" filter.`);
    this.wheres.push(`not (${ident(column)} ${sql} ${this.hold(value)})`);
    return this;
  }

  filter(column: string, operator: string, value: unknown): this {
    if (operator === "is") return this.is(column, value as null | boolean);
    if (operator === "in") {
      const inner = typeof value === "string" ? value.replace(/^\(|\)$/g, "").split(",") : (value as unknown[]);
      return this.in(column, inner);
    }
    const sql = OPERATORS[operator];
    if (!sql) throw new Error(`The local database has no "${operator}" filter.`);
    this.wheres.push(`${ident(column)} ${sql} ${this.hold(value)}`);
    return this;
  }

  /** PostgREST's `"a.eq.1,b.is.null"`, which the app uses for two-sided lookups. */
  or(expression: string): this {
    const parts = expression.split(",").map((clause) => {
      const [column = "", operator = "", ...rest] = clause.split(".");
      const raw = rest.join(".");
      if (operator === "is") return `${ident(column)} is ${raw === "null" ? "null" : raw}`;
      const sql = OPERATORS[operator];
      if (!sql) throw new Error(`The local database has no "${operator}" filter.`);
      return `${ident(column)} ${sql} ${this.hold(raw)}`;
    });
    this.wheres.push(`(${parts.join(" or ")})`);
    return this;
  }

  order(column: string, options?: { ascending?: boolean; nullsFirst?: boolean }): this {
    const direction = options?.ascending === false ? "desc" : "asc";
    const nulls =
      options?.nullsFirst === undefined ? "" : options.nullsFirst ? " nulls first" : " nulls last";
    this.orders.push(`${ident(column)} ${direction}${nulls}`);
    return this;
  }

  limit(count: number): this {
    this.limitTo = count;
    return this;
  }

  /**
   * PostgREST's `Range: from-to`, inclusive at both ends.
   *
   * Paging is how a caller reads a table larger than one response, so a client
   * that speaks the protocol needs it: the metric history adapter pages with
   * this, and without it every read of a long curve failed with "range is not a
   * function" on the local backend only.
   */
  range(from: number, to: number): this {
    this.limitTo = Math.max(0, to - from + 1);
    this.offsetTo = Math.max(0, from);
    return this;
  }

  single(): this {
    this.rowMode = "one";
    return this;
  }

  maybeSingle(): this {
    this.rowMode = "maybe";
    return this;
  }

  // — writes —

  insert(rows: Row | Row[]): this {
    this.mutation = { verb: "insert", rows: Array.isArray(rows) ? rows : [rows] };
    return this;
  }

  upsert(rows: Row | Row[], options?: { onConflict?: string }): this {
    this.mutation = {
      verb: "upsert",
      rows: Array.isArray(rows) ? rows : [rows],
      onConflict: options?.onConflict,
    };
    return this;
  }

  update(patch: Row): this {
    this.mutation = { verb: "update", patch };
    return this;
  }

  delete(): this {
    this.mutation = { verb: "delete" };
    return this;
  }

  // — running —

  private whereClause(): string {
    return this.wheres.length ? ` where ${this.wheres.join(" and ")}` : "";
  }

  private tail(): string {
    const order = this.orders.length ? ` order by ${this.orders.join(", ")}` : "";
    const limit = this.limitTo === null ? "" : ` limit ${Number(this.limitTo)}`;
    // `offset` without `limit` is legal in Postgres, so a bare `.range(5, …)`
    // still pages correctly.
    const offset = this.offsetTo ? ` offset ${Number(this.offsetTo)}` : "";
    return `${order}${limit}${offset}`;
  }

  /** The statement, built last so every filter has already booked its parameter. */
  compile(): string {
    const table = ident(this.table);
    const mutation = this.mutation;

    if (!mutation) {
      if (this.headOnly && this.counting) {
        return `select count(*)::int as count from ${table}${this.whereClause()}`;
      }
      return `select ${projection(this.columns)} from ${table}${this.whereClause()}${this.tail()}`;
    }

    if (mutation.verb === "delete") {
      return `delete from ${table}${this.whereClause()}${this.back()}`;
    }

    if (mutation.verb === "update") {
      // The filters booked their parameters as they were called, but `set`
      // comes first in the statement. Rather than build the whole thing twice,
      // the set values are pushed to the front and the filters renumbered.
      const entries = Object.entries(mutation.patch ?? {});
      if (!entries.length) throw new Error("An update with no columns would change nothing.");
      const shift = entries.length;
      for (let i = 0; i < this.wheres.length; i += 1) {
        this.wheres[i] = (this.wheres[i] as string).replace(/\$(\d+)/g, (_, d) => `$${Number(d) + shift}`);
      }
      this.params.unshift(...entries.map(([c, v]) => encode(v, { table: this.table, name: c })));
      const sets = entries.map(([c], i) => `${ident(c)} = $${i + 1}`);
      return `update ${table} set ${sets.join(", ")}${this.whereClause()}${this.back()}`;
    }

    const rows = mutation.rows ?? [];
    if (!rows.length) throw new Error("An insert with no rows would write nothing.");
    // One column list for the whole statement: PostgREST fills a gap with the
    // column's default, and so does a null here for the columns that have one.
    const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
    const values = rows
      .map((row) => `(${columns.map((c) => this.hold(row[c] ?? null, c)).join(", ")})`)
      .join(", ");
    const head = `insert into ${table} (${columns.map(ident).join(", ")}) values ${values}`;
    if (mutation.verb === "insert") return `${head}${this.back()}`;

    const keys = (mutation.onConflict ?? "id").split(",").map((c) => c.trim());
    const updates = columns.filter((c) => !keys.includes(c));
    const conflict = updates.length
      ? `on conflict (${keys.map(ident).join(", ")}) do update set ${updates
          .map((c) => `${ident(c)} = excluded.${ident(c)}`)
          .join(", ")}`
      : `on conflict (${keys.map(ident).join(", ")}) do nothing`;
    return `${head} ${conflict}${this.back()}`;
  }

  private back(): string {
    return this.returning ? ` returning ${projection(this.columns)}` : "";
  }

  async then<R1 = Reply<T>, R2 = never>(
    onFulfilled?: ((value: Reply<T>) => R1 | PromiseLike<R1>) | null,
    onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    try {
      const reply = await this.execute();
      return onFulfilled ? await onFulfilled(reply) : (reply as unknown as R1);
    } catch (error) {
      if (onRejected) return await onRejected(error);
      throw error;
    }
  }

  private async execute(): Promise<Reply<T>> {
    let rows: Row[];
    try {
      const sql = this.compile();
      rows = (await this.run(sql, this.params)) as Row[];
    } catch (error) {
      return { data: null as T, error: toPostgrestError(error) };
    }

    if (this.headOnly && this.counting) {
      return { data: null as T, error: null, count: Number((rows[0] as { count?: number })?.count ?? 0) };
    }
    if (this.rowMode === "many") {
      return {
        data: (this.returning ? rows : null) as T,
        error: null,
        count: this.counting ? rows.length : undefined,
      };
    }
    if (rows.length === 0) {
      if (this.rowMode === "maybe") return { data: null as T, error: null };
      return { data: null as T, error: { message: "No rows found", code: NOT_FOUND } };
    }
    return { data: rows[0] as T, error: null };
  }
}

/**
 * The client the backend wiring hands to every repository.
 *
 * Typed loosely on purpose: it is cast to `SupabaseClient` at the one place
 * that wires it, and pretending to implement that whole type here would be a
 * much larger lie than the cast is.
 */
export function createLocalClient(run: LocalQuery) {
  return {
    /**
     * The parts of the client that are not queries.
     *
     * A handful of screens reach for `db.auth` or `db.channel()` directly —
     * to attach a token to a request, or to join a co-editing room. There is
     * no session and no socket here, and both of those already have a
     * meaningful "not available" answer: no token, and a channel that never
     * delivers anything. Answering rather than being absent is what keeps a
     * screen rendering instead of throwing on a property read.
     */
    auth: {
      async getSession() {
        return { data: { session: null }, error: null };
      },
      async getUser() {
        return { data: { user: { id: LOCAL_USER_ID } }, error: null };
      },
      onAuthStateChange() {
        return { data: { subscription: { unsubscribe() {} } } };
      },
      async signOut() {
        return { error: null };
      },
    },
    /** A room with nobody in it: co-editing needs a server, and there is none. */
    channel() {
      const room = {
        on: () => room,
        subscribe: () => room,
        send: async () => "ok",
        unsubscribe: async () => "ok",
      };
      return room;
    },
    async removeChannel() {
      return "ok";
    },
    from(table: string) {
      return new Builder<unknown>(table, run);
    },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      const names = Object.keys(args);
      const call = names.map((n, i) => `${ident(n)} => $${i + 1}`).join(", ");
      try {
        const rows = (await run(
          `select * from ${ident(name)}(${call})`,
          names.map((n) => encodeArgument(args[n])),
        )) as Row[];
        // A function returning one scalar answers as PostgREST does: the value.
        const first = rows[0];
        const data = first && Object.keys(first).length === 1 ? Object.values(first)[0] : rows;
        return { data, error: null as PostgrestError | null };
      } catch (error) {
        return { data: null, error: toPostgrestError(error) };
      }
    },
  };
}
