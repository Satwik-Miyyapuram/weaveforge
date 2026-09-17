# Native Inking Bridges — Android, iPadOS & Windows Haptics

**Status:** proposal, companion to `ink-notes-plan.md` (Revision 3).  
**Purpose:** specifies the three platform-specific native micro-bridges that provide hardware-level inking acceleration, bulletproof palm/hand rejection, and physical pen feel without duplicating WeaveForge's core application logic.

---

## 0. The Architectural Philosophy: "Unified Core, Native Inking Tip"

WeaveForge is a research workspace with Markdown editors, CodeMirror, Yjs CRDTs, wikilinks, PDF annotations, semantic search, and vault file syncing. Rewriting these systems natively for Android, iPadOS, and Windows would require maintaining three separate multi-thousand-line codebases.

Instead, this design uses the **Micro-Bridge Pattern**:
* **98% of WeaveForge remains unified:** The Markdown text layer, WebGL2 stroke renderer, Flatbush R-tree spatial index, line segmenter, and `.inkb` Brotli binary storage format are 100% shared across all platforms.
* **Each platform gets a ~100-line native hardware bridge:** A lightweight native overlay intercepts the physical stylus tip on the display glass, draws the active "wet" stroke at maximum hardware speed, executes driver-level palm suppression, and hands the finalized stroke points back to WeaveForge's shared JavaScript engine upon pen lift.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                 SHARED WEAVEFORGE CORE (TypeScript / WebGL2)                │
│   • Markdown Text Layer & Note Body          • Flatbush R-Tree Index        │
│   • Binary Columnar .inkb Storage (Brotli)   • Wikilinks, Backlinks, Sync   │
│   • Canvas Viewport, Zoom & Pan State        • Background Line Segmentation │
│   • Dual-Channel 1-Euro Position/Pressure    • 3-Layer Deterministic Palm   │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       ▲
              ┌────────────────────────┼────────────────────────┐
              │ Receives flat float    │ stroke trajectory      │
              ▼                        ▼                        ▼
     [ WINDOWS DESKTOP ]      [ ANDROID TABLETS ]       [ IPADOS / IPADS ]
     ───────────────────      ───────────────────       ──────────────────
     Chromium / Electron      1-File WebView Shell      Swift / WKWebView
     + C# WinRT Haptics       + Jetpack FrontBuffer     + PencilKit Bridge
     
     Latency: ~9 ms           Latency: ~6 ms            Latency: ~9 ms
     Palm: Firmware + Gate    Palm: Hover-Lock Proximity Palm: Apple PencilOnly
     Feel: Surface Paper Vib  Feel: S-Pen Hardware Taper Feel: Pencil Pro Haptics
```

---

## 1. Universal JavaScript $\leftrightarrow$ Native Bridge Protocol

All three platform bridges implement the same bidirectional interface. The web app detects whether a native bridge is available; if not, it automatically runs the pure WebGL2 inking engine specified in `ink-notes-plan.md`.

### 1.1 Web to Native Dispatch (`window.WeaveForgeNative`)

The host shell exposes a global bridge object on `window`:

```ts
export interface NativeInkingBridge {
  readonly platform: "windows" | "android" | "ios" | "web";
  readonly hasHaptics: boolean;
  
  /** Updates the native overlay viewport to match DOM canvas scrolling/zooming */
  setViewport(bounds: { x: number; y: number; width: number; height: number; dpr: number }): void;
  
  /** Updates active tool settings for the native live stroke */
  setTool(config: { tool: "pen" | "highlighter" | "eraser"; color: string; width: number }): void;
  
  /** Updates wrist guard policy: when true, all finger touches are strictly rejected */
  setPenOnly(enabled: boolean): void;
  
  /** Informs native layer of user handedness for directional palm suppression */
  setHandedness(hand: "left" | "right"): void;

  /** Triggers or modulates pen haptics with instantaneous pressure and velocity */
  updateHaptics(pressure: number, velocity: number): void;
  
