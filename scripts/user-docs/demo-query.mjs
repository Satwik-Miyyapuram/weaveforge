// One local query the way the desktop shell runs it (apps/shell/src/local_pg):
// in its own transaction, as `authenticated`, with the local user's claims.
// Shared by demo-db.ts (Node, seeding) and demo-bridge.js (browser, the docs'
// demo app), so both see rows in the shell's shape.

function iso(text, zone) {
  if (text === "infinity" || text === "-infinity") return null;
  const d = new Date(text.replace(" ", "T").replace(/([+-]\d\d)$/, "$1:00") + zone);
  return Number.isNaN(d.getTime()) ? text : d.toISOString();
}

/** PGlite parsers matching apps/shell/src/local_pg/value.rs: times as ISO text, dates as text. */
export const DEMO_PARSERS = {
  1184: (text) => iso(text, ""),
  1114: (text) => iso(text, "Z"),
  1082: (text) => text,
};

export function localQuery(db, claims, sql, params = []) {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('request.jwt.claims', $1, true), set_config('role', 'authenticated', true)", [claims]);
    return (await tx.query(sql, params)).rows;
  });
}
