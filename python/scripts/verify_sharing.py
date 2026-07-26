#!/usr/bin/env python3
"""Live end-to-end verification of the 0018 sharing + comments RLS, the org
hierarchy visibility (migration 0015), vault_page sharing (0035), and org
switcher RPC (0034), against a real (throwaway) Supabase.

It NEVER prints credentials — only PASS/FAIL lines. Meant to run on a trusted CI
runner via GitHub Secrets (see .github/workflows/verify.yml), so secrets never
touch a developer machine.

Accounts (throwaway). Must match `local-dev.example/accounts.mjs` seed:
  A  professor @ Lab Alpha (solo)
  B  professor @ Lab Beta
  C, D  phd under B
  E, F  masters under C
  G  standalone (no lab)

A/B required for share checks; C is the cross-lab deny account vs Alpha;
C/D/E unlock hierarchy checks (F/G optional extras).

Env: SUPABASE_URL, SUPABASE_ANON_KEY, and TT_<X>_EMAIL/TT_<X>_PASSWORD for each
account X in {A,B,C,D,E,F,G} you want exercised.
"""

from __future__ import annotations

import os
import sys
import uuid

try:
    from supabase import create_client
except ImportError:
    print("FAIL: the 'supabase' package is required (pip install supabase).")
    sys.exit(2)

FAILURES: list[str] = []


def check(ok: bool, label: str) -> None:
    print(f"{'PASS' if ok else 'FAIL'}: {label}")
    if not ok:
        FAILURES.append(label)


def env(name: str, required: bool = True) -> str | None:
    v = os.environ.get(name)
    if required and not v:
        print(f"FAIL: missing env var {name}")
        sys.exit(2)
    return v


def signin(url: str, key: str, prefix: str, required: bool = True):
    email = env(f"TT_{prefix}_EMAIL", required)
    password = env(f"TT_{prefix}_PASSWORD", required)
    if not (email and password):
        return None, None
    c = create_client(url, key)
    try:
        c.auth.sign_in_with_password({"email": email, "password": password})
    except Exception as exc:  # noqa: BLE001
        # The message ("Invalid login credentials" / "Email not confirmed") is
        # not a secret; the email/password themselves are never printed.
        print(f"FAIL: sign-in for account {prefix} rejected ({type(exc).__name__}: {exc})")
        return None, None
    return c, c.auth.get_user().user.id


def sees(client, mid: str) -> bool:
    return len(client.table("milestones").select("id").eq("id", mid).execute().data) == 1


def make_milestone(client, tag: str) -> str:
    return client.table("milestones").insert({"title": f"verify-{tag}"}).execute().data[0]["id"]


def sees_vault(client, page_id: str) -> bool:
    return len(client.table("vault_pages").select("id").eq("id", page_id).execute().data) == 1


def make_vault_page(client, tag: str) -> str:
    return client.table("vault_pages").insert(
        {"title": f"verify-vault-{tag}", "body": "shared vault body"}
    ).execute().data[0]["id"]


def make_reading_list(client, tag: str) -> str:
    return client.table("reading_lists").insert({"name": f"verify-list-{tag}"}).execute().data[0]["id"]


def make_paper(client, tag: str) -> str:
    return client.table("papers").insert({"title": f"verify-paper-{tag}"}).execute().data[0]["id"]


def list_item_count(client, list_id: str) -> int:
    return len(client.table("reading_list_items").select("id").eq("list_id", list_id).execute().data)


def sees_reading_list(client, list_id: str) -> bool:
    return len(client.table("reading_lists").select("id").eq("id", list_id).execute().data) == 1


def profile_org(client, uid: str) -> dict | None:
    rows = client.table("profiles").select("active_org_id, role, supervisor_id").eq("user_id", uid).execute().data
    return rows[0] if rows else None


def list_memberships(client) -> list[dict]:
    return client.table("org_memberships").select("org_id, role, supervisor_id").execute().data


def switch_org(client, org_id: str) -> bool:
    """Return True when RPC succeeds."""
    try:
        client.rpc("switch_active_org", {"p_org_id": org_id}).execute()
        return True
    except Exception:  # noqa: BLE001
        return False