  /** Clears the native overlay when WebGL commits the stroke to persistent VBOs */
  clearOverlay(): void;
}
```

### 1.2 Native to Web Stroke Handoff

When the physical stylus lifts (`ACTION_UP` / `pointerup`), the native bridge exports a flat interleaved array of stroke points to JavaScript:

```ts
/**
 * Interleaved coordinate trajectory:
 * [x0, y0, p0, t0,  x1, y1, p1, t1, ...]
 * Coordinates in CSS points (or 0.1 mm integers), pressure in [0.0, 1.0], timestamp in ms.
 */
window.onNativeStrokeComplete = function(points: Float32Array | number[]) {
  // 1. Hand points to Inking Worker for simplification, 1-Euro smoothing, and geometry commit
  inkWorker.postMessage({ type: "COMMIT_EXTERNAL_STROKE", points });
  
  // 2. Tell native bridge to clear its temporary front-buffer / overlay
  window.WeaveForgeNative?.clearOverlay();
};
```

---

## 2. Android: Low-Latency Shell & Hover-Lock Palm Rejection

### 2.1 Why Replace Pure Bubblewrap TWA for Ultra-Low Latency

While Bubblewrap (Trusted Web Activity) provides zero-code deployment via Chrome, TWAs run inside Chrome Custom Tabs. Android's security architecture forbids adding custom native views on top of a Chrome Custom Tab. 

To achieve the absolute fastest inking speed on Android (**~6 ms front-buffered rendering**, matching Samsung Notes) alongside **zero-latency palm rejection**, WeaveForge uses a **1-file Android Studio wrapper**:
* The activity loads the live WeaveForge URL inside an Android `WebView` (powered by the system Chromium engine).
* Overlaid on top in the same `FrameLayout` is an `InkingOverlayView` powered by **`androidx.graphics:graphics-core` (`CanvasFrontBufferedRenderer`)**.
* **Zero code duplication:** 100% of WeaveForge's code remains on the web. The native Android project consists of only one Kotlin file and one XML layout.

### 2.2 Layout: `app/src/main/res/layout/activity_main.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:layout_width="match_parent"
    android:layout_height="match_parent">

    <!-- Layer 1: The full WeaveForge web application -->
    <WebView
        android:id="@+id/webView"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />

    <!-- Layer 2: Transparent hardware front-buffered stylus overlay -->
    <com.weaveforge.android.InkingOverlayView
        android:id="@+id/inkOverlay"
        android:layout_width="match_parent"
        android:layout_height="match_parent" />
</FrameLayout>
```

### 2.3 Implementation: `MainActivity.kt` & `InkingOverlayView.kt`

```kotlin
package com.weaveforge.android

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.*
import android.os.Bundle
import android.os.SystemClock
import android.view.MotionEvent
import android.view.SurfaceView
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.graphics.lowlatency.CanvasFrontBufferedRenderer
import org.json.JSONArray
import kotlin.math.PI
import kotlin.math.hypot

class MainActivity : AppCompatActivity() {
    private lateinit var webView: WebView
    private lateinit var inkOverlay: InkingOverlayView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        webView = findViewById(R.id.webView)
        inkOverlay = findViewById(R.id.inkOverlay)

        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.addJavascriptInterface(NativeBridge(inkOverlay), "AndroidInkingBridge")
        webView.webViewClient = WebViewClient()
        webView.loadUrl("https://app.weaveforge.dev")

        inkOverlay.onStrokeFinished = { pointsJson ->
            runOnUiThread {
                webView.evaluateJavascript("window.onNativeStrokeComplete($pointsJson)", null)
            }
        }
    }

    class NativeBridge(private val overlay: InkingOverlayView) {
        @JavascriptInterface
        fun setTool(color: String, width: Float) {
            overlay.setPenStyle(Color.parseColor(color), width)
        }
        @JavascriptInterface
        fun setPenOnly(enabled: Boolean) {
            overlay.penOnly = enabled
        }
        @JavascriptInterface
        fun clearOverlay() {
            overlay.clear()
        }
    }
}

/**
 * Ultra-low latency transparent stylus view (~6 ms) using Android FrontBuffer Rendering.
 * Features a hardware Hover-Lock state machine and multi-tier palm rejection engine.
 */
class InkingOverlayView(context: Context) : SurfaceView(context) {
    var onStrokeFinished: ((String) -> Unit)? = null
    var penOnly: Boolean = false

