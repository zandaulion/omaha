package com.zandaulion.omaha.app.ui

import androidx.activity.compose.BackHandler
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
import androidx.compose.ui.text.font.FontWeight
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

    BackHandler(enabled = pickerOpen) {
        pickerOpen = false
        onClosePicker()
    }

    Box(Modifier.fillMaxSize()) {
        Column(
            Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            BasicText("⚔️ Side-by-Side Peer Comparison",
                style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
                    .copy(fontWeight = FontWeight.Bold))
            OmahaCard(contentPadding = 18.dp) {
                BasicText("Compare — up to $MAX_COMPARED",
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
                        .copy(fontWeight = FontWeight.Bold))
                Box(Modifier.height(16.dp))
                CompareSlots(tickers = tickers, onDrop = onDrop)
                Box(Modifier.height(16.dp))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    BasicText(if (tickers.isEmpty()) "+ Add companies" else "Change companies",
                        modifier = Modifier.fillMaxWidth()
                            .clip(RoundedCornerShape(8.dp))
                            .background(Omaha.colors.bgSurfaceSubtle)
                            .clickable {
                                pickerOpen = true
                                onOpenPicker()
                            }.padding(vertical = 9.dp),
                        style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary)
                            .copy(textAlign = androidx.compose.ui.text.style.TextAlign.Center, fontWeight = FontWeight.Bold))
                }
            }

            if (tickers.size < 2) {
                BasicText(
                    "Pick at least two companies. Results appear automatically.",
                    modifier = Modifier.fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp))
                        .background(Omaha.colors.bgSurfaceSubtle)
                        .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(8.dp))
                        .padding(vertical = 22.dp),
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
                        .copy(textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                )
            } else {
                val radarSeries = tickers.mapNotNull { t -> pillars[t]?.let { t to it } }
                RadarChart(radarSeries)
                OmahaCard(contentPadding = 12.dp) {
                    fun values(field: (Holding) -> String) =
                        tickers.map { t -> cell(holdings[t], field) }
                    CompareRow("Fundamental score", tickers, values { h -> h.healthScore?.let { "$it/100" } ?: EM_DASH },
                        explainKey = "Health score")
                    CompareRow("Industry", tickers, values(::industryOf), explainKey = "Industry", fullWidth = true)
                    CompareRow("Altman Z-Score", tickers, values { h -> fmtRatio(h.altmanZ, 2) },
                        explainKey = "Altman Z-Score")
                    CompareRow("Piotroski F-Score", tickers, values { h -> h.piotroskiScore?.let { "$it/9" } ?: EM_DASH },
                        explainKey = "Piotroski F-Score")
                    CompareRow("ROIC", tickers, values { h -> fmtPercent(h.roicPct) }, explainKey = "ROIC")
                    CompareRow("ROIC − WACC", tickers, values { h -> fmtPercent(h.roicSpread, signed = true) })
                    CompareRow("Cash conversion", tickers, values { h -> fmtPercent(h.fcfConversionPct, 0) })
                    CompareRow("Gross margin", tickers, values { h -> fmtPercent(h.grossMargin?.times(100)) })
                    CompareRow("Operating margin", tickers, values { h -> fmtPercent(h.operatingMargin?.times(100)) })
                    CompareRow("Net cash / (debt)", tickers, values { h ->
                        fmtBillions(h.netCashBillions, h.reportingCurrency ?: h.currency)
                    })
                    CompareRow("Current ratio", tickers, values { h -> fmtRatio(h.currentRatio, 2) })
                    CompareRow("Trailing P/E", tickers, values { h -> fmtRatio(h.peRatio, 1, "x") },
                        explainKey = "Trailing P/E")
                    CompareRow("P/E vs 5y median", tickers, values { h -> fmtPercent(h.peVsMedianPct, 0, signed = true) })
                    CompareRow("Revenue CAGR", tickers, values { h -> fmtPercent(h.revenueCagr?.times(100), signed = true) })
                    CompareRow("Checklist passed", tickers, values { h ->
                        val c = h.checklistTotals
                        val scored = c.pass + c.watch + c.fail
                        if (scored > 0) "${c.pass}/$scored" else EM_DASH
                    })
                }

            }
        }

        if (pickerOpen) {
            ComparePicker(
                seedTicker = seedTicker,
                candidates = candidates,
                picked = tickers,
                maxPicked = MAX_COMPARED,
                onPick = onPick,
                onDrop = onDrop,
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

/** Only selected companies take space; tapping one removes it. */
@Composable
private fun CompareSlots(tickers: List<String>, onDrop: (String) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for (row in tickers.chunked(2)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                row.forEach { ticker ->
                    Row(
                        Modifier.weight(1f).height(40.dp)
                            .clip(RoundedCornerShape(12.dp))
                            .background(Omaha.colors.bgSurfaceSubtle)
                            .border(1.dp, Omaha.colors.brandCyan,
                                RoundedCornerShape(12.dp))
                            .clickable { onDrop(ticker) },
                        horizontalArrangement = Arrangement.Center,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        BasicText(ticker, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary)
                            .copy(fontFamily = Omaha.fonts.mono, fontWeight = FontWeight.Bold))
                        BasicText(" ×", style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary))
                    }
                }
                if (row.size == 1) Box(Modifier.weight(1f))
            }
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
    tickers: List<String>,
    values: List<String>,
    explainKey: String? = null,
    valueExplainKeys: List<String>? = null,
    fullWidth: Boolean = false
) {
    Column(Modifier.fillMaxWidth().padding(vertical = 8.dp)) {
        Box(Modifier.fillMaxWidth()) {
            val labelStyle = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
            if (explainKey != null) {
                ExplainableLabel(key = explainKey, text = label, style = labelStyle)
            } else {
                BasicText(label, style = labelStyle)
            }
        }
        Box(Modifier.height(6.dp))
        values.withIndex().chunked(if (fullWidth) 1 else 2).forEach { pair ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                pair.forEach { (i, v) ->
                    Row(Modifier.weight(1f).background(Omaha.colors.bgSurfaceSubtle, RoundedCornerShape(6.dp)).padding(7.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        BasicText(tickers.getOrElse(i) { "" }, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary).copy(fontFamily = Omaha.fonts.mono))
                        val valueStyle = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary).copy(fontFamily = Omaha.fonts.mono)
                        val valueKey = valueExplainKeys?.getOrNull(i)
                        if (valueKey != null) ExplainableLabel(key = valueKey, text = v, style = valueStyle)
                        else BasicText(v, style = valueStyle)
                    }
                }
                if (pair.size == 1 && !fullWidth) Box(Modifier.weight(1f))
            }
            Box(Modifier.height(6.dp))
        }
        Divider()
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
