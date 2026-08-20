import type { IAuthService } from "@weaveforge/core";

export class AuthFacade {
  constructor(private readonly deps: { auth: IAuthService }) {}

  get auth() {
    return this.deps.auth;
  }
}
