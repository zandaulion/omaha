package com.zandaulion.omaha.design

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.dp

/**
 * Where a tap on an [ExplainableLabel] reports its key. The default is a
 * no-op so a preview, or a screen composed outside [OmahaApp]'s provider,
 * degrades to "tap does nothing" instead of crashing.
 */
val LocalExplainOpener: ProvidableCompositionLocal<(String) -> Unit> =
    staticCompositionLocalOf { {} }

/**
 * `#explainSheet` / `.explain-card` (`web/index.html`, `web/app.css`
 * ~L2881-2967), ported: a full-bleed scrim behind a bottom-anchored card,
 * three labelled sections. [entry] null means closed; the last non-null
 * entry is kept rendered through the close animation so the card does not
 * go blank while it slides away.
 */
@Composable
fun OmahaExplainSheet(entry: GlossaryEntry?, onClose: () -> Unit) {
    var lastEntry by remember { mutableStateOf<GlossaryEntry?>(null) }
    LaunchedEffect(entry) { if (entry != null) lastEntry = entry }
    val shown = lastEntry ?: return

    AnimatedVisibility(
        visible = entry != null,
        enter = fadeIn(tween(160)),
        exit = fadeOut(tween(160))
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.55f))
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onClose
                ),
            contentAlignment = Alignment.BottomCenter
        ) {
            AnimatedVisibility(
                visible = entry != null,
                enter = slideInVertically(
                    animationSpec = tween(200, easing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)),
                    initialOffsetY = { it / 8 }
                ) + fadeIn(tween(200)),
                exit = slideOutVertically(
                    animationSpec = tween(160),
                    targetOffsetY = { it / 8 }
                ) + fadeOut(tween(160))
            ) {
                Column(
                    Modifier
                        // Absorbs the tap so it doesn't fall through to the scrim's close.
                        .clickable(
                            interactionSource = remember { MutableInteractionSource() },
                            indication = null,
                            onClick = {}
                        )
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(topStart = OmahaRadius.lg, topEnd = OmahaRadius.lg))
                        .background(Omaha.colors.bgSurfaceElevated)
                        .padding(20.dp)
                ) {
                    Row(
                        Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.Top
                    ) {
                        BasicText(
                            shown.title,
                            modifier = Modifier.weight(1f),
                            style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
                        )
                        BasicText(
                            "✕",
                            modifier = Modifier
                                .clickable(
                                    interactionSource = remember { MutableInteractionSource() },
                                    indication = null,
                                    onClick = onClose
                                )
                                .padding(start = 12.dp),
                            style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.textTertiary)
                        )
                    }
                    Box(Modifier.padding(top = 16.dp)) {
                        ExplainPart("What it means", shown.means)
                    }
                    Box(Modifier.padding(top = 16.dp)) {
                        ExplainPart("Why it matters", shown.matters)
                    }
                    Box(Modifier.padding(top = 16.dp)) {
                        ExplainPart("How Pocket Omaha computes it", shown.computes)
                    }
                }
            }
        }
    }
}

@Composable
private fun ExplainPart(label: String, body: String) {
    Column {
        BasicText(
            label.uppercase(),
            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
        )
        Box(Modifier.padding(top = 5.dp)) {
            BasicText(
                body,
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
            )
        }
    }
}

/**
 * A tap-to-explain label: [text], with a dotted underline, opening [key]'s
 * glossary entry via [LocalExplainOpener] on tap.
 *
 * Compose's `TextDecoration` has no dashed variant, so the underline
 * (`web/app.css`'s `[data-explain]` rule: dotted, always `--text-tertiary`
 * regardless of the label's own colour, 3dp offset, 1dp thick) is hand-drawn
 * under the first line's baseline once text layout is known, rather than
 * declared as a decoration.
 */
@Composable
fun ExplainableLabel(
    key: String,
    text: String,
    style: TextStyle,
    modifier: Modifier = Modifier,
    maxLines: Int = Int.MAX_VALUE
) {
    val opener = LocalExplainOpener.current
    val underlineColor = Omaha.colors.textTertiary
    var layout by remember { mutableStateOf<TextLayoutResult?>(null) }

    BasicText(
        text,
        modifier = modifier
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = { opener(key) }
            )
            .drawBehind {
                val result = layout ?: return@drawBehind
                // Measured from the baseline, not the line box's bottom — the
                // latter includes bodySm/caption's own line-height padding
                // (see OmahaTextStyle.toTextStyle's centered LineHeightStyle),
                // which sat low enough to cut through a sibling line below.
                // CSS's text-underline-offset is baseline-relative too.
                val baseline = result.getLineBaseline(0) + 3.dp.toPx()
                val width = result.getLineRight(0)
                drawLine(
                    color = underlineColor,
                    start = Offset(0f, baseline),
                    end = Offset(width, baseline),
                    strokeWidth = 1.dp.toPx(),
                    pathEffect = PathEffect.dashPathEffect(floatArrayOf(2.dp.toPx(), 2.dp.toPx()))
                )
            },
        style = style,
        maxLines = maxLines,
        onTextLayout = { layout = it }
    )
}
