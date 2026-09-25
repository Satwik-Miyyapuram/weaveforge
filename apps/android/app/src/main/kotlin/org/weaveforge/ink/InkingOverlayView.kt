package org.weaveforge.ink

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.RectF
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.SurfaceView
import androidx.graphics.lowlatency.CanvasFrontBufferedRenderer
import androidx.graphics.surface.SurfaceControlCompat

/**
 * A transparent, front-buffered stylus surface over the web view.
 *
 * The wet stroke is written straight into the scanout buffer through
 * [CanvasFrontBufferedRenderer] — roughly 6 ms from nib to pixel, against the
 * web view's 30–50. Only the newest segment is drawn per sample, so the cost
 * per event is a short line, not the whole path.
 *
 * The web side says where the page is ([setViewport]); a stylus outside that
 * rect, or with no rect set, is not ours and goes to the web view, so the pen
 * still taps buttons and scrolls the rest of the app. Inside the rect every
 * stylus event is taken, and touch is refused in tiers: while the pen is
 * near (hover-lock), when the driver flagged a palm, when the contact is
 * bigger than a fingertip, and — in pen-only mode — always, save for two or
 * more fingers, which pan and pinch the page underneath.
 *
 * ## Pointers, not a pointer
 *
 * Every decision here reads the pointer the event is *about*
 * (`actionIndex`, `getToolType(index)`) and captures along the latched pen
 * pointer, never index 0. A `MotionEvent` is a stream over a set of pointers, and
 * the pen is not reliably the first one: a left-handed writer puts the palm down
 * before the nib lands, so the palm is pointer 0 and the pen arrives later as
 * `ACTION_POINTER_DOWN`.
 */
class InkingOverlayView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : SurfaceView(context, attrs) {

    /** Called with the stroke as a JSON array `[x, y, p, t, ...]` in view pixels. */
    var onStrokeFinished: ((String) -> Unit)? = null

    /**
     * Whether the user asked for pen-only behaviour.
     *
     * Read by the web side's own gate, not by anything here. Routing is
     * [InkGestureView]'s job now, and in pen-only mode a finger still moves the
     * paper and two fingers still move and zoom it — so this flag no longer decides
     * what this view receives.
     */
    var penOnly: Boolean = false

    /** Which side the palm rests on; reserved for a rest-zone heuristic. */
    var leftHanded: Boolean = false

    private companion object {
        /**
         * The most samples one stroke may hold.
         *
         * A continuous highlighter pass is minutes of samples at the digitiser
         * rate, and the buffer is cleared per stroke — but "per stroke" is not a
         * bound. 32 000 samples is several minutes of 90 Hz pen input, well past
         * any real stroke, and a stroke that reaches it is finished early with
         * the samples it has rather than allocating until the pen lifts.
         */
        const val MAX_STROKE_SAMPLES = 32_000
    }

    /** The ink page's box in view pixels, or null when no page is on screen. */
    private var viewport: RectF? = null

    private var isStylusDrawing = false

    /**
     * Which pointer the pen is, or `-1` when no pen is down.
     *
     * Deciding stylus-versus-finger from `getToolType(0)` and then reading
     * coordinates from `event.x`/`event.y` — which are pointer **0**'s — does
     * nothing at all when the palm arrived first: the pen's arrival is
     * `ACTION_POINTER_DOWN` at index 1, an action the `when` did not handle, so
     * the stroke never starts and every subsequent `ACTION_MOVE` returns false.
     * The user sees an app that "does not ink when my hand is down", which is
     * exactly the situation the hover-lock tier exists to prevent and which
     * single-pointer testing cannot reproduce. Latching the pen's own pointer id
     * is the fix; `getToolType(index)`, never `getToolType(0)`, is the rule.
     */
    private var penPointerId = -1

    // The stroke in flight.
    private val strokePoints = ArrayList<Float>(4 * 512)
    private var lastX = 0f
    private var lastY = 0f
    private var hasLast = false
    private var strokeTruncated = false
    private var baseWidth = 4f

    private val penPaint = Paint().apply {
        color = Color.BLACK
        strokeWidth = 4f
        style = Paint.Style.STROKE
        strokeCap = Paint.Cap.ROUND
        strokeJoin = Paint.Join.ROUND
        isAntiAlias = true
    }

    /** One segment of the wet stroke: the renderer's per-call parameter. */
    private class Segment(val x0: Float, val y0: Float, val x1: Float, val y1: Float, val width: Float)

    private val renderer = CanvasFrontBufferedRenderer(
        this,
        object : CanvasFrontBufferedRenderer.Callback<Segment> {
            override fun onDrawFrontBufferedLayer(
                canvas: Canvas,
                bufferWidth: Int,
                bufferHeight: Int,
                param: Segment,
            ) {
                penPaint.strokeWidth = param.width
                canvas.drawLine(param.x0, param.y0, param.x1, param.y1, penPaint)
            }

            override fun onDrawMultiBufferedLayer(
                canvas: Canvas,
                bufferWidth: Int,
                bufferHeight: Int,
                params: Collection<Segment>,
            ) {
                // Nothing is committed here: the web app's renderer owns the
                // dry stroke. Clearing keeps the surface transparent.
                canvas.drawColor(Color.TRANSPARENT, PorterDuff.Mode.CLEAR)
            }

            override fun onFrontBufferedLayerRenderComplete(
                frontBufferedLayerSurfaceControl: SurfaceControlCompat,
                transaction: SurfaceControlCompat.Transaction,
            ) {
                // The wet stroke sits over the web view's own surface.
                transaction.setLayer(frontBufferedLayerSurfaceControl, 1)
            }
        },
    )