    // Palm rejection timing & state
    private var isStylusHovering = false
    private var isStylusDrawing = false
    private var lastStylusUptimeMs: Long = 0
    private val STYLUS_HOVER_GRACE_MS = 400L
    private val PALM_AREA_THRESHOLD_MM2 = 25.0f

    // Stroke tracking
    private val strokePoints = ArrayList<Float>()
    private val currentPath = Path()
    private var lastX = 0f
    private var lastY = 0f
    private var lastPressure = 0.5f

    private val penPaint = Paint().apply {
        color = Color.BLACK
        strokeWidth = 4f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        isAntiAlias = true
    }

    private val frontBufferRenderer = CanvasFrontBufferedRenderer(this, object : CanvasFrontBufferedRenderer.Callback<Path> {
        override fun onDrawFrontBufferedLayer(canvas: Canvas, bufferWidth: Int, bufferHeight: Int, param: Path) {
            canvas.drawPath(param, penPaint) // Written directly into scanout buffer in <6 ms
        }
        override fun onDrawMultiBufferedLayer(canvas: Canvas, bufferWidth: Int, bufferHeight: Int, params: Collection<Path>) {
            // Maintained clean; committed ink is drawn by WeaveForge's WebGL canvas
        }
    })

    fun setPenStyle(color: Int, width: Float) {
        penPaint.color = color
        penPaint.strokeWidth = width
    }

    fun clear() {
        currentPath.reset()
        strokePoints.clear()
        isStylusDrawing = false
    }

