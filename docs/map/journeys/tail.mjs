// The storage tail every repository call shares: cache → Rust repository → wasm → core → PostgREST.
const RR = "apps/web/src/backend/providers/postgrest/rust-repository.ts";
const WIRE = "apps/web/src/backend/providers/postgrest/wire-postgrest-backend.ts";
export { WIRE };

/**
 * Hops n.. for one repository call. `cache` is the cache hop ({ fn, path, sym }),
 * `table` the core module (e.g. "papers"), `method` and `sym` the core function.
 */
export function repoTail(n, by, { cache, table, method, sym }) {
  const rs = `crates/wf-core/src/repos/${table}.rs`;
  return [
    { n, by, layer: "storage", fn: cache.fn, path: cache.path, sym: cache.sym, note: "read cache in front of the repository" },
    { n: n + 1, by: n, layer: "bridge", fn: "rustRepository → repoStep", path: RR, sym: "readyCore().repoStep(" },
    { n: n + 2, by: n + 1, layer: "bridge", fn: "repoStep (wasm)", path: "crates/wf-wasm/src/repo_step.rs", sym: "pub fn repo_step_js(" },
    { n: n + 3, by: n + 2, layer: "core", fn: `repos::${table}::step`, path: rs, sym: "pub fn step(method: &str, call: &RepoCall)" },
    { n: n + 4, by: n + 3, layer: "core", fn: `${table}::${method}`, path: rs, sym },
    { n: n + 5, by: n + 4, layer: "network", fn: "PostgREST → OCI Postgres", path: "infra/oci/docker-compose.yml", sym: "container_name: weaveforge-postgrest", note: `table ${table}, api.weaveforge.org` },
  ];
}
