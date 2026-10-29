/*
 * Vendored from Overleaf Workshop (https://github.com/iamhyc/Overleaf-Workshop),
 * src/api/base.ts. Copyright (C) the Overleaf Workshop authors.
 * Licensed under the GNU Affero General Public License v3.0 (see ./NOTICE).
 *
 * Adapted for WeaveForge: only the cookie login, project list, compile and
 * PDF download paths are kept. The VS Code glue (remoteFileSystemProvider
 * types, socket.io, passport login, form-data, undici, uuid) is dropped;
 * global fetch (Node 18+) replaces undici. Retry, cookie and header handling
 * are unchanged.
 */

export interface Identity {
    csrfToken: string;
    cookies: string;
}

export interface ProjectPersist {
    id: string;
    name: string;
    [key: string]: unknown;
}

export interface CompileResponseSchema {
    status: 'success' | 'failure' | 'error';
    compileGroup: string;
    clsiServerId?: string;
    pdfDownloadDomain?: string;
    outputFiles: Array<{ path: string; url: string; type: string; build?: number }>;
    stats: Record<string, number>;
    timings: Record<string, number>;
    enableHybridPdfDownload: boolean;
}

export interface ResponseSchema {
    type: 'success' | 'error';
    message?: string;
    userInfo?: { userId: string; userEmail: string };
    identity?: Identity;
    projects?: ProjectPersist[];
    compile?: CompileResponseSchema;
    content?: Uint8Array;
}

/** Extract set-cookie headers from a fetch Response. */
function getSetCookie(res: Response): string[] {
    if (typeof res.headers.getSetCookie === 'function') {
        return res.headers.getSetCookie();
    }
    const raw = res.headers.get('set-cookie');
    return raw ? [raw] : [];
}

export class BaseAPI {
    private url: string;
    private identity?: Identity;

    constructor(url: string) {
        this.url = url;
    }

