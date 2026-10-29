import test from "node:test";
import assert from "node:assert/strict";
import { overleafGitUrl, parseOverleafProjectId } from "../domain/link-rules";

const ID = "64f0c0ffee0123456789abcd";

test("a pasted id, project page or git URL gives the project id", () => {
  for (const raw of [
    ID,
    `  ${ID}  `,
    `https://www.overleaf.com/project/${ID}`,
    `https://overleaf.com/project/${ID}/`,
    `https://www.overleaf.com/project/${ID}?tab=1#x`,
    `https://git.overleaf.com/${ID}`,
  ]) {
    assert.equal(parseOverleafProjectId(raw), ID, raw);
  }
});

test("anything else is refused, so nothing pasted reaches a clone URL", () => {
  for (const raw of [
    "",
    "has space",
    "../etc",
    `http://www.overleaf.com/project/${ID}`,
    `https://evil.example/project/${ID}`,
    `https://overleaf.com.evil.example/project/${ID}`,
    `https://git:tok@git.overleaf.com/${ID}`,
    `https://www.overleaf.com/project/${ID}/settings`,
    `https://www.overleaf.com/read/${ID}`,
    `https://git.overleaf.com/a/b`,
    `https://git.overleaf.com/`,
  ]) {
    assert.equal(parseOverleafProjectId(raw), null, raw);
  }
  assert.equal(overleafGitUrl(ID), `https://git.overleaf.com/${ID}`);
});
