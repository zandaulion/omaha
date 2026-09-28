package com.zandaulion.omaha.data

import kotlin.test.Test
import kotlin.test.assertEquals

class PortfolioHealthTest {
    @Test
    fun `market cap weights scores and pillars while unscored holdings only add checklist counts`() {
        val health = aggregatePortfolioHealth("The Compounders", listOf(
            holding("BIG", 100, 9.0, 20.0, 2),
            holding("SMALL", 80, 1.0, 0.0, 1),
            holding("UNSCORED", null, 100.0, null, 3)
        ))

        assertEquals(98, health.compositeScore)
        assertEquals(18.0, health.pillarScores.first())
        assertEquals(2, health.scoredCount)
        assertEquals(3, health.holdingCount)
        assertEquals(6, health.checklistTotals.pass)
        assertEquals("market-cap", health.weighting)
    }

    @Test
    fun `missing market cap makes every scored holding an equal vote`() {
        val health = aggregatePortfolioHealth("List", listOf(
            holding("A", 80, 9.0, 16.0, 0),
            holding("B", 60, null, 12.0, 0)
        ))

        assertEquals(70, health.compositeScore)
        assertEquals(14.0, health.pillarScores.first())
        assertEquals("equal", health.weighting)
    }

    private fun holding(
        ticker: String,
        score: Int?,
        cap: Double?,
        pillar: Double?,
        passes: Int
    ) = Holding(
        ticker = ticker,
        name = ticker,
        price = null,
        currency = "USD",
        changePct = null,
        healthScore = score,
        healthTier = "good",
        roicPct = null,
        altmanZ = null,
        roe = null,
        peRatio = null,
        isFinancial = false,
        topCatalyst = null,
        topRisk = null,
        marketCap = cap,
        pillarScores = listOf(pillar),
        checklistTotals = ChecklistTotals(pass = passes)
    )
}
