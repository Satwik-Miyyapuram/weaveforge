# Architectural Diagnosis & Fix Specification: Surface Pen Stroke Capture & Rendering

## 1. Executive Summary & Observed Failure
When drawing with the Microsoft Surface Slim Pen 2 on the Surface Pro 11th Edition (Qualcomm Snapdragon X ARM64, Windows 11 25H2, Chromium / Electron 33), stylus contact produces no visible marks on `.ink-canvas`, and strokes fail to be captured or committed.

A forensic walkthrough of the pointer capture, event gating, worker messaging, and WebGL rendering pipeline revealed **four interrelated defects** that prevent pen strokes from rendering or committing.

---

## 2. Root Cause Analysis

### Bug 1: Asynchronous Worker Startup Drops Critical Initial Messages
- **Files:** `apps/web/src/features/ink/application/use-pen-capture.ts`, `apps/web/src/features/ink/ui/ink-host.tsx`
- **Mechanism:**
  1. `usePenCapture` begins requesting the platform ink presenter on mount (`requestInkPresenter(canvas)` in `ink-trail.ts`), which is an **asynchronous Promise**.
  2. While this Promise is in flight, `workerRef.current` remains `null`.
  3. Meanwhile, React executes the mount `useEffect` hooks in `InkHost`:
     - `send({ type: "load-page", pageIndex, chunk })`
     - `send({ type: "page-model", requestId })`
     - `send({ type: "viewport", transform: { scale, offsetX: 0, offsetY: 0, devicePixelRatio } })`
     - `send({ type: "resize", width, height, dpr })`
  4. In `use-pen-capture.ts`, `send` is defined as:
     ```ts
     const send = useCallback(
       (message: InkWorkerMessage, transfer: Transferable[] = []) => {
         workerRef.current?.postMessage(message, transfer);
       },
       [],
     );
     ```
     Because `workerRef.current` is `null`, **every single one of these messages is silently dropped**.
  5. When `requestInkPresenter` finally resolves, `start()` creates the worker and only posts `{ type: "init", ... }`.
  6. **Mathematical Consequence on Rendering:**
     - The worker's `WebglInkRenderer` (and `CanvasInkRenderer`) initializes with default transform: `{ scale: 1, offsetX: 0, offsetY: 0, devicePixelRatio: 1 }`.
     - In `WebglInkRenderer.draw()`:
       `camera.x = this.transform.scale * this.dpr = 1 * 2.0 = 2.0`.
       `pageSize = (1600, 2262)`.
     - Page coordinates (0.1 mm, e.g. center of page `(1050, 1485)`) are transformed in the vertex shader:
       ```glsl
       vec2 scaled = (page + vec2(camera.y, camera.z)) * camera.x;
       vec2 unit = scaled / pageSize;
       gl_Position = vec4(unit.x * 2.0 - 1.0, 1.0 - unit.y * 2.0, 0.0, 1.0);
       ```
     - With `scale: 1`:
       `unit.x = (1050 * 2.0) / 1600 = 1.3125` -> `gl_Position.x = 1.625` (> +1.0).
       `unit.y = (1485 * 2.0) / 2262 = 1.3129` -> `gl_Position.y = -1.625` (< -1.0).
     - Because `gl_Position` is outside `[-1.0, +1.0]`, **all strokes on the middle and lower sections of the page are 100% clipped out by the GPU rasterizer**.

### Bug 2: Missing `event.preventDefault()` on Pointer Events Causes Chromium Gesture Cancellation
- **Files:** `apps/web/src/features/ink/ui/ink-page.tsx`, `apps/web/src/features/ink/application/use-pen-capture.ts`
- **Mechanism:**
  - On Windows 11 Chromium, stylus down gestures trigger native Windows Ink and Chromium gesture recognizers (handwriting input, flick gestures, panning/scrolling) unless `event.preventDefault()` is invoked on `pointerdown` and `pointermove`.
  - In `ink-page.tsx` and `use-pen-capture.ts`, neither `onPointerDown` nor `onPointerMove` called `event.preventDefault()`.
  - Consequently, as soon as the Surface Slim Pen 2 moves 1–2 pixels, Chromium detects a potential platform gesture, revokes pointer capture, and dispatches a `pointercancel` event.
  - In `ink-page.tsx`, `onPointerCancel={onPointerUp}` calls `session.pointerUp(event)`. Because only 1 or 2 samples were recorded before cancellation, `commitStroke` drops the mark (`packed.points.length < 4`), causing the stroke to immediately disappear.

