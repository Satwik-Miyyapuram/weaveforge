/// <reference lib="webworker" />

/**
 * Sentence encoder, off the main thread.
 *
 * A worker rather than an idle callback because this is not a task that yields:
 * one forward pass through a transformer is tens of milliseconds of solid
 * arithmetic, and a corpus is thousands of them. On the render thread that is
 * not jank, it is a frozen tab.
 *
 * The library is imported inside the worker and nowhere else, so the encoder
 * runtime never enters the main bundle. Nobody who leaves semantic search off
 * pays a byte for it.
 *
 * ## The `e.replace is not a function` failure, and where it actually comes from
 *
 * Every attempt to enable semantic search failed with that message and no
 * location. Resolved against the installed bundle, the stack is:
 *
 *     at new a.U (chunks/1637.<hash>.js)         ← webpack's Trusted Types URL shim
 *     at chunks/9500.<hash>.js:3:26787           ← onnxruntime-web, 122 KB
 *
 * Chunk 1637's a.U builds a URL from its argument and then strips the query and
 * fragment with a string replace; it throws when that argument is not a string.
 * Chunk 9500 is **onnxruntime-web**, whose WASM bootstrap resolves its own asset
 * URLs:
 *
 *     eA = new URL(new r.U(r(77649)).href, eT).href
 *     n.locateFile = e => new URL(e, u).href
 *
 * So this is not the worker construction, not `env.remoteHost`, and not the
 * library's cache — it is the ONNX runtime resolving a WASM asset path inside a
 * worker on the `app://` origin, where the script URL it is handed is not usable
 * as a base.
 *
 * dtype: "q8" is not the cause either: this happens during initialization,
 * before any weights are fetched, which is why no model bytes ever appear in the
 * cache directory.
 *
 * **What is not yet established:** which of those two calls is the failing one,
 * and therefore whether the fix is to give the runtime an explicit
 * wasmPaths/numThreads configuration or to serve the ORT assets from the app's
 * own host the way the weights already are. Both are testable; neither has been
 * tested. Recorded here so the next attempt starts from the location rather
 * than from the message.
 */

export interface EmbedWorkerRequest {
  id: number;
  type: "load" | "embed";
  model?: string;
  /** Where the weights come from; overridable for a mirror or a self-host. */
  host?: string;
  texts?: string[];
  /** Sentence encoders are trained with different prefixes for the two roles. */
  kind?: "passage" | "query";
  /** On `load`: how the model reads a sentence vector, and its role prefixes. */
  pooling?: "mean" | "cls";
  queryPrefix?: string;
  passagePrefix?: string;
}

export type EmbedWorkerResponse =
  | { id: number; type: "ready"; dimensions: number }
  | { id: number; type: "progress"; loaded: number; total: number }
  | { id: number; type: "vectors"; vectors: Float32Array[] }
  /** What the encoder factory returned, for the one failure that needs it. */
  | { id: number; type: "diagnostic"; message: string }
  | { id: number; type: "error"; message: string };

type FeatureExtractor = (
  texts: string[],
  options: { pooling: "mean" | "cls"; normalize: boolean },
) => Promise<{ dims: number[]; data: Float32Array | number[] }>;

let extractor: FeatureExtractor | null = null;
/** Set on `load`; a CLS-pooled retriever read with mean pooling ranks badly. */
let pooling: "mean" | "cls" = "mean";
let queryPrefix = "";
let passagePrefix = "";
let dimensions = 0;

const post = (message: EmbedWorkerResponse) => (self as unknown as Worker).postMessage(message);

/**
 * Absolute base URL for the app's exported assets, as seen from this worker.
 *
 * Derived from the worker's own script URL rather than assumed. This worker is
 * served as `/embedding-worker.js` from the app root — see
 * `scripts/build-embedding-worker.mjs` — so the base is the origin, and
 * onnxruntime-web's `.wasm` resolves to `/_next/static/media/` beneath it.
 * Derived rather than hard-coded because the desktop shell serves the bundle
 * from `app://weaveforge/` and the web build from a deployment root.
 */
function assetBase(): string {
  try {
    const url = (self as unknown as { location?: { href?: string } }).location?.href;
    if (typeof url === "string" && url.length > 0) {
      return new URL(".", url).href;
    }
  } catch {
    // Nothing usable; the root is the right guess for a served bundle.
  }
  return "/";
}

/** Worker threads for the ONNX runtime: several where shared memory exists, else one. */
function wasmThreads(): number {
  if (typeof SharedArrayBuffer === "undefined") return 1;
  const cores = (self as unknown as { navigator?: { hardwareConcurrency?: number } }).navigator?.hardwareConcurrency ?? 2;
  // Leave a core for the page; beyond four the returns are small and the memory is not.
  return Math.max(1, Math.min(4, cores - 1));
}

