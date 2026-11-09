import type { Integration } from "../domain/integration";
import { readyCore } from "@/lib/rust-core";
import { MattermostNotifier } from "./mattermost-notifier";

/** Posts one test message per distinct channel the switched-on events route to. */
export async function postMattermostTest(integration: Integration): Promise<string[]> {
  const byChannel = new Map<string, string[]>();
  for (const e of readyCore().mattermostEvents()) {
    const ch = readyCore().mattermostChannelFor(integration, e.id);
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