### Bug 3: Permanent Palm Gate Lockup on Aborted / Non-Active Strokes
- **Files:** `apps/web/src/features/ink/application/use-pen-capture.ts`, `apps/web/src/features/ink/application/pen-gate.ts`
- **Mechanism:**
  - In `session.pointerDown(event)`, `this.deps.gate.begin(event)` claims the pointer and sets `gate.activeId = event.pointerId`.
  - When the stroke is subsequently cancelled by `pointercancel` or if `beginStroke` fails, `session.pointerUp(event)` executes:
    ```ts
    pointerUp(event: PenPointerEvent): void {
      if (!this.active || event.pointerId !== this.pointerId) return;
      ...
      this.deps.gate.end(event.pointerId);
    }
    ```
  - If `this.active` is false (or stroke was aborted), the method **returns early and never calls `gate.end(event.pointerId)`**.
  - `gate.activeId` remains locked to that pointer ID indefinitely. Every subsequent stylus contact hits:
    ```ts
    if (this.activeId !== null && this.activeId !== event.pointerId) {
      return { decision: "ignore", cancelled: [] };
    }
    ```
    causing all future drawing attempts to be discarded.

### Bug 4: Coalesced Event Timestamp Normalization
- **Files:** `apps/web/src/features/ink/application/use-pen-capture.ts`
- **Mechanism:**
  - In `pointerRawUpdate`, `native.getCoalescedEvents()` returns native browser `PointerEvent` objects, which have property `.timeStamp`, not `.t`.
  - When passed into `consume(sample, false)`, `sample.t` evaluated to `undefined`, causing `dt = sample.t - previous.t` in `OneEuroFilter` to calculate `NaN` and writing `NaN` into the sample transfer buffer.

---

## 3. Concrete Implementation Blueprint

### Fix 1: Message Queue in `use-pen-capture.ts`
Add a ref queue to buffer messages sent prior to worker creation, and flush them immediately after `init`:
```ts
// apps/web/src/features/ink/application/use-pen-capture.ts

const pendingMessages = useRef<Array<{ message: InkWorkerMessage; transfer: Transferable[] }>>([]);

const send = useCallback(
  (message: InkWorkerMessage, transfer: Transferable[] = []) => {
    if (workerRef.current) {
      workerRef.current.postMessage(message, transfer);
    } else {
      pendingMessages.current.push({ message, transfer });
    }
  },
  [],
);

// Inside start() in usePenCapture:
const worker = create();
workerRef.current = worker;
...
worker.postMessage({ type: "init", ... }, offscreen ? [offscreen] : []);

// Flush queued messages:
if (pendingMessages.current.length > 0) {
  for (const { message, transfer } of pendingMessages.current) {
    worker.postMessage(message, transfer);
  }
  pendingMessages.current = [];
}
```

### Fix 2: Prevent Default on Pointer Down, Move & Cancel
In `apps/web/src/features/ink/ui/ink-page.tsx`:
```tsx
const onPointerDown = useCallback(
  (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (tool === "eraser") {
      const at = project(event.clientX, event.clientY);
      if (!at) return;
      lastErase.current = at;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
      onErase(at, at);
      return;
    }
    if (tool === "lasso") {
      const at = project(event.clientX, event.clientY);
      if (!at) return;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch {}
      const b = selectionBounds;
      if (b && at.x >= b[0] && at.x <= b[2] && at.y >= b[1] && at.y <= b[3]) {
        drag.current = at;
        return;
      }
      lasso.current = [at.x, at.y];
      return;
    }
    penHandlers.onPointerDown(event);
  },
  [onErase, penHandlers, project, selectionBounds, tool],
);

const onPointerMove = useCallback(
  (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (tool === "eraser") { ... }
    if (tool === "lasso") { ... }
    penHandlers.onPointerMove(event);
  },
  [onErase, penHandlers, project, tool],
);

const onPointerUp = useCallback(
  (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    ...
  },
  [onLasso, onMoveSelection, penHandlers, project, tool],
);
```