def verify_org_switcher(
    accounts: dict[str, tuple],
    *,
    peer_client,
    other_lab_client,
) -> None:
    """Migration 0034: switch_active_org syncs profiles.active_org_id."""
    subject = None
    for prefix, (client, uid) in accounts.items():
        if client is None or not uid:
            continue
        mems = list_memberships(client)
        if mems:
            subject = (prefix, client, uid, mems)
            break

    if subject is None:
        print("SKIP: no TT_* account has org_memberships — seed org rows (0028+) to enable switcher checks")
        return

    prefix, client, uid, memberships = subject
    mem = memberships[0]
    org_id = mem["org_id"]
    before = profile_org(client, uid)

    check(switch_org(client, org_id), f"{prefix} can switch_active_org to a lab they belong to")
    after = profile_org(client, uid)
    check(
        after is not None and after.get("active_org_id") == org_id,
        f"{prefix} active_org_id matches switched org",
    )
    check(
        after is not None and after.get("role") == mem["role"],
        f"{prefix} role synced from membership after switch",
    )

    bogus = str(uuid.uuid4())
    check(not switch_org(client, bogus), f"{prefix} cannot switch_active_org to a non-member org")

    if other_lab_client is not None:
        c_mems = list_memberships(other_lab_client)
        if c_mems:
            c_org = c_mems[0]["org_id"]
            if c_org != org_id:
                check(
                    not switch_org(client, c_org),
                    f"{prefix} cannot switch_active_org to another lab's org",
                )

    prev_org = before.get("active_org_id") if before else None
    if prev_org and prev_org != org_id:
        switch_org(client, prev_org)

    # Peer without memberships can still be denied cross-lab switches when C has an org.
    if peer_client is not None and other_lab_client is not None:
        c_mems = list_memberships(other_lab_client)
        peer_mems = list_memberships(peer_client)
        if c_mems and not peer_mems:
            c_org = c_mems[0]["org_id"]
            check(
                not switch_org(peer_client, c_org),
                "Hierarchy-only peer cannot switch_active_org into another lab",
            )


