#!/usr/bin/env node
/** One-off: inspect why space-epoch consolidation didn't run for a project. */
const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PID = process.argv[2] || "95a7f201-7dc5-4fd4-a5ee-783ba0480e55";
if (!url || !key) { console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY"); process.exit(1); }

async function rest(path, query = "") {
  const res = await fetch(`${url}/rest/v1/${path}?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

async function main() {
  console.log("project:", PID, "\n");

  const keyEpochs = await rest("key_epochs", `scope_id=eq.${PID}&select=scope,epoch,reason,rekey_state`);
  console.log("key_epochs rows:");
  for (const r of keyEpochs) console.log(" ", JSON.stringify(r));
  if (keyEpochs.length === 0) console.log("  (none)");

  const pks = await rest("project_keys", `project_id=eq.${PID}&select=id,epoch&order=epoch.asc`);
  console.log(`\nproject_keys epochs: ${pks.map((p) => p.epoch).join(",")}  (latest=${Math.max(...pks.map((p) => p.epoch))})`);

  const ms = await rest("milestones", `project_id=eq.${PID}&select=id,enc_epoch,content_enc`);
  console.log("\nmilestones:");
  for (const m of ms) {
    const encPrefix = typeof m.content_enc === "string" ? m.content_enc.slice(0, 4) : String(m.content_enc);
    console.log(`  ${m.id}  enc_epoch=${m.enc_epoch}  content=${encPrefix}`);
  }

  // owner wraps per epoch
  const wraps = await rest("project_key_wraps", `project_id=eq.${PID}&select=epoch,recipient_id,scope`);
  const byEpoch = new Map();
  for (const w of wraps) {
    if (!byEpoch.has(w.epoch)) byEpoch.set(w.epoch, []);
    byEpoch.get(w.epoch).push(`${w.scope}:${w.recipient_id.slice(0, 8)}`);
  }
  console.log("\nproject_key_wraps by epoch:");
  for (const [ep, list] of [...byEpoch.entries()].sort((a, b) => a[0] - b[0])) {
    console.log(`  epoch ${ep}: ${list.join(", ")}`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