    /**
     * Hardware Hover Detection: S-Pen / USI digitizers broadcast hover events up to 15 mm.
     * When hover starts, we lock out capacitive palm touches before the nib touches glass.
     */
    override fun onHoverEvent(event: MotionEvent): Boolean {
        val toolType = event.getToolType(0)
        if (toolType == MotionEvent.TOOL_TYPE_STYLUS || toolType == MotionEvent.TOOL_TYPE_ERASER) {
            when (event.actionMasked) {
                MotionEvent.ACTION_HOVER_ENTER, MotionEvent.ACTION_HOVER_MOVE -> {
                    isStylusHovering = true
                    lastStylusUptimeMs = SystemClock.uptimeMillis()
                }
                MotionEvent.ACTION_HOVER_EXIT -> {
                    isStylusHovering = false
                    lastStylusUptimeMs = SystemClock.uptimeMillis()
                }
            }
        }
        return super.onHoverEvent(event)
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val toolType = event.getToolType(0)
        val isStylus = (toolType == MotionEvent.TOOL_TYPE_STYLUS || toolType == MotionEvent.TOOL_TYPE_ERASER)
        val now = SystemClock.uptimeMillis()

        // ─────────────────────────────────────────────────────────────────
        // 1. HARDWARE STYLUS DISPATCH: Raw ~240-480 Hz Digitizer Samples
        // ─────────────────────────────────────────────────────────────────
        if (isStylus) {
            isStylusDrawing = (event.actionMasked != MotionEvent.ACTION_UP && event.actionMasked != MotionEvent.ACTION_CANCEL)
            lastStylusUptimeMs = now

            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    clear()
                    isStylusDrawing = true
                    lastX = event.x
                    lastY = event.y
                    lastPressure = event.pressure
                    currentPath.moveTo(event.x, event.y)
                    recordPoint(event.x, event.y, event.pressure, event.eventTime)
                    frontBufferRenderer.renderFrontBufferedLayer(currentPath)
                }
                MotionEvent.ACTION_MOVE -> {
                    // Extract batched historical events for maximum curve fidelity
                    for (i in 0 until event.historySize) {
                        val hx = event.getHistoricalX(i)
                        val hy = event.getHistoricalY(i)
                        val hp = event.getHistoricalPressure(i)
                        val ht = event.getHistoricalEventTime(i)
                        appendStylusSegment(hx, hy, hp, ht)
                    }
                    appendStylusSegment(event.x, event.y, event.pressure, event.eventTime)
                    frontBufferRenderer.renderFrontBufferedLayer(currentPath)
                }
                MotionEvent.ACTION_UP -> {
                    // Taper end of stroke to prevent blunt blob
                    recordPoint(event.x, event.y, 0.0f, event.eventTime)
                    isStylusDrawing = false
                    val json = JSONArray(strokePoints).toString()
                    onStrokeFinished?.invoke(json)
                }
                MotionEvent.ACTION_CANCEL -> {
                    clear()
                }
            }
            return true
        }

        // ─────────────────────────────────────────────────────────────────
        // 2. CAPACITIVE TOUCH DISPATCH: Multi-Tier Palm Rejection
        // ─────────────────────────────────────────────────────────────────
        
        // Tier A: Stylus Proximity Lock (Drawing, Hovering, or within Grace Window)
        val isPenNearby = isStylusDrawing || isStylusHovering || (now - lastStylusUptimeMs < STYLUS_HOVER_GRACE_MS)
        if (isPenNearby) {
            // Palm is resting while writing — swallow touch completely (do NOT scroll WebView)
            return true
        }

        // Tier B: Hardware Palm Flags (Android 13+ API 33)
        if (android.os.Build.VERSION.SDK_INT >= 33) {
            if ((event.flags and MotionEvent.FLAG_CANCELED) != 0) {
                return true // Driver flagged as palm contact; swallow
            }
        }

        // Tier C: Contact Geometry Heuristic (Physical Area in mm²)
        val xdpi = resources.displayMetrics.xdpi
        val ydpi = resources.displayMetrics.ydpi
        val majorMm = (event.touchMajor / xdpi) * 25.4f
        val minorMm = (event.touchMinor / ydpi) * 25.4f
        val contactAreaMm2 = (PI * majorMm * minorMm / 4.0f).toFloat()

        if (contactAreaMm2 > PALM_AREA_THRESHOLD_MM2 || event.size > 0.35f) {
            // Touch contact is larger than a fingertip (hand/wrist heel) — swallow
            return true
        }

        // Tier D: Strict "Pen Only" Mode
        if (penOnly) {
            // In pen-only mode, only multi-touch gestures (2+ fingers) are allowed for canvas navigation
            if (event.pointerCount >= 2) {
                return false // Pass to WebView for 2-finger pinch/pan
            }
            return true // Swallow all single-finger touches
        }

        // Tier E: Multi-Touch Navigation vs Single Finger Fall-through
        if (event.pointerCount >= 2) {
            return false // Pass through to WebView for pinch-to-zoom / canvas navigation
        }

        // Allow single finger touch to fall through to WebView for button clicks and scrolling
        return false
    }

    private fun appendStylusSegment(x: Float, y: Float, pressure: Float, time: Long) {
        // Quad-curve smoothing for wet front-buffer path
        val midX = (lastX + x) / 2f
        val midY = (lastY + y) / 2f
        currentPath.quadTo(lastX, lastY, midX, midY)
        recordPoint(x, y, pressure, time)
        lastX = x
        lastY = y
        lastPressure = pressure
    }

    private fun recordPoint(x: Float, y: Float, p: Float, t: Long) {
        strokePoints.addAll(listOf(x, y, p, t.toFloat()))
    }
}
```

---

## 3. iPadOS: Apple PencilKit Bridge & Multi-Touch Routing

### 3.1 Why Apple PencilKit Wins on iPadOS

WebKit on iOS introduces 20–30 ms of canvas compositing latency and lacks the WICG Delegated Ink Trail. However, iOS provides **Apple PencilKit**, which is universally regarded as the gold standard for tactile response:
* Inking runs at **9 ms glass-to-glass latency** on 120 Hz ProMotion displays.
* Supports **Apple Pencil Pro hardware features** (squeeze tool switching, barrel roll, and haptic snap).
* Delivers 100% hardware-level driver palm rejection (`drawingPolicy = .pencilOnly`).

### 3.2 Solving the `PKCanvasView` Touch-Through Conflict

`PKCanvasView` is an internal subclass of `UIScrollView`. When `drawingPolicy = .pencilOnly` is enabled, `PKCanvasView` by default intercepts single-finger drags to scroll its own canvas, blocking touches from reaching the `WKWebView` beneath it.

To achieve seamless operation:
1. **Disable PKCanvasView internal scrolling:** `pencilCanvas.isScrollEnabled = false`.
2. **Implement an Intelligent Hit-Test Coordinator:** A custom `InkingCanvasView` routes `.pencil` touches into PencilKit for sub-10 ms wet inking, routes 2-finger gestures to `WKWebView.scrollView` for pan/zoom, and swallows resting palm single-finger touches.

### 3.3 Implementation: `PencilKitBridge.swift`

```swift
import UIKit
import WebKit
import PencilKit

