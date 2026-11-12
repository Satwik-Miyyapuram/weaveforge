import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import type { LatexSectionTreeResult, LatexSourceFile } from "@weaveforge/core";
import { readyCore } from "@/lib/rust-core";

export interface OverleafReadResult {
  projectId: string;
  entryFile: string;
  files: LatexSourceFile[];
  sectionTree: LatexSectionTreeResult;
  overleafUrl: string;
}

/** Exported for tests. */
export async function collectTextFiles(root: string): Promise<LatexSourceFile[]> {
  const core = readyCore();
  const result: LatexSourceFile[] = [];
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      core.assertOverleafFileCount(result.length);
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(full); continue; }
      // A clone can hold symlinks; following one reads a file outside it.
      if (!entry.isFile()) continue;
      if (!core.isOverleafTextSource(entry.name)) continue;
      const stat = await fs.stat(full);
      core.assertOverleafTextSize(stat.size, totalBytes);
      // path.relative gives OS separators; the Rust guard takes "/" paths only.
      const relative = path.relative(root, full).split(path.sep).join("/");
      core.assertSafeCheckoutPath(relative);
      const content = await fs.readFile(full, "utf8");
      result.push({ path: relative, content });
      totalBytes += stat.size;
    }
  };
  await visit(root);
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

/** Clone one Overleaf project into an ephemeral server directory and discard it. */
export async function readOverleafProject(
  projectId: string,
  entryFile: string,
  token: string,
): Promise<OverleafReadResult> {
  if (!readyCore().isOverleafProjectId(projectId)) throw new Error("Overleaf project id is invalid.");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "weaveforge-overleaf-"));
  try {
    await git.clone({
      fs,
      http,
      dir: root,
      url: `https://git.overleaf.com/${projectId}`,
      onAuth: () => ({ username: "git", password: token }),
      singleBranch: true,
      depth: 1,
    });
    const files = await collectTextFiles(root);
    const normalizedEntry = entryFile.replaceAll("\\", "/").replace(/^\.\//, "");
    if (!files.some((file) => file.path === normalizedEntry)) throw new Error(`Entry file not found: ${normalizedEntry}`);
    return {
      projectId,
      entryFile: normalizedEntry,
      files,
      sectionTree: readyCore().parseLatexSectionTree(files, normalizedEntry),
      overleafUrl: `https://www.overleaf.com/project/${projectId}`,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
