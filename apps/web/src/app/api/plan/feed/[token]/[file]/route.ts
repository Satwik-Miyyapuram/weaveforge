import { NextResponse } from "next/server";
import { milestonesToIcs, planWidgetData, type FeedMilestone } from "@weaveforge/core";
import { requirePlanFeedUser } from "../../../../sdk/_shared";
import { MILESTONE_COLUMNS, milestoneToDomain, type MilestoneRow } from "@/features/plan/infrastructure/milestone-rows";
import { formatErrorForResponse } from "@/lib/format-error";

export const dynamic = "force-dynamic";

/**
 * The plan feed: `deadlines.ics` for a calendar to subscribe to, `widget.json`
 * for home screen and wallpaper widgets. The token is in the path because a
 * calendar app cannot send a header; it is a `plan_feed`-scoped API token and
 * resolves to nothing else.
 *
 * Options ride in the query string, so one link can be re-shaped without a new
 * token: `?done=1` keeps finished milestones, `?alarm=N` adds a reminder N days
 * before each deadline (calendar only).
 *
 * Only the owner's own milestones, never ones shared with them: this is their
 * calendar, and a collaborator's deadline is not theirs to be reminded of.
 */
const FILES = {
  "deadlines.ics": "text/calendar; charset=utf-8",
  "widget.json": "application/json; charset=utf-8",
} as const;

type FeedFile = keyof typeof FILES;

function isFeedFile(value: string): value is FeedFile {
  return Object.prototype.hasOwnProperty.call(FILES, value);
}

export async function GET(request: Request, context: { params: { token: string; file: string } }) {
  const { file } = context.params;
  if (!isFeedFile(file)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const auth = await requirePlanFeedUser(context.params.token);
  // A revoked or unknown link is gone, not unauthorised: calendar apps stop
  // polling a 404 and keep retrying a 401.
  if (!auth.ok) return auth.response.status === 401 ? NextResponse.json({ error: "Not found." }, { status: 404 }) : auth.response;

  const [milestones, projects] = await Promise.all([
    auth.db
      .from("milestones")
      .select(`${MILESTONE_COLUMNS},project_id`)
      .eq("user_id", auth.userId)
      .is("deleted_at", null),
    auth.db.from("projects").select("id,name").eq("user_id", auth.userId).is("deleted_at", null),
  ]);
  const error = milestones.error ?? projects.error;
  if (error) return NextResponse.json({ error: formatErrorForResponse(error, "plan-feed") }, { status: 500 });

  const names = new Map(((projects.data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  const items: FeedMilestone[] = ((milestones.data ?? []) as unknown as (MilestoneRow & { project_id: string | null })[])
    // A milestone in a deleted project went with it.
    .filter((row) => !row.project_id || names.has(row.project_id))
    .map((row) => ({ milestone: milestoneToDomain(row), projectName: row.project_id ? names.get(row.project_id) : undefined }));

  const { searchParams } = new URL(request.url);
  const includeDone = searchParams.get("done") === "1";
  const alarm = Number.parseInt(searchParams.get("alarm") ?? "", 10);
  const options = { now: new Date(), includeDone, reminderDays: Number.isFinite(alarm) ? Math.min(Math.max(alarm, 0), 30) : 0 };

  const body = file === "deadlines.ics" ? milestonesToIcs(items, options) : JSON.stringify(planWidgetData(items, options));
  return new NextResponse(body, {
    headers: {
      "Content-Type": FILES[file],
      // Private: the body is one person's plan. Short: a moved deadline should
      // reach the calendar on its next poll.
      "Cache-Control": "private, max-age=300",
      // The link is the credential; keep it out of referrers and indexes.
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex",
      ...(file === "deadlines.ics" ? { "Content-Disposition": 'inline; filename="weaveforge-deadlines.ics"' } : {}),
      // Widgets on the web (a wallpaper page, a Rainmeter skin) fetch this cross-origin.
      ...(file === "widget.json" ? { "Access-Control-Allow-Origin": "*" } : {}),
    },
  });
}