/**
 * Transparent PencilKit canvas overlay that intelligently routes touches:
 * - Apple Pencil -> Metal Inking Pipeline (9 ms latency + hardware palm rejection)
 * - 2 Fingers    -> WKWebView ScrollView (Pinch-to-zoom & pan)
 * - 1 Finger     -> Swallowed in inking mode to eliminate resting palm clicks
 */
class InkingCanvasView: PKCanvasView {
    var penOnlyMode: Bool = true

    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        guard let touches = event?.allTouches else {
            return super.hitTest(point, with: event)
        }

        // 1. If any touch is an Apple Pencil, PencilKit must own the event
        for touch in touches {
            if touch.type == .pencil || touch.type == .stylus {
                return self
            }
        }

        // 2. If multi-touch (2+ fingers), let touches pass through to WKWebView for canvas navigation
        if touches.count >= 2 {
            return nil // Pass through to underlying WKWebView
        }

        // 3. Single finger / resting palm handling
        if penOnlyMode {
            // Absorb the touch so it does not trigger stray clicks, links, or text selection in WKWebView
            return self
        }

        // If not in pen-only mode, allow touch to pass through for UI clicks
        return nil
    }
}

class InkingViewController: UIViewController, PKCanvasViewDelegate, WKScriptMessageHandler {
    private var webView: WKWebView!
    private var pencilCanvas: InkingCanvasView!
    private let hapticFeedback = UIImpactFeedbackGenerator(style: .rigid)

    override func viewDidLoad() {
        super.viewDidLoad()

        // 1. Initialize WebView for WeaveForge UI
        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "iosInkingBridge")
        webView = WKWebView(frame: view.bounds, configuration: config)
        webView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        view.addSubview(webView)
        webView.load(URLRequest(url: URL(string: "https://app.weaveforge.dev")!))

        // 2. Initialize Transparent Native PencilKit Overlay
        pencilCanvas = InkingCanvasView(frame: view.bounds)
        pencilCanvas.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        pencilCanvas.backgroundColor = .clear
        pencilCanvas.isOpaque = false
        pencilCanvas.isScrollEnabled = false
        pencilCanvas.delegate = self
        
        // Strict hardware palm rejection: Apple driver completely suppresses palm
        pencilCanvas.drawingPolicy = .pencilOnly
        view.addSubview(pencilCanvas)

