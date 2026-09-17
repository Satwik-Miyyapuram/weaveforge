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
import org.json.JSONArray
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
    }

    /** The ink page's box in view pixels, or null when no page is on screen. */
    private var viewport: RectF? = null

    // Hover-lock state.
    private var isStylusHovering = false
    private var isStylusDrawing = false
    private var lastStylusUptimeMs = 0L

    // The stroke in flight.
    private val strokePoints = ArrayList<Float>(4 * 512)
    private var lastX = 0f
    private var lastY = 0f
    private var hasLast = false
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
        renderer.clear()
    }

    private fun inViewport(x: Float, y: Float): Boolean = viewport?.contains(x, y) ?: false

    /**
     * S-Pen and USI digitisers report the pen up to ~15 mm off the glass. The
     * hover is what locks the palm out before the nib lands.
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
        val toolType = event.getToolType(0)
        val isStylus = toolType == MotionEvent.TOOL_TYPE_STYLUS || toolType == MotionEvent.TOOL_TYPE_ERASER
        val now = SystemClock.uptimeMillis()
        return if (isStylus) onStylus(event, now) else onTouch(event, now)
    }

    // 1. The stylus: raw digitiser samples, batched history included.
    private fun onStylus(event: MotionEvent, now: Long): Boolean {
        lastStylusUptimeMs = now
        when (event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                // Outside the page the pen is a pointer for the web view.
                if (!inViewport(event.x, event.y)) return false
                clear()
                isStylusDrawing = true
                record(event.x, event.y, event.pressure, event.eventTime)
                return true
            }
            MotionEvent.ACTION_MOVE -> {
                if (!isStylusDrawing) return false
                for (i in 0 until event.historySize) {
                    record(
                        event.getHistoricalX(i),
                        event.getHistoricalY(i),
                        event.getHistoricalPressure(i),
                        event.getHistoricalEventTime(i),
                    )
                }
                record(event.x, event.y, event.pressure, event.eventTime)
                return true
            }
            MotionEvent.ACTION_UP -> {
                if (!isStylusDrawing) return false
                record(event.x, event.y, event.pressure, event.eventTime)
                isStylusDrawing = false
                val json = JSONArray(strokePoints).toString()
                strokePoints.clear()
                hasLast = false
                // The wet stroke stays on the front buffer until the web app
                // has drawn its own and calls clearOverlay(), so there is no
                // frame with the stroke missing in between.
                onStrokeFinished?.invoke(json)
                return true
            }
            MotionEvent.ACTION_CANCEL -> {
                val wasDrawing = isStylusDrawing
                clear()
                return wasDrawing
            }
        }
        return isStylusDrawing
    }

    private fun record(x: Float, y: Float, pressure: Float, t: Long) {
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

        // Tier D: pen-only, where a single finger is never a pen — but two
        // fingers still pan and pinch the page beneath.
        if (penOnly) return event.pointerCount < 2

        // Tier E: anything else is the web view's; it decides between scroll
        // and touch-draw itself.
        return false
    }
}
