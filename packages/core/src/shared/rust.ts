import type { TextLine } from "../features/reader/analysis/line-reconstruction.js";
import type { OutlineTextItem, ReaderOutlineItem } from "../features/reader/outline-types.js";

/**
 * The Rust core, as packages/core sees it. This package cannot import the wasm
 * package, so the app registers the loaded module here (apps/web
 * `lib/rust-core.ts`), and core glue calls Rust through `rust()`.
 *
 * `RustCoreFns` lists only the functions core calls. Add a line when a core
 * file starts calling a new one: the app's `setRustCore(module)` call fails to
 * typecheck if the wasm module does not export it with that signature.
 * Method syntax keeps parameter types bivariant, so the wasm wrappers' narrower
 * role unions still match.
 */
export interface RustCoreFns {
  normalizeDoi(doi?: string): string | undefined;
  projectName(name: string): string | undefined;

  creatableRoles(creator: string): string[];
  canCreateRole(creator: string, target: string): boolean;
  validateNewMember(input: {
    email: string;
    password: string;
    fullName?: string | null;
    role: string;
    supervisorId?: string | null;
  }): {
    email: string;
    password: string;
    fullName: string | null;
    role: string;
    supervisorId: string | null;
  };
  resolveSupervisorId(creatorId: string): string;
  filterTeamMembers<T extends { id: string; supervisorId?: string | null }>(
    viewerId: string,
    members: readonly T[],
    options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
  ): T[];
  filterLabMembers<T extends { id: string; supervisorId?: string | null }>(
    viewerId: string,
    members: readonly T[],
    options: { inLab: boolean; orgMemberIds?: ReadonlySet<string> | null },
  ): T[];
  isSupervisorRole(role: string | null | undefined): boolean;
  resolveDisplayRole(role: string, opts: { inLab: boolean; ownsOrg?: boolean }): string;
  needsStandaloneRoleSync(
    profile: { role: string; orgSetupComplete?: boolean | null; activeOrgId?: string | null } | null,
    memberships: readonly { orgId?: string; joinSource?: string | null }[],
    inLab: boolean,
  ): boolean;
  isExplicitLabMembership(membership: { orgId?: string; joinSource?: string | null }): boolean;
  hasActiveLab(
    activeOrgId: string | null | undefined,
    memberships: readonly { orgId?: string; joinSource?: string | null }[],
    ownsActiveOrg?: boolean,
  ): boolean;
  // reader
  isRotatedText(transform: readonly number[]): boolean;
  outlineTextLines(pages: readonly (readonly OutlineTextItem[])[]): OutlineTextItem[];
  bodyFontSize(pages: readonly (readonly OutlineTextItem[])[]): number;
  groupRecurringLines<T>(
    lines: readonly T[],
    textOf: (line: T) => string,
    pageOf: (line: T) => number,
  ): { key: string; pages: Set<number>; members: T[] }[];
  outlineFromText(allPages: readonly (readonly OutlineTextItem[])[]): ReaderOutlineItem[];
  outlineIsPlausible(headings: readonly { page: number }[], pageCount: number): boolean;
  findReferenceSection(
    lines: readonly TextLine[],
    bodyFontSize: number,
    pageCount: number,
    furniture?: readonly boolean[] | null,
  ): { start: number; end: number; headingIndex: number; score: number } | null;
  ladderOrder(supports: readonly boolean[]): number[];
}

let core: RustCoreFns | null = null;

export function setRustCore(module: RustCoreFns): void {
  core = module;
}

export function rust(): RustCoreFns {
  if (!core) throw new Error("Rust core not registered yet: the app calls setRustCore() after loading it");
  return core;
}
