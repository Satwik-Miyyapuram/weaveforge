package org.weaveforge.ink

/**
 * What the ink tool is set to, which is what decides who owns a gesture.
 *
 * The tool selection drives routing, not a separate "pen only" switch. That is
 * how a stylus app behaves in practice: pick Select and the pen manipulates the
 * page; pick Pen or Highlighter and the pen writes.
 *
 * `none` exists because the overlay must be able to stand down completely — a
 * mouse, a trackpad, or a tool the shell does not know how to ink with. In
 * `none` the overlay claims nothing at all and every event goes to the web view,
 * which is the only mode in which a mouse works normally.
 */
enum class InkToolMode {
    /** Mouse, trackpad, or no ink tool: the overlay claims nothing. */
    NONE,

    /** Pen and Highlighter: one finger moves the paper, two move and zoom. */
    INK,
}

/**
 * One pointer in a `MotionEvent`, flattened.
 *
 * The router is deliberately not given an Android `MotionEvent`: these fields are
 * the entirety of what it reads, so its rules can be exercised as a pure function
 * on a build machine with no device and no emulator. The gesture rules are the
 * part most likely to be wrong and the part a device makes hardest to debug.
 */
data class PointerSample(
    val id: Int,
    val toolType: Int,
    /** Contact width and height in pixels, for the palm test. */
    val major: Float,
    val minor: Float,
    val size: Float,
    val x: Float,
    val y: Float,
)

/** What one event means for the pointer stream. */
enum class GestureRoute {
    /**
     * The web view keeps this event. It pans on one finger and pans-and-zooms on
     * two, natively, with its own momentum and rubber-banding.
     */
    PASS_THROUGH,

    /**
     * The container takes the gesture. The framework cancels the web view, so the
     * page stops moving and the remaining events are absorbed while the overlay
     * applies its own rule (reject the palm, or draw with the pen).
     */
    INTERCEPT,

    /** The pen is writing: the overlay captures and latches its pointer. */
    CAPTURE_PEN,
}

enum class GesturePhase { DOWN, POINTER_DOWN, MOVE, POINTER_UP, UP, CANCEL }

/** One flattened `MotionEvent`: the phase plus every pointer it carries. */
data class GestureEvent(
    val phase: GesturePhase,
    val pointers: List<PointerSample>,
    /** Which pointer the phase is about, for `POINTER_DOWN` / `POINTER_UP`. */
    val actionIndex: Int,
    val actionId: Int,
    val touchMajor: Float,
    val touchMinor: Float,
    val size: Float,
)

/**
 * Which view owns a touch stream, for the pen and for fingers.
 *
 * ## The problem this exists to solve
 *
 * `activity_main.xml` has the `WebView` and this overlay as *siblings* inside a
 * `FrameLayout`. A view that returns `false` from `ACTION_DOWN` never sees the
 * rest of that gesture; a view that returns `true` owns it outright and cannot
 * hand it back. So an overlay that wants "one finger pans, but a palm arriving
 * later must not pan" cannot express that in `onTouchEvent` — the first finger
 * either reaches the page or it does not, and the palm decision comes after.
 *
 * `ViewGroup.onInterceptTouchEvent` exists for exactly this: it can watch a
 * gesture it did not claim and take it over mid-stream, at which point the
 * framework cancels the child. `InkTouchRouter` holds the state machine and this
 * file holds the rules; `InkGestureView` is the thin container that wires them to
 * Android. Keeping the rules here is what makes them testable without a device.
 *
 * ## The rules
 *
 * With **no** ink tool selected (mouse, trackpad, nothing):
 * everything passes through — nothing is claimed, so a mouse behaves normally.
 *
 * With **Pen** or **Highlighter** selected:
 *
 * | Contact | Outcome |
 * | --- | --- |
 * | the pen (stylus / eraser) | `CAPTURE_PEN` — it writes |
 * | one finger | `PASS_THROUGH` — it moves the paper |
 * | two fingers | `PASS_THROUGH` — they move and zoom the paper together |
 * | three or more fingers | `INTERCEPT` — absorbed; not a page gesture |
 * | a palm (large contact) | `INTERCEPT` — absorbed, and if the page was moving it stops |
 *
 * The palm is only rejected once the contact has kept its size for
 * [PALM_SETTLE_SAMPLES]; see the comment on that constant for why a single
 * oversized sample is not enough to call it a palm.
 */
class InkGestureRouter {
    /** True between the first contact and the last one leaving. */
    private var gestureActive = false

    /** The pen's pointer id while the pen is down, else -1. */
    private var penPointerId = -1

    /** How many consecutive samples have looked like a palm. */
    private var palmSamples = 0

    /** True once this gesture has been decided to be a palm (or too many fingers). */
    private var absorbed = false

    /** The tool the current gesture started under; a mid-gesture change must not re-route it. */
    private var activeTool: InkToolMode? = null

