/**
 * Server-only invite code generation (Node crypto). Import via `@weaveforge/core/org-crypto`
 * — not re-exported from the main package entry (browser-safe).
 */

import { createHash, randomBytes } from "node:crypto";
import { formatInviteCode, normalizeOrgInviteCode } from "./invite-code.js";

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function generateOrgInviteCode(): string {
  const bytes = randomBytes(10);
  let value = 0n;
  for (const b of bytes) value = (value << 8n) | BigInt(b);
  let raw = "";
  for (let i = 0; i < 15; i++) {
    raw = CROCKFORD[Number(value & 31n)] + raw;
    value >>= 5n;
  }
  return formatInviteCode(raw.slice(0, 9));
}

export function hashOrgInviteCode(normalized: string): string {
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function hashOrgInviteCodeInput(input: string): string {
  return hashOrgInviteCode(normalizeOrgInviteCode(input));
}
