package com.zandaulion.omaha.data

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * [seenTier] is the one piece of [CompareCandidatesRepository] that is
 * actual reasoning rather than a straight DAO read — everything scored,
 * minus whatever the other two tiers already offer.
 */
class CompareCandidatesRepositoryTest {

    private fun row(ticker: String) = CandidateRow(ticker, null, null, 70)

    @Test
    fun `a ticker already on a watchlist is dropped from seen`() {
        val result = seenTier(
            seedTicker = null,
            watchlistRows = listOf(row("AAPL")),
            peerRows = emptyList(),
            allScored = listOf(row("AAPL"), row("MSFT"))
        )
        assertEquals(listOf("MSFT"), result.map { it.ticker })
    }

    @Test
    fun `a ticker already offered as a peer is dropped from seen`() {
        val result = seenTier(
            seedTicker = null,
            watchlistRows = emptyList(),
            peerRows = listOf(row("NVDA")),
            allScored = listOf(row("NVDA"), row("AMD"))
        )
        assertEquals(listOf("AMD"), result.map { it.ticker })
    }

    @Test
    fun `the seed ticker itself is dropped from seen, even if not otherwise offered`() {
        val result = seenTier(
            seedTicker = "AAPL",
            watchlistRows = emptyList(),
            peerRows = emptyList(),
            allScored = listOf(row("AAPL"), row("MSFT"))
        )
        assertEquals(listOf("MSFT"), result.map { it.ticker })
    }

    @Test
    fun `nothing already offered means everything scored comes back`() {
        val result = seenTier(
            seedTicker = null,
            watchlistRows = emptyList(),
            peerRows = emptyList(),
            allScored = listOf(row("AAPL"), row("MSFT"))
        )
        assertEquals(listOf("AAPL", "MSFT"), result.map { it.ticker })
    }
}
