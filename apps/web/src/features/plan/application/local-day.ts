/** The local calendar day of `now` as `yyyy-mm-dd`, the form the plan timeline takes as "today". */
export function localIsoDay(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
