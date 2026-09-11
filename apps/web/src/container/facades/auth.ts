import type { IAuthService } from "@weaveforge/core";
import { isLocalMode, setLocalMode } from "@/backend/providers/local/local-identity";

export class AuthFacade {
  constructor(private readonly deps: { auth: IAuthService }) {}

  get auth() {
    return this.deps.auth;
  }

  /**
   * Whether this window is working on the computer rather than on an account.
   *
   * The answer lives in the local backend provider, which is the one module that
   * knows which wiring a window was built with. Presentation asking that
   * provider directly is how a screen ends up knowing which backend is behind
   * it — the whole point of the facade seam is that it does not have to. The
   * read is a `localStorage` lookup, so it stays synchronous.
   */
  isLocalMode(): boolean {
    return isLocalMode();
  }

  /**
   * Remember the choice. Reloading is still the caller's job: the wiring is
   * built once, so a flag flipped now only takes effect on the next load.
   */
  setLocalMode(on: boolean): void {
    setLocalMode(on);
  }
}
