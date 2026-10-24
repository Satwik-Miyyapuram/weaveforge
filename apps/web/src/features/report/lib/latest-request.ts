/**
 * Lets only the newest of overlapping async loads land. `begin()` starts a
 * request and returns a check that stays true until another one begins.
 */
export function latestRequest() {
  let latest = 0;
  return {
    begin(): () => boolean {
      const id = ++latest;
      return () => id === latest;
    },
  };
}
