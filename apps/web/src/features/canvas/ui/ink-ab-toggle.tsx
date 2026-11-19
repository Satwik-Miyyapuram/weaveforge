import type { InkRendererKind } from "@/features/ink/render/freehand-stroke";
import { SegmentedControl } from "@/components/segmented-control";

/**
 * Dev-only A/B switch for the ink renderer on the canvas. Renders nothing unless
 * `visible` (the `thesis.inkAB` dev flag). A is `classic`, B is `freehand`.
 */
export function InkABToggle(props: {
  visible: boolean;
  renderer: InkRendererKind;
  onChange: (kind: InkRendererKind) => void;
}) {
  if (!props.visible) return null;
  return (
    <SegmentedControl
      className="canvas-editor__ab"
      label="Ink renderer (dev A/B)"
      value={props.renderer}
      onChange={props.onChange}
      options={[
        { value: "classic", label: "A", title: "Classic capsule renderer" },
        { value: "freehand", label: "B", title: "Freehand (Excalidraw freedraw) renderer" },
      ]}
    />
  );
}
