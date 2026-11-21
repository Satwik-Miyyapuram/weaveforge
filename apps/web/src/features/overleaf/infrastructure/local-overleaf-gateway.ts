"use client";

import { LocalRunner } from "@/backend/providers/local/parts";
import { desktop } from "@/lib/desktop/desktop-bridge";
import { readyCore } from "@/lib/rust-core";
import type { LatexSectionTree } from "@weaveforge/wasm";

/**
 * The Overleaf link, for a copy working on this computer with no account.
 *
 * The hosted build reaches four API routes. This build has none of them: the
 * desktop export ships no server, so the rows are read and written straight
 * against the local database and the clone is done by the shell. The rules
 * about what may go in a row are imported rather than restated — one of them
 * decides what ends up in a clone URL, and a second copy of that is not a rule.
 *
 * The token is the one thing that does not live in a row. On a server it is
 * sealed with a key the browser never sees; here there is no server and no such
 * key, so it goes to the operating system's keychain and the shell uses it
 * without handing it back. The row keeps only its first four characters, so the
 * settings screen can say which token is in use without being able to use it.
 *
 * One token, not many: a connection per Overleaf account made sense when an
 * account could be shared between machines. This copy is one person at one
 * machine, and a picker for a list that is always length one is a worse offer
 * than no picker.
 *
 * The user is `auth.uid()`, the claim the shell sets per query: the local-only
 * id before sign-in, the account once the device has adopted one. Passing a
 * fixed id would fail the row policies on an adopted device.
 */

/** What the row keeps in place of a ciphertext it has no key to make. */
const KEYCHAIN = "keychain";

/** A token is already stored; saving another would switch every linked report to it. */
export class OverleafTokenInUseError extends Error {
  constructor() {
    super("An Overleaf token is already saved on this computer; replacing it switches every linked report to the new one.");
    this.name = "OverleafTokenInUseError";
  }
}

export interface OverleafReportRow {
  id: string;
  project_id: string;
  title: string;
  connection_id: string;
  overleaf_project_id: string;
  entry_file: string;
  external_url: string | null;
  last_fetched_at: string | null;
  section_targets: Record<string, number>;
}

const ROW_FIELDS =
  "id, project_id, connection_id, title, overleaf_project_id, entry_file, external_url, last_fetched_at, section_targets";

export class LocalOverleafGateway {
  constructor(private readonly run = new LocalRunner()) {}

  async listReports(projectId: string): Promise<OverleafReportRow[]> {
    return this.run.query<OverleafReportRow>(
      `select ${ROW_FIELDS} from overleaf_linked_reports
       where user_id = auth.uid() and project_id = $1 and enabled
       order by updated_at desc`,
      [projectId],
    );
  }

  /**
   * Keeps the token and returns the connection row to hang reports off.
   *
   * There is one keychain token, so there is one keychain row: a second link
   * reuses it and updates its prefix, rather than leaving an older row whose
   * reports would quietly run on the new token. A new row is written before
   * the token and removed again if the keychain write fails loudly (a machine
   * with no keychain backend has nowhere safe for it), so a failed insert
   * never replaces a token that existing reports still use.
   *
   * Replacing the stored token switches every linked report to it, so a second
   * link refuses with {@link OverleafTokenInUseError} unless `replaceToken` says
   * the user agreed (P2-3).
   */
  async saveConnection(name: string, token: string, options: { replaceToken?: boolean } = {}): Promise<string> {
    const shell = desktop();
    if (!shell) throw new Error("Linking Overleaf needs the desktop app.");
    const prefix = token.slice(0, 4);
    const existing = await this.keychainConnection();
    if (existing) {
      if (!options.replaceToken) throw new OverleafTokenInUseError();
      await shell.writeSecret("overleaf-token", token);
      await this.run.exec(
        `update overleaf_connections set name = $1, token_prefix = $2, updated_at = now()
         where id = $3 and user_id = auth.uid()`,
        [name, prefix, existing.id],
      );
      return existing.id;
    }
    const [row] = await this.run.query<{ id: string }>(
      `insert into overleaf_connections (user_id, name, token_ciphertext, token_prefix)
       values (auth.uid(), $1, $2, $3) returning id`,
      [name, KEYCHAIN, prefix],
    );
    if (!row) throw new Error("Could not save the Overleaf connection.");
    try {
      await shell.writeSecret("overleaf-token", token);
    } catch (err) {
      await this.run.exec("delete from overleaf_connections where id = $1 and user_id = auth.uid()", [row.id]).catch(() => undefined);
      throw err;
    }
    return row.id;
  }

  /** Remove a connection row, e.g. one saved for a report that was then refused (P2-225). */
  async deleteConnection(id: string): Promise<void> {
    await this.run.exec("delete from overleaf_connections where id = $1 and user_id = auth.uid()", [id]);
  }

  /** Whether a keychain token is already stored, so linking again would replace it. */
  async hasConnection(): Promise<boolean> {
    return (await this.keychainConnection()) !== null;
  }

  private async keychainConnection(): Promise<{ id: string } | null> {
    const [existing] = await this.run.query<{ id: string }>(
      `select id from overleaf_connections
       where user_id = auth.uid() and token_ciphertext = $1
       order by created_at limit 1`,
      [KEYCHAIN],
    );
    return existing ?? null;
  }

  async createReport(input: {
    projectId: string;
    connectionId: string;
    title: string;
    overleafProjectId: string;
    entryFile: string;
  }): Promise<void> {
    const plan = readyCore().planOverleafReportCreate(input);
    await this.run.exec(plan.sql, plan.params);
  }

  /**
   * Edits one link row. Only the fields the caller named change, which is why
   * this builds its statement rather than writing every column back: a form
   * that saves a title must not also overwrite the targets a section panel set
   * while it was open.
   */
  async patchReport(input: {
    id: string;
    title?: string;
    overleafProjectId?: string;
    entryFile?: string;
    sectionTargets?: unknown;
  }): Promise<void> {
    const plan = readyCore().planOverleafReportPatch(input);
    await this.run.exec(plan.sql, plan.params);
  }

  async deleteReport(id: string): Promise<void> {
    await this.run.exec("delete from overleaf_linked_reports where id = $1 and user_id = auth.uid()", [id]);
  }

  /** Clones through the shell, parses here, and records that it worked. */
  async readContent(report: OverleafReportRow) {
    const shell = desktop();
    if (!shell) throw new Error("Reading an Overleaf project needs the desktop app.");
    const source = await shell.readOverleafProject(report.overleaf_project_id, report.entry_file);
    await this.run.exec(
      `update overleaf_linked_reports set last_fetched_at = now(), last_error = null
       where id = $1 and user_id = auth.uid()`,
      [report.id],
    );
    return {
      files: source.files,
      entryFile: source.entryFile,
      sectionTree: readyCore().parseLatexSectionTree(source.files, source.entryFile) as LatexSectionTree,
      overleafUrl: source.overleafUrl,
    };
  }
}
