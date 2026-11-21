/**
 * The tier-0 gates `scripts/preflight.mjs` runs: lint, typecheck, each
 * `npm run check:*` named in `check:boundaries` (as its own gate, so one
 * failure does not hide the next), and cargo fmt.
 */
export function preflightGates(scripts) {
  const boundaries = (scripts["check:boundaries"] ?? "")
    .split("&&")
    .map((part) => part.trim().match(/^npm run (\S+)$/)?.[1])
    .filter(Boolean);
  return [
    { name: "lint", cmd: "npm run lint --silent" },
    { name: "typecheck", cmd: "npm run typecheck --silent" },
    ...boundaries.map((name) => ({ name, cmd: `npm run ${name} --silent` })),
    { name: "cargo fmt", cmd: "cargo fmt --all -- --check" },
  ];
}