        // 3. Configure Apple Pencil Pro Hover & Squeeze Interactions (iOS 17.5+)
        setupApplePencilProInteractions()
    }

    private func setupApplePencilProInteractions() {
        if #available(iOS 17.5, *) {
            let squeezeInteraction = PKSqueezeInteraction { [weak self] squeeze in
                guard let self = self else { return }
                // Trigger tactile snap and notify web app to open circular quick-tool radial menu
                self.hapticFeedback.impactOccurred()
                self.webView.evaluateJavaScript("window.onPencilSqueeze?.()")
            }
            pencilCanvas.addInteraction(squeezeInteraction)
        }

        // Apple Pencil Hover reticle support (iPad Pro M2+)
        if #available(iOS 16.1, *) {
            let hoverGesture = UIHoverGestureRecognizer(target: self, action: #selector(handleHover(_:)))
            pencilCanvas.addGestureRecognizer(hoverGesture)
        }
    }

    @objc private func handleHover(_ recognizer: UIHoverGestureRecognizer) {
        let loc = recognizer.location(in: pencilCanvas)
        // Pre-warm WebGL renderer and display custom hover reticle
        webView.evaluateJavaScript("window.onPencilHover?.({ x: \(loc.x), y: \(loc.y) })")
    }

    // Capture tool configuration changes dispatched from JavaScript
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let dict = message.body as? [String: Any],
              let action = dict["action"] as? String else { return }

        switch action {
        case "setTool":
            if let colorHex = dict["color"] as? String, let width = dict["width"] as? CGFloat {
                let color = UIColor(hex: colorHex)
                pencilCanvas.tool = PKInkingTool(.pen, color: color, width: width)
            }
        case "setPenOnly":
            if let enabled = dict["enabled"] as? Bool {
                pencilCanvas.penOnlyMode = enabled
            }
        case "clearOverlay":
            pencilCanvas.drawing = PKDrawing()
        default:
            break
        }
    }

    // Triggered on Apple Pencil lift: export trajectory to WeaveForge
    func canvasViewDrawingDidChange(_ canvasView: PKCanvasView) {
        guard let lastStroke = canvasView.drawing.strokes.last else { return }

        // Flatten stroke points: [x, y, pressure, time]
        var points: [Float] = []
        let strokePath = lastStroke.path
        
        for point in strokePath {
            points.append(Float(point.location.x))
            points.append(Float(point.location.y))
            points.append(Float(point.force))
            points.append(Float(point.timeOffset))
        }

        // Send points back to JavaScript worker
        if let jsonData = try? JSONSerialization.data(withJSONObject: points),
           let jsonString = String(data: jsonData, encoding: .utf8) {
            webView.evaluateJavaScript("window.onNativeStrokeComplete(\(jsonString))")
        }

        // Reset the native overlay; WebGL worker renders the permanent stroke
        canvasView.drawing = PKDrawing()
    }
}
```

---

## 4. Windows: Surface Slim Pen 2 Tactile Haptics (`PenHapticsEngine.cs`)

### 4.1 How Surface Pen Haptics Work

The **Microsoft Surface Slim Pen 2** contains an internal linear resonant actuator (LRA) that communicates with the display digitizer via **Microsoft Pen Protocol (MPP 2.6+)**. 

When controlled through the `Windows.Devices.Haptics` API, it emits micro-shear vibrations at the nib contact point, physically simulating the microscopic resistance and acoustic friction of a graphite pencil or ink pen on rough paper.

### 4.2 Physical Paper Simulation: Velocity-Gated Friction Model

A static vibration buzz feels synthetic and irritating. Real friction is **kinetic**:
1. **Velocity Gate:** When holding the pen still against the glass ($v < 0.05\text{ px/ms}$), friction is zero. The haptics engine instantly ceases vibration.
2. **Pressure Modulation:** Pressing harder forces the graphite deeper into microscopic paper valleys. Intensity scales non-linearly: $I(p, v) = \text{clamp}(p^{0.75} \cdot \min(1.0, v / v_{\text{nom}}), 0.15, 1.0)$.
3. **Calibrated Waveforms:**
   * **Pencil:** `PencilContinuous` (~200 Hz micro-shear vibration, high grain).
   * **Ballpoint Pen:** `InkContinuous` (~140 Hz viscous hydraulic drag).
   * **Highlighter:** `MarkerContinuous` (damped felt drag).
   * **Eraser:** `EraserContinuous` (viscoelastic rubber grab).

### 4.3 Implementation: `PenHapticsEngine.cs` (~50 Lines)

> **As built** (`apps/desktop/native/ink-recogniser/PenHapticsEngine.cs`): the controller is
> *not* taken from `PointerPoint.Properties.PointerDevice` — the helper is a headless process
> and the pointer events go to Chromium's window. It is found through
> `Windows.Devices.Input.PenDevice.GetFromPointerId`, scanning the system pointer ids when a
> stroke starts, and rebound when a send fails (the pen left range). The pen waveforms are
> Windows 11 API (SDK 22000), so the helper targets that TFM and guards with `ApiInformation`;
> the stop call is `StopFeedback()`, and the wire messages are `haptics-probe` (answered),
> `haptics-tool`, `haptics-update`, `haptics-stop` (fire-and-forget). The web side throttles to
> 120 Hz and converts the filter's 0.1 mm/ms velocity to CSS px/ms
> (`apps/web/src/features/ink/application/pen-haptics.ts`).

Integrated directly into the existing out-of-process C#/WinRT recognition helper (`apps/desktop/native/ink-recogniser/`):

```csharp
// apps/desktop/native/ink-recogniser/PenHapticsEngine.cs
using System;
using System.Linq;
using Windows.Devices.Haptics;
using Windows.UI.Input;