async function load(id: number, model: string, host?: string): Promise<void> {
  const base = assetBase();
  const runtime = globalThis as unknown as {
    __webpack_public_path__?: string;
    ort?: { env?: { wasm?: Record<string, unknown> } };
  };
  runtime.__webpack_public_path__ = base;

  const transformers = await import("@huggingface/transformers");
  const env = (transformers as unknown as Record<string, unknown>).env as Record<string, unknown> & {
    fetch?: typeof fetch;
    remoteHost?: string;
  };
  /*
   * `remoteHost` is deliberately **not** set to `host`.
   *
   * It used to be `app://models`, which is this app's real cache — and that is
   * what broke the tokenizer. The library validates every remote URL as
   * `http:`/`https:` (`fetch_file_head` returns `null` otherwise), so an `app:`
   * host makes `get_file_metadata` answer "does not exist" for every file, and the
   * tokenizer's file list comes back empty. Leaving the default `https://…` host in
   * place keeps those validators satisfied; `env.fetch` below is what actually
   * sends the bytes to this app's cache. `host` is still used, as the prefix the
   * rewrite recognises.
   */
  env.allowLocalModels = false;

  // Where onnxruntime-web fetches its own runtime, stated rather than inferred.
  //
  // It otherwise works this out from the script URL it was loaded as, and that
  // inference is the origin of the whole failure this file's header describes.
  // The runtime assets sit beside the worker at the app root, copied there by
  // `scripts/build-embedding-worker.mjs` because the Next build bundles
  // onnxruntime-web without carrying its sidecar files.
  //
  // Threads need SharedArrayBuffer. The web build has none (no cross-origin
  // isolation), and asking for threads there fails at initialization rather
  // than going faster, so it stays on one. The desktop shell enables it, and a
  // 110M-parameter encoder on one core is the difference between a corpus
  // embedding in minutes and in most of an hour.
  const backends = env.backends as { onnx?: { wasm?: Record<string, unknown> } } | undefined;
  const wasm = backends?.onnx?.wasm;
  if (wasm) {
    wasm.wasmPaths = base;
    wasm.numThreads = wasmThreads();
    wasm.proxy = false;
  }

  /*
   * ## Why the tokenizer never loaded, and why it needs `https`
   *
   * The pipeline arrived with no tokenizer at all — `extractor.tokenizer` was
   * `undefined` — and the library's factory only sets one `if (tokenizer)`, so
   * `AutoTokenizer.from_pretrained` had resolved to nothing. Running that call
   * directly gave the real error:
   *
   *     Cannot read properties of undefined (reading 'tokenizer_class')
   *
   * `loadTokenizer` destructures `[tokenizerJSON, tokenizerConfig]` from
   * `get_tokenizer_files(...)`, which returns `["tokenizer.json",
   * "tokenizer_config.json"]` **only if** `get_file_metadata(model,
   * "tokenizer_config.json").exists`. That check has two ways to say yes and
   * neither could be taken here:
   *
   *     // local branch
   *     const response = await getFile(localPath);
   *     if (typeof response !== "string" && response.status !== 404) → exists
   *     // remote branch, guarded by:
   *     if (env.allowRemoteModels && !local_files_only && validModelId) {
   *
   * and `fetch_file_head` — the only thing the remote branch asks — begins:
   *
   *     if (!isValidUrl(urlOrPath, ["http:", "https:"])) return null;
   *
   * **`app://models` is neither `http:` nor `https:`**, so the ranged request was
   * never made, `exists` was false, the file list came back empty, and the
   * pipeline was built with no tokenizer. Every file was reachable the whole time:
   * `tokenizer.json`, `tokenizer_config.json`, `vocab.txt` and
   * `special_tokens_map.json` all fetch from `app://models` with a 200, which is
   * what made this take so long to see — the network was fine, the *protocol
   * scheme* was the wrong shape for one guard.
   *
   * (The weights survive the same guard because `PreTrainedModel.from_pretrained`
   * has a separate `app:`-aware path; the tokenizer has no such path.)
   *
   * ## The fix
   *
   * `remoteHost` stays `https://huggingface.co` so the library's URL validators
   * are satisfied, and every request the library makes is redirected to this app's
   * own cache by wrapping `env.fetch`: `app://models/...` for a file this app
   * already serves, and the upstream host as the fallback. The cache stays the
   * only place the bytes actually come from in the normal case, and the scheme the
   * library insists on is only ever a shape it sees and never follows.
   */
  const upstreamFetch = env.fetch as typeof fetch;
  /*
   * Where this app actually keeps the weights.
   *
   * `host` is the caller's `app://models` — its own cache host — and `base` is the
   * app's origin, which is **not** where the models live. Composing the prefix from
   * `base` would have asked for `app://weaveforge/models/…`, a path the shell
   * answers with a 404, so this is the one place the passed-in host is still the
   * right answer.
   */
  // No host means no cache of this app's own: a browser, where the weights come
  // straight from upstream. Defaulting to `app://models` there sent every
  // download to a scheme no browser can fetch, and enabling search by meaning
  // on the web failed with a bare "Failed to fetch".
  const cachePrefix = host ? `${host.replace(/\/+$/, "")}/` : null;
  const pinnedHost = (() => {
    try {
      return new URL(String(env.remoteHost)).host;
    } catch {
      return "huggingface.co";
    }
  })();
  env.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    try {
      const parsed = new URL(url);
      if (cachePrefix && parsed.host === pinnedHost) {
        // The library asked for `https://huggingface.co/<path>`; take the path and
        // ask this app's own model host for it instead.
        return upstreamFetch(`${cachePrefix}${parsed.pathname.replace(/^\/+/, "")}${parsed.search}`, init);
      }
    } catch {
      // Not a URL this recognises; let the library's own fetch have it.
    }
    return upstreamFetch(input as RequestInfo, init);
  }) as typeof fetch;

  const pipeline = (transformers as unknown as {
    pipeline: (task: string, model: string, options: Record<string, unknown>) => Promise<FeatureExtractor>;
  }).pipeline;

  try {
    extractor = await pipeline("feature-extraction", model, {
      // Quantized weights: a quarter of the download for a difference in ranking
      // that does not survive contact with a real corpus.
      dtype: "q8",
      progress_callback: (report: { status?: string; loaded?: number; total?: number }) => {
        if (report.status === "progress" && report.total) {
          post({ id, type: "progress", loaded: report.loaded ?? 0, total: report.total });
        }
      },
    });

    /*
     * Nothing to repair here any more — the tokenizer arrives.
     *
     * This block used to exist to diagnose a pipeline built without one, and to
     * report what `extractor.tokenizer` actually was. That question is answered:
     * the tokenizer was missing because the library validates remote URLs as
     * `http:`/`https:` only and `app://models` failed that guard, so its file list
     * came back empty. See the `env.fetch` rewrite above. A pipeline that arrives
     * without a tokenizer is now a bug worth seeing rather than papering over, so
     * the diagnostic is gone and the pipeline is used as it comes.
     */
  } catch (error) {
    // What the worker could see, for the case where the error names nothing.
    const selfUrl = (self as unknown as { location?: { href?: string } }).location?.href;
    throw new Error(
      `${error instanceof Error ? error.message : String(error)}\n` +
        `[worker] self.location.href=${JSON.stringify(selfUrl)} assetBase=${JSON.stringify(base)} ` +
        `publicPath=${JSON.stringify(runtime.__webpack_public_path__)} ` +
        `wasmPaths=${JSON.stringify(wasm?.wasmPaths ?? null)}`,
    );
  }

  const probe = await extractor(["dimension probe"], { pooling, normalize: true });
  dimensions = probe.dims[probe.dims.length - 1] ?? 0;
  post({ id, type: "ready", dimensions });
}

