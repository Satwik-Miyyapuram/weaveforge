import * as fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import { parseLatexSectionTree, type LatexSourceFile } from "@thesis/core";

const MAX_FILES = 250;
const MAX_FILE_BYTES = 2_000_000;
const MAX_TOTAL_BYTES = 20_000_000;
const TEXT_EXTENSIONS = new Set([".tex", ".bib", ".sty", ".cls", ".txt", ".md", ".cfg"]);

export interface OverleafReadResult {
  projectId: string;
  entryFile: string;
  files: LatexSourceFile[];
  sectionTree: ReturnType<typeof parseLatexSectionTree>;
  overleafUrl: string;
}

function safeRelative(root: string, candidate: string): string {
  const relative = path.relative(root, candidate).replaceAll("\\", "/");
  if (!relative || relative.startsWith("../") || relative.includes("/../") || path.isAbsolute(relative)) {
    throw new Error("Overleaf checkout contained an unsafe path.");
  }
  return relative;
}

async function collectTextFiles(root: string): Promise<LatexSourceFile[]> {
  const result: LatexSourceFile[] = [];
  let totalBytes = 0;
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (result.length >= MAX_FILES) throw new Error("Overleaf project exceeds the supported file limit.");
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) { await visit(full); continue; }
      const ext = path.extname(entry.name).toLowerCase();
      if (!TEXT_EXTENSIONS.has(ext)) continue;
      const stat = await fs.stat(full);
      if (stat.size > MAX_FILE_BYTES || totalBytes + stat.size > MAX_TOTAL_BYTES) {
        throw new Error("Overleaf project exceeds the supported text size limit.");
      }
      const content = await fs.readFile(full, "utf8");
      result.push({ path: safeRelative(root, full), content });
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
  if (!/^[A-Za-z0-9_-]+$/.test(projectId)) throw new Error("Overleaf project id is invalid.");
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
      sectionTree: parseLatexSectionTree(files, normalizedEntry),
      overleafUrl: `https://www.overleaf.com/project/${projectId}`,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}
