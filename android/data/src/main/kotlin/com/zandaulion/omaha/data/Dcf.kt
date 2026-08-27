package com.zandaulion.omaha.data

import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.roundToInt

/**
 * The DCF sandbox model, in Kotlin.
 *
 * **This is the project's only deliberate second implementation**, and it needs
 * its justification stated where someone will find it.
 *
 * Everything else that both clients compute lives in `core/` and runs through
 * QuickJS, because a second implementation is a second set of answers. The
 * sandbox is the exception for one reason: it recomputes on every slider frame.
 * A QuickJS call costs a fresh interpreter and a bundle parse — about 21 ms per
 * call under the alpha13 workaround (doc 13 §24) — which a drag cannot afford.
 *
 * `core/analysis/dcf.js` remains the definition. `scripts/gen-dcf-vectors.mjs`
 * records its output into `core/__fixtures__/dcf.vectors.json`, and
 * `DcfParityTest` asserts this file agrees with those numbers. A change to the
 * model that is not mirrored here fails the Android build rather than shipping
 * two fair values for one company.
 */
object Dcf {

    const val PROJECTION_YEARS = 5

    data class Range(val min: Double, val max: Double)

    val GROWTH_PCT = Range(-25.0, 45.0)
    val MULTIPLE = Range(8.0, 45.0)
    val DISCOUNT_PCT = Range(6.0, 16.0)

    data class Assumptions(val growthPct: Int, val multiple: Double, val discountPct: Double)

    data class Year(val year: Int, val fcf: Double, val pv: Double)

    data class Projection(
        val rows: List<Year>,
        val cumulativePV: Double,
        val terminalValue: Double,
        val pvTerminal: Double,
        val enterpriseValue: Double,
        val equityValue: Double,
        val fairValue: Double
    )

    enum class VerdictKind { NoEquityValue, NoPrice, Divergent, Undervalued, Overvalued }

    data class Verdict(val kind: VerdictKind, val pct: Double?, val factor: Double?)

    /** Where the sliders start: what the scorecard was actually built from. */
    fun baselines(growthRate: Double?, terminalMultiple: Double?, discountRate: Double?): Assumptions =
        clamp(
            Assumptions(
                growthPct = ((growthRate ?: 0.06) * 100).roundToInt(),
                multiple = (terminalMultiple ?: 15.0).roundToInt().toDouble(),
                discountPct = ((discountRate ?: 0.095) * 1000).roundToInt() / 10.0
            )
        )

    /**
     * Held inside the slider's range at **both** ends.
     *
     * Clamping one end only was a real defect in the original: a company whose
     * filed growth sat outside the range produced a preset the slider could not
     * represent, so the control pinned at its limit while the fair value below
     * used the unclamped figure. The two disagreed and nothing said so.
     */
    fun clamp(a: Assumptions) = Assumptions(
        growthPct = min(GROWTH_PCT.max, max(GROWTH_PCT.min, a.growthPct.toDouble())).toInt(),
        multiple = min(MULTIPLE.max, max(MULTIPLE.min, a.multiple)),
        discountPct = min(DISCOUNT_PCT.max, max(DISCOUNT_PCT.min, a.discountPct))
    )

    /**
     * Bear is 35% *worse* rather than 35% lower.
     *
     * Not the same thing for a shrinking business: multiplying a negative
     * growth rate by 0.65 would make the bear case the optimistic one.
     */
    fun preset(name: String, baselines: Assumptions): Assumptions {
        val g = baselines.growthPct
        return when (name) {
            "bear" -> clamp(
                Assumptions(
                    growthPct = (if (g >= 0) g * 0.65 else g * 1.35).roundToInt(),
                    multiple = 16.0,
                    discountPct = 11.0
                )
            )
            "bull" -> clamp(
                Assumptions(
                    growthPct = (if (g >= 0) g * 1.30 else g * 0.70).roundToInt(),
                    multiple = 32.0,
                    discountPct = 9.0
                )
            )
            else -> clamp(baselines)
        }
    }

    /** Why the model cannot run, or null. Never a fabricated cash flow. */
    fun blockedReason(applicable: Boolean?, reason: String?, cashFlowBase: Double?, shares: Double?): String? {
        if (applicable == false) return reason ?: "not-applicable"
        if (cashFlowBase == null || !cashFlowBase.isFinite() || cashFlowBase <= 0) return "negative-fcf"
        if (shares == null || !shares.isFinite() || shares <= 0) return "no-share-count"
        return null
    }

    fun explainBlocked(reason: String): String = when (reason) {
        "negative-fcf" ->
            "This company is not generating positive free cash flow, so a discounted cash " +
                "flow model has nothing to discount. Judge it on the balance sheet and the " +
                "path back to cash generation instead."
        "no-share-count" ->
            "The diluted share count is not in the filings for this listing, so a per-share " +
                "value cannot be derived."
        "not-meaningful-for-financials" ->
            "Free cash flow is not owner earnings for a bank or insurer — deposit and loan " +
                "flows dominate it. Book value and return on equity are the measures that " +
                "apply here."
        else -> "This model cannot be run on the available filings."
    }

    fun project(
        cashFlowBase: Double,
        shares: Double,
        netCash: Double,
        growthPct: Int,
        multiple: Double,
        discountPct: Double
    ): Projection {
        val g = growthPct / 100.0
        val r = discountPct / 100.0

        val rows = ArrayList<Year>(PROJECTION_YEARS)
        var fcf = cashFlowBase
        var cumulativePV = 0.0

        for (t in 1..PROJECTION_YEARS) {
            fcf *= (1 + g)
            val pv = fcf / (1 + r).pow(t)
            cumulativePV += pv
            rows.add(Year(t, fcf, pv))
        }

        val terminalValue = fcf * multiple
        val pvTerminal = terminalValue / (1 + r).pow(PROJECTION_YEARS)
        val enterpriseValue = cumulativePV + pvTerminal
        val equityValue = enterpriseValue + netCash

        return Projection(
            rows = rows,
            cumulativePV = cumulativePV,
            terminalValue = terminalValue,
            pvTerminal = pvTerminal,
            enterpriseValue = enterpriseValue,
            equityValue = equityValue,
            fairValue = equityValue / shares
        )
    }

    /**
     * What the result means against the traded price.
     *
     * `Divergent` exists because a fair value several multiples from the price
     * almost always means the assumptions are wrong, and presenting that as an
     * enormous margin of safety invites exactly the wrong conclusion.
     * `Overvalued` is a premium over fair value rather than a negative margin,
     * because the margin form reaches −188% on an expensive stock and stops
     * carrying meaning.
     */
    fun verdict(fairValue: Double, price: Double): Verdict {
        if (!fairValue.isFinite() || fairValue <= 0) return Verdict(VerdictKind.NoEquityValue, null, null)
        if (!price.isFinite() || price <= 0) return Verdict(VerdictKind.NoPrice, null, null)

        val factor = fairValue / price
        if (factor >= 3 || factor <= 1.0 / 3.0) return Verdict(VerdictKind.Divergent, null, factor)
        return if (fairValue > price) {
            Verdict(VerdictKind.Undervalued, (fairValue - price) / fairValue * 100, factor)
        } else {
            Verdict(VerdictKind.Overvalued, (price - fairValue) / fairValue * 100, factor)
        }
    }
}
