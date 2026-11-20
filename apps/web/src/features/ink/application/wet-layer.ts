/**
 * The wet layer during a stroke. The canvas dock normally sits under the
 * overlays and the selection chip; with `wetLayerAboveSvg` on it is raised for
 * the stroke (`data-wet-above`, styled in editor-workspace.css), so the
 * compositor never has DOM above the live ink while the pen is down.
 */
export function setWetLayerAbove(dock: Element | null, strokeActive: boolean, enabled: boolean): void {
  if (!dock) return;
  if (strokeActive && enabled) dock.setAttribute("data-wet-above", "");
  else dock.removeAttribute("data-wet-above");
}
