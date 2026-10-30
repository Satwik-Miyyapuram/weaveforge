// Types for the one `@tauri-apps/api/core` export that bindings.ts uses, so it typechecks without the package.
// Replaced by the real package when the bridge is bundled into the window's init script.
export declare function invoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
): Promise<T>;
