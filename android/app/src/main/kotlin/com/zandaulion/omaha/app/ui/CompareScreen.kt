package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.layout.size
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
import com.zandaulion.omaha.data.CompareCandidates
import com.zandaulion.omaha.data.Holding
import com.zandaulion.omaha.data.Pillar
import com.zandaulion.omaha.design.ExplainableLabel
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaCard
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

/**
 * Side by side, matching `#viewCompare`.
 *
 * Rows are the measures; columns are the picked companies — a metric stays
 * on one line where the eye can run along it. Unlike the four-column
 * version this replaces, the picked set is no longer a filter over the
 * current watchlist: [tickers] can include Yahoo's peers or anything this
 * install has scored before, which is the whole point of [ComparePicker]'s
 * three tiers — so each ticker is fetched on its own via [CompareViewModel].
 */
@Composable
fun CompareScreen(
    tickers: List<String>,
    holdings: Map<String, Holding>,
    pillars: Map<String, List<Pillar>>,
    candidates: CompareCandidates?,
    seedTicker: String?,
    onPick: (String) -> Unit,
    onDrop: (String) -> Unit,
    onOpenPicker: () -> Unit,
    onClosePicker: () -> Unit
) {
    var pickerOpen by remember { mutableStateOf(false) }

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            BasicText("Compare", style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary))
            BasicText(
                "Pick up to $MAX_COMPARED — your lists, Yahoo's peers, or anything looked up before.",
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
            )

            CompareSlots(
                tickers = tickers,
                onDrop = onDrop,
                onAdd = {
                    pickerOpen = true
                    onOpenPicker()
                }
            )

            if (tickers.isEmpty()) {
                BasicText(
                    "Nothing picked.",
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
                )
            } else {
                OmahaCard(contentPadding = 12.dp) {
                    CompareRow("", tickers, header = true)
                    Divider()
                    CompareRow(
                        "Industry",
                        tickers.map { t -> cell(holdings[t]) { h -> industryOf(h) } },
                        explainKey = "Industry"
                    )
                    CompareRow(
                        "Health",
                        tickers.map { t -> cell(holdings[t]) { h -> h.healthScore?.let { "$it/100" } ?: EM_DASH } },
                        explainKey = "Health score"
                    )
                    CompareRow("Price", tickers.map { t -> cell(holdings[t]) { h -> fmtPrice(h.price, h.currency) } })
                    CompareRow("Change", tickers.map { t -> cell(holdings[t]) { h -> fmtPercent(h.changePct, 2, signed = true) } })
                    CompareRow(
                        "P/E",
                        tickers.map { t -> cell(holdings[t]) { h -> fmtRatio(h.peRatio, 1, "x") } },
                        explainKey = "Trailing P/E"
                    )
                    CompareRow(
                        "ROIC",
                        tickers.map { t -> cell(holdings[t]) { h -> fmtPercent(h.roicPct) } },
                        explainKey = "ROIC"
                    )
                    // Altman Z is not defined for a bank, so a financial shows ROE in
                    // its place rather than an em dash that looks like missing data.
                    // The two metrics explain differently, and which one a given cell
                    // is showing varies company by company — so this row explains per
                    // value cell rather than by its own label.
                    CompareRow(
                        "Altman Z / ROE",
                        tickers.map { t ->
                            cell(holdings[t]) { h -> if (h.isFinancial) fmtPercent(h.roe) else fmtRatio(h.altmanZ, 2) }
                        },
                        valueExplainKeys = tickers.map { t ->
                            when (holdings[t]?.isFinancial) {
                                true -> "Return on equity"
                                else -> "Altman Z-Score"
                            }
                        }
                    )
                }

                BasicText(
                    "Measures that do not apply to a business are shown as not reported rather " +
                        "than as a low score — a bank has no Altman Z, and treating that as a " +
                        "failing grade would rank it below companies it is not comparable to.",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                )

                val radarSeries = tickers.mapNotNull { t -> pillars[t]?.let { t to it } }
                RadarChart(radarSeries)
            }
        }

        if (pickerOpen) {
            ComparePicker(
                seedTicker = seedTicker,
                candidates = candidates,
                picked = tickers,
                maxPicked = MAX_COMPARED,
                onPick = onPick,
                onClose = {
                    pickerOpen = false
                    onClosePicker()
                }
            )
        }
    }
}

/** A cell reads "…" while its [Holding] is still loading, and blank ([EM_DASH]-shaped) if it errored — the field function itself decides the errored/em-dash text. */
private fun cell(holding: Holding?, field: (Holding) -> String): String =
    if (holding == null || holding.loading) "…" else field(holding)

private fun industryOf(h: Holding): String {
    val sector = h.sector?.takeIf { it.isNotBlank() }
    val industry = h.industry?.takeIf { it.isNotBlank() }
    return when {
        sector != null && industry != null && sector != industry -> "$sector · $industry"
        industry != null -> industry
        sector != null -> sector
        else -> EM_DASH
    }
}

/** The picked tickers as removable chips, an "Add" chip while there's room, then empty placeholders — the limit is visible before it bites. */
@Composable
private fun CompareSlots(tickers: List<String>, onDrop: (String) -> Unit, onAdd: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        for (t in tickers) {
            Row(
                Modifier
                    .clip(RoundedCornerShape(OmahaRadius.pill))
                    .background(Omaha.colors.bgSurfaceSubtle)
                    .clickable { onDrop(t) }
                    .padding(horizontal = 12.dp, vertical = 7.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                BasicText(
                    t,
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
                Box(Modifier.padding(start = 6.dp)) {
                    BasicText("✕", style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
                }
            }
        }

        if (tickers.size < MAX_COMPARED) {
            Box(
                Modifier
                    .clip(RoundedCornerShape(OmahaRadius.pill))
                    .background(Omaha.colors.brandCyan)
                    .clickable(onClick = onAdd)
                    .padding(horizontal = 12.dp, vertical = 7.dp)
            ) {
                BasicText(
                    "+ Add",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.bgCanvas)
                )
            }
        }

        val empty = MAX_COMPARED - tickers.size - if (tickers.size < MAX_COMPARED) 1 else 0
        repeat(empty) {
            Box(
                Modifier
                    .size(width = 48.dp, height = 30.dp)
                    .clip(RoundedCornerShape(OmahaRadius.pill))
                    .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.pill))
            )
        }
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
