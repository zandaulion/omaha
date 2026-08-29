package com.zandaulion.omaha.data

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Mirrors `core/analysis/staleness.test.js`'s vectors against [assessStaleness],
 * the native port. Same inputs, same expected outputs — this is what keeps the
 * port honest against the JS source [assessStaleness]'s own header names as the
 * one that would win a disagreement.
 *
 * Two of the JS suite's cases have no Kotlin equivalent to test: `AiSummary`
 * and `StockDetail` aren't nullable arguments here (the type system already
 * rules that out), and `priceAtGeneration` arrives as a typed `Double?` from
 * [parseAiSummary] rather than a raw string, so "a price stored as a string"
 * is a parsing concern, not a staleness one.
 */
class StalenessTest {

    private fun summary(fiscalPeriodEnd: String?, priceAtGeneration: Double?) = AiSummary(
        verdict = "", verdictGrade = "INSUFFICIENT_DATA", verdictBadge = "", buffettPrinciple = "",
        executiveSummary = "",
        moatAndProfitability = Rating("NOT_ASSESSABLE", "", ""),
        solvencyAndSafety = Rating("NOT_ASSESSABLE", "", ""),
        valuationAndDCF = Rating("NOT_ASSESSABLE", "", ""),
        keyStrengths = emptyList(), keyRisks = emptyList(),
        modelContext = ModelContext(hasContext = false, asOfCaveat = null, points = emptyList()),
        dataLimitations = emptyList(), conclusion = "",
        buyZone = BuyZone(0.0, "USD", null, false, ""),
        whatToWatch = emptyList(), includedNotes = false, generatedAt = null,
        fiscalPeriodEnd = fiscalPeriodEnd, priceAtGeneration = priceAtGeneration
    )

    private fun stock(fiscalPeriodEnd: String?, price: Double?) = StockDetail(
        ticker = "T", name = "", sector = "", industry = "", price = price, currency = "USD",
        changePct = null, healthScore = null, healthTier = "moderate", healthLabel = "",
        fiscalPeriodEnd = fiscalPeriodEnd, coverage = null, fx = null,
        pillars = emptyList(), checklist = emptyList(),
        checklistSummary = ChecklistSummary(0, 0, 0, 0),
        history = History(emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), emptyList(), null, null, null),
        balanceSheet = BalanceSheet(null, null, null, null, null, null, "USD"),
        dcf = DcfInputs(true, null, null, null, null, null, null, null, null, null, null, null)
    )

    @Test
    fun `an analysis against the current filings at a steady price is fresh`() {
        val r = assessStaleness(summary("2025-12-31", 100.0), stock("2025-12-31", 105.0))
        assertEquals(false, r.stale)
        assertEquals("none", r.scope)
        assertNull(r.headline)
    }

    @Test
    fun `newer filings make the whole analysis stale`() {
        val r = assessStaleness(summary("2025-12-31", 100.0), stock("2026-12-31", 100.0))
        assertEquals(true, r.stale)
        assertEquals(true, r.filingsChanged)
        assertEquals("all", r.scope)
        assertTrue(r.detail!!.contains("2025-12-31"))
        assertTrue(r.detail!!.contains("2026-12-31"))
    }

    @Test
    fun `price drift alone affects only the valuation sections`() {
        val r = assessStaleness(summary("2025-12-31", 100.0), stock("2025-12-31", 130.0))
        assertEquals(true, r.stale)
        assertEquals(true, r.priceDrifted)
        assertEquals(false, r.filingsChanged)
        assertEquals("valuation", r.scope)
        assertTrue(r.detail!!.contains("moat and solvency reasoning is unchanged"))
    }

    @Test
    fun `newer filings outrank price drift when both are true`() {
        val r = assessStaleness(summary("2025-12-31", 100.0), stock("2026-12-31", 130.0))
        assertEquals("all", r.scope)
        assertEquals(true, r.priceDrifted)
        assertTrue(r.headline!!.contains("Newer financial statements"))
    }

    @Test
    fun `drift is measured in both directions`() {
        val down = assessStaleness(summary("2025-12-31", 100.0), stock("2025-12-31", 70.0))
        assertEquals(true, down.priceDrifted)
        assertTrue(down.driftRatio!! < 0)
        assertTrue(down.detail!!.contains("−30%"))

        val up = assessStaleness(summary("2025-12-31", 100.0), stock("2025-12-31", 130.0))
        assertTrue(up.detail!!.contains("+30%"))
    }

    @Test
    fun `the threshold is inclusive and a hair under it is fresh`() {
        val at = assessStaleness(summary("2025-12-31", 100.0), stock("2025-12-31", 100.0 * 1.15))
        assertEquals(true, at.priceDrifted)

        val under = assessStaleness(summary("2025-12-31", 100.0), stock("2025-12-31", 114.9))
        assertEquals(false, under.stale)
    }

    @Test
    fun `a missing fiscal period is not evidence of anything`() {
        assertEquals(false, assessStaleness(summary(null, 100.0), stock("2026-12-31", 100.0)).filingsChanged)
        assertEquals(false, assessStaleness(summary("2025-12-31", 100.0), stock(null, 100.0)).filingsChanged)
    }

    @Test
    fun `a missing or nonsensical price is not drift`() {
        assertEquals(false, assessStaleness(summary("2025-12-31", null), stock("2025-12-31", 500.0)).stale)
        assertEquals(false, assessStaleness(summary("2025-12-31", 100.0), stock("2025-12-31", null)).stale)
        assertEquals(false, assessStaleness(summary("2025-12-31", 0.0), stock("2025-12-31", 100.0)).stale)
    }

    @Test
    fun `percentages render without rounding differences`() {
        val r = assessStaleness(summary("2025-12-31", 100.0), stock("2025-12-31", 116.25))
        assertTrue(r.detail!!.contains("+16.3%") || r.detail!!.contains("+16.2%"))
        val whole = assessStaleness(summary("2025-12-31", 100.0), stock("2025-12-31", 120.0))
        assertTrue(whole.detail!!.contains("+20%"), "a whole number should not render as 20.0%")
    }
}
