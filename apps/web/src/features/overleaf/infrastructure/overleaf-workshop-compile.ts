import { BaseAPI, type CompileResponseSchema, type ResponseSchema } from "../vendor/overleaf-workshop/base-api";
import { OVERLEAF_BASE_URL } from "./overleaf-workshop-projects";

export type OverleafCompileResult =
  | { ok: true; compile: CompileResponseSchema }
  | { ok: false; message: string };

export type OverleafPdfResult =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; message: string };

type Identity = NonNullable<ResponseSchema["identity"]>;

type SignedInCompile =
  | { ok: true; identity: Identity; compile: CompileResponseSchema }
  | { ok: false; message: string };

/** Signs in with the cookie, then compiles. The one path both public functions share. */
async function signInAndCompile(
  cookies: string,
  projectId: string,
  rootResourcePath: string,
  api: BaseAPI,
): Promise<SignedInCompile> {
  const login = await api.cookiesLogin(cookies);
  if (login.type !== "success" || !login.identity) {
    return { ok: false, message: login.message ?? "Overleaf sign-in failed." };
  }
  const compiled = await api.compile(login.identity, projectId, rootResourcePath);
  if (compiled.type !== "success" || !compiled.compile) {
    return { ok: false, message: compiled.message ?? "Overleaf compile request failed." };
  }
  return { ok: true, identity: login.identity, compile: compiled.compile };
}

/** Sign in with a session cookie and compile a project. A LaTeX failure is data (status "failure"). */
export async function compileOverleafProjectWithCookies(
  cookies: string,
  projectId: string,
  rootResourcePath: string,
  api: BaseAPI = new BaseAPI(OVERLEAF_BASE_URL),
): Promise<OverleafCompileResult> {
  const result = await signInAndCompile(cookies, projectId, rootResourcePath, api);
  return result.ok ? { ok: true, compile: result.compile } : result;
}

/** The PDF as the route returns it: application/pdf, never cached. */
export function workshopPdfResponse(pdf: Uint8Array): Response {
  return new Response(pdf as BodyInit, {
    status: 200,
    headers: { "Content-Type": "application/pdf", "Cache-Control": "no-store" },
  });
}

/** Compile, then download output.pdf from the CLSI (CDN when the compile reports one). */
export async function fetchOverleafPdfWithCookies(
  cookies: string,
  projectId: string,
  rootResourcePath: string,
  api: BaseAPI = new BaseAPI(OVERLEAF_BASE_URL),
): Promise<OverleafPdfResult> {
  const result = await signInAndCompile(cookies, projectId, rootResourcePath, api);
  if (!result.ok) return result;
  const { identity, compile } = result;
  if (compile.status !== "success") {
    return { ok: false, message: `Compile failed (status ${compile.status}).` };
  }
  const pdf = compile.outputFiles.find((f) => f.path === "output.pdf");
  if (!pdf) return { ok: false, message: "The compile produced no PDF." };
  const downloaded = await api.getFileFromClsi(
    identity, pdf.url, compile.compileGroup, compile.clsiServerId, compile.pdfDownloadDomain,
  );
  if (downloaded.type !== "success" || !downloaded.content || downloaded.content.length === 0) {
    return { ok: false, message: "The PDF could not be downloaded." };
  }
  return { ok: true, pdf: downloaded.content };
}