In `apps/web/src/features/ink/application/use-pen-capture.ts`:
```ts
const onPointerDown = useCallback(
  (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    ...
  },
  [toGateEvent],
);

const onPointerMove = useCallback(
  (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    sessionRef.current!.pointerRawUpdate(toGateEvent(event));
  },
  [toGateEvent],
);

const onPointerCancel = useCallback(
  (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    if (deferTimer.current) {
      clearTimeout(deferTimer.current);
      deferTimer.current = null;
    }
    sessionRef.current!.pointerUp(toGateEvent(event));
  },
  [toGateEvent],
);
```

### Fix 3: Unconditional Gate Release in `pointerUp`
In `PenCaptureSession.pointerUp` (`apps/web/src/features/ink/application/use-pen-capture.ts`):
```ts
pointerUp(event: PenPointerEvent): void {
  const active = this.active && event.pointerId === this.pointerId;
  if (active) {
    this.consume(event, false, false, true);
    const header = this.header!;
    this.deps.writer.flush("stroke-end", header);
    this.clear();
  }
  // UNCONDITIONAL: Always release the gate's pointer claim even if stroke was cancelled or aborted
  this.deps.gate.end(event.pointerId);
}
```

### Fix 4: Timestamp Normalization in `consume`
In `PenCaptureSession.consume` (`apps/web/src/features/ink/application/use-pen-capture.ts`):
```ts
const t = Number.isFinite(event.t)
  ? event.t
  : (event as unknown as { timeStamp?: number }).timeStamp ?? performance.now();

const sample = this.deps.filter.filter({
  x: projected.x,
  y: projected.y,
  pressure: event.pressure ?? 0,
  t,
});
...
this.deps.writer.push(
  sample.x,
  sample.y,
  sample.pressure,
  t,
  header,
);
```

### Fix 5: Ensure Viewport Sync on Backend Ready in `ink-host.tsx`
In `apps/web/src/features/ink/ui/ink-host.tsx`:
```ts
useEffect(() => {
  const canvas = canvasRef.current;
  if (!canvas) return;
  const box = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  send({
    type: "viewport",
    transform: { scale, offsetX: 0, offsetY: 0, devicePixelRatio: dpr },
  });
  send({ type: "resize", width: box.width, height: box.height, dpr });
}, [scale, send, pen.backend]);
```

### Fix 6: Live Digitiser Diagnostic Readout in `InkBar`
Expose live digitiser feedback in `ink-bar.tsx` so users and engineers can inspect hardware signals in real-time:
```tsx
<span className="ink-readout" data-backend={backend ?? "starting"}>
  p.{page}/{pages} · {strokes} {strokes === 1 ? "stroke" : "strokes"} ·{" "}
  {lastPointer
    ? `${lastPointer.type}(p=${lastPointer.pressure.toFixed(2)})`
    : (penSeen ? "pen" : "pointer")} · {backend ?? "starting"}
  {delegating ? " · delegated" : ""}
</span>
```

---

## 4. Verification Protocol
1. **Automated Unit Tests:**
   Run `npm test` across all workspaces (`@weaveforge/core` and `@weaveforge/web`) ensuring 198+ test cases pass without regressions.
2. **Packaging:**
   Execute `npm run build:web --workspace @weaveforge/desktop` and `npm run build --workspace @weaveforge/desktop`.
   Package ARM64 Windows installer via `npx electron-builder --win --arm64`.
3. **Manual Validation on Surface Pro 11:**
   - Launch app on device.
   - Observe readout: `ink: webgl2 · delegated`.
   - Contact Surface Slim Pen 2 to canvas: verify readout immediately reflects `pen(p=0.xx)` and strokes render with 0-latency under the nib across all quadrants of the page.
