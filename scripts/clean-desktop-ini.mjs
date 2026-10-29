#!/usr/bin/env node
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// .git is cleaned on its own below; node_modules is not ours and is huge.
const SKIP = new Set([".git", "node_modules"]);

function purgeDesktopIni(dir, skip = new Set()) {
  if (!existsSync(dir)) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) purgeDesktopIni(fullPath, skip);
      } else if (entry.name.toLowerCase() === "desktop.ini") {
        try {
          unlinkSync(fullPath);
        } catch {
          // ignore lock/permission errors
        }
      }
    }
  } catch {
    // ignore unreadable dirs
  }
}

// Clean in .git (especially .git/refs) and workspace root
purgeDesktopIni(path.join(root, ".git"));
purgeDesktopIni(root, SKIP);