    init {
        setZOrderOnTop(true)
        holder.setFormat(PixelFormat.TRANSLUCENT)
        isFocusable = false
    }

    fun setViewport(left: Float, top: Float, width: Float, height: Float) {
        viewport = RectF(left, top, left + width, top + height)
    }

    fun clearViewport() {
        viewport = null
        if (isStylusDrawing) clear()
    }

    fun setPenStyle(colour: Int, widthPx: Float) {
        penPaint.color = colour
        baseWidth = widthPx.coerceAtLeast(0.5f)
    }

    /** Drop the wet stroke; the web app has, or has refused, the committed one. */
    fun clear() {
        strokePoints.clear()
        isStylusDrawing = false
        hasLast = false
        strokeTruncated = false
        penPointerId = -1
        renderer.clear()
    }

    /** Release everything that outlives the surface. Called from `onDestroy`. */
    fun release() {
        onStrokeFinished = null
        clear()
    }

    private fun inViewport(x: Float, y: Float): Boolean = viewport?.contains(x, y) ?: false

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        // Every event that reaches this view is the pen's. The decision about which
        // view owns a touch stream lives in `InkGestureRouter`, behind
        // `InkGestureView.onInterceptTouchEvent` — a palm is rejected and a finger is
        // passed to the web view *there*, because that is the only place a
        // mid-gesture decision can be made. What used to be here was a five-tier
        // policy in `onTouchEvent`, and the last of those tiers could not work at all:
        // it claimed the gesture at `ACTION_DOWN` and then tried to give two-finger
        // gestures back, which no sibling view can do.
        //
        // So this stays a single-pointer state machine over the pen, with the one
        // correction the old version needed: the action's own index decides the tool,
        // never index 0, because a palm that landed first is pointer 0.
        val index = event.actionIndex.coerceIn(0, (event.pointerCount - 1).coerceAtLeast(0))
        val toolType = event.getToolType(index)
        val isStylus = toolType == MotionEvent.TOOL_TYPE_STYLUS ||
            toolType == MotionEvent.TOOL_TYPE_ERASER

        // A stream the overlay already owns stays with the pen even when this
        // particular action's index belongs to another pointer: the palm arriving or
        // lifting mid-stroke must not be read as a stylus action, and must not end the
        // stroke either.
        if (!isStylus && penPointerId != -1 && isPenDown(event)) return onStylus(event)

