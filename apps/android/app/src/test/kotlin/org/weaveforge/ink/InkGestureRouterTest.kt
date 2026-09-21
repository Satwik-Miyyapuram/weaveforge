package org.weaveforge.ink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

import org.weaveforge.ink.InkGestureRouter.Companion.MAX_PAGE_FINGERS
import org.weaveforge.ink.InkGestureRouter.Companion.PALM_SETTLE_SAMPLES
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

    private fun pointerDown(index: Int, vararg pointers: PointerSample) =
        GestureEvent(
            GesturePhase.POINTER_DOWN, pointers.toList(), index, pointers[index].id, 0f, 0f, 0f,
        )

    private fun move(vararg pointers: PointerSample, major: Float = 40f, size: Float = 0.1f) =
        GestureEvent(GesturePhase.MOVE, pointers.toList(), 0, pointers.first().id, major, major, size)

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
        // First sample: palm-shaped, but the driver may still be settling.
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(down(p), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        // Second consecutive palm-shaped sample: decided, and absorbed from here.
        assertEquals(
            GestureRoute.INTERCEPT,
            router.route(move(p), InkToolMode.INK, GestureRoute.PASS_THROUGH),
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
    fun `a finger that is briefly wide is not a palm`() {
        val router = InkGestureRouter()
        val f = finger(0)
        router.route(down(f), InkToolMode.INK, GestureRoute.PASS_THROUGH)

        // One wide sample, then normal: `PALM_SETTLE_SAMPLES` is what keeps the
        // first noisy frame of a legitimate pan from being thrown away.
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(move(f, major = 400f, size = 0.8f), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(move(f), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        assertTrue("one wide sample must not absorb the gesture", PALM_SETTLE_SAMPLES >= 2)
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
            router.route(pointerUp(1, f), InkToolMode.INK, GestureRoute.CAPTURE_PEN),
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
        assertEquals(-1, router.penPointer())
        // The next gesture starts clean: no pen latched, nothing absorbed.
        assertEquals(
            GestureRoute.PASS_THROUGH,
            router.route(down(finger(0)), InkToolMode.INK, GestureRoute.PASS_THROUGH),
        )
        assertFalse(router.penPointer() != -1)
    }

    @Test
    fun `a pen down latches a negative id as not a pen`() {
        val router = InkGestureRouter()
        router.route(down(finger(0)), InkToolMode.INK, GestureRoute.PASS_THROUGH)
        assertEquals(-1, router.penPointer())
        assertTrue(MAX_PAGE_FINGERS == 2)
    }
}
