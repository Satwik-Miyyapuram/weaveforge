#!/usr/bin/env node
/**
 * Copies the built help site and demo to the OCI host, where the compose
 * stack mounts them read-only at /srv/docs and /srv/demo (infra/oci/docker-compose.yml).
 *
 *   DEPLOY_HOST, DEPLOY_USER, DEPLOY_PATH   required; DEPLOY_PATH is the compose directory
 *   DEPLOY_SSH_KEY                          optional path to a private key file
 *   DEPLOY_KNOWN_HOSTS                      optional path to a known_hosts file
 *
 *   node scripts/user-docs/deploy.mjs --dry-run   print the rsync commands only
 *   node scripts/user-docs/deploy.mjs             run them
 *
 * Only the two site directories are written, and --delete is scoped to them.
 * Nothing here runs ssh by itself; the manual GitHub workflow does, with
 * secrets from the `docs-hosting` environment.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const REQUIRED = ["DEPLOY_HOST", "DEPLOY_USER", "DEPLOY_PATH"];

/**
 * @returns {{ src: string, dest: string, ssh: string, args: string[] }[]}
 */
export function planDeploy(env, argv) {
  for (const key of REQUIRED) {
    if (!env[key]?.trim()) throw new Error(`${key} is not set`);
  }
  const base = `${env.DEPLOY_USER}@${env.DEPLOY_HOST}:${env.DEPLOY_PATH.replace(/\/+$/, "")}`;
  const opts = ["-o StrictHostKeyChecking=yes", "-o BatchMode=yes"];
  if (env.DEPLOY_KNOWN_HOSTS) opts.push(`-o UserKnownHostsFile=${env.DEPLOY_KNOWN_HOSTS}`);
  if (env.DEPLOY_SSH_KEY) opts.unshift(`-i ${env.DEPLOY_SSH_KEY}`);
  const ssh = ["ssh", ...opts].join(" ");
  return [
    { src: "docs/.site/", dest: `${base}/docs-site/` },
    { src: "docs/.site-demo/", dest: `${base}/demo-site/` },
  ].map(({ src, dest }) => ({ src, dest, ssh, args: ["-az", "--delete", "-e", ssh, src, dest] }));
}

function main(argv) {
  const plan = planDeploy(process.env, argv);
  for (const step of plan) {
    console.log(`rsync ${step.args.join(" ")}`);
    if (argv.includes("--dry-run")) continue;
    const result = spawnSync("rsync", step.args, { stdio: "inherit" });
    if (result.status !== 0) process.exit(result.status ?? 1);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