namespace WeaveForge.NativeHelper
{
    public class PenHapticsEngine
    {
        private SimpleHapticsController? _hapticsController;
        private SimpleHapticsControllerFeedback? _activeFeedback;
        private string _activeTool = "pen";
        private const float MinVelocityThreshold = 0.05f; // px/ms
        private const float NominalVelocity = 1.2f;       // px/ms

        public void BindToDevice(PointerPoint pointerPoint)
        {
            try {
                _hapticsController = pointerPoint.Properties.PointerDevice?.SimpleHapticsController;
            } catch (Exception ex) {
                Console.Error.WriteLine($"[Haptics] Initialization error: {ex.Message}");
            }
        }

        public void SetTool(string tool)
        {
            _activeTool = tool;
            if (_hapticsController == null) return;

            ushort targetWaveform = tool switch {
                "pen"         => KnownSimpleHapticsControllerWaveforms.PencilContinuous,
                "ballpoint"   => KnownSimpleHapticsControllerWaveforms.InkContinuous,
                "highlighter" => KnownSimpleHapticsControllerWaveforms.MarkerContinuous,
                "eraser"      => KnownSimpleHapticsControllerWaveforms.EraserContinuous,
                _             => KnownSimpleHapticsControllerWaveforms.PencilContinuous
            };

            _activeFeedback = _hapticsController.SupportedFeedback
                .FirstOrDefault(f => f.Waveform == targetWaveform);
        }

        /// <summary>
        /// Real-time modulation called on high-frequency PointerUpdate (120-240 Hz).
        /// Modulates tactile resistance based on instantaneous pressure and velocity.
        /// </summary>
        public void UpdateDynamics(float pressure, float velocity)
        {
            if (_hapticsController == null || _activeFeedback == null) return;

            // Kinetic friction check: if pen is stationary, stop buzzing immediately
            if (velocity < MinVelocityThreshold) {
                _hapticsController.StopHaptics();
                return;
            }

            // Calculate perceptual friction intensity
            float velocityFactor = Math.Min(1.0f, velocity / NominalVelocity);
            float pressureFactor = MathF.Pow(Math.Clamp(pressure, 0.05f, 1.0f), 0.75f);
            float intensity = Math.Clamp(pressureFactor * velocityFactor, 0.15f, 1.0f);

            _hapticsController.SendHapticFeedback(_activeFeedback, intensity);
        }

        public void StopStroke()
        {
            _hapticsController?.StopHaptics();
        }
    }
}
```

### 4.4 Stdio Communication Protocol from Electron

Over the existing JSON-RPC pipe:
```json
// Tool selection on toolbar change:
{"cmd":"haptics_tool", "tool":"pen"}

// Dynamic modulation during active stroke (throttled to 120 Hz animation frame):
{"cmd":"haptics_update", "pressure":0.68, "velocity":0.85}

