package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle
import kotlin.math.abs
import kotlin.math.max

/**
 * The trend charts, drawn from primitives rather than a charting library.
 *
 * Doc 13 §10 predicted this: three of the four are CSS-styled div columns in
 * the PWA and become weighted [Row]s and [Box]es here, and only the margin
 * trajectory needs a path. A charting dependency would bring its own opinions
 * about axes, colours and — the expensive one — what to do about a missing
 * point, which is the single thing these charts must get right.
 *
 * **A year the company did not report draws nothing.** Not a zero, not an
 * interpolation between its neighbours. The web build once padded a gap with a
 * scaled copy of the next year, and that is exactly the confident fiction the
 * README's rule exists to prevent — a chart that fills a gap has invented a
 * number and looks identical to one that measured it.
 */

/**
 * A faint stub standing in for a year with nothing filed.
 *
 * The caller sets the height. An earlier version applied `fillMaxHeight()` here
 * *after* the caller's modifier, which silently overrode it — a missing year
 * drew a full-height bar, the single most wrong thing this chart could render:
 * an absent figure shown as the largest one on screen.
 */
@Composable
private fun MissingColumn(modifier: Modifier = Modifier) {
    Box(
        modifier
            .clip(RoundedCornerShape(2.dp))
            .background(Omaha.colors.bgSurfaceSubtle)
    )
}

/**
 * Chart 1 — revenue against free cash flow, paired bars per year.
 *
 * Both series share one scale, because the comparison between them is the
 * point: a company whose cash flow tracks its revenue looks different at a
 * glance from one whose does not, and independent scales would flatten that.
 */
@Composable
fun RevenueFcfChart(
    years: List<Int?>,
    revenue: List<Double?>,
    freeCashFlow: List<Double?>,
    currency: String
) {
    val plottable = years.isNotEmpty() && revenue.any { it != null }
    if (!plottable) {
        EmptyChart("No revenue history filed for this company.")
        return
    }

    val scale = max(
        (revenue + freeCashFlow).filterNotNull().maxOfOrNull { abs(it) } ?: 1.0,
        1.0
    )

    Column {
        Row(
            Modifier
                .fillMaxWidth()
                .height(140.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Bottom
        ) {
            years.forEachIndexed { i, year ->
                Column(
                    Modifier.weight(1f).fillMaxHeight(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Bottom
                ) {
                    Row(
                        Modifier.weight(1f).fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(3.dp),
                        verticalAlignment = Alignment.Bottom
                    ) {
                        Bar(revenue.getOrNull(i), scale, Omaha.colors.brandCyan, Modifier.weight(1f))
                        Bar(freeCashFlow.getOrNull(i), scale, Omaha.colors.healthGood, Modifier.weight(1f))
                    }
                    Box(Modifier.height(4.dp))
                    BasicText(
                        year?.toString() ?: EM_DASH,
                        style = OmahaType.caption
                            .toTextStyle(color = Omaha.colors.textTertiary)
                            .copy(fontFamily = Omaha.fonts.mono)
                    )
                }
            }
        }
        Box(Modifier.height(8.dp))
        Legend(
            "Revenue" to Omaha.colors.brandCyan,
            "Free cash flow" to Omaha.colors.healthGood
        )
    }
}

@Composable
private fun Bar(value: Double?, scale: Double, colour: Color, modifier: Modifier) {
    if (value == null) {
        // Nothing filed for this year. A faint track shows the slot exists
        // without asserting a magnitude for it.
        Box(modifier.fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(3.dp)
                    .clip(RoundedCornerShape(2.dp))
                    .background(Omaha.colors.bgSurfaceSubtle)
            )
        }
        return
    }

    // A floor of 3% keeps a genuinely tiny figure visible as a mark rather than
    // vanishing into the axis, where it would be indistinguishable from absent.
    val fraction = ((abs(value) / scale).toFloat()).coerceIn(0.03f, 1f)
    Box(modifier.fillMaxHeight(), contentAlignment = Alignment.BottomCenter) {
        Box(
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(fraction)
                .clip(RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp))
                .background(if (value < 0) Omaha.colors.healthRisk else colour)
        )
    }
}

