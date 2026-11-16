import { createContext, useContext } from "react";

/**
 * Whether the screen around a component is the one on show.
 *
 * The workspace stays mounted while another screen is up (`workspace-host.tsx`),
 * so its window-wide listeners — shortcuts, the pen overlay — would act on a
 * screen the person cannot see. They check this first. Everywhere else nothing
 * provides it and it is `true`.
 */
export const ScreenActiveContext = createContext(true);

export function useScreenActive(): boolean {
  return useContext(ScreenActiveContext);
}
