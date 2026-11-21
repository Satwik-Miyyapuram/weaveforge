/**
 * Whether a migration file is the one `--only` names (41-04).
 *
 * A number is a migration number: `--only 11` and `--only 0011` both mean
 * `0011_*.sql`, and never `0110` or `1011`, which a substring match picked too.
 * Anything else must be the whole file name, with or without `.sql`.
 */
export function matchesOnly(fileName, only) {
  if (/^\d+$/.test(only)) {
    const number = /^(\d+)_/.exec(fileName)?.[1];
    return number !== undefined && Number(number) === Number(only);
  }
  return fileName === only || fileName === `${only}.sql`;
}

/**
 * The files `--only` names, given each migration directory's file names.
 *
 * Both directories number from 0000, so a number can name one file in each.
 * Applying both is never what was meant, so that case is `ambiguous`.
 */
export function selectOnly(directories, only) {
  const hits = directories
    .map((names) => names.filter((name) => matchesOnly(name, only)))
    .filter((names) => names.length > 0);
  return { names: hits.flat(), ambiguous: hits.length > 1 };
}
