package org.weaveforge.ink

import org.junit.Assert.assertEquals
import org.junit.Test

import org.weaveforge.ink.InkGestureRouter.Companion.MAX_PAGE_FINGERS

import org.weaveforge.ink.InkGestureRouter.Companion.TOOL_TYPE_FINGER
import org.weaveforge.ink.InkGestureRouter.Companion.TOOL_TYPE_STYLUS

/**
 * The gesture rules, as rules.
 *
 * These run on a build machine with no device, which is the point: this is the
 * part of the ink overlay that a device makes hardest to debug (a palm is a
 * physical object, and "it did not ink" has a dozen possible causes), and the
 * part that has already been wrong once — an earlier version decided
 * stylus-versus-finger from `getToolType(0)` and so did nothing at all when the
 * palm landed before the nib.
 *
 * The spec they pin:
 *
 * ```
 *                  PEN / HIGHLIGHTER          NO INK TOOL
 * 1 finger         move the paper             move the paper
 * 2 fingers        move and zoom              move and zoom
 * 3+ fingers       rejected                   rejected
 * palm             rejected                   rejected
 * pen              writes                     —
 * ```
 */
class InkGestureRouterTest {

    private fun finger(id: Int, major: Float = 40f, size: Float = 0.1f) =
        PointerSample(id, TOOL_TYPE_FINGER, major, major, size, 10f, 10f)

    private fun palm(id: Int) = PointerSample(id, TOOL_TYPE_FINGER, 400f, 380f, 0.8f, 10f, 10f)

    private fun pen(id: Int, tool: Int = TOOL_TYPE_STYLUS) =
        PointerSample(id, tool, 20f, 20f, 0.05f, 10f, 10f)

    private fun down(vararg pointers: PointerSample, major: Float = 0f, size: Float = 0f) =
        GestureEvent(
            GesturePhase.DOWN, pointers.toList(), 0, pointers.first().id, major, major, size,
        )

    /**
     * A `POINTER_DOWN` for the pointer at `index`.
     *
     * `actionIndex` must name a pointer that is *in* the list, and the event carries
     * every pointer that is down — which is what a real `MotionEvent` does. The first
     * version passed only the new pointer, so an action index of 1 ran off the end of a
     * one-element list. That is a bug in the fixture rather than in the rules, and the
     * rule it was testing — a pen arriving as the second pointer — is exactly the case
     * the shape has to be right for.
     */
    private fun pointerDown(index: Int, vararg pointers: PointerSample) =
        GestureEvent(
            GesturePhase.POINTER_DOWN, pointers.toList(), index, pointers[index].id, 0f, 0f, 0f,
        )

    /**
     * A `MOVE`, with the event-level geometry Android computes.
     *
     * A `MOVE` has no meaningful action pointer, so `InkGestureRouter` judges it on the
     * event-level aggregate. A fixture that left those at zero would pass a palm
     * straight through, and the test would be asserting against a shape Android never
     * produces. `palm = true` makes the contact a heel at the event level.
     */
    private fun move(
        vararg pointers: PointerSample,
        major: Float = 40f,
        size: Float = 0.1f,
        palm: Boolean = false,
    ) = GestureEvent(
        GesturePhase.MOVE,
        pointers.toList(),
        0,
        pointers.first().id,
        if (palm) 400f else major,
        if (palm) 380f else major,
        if (palm) 0.8f else size,
    )

    private fun pointerUp(index: Int, vararg pointers: PointerSample) =
        GestureEvent(
            GesturePhase.POINTER_UP, pointers.toList(), index, pointers[index].id, 0f, 0f, 0f,
        )

    private fun up(vararg pointers: PointerSample) =
        GestureEvent(GesturePhase.UP, pointers.toList(), 0, pointers.first().id, 0f, 0f, 0f)

    // ------------------------------------------------------------- one finger

