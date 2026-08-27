package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.Dcf
import com.zandaulion.omaha.data.StockDetail
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle
import kotlin.math.abs
import kotlin.math.roundToInt

/**
 * The DCF sandbox, matching `#subtabDcf`.
 *
 * The arithmetic is [Dcf], which is pinned to `core/analysis/dcf.js` by
 * `DcfParityTest` — see that file for why this is the one place the project
 * carries two implementations.
 *
 * The model runs on every frame of a drag, which is the whole reason it is
 * Kotlin rather than a QuickJS call. It is also why the interesting design
 * question here is not the maths but the *verdict*: a fair value is only ever
 * as good as three assumptions somebody just moved with their thumb, and the
 * screen has to keep saying so.
 */
@Composable
fun DcfSandbox(stock: StockDetail) {
    val d = stock.dcf
    val currency = stock.balanceSheet.reportingCurrency

    val blocked = Dcf.blockedReason(
        applicable = d.applicable,
        reason = d.reason,
        cashFlowBase = d.cashFlowBase,
        shares = d.shares
    )

    if (blocked != null) {
        // No sliders at all. An earlier build of the PWA substituted a billion
        // dollars of free cash flow where it was missing and produced a fair
        // value for companies that were burning cash — a confident answer to a
        // question the filings do not answer.
        Column {
            BasicText(
                "Fair value not modelled",
                style = OmahaType.title2.toTextStyle(color = Omaha.colors.textTertiary)
            )
            Box(Modifier.height(8.dp))
            BasicText(
                Dcf.explainBlocked(blocked),
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
            )
        }
        return
    }

    val baselines = remember(stock.ticker) {
        Dcf.baselines(d.growthRate, d.terminalMultiple, d.discountRate)
    }

    var preset by remember(stock.ticker) { mutableStateOf("base") }
    var assumptions by remember(stock.ticker) { mutableStateOf(baselines) }

    val projection = Dcf.project(
        cashFlowBase = d.cashFlowBase!!,
        shares = d.shares!!,
        netCash = d.netCash ?: 0.0,
        growthPct = assumptions.growthPct,
        multiple = assumptions.multiple,
        discountPct = assumptions.discountPct
    )
    val price = d.modelPrice ?: 0.0
    val verdict = Dcf.verdict(projection.fairValue, price)

    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {

        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column {
                BasicText(
                    "Estimated fair value",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                )
                BasicText(
                    fmtPrice(projection.fairValue, currency),
                    style = OmahaType.title1.toTextStyle(color = Omaha.colors.brandCyan)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                BasicText(
                    "Traded price",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                )
                BasicText(
                    fmtPrice(price, currency),
                    style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
            }
        }

        VerdictBanner(verdict, currency)

        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((key, label) in listOf("bear" to "🐻 Bear", "base" to "⚖️ Base", "bull" to "🐂 Bull")) {
                PresetChip(label, key == preset) {
                    preset = key
                    assumptions = Dcf.preset(key, baselines)
                }
            }
        }

        // Moving any slider leaves the presets, because the numbers on screen
        // are no longer the preset's. Keeping one highlighted would claim the
        // model still reflects a case it does not.
        AssumptionSlider(
            label = "5-year FCF growth",
            display = "${assumptions.growthPct}%",
            value = assumptions.growthPct.toFloat(),
            range = Dcf.GROWTH_PCT.min.toFloat()..Dcf.GROWTH_PCT.max.toFloat(),
            steps = (Dcf.GROWTH_PCT.max - Dcf.GROWTH_PCT.min).toInt() - 1
        ) {
            assumptions = assumptions.copy(growthPct = it.roundToInt()); preset = ""
        }

        AssumptionSlider(
            label = "Terminal exit multiple",
            display = "${fmtRatio(assumptions.multiple, 1)}x",
            value = assumptions.multiple.toFloat(),
            range = Dcf.MULTIPLE.min.toFloat()..Dcf.MULTIPLE.max.toFloat(),
            steps = (Dcf.MULTIPLE.max - Dcf.MULTIPLE.min).toInt() - 1
        ) {
            assumptions = assumptions.copy(multiple = it.roundToInt().toDouble()); preset = ""
        }

        AssumptionSlider(
            label = "Discount rate (hurdle)",
            display = "${fmtRatio(assumptions.discountPct, 1)}%",
            value = assumptions.discountPct.toFloat(),
            range = Dcf.DISCOUNT_PCT.min.toFloat()..Dcf.DISCOUNT_PCT.max.toFloat(),
            steps = ((Dcf.DISCOUNT_PCT.max - Dcf.DISCOUNT_PCT.min) * 2).toInt() - 1
        ) {
            assumptions = assumptions.copy(discountPct = (it * 2).roundToInt() / 2.0); preset = ""
        }

        Breakdown(stock, projection, assumptions, currency)

        // The rate that would make the model agree with the market. Where the
        // two disagree this is the more useful of the two numbers: it states
        // what you would have to believe rather than asserting who is right.
        d.impliedGrowthRate?.let { implied ->
            BasicText(
                "At ${fmtPrice(price, currency)} the traded price implies free cash flow " +
                    (if (implied < 0) "shrinking " else "growing ") +
                    "${fmtPercent(abs(implied) * 100, 1)} a year for five years, against the " +
                    "${fmtPercent(assumptions.growthPct.toDouble(), 1, signed = true)} set here.",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
            )
        }

        BasicText(
            "This is a model, not a valuation. The fair value above is what these three " +
                "assumptions imply — move a slider and it moves with them. Not a price " +
                "target, and not investment advice.",
            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
        )
    }
}

