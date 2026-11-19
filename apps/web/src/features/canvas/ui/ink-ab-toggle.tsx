import type { InkRendererKind } from "@/features/ink/render/freehand-stroke";

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
  const options: [InkRendererKind, string][] = [
    ["classic", "A"],
    ["freehand", "B"],
  ];
  return (
    <div className="canvas-editor__ab" role="group" aria-label="Ink renderer (dev A/B)">
      {options.map(([kind, label]) => (
        <button
          key={kind}
          type="button"
          aria-pressed={props.renderer === kind}
          title={kind === "classic" ? "Classic capsule renderer" : "Freehand (perfect-freehand) renderer"}
          onClick={() => props.onChange(kind)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
