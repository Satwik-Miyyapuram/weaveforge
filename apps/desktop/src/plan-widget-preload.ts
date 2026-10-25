import { contextBridge, ipcRenderer } from "electron";
import type { PlanWidgetData } from "@weaveforge/core";
import { CHANNELS } from "./channels";

/**
 * The widget page's whole view of the shell: its data and the app's colours arriving, and its two
 * buttons. Nothing of the app's own bridge — no database, no folder, no
 * keychain — because the widget is a picture of the plan, not a way into it.
 */
contextBridge.exposeInMainWorld("planWidget", {
  // Each replaces the page's previous listener, so subscribing again never
  // renders one push twice. Wrapped so the page never holds Electron's event.
  onData: (cb: (data: PlanWidgetData) => void) => {
    ipcRenderer.removeAllListeners(CHANNELS.planWidgetData);
    ipcRenderer.on(CHANNELS.planWidgetData, (_event, data: PlanWidgetData) => cb(data));
  },
  onTheme: (cb: (palette: Record<string, string>) => void) => {
    ipcRenderer.removeAllListeners(CHANNELS.planWidgetTheme);
    ipcRenderer.on(CHANNELS.planWidgetTheme, (_event, palette: Record<string, string>) => cb(palette));
  },
  open: () => ipcRenderer.send(CHANNELS.planWidgetOpen),
  hide: () => ipcRenderer.send(CHANNELS.planWidgetHide),
});
