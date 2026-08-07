#!/usr/bin/env node
/**
 * Space-key epoch audit (epoch-recovery plan Phase 0).
 *
 * Usage:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/audit-space-epochs.mjs
 */

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function rest(path, query = "") {
  const res = await fetch(`${url}/rest/v1/${path}?${query}`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

function parseEncEpoch(contentEnc, encEpoch) {
  if (typeof encEpoch === "number" && Number.isFinite(encEpoch)) return encEpoch;
  if (typeof contentEnc !== "string" || !contentEnc.startsWith("TTE1")) return null;
  try {
    const headerB64 = contentEnc.slice(4).split(".")[0];
    const headerJson = Buffer.from(headerB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
      "utf8",
    );
    const header = JSON.parse(headerJson);
    return typeof header.epoch === "number" ? header.epoch : null;
  } catch {
    return null;
  }
}

async function main() {
  const projectKeys = await rest("project_keys", "select=project_id,epoch");
  const milestones = await rest(
    "milestones",
    "select=project_id,content_enc,enc_epoch",
  );

  const epochsByProject = new Map();
  for (const row of projectKeys) {
    const pid = row.project_id;
    if (!epochsByProject.has(pid)) epochsByProject.set(pid, new Set());
    epochsByProject.get(pid).add(row.epoch);
  }

  const milestoneStats = new Map();
  for (const row of milestones) {
    const pid = row.project_id;
    if (!milestoneStats.has(pid)) {
      milestoneStats.set(pid, { total: 0, offLatest: 0 });
    }
    const stat = milestoneStats.get(pid);
    stat.total++;
    const maxEpoch = epochsByProject.has(pid)
      ? Math.max(...epochsByProject.get(pid))
      : null;
    const epoch = parseEncEpoch(row.content_enc, row.enc_epoch);
    if (maxEpoch != null && epoch != null && epoch !== maxEpoch) {
      stat.offLatest++;
    }
  }

  const projectIds = new Set([...epochsByProject.keys(), ...milestoneStats.keys()]);
  const rows = [...projectIds].sort().map((projectId) => {
    const epochs = epochsByProject.get(projectId) ?? new Set();
    const ms = milestoneStats.get(projectId) ?? { total: 0, offLatest: 0 };
    return {
      projectId,
      epochs: epochs.size,
      maxEpoch: epochs.size ? Math.max(...epochs) : 0,
      milestonesTotal: ms.total,
      milestonesOffLatest: ms.offLatest,
    };
  });

  console.log("projectId,epochs,maxEpoch,milestonesTotal,milestonesOffLatest");
  let offLatestSum = 0;
  for (const row of rows) {
    offLatestSum += row.milestonesOffLatest;
    console.log(
      `${row.projectId},${row.epochs},${row.maxEpoch},${row.milestonesTotal},${row.milestonesOffLatest}`,
    );
  }

  console.log(`\nTotal milestones off latest epoch: ${offLatestSum}`);
  if (offLatestSum === 0) {
    console.log("Phase 2/3 consolidation not required — only hardening (Phase 1) needed.");
  } else {
    console.log("Run space-epoch consolidation after deploying Phase 1.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
