"use client";

import { LOCAL_USER_ID, parseLatexSectionTree } from "@weaveforge/core";
import { LocalRunner } from "@/backend/providers/local/local-runner";
import { desktop } from "@/lib/desktop/desktop-bridge";
import {
  entryFileError,
  externalUrl,
  OVERLEAF_PROJECT_ID,
  sanitizeSectionTargets,
} from "../domain/link-rules";

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
 */

/** What the row keeps in place of a ciphertext it has no key to make. */
const KEYCHAIN = "keychain";

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
       where user_id = $1 and project_id = $2 and enabled
       order by updated_at desc`,
      [LOCAL_USER_ID, projectId],
    );
  }

  /**
   * Keeps the token and returns the connection row to hang reports off.
   *
   * The keychain write comes first and is allowed to fail loudly: a machine
   * with no keychain backend has nowhere safe for this, and a row pointing at a
   * credential that was never stored would fail later and less clearly.
   */
  async saveConnection(name: string, token: string): Promise<string> {
    const shell = desktop();
    if (!shell) throw new Error("Linking Overleaf needs the desktop app.");
    await shell.writeSecret("overleaf-token", token);
    const [row] = await this.run.query<{ id: string }>(
      `insert into overleaf_connections (user_id, name, token_ciphertext, token_prefix)
       values ($1, $2, $3, $4) returning id`,
      [LOCAL_USER_ID, name, KEYCHAIN, token.slice(0, 4)],
    );
    if (!row) throw new Error("Could not save the Overleaf connection.");
    return row.id;
  }

  async createReport(input: {
    projectId: string;
    connectionId: string;
    title: string;
    overleafProjectId: string;
    entryFile: string;
  }): Promise<void> {
    const entryFile = input.entryFile.trim() || "main.tex";
    if (!OVERLEAF_PROJECT_ID.test(input.overleafProjectId)) {
      throw new Error("Overleaf project id is invalid.");
    }
    const invalid = entryFileError(entryFile);
    if (invalid) throw new Error(invalid);
    await this.run.exec(
      `insert into overleaf_linked_reports
         (user_id, project_id, connection_id, title, overleaf_project_id, entry_file, external_url)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        LOCAL_USER_ID,
        input.projectId,
        input.connectionId,
        input.title.trim(),
        input.overleafProjectId,
        entryFile,
        externalUrl(input.overleafProjectId),
      ],
    );
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
    const sets: string[] = [];
    const params: (string | null)[] = [];
    const set = (column: string, value: string) => {
      params.push(value);
      sets.push(`${column} = $${params.length}`);
    };

    if (input.sectionTargets !== undefined) {
      const targets = sanitizeSectionTargets(input.sectionTargets);
      if (!targets) throw new Error("Section targets are invalid.");
      set("section_targets", JSON.stringify(targets));
      // The column is jsonb and the parameter is text, so it is cast at the
      // one place that knows it is JSON rather than by a helper that does not.
      sets[sets.length - 1] += "::jsonb";
    }
    if (input.title !== undefined) {
      const title = input.title.trim();
      if (!title) throw new Error("Title cannot be empty.");
      set("title", title);
    }
    if (input.overleafProjectId !== undefined) {
      const id = input.overleafProjectId.trim();
      if (!OVERLEAF_PROJECT_ID.test(id)) throw new Error("Overleaf project id is invalid.");
      set("overleaf_project_id", id);
      // Recomputed, not carried over: a stale link would point at the old project.
      set("external_url", externalUrl(id));
    }
    if (input.entryFile !== undefined) {
      const entryFile = input.entryFile.trim() || "main.tex";
      const invalid = entryFileError(entryFile);
      if (invalid) throw new Error(invalid);
      set("entry_file", entryFile);
    }
    if (!sets.length) throw new Error("Nothing to update.");
    // Pointing at a different project or file invalidates what was fetched
    // under the old target, so clear the cached failure rather than leave it
    // misattributed. A literal, not a parameter: there is nothing to bind.
    if (input.overleafProjectId !== undefined || input.entryFile !== undefined) {
      sets.push("last_error = null");
    }

    params.push(input.id, LOCAL_USER_ID);
    await this.run.exec(
      `update overleaf_linked_reports set ${sets.join(", ")}, updated_at = now()
       where id = $${params.length - 1} and user_id = $${params.length}`,
      params,
    );
  }

  async deleteReport(id: string): Promise<void> {
    await this.run.exec("delete from overleaf_linked_reports where id = $1 and user_id = $2", [
      id,
      LOCAL_USER_ID,
    ]);
  }

  /** Clones through the shell, parses here, and records that it worked. */
  async readContent(report: OverleafReportRow) {
    const shell = desktop();
    if (!shell) throw new Error("Reading an Overleaf project needs the desktop app.");
    const source = await shell.readOverleafProject(report.overleaf_project_id, report.entry_file);
    await this.run.exec(
      `update overleaf_linked_reports set last_fetched_at = now(), last_error = null
       where id = $1 and user_id = $2`,
      [report.id, LOCAL_USER_ID],
    );
    return {
      files: source.files,
      entryFile: source.entryFile,
      sectionTree: parseLatexSectionTree(source.files, source.entryFile),
      overleafUrl: source.overleafUrl,
    };
  }
}
