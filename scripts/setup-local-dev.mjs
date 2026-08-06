#!/usr/bin/env node
/**
 * Copy local-dev.example → local-dev (gitignored) for local test accounts.
 */

import { cpSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXAMPLE = resolve(REPO, "local-dev.example");
const LOCAL = resolve(REPO, "local-dev");

if (!existsSync(EXAMPLE)) {
  console.error("local-dev.example/ not found");
  process.exit(1);
}

if (existsSync(LOCAL)) {
  console.log("local-dev/ already exists — leaving it unchanged.");
} else {
  cpSync(EXAMPLE, LOCAL, { recursive: true });
  console.log("Created local-dev/ from local-dev.example/");
}

const envFile = resolve(LOCAL, "test-accounts.env");
const envExample = resolve(LOCAL, "test-accounts.env.example");
if (!existsSync(envFile) && existsSync(envExample)) {
  cpSync(envExample, envFile);
  console.log("Created local-dev/test-accounts.env — set TEST_ACCOUNT_PASSWORD before seeding.");
} else if (existsSync(envFile)) {
  console.log("local-dev/test-accounts.env already present.");
}

console.log("\nNext:");
console.log("  1. Edit local-dev/test-accounts.env");
console.log("  2. node scripts/seed-test-users.mjs");
