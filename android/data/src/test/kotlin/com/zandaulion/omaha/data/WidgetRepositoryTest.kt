package com.zandaulion.omaha.data

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Equal-weight means used by callers that request them. The Watchlist and
 * widget headline instead share [aggregatePortfolioHealth].
 */
class WidgetRepositoryTest {

    @Test
    fun `unscored holdings are excluded rather than averaged as zero`() {
        val (average, count) = meanScore(listOf(80, null, 60))
        assertEquals(70, average)
        assertEquals(2, count)
    }

    @Test
    fun `an empty list has no average`() {
        val (average, count) = meanScore(emptyList())
        assertEquals(null, average)
        assertEquals(0, count)
    }

    @Test
    fun `an all-null list has no average, not a divide-by-zero`() {
        val (average, count) = meanScore(listOf(null, null))
        assertEquals(null, average)
        assertEquals(0, count)
    }

    @Test
    fun `a single score is its own average`() {
        val (average, count) = meanScore(listOf(85))
        assertEquals(85, average)
        assertEquals(1, count)
    }

    @Test
    fun `tierFor matches the boundaries composite already used`() {
        assertEquals("risk", tierFor(null))
        assertEquals("risk", tierFor(49))
        assertEquals("moderate", tierFor(50))
        assertEquals("good", tierFor(70))
        assertEquals("pristine", tierFor(85))
    }
}