/**
 * Chart 2 — liquidity against debt, as two tracks on a shared scale.
 *
 * The verdict beneath is the reason the chart exists: two bars invite an
 * eyeball comparison, and the net figure states the answer so nobody has to.
 */
@Composable
fun BalanceSheetStack(cash: Double?, totalDebt: Double?, netCash: Double?, currency: String) {
    if (cash == null && totalDebt == null) {
        EmptyChart("Balance sheet detail is not filed for this listing.")
        return
    }

    val scale = max(max(abs(cash ?: 0.0), abs(totalDebt ?: 0.0)), 1.0)

    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        StackRow("Cash & short-term investments", cash, scale, Omaha.colors.healthGood, currency)
        StackRow("Total debt", totalDebt, scale, Omaha.colors.healthRisk, currency)

        BasicText(
            when {
                netCash == null -> "Net position not computable from the filed data."
                netCash > 0 -> "💎 Net cash of ${fmtMoney(netCash, currency)}"
                else -> "Net debt of ${fmtMoney(abs(netCash), currency)}"
            },
            style = OmahaType.bodySm.toTextStyle(
                color = when {
                    netCash == null -> Omaha.colors.textTertiary
                    netCash > 0 -> Omaha.colors.healthGood
                    else -> Omaha.colors.healthRisk
                }
            )
        )
    }
}