async function embed(id: number, texts: string[], kind: "passage" | "query"): Promise<void> {
  if (!extractor) throw new Error("The encoder is not loaded.");

  // Asymmetric retrievers are trained with an instruction on the query side
  // (and some on the passage side); leaving it off costs real ranking quality.
  const prepared =
    kind === "query"
      ? texts.map((text) => queryPrefix + text.trim())
      : texts.map((text) => passagePrefix + text);
  const output = await extractor(prepared, { pooling, normalize: true });

  const flat = output.data instanceof Float32Array ? output.data : Float32Array.from(output.data);
  const width = output.dims[output.dims.length - 1] ?? dimensions;
  const vectors: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 1) {
    vectors.push(flat.slice(i * width, (i + 1) * width));
  }
  post({ id, type: "vectors", vectors });
}

self.addEventListener("message", (event: MessageEvent<EmbedWorkerRequest>) => {
  const request = event.data;
  void (async () => {
    try {
      if (request.type === "load") {
        pooling = request.pooling ?? "mean";
        queryPrefix = request.queryPrefix ?? "";
        passagePrefix = request.passagePrefix ?? "";
        await load(request.id, request.model ?? "Xenova/all-MiniLM-L6-v2", request.host);
      } else {
        await embed(request.id, request.texts ?? [], request.kind ?? "passage");
      }
    } catch (error) {
      post({
        id: request.id,
        type: "error",
        // The stack, not just the message.
        //
        // A one-line message from inside a library is a symptom several frames
        // away from its cause: `e.replace is not a function` names neither the
        // file nor the value, and reading it as a diagnosis cost a long detour.
        // Six frames turn it into a location.
        message:
          error instanceof Error
            ? `${error.message}\n${(error.stack ?? "").split("\n").slice(0, 6).join("\n")}`
            : String(error),
      });
    }
  })();
});
