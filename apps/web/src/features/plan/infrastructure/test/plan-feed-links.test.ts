import { test } from "node:test";
import assert from "node:assert/strict";
import { planFeedOrigin, planFeedUrls } from "../plan-feed-links";

test("planFeedUrls builds calendar, https and widget links with options in the query", () => {
  const urls = planFeedUrls("https://app.weaveforge.org", "tt_abc", { includeDone: true, reminderDays: 3 });
  assert.equal(urls.ics, "https://app.weaveforge.org/api/plan/feed/tt_abc/deadlines.ics?done=1&alarm=3");
  assert.equal(urls.webcal, "webcal://app.weaveforge.org/api/plan/feed/tt_abc/deadlines.ics?done=1&alarm=3");
  assert.equal(urls.widget, "https://app.weaveforge.org/api/plan/feed/tt_abc/widget.json?done=1");
  assert.equal(planFeedUrls("https://x.org", "tt_a").ics, "https://x.org/api/plan/feed/tt_a/deadlines.ics");
});

test("planFeedOrigin uses this origin only where the feed route exists", () => {
  assert.equal(planFeedOrigin(true, "https://preview.example.com"), "https://preview.example.com");
  assert.match(planFeedOrigin(false, "app://weaveforge"), /^https:\/\//);
  assert.match(planFeedOrigin(true, "app://weaveforge"), /^https:\/\//);
});
