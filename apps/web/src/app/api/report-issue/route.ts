import { NextResponse } from "next/server";
import { requireSdkUser } from "@/app/api/sdk/_shared";
import { RateLimiter } from "@/backend/net/rate-limit";
import { fileIssue } from "@/lib/error-report/file-issue";
import { formatErrorForResponse } from "@/lib/format-error";
import { redactAndCap } from "@/lib/error-report/redact";

/**
 * Filing a bug report the reader asked for.
 *
 * The reader sees the payload first (the UI shows it and offers a copy button),
 * but the route redacts again: this is the last place that can decide what leaves
 * the building, and a client cannot be trusted to have done it. Everything else
 * here is about not being an open relay into somebody's issue tracker —
 * authenticated, rate-limited, bounded fields, and a fixed destination.
 *
 * ## Configuration
 *
 * `GITHUB_ISSUES_TOKEN` — a fine-grained token with `issues: write` on the repo.
 * Absent means reporting is unavailable, and the route says so with a `503` that
 * names the variable, rather than failing with something that reads like a bug.
 * `GITHUB_ISSUES_REPO` overrides the destination, defaulting to the same
 * repository `check-release-drafts.mjs` uses.
 *
 * ## What is deliberately not here
 *
 * No user identity is attached. The issue is read by the repository owner, and a
 * bug report does not need to say who filed it to be fixable — an account id in a
 * public issue is a small breach of the reader's privacy for no diagnostic gain.
 */

const DEFAULT_REPO = "Satwik-Miyyapuram/weaveforge";

/**
 * Five reports an hour is generous for a person and useless as a spam channel.
 * Shared with the paste-fetch limiter's implementation (SEC-06) rather than a
 * second token bucket written by hand.
 */
const REPORT_LIMIT = { capacity: 5, refillPerSecond: 1 / 720 };
const reportLimiter = new RateLimiter(REPORT_LIMIT);

/** Field caps, before redaction, so a hostile body cannot be large in the first place. */
const MAX_TITLE = 200;
const MAX_DETAIL = 20_000;
const MAX_LOGS = 20_000;

interface ReportBody {
  title?: unknown;
  detail?: unknown;
  logs?: unknown;
  route?: unknown;
  appVersion?: unknown;
}

function text(value: unknown, limit: number): string {
  return typeof value === "string" ? value.slice(0, limit) : "";
}

export async function POST(request: Request) {
  const gate = await requireSdkUser(request);
  if (!gate.ok) return gate.response;

  const decision = reportLimiter.take(gate.userId);
  if (!decision.allowed) {
    return NextResponse.json(
      { error: "Too many reports just now. Try again later." },
      { status: 429, headers: { "Retry-After": String(Math.ceil(decision.retryAfterSeconds)) } },
    );
  }

  let body: ReportBody;
  try {
    body = (await request.json()) as ReportBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const title = text(body.title, MAX_TITLE).trim();
  const detail = text(body.detail, MAX_DETAIL);
  if (!title || !detail) {
    return NextResponse.json({ error: "A title and a description are required." }, { status: 400 });
  }

  const token = process.env.GITHUB_ISSUES_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "Report filing is not configured on this deployment (GITHUB_ISSUES_TOKEN)." },
      { status: 503 },
    );
  }
  const repo = process.env.GITHUB_ISSUES_REPO ?? DEFAULT_REPO;

  // Redacted here as well as in the client: see the note at the top.
  const safeTitle = redactAndCap(title, MAX_TITLE);
  const safeDetail = redactAndCap(detail);
  const safeLogs = redactAndCap(text(body.logs, MAX_LOGS));
  const route = redactAndCap(text(body.route, 200)).text;
  const version = redactAndCap(text(body.appVersion, 60)).text;

  const markdown = [
    "### What happened",
    "",
    safeDetail.text,
    "",
    route || version ? `### Where\n\n${[route && `Route: \`${route}\``, version && `Version: \`${version}\``].filter(Boolean).join(" · ")}` : "",
    safeLogs.text ? `### Recent errors and warnings\n\n\`\`\`text\n${safeLogs.text}\n\`\`\`` : "",
    "",
    "---",
    "",
    `Filed from the app's error screen. ${safeTitle.redactions + safeDetail.redactions + safeLogs.redactions} item(s) were redacted automatically.`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  try {
    // Through the pinned path, not plain `fetch` — see `fileIssue`, which is the
    // half that can be driven in a test without a session.
    const filed = await fileIssue({
      repo,
      token,
      title: `[app] ${safeTitle.text}`,
      body: markdown,
    });

    if (!filed.ok) {
      return NextResponse.json(
        {
          error:
            filed.reason === "unreachable"
              ? "The issue tracker could not be reached."
              : "The issue tracker refused the report.",
        },
        { status: 502 },
      );
    }

    return NextResponse.json({ ok: true, url: filed.url, number: filed.number });
  } catch (err) {
    return NextResponse.json({ error: formatErrorForResponse(err, "report-issue") }, { status: 502 });
  }
}
