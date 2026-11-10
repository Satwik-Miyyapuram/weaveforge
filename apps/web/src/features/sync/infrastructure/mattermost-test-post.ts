import type { Integration } from "../domain/integration";
import { readyCore } from "@/lib/rust-core";
import { MattermostNotifier } from "./mattermost-notifier";

/** Posts one test message per distinct channel the switched-on events route to. */
export async function postMattermostTest(integration: Integration): Promise<string[]> {
  const posts = readyCore().mattermostTestPosts(integration);
  const notifier = new MattermostNotifier();
  for (const p of posts) {
    await notifier.post(integration, p.message, p.channel);
  }
  return posts.map((p) => p.channel);
}