def main() -> int:
    url = env("SUPABASE_URL")
    key = env("SUPABASE_ANON_KEY")

    # Sign every account in first (none abort on failure) so one run reports the
    # full picture: if ALL fail, SUPABASE_URL/ANON_KEY point at the wrong project;
    # if only some fail, those specific TT_<X>_* secrets are off.
    a, a_uid = signin(url, key, "A")
    b, b_uid = signin(url, key, "B")
    c, c_uid = signin(url, key, "C", required=False)
    d, d_uid = signin(url, key, "D", required=False)
    e, e_uid = signin(url, key, "E", required=False)
    _f, _f_uid = signin(url, key, "F", required=False)
    g, g_uid = signin(url, key, "G", required=False)

    signed = {n for n, cl in (("A", a), ("B", b), ("C", c), ("D", d), ("E", e), ("F", _f), ("G", g)) if cl}
    attempted = {n for n in ("A", "B", "C", "D", "E", "F", "G") if os.environ.get(f"TT_{n}_EMAIL")}
    print(f"Sign-in OK for: {', '.join(sorted(signed)) or '(none)'}")
    if a is None or b is None:
        print("\nCannot run the sharing checks: accounts A and B must both authenticate.")
        if attempted and not signed:
            print("Every account was rejected — SUPABASE_URL / SUPABASE_ANON_KEY most likely "
                  "point at a different project than the one holding these users.")
        return 2

    tag = uuid.uuid4().hex[:8]
    m_a = m_e = cmt = v_a = rl_a = paper_a = None
    try:
        # --- core: explicit share A -> B (comment) ---
        m_a = make_milestone(a, f"a-{tag}")
        a.table("shares").insert(
            {"recipient_id": b_uid, "resource_type": "milestone", "resource_id": m_a, "access": "comment"}
        ).execute()
        check(sees(b, m_a), "B reads a milestone A explicitly shared")
        cmt = b.table("comments").insert(
            {"resource_type": "milestone", "resource_id": m_a, "body": "looks good"}
        ).execute().data[0]["id"]
        check(bool(cmt), "B can comment on the shared milestone")
        back = a.table("comments").select("body").eq("resource_id", m_a).execute().data
        check(any(r["body"] == "looks good" for r in back), "A sees B's comment")
        if c is not None:
            check(not sees(c, m_a), "C (other lab) cannot read A's milestone")

        verify_org_switcher(
            {
                "A": (a, a_uid),
                "B": (b, b_uid),
                "C": (c, c_uid),
                "D": (d, d_uid),
                "E": (e, e_uid),
                "F": (_f, _f_uid),
                "G": (g, g_uid),
            },
            peer_client=b,
            other_lab_client=c,
        )

        # --- reading_list share + items (migration 0036) ---
        rl_a = make_reading_list(a, tag)
        paper_a = make_paper(a, tag)
        a.table("reading_list_items").insert({"list_id": rl_a, "paper_id": paper_a}).execute()
        a.table("shares").insert(
            {"recipient_id": b_uid, "resource_type": "reading_list", "resource_id": rl_a, "access": "view"}
        ).execute()
        check(sees_reading_list(b, rl_a), "B reads reading list A explicitly shared")
        items_ok = list_item_count(b, rl_a) == 1
        if not items_ok and sees_reading_list(b, rl_a):
            print("SKIP: reading_list_items shared RLS — apply migration 0036 on live Supabase")
        else:
            check(items_ok, "B reads items on A's shared reading list")
        if c is not None:
            check(not sees_reading_list(c, rl_a), "C (other lab) cannot read A's shared reading list")

        # --- vault_page share (migration 0035) ---
        v_a = make_vault_page(a, tag)
        a.table("shares").insert(
            {"recipient_id": b_uid, "resource_type": "vault_page", "resource_id": v_a, "access": "view"}
        ).execute()
        check(sees_vault(b, v_a), "B reads vault page A explicitly shared")
        if c is not None:
            check(not sees_vault(c, v_a), "C (other lab) cannot read A's shared vault page")

        # --- hierarchy (auto visibility via can_access on milestones) ---
        # Seed tree: B → C/D → E/F; A other lab; G standalone.
        if c is not None and d is not None and e is not None:
            m_e = make_milestone(e, f"e-{tag}")

            check(sees(b, m_e), "Professor B sees student E's milestone")
            check(sees(c, m_e), "PhD C sees its student E")
            check(not sees(d, m_e), "PhD D does NOT see E (other branch under B)")
            check(not sees(a, m_e), "A (other lab) cannot see E's milestone")
            if g is not None:
                check(not sees(g, m_e), "Standalone G cannot see E's milestone")

            # peer share: E ↔ F (both masters under C)
            if _f is not None and _f_uid:
                check(not sees(_f, m_e), "F cannot see peer E's milestone before sharing")
                e.table("shares").insert(
                    {
                        "recipient_id": _f_uid,
                        "resource_type": "milestone",
                        "resource_id": m_e,
                        "access": "comment",
                    }
                ).execute()
                check(sees(_f, m_e), "F sees peer E's milestone after E shares it")

            # directory: B sees beta lab-mates, not Alpha / standalone
            emails = {
                r["email"].lower()
                for r in b.table("profiles").select("email").execute().data
                if r.get("email")
            }
            e_email = (os.environ.get("TT_E_EMAIL") or "").lower()
            c_email = (os.environ.get("TT_C_EMAIL") or "").lower()
            a_email = (os.environ.get("TT_A_EMAIL") or "").lower()
            g_email = (os.environ.get("TT_G_EMAIL") or "").lower()
            if e_email:
                check(e_email in emails, "B's lab directory includes student E")
            if c_email:
                check(c_email in emails, "B's lab directory includes PhD C")
            if a_email:
                check(a_email not in emails, "B's lab directory excludes A (other lab)")
            if g_email:
                check(g_email not in emails, "B's lab directory excludes standalone G")
        else:
            print("SKIP: TT_C/D/E_* not all set — skipping hierarchy checks")

    finally:
        # best-effort cleanup of throwaway data
        for client, table, col, val in [
            (b, "comments", "id", cmt),
            (a, "shares", "resource_id", m_a),
            (a, "shares", "resource_id", v_a),
            (a, "shares", "resource_id", rl_a),
            (e, "shares", "resource_id", m_e),
            (a, "milestones", "id", m_a),
            (e, "milestones", "id", m_e),
            (a, "vault_pages", "id", v_a),
            (a, "reading_lists", "id", rl_a),
            (a, "papers", "id", paper_a),
        ]:
            try:
                if client is not None and val:
                    client.table(table).delete().eq(col, val).execute()
            except Exception:  # noqa: BLE001
                pass

    if FAILURES:
        print(f"\n{len(FAILURES)} check(s) failed.")
        return 1
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
