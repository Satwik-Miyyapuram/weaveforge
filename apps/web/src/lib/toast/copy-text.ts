import { formatError } from "@/lib/format-error";
import { toasts } from "./toast-store";

/** Copy to the clipboard and say so in a toast, or say why it failed (DA-64). */
export async function copyText(
  text: string,
  message = "Copied",
  write: (text: string) => Promise<void> = (t) => navigator.clipboard.writeText(t),
): Promise<void> {
  try {
    await write(text);
    toasts.show({ message });
  } catch (err) {
    toasts.show({ message: `Could not copy: ${formatError(err)}` });
  }
}
