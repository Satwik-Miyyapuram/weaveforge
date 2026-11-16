// A class that throws when constructed. Members are typed loosely so the
// vendored call sites still typecheck.
export function stub<N extends string>(name: N) {
  return class {
    // Gives each stub its own type, so `instanceof` chains narrow correctly.
    declare readonly __stub: N
    static [key: string]: any
    [key: string]: any
    constructor(..._args: any[]) {
      throw new Error(`${name} is not available in the WeaveForge workshop`)
    }
    // Lists such as CommentList are iterated by the callers.
    *[Symbol.iterator](): Iterator<any> {}
  }
}
