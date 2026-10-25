/**
 * Drops answers from requests a newer one has replaced. Call the gate when a
 * request starts; the check it returns is true only while no later request
 * has started, so a slow, older answer cannot overwrite a newer one.
 */
export function latestGate(): () => () => boolean {
  let seq = 0;
  return () => {
    const mine = ++seq;
    return () => mine === seq;
  };
}
