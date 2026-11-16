package org.weaveforge.ink

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PendingPickTest {
    private val sent = mutableListOf<String>()
    private var cancels = 0
    private val pick = PendingPick(post = { sent.add(it) }, cancel = { cancels++ })

    @Test
    fun firstAnswerIsSentAndLaterOnesAreDropped() {
        assertTrue(pick.settle("a"))
        assertFalse(pick.settle("b"))
        assertEquals(listOf("a"), sent)
        assertTrue(pick.isSettled)
    }

    @Test
    fun abandonRepliesWithAnErrorAndCancelsTheRequest() {
        assertTrue(pick.abandon())
        assertEquals(listOf(GoogleSignInMessages.failed("error")), sent)
        assertEquals(1, cancels)
    }

    @Test
    fun abandonAfterAnAnswerDoesNothing() {
        pick.settle("a")
        assertFalse(pick.abandon())
        assertEquals(listOf("a"), sent)
        assertEquals(0, cancels)
    }

    @Test
    fun aLateAnswerAfterAbandonIsDropped() {
        pick.abandon()
        assertFalse(pick.settle("late"))
        assertEquals(1, sent.size)
    }

    @Test
    fun aFailingPostStillCountsAsSettled() {
        val p = PendingPick(post = { throw IllegalStateException("page gone") }, cancel = {})
        assertTrue(p.settle("a"))
        assertTrue(p.isSettled)
        assertFalse(p.abandon())
    }
}
