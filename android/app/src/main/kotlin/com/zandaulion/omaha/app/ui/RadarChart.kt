package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Fill
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.Pillar
import com.zandaulion.omaha.design.ExplainableLabel
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin

/**
 * `web/app.js`'s `renderCompareRadar` AXES. Short forms the radar
 * abbreviates harder than anywhere else to fit inside the chart —
 * `Glossary`'s `ALIASES` (phase 1) already resolve all five to their
 * matching pillar entries, so tagging them costs nothing new here.
 */
private val AXES = listOf("Solvency", "Profitability", "Valuation", "Growth", "Capital")

/**
 * `web/app.js`'s `renderCompareRadar` COLORS — a categorical chart-series
 * palette, not brand UI chrome, so (like the PWA) it stays a local
 * constant here rather than routing through `design/tokens.json`.
 */
private val SERIES_COLORS = listOf(
    Color(0xFF38BDF8), Color(0xFF10B981), Color(0xFFF59E0B), Color(0xFFA78BFA), Color(0xFFF472B6)
)

private val CHART_SIZE = 260.dp
private val CHART_MARGIN = 34.dp
private val LABEL_WIDTH = 70.dp

private fun axisAngle(index: Int): Double = 2 * PI * index / AXES.size - PI / 2

/**
 * The pillar radar: each spoke is one of the five pillars, so the shape
 * shows at a glance where a company is strong and where its peers beat it
 * — a column of numbers doesn't. Ported from `web/app.js`'s
 * `renderCompareRadar`. Needs at least two companies with pillar data to
 * say anything a single score doesn't already.
 *
 * [series] pairs a ticker with its five [Pillar]s, in the scoring engine's
 * fixed pillar order — the same positional assumption the PWA's own
 * `s.pillars[i]` makes.
 */
@Composable
fun RadarChart(series: List<Pair<String, List<Pillar>>>) {
    if (series.size < 2) return

    val center = CHART_SIZE / 2
    val rMax = CHART_SIZE / 2 - CHART_MARGIN
    // Resolved here, in composable scope, and captured below — Canvas's draw
    // lambda is a DrawScope, not @Composable, so Omaha.colors can't be read
    // inside it directly.
    val gridColor = Omaha.colors.borderSubtle

    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        BasicText(
            "Pillar comparison",
            style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
        )
        Box(Modifier.height(12.dp))

        Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Box(Modifier.size(CHART_SIZE)) {
                Canvas(Modifier.fillMaxSize()) {
                    val c = Offset(size.width / 2f, size.height / 2f)
                    val radiusPx = rMax.toPx()

                    fun point(axisIndex: Int, fraction: Float): Offset {
                        val angle = axisAngle(axisIndex).toFloat()
                        val r = radiusPx * fraction.coerceIn(0f, 1f)
                        return Offset(c.x + r * cos(angle), c.y + r * sin(angle))
                    }

                    fun ring(fraction: Float): Path = Path().apply {
                        AXES.indices.forEach { i ->
                            val p = point(i, fraction)
                            if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y)
                        }
                        close()
                    }

                    for (f in listOf(0.25f, 0.5f, 0.75f, 1f)) {
                        drawPath(ring(f), gridColor, style = Stroke(width = 1f))
                    }
                    AXES.indices.forEach { i ->
                        drawLine(gridColor, start = c, end = point(i, 1f), strokeWidth = 1f)
                    }

                    series.forEachIndexed { idx, (_, pillars) ->
                        val colour = SERIES_COLORS[idx % SERIES_COLORS.size]
                        val shape = Path().apply {
                            AXES.indices.forEach { i ->
                                // Unmeasured collapses to the centre rather than inventing a
                                // midpoint, so a sparse company reads as sparse — same rule
                                // the PWA uses.
                                val fraction = pillars.getOrNull(i)?.let { it.pct / 100f } ?: 0f
                                val p = point(i, fraction)
                                if (i == 0) moveTo(p.x, p.y) else lineTo(p.x, p.y)
                            }
                            close()
                        }
                        drawPath(shape, colour.copy(alpha = 0.22f), style = Fill)
                        drawPath(shape, colour, style = Stroke(width = 2f))
                    }
                }

                AXES.forEachIndexed { i, name ->
                    val angle = axisAngle(i)
                    val r = rMax * 1.2f
                    val x = center + r * cos(angle).toFloat()
                    val y = center + r * sin(angle).toFloat()
                    Box(
                        Modifier
                            .offset(x = x - LABEL_WIDTH / 2, y = y - 8.dp)
                            .width(LABEL_WIDTH),
                        contentAlignment = Alignment.Center
                    ) {
                        ExplainableLabel(
                            key = name,
                            text = name,
                            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                        )
                    }
                }
            }
        }

        Box(Modifier.height(10.dp))
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)
        ) {
            series.forEachIndexed { idx, (ticker, _) ->
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(
                        Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(SERIES_COLORS[idx % SERIES_COLORS.size])
                    )
                    Box(Modifier.width(5.dp))
                    BasicText(
                        ticker,
                        style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                            .copy(fontFamily = Omaha.fonts.mono)
                    )
                }
            }
        }
    }
}
