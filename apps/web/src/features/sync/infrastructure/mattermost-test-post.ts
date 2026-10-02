import type { Integration } from "../domain/integration";
import { MATTERMOST_EVENTS, mattermostChannelFor } from "../domain/mattermost-options";
import { MattermostNotifier } from "./mattermost-notifier";

/** Posts one test message per distinct channel the switched-on events route to. */
export async function postMattermostTest(integration: Integration): Promise<string[]> {
  const byChannel = new Map<string, string[]>();
  for (const e of MATTERMOST_EVENTS) {
    const ch = mattermostChannelFor(integration, e.id);
    if (ch) byChannel.set(ch, [...(byChannel.get(ch) ?? []), e.label]);
  }
  const notifier = new MattermostNotifier();
  for (const [ch, labels] of byChannel) {
    await notifier.post(
      integration,
      `:white_check_mark: WeaveForge test. This channel will receive: ${labels.join(", ")}.`,
      ch,
    );
  }
  return [...byChannel.keys()];
}