    private async getUserId(cookies: string) {
        const res = await fetch(this.url + 'project', {
            method: 'GET', redirect: 'manual',
            headers: {
                'Connection': 'keep-alive',
                'Cookie': cookies,
            }
        });

        const body = await res.text();
        const userIDMatch = body.match(/<meta\s+name="ol-user_id"\s+content="([^"]*)">/);
        const userEmailMatch = body.match(/<meta\s+name="ol-usersEmail"\s+content="([^"]*)">/);
        const csrfTokenMatch = body.match(/<meta\s+name="ol-csrfToken"\s+content="([^"]*)">/);
        if (userIDMatch !== null && csrfTokenMatch !== null) {
            const userId = userIDMatch[1]!;
            const csrfToken = csrfTokenMatch[1]!;
            const userEmail = userEmailMatch?.[1] ?? '';
            return { userId, userEmail, csrfToken };
        } else {
            return undefined;
        }
    }

    async cookiesLogin(cookies: string): Promise<ResponseSchema> {
        const res = await this.getUserId(cookies);
        if (res) {
            const { userId, userEmail, csrfToken } = res;
            const identity: Identity = await this.updateCookies({ cookies, csrfToken });
            return {
                type: 'success',
                userInfo: { userId, userEmail },
                identity: identity
            };
        } else {
            return {
                type: 'error',
                message: 'Failed to get User ID.'
            };
        }
    }

    async updateCookies(identity: Identity) {
        const res = await fetch(this.url + 'socket.io/socket.io.js', {
            method: 'GET',
            redirect: 'manual',
            headers: {
                'Connection': 'keep-alive',
                'Cookie': identity.cookies,
            }
        });
        const cookies = getSetCookie(res)[0]?.split(';')[0];
        if (cookies) {
            identity.cookies = `${identity.cookies}; ${cookies}`;
        }
        return identity;
    }

    setIdentity(identity: Identity) {
        this.identity = identity;
        return this;
    }

    /**
     * Check if an HTTP error is transient (worth retrying).
     * Retries on: 5xx server errors, network errors (fetch failures), and 429 rate limiting.
     */
    private isTransientError(statusCode: number | undefined, errorMessage?: string): boolean {
        if (statusCode === undefined) {
            return true;
        }
        if (statusCode >= 500 || statusCode === 429) {
            return true;
        }
        if (errorMessage && (
            errorMessage.includes('ECONNRESET') ||
            errorMessage.includes('ETIMEDOUT') ||
            errorMessage.includes('ECONNREFUSED') ||
            errorMessage.includes('ENOTFOUND') ||
            errorMessage.includes('socket hang up')
        )) {
            return true;
        }
        return false;
    }

    protected async request(type: 'GET' | 'POST', route: string, body?: object, callback?: (res?: string) => object | undefined, extraHeaders?: object): Promise<ResponseSchema> {
        if (this.identity === undefined) { return Promise.reject(); }

        const MAX_HTTP_RETRIES = 2;
        let lastError: { statusCode?: number; message?: string } = {};

        for (let attempt = 0; attempt <= MAX_HTTP_RETRIES; attempt++) {
            try {
                let res: Response | undefined = undefined;
                switch (type) {
                    case 'GET':
                        res = await fetch(this.url + route, {
                            method: 'GET', redirect: 'manual',
                            headers: {
                                'Connection': 'keep-alive',
                                'Cookie': this.identity!.cookies,
                                ...extraHeaders
                            }
                        });
                        break;
                    case 'POST':
                        res = await fetch(this.url + route, {
                            method: 'POST', redirect: 'manual',
                            headers: {
                                'Connection': 'keep-alive',
                                'Cookie': this.identity!.cookies,
                                'Content-Type': 'application/json',
                                ...extraHeaders
                            },
                            body: JSON.stringify({
                                _csrf: this.identity!.csrfToken,
                                ...body
                            })
                        });
                        break;
                }

                if (res && (res.status === 200 || res.status === 204)) {
                    const _res = res.status === 200 ? await res.text() : undefined;
                    const response = callback && callback(_res);
                    return {
                        type: 'success',
                        ...response
                    } as ResponseSchema;
                } else if (res && this.isTransientError(res.status) && attempt < MAX_HTTP_RETRIES) {
                    const delayMs = Math.min(1000 * Math.pow(2, attempt), 4000);
                    lastError = { statusCode: res.status, message: await res.text().catch(() => '') };
                    await new Promise(r => setTimeout(r, delayMs));
                    continue;
                } else {
                    const status = res ? res.status : 'undefined';
                    let errorBody = '';
                    try { errorBody = res ? await res.text() : ''; } catch { errorBody = ''; }
                    return {
                        type: 'error',
                        message: `${status}: ${errorBody}`
                    };
                }
            } catch (err: any) {
                const errMsg = err?.message || String(err);
                if (this.isTransientError(undefined, errMsg) && attempt < MAX_HTTP_RETRIES) {
                    const delayMs = Math.min(1000 * Math.pow(2, attempt), 4000);
                    await new Promise(r => setTimeout(r, delayMs));
                    continue;
                }
                return {
                    type: 'error',
                    message: errMsg
                };
            }
        }

        return {
            type: 'error',
            message: lastError.message || `Request failed after ${MAX_HTTP_RETRIES + 1} attempts`
        };
    }

    async userProjectsJson(identity: Identity): Promise<ResponseSchema> {
        this.setIdentity(identity);
        return this.request('GET', 'user/projects', undefined, (res) => {
            const projects = (JSON.parse(res!) as any).projects as any[];
            projects.forEach(project => {
                project.id = project._id;
                delete project._id;
            });
            return { projects };
        });
    }

    async compile(identity: Identity, projectId: string, rootResourcePath: string | null,
        draft: boolean = false, stopOnFirstError: boolean = false
    ) {
        const body = {
            check: 'silent',
            draft,
            incrementalCompilesEnabled: true,
            rootResourcePath,
            stopOnFirstError
        };

        this.setIdentity(identity);
        return this.request('POST', `project/${projectId}/compile?auto_compile=true`, body, (res) => {
            const compile = JSON.parse(res!) as CompileResponseSchema;
            return { compile };
        }, { 'X-Csrf-Token': identity.csrfToken });
    }

    /** Download a compiled output (e.g. output.pdf) from the CLSI, using the CDN when the compile reports one. */
    async getFileFromClsi(identity: Identity, url: string, compileGroup: string, clsiServerId?: string, pdfDownloadDomain?: string) {
        if (pdfDownloadDomain && clsiServerId) {
            const cdnUrl = `${pdfDownloadDomain.replace(/\/+$/, '')}/${url.replace(/^\/+/g, '')}` +
                `?compileGroup=${encodeURIComponent(compileGroup)}` +
                `&clsiserverid=${encodeURIComponent(clsiServerId)}` +
                `&enable_pdf_caching=true`;
            const content = await this.downloadAbsolute(cdnUrl, false);
            return { type: 'success', content: new Uint8Array(content) } as ResponseSchema;
        }

        url = url.replace(/^\/+/g, '');
        this.setIdentity(identity);
        const content = await this.download(url);
        return {
            type: 'success',
            content: new Uint8Array(content)
        } as ResponseSchema;
    }

    protected async download(route: string) {
        if (this.identity === undefined) { return Promise.reject(); }
        return this.downloadAbsolute(this.url + route, true);
    }

    private async downloadAbsolute(absoluteUrl: string, includeCookies: boolean): Promise<Uint8Array> {
        const headers: Record<string, string> = {
            'Connection': 'keep-alive',
        };
        if (includeCookies && this.identity) {
            headers['Cookie'] = this.identity.cookies;
        }
        const chunks: Uint8Array[] = [];
        while (true) {
            const res = await fetch(absoluteUrl, { method: 'GET', redirect: 'manual', headers });
            if (res.status === 200) {
                chunks.push(new Uint8Array(await res.arrayBuffer()));
                break;
            } else if (res.status === 206) {
                chunks.push(new Uint8Array(await res.arrayBuffer()));
            } else {
                break;
            }
        }
        return Buffer.concat(chunks);
    }
}