// On pointerup / pen lift (instant zero-latency stop):
{"cmd":"haptics_stop"}
```

---

## 5. Universal Inking Feel Architecture: Taper & Dual 1-Euro Filter

Regardless of whether inking occurs through a native micro-bridge or pure WebGL2 in the browser, the stroke must feel **physically authentic**.

### 5.1 Dual-Channel 1-Euro Filter (D13)

Active digitizers introduce high-frequency discretization noise and electromagnetic ripple from display backlights. Unfiltered coordinates exhibit visible staircasing during deliberate writing; traditional moving average filters cause sluggish rubber-banding.

WeaveForge deploys the adaptive **1-Euro Filter** (Casiez et al. 2012) across **both spatial coordinates and pressure**:

$$\hat{x}_i = \alpha_i x_i + (1 - \alpha_i) \hat{x}_{i-1}, \quad \alpha_i = \frac{1}{1 + \frac{\tau_i}{T_e}}, \quad \tau_i = \frac{1}{2\pi f_{c,i}}$$

$$f_{c,i} = f_{c,\min} + \beta \cdot \|\dot{x}_i\|$$

| Channel | $f_{c,\min}$ | $\beta$ | Physical Rationale |
| :--- | :--- | :--- | :--- |
| **Position $(x, y)$** | **1.0 Hz** | **0.007** | Damps micro-tremor and grid quantization during deliberate strokes; phases out to 0 ms lag at writing speeds. |
| **Pressure $(p)$** | **0.8 Hz** | **0.004** | Eliminates discrete ADC step-banding (beading) on pressure sensors, guaranteeing silky smooth width transitions. |

### 5.2 Calligraphic Nib Width & Anti-Blobbing Taper

Natural pen nibs dynamically widen under pressure and thin out at high drawing velocities. Furthermore, when lifting a stylus, human hands accelerate upward, causing rapid pressure drops that can form unsightly blunt "blobs" if unmanaged.

WeaveForge computes rendered width $w_i$ at sample $i$:

$$w_i = w_{\text{base}} \times \left[ 0.7 \cdot p_i^{0.8} + 0.3 \cdot \exp\left(-\frac{v_i}{4.0}\right) \right]$$

* **Perceptual Gamma ($0.8$):** Compresses high-pressure response to match physical nib flex.
* **Velocity Thinning ($e^{-v / 4.0}$):** Naturally tapers rapid cursive loops.
* **Nib Lift Taper:** On `pointerup` / `ACTION_UP`, the final 3 points are smoothly interpolated down to $w \to 0$, creating a sharp, elegant calligraphic exit tip.

---

## 6. Palm Rejection & Feel Matrix Across All Platforms

| Dimension | Windows (Surface Pro) | Android (Samsung S-Pen) | iPadOS (Apple Pencil) | Pure Web / PWA Fallback |
| :--- | :--- | :--- | :--- | :--- |
| **Shell Model** | Electron 33 | 1-File `WebView` Shell | 1-File `WKWebView` Shell | Any Modern Browser |
| **Inking Accelerator** | DirectComposition Delegated Ink | Jetpack `CanvasFrontBufferedRenderer` | Apple PencilKit (`PKCanvasView`) | WebGL2 Worker + `getPredictedEvents()` |
| **Glass-to-Glass Latency** | **~9 ms** | **~6 ms** | **~9 ms** | **~12–15 ms** |
| **Hardware Palm Rejection** | MPP 2.6 firmware hover-off | EMR/USI Hover-Lock state machine | Apple `drawingPolicy = .pencilOnly` | App-level 3-layer `InkPenGate` |
| **Touch Gesture Routing** | 2-finger zoom/pan via CSS | 2-finger pass; 1-finger palm swallowed | 2-finger pass; 1-finger palm swallowed | 2-finger zoom/pan via `touch-action` |
| **Tactile Feel Technology** | Surface Slim Pen 2 paper haptics | Native S-Pen tip friction | Pencil Pro squeeze/barrel haptics | Visual calligraphic taper |
| **Dynamic Haptic Friction** | Pressure + velocity modulation | N/A (passive stylus) | Snap / selection pulses | N/A |
| **Curve Smoothing** | Dual 1-Euro $(x, y, p)$ | Dual 1-Euro $(x, y, p)$ | Metal CoreGraphics native | Dual 1-Euro $(x, y, p)$ |
| **Lines of Native Code** | ~50 lines C# (in helper) | ~140 lines Kotlin (1 file) | ~110 lines Swift (1 file) | **0 lines** |

---

## 7. Quality Assurance & Verification Suite

To verify proper palm rejection and writing feel across all builds:

1. **"Rest-Before-Write" Palm Test:**
   * Rest the palm/wrist firmly on the lower half of the screen.
   * Wait 300 ms.
   * Begin writing with the stylus.
   * **Pass Criterion:** Zero accidental canvas scrolling, zero stray ink dots, and the first stroke starts instantaneously without dropped samples.
2. **"Mid-Stroke Palm Brush" Test:**
   * Begin writing a continuous sentence.
   * Repeatedly brush or rest the palm heel against the glass while in motion.
   * **Pass Criterion:** Stroke continuity is 100% maintained; no viewport jitter or cancellations.
3. **"Two-Finger Navigation" Test:**
   * Place two fingers on the glass and perform a pinch-to-zoom and pan gesture.
   * **Pass Criterion:** Viewport pans and scales smoothly; no wet ink strokes are generated.
4. **"Stationary Stylus Haptic Silence" Test (Windows):**
   * Press the Surface Slim Pen 2 firmly against the screen and hold it motionless for 2 seconds.
   * **Pass Criterion:** Haptic vibration completely stops when velocity drops below $0.05\text{ px/ms}$; no continuous buzzing while resting in place.
