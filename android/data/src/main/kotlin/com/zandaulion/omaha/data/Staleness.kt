package com.zandaulion.omaha.data

/**
 * Whether a cached AI analysis still describes the company it was written
 * about. A native port of `core/analysis/assessSummaryStaleness`
 * (`core/analysis/staleness.js`) rather than a call through it.
 *
 * That file's own header says both clients should ask the same question
 * through one implementation, and every other cross-client rule in this app
 * (scoring, backup, alerts) follows that. This is the one deliberate
 * exception, on the same reasoning `DcfEngine` already established for the
 * DCF sandbox: the computation is four field comparisons over data already
 * on screen, not worth a QuickJS bundle, an asset-staging entry and an
 * engine wrapper for what a Gradle `:data` unit test can keep honest against
 * the JS source just as well. [StalenessTest] mirrors known input/output
 * pairs from `staleness.js` directly — read that file, not this one, if the
 * two ever need reconciling.
 */
data class StalenessAssessment(
    val stale: Boolean,
    val filingsChanged: Boolean,
    val priceDrifted: Boolean,
    val driftRatio: Double?,
    /** `"none"`, `"valuation"` or `"all"` — `"all"` means every section was reasoned from since-superseded figures, not only the price-dependent ones. */
    val scope: String,
    val headline: String?,
    val detail: String?
) {
    companion object {
        val fresh = StalenessAssessment(
            stale = false,
            filingsChanged = false,
            priceDrifted = false,
            driftRatio = null,
            scope = "none",
            headline = null,
            detail = null
        )
    }
}

/** How far the price may drift before the valuation sections stop meaning what they say. Mirrors `PRICE_DRIFT_THRESHOLD` in `staleness.js`. */
private const val PRICE_DRIFT_THRESHOLD = 0.15

fun assessStaleness(summary: AiSummary, current: StockDetail): StalenessAssessment {
    val writtenAgainst = summary.fiscalPeriodEnd
    val filedNow = current.fiscalPeriodEnd

    val filingsChanged = !writtenAgainst.isNullOrEmpty() && !filedNow.isNullOrEmpty() && writtenAgainst != filedNow

    val priceThen = summary.priceAtGeneration
    val priceNow = current.price
    val driftRatio = if (priceThen != null && priceNow != null && priceThen > 0) {
        (priceNow - priceThen) / priceThen
    } else null

    val priceDrifted = driftRatio != null && kotlin.math.abs(driftRatio) >= PRICE_DRIFT_THRESHOLD - 1e-9

    if (!filingsChanged && !priceDrifted) return StalenessAssessment.fresh

    // Newer filings undermine the whole analysis; price movement undermines
    // only the parts that depend on price. Matches staleness.js's own
    // reasoning for why this distinction is the difference between a caveat
    // someone can act on and one they learn to dismiss.
    val scope = if (filingsChanged) "all" else "valuation"

    return StalenessAssessment(
        stale = true,
        filingsChanged = filingsChanged,
        priceDrifted = priceDrifted,
        driftRatio = driftRatio,
        scope = scope,
        headline = if (filingsChanged) {
            "Newer financial statements have been filed since this was written."
        } else {
            "The share price has moved materially since this was written."
        },
        detail = if (filingsChanged) {
            "Written against $writtenAgainst; the latest filed period is now $filedNow. " +
                "Every section was reasoned from the older figures."
        } else {
            "${formatSignedPercent(driftRatio!!)} since the analysis was generated. " +
                "The valuation and buy-zone sections are affected; the moat and solvency " +
                "reasoning is unchanged."
        }
    )
}

private fun formatSignedPercent(ratio: Double): String {
    val pct = ratio * 100
    val rounded = kotlin.math.round(kotlin.math.abs(pct) * 10) / 10
    val whole = kotlin.math.floor(rounded).toInt()
    val tenth = kotlin.math.round((rounded - whole) * 10).toInt()
    val text = if (tenth == 0) "$whole" else "$whole.$tenth"
    return "${if (pct >= 0) "+" else "−"}$text%"
}
