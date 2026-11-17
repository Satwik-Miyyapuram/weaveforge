import assert from "node:assert/strict";
import { test } from "node:test";

import { planDeploy } from "../../user-docs/deploy.mjs";

const ENV = { DEPLOY_HOST: "oci.example.test", DEPLOY_USER: "ubuntu", DEPLOY_PATH: "/home/ubuntu/weaveforge-infra" };

test("planDeploy syncs both builds into the compose directory", () => {
  const plan = planDeploy(ENV, []);
  assert.deepEqual(plan.map((step) => step.dest), [
    "ubuntu@oci.example.test:/home/ubuntu/weaveforge-infra/docs-site/",
    "ubuntu@oci.example.test:/home/ubuntu/weaveforge-infra/demo-site/",
  ]);
  assert.deepEqual(plan.map((step) => step.src), ["docs/.site/", "docs/.site-demo/"]);
});

test("planDeploy refuses to run without a host, user or path", () => {
  for (const key of ["DEPLOY_HOST", "DEPLOY_USER", "DEPLOY_PATH"]) {
    const env = { ...ENV, [key]: "" };
    assert.throws(() => planDeploy(env, []), new RegExp(key));
  }
});

test("planDeploy never deletes outside the two site directories", () => {
  for (const step of planDeploy(ENV, [])) {
    assert.match(step.dest, /\/(docs-site|demo-site)\/$/);
    assert.doesNotMatch(step.dest, /\.\./);
  }
});

test("planDeploy uses the given SSH key path without reading it", () => {
  const plan = planDeploy({ ...ENV, DEPLOY_SSH_KEY: "/run/secrets/deploy_key" }, []);
  assert.ok(plan.every((step) => step.ssh.includes("/run/secrets/deploy_key")));
});
