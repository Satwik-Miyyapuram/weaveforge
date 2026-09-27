/**
 * Writes which npm packages the browser build contains, and from where.
 *
 * A package can reach the client bundle twice: when a dependency asks for a
 * version range ours does not satisfy, npm nests a second copy under that
 * dependency (`node_modules/mermaid/node_modules/katex`), and webpack bundles
 * both. Nothing about the build says so, and the per-route budget cannot see it
 * when both copies sit in chunks that load on demand. The production build does
 * not keep module paths, so this records them while webpack still has them.
 *
 * Output: `<distDir>/client-packages.json`, one entry per package directory —
 *
 *     { "node_modules/mermaid/node_modules/katex": { "name": "katex", "version": "0.16.47", "chunks": [...] } }
 *
 * Read by `scripts/check-bundle-duplicates.mjs`.
 */
import fs from "node:fs";
import path from "node:path";

const PLUGIN = "ClientPackagesPlugin";

/** `…/node_modules/@scope/name/dist/x.js` → `node_modules/…/node_modules/@scope/name`, or null. */
function packageDirOf(resource) {
  const parts = resource.split(/[\\/]/);
  const last = parts.lastIndexOf("node_modules");
  if (last < 0 || last + 1 >= parts.length) return null;
  const end = parts[last + 1].startsWith("@") ? last + 3 : last + 2;
  const first = parts.indexOf("node_modules");
  return { absolute: parts.slice(0, end).join(path.sep), key: parts.slice(first, end).join("/") };
}

/** A module and, for a concatenated one, every module folded into it. */
function* resourcesOf(mod) {
  if (mod.resource) yield mod.resource;
  for (const inner of mod.modules ?? []) yield* resourcesOf(inner);
}

export class ClientPackagesPlugin {
  apply(compiler) {
    compiler.hooks.afterEmit.tap(PLUGIN, (compilation) => {
      const packages = {};
      const versions = new Map();
      for (const chunk of compilation.chunks) {
        const files = [...chunk.files].filter((file) => file.endsWith(".js"));
        for (const mod of compilation.chunkGraph.getChunkModulesIterable(chunk)) {
          for (const resource of resourcesOf(mod)) {
            const dir = packageDirOf(resource);
            if (!dir) continue;
            if (!versions.has(dir.absolute)) {
              let meta = {};
              try {
                meta = JSON.parse(fs.readFileSync(path.join(dir.absolute, "package.json"), "utf8"));
              } catch {
                // A package without a readable manifest still counts as a copy.
              }
              versions.set(dir.absolute, { name: meta.name, version: meta.version ?? "?" });
            }
            const { name, version } = versions.get(dir.absolute);
            const entry = (packages[dir.key] ??= {
              name: name ?? dir.key.split("node_modules/").pop(),
              version,
              chunks: [],
            });
            for (const file of files) if (!entry.chunks.includes(file)) entry.chunks.push(file);
          }
        }
      }
      fs.writeFileSync(
        path.join(compiler.options.output.path, "client-packages.json"),
        JSON.stringify(packages, null, 1),
      );
    });
  }
}
