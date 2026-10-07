#!/usr/bin/env node
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function purgeDesktopIni(dir) {
  if (!existsSync(dir)) return;
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        purgeDesktopIni(fullPath);
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
purgeDesktopIni(root);
