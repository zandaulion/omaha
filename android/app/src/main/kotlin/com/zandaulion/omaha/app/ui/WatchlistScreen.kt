package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.Holding
import com.zandaulion.omaha.data.PortfolioHealth
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaColors
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

/**
 * The watchlist, matching `#viewWatchlist` in the PWA.
 *
 * A hero banner stating the composite, then one card per holding. The card
 * carries the same four things the web card does — identity, three ratios,
 * price with its change, and a health badge — in the same order, because a
 * person moving between clients should be reading the same layout rather than
 * relearning it.
 */
@Composable
fun WatchlistScreen(
    state: WatchlistUiState,
    onRetry: () -> Unit,
    onSelect: (String) -> Unit
) {
    when (state) {
        is WatchlistUiState.Loading -> CentredMessage(
            "Scoring…",
            "Fetching filings and running the engine on this device."
        )

        is WatchlistUiState.Failed -> CentredMessage(
            "Could not load the watchlist",
            state.message,
            actionLabel = "Try again",
            onAction = onRetry
        )

        is WatchlistUiState.Ready -> LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = androidx.compose.foundation.layout.PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            item { PortfolioHero(state.view.health) }
            items(state.view.holdings, key = { it.ticker }) { holding ->
                HoldingCard(holding, onClick = { onSelect(holding.ticker) })
            }
        }
    }
}

/** `.portfolio-hero`: the list's name, its size, and the composite badge. */
@Composable
private fun PortfolioHero(health: PortfolioHealth) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.lg))
            .background(Omaha.colors.bgSurfaceElevated)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.lg))
            .padding(16.dp)
    ) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.Top
        ) {
            Column(Modifier.weight(1f)) {
                BasicText(
                    health.watchlistName,
                    style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary)
                )
                Box(Modifier.height(2.dp))
                BasicText(
                    "${health.holdingCount} companies in portfolio",
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
                )
            }
            ScoreBadge(health.compositeScore, health.tier)
        }

        // States what the average is an average of. A composite over three of
        // five holdings is a different claim from one over all five, and the
        // engine reports null rather than zero where too few line items were
        // filed — averaging those in would read "bad" instead of "unmeasured".
        if (health.scoredCount != health.holdingCount) {
            Box(Modifier.height(10.dp))
            BasicText(
                if (health.scoredCount == 0)
                    "None of these could be scored from what has been filed."
                else
                    "Averaged over the ${health.scoredCount} of ${health.holdingCount} " +
                        "that could be scored.",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
            )
        }
    }
}