@Composable
private fun VerdictBanner(verdict: Dcf.Verdict, currency: String) {
    val colors = Omaha.colors
    val (tint, text) = when (verdict.kind) {
        Dcf.VerdictKind.NoEquityValue -> colors.healthRisk to
            "No equity value at these assumptions — the discounted cash flows do not cover the debt."
        Dcf.VerdictKind.NoPrice -> colors.textTertiary to
            "No traded price available to compare against."
        Dcf.VerdictKind.Divergent -> {
            // Bound locally: `factor` is nullable across a module boundary, so
            // it cannot smart-cast even though this branch guarantees it.
            val factor = verdict.factor ?: 1.0
            colors.healthModerate to
                ("This model lands " +
                    (if (factor >= 3) "${fmtRatio(factor, 1)}× above"
                     else "${fmtRatio(1.0 / factor, 1)}× below") +
                    " the traded price. A gap this wide usually means the assumptions need " +
                    "revisiting, or the market is pricing in something the filings do not show.")
        }
        Dcf.VerdictKind.Undervalued -> colors.healthGood to
            "Margin of safety ${fmtPercent(verdict.pct, 1, signed = true)} — trading below fair value"
        Dcf.VerdictKind.Overvalued -> colors.healthRisk to
            "${fmtPercent(verdict.pct, 1)} above fair value at these assumptions"
    }

    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(colors.bgSurfaceSubtle)
            .border(1.dp, tint.copy(alpha = 0.35f), RoundedCornerShape(OmahaRadius.sm))
            .padding(10.dp)
    ) {
        BasicText(text, style = OmahaType.bodySm.toTextStyle(color = tint))
    }
}

@Composable
private fun PresetChip(label: String, active: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.pill))
            .background(if (active) Omaha.colors.brandCyan else Omaha.colors.bgSurfaceSubtle)
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 7.dp)
    ) {
        BasicText(
            label,
            style = OmahaType.caption.toTextStyle(
                color = if (active) Omaha.colors.bgCanvas else Omaha.colors.textSecondary
            )
        )
    }
}

/**
 * Material3's [Slider] is used here and nowhere else.
 *
 * The rule elsewhere in this app is foundation only, because Material brings a
 * second colour scheme and type scale. A slider is the exception worth making:
 * it is a gesture surface with drag semantics, accessibility and haptics that
 * would take real work to rebuild badly, and every colour it uses is passed in
 * from the tokens below. Nothing here reads `MaterialTheme`.
 */
@Composable
private fun AssumptionSlider(
    label: String,
    display: String,
    value: Float,
    range: ClosedFloatingPointRange<Float>,
    steps: Int,
    onChange: (Float) -> Unit
) {
    Column {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            BasicText(label, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
            BasicText(
                display,
                style = OmahaType.bodySm
                    .toTextStyle(color = Omaha.colors.brandCyan)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
        }
        Slider(
            value = value.coerceIn(range.start, range.endInclusive),
            onValueChange = onChange,
            valueRange = range,
            steps = steps.coerceAtLeast(0),
            colors = SliderDefaults.colors(
                thumbColor = Omaha.colors.brandCyan,
                activeTrackColor = Omaha.colors.brandCyan,
                inactiveTrackColor = Omaha.colors.bgSurfaceSubtle,
                activeTickColor = Color.Transparent,
                inactiveTickColor = Color.Transparent
            )
        )
    }
}

@Composable
private fun Breakdown(
    stock: StockDetail,
    p: Dcf.Projection,
    a: Dcf.Assumptions,
    currency: String
) {
    val d = stock.dcf
    val threeYear = d.cashFlowBasis?.startsWith("three-year") == true

    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Line(
            if (threeYear) "Free cash flow base (3-year median)" else "Trailing free cash flow",
            fmtMoney(d.cashFlowBase, currency)
        )
        if (threeYear && d.latestFiledCashFlow != null) {
            // Named so the base does not look like a transcription error
            // against a latest year that is visibly different.
            Line(
                "Latest filed year (outlier, not used)",
                fmtMoney(d.latestFiledCashFlow, currency),
                Omaha.colors.textTertiary
            )
        }
        Line("Present value, years 1–5", fmtMoney(p.cumulativePV, currency))
        Line("Terminal value at ${fmtRatio(a.multiple, 1)}x, discounted", fmtMoney(p.pvTerminal, currency))
        Line(
            "Net cash / (debt)",
            fmtMoney(d.netCash, currency),
            if ((d.netCash ?: 0.0) >= 0) Omaha.colors.healthGood else Omaha.colors.healthRisk
        )
        Line(
            "Intrinsic equity value",
            fmtMoney(p.equityValue, currency),
            if (p.equityValue >= 0) Omaha.colors.brandCyan else Omaha.colors.healthRisk
        )
        Line("Diluted shares", "${fmtRatio((d.shares ?: 0.0) / 1e9, 2)}B")

        Box(Modifier.height(4.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            BasicText(
                "Fair value per share",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary)
            )
            BasicText(
                fmtPrice(p.fairValue, currency),
                style = OmahaType.bodySm
                    .toTextStyle(color = Omaha.colors.textPrimary)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
        }
    }
}

@Composable
private fun Line(label: String, value: String, tint: Color? = null) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
        BasicText(label, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
        BasicText(
            value,
            style = OmahaType.caption
                .toTextStyle(color = tint ?: Omaha.colors.textPrimary)
                .copy(fontFamily = Omaha.fonts.mono)
        )
    }
}