    companion object {
        const val TOOL_TYPE_STYLUS = 2
        const val TOOL_TYPE_ERASER = 4
        const val TOOL_TYPE_FINGER = 1

        /** A contact wider than this is a hand's heel, not a fingertip. */
        const val PALM_MAJOR_PX = 180f
        const val PALM_SIZE = 0.42f

        /**
         * Consecutive samples a contact must look palm-sized before we act.
         *
         * `touchMajor` is noisy on the first one or two samples of any contact —
         * drivers report an optimistic width while the digitizer is still
         * settling — so acting on sample one would throw away the first frames of
         * a legitimate finger pan. Two settled samples is under 40 ms at a normal
         * touch rate and reliably separates a heel from a fingertip.
         */
        const val PALM_SETTLE_SAMPLES = 2

        /** Fingers allowed to keep a page gesture. A third is not a page gesture. */
        const val MAX_PAGE_FINGERS = 2

        fun isPenTool(toolType: Int): Boolean =
            toolType == TOOL_TYPE_STYLUS || toolType == TOOL_TYPE_ERASER
    }

    /** Forget everything. Called when the view is detached. */
    fun reset() {
        gestureActive = false
        penPointerId = -1
        palmSamples = 0
        absorbed = false
        activeTool = null
    }

    /** Which pointer the pen is, or -1. Read by the overlay. */
    fun penPointer(): Int = penPointerId

    /**
     * Decide what to do with `event` while the tool is `tool`.
     *
     * `previous` is what the container did with the last event of this gesture,
     * which is what lets a decision be *revised*: a finger pan that a palm then
     * joins goes from `PASS_THROUGH` to `INTERCEPT`, and that transition is the
     * whole reason this class exists.
     */
    fun route(
        event: GestureEvent,
        tool: InkToolMode,
        previous: GestureRoute,
    ): GestureRoute {
        if (event.phase == GesturePhase.DOWN) {
            gestureActive = true
            penPointerId = -1
            palmSamples = 0
            absorbed = false
            activeTool = tool
        }

        // The tool the gesture began under governs it. A user who taps Pen while a
        // two-finger zoom is in flight should not have the zoom become a stroke.
        val effective = activeTool ?: tool

        if (event.phase == GesturePhase.CANCEL) {
            reset()
            return GestureRoute.PASS_THROUGH
        }

        val lifting = event.phase == GesturePhase.UP || event.phase == GesturePhase.POINTER_UP

        // Nothing is ever claimed without an ink tool: a mouse, a trackpad and a
        // plain browser session all need the web view to see everything.
        if (effective == InkToolMode.NONE) {
            if (event.phase == GesturePhase.UP) reset()
            return GestureRoute.PASS_THROUGH
        }

        // The pen, at any index. A palm can be pointer 0 and the pen pointer 1, so
        // the action's own index decides — never index 0.
        val actionPointer = event.pointers.getOrNull(event.actionIndex)
        if (actionPointer != null && isPenTool(actionPointer.toolType)) {
            if (event.phase == GesturePhase.DOWN || event.phase == GesturePhase.POINTER_DOWN) {
                penPointerId = actionPointer.id
                palmSamples = 0
                absorbed = false
                return GestureRoute.CAPTURE_PEN
            }
            if (lifting && actionPointer.id == penPointerId) {
                penPointerId = -1
                if (event.phase == GesturePhase.UP) reset()
                return GestureRoute.CAPTURE_PEN
            }
        }

        // A stream the pen already owns stays with it, whichever pointer this
        // particular action names. A palm arriving or leaving mid-stroke must not
        // be read as a page gesture, and must not end the stroke either.
        if (penPointerId != -1 && event.pointers.any { it.id == penPointerId }) {
            return GestureRoute.CAPTURE_PEN
        }

        // A gesture already absorbed stays absorbed: the web view has been
        // cancelled, so handing an event back mid-gesture would deliver events for
        // a stream the page no longer considers live.
        if (absorbed) {
            if (event.phase == GesturePhase.UP) reset()
            return GestureRoute.INTERCEPT
        }

        val contact = actionPointer ?: event.pointers.firstOrNull()

        // Geometry first, so a palm is rejected the moment it is recognised.
        // `actionIndex` on a MOVE is 0 by definition, so the size test reads the
        // event-level aggregate there instead of one pointer's box.
        val major = if (event.phase == GesturePhase.MOVE) event.touchMajor else (contact?.major ?: 0f)
        val minor = if (event.phase == GesturePhase.MOVE) event.touchMinor else (contact?.minor ?: 0f)
        val size = if (event.phase == GesturePhase.MOVE) event.size else (contact?.size ?: 0f)
        val palmShaped = major > PALM_MAJOR_PX && minor > PALM_MAJOR_PX || size > PALM_SIZE

        palmSamples = if (palmShaped) palmSamples + 1 else 0
        if (palmSamples >= PALM_SETTLE_SAMPLES) {
            absorbed = true
            return GestureRoute.INTERCEPT
        }

        // More fingers than a page gesture uses. Two move and zoom together; the
        // third is a resting hand, so the gesture is absorbed from here on.
        if (event.pointers.size > MAX_PAGE_FINGERS) {
            absorbed = true
            return GestureRoute.INTERCEPT
        }

        if (event.phase == GesturePhase.UP) reset()
        // One finger moves the paper, two move and zoom it. Both are the web
        // view's, with its own momentum — so this is a pass-through, not a
        // synthesised gesture of our own.
        return GestureRoute.PASS_THROUGH
    }
}
