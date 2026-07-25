#!/usr/bin/env node
/**
 * Seed a–g@example.com test accounts. Password: local-dev/test-accounts.env (gitignored).
 *
 *   node scripts/seed-test-users.mjs
 */

import { createClient } from "@supabase/supabase-js";
import { ACCOUNTS, LABS } from "./accounts.mjs";
import { requireSupabaseAdmin, requireTestPassword } from "./_load-env.mjs";

const PASSWORD = requireTestPassword();
const { url, key } = requireSupabaseAdmin();
const admin = createClient(url, key, { auth: { persistSession: false } });

async function findUserByEmail(email) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
}

async function ensureUser({ email, fullName, role, supervisor, lab }) {
  let user = await findUserByEmail(email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });
    if (error) throw new Error(`${email}: ${error.message}`);
    user = data.user;
    console.log(`Created ${email}`);
  } else {
    await admin.auth.admin.updateUserById(user.id, { password: PASSWORD });
    console.log(`Exists ${email} (password reset)`);
  }

  const supervisorId = supervisor ? (await findUserByEmail(supervisor))?.id ?? null : null;

  const { error: profileErr } = await admin.from("profiles").upsert({
    user_id: user.id,
    email,
    full_name: fullName,
    role,
    supervisor_id: supervisorId,
    org_setup_complete: true,
    active_org_id: null,
  });
  if (profileErr) throw new Error(`${email} profile: ${profileErr.message}`);
  return user.id;
}

async function upsertMembership(row) {
  let payload = { ...row };
  let { error } = await admin.from("org_memberships").upsert(payload, { onConflict: "org_id,user_id" });
  if (error?.message?.includes("joined_via")) {
    const { joined_via: _drop, ...legacy } = payload;
    ({ error } = await admin.from("org_memberships").upsert(legacy, { onConflict: "org_id,user_id" }));
    if (!error) {
      console.warn("  (joined_via column missing — run supabase db push through 0063)");
    }
  }
  if (error) throw error;
}

async function ensureLab(labKey, memberIds) {
  const spec = LABS[labKey];
  const ownerId = memberIds[spec.owner];
  if (!ownerId) throw new Error(`Missing owner ${spec.owner} for ${labKey}`);

  const { data: existing } = await admin
    .from("organizations")
    .select("id")
    .eq("owner_id", ownerId)
    .maybeSingle();

  let orgId = existing?.id;
  if (!orgId) {
    const { data, error } = await admin
      .from("organizations")
      .insert({ name: spec.name, owner_id: ownerId })
      .select("id")
      .single();
    if (error) throw error;
    orgId = data.id;
    console.log(`Created org ${spec.name}`);
  } else {
    await admin.from("organizations").update({ name: spec.name }).eq("id", orgId);
  }

  const labAccounts = ACCOUNTS.filter((a) => a.lab === labKey);
  for (const acct of labAccounts) {
    const userId = memberIds[acct.email];
    const orgRole = acct.role;
    const supervisorId = acct.supervisor ? memberIds[acct.supervisor] ?? null : null;
    const joinedVia = acct.email === spec.owner ? "create" : "invite";

    await upsertMembership({
      org_id: orgId,
      user_id: userId,
      role: orgRole,
      supervisor_id: supervisorId,
      joined_via: joinedVia,
    });

    await admin
      .from("profiles")
      .update({
        role: orgRole,
        supervisor_id: supervisorId,
        active_org_id: orgId,
        org_setup_complete: true,
      })
      .eq("user_id", userId);
  }

  return orgId;
}

async function ensureStandalone(email, userId) {
  await admin.from("org_memberships").delete().eq("user_id", userId);
  const { error } = await admin
    .from("profiles")
    .update({
      role: "standalone",
      supervisor_id: null,
      active_org_id: null,
      org_setup_complete: true,
    })
    .eq("user_id", userId);
  if (error) throw error;
  console.log(`${email} — standalone (no lab)`);
}

async function main() {
  const ids = {};
  for (const acct of ACCOUNTS) {
    ids[acct.email] = await ensureUser(acct);
  }

  await ensureLab("alpha", ids);
  await ensureLab("beta", ids);
  await ensureStandalone("g@example.com", ids["g@example.com"]);

  console.log("\nDone. Password is in local-dev/test-accounts.env (not committed).");
  console.log("  Lab Alpha (a only):     a@example.com");
  console.log("  Lab Beta  (B,C,D,E,F):  b@example.com … f@example.com");
  console.log("  Standalone (no lab):    g@example.com");
  console.log("\nPopulate demo content:  npm run seed:showcase");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
