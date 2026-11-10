export {
  appCanonicalUrl,
  appContentTypeFor,
  appFileCandidates,
  appHeaders,
  appIsPageRequest,
} from "../pkg/wf_wasm.js";
/**
 * `app://` protocol rules (Rust `app_protocol`): candidate files inside the
 * bundle, canonical URLs, page-or-asset classification, content types and
 * response headers. Asking the disk and the protocol handler stay in
 * `apps/shell/sidecar/src/app-protocol.ts`.
 */