        return if (isStylus) onStylus(event) else false
    }

    /** Whether the latched pen pointer is still part of this event. */
    private fun isPenDown(event: MotionEvent): Boolean {
        for (i in 0 until event.pointerCount) {
            if (event.getPointerId(i) == penPointerId) return true
        }
        return false
    }

    /** Whether a pointer index is the pen. */
    private fun isPenIndex(event: MotionEvent, index: Int): Boolean =
        penPointerId != -1 && event.getPointerId(index) == penPointerId

    // 1. The stylus: raw digitiser samples, batched history included.
    private fun onStylus(event: MotionEvent): Boolean {
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val index = event.actionIndex
                if (event.getToolType(index) != MotionEvent.TOOL_TYPE_STYLUS &&
                    event.getToolType(index) != MotionEvent.TOOL_TYPE_ERASER
                ) {
                    // A finger joined a stream the pen is not in yet; the palm
                    // arriving first is this case, and it changes nothing.
                    return isStylusDrawing
                }
                if (!inViewport(event.getX(index), event.getY(index))) {
                    penPointerId = -1
                    return false
                }
                clear()
                penPointerId = event.getPointerId(index)
                isStylusDrawing = true
                record(event.getX(index), event.getY(index), event.getPressure(index), event.eventTime)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (!isStylusDrawing) return false
                // Walk the pointers and take only the pen's: with the palm down
                // the pen is index 1, and reading index 0 (or every index) would
                // capture the palm's coordinates into the stroke.
                for (p in 0 until event.pointerCount) {
                    if (!isPenIndex(event, p)) continue
                    for (h in 0 until event.historySize) {
                        record(
                            event.getHistoricalX(p, h),
                            event.getHistoricalY(p, h),
                            event.getHistoricalPressure(p, h),
                            // `getHistoricalEventTime` takes only the pointer index:
                            // a batched sample has one timestamp per *event*, and
                            // `historySize` is shared across pointers. Passing `h`
                            // here is a compile error, which is the good outcome —
                            // the shape of the API is the documentation.
                            event.getHistoricalEventTime(p),
                        )
                    }
                    record(
                        event.getX(p),
                        event.getY(p),
                        event.getPressure(p),
                        event.eventTime,
                    )
                }
                return true
            }
            MotionEvent.ACTION_POINTER_UP -> {
                // The pen lifting while another pointer remains in the stream is
                // the end of the stroke, not the end of the gesture.
                if (!isStylusDrawing || !isPenIndex(event, event.actionIndex)) {
                    return isStylusDrawing
                }
                return finishStroke(event, event.actionIndex)
            }
            MotionEvent.ACTION_UP -> {
                if (!isStylusDrawing) return false
                return finishStroke(event, event.actionIndex)
            }
            MotionEvent.ACTION_CANCEL -> {
                val wasDrawing = isStylusDrawing
                clear()
                return wasDrawing
            }
        }
        return isStylusDrawing
    }

    /**
     * Commit the stroke and hand it to the web side.
     *
     * The payload is built here rather than as `JSONArray(strokePoints).toString()`,
     * which boxes every `Float` into a `java.lang.Float`, wraps each in a
     * `JSONObject` value and concatenates the lot on the main thread — about four
     * allocations per sample, at exactly the moment the user lifts the pen and
     * expects the dry stroke to commit. It is still the same JSON array of numbers
     * the web side already parses; only the allocation is gone.
     */
    private fun finishStroke(event: MotionEvent, index: Int): Boolean {
        record(event.getX(index), event.getY(index), event.getPressure(index), event.eventTime)
        isStylusDrawing = false
        penPointerId = -1
        val json = encodeStroke(strokePoints)
        strokePoints.clear()
        hasLast = false
        strokeTruncated = false
        // The wet stroke stays on the front buffer until the web app has drawn
        // its own and calls clearOverlay(), so there is no frame with the stroke
        // missing in between.
        onStrokeFinished?.invoke(json)
        return true
    }

    private fun record(x: Float, y: Float, pressure: Float, t: Long) {
        if (strokePoints.size >= MAX_STROKE_SAMPLES * SAMPLES_PER_LINE) {
            // Bounded rather than unbounded: a stroke that reaches the ceiling
            // commits the samples it has instead of allocating until the pen
            // lifts. It ends a little short of the nib's last movement, which is
            // visible; an unbounded buffer is not.
            strokeTruncated = true
            return
        }
        strokePoints.add(x)
        strokePoints.add(y)
        strokePoints.add(pressure)
        strokePoints.add(t.toFloat())
        val width = baseWidth * (0.6f + 0.8f * pressure.coerceIn(0f, 1f))
        if (hasLast) {
            renderer.renderFrontBufferedLayer(Segment(lastX, lastY, x, y, width))
        } else {
            // The first sample: a dot, as a zero-length round-capped line.
            renderer.renderFrontBufferedLayer(Segment(x, y, x, y, width))
        }
        lastX = x
        lastY = y
        hasLast = true
    }

    // The five-tier touch policy that used to live here is now `InkGestureRouter`.
}

/**
 * Floats per sample in the stroke payload: `x`, `y`, `pressure`, `t`.
 *
 * Top-level because both the view and the payload encoder read it, and two
 * copies of "four" is how an encoder and its reader drift apart.
 */
private const val SAMPLES_PER_LINE = 4

/**
 * The stroke as a JSON array of numbers: `[x, y, p, t, …]`.
 *
 * The same array `JSONArray(strokePoints).toString()` produced — the web side's
 * `nativeStrokeEvents` reads it as flat groups of four — but hand-rolled,
 * because the `JSONArray` route boxes every `Float` into a `java.lang.Float` and
 * wraps it in a `JSONObject` value: roughly four object allocations per sample,
 * on the main thread, at the moment the pen lifts. Two decimals is sub-pixel on
 * any panel; three for pressure, which is what the pen actually distinguishes.
 *
 * Timestamps are emitted as whole numbers because they are device uptime
 * milliseconds, and the reader only ever looks at differences.
 */
private fun encodeStroke(points: ArrayList<Float>): String {
    val builder = StringBuilder(points.size * 10 + 2)
    builder.append('[')
    var sample = 0
    while (sample * SAMPLES_PER_LINE < points.size) {
        if (sample > 0) builder.append(',')
        val at = sample * SAMPLES_PER_LINE
        appendFixed(builder, points[at], 2)
        builder.append(',')
        appendFixed(builder, points[at + 1], 2)
        builder.append(',')
        appendFixed(builder, points[at + 2], 3)
        builder.append(',')
        builder.append(points[at + 3].toLong())
        sample++
    }
    builder.append(']')
    return builder.toString()
}

/** Append a float with a fixed number of decimal places, without a formatter. */
private fun appendFixed(builder: StringBuilder, value: Float, decimals: Int) {
    val scale = if (decimals == 2) 100 else 1000
    val scaled = Math.round(value * scale)
    val whole = scaled / scale
    val fraction = Math.abs(scaled % scale)
    builder.append(whole)
    builder.append('.')
    var digits = decimals
    var threshold = scale / 10
    while (digits > 1) {
        if (fraction < threshold) builder.append('0')
        threshold /= 10
        digits--
    }
    builder.append(fraction)
}
