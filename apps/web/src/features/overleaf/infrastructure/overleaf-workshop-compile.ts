import { BaseAPI, type CompileResponseSchema } from "../vendor/overleaf-workshop/base-api";
import { OVERLEAF_BASE_URL } from "./overleaf-workshop-projects";

export type OverleafCompileResult =
  | { ok: true; compile: CompileResponseSchema }
  | { ok: false; message: string };

export type OverleafPdfResult =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; message: string };

/** Sign in with a session cookie and compile a project. A LaTeX failure is data (status "failure"). */
export async function compileOverleafProjectWithCookies(
  cookies: string,
  projectId: string,
  rootResourcePath: string,
  api: BaseAPI = new BaseAPI(OVERLEAF_BASE_URL),
): Promise<OverleafCompileResult> {
  const login = await api.cookiesLogin(cookies);
  if (login.type !== "success" || !login.identity) {
    return { ok: false, message: login.message ?? "Overleaf sign-in failed." };
  }
  const compiled = await api.compile(login.identity, projectId, rootResourcePath);
  if (compiled.type !== "success" || !compiled.compile) {
    return { ok: false, message: compiled.message ?? "Overleaf compile request failed." };
  }
  return { ok: true, compile: compiled.compile };
}

/** Compile, then download output.pdf from the CLSI (CDN when the compile reports one). */
export async function fetchOverleafPdfWithCookies(
  cookies: string,
  projectId: string,
  rootResourcePath: string,
  api: BaseAPI = new BaseAPI(OVERLEAF_BASE_URL),
): Promise<OverleafPdfResult> {
  const login = await api.cookiesLogin(cookies);
  if (login.type !== "success" || !login.identity) {
    return { ok: false, message: login.message ?? "Overleaf sign-in failed." };
  }
  const compiled = await api.compile(login.identity, projectId, rootResourcePath);
  if (compiled.type !== "success" || !compiled.compile) {
    return { ok: false, message: compiled.message ?? "Overleaf compile request failed." };
  }
  const { compile } = compiled;
  if (compile.status !== "success") {
    return { ok: false, message: `Compile failed (status ${compile.status}).` };
  }
  const pdf = compile.outputFiles.find((f) => f.path === "output.pdf");
  if (!pdf) return { ok: false, message: "The compile produced no PDF." };
  const downloaded = await api.getFileFromClsi(
    login.identity, pdf.url, compile.compileGroup, compile.clsiServerId, compile.pdfDownloadDomain,
  );
  if (downloaded.type !== "success" || !downloaded.content || downloaded.content.length === 0) {
    return { ok: false, message: "The PDF could not be downloaded." };
  }
  return { ok: true, pdf: downloaded.content };
}
