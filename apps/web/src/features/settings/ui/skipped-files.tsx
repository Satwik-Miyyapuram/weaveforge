import type { SkippedFile } from "@/features/workspace/application/import-limits";

/** How many left-out files are named before the rest is only counted. */
const SHOWN = 10;

/** The files an import preview left out, each with the reason. */
export function SkippedFiles({ skipped }: { skipped: readonly SkippedFile[] }) {
  if (skipped.length === 0) return null;
  const rest = skipped.length - SHOWN;
  return (
    <details className="muted">
      <summary>
        {skipped.length} file{skipped.length === 1 ? "" : "s"} left out
      </summary>
      <ul>
        {skipped.slice(0, SHOWN).map((file) => (
          <li key={file.path}>
            <code>{file.path}</code>: {file.reason}
          </li>
        ))}
      </ul>
      {rest > 0 && <p>and {rest} more</p>}
    </details>
  );
}
