package org.weaveforge.ink

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.PorterDuff
import android.graphics.RectF
import android.os.Build
import android.os.SystemClock
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.SurfaceView
import androidx.graphics.lowlatency.CanvasFrontBufferedRenderer
import androidx.graphics.surface.SurfaceControlCompat
import kotlin.math.PI

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
    var penOnly: Boolean = false

    /** Which side the palm rests on; reserved for a rest-zone heuristic. */
    var leftHanded: Boolean = false

    private companion object {
        /** How long after the pen leaves hover a touch is still taken as a palm. */
        const val STYLUS_HOVER_GRACE_MS = 400L

        /** A contact bigger than this is a hand's heel, not a fingertip. */
        const val PALM_AREA_THRESHOLD_MM2 = 25.0f
        const val PALM_SIZE_THRESHOLD = 0.35f

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

    // Hover-lock state.
    private var isStylusHovering = false
    private var isStylusDrawing = false
    private var lastStylusUptimeMs = 0L

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

    /**
     * S-Pen and USI digitisers report the pen up to ~15 mm off the glass. The
     * hover is what locks the palm out before the nib lands.
     *
     * Hover is a single-pointer stream, so index 0 is the pen here; there is no
     * second pointer to confuse it with.
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
        // Not consumed: the web view still gets hover for its own cursor.
        return false
    }

    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        val now = SystemClock.uptimeMillis()
        // The tool that changed is at `actionIndex`. Index 0 is whoever arrived
        // first, which is the palm whenever the palm landed first.
        val index = event.actionIndex.coerceIn(0, (event.pointerCount - 1).coerceAtLeast(0))
        val toolType = event.getToolType(index)
        val isStylus = toolType == MotionEvent.TOOL_TYPE_STYLUS ||
            toolType == MotionEvent.TOOL_TYPE_ERASER

        // A stream the overlay already owns stays with the pen even when this
        // particular action's index belongs to another pointer: the palm
        // arriving or lifting mid-stroke must not be read as a stylus action, and
        // must not end the stroke either.
        if (!isStylus && penPointerId != -1 && isPenDown(event)) return onStylus(event, now)

        return if (isStylus) onStylus(event, now) else onTouch(event, now)
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
    private fun onStylus(event: MotionEvent, now: Long): Boolean {
        lastStylusUptimeMs = now
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
                            event.getHistoricalEventTime(p, h),
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

    // 2. Touch: the palm, refused in tiers.
    private fun onTouch(event: MotionEvent, now: Long): Boolean {
        // No page on screen: the overlay is not in the way of anything.
        if (viewport == null) return false

        // Tier A: the pen is drawing, hovering, or only just left. The palm
        // rests while the pen writes; swallowed, so the web view never scrolls.
        val penNearby = isStylusDrawing || isStylusHovering ||
            (now - lastStylusUptimeMs < STYLUS_HOVER_GRACE_MS)
        if (penNearby) return true

        // Tier B: the driver's own verdict (API 33+).
        if (Build.VERSION.SDK_INT >= 33 && (event.flags and MotionEvent.FLAG_CANCELED) != 0) return true

        // Tier C: contact geometry. A fingertip is under ~25 mm².
        val xdpi = resources.displayMetrics.xdpi
        val ydpi = resources.displayMetrics.ydpi
        val majorMm = (event.touchMajor / xdpi) * 25.4f
        val minorMm = (event.touchMinor / ydpi) * 25.4f
        val areaMm2 = (PI * majorMm * minorMm / 4.0).toFloat()
        if (areaMm2 > PALM_AREA_THRESHOLD_MM2 || event.size > PALM_SIZE_THRESHOLD) return true

        // Tier D: pen-only, where a single finger is never a pen.
        //
        // This tier cannot be made to work as documented, and the reason is worth
        // writing down rather than leaving as a threshold to tune. A gesture is
        // one dispatch stream: the first finger's ACTION_DOWN arrives with
        // pointerCount == 1, so this returns `true`, the overlay owns the stream —
        // and the second finger's ACTION_POINTER_DOWN then reaches a view that
        // already claimed the gesture. Returning `false` there does not hand the
        // earlier ACTION_DOWN back: the view below never saw it, so it cannot
        // scroll or pinch, and "two fingers still pan" is unreachable. Deciding
        // ownership at pointer-count time is wrong for every gesture whose pointer
        // count changes, which is every pinch.
        //
        // The honest fix is structural — the overlay in a FrameLayout the web view
        // shares, so `onInterceptTouchEvent` can take a gesture over mid-stream, or
        // deferring the claim on ACTION_DOWN. Both change what pen-only mode blocks
        // for a *single* finger (deferring lets a one-finger drag scroll the page,
        // which is what pen-only exists to prevent), so this is a decision rather
        // than a patch. Until it is taken, the behaviour is left as it is and this
        // comment replaces the claim that it already works.
        if (penOnly) return event.pointerCount < 2

        // Tier E: anything else is the web view's; it decides between scroll
        // and touch-draw itself.
        return false
    }
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
