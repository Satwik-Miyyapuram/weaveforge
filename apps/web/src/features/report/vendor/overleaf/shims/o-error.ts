/** Stand-in for `@overleaf/o-error`: an Error that can carry extra info. */
export class OError extends Error {
  info: Record<string, unknown> = {};
  withInfo(info: Record<string, unknown>): this {
    this.info = { ...this.info, ...info };
    return this;
  }
}
