package org.weaveforge.ink

import android.content.Context
import android.util.AttributeSet
import android.view.MotionEvent
import android.view.View
import android.widget.FrameLayout

/**
 * The parent that decides whether a touch stream is the web view's or the pen's.
 *
 * This exists because the overlay and the `WebView` were siblings, and a sibling
 * cannot revise an ownership decision: a view that returns `false` from
 * `ACTION_DOWN` never sees the rest of that gesture, and a view that returns
 * `true` owns it outright with no way to hand it back. The rules the product wants
 * are inherently mid-gesture — "one finger pans, unless a palm joins, in which
 * case stop" — and `onInterceptTouchEvent` is the only place Android lets you
 * express them.
 *
 * The container is deliberately thin: [InkGestureRouter] holds the rules and this
 * class only translates them into view calls. That split is what makes the rules
 * testable without a device, which matters for the one part of this module that is
 * hardest to debug on hardware and has already been wrong once.
 *
 * With no ink tool selected the container claims nothing and never intercepts, so a
 * mouse, a trackpad and a page with no ink surface behave exactly as they did
 * before this class existed.
 */
class InkGestureView @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null,
) : FrameLayout(context, attrs) {

    /** The page. Receives every gesture the router passes through. */
    var webView: View? = null

    /** The ink surface. Receives the pen, and absorbs palms and extra fingers. */
    var overlay: InkingOverlayView? = null

    private val router = InkGestureRouter()

    /** What the router decided for the current event. */
    private var route = GestureRoute.PASS_THROUGH

    /** The tool selection, which is what decides who owns a gesture. */
    var toolMode: InkToolMode = InkToolMode.NONE
        set(value) {
            if (field == value) return
            field = value
            // Standing down mid-stroke must not leave a half-drawn stroke latched or
            // a gesture half-routed.
            if (value == InkToolMode.NONE) {
                overlay?.clear()
                router.reset()
                route = GestureRoute.PASS_THROUGH
            }
        }

    override fun onInterceptTouchEvent(ev: MotionEvent): Boolean {
        route = router.route(ev.flatten(), toolMode, route)
        // `true` makes the framework cancel whichever child had the gesture, which is
        // what stops a pan already in progress. The event is then handed to
        // `onTouchEvent` below rather than to the child.
        return route == GestureRoute.INTERCEPT
    }

    override fun onTouchEvent(event: MotionEvent): Boolean {
        return when (route) {
            GestureRoute.PASS_THROUGH ->
                // Not reachable through the framework — interception was false, so the
                // child consumed the event — but a re-dispatch would land here, and
                // forwarding an event the child has already seen would apply it twice.
                true

            GestureRoute.CAPTURE_PEN -> {
                overlay?.dispatchTouchEvent(event)
                if (endsGesture(event)) router.reset()
                true
            }

            GestureRoute.INTERCEPT -> {
                // Absorbed: a palm, or more fingers than a page gesture uses. If the
                // page was moving it has been cancelled by now, so the paper simply
                // stops under the resting hand.
                if (endsGesture(event)) router.reset()
                true
            }
        }
    }

    /**
     * Whether this event ends the whole gesture.
     *
     * A pen lifting while a palm stays down ends the *stroke* but not the gesture,
     * and the router tracks that distinction itself — so this only resets on the
     * events that end everything.
     */
    private fun endsGesture(event: MotionEvent): Boolean = when (event.actionMasked) {
        MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> true
        else -> false
    }

    override fun onDetachedFromWindow() {
        router.reset()
        route = GestureRoute.PASS_THROUGH
        super.onDetachedFromWindow()
    }

    override fun onViewAdded(child: View?) {
        super.onViewAdded(child)
        // Convenience wiring, so the activity's `findViewById` is not load-bearing:
        // the two ids in the layout are the contract. Child ids are null at XML parse
        // time and non-null by the time a child is added, so this is the first point
        // at which they can be read.
        when (child?.id) {
            R.id.webView -> webView = child
            R.id.inkOverlay -> (child as? InkingOverlayView)?.let { overlay = it }
        }
    }
}

/**
 * `MotionEvent` → the router's flat shape.
 *
 * One conversion, in one place. Every field the router reads is copied here, and
 * nothing Android-specific crosses into [InkGestureRouter], which is what lets the
 * rules run as a JVM test.
 */
internal fun MotionEvent.flatten(): GestureEvent {
    val pointers = (0 until pointerCount).map { i ->
        PointerSample(
            id = getPointerId(i),
            toolType = getToolType(i),
            major = getTouchMajor(i),
            minor = getTouchMinor(i),
            size = getSize(i),
            x = getX(i),
            y = getY(i),
        )
    }
    val phase = when (actionMasked) {
        MotionEvent.ACTION_DOWN -> GesturePhase.DOWN
        MotionEvent.ACTION_POINTER_DOWN -> GesturePhase.POINTER_DOWN
        MotionEvent.ACTION_MOVE -> GesturePhase.MOVE
        MotionEvent.ACTION_POINTER_UP -> GesturePhase.POINTER_UP
        MotionEvent.ACTION_UP -> GesturePhase.UP
        // Anything else — hover, scroll, a button press — is not a phase the router has
        // rules for, and cancelling is the safe reading: it clears state rather than
        // acting on a phase the rules were not written for.
        else -> GesturePhase.CANCEL
    }
    val index = actionIndex.coerceIn(0, (pointerCount - 1).coerceAtLeast(0))
    return GestureEvent(
        phase = phase,
        pointers = pointers,
        actionIndex = index,
        actionId = if (index in 0 until pointerCount) getPointerId(index) else -1,
        touchMajor = touchMajor,
        touchMinor = touchMinor,
        size = size,
    )
}
