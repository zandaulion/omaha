package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.Holding
import com.zandaulion.omaha.design.ExplainableLabel
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaCard
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

/** Up to four, as the PWA allows. More columns than that stop being readable. */
private const val MAX_COMPARED = 4

/**
 * Side by side, matching `#viewCompare`.
 *
 * Built from the watchlist rather than a ticker search, because the compare
 * view has the same scope as the filter: it works over what is already
 * followed. A search box here would imply the same market-wide reach the
 * rename in phase 1 was about removing.
 *
 * Rows are the measures; columns are the companies. That way adding a fourth
 * company widens the table rather than reflowing it, and a metric stays on one
 * line where the eye can run along it.
 */
@Composable
fun CompareScreen(state: WatchlistUiState, onRetry: () -> Unit) {
    when (state) {
        is WatchlistUiState.Loading -> CentredMessage(
            "Scoring…", "Compare works across the companies you already follow."
        )
        is WatchlistUiState.Failed -> CentredMessage(
            "Could not load", state.message, actionLabel = "Try again", onAction = onRetry
        )
        is WatchlistUiState.Ready -> Loaded(state.view.holdings.filter { it.error == null })
    }
}

@Composable
private fun Loaded(holdings: List<Holding>) {
    var selected by remember {
        mutableStateOf(holdings.take(3).map { it.ticker }.toSet())
    }

    val chosen = holdings.filter { it.ticker in selected }.take(MAX_COMPARED)

    Column(
        Modifier
            .fillMaxSize()
            .verticalScroll(rememberScrollState())
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        BasicText(
            "Compare",
            style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary)
        )
        BasicText(
            "Pick up to $MAX_COMPARED from your watchlist.",
            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
        )

        Row(
            Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
            horizontalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            for (h in holdings) {
                val on = h.ticker in selected
                val full = selected.size >= MAX_COMPARED && !on
                Box(
                    Modifier
                        .clip(RoundedCornerShape(OmahaRadius.pill))
                        .background(
                            if (on) Omaha.colors.brandCyan else Omaha.colors.bgSurfaceSubtle
                        )
                        .clickable(enabled = !full) {
                            selected = if (on) selected - h.ticker else selected + h.ticker
                        }
                        .padding(horizontal = 12.dp, vertical = 7.dp)
                ) {
                    BasicText(
                        h.ticker,
                        style = OmahaType.caption
                            .toTextStyle(
                                color = when {
                                    on -> Omaha.colors.bgCanvas
                                    full -> Omaha.colors.textTertiary
                                    else -> Omaha.colors.textSecondary
                                }
                            )
                            .copy(fontFamily = Omaha.fonts.mono)
                    )
                }
            }
        }

        if (chosen.isEmpty()) {
            BasicText(
                "Nothing selected.",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
            )
            return@Column
        }

        OmahaCard(contentPadding = 12.dp) {
            CompareRow("", chosen.map { it.ticker }, header = true)
            Divider()
            CompareRow(
                "Industry",
                chosen.map { h ->
                    val sector = h.sector?.takeIf { it.isNotBlank() }
                    val industry = h.industry?.takeIf { it.isNotBlank() }
                    when {
                        sector != null && industry != null && sector != industry -> "$sector · $industry"
                        industry != null -> industry
                        sector != null -> sector
                        else -> EM_DASH
                    }
                },
                explainKey = "Industry"
            )
            CompareRow(
                "Health",
                chosen.map { h -> h.healthScore?.let { "$it/100" } ?: EM_DASH },
                explainKey = "Health score"
            )
            CompareRow("Price", chosen.map { fmtPrice(it.price, it.currency) })
            CompareRow("Change", chosen.map { fmtPercent(it.changePct, 2, signed = true) })
            CompareRow("P/E", chosen.map { fmtRatio(it.peRatio, 1, "x") }, explainKey = "Trailing P/E")
            CompareRow("ROIC", chosen.map { fmtPercent(it.roicPct) }, explainKey = "ROIC")
            // Altman Z is not defined for a bank, so a financial shows ROE in
            // its place rather than an em dash that looks like missing data.
            // The two metrics explain differently, and which one a given cell
            // is showing varies company by company within the same row — so
            // this row explains per value cell rather than by its own label.
            CompareRow(
                "Altman Z / ROE",
                chosen.map { h ->
                    if (h.isFinancial) fmtPercent(h.roe) else fmtRatio(h.altmanZ, 2)
                },
                valueExplainKeys = chosen.map { h ->
                    if (h.isFinancial) "Return on equity" else "Altman Z-Score"
                }
            )
        }

        BasicText(
            "Measures that do not apply to a business are shown as not reported rather " +
                "than as a low score — a bank has no Altman Z, and treating that as a " +
                "failing grade would rank it below companies it is not comparable to.",
            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
        )
    }
}

/**
 * [explainKey] tags the row's own label — the usual case, one metric per
 * row. [valueExplainKeys], parallel to [values], tags each value cell
 * instead; only the Altman Z / ROE row needs it, since which of the two
 * metrics a cell shows varies company by company within the same row.
 */
@Composable
private fun CompareRow(
    label: String,
    values: List<String>,
    header: Boolean = false,
    explainKey: String? = null,
    valueExplainKeys: List<String>? = null
) {
    Row(
        Modifier.fillMaxWidth().padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Box(Modifier.width(96.dp)) {
            val labelStyle = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
            if (explainKey != null) {
                ExplainableLabel(key = explainKey, text = label, style = labelStyle)
            } else {
                BasicText(label, style = labelStyle)
            }
        }
        for ((i, v) in values.withIndex()) {
            Box(Modifier.weight(1f)) {
                val valueStyle = (if (header) OmahaType.bodySm else OmahaType.caption)
                    .toTextStyle(
                        color = if (header) Omaha.colors.textPrimary
                        else Omaha.colors.textSecondary
                    )
                    .copy(fontFamily = Omaha.fonts.mono)
                val valueKey = valueExplainKeys?.getOrNull(i)
                if (valueKey != null) {
                    ExplainableLabel(key = valueKey, text = v, style = valueStyle)
                } else {
                    BasicText(v, style = valueStyle)
                }
            }
        }
    }
}

@Composable
private fun Divider() {
    Box(
        Modifier
            .fillMaxWidth()
            .height(1.dp)
            .background(Omaha.colors.borderSubtle)
    )
}
