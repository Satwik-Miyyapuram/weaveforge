/**
 * Query parameters that identify the reader rather than the page.
 *
 * The global list only holds names that mean "who sent you" in every context —
 * campaign tags and click identifiers minted by ad networks. A name that could
 * ever address content (`id`, `page`, `v`, `q`) belongs in a site rule, never
 * here, because this list runs against every URL in a paste including the DOI,
 * arXiv and publisher links a research note is mostly made of.
 *
 * `*` is the only wildcard and matches any run of characters.
 */
export const TRACKING_PARAMETERS: readonly string[] = [
  // Google Analytics and the UTM convention everything else copied
  "utm_*",
  "ga_source",
  "ga_medium",
  "ga_term",
  "ga_content",
  "ga_campaign",
  "ga_place",
  // Click identifiers: one per ad network, all of them per-click
  "gclid",
  "gclsrc",
  "dclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "msclkid",
  "twclid",
  "ttclid",
  "yclid",
  "ysclid",
  "epik",
  "rb_clickid",
  "irclickid",
  "cjevent",
  "awc",
  "sscid",
  "zanpid",
  "ranMID",
  "ranEAID",
  "ranSiteID",
  // Email and marketing platforms
  "mc_cid",
  "mc_eid",
  "mkt_tok",
  "_hsenc",
  "_hsmi",
  "hsa_*",
  "hsCtaTracking",
  "vero_conv",
  "vero_id",
  "ck_subscriber_id",
  "ml_subscriber",
  "ml_subscriber_hash",
  "oly_anon_id",
  "oly_enc_id",
  "_bhlid",
  // Self-hosted analytics that copied the convention
  "mtm_*",
  "pk_campaign",
  "pk_cid",
  "pk_content",
  "pk_keyword",
  "pk_kwd",
  "pk_medium",
  "pk_source",
  "pk_vid",
  "piwik_*",
  "matomo_*",
  "_openstat",
  "wickedid",
  "s_kwcid",
  "WT.mc_id",
];

/** A per-site rule: parameter names that only mean tracking on that host. */
export interface SiteParameterRemoval {
  /** Host the rule covers, including any subdomain of it. */
  domain: string;
  /** True when the rule was written `google.*` and covers every TLD. */
  anyTld: boolean;
  /** Parameter names or `*` globs removed on this host. */
  parameters: readonly string[];
}

/**
 * Rules for the sites whose own parameters are clutter.
 *
 * Deliberately conservative around anything scholarly: publisher hosts appear
 * only for parameters that are unambiguously campaign or referral tags, and no
 * rule here can touch a DOI, an arXiv identifier, a page number or a query.
 */
export const SITE_PARAMETER_REMOVALS: readonly SiteParameterRemoval[] = [
  { domain: "youtube.com", anyTld: false, parameters: ["si", "pp", "feature", "ab_channel"] },
  { domain: "youtu.be", anyTld: false, parameters: ["si", "pp", "feature"] },
  { domain: "google", anyTld: true, parameters: ["sca_esv", "sourceid", "client", "ei", "ved", "uact", "oq", "gs_l*", "sclient", "aqs", "biw", "bih", "sa", "usg"] },
  {
    domain: "amazon",
    anyTld: true,
    parameters: ["pd_rd_*", "pf_rd_*", "qid", "sr", "sprefix", "crid", "dib", "dib_tag", "content-id", "sbo", "_encoding", "psc", "th", "linkCode", "creative", "creativeASIN", "ascsubtag"],
  },
  { domain: "twitter.com", anyTld: false, parameters: ["s", "t", "ref_src", "ref_url"] },
  { domain: "x.com", anyTld: false, parameters: ["s", "t", "ref_src", "ref_url"] },
  { domain: "reddit.com", anyTld: false, parameters: ["share_id", "correlation_id", "ref", "ref_source", "rdt", "chainedPosts"] },
  { domain: "facebook.com", anyTld: false, parameters: ["comment_tracking", "notif_t", "notif_id", "ref", "__tn__", "__cft__*"] },
  { domain: "instagram.com", anyTld: false, parameters: ["igshid", "igsh", "img_index"] },
  { domain: "linkedin.com", anyTld: false, parameters: ["trk", "trackingId", "originalSubdomain", "li_fat_id", "midToken", "midSig", "eid", "lipi", "licu"] },
  { domain: "spotify.com", anyTld: false, parameters: ["si", "nd", "context", "_branch_match_id"] },
  { domain: "medium.com", anyTld: false, parameters: ["source", "sk", "gi"] },
  { domain: "substack.com", anyTld: false, parameters: ["r", "showWelcome", "triedRedirect", "publication_id", "post_id", "isFreemail"] },
  // Publishers: campaign and referral tags only. Article ids, DOIs and page
  // parameters are untouched.
  { domain: "sciencedirect.com", anyTld: false, parameters: ["via", "dgcid", "rss"] },
  { domain: "nature.com", anyTld: false, parameters: ["WT.ec_id", "WT.mc_id", "sap-outbound-id", "error", "code"] },
  { domain: "springer.com", anyTld: false, parameters: ["error", "code", "sap-outbound-id"] },
  { domain: "wiley.com", anyTld: false, parameters: ["af", "campaign", "PubDate"] },
  { domain: "tandfonline.com", anyTld: false, parameters: ["scroll", "needAccess"] },
  { domain: "ieee.org", anyTld: false, parameters: ["source", "sortType"] },
  { domain: "acm.org", anyTld: false, parameters: ["cid"] },
];

/**
 * Parameter sets that together make a cryptographic signature.
 *
 * A URL carrying one of these is left byte for byte: removing any parameter
 * invalidates the signature, and the failure only shows up as a 403 when
 * somebody clicks the link months later.
 */
export const SIGNED_URL_PARAMETER_SETS: readonly (readonly string[])[] = [
  ["X-Amz-Signature"],
  ["X-Goog-Signature"],
  ["sv", "sig"],
  ["Signature", "Expires", "AWSAccessKeyId"],
  ["Signature", "Expires", "GoogleAccessId"],
  ["Signature", "Expires", "KeyName"],
  ["Signature", "Expires", "Key-Pair-Id"],
  ["Signature", "Policy", "Key-Pair-Id"],
  ["token", "expires", "signature"],
];

/** True when `name` matches a literal or `*` glob from `patterns`, case-insensitively. */
export function matchesParameterPattern(name: string, patterns: readonly string[]): boolean {
  const lower = name.toLowerCase();
  return patterns.some((pattern) => {
    const target = pattern.toLowerCase();
    if (!target.includes("*")) return lower === target;
    const source = target
      .split("*")
      .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join(".*");
    return new RegExp(`^${source}$`).test(lower);
  });
}