    @Test
    fun `one finger moves the paper under a pen tool`() {
        val router = InkGestureRouter()
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(down(finger(0)), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        // Still the page's: the web view has this gesture and pans with momentum.
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(move(finger(0)), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(up(finger(0)), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
    }

    // ------------------------------------------------------------ two fingers

    @Test
    fun `a second finger keeps the gesture and zooms`() {
        val router = InkGestureRouter()
        val a = finger(0)
        val b = finger(1)
        assertEquals(GestureRoute.PASS_THROUGH, router.route(down(a), InkToolMode.INK, GestureRoute.PASS_THROUGH))
        // The first finger's decision must not be revoked by the second arriving:
        // both are the web view's, which is how two-finger move-and-zoom works.
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(pointerDown(1, a, b), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(move(a, b), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
    }

    // ------------------------------------------------------- three or more

    @Test
    fun `a third finger is rejected`() {
        val router = InkGestureRouter()
        val a = finger(0)
        val b = finger(1)
        val c = finger(2)
        router.route(down(a), InkToolMode.INK, GestureRoute.PASS_THROUGH)
        router.route(pointerDown(1, a, b), InkToolMode.INK, GestureRoute.PASS_THROUGH)

        assertEquals(
            GestureRoute.INTERCEPT,
            router.route(pointerDown(2, a, b, c), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        // And it stays absorbed, so the page cannot be dragged by the hand resting
        // on it after the third contact landed.
        assertEquals(
            GestureRoute.INTERCEPT,
            router.route(move(a, b, c), InkToolMode.INK, GestureRoute.INTERCEPT),
        )
    }

    // --------------------------------------------------------------- the palm

    @Test
    fun `a palm landing alone is rejected before the page ever sees it`() {
        val router = InkGestureRouter()
        val p = palm(0)
        // Palm-shaped on its own first sample, so the page never sees this gesture at
        // all: `onInterceptTouchEvent` returns true for the DOWN, which means the web
        // view is not given the event and cannot start a pan it would then have to be
        // cancelled out of.
        assertEquals(
            GestureRoute.INTERCEPT,
            router.route(down(p), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        // And it stays absorbed, so a hand that shifts does not begin moving the paper.
        assertEquals(
            GestureRoute.INTERCEPT,
            router.route(move(p, palm = true), InkToolMode.INK, GestureRoute.INTERCEPT),
        )
    }

    @Test
    fun `a palm joining a finger pan stops the page`() {
        val router = InkGestureRouter()
        val f = finger(0)
        val p = palm(1)
        router.route(down(f), InkToolMode.INK, GestureRoute.PASS_THROUGH)
        router.route(move(f), InkToolMode.INK, GestureRoute.PASS_THROUGH)

        // This is the transition the whole class exists for: the gesture was the
        // page's, and the palm's arrival revises that. Intercepting cancels the web
        // view, so the paper stops rather than sliding under a resting hand.
        assertEquals(
            GestureRoute.INTERCEPT,
            router.route(pointerDown(1, f, p), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
    }

    @Test
    fun `a fingertip stays a fingertip`() {
        val router = InkGestureRouter()
        val f = finger(0)
        router.route(down(f), InkToolMode.INK, GestureRoute.PASS_THROUGH)

        // The mirror of the palm test, and the one that would catch a threshold set
        // too low: an ordinary contact must keep the gesture for as long as it is
        // down. `getTouchMajor(i)` reports the contact's *current* box, so a
        // fingertip reports the same small box on every sample — there is no noisy
        // first frame to wait out, which is why the router acts on the first sample.
        repeat(5) {
            assertEquals(
                GestureRoute.PASS_THROUGH,
                router.route(move(f), InkToolMode.INK, GestureRoute.PASS_THROUGH),
            )
        }
    }

    // ----------------------------------------------------------------- the pen

    @Test
    fun `the pen writes and the page never gets the gesture`() {
        val router = InkGestureRouter()
        val s = pen(0)
        assertEquals(GestureRoute.CAPTURE_PEN, router.route(down(s), InkToolMode.INK, GestureRoute.PASS_THROUGH))
        assertEquals(
            GestureRoute.CAPTURE_PEN,
            router.route(move(s), InkToolMode.INK, GestureRoute.CAPTURE_PEN),
        )
        assertEquals(
            GestureRoute.CAPTURE_PEN,
            router.route(up(s), InkToolMode.INK, GestureRoute.CAPTURE_PEN),
        )
    }

    @Test
    fun `the eraser end is the pen too`() {
        val router = InkGestureRouter()
        val e = pen(0, tool = InkGestureRouter.TOOL_TYPE_ERASER)
        assertEquals(GestureRoute.CAPTURE_PEN, router.route(down(e), InkToolMode.INK, GestureRoute.PASS_THROUGH))
    }

    @Test
    fun `a pen arriving as the second pointer still writes`() {
        // The palm-first case, and the bug this replaced: reading `getToolType(0)`
        // meant the pen's `ACTION_POINTER_DOWN` was never recognised and the stroke
        // never started.
        val router = InkGestureRouter()
        val p = palm(0)
        val s = pen(1)
        router.route(down(p), InkToolMode.INK, GestureRoute.PASS_THROUGH)

        assertEquals(
            GestureRoute.CAPTURE_PEN,
            router.route(pointerDown(1, p, s), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        assertEquals("the pen's own id is latched", 1, router.penPointer())
    }

    @Test
    fun `the pen lifting ends the stroke without ending the gesture`() {
        // Fingers still down when the pen lifts: the stroke is over, and the rest of
        // the stream is not silently promoted into a page gesture.
        val router = InkGestureRouter()
        val s = pen(1)
        val f = finger(0)
        router.route(down(f), InkToolMode.INK, GestureRoute.PASS_THROUGH)
        router.route(pointerDown(1, f, s), InkToolMode.INK, GestureRoute.PASS_THROUGH)

        assertEquals(
            GestureRoute.CAPTURE_PEN,
            router.route(pointerUp(1, f, s), InkToolMode.INK, GestureRoute.CAPTURE_PEN),
        )
        assertEquals("the pen is no longer down", -1, router.penPointer())
    }

    @Test
    fun `a palm arriving mid-stroke does not end the stroke`() {
        val router = InkGestureRouter()
        val s = pen(0)
        val p = palm(1)
        router.route(down(s), InkToolMode.INK, GestureRoute.PASS_THROUGH)
        router.route(move(s), InkToolMode.INK, GestureRoute.CAPTURE_PEN)

        // The action names the palm, but the stream belongs to the pen.
        assertEquals(
            GestureRoute.CAPTURE_PEN,
            router.route(pointerDown(1, s, p), InkToolMode.INK, GestureRoute.CAPTURE_PEN),
        )
        assertEquals(
            GestureRoute.CAPTURE_PEN,
            router.route(move(s, p), InkToolMode.INK, GestureRoute.CAPTURE_PEN),
        )
    }

    // -------------------------------------------------- no ink tool (mouse)

    @Test
    fun `with no ink tool nothing is claimed at all`() {
        // Mouse and trackpad: the overlay must be invisible to them. A mouse
        // reports `TOOL_TYPE_MOUSE` and one pointer, and it drags text.
        val router = InkGestureRouter()
        val mouse = PointerSample(0, 3, 10f, 10f, 0.05f, 10f, 10f)
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(down(mouse, major = 10f, size = 0.05f), InkToolMode.NONE, GestureRoute.PASS_THROUGH),
        )
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(move(mouse), InkToolMode.NONE, GestureRoute.PASS_THROUGH),
        )
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(up(mouse), InkToolMode.NONE, GestureRoute.PASS_THROUGH),
        )
    }

    @Test
    fun `with no ink tool even a palm is the web view's problem`() {
        // Nothing to reject: there is no ink surface over the page, so the overlay
        // must not absorb anything. With no tool the overlay is a plain sibling with
        // no opinion.
        val router = InkGestureRouter()
        val p = palm(0)
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(down(p), InkToolMode.NONE, GestureRoute.PASS_THROUGH),
        )
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(move(p), InkToolMode.NONE, GestureRoute.PASS_THROUGH),
        )
    }

    // ------------------------------------------------ the tool is latched

    @Test
    fun `the tool a gesture began under governs the whole gesture`() {
        val router = InkGestureRouter()
        val f = finger(0)
        router.route(down(f), InkToolMode.INK, GestureRoute.PASS_THROUGH)

        // A click on the tool bar mid-drag must not turn a pan into an ink capture.
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(move(f), InkToolMode.NONE, GestureRoute.PASS_THROUGH),
        )
    }

    @Test
    fun `a cancel clears the gesture`() {
        val router = InkGestureRouter()
        router.route(down(pen(0)), InkToolMode.INK, GestureRoute.PASS_THROUGH)
        router.route(
            GestureEvent(GesturePhase.CANCEL, listOf(pen(0)), 0, 0, 0f, 0f, 0f),
            InkToolMode.INK,
            GestureRoute.CAPTURE_PEN,
        )
        assertEquals("the pen is released by the cancel", -1, router.penPointer())
        // The next gesture starts clean: no pen latched, nothing absorbed.
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(down(finger(0)), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        assertEquals("and a finger never latches one", -1, router.penPointer())
    }

    @Test
    fun `fingers alone never latch a pen`() {
        // The regression this guards: the previous implementation decided
        // stylus-versus-finger from `getToolType(0)`, so any stream whose index 0
        // happened not to be a pen could be read as one. Two fingers, neither a pen.
        val router = InkGestureRouter()
        val a = finger(0)
        val b = finger(1)
        router.route(down(a), InkToolMode.INK, GestureRoute.PASS_THROUGH)
        router.route(pointerDown(1, a, b), InkToolMode.INK, GestureRoute.PASS_THROUGH)
        assertEquals(-1, router.penPointer())
        // And the page keeps the gesture: two fingers move and zoom.
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(move(a, b), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
    }
}
