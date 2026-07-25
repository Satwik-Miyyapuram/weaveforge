#!/usr/bin/env node
/**
 * Remove a–g@example.com test accounts and their labs.
 *
 *   node scripts/delete-test-users.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { TEST_EMAILS } from "./accounts.mjs";
import { requireSupabaseAdmin } from "./_load-env.mjs";

const { url, key } = requireSupabaseAdmin();
const admin = createClient(url, key, { auth: { persistSession: false } });

async function listAllUsers() {
  const users = [];
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 1000) break;
    page += 1;
  }
  return users;
}

async function purgeUser(userId, email) {
  const { error: rpcErr } = await admin.rpc("delete_user_account_data", { p_user_id: userId });
  if (rpcErr) throw new Error(`${email} purge RPC: ${rpcErr.message}`);

  const userTables = [
    "papers",
    "log_entries",
    "report_sections",
    "reading_lists",
    "paper_relations",
    "experiments",
    "milestones",
    "tags",
    "library_pins",
    "crdt_updates",
    "api_tokens",
    "user_keys",
    "share_links",
  ];
  for (const table of userTables) {
    await admin.from(table).delete().eq("user_id", userId);
  }
  await admin.from("library_pins").delete().eq("owner_id", userId);
  await admin.from("resource_key_wraps").delete().or(`recipient_id.eq.${userId},granter_id.eq.${userId}`);
  await admin.from("project_key_wraps").delete().or(`recipient_id.eq.${userId},granter_id.eq.${userId}`);

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    const detail = delErr.message || delErr.status || JSON.stringify(delErr);
    throw new Error(`${email} auth delete: ${detail}`);
  }
}

async function main() {
  const users = await listAllUsers();
  const targets = users.filter((u) => TEST_EMAILS.includes(u.email?.toLowerCase() ?? ""));

  if (targets.length === 0) {
    console.log("No a–g@example.com accounts found.");
    return;
  }

  const order = [...TEST_EMAILS].reverse();
  const sorted = order
    .map((email) => targets.find((u) => u.email?.toLowerCase() === email))
    .filter(Boolean);

  for (const user of sorted) {
    await purgeUser(user.id, user.email);
    console.log(`Deleted ${user.email}`);
  }

  console.log(`\nRemoved ${targets.length} test account(s). Run: node scripts/seed-test-users.mjs`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
