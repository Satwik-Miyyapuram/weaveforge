/**
 * The WebGL2 context attributes for the wet layer. They are immutable once the
 * context exists, so the path and the `wetDesynchronized` knob are read once,
 * at page open (§6.2.8).
 *
 * `desynchronized` lets the compositor skip the frame queue. It is never set on
 * the delegated path, where the OS presenter draws the trail, and the knob can
 * turn it off on the fallback path to test whether WebView2 composites the
 * desynchronized canvas late under the DOM.
 */
export function wetContextAttributes(options: {
  delegating: boolean;
  wetDesynchronized: boolean;
}): WebGLContextAttributes {
  return {
    alpha: true,
    antialias: false,
    stencil: true,
    desynchronized: !options.delegating && options.wetDesynchronized,
    preserveDrawingBuffer: false,
    premultipliedAlpha: true,
  };
}