/** `.stock-card`. */
@Composable
private fun HoldingCard(holding: Holding, onClick: () -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.md))
            .background(Omaha.colors.bgSurface)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.md))
            .clickable(onClick = onClick)
            .padding(14.dp)
    ) {
        if (holding.error != null) {
            // Named, not hidden. A holding missing from the list would make the
            // composite an average over a different set than the one on screen.
            BasicText(
                holding.ticker,
                style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
            Box(Modifier.height(4.dp))
            BasicText(
                when (holding.error) {
                    "rate_limited" -> "The data provider is rate limiting. Try again shortly."
                    "not_found" -> "No listing found for this symbol."
                    "network" -> "No connection to the data provider."
                    else -> "Could not be loaded (${holding.error})."
                },
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.healthRisk)
            )
            return@Column
        }

        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.Bottom) {
                    BasicText(
                        holding.ticker,
                        style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
                            .copy(fontFamily = Omaha.fonts.mono)
                    )
                    Box(Modifier.padding(start = 8.dp)) {
                        BasicText(
                            holding.name,
                            style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary),
                            maxLines = 1
                        )
                    }
                }
                Box(Modifier.height(6.dp))
                // The web card shows P/E, ROIC and then Altman Z — or ROE for a
                // financial, since Altman Z does not apply to a bank.
                BasicText(
                    buildString {
                        append("P/E: ").append(fmtRatio(holding.peRatio, 1, "x"))
                        append("  •  ROIC: ").append(fmtPercent(holding.roicPct))
                        append("  •  ")
                        if (holding.isFinancial) {
                            append("ROE: ").append(fmtPercent(holding.roe))
                        } else {
                            append("Altman Z: ").append(fmtRatio(holding.altmanZ, 2))
                        }
                    },
                    style = OmahaType.caption
                        .toTextStyle(color = Omaha.colors.textTertiary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
            }

            Column(horizontalAlignment = Alignment.End) {
                BasicText(
                    fmtPrice(holding.price, holding.currency),
                    style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.textPrimary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
                BasicText(
                    fmtPercent(holding.changePct, 2, signed = true),
                    style = OmahaType.caption
                        .toTextStyle(
                            color = if ((holding.changePct ?: 0.0) >= 0)
                                Omaha.colors.healthGood else Omaha.colors.healthRisk
                        )
                        .copy(fontFamily = Omaha.fonts.mono)
                )
                Box(Modifier.height(6.dp))
                ScoreBadge(holding.healthScore, holding.healthTier)
            }
        }

        if (holding.topCatalyst != null || holding.topRisk != null) {
            Box(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                holding.topCatalyst?.let { Pill("⚡ $it", Omaha.colors.healthGood) }
                holding.topRisk?.let { Pill("⚠️ $it", Omaha.colors.healthModerate) }
            }
        }
    }
}

/**
 * `.score-badge`. `null` reads "Not scored" rather than 0.
 *
 * Below 60% measurement coverage the engine declines to produce a composite at
 * all, which is the README's governing rule arriving at the interface. A zero
 * here would be the app inventing the one thing it promises never to invent.
 */
@Composable
private fun ScoreBadge(score: Int?, tier: String) {
    val colors = Omaha.colors
    val (fg, bg, border) = tierColors(tier, colors)

    Box(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.pill))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(OmahaRadius.pill))
            .padding(horizontal = 10.dp, vertical = 4.dp)
    ) {
        BasicText(
            if (score == null) "Not scored" else "$score/100",
            style = OmahaType.caption.toTextStyle(color = fg).copy(fontFamily = Omaha.fonts.mono)
        )
    }
}

private fun tierColors(tier: String, c: OmahaColors): Triple<Color, Color, Color> = when (tier) {
    "pristine" -> Triple(c.healthPristine, c.healthPristineBg, c.healthPristineBorder)
    "good" -> Triple(c.healthGood, c.healthGoodBg, c.healthGoodBorder)
    "moderate" -> Triple(c.healthModerate, c.healthModerateBg, c.healthModerateBorder)
    else -> Triple(c.healthRisk, c.healthRiskBg, c.healthRiskBorder)
}

@Composable
private fun Pill(text: String, tint: Color) {
    Box(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(Omaha.colors.bgSurfaceSubtle)
            .padding(horizontal = 8.dp, vertical = 4.dp)
    ) {
        BasicText(text, style = OmahaType.caption.toTextStyle(color = tint), maxLines = 1)
    }
}

@Composable
internal fun CentredMessage(
    title: String,
    detail: String,
    actionLabel: String? = null,
    onAction: (() -> Unit)? = null
) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        BasicText(title, style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary))
        Box(Modifier.height(8.dp))
        BasicText(
            detail,
            style = OmahaType.bodyMd
                .toTextStyle(color = Omaha.colors.textSecondary)
                .copy(textAlign = TextAlign.Center)
        )
        if (actionLabel != null && onAction != null) {
            Box(Modifier.height(16.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(OmahaRadius.pill))
                    .background(Omaha.colors.brandCyan)
                    .clickable(onClick = onAction)
                    .padding(horizontal = 18.dp, vertical = 10.dp)
            ) {
                BasicText(
                    actionLabel,
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.bgCanvas)
                )
            }
        }
    }
}