@Composable
private fun StackRow(label: String, value: Double?, scale: Double, colour: Color, currency: String) {
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            BasicText(label, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
            BasicText(
                if (value == null) EM_DASH else fmtMoney(value, currency),
                style = OmahaType.caption
                    .toTextStyle(color = if (value == null) Omaha.colors.textTertiary else colour)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
        }
        Box(
            Modifier
                .fillMaxWidth()
                .height(8.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(Omaha.colors.bgSurfaceSubtle)
        ) {
            if (value != null) {
                Box(
                    Modifier
                        .fillMaxWidth(((abs(value) / scale).toFloat()).coerceIn(0f, 1f))
                        .height(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(colour)
                )
            }
        }
    }
}

/**
 * Chart 3 — margin trajectory. The one that needs a path.
 *
 * A gap in a series **breaks the line** rather than joining across it. Drawing
 * straight from 2022 to 2024 through an unreported 2023 would assert a
 * trajectory nobody filed, and it would look exactly like a measured one.
 */
@Composable
fun MarginTrendChart(
    years: List<Int?>,
    grossMarginPct: List<Double?>,
    operatingMarginPct: List<Double?>
) {
    val series = listOf(
        Triple("Gross margin", grossMarginPct, Omaha.colors.brandCyan),
        Triple("Operating margin", operatingMarginPct, Omaha.colors.brandViolet)
    ).filter { it.second.any { v -> v != null } }

    if (series.isEmpty()) {
        EmptyChart("Margin history is not filed for this company.")
        return
    }

    val all = series.flatMap { it.second }.filterNotNull()
    val lo = (all.minOrNull() ?: 0.0)
    val hi = (all.maxOrNull() ?: 1.0)
    // A little headroom, so a flat series does not sit on the frame.
    val pad = max((hi - lo) * 0.15, 1.0)
    val minY = lo - pad
    val maxY = hi + pad
    val gridColour = Omaha.colors.borderSubtle

    Column {
        Canvas(
            Modifier
                .fillMaxWidth()
                .height(150.dp)
        ) {
            val n = series.first().second.size
            if (n < 2) return@Canvas

            repeat(3) { g ->
                val y = size.height * (g + 1) / 4f
                drawLine(
                    color = gridColour,
                    start = Offset(0f, y),
                    end = Offset(size.width, y),
                    strokeWidth = 1f,
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(4f, 6f))
                )
            }

            val stepX = size.width / (n - 1).toFloat()
            fun yFor(v: Double) =
                size.height - ((v - minY) / (maxY - minY)).toFloat() * size.height

            for ((_, values, colour) in series) {
                val path = Path()
                var drawing = false
                values.forEachIndexed { i, v ->
                    if (v == null) {
                        // Lift the pen. The next filed point starts a new run.
                        drawing = false
                        return@forEachIndexed
                    }
                    val pt = Offset(stepX * i, yFor(v))
                    if (!drawing) { path.moveTo(pt.x, pt.y); drawing = true }
                    else path.lineTo(pt.x, pt.y)
                }
                drawPath(path, colour, style = Stroke(width = 2.5f, cap = StrokeCap.Round))

                values.forEachIndexed { i, v ->
                    if (v != null) drawCircle(colour, radius = 3.5f, center = Offset(stepX * i, yFor(v)))
                }
            }
        }

        Box(Modifier.height(6.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            years.forEach { y ->
                BasicText(
                    y?.toString() ?: EM_DASH,
                    style = OmahaType.caption
                        .toTextStyle(color = Omaha.colors.textTertiary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
            }
        }
        Box(Modifier.height(8.dp))
        Legend(*series.map { it.first to it.third }.toTypedArray())
    }
}

/**
 * Chart 4 — shares outstanding.
 *
 * Rising is bad here and falling is good, which is the opposite of every other
 * chart on the screen, so the bars are not colour-coded by direction — the
 * caption carries the judgement instead. A green bar for a falling share count
 * would be right and a green bar for a rising one would be wrong, and the same
 * colour cannot mean both.
 */
@Composable
fun SharesChart(years: List<Int?>, shares: List<Double?>, changeYoY: Double?) {
    if (shares.none { it != null }) {
        EmptyChart("Share count history is not filed for this company.")
        return
    }

    val values = shares.filterNotNull()
    val hi = values.maxOrNull() ?: 1.0
    // Scaled from zero would flatten a 3% buyback into a straight line. The
    // floor is 90% of the smallest filed value, so the change is legible.
    val lo = (values.minOrNull() ?: 0.0) * 0.9

    Column {
        Row(
            Modifier.fillMaxWidth().height(110.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.Bottom
        ) {
            years.forEachIndexed { i, year ->
                val v = shares.getOrNull(i)
                Column(
                    Modifier.weight(1f).fillMaxHeight(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Bottom
                ) {
                    Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.BottomCenter) {
                        if (v == null) {
                            MissingColumn(Modifier.fillMaxWidth().height(3.dp))
                        } else {
                            val f = (((v - lo) / (hi - lo)).toFloat()).coerceIn(0.05f, 1f)
                            Box(
                                Modifier
                                    .fillMaxWidth()
                                    .fillMaxHeight(f)
                                    .clip(RoundedCornerShape(topStart = 2.dp, topEnd = 2.dp))
                                    .background(Omaha.colors.brandBlue)
                            )
                        }
                    }
                    Box(Modifier.height(4.dp))
                    BasicText(
                        year?.toString() ?: EM_DASH,
                        style = OmahaType.caption
                            .toTextStyle(color = Omaha.colors.textTertiary)
                            .copy(fontFamily = Omaha.fonts.mono)
                    )
                }
            }
        }
        if (changeYoY != null) {
            Box(Modifier.height(8.dp))
            BasicText(
                if (changeYoY < 0)
                    "Share count down ${fmtPercent(abs(changeYoY) * 100, 2)} year on year — buybacks outpacing issuance."
                else
                    "Share count up ${fmtPercent(changeYoY * 100, 2)} year on year — dilution.",
                style = OmahaType.caption.toTextStyle(
                    color = if (changeYoY < 0) Omaha.colors.healthGood else Omaha.colors.healthModerate
                )
            )
        }
    }
}

@Composable
private fun Legend(vararg entries: Pair<String, Color>) {
    Row(horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        for ((label, colour) in entries) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier
                        .width(10.dp)
                        .height(3.dp)
                        .clip(RoundedCornerShape(2.dp))
                        .background(colour)
                )
                Box(Modifier.width(5.dp))
                BasicText(
                    label,
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                )
            }
        }
    }
}

@Composable
internal fun EmptyChart(message: String) {
    Box(
        Modifier
            .fillMaxWidth()
            .height(90.dp)
            .clip(RoundedCornerShape(8.dp))
            .background(Omaha.colors.bgSurfaceSubtle)
            .padding(16.dp),
        contentAlignment = Alignment.Center
    ) {
        BasicText(message, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary))
    }
}
