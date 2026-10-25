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
