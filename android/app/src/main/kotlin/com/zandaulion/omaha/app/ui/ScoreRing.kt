package com.zandaulion.omaha.app.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

/**
 * The radial health score, matching `#scoreRingProgress` in the PWA.
 *
 * The web version is an SVG circle whose `stroke-dashoffset` is animated from
 * the circumference down to the scored fraction. This is the same drawing with
 * a Compose arc: a track at full sweep, the score on top, starting at twelve
 * o'clock and running clockwise.
 *
 * An unscored company draws **no arc at all** rather than a zero-length one at
 * the top. A ring that reads empty says "this scored nothing"; the absence of a
 * ring says "this could not be scored", and those are different claims. The
 * numeral is an em dash for the same reason.
 */
@Composable
fun ScoreRing(
    score: Int?,
    tier: String,
    label: String,
    modifier: Modifier = Modifier,
    diameter: Dp = 132.dp
) {
    val colors = Omaha.colors
    val arcColor = when (tier) {
        "pristine" -> colors.healthPristine
        "good" -> colors.healthGood
        "moderate" -> colors.healthModerate
        else -> colors.healthRisk
    }

    val target = (score ?: 0).coerceIn(0, 100) / 100f
    val sweep by animateFloatAsState(
        targetValue = if (score == null) 0f else target,
        animationSpec = tween(durationMillis = 650),
        label = "scoreRingSweep"
    )

    Column(
        modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Box(contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(diameter)) {
                val stroke = 10.dp.toPx()
                val inset = stroke / 2f
                val arcSize = Size(size.width - stroke, size.height - stroke)
                val topLeft = Offset(inset, inset)

                drawArc(
                    color = colors.bgSurfaceSubtle,
                    startAngle = -90f,
                    sweepAngle = 360f,
                    useCenter = false,
                    topLeft = topLeft,
                    size = arcSize,
                    style = Stroke(width = stroke, cap = StrokeCap.Round)
                )

                if (score != null) {
                    drawArc(
                        color = arcColor,
                        startAngle = -90f,
                        sweepAngle = 360f * sweep,
                        useCenter = false,
                        topLeft = topLeft,
                        size = arcSize,
                        style = Stroke(width = stroke, cap = StrokeCap.Round)
                    )
                }
            }

            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                BasicText(
                    score?.toString() ?: EM_DASH,
                    style = OmahaType.displayLg
                        .toTextStyle(color = colors.textPrimary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
                BasicText(
                    "out of 100",
                    style = OmahaType.caption.toTextStyle(color = colors.textTertiary)
                )
            }
        }

        BasicText(
            label,
            style = OmahaType.bodySm
                .toTextStyle(color = if (score == null) colors.textTertiary else arcColor)
                .copy(textAlign = TextAlign.Center)
        )
    }
}

/** `.pillar-meter-item`: a labelled bar, scored out of twenty. */
@Composable
fun PillarMeter(name: String, score: Int, max: Int, pct: Int, measured: Int, of: Int) {
    val colors = Omaha.colors
    val fill = when {
        pct >= 80 -> colors.healthPristine
        pct >= 60 -> colors.healthGood
        pct >= 40 -> colors.healthModerate
        else -> colors.healthRisk
    }

    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            BasicText(name, style = OmahaType.bodySm.toTextStyle(color = colors.textSecondary))
            BasicText(
                "$score/$max",
                style = OmahaType.bodySm
                    .toTextStyle(color = colors.textPrimary)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
        }

        Box(
            Modifier
                .fillMaxWidth()
                .height(6.dp)
                .clip(RoundedCornerShape(3.dp))
                .background(colors.bgSurfaceSubtle)
        ) {
            Box(
                Modifier
                    .fillMaxWidth((pct / 100f).coerceIn(0f, 1f))
                    .height(6.dp)
                    .clip(RoundedCornerShape(3.dp))
                    .background(fill)
            )
        }

        // Says how much of the pillar was measurable. A 14/20 built from four
        // measures and one built from two are different statements, and the
        // engine already knows which this is.
        if (measured != of && of > 0) {
            BasicText(
                "$measured of $of measures filed",
                style = OmahaType.caption.toTextStyle(color = colors.textTertiary)
            )
        }
    }
}
