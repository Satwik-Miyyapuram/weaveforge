/** `T` with every array readonly, for wrapper inputs Rust only reads. Not re-exported. */
export type ReadonlyInput<T> = T extends readonly (infer U)[]
  ? readonly ReadonlyInput<U>[]
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyInput<T[K]> }
    : T;
