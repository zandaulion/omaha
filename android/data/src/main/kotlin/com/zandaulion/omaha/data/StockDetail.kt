package com.zandaulion.omaha.data

/**
 * One company's scorecard, as the deep dive needs it.
 *
 * Like [Holding], a thin read of the record rather than a mirror. Every
 * quantity is nullable and every list can be empty, because the engine reports
 * what the filings did not contain as absent rather than as zero — and the
 * interface has to be able to say "not reported" in each of those places.
 */
data class Pillar(
    val name: String,
    val score: Int,
    val max: Int,
    val pct: Int,
    /** How many of this pillar's measures the filings actually supported. */
    val measured: Int,
    val of: Int
)

/**
 * One of the twelve checks.
 *
 * [status] is `pass`, `watch`, `fail` or `na`. The last is not a failure: an
 * unmeasurable check is excluded from the composite so it neither helps nor
 * hurts, and the drawer says so rather than leaving a grey dot unexplained.
 */
data class Check(
    val id: Int,
    val name: String,
    val category: String,
    val status: String,
    val value: String?,
    val benchmark: String?,
    val explanation: String
)

data class Coverage(
    val measured: Int,
    val total: Int,
    val pct: Int,
    /** False below the threshold at which the engine refuses to produce a score. */
    val sufficient: Boolean
)

data class ChecklistSummary(
    val pass: Int,
    val watch: Int,
    val fail: Int,
    val na: Int
)

/**
 * A depositary receipt trades in one currency and files in another.
 *
 * Carried through to the interface rather than resolved silently, because a
 * euro balance sheet sitting under a dollar price is the defect class doc 14
 * records as having contaminated 7 of 20 tickers.
 */
data class FxNote(
    val needed: Boolean,
    val available: Boolean,
    val from: String,
    val to: String,
    val rate: Double
)

data class StockDetail(
    val ticker: String,
    val name: String,
    val sector: String,
    val industry: String,
    val price: Double?,
    val currency: String,
    val changePct: Double?,
    val healthScore: Int?,
    val healthTier: String,
    val healthLabel: String,
    val fiscalPeriodEnd: String?,
    val coverage: Coverage?,
    val fx: FxNote?,
    val pillars: List<Pillar>,
    val checklist: List<Check>,
    val checklistSummary: ChecklistSummary
)
