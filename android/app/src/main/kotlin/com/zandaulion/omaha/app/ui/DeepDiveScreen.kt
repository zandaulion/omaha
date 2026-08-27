package com.zandaulion.omaha.app.ui

import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.zandaulion.omaha.data.Check
import com.zandaulion.omaha.data.StockDetail
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

/**
 * The deep dive, matching `#viewDeepDive`.
 *
 * The PWA carries six sub-tabs. Overview and the checklist are built here; the
 * rest name the phase that fills them, on the same reasoning as the shell —
 * a scheduled slice reads as work remaining, "coming soon" reads as a dead end.
 *
 * Gemini is absent rather than placeholdered: it is a paid feature gated on
 * billing and a relay, which is phase 6, and a tab that cannot work even in
 * principle yet would be the wrong promise.
 */
enum class DeepDiveTab(val label: String) {
    Overview("Overview"),
    Checklist("12-Pt Checklist"),
    Trends("5Y Trends"),
    Dcf("DCF Sandbox"),
    Thesis("My Thesis")
}

@Composable
fun DeepDiveScreen(state: DeepDiveUiState, onRetry: () -> Unit) {
    when (state) {
        is DeepDiveUiState.Empty -> CentredMessage(
            "No company selected",
            "Open one from the watchlist."
        )

        is DeepDiveUiState.Loading -> CentredMessage(
            "Scoring ${state.ticker}…",
            "Fetching filings and running the engine on this device."
        )

        is DeepDiveUiState.Failed -> CentredMessage(
            state.ticker,
            state.message,
            actionLabel = "Try again",
            onAction = onRetry
        )

        is DeepDiveUiState.Ready -> Loaded(state.detail)
    }
}

@Composable
private fun Loaded(stock: StockDetail) {
    var tab by rememberSaveable(stock.ticker) { mutableStateOf(DeepDiveTab.Overview) }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item { Header(stock) }
        item { SubTabs(tab) { tab = it } }

        when (tab) {
            DeepDiveTab.Overview -> {
                item { ScoreCard(stock) }
                item { PillarsCard(stock) }
            }
            DeepDiveTab.Checklist -> {
                item { ChecklistSummaryBar(stock) }
                items(stock.checklist, key = { it.id }) { ChecklistRow(it) }
            }
            DeepDiveTab.Trends -> {
                val h = stock.history
                val bs = stock.balanceSheet
                item {
                    ChartCard(
                        "Revenue vs. free cash flow",
                        summary = revenueSummary(stock)
                    ) {
                        RevenueFcfChart(h.years, h.revenue, h.freeCashFlow, bs.reportingCurrency)
                    }
                }
                item {
                    ChartCard("Balance sheet cushion") {
                        BalanceSheetStack(bs.cash, bs.totalDebt, bs.netCash, bs.reportingCurrency)
                    }
                }
                item {
                    ChartCard("Margin trajectory", summary = marginSummary(bs)) {
                        MarginTrendChart(h.years, h.grossMarginPct, h.operatingMarginPct)
                    }
                }
                item {
                    ChartCard("Shares outstanding") {
                        SharesChart(h.years, h.sharesOutstanding, h.shareChangeYoY)
                    }
                }
            }
            DeepDiveTab.Dcf -> item {
                Slice("DCF Sandbox", "Two-stage discounted cash flow with live sliders " +
                    "and bear/base/bull presets. Phase 4d.")
            }
            DeepDiveTab.Thesis -> item {
                Slice("My Thesis & Log", "Conviction, target buy price, pre-committed " +
                    "sell triggers and the journal. Phase 4d — the product's differentiator.")
            }
        }
    }
}

/** `.deep-dive-hero`: identity, price, and what the numbers were filed against. */
@Composable
private fun Header(stock: StockDetail) {
    Column(Modifier.fillMaxWidth()) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                BasicText(
                    stock.ticker,
                    style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
                BasicText(
                    stock.name,
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
                )
                BasicText(
                    "${stock.sector} · ${stock.industry}",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                BasicText(
                    fmtPrice(stock.price, stock.currency),
                    style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
                BasicText(
                    fmtPercent(stock.changePct, 2, signed = true),
                    style = OmahaType.bodySm.toTextStyle(
                        color = if ((stock.changePct ?: 0.0) >= 0)
                            Omaha.colors.healthGood else Omaha.colors.healthRisk
                    ).copy(fontFamily = Omaha.fonts.mono)
                )
            }
        }

        // Which filing period the scorecard was built from, and — for a
        // depositary receipt — that it files in one currency and trades in
        // another. Left unsaid, a euro balance sheet sits under a dollar price
        // and nothing on screen admits it.
        val provenance = buildString {
            stock.fiscalPeriodEnd?.let { append("Fundamentals as filed to $it") }
            stock.fx?.takeIf { it.needed }?.let { fx ->
                if (isNotEmpty()) append(" · ")
                append("trades in ${fx.from}, reports in ${fx.to}")
                if (fx.available) append(" (1 ${fx.from} = ${fmtRatio(fx.rate, 4)} ${fx.to})")
                else append(" — no exchange rate available")
            }
        }
        if (provenance.isNotEmpty()) {
            Box(Modifier.height(6.dp))
            BasicText(
                provenance,
                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
            )
        }
    }
}

/** `.segmented-tabs`. Scrolls horizontally, as the web row does on a phone. */
@Composable
private fun SubTabs(selected: DeepDiveTab, onSelect: (DeepDiveTab) -> Unit) {
    Row(
        Modifier
            .fillMaxWidth()
            .horizontalScroll(rememberScrollState()),
        horizontalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        for (t in DeepDiveTab.entries) {
            val active = t == selected
            Box(
                Modifier
                    .clip(RoundedCornerShape(OmahaRadius.pill))
                    .background(
                        if (active) Omaha.colors.brandCyan else Omaha.colors.bgSurfaceSubtle
                    )
                    .clickable { onSelect(t) }
                    .padding(horizontal = 14.dp, vertical = 8.dp)
            ) {
                BasicText(
                    t.label,
                    style = OmahaType.bodySm.toTextStyle(
                        color = if (active) Omaha.colors.bgCanvas else Omaha.colors.textSecondary
                    )
                )
            }
        }
    }
}

@Composable
private fun ScoreCard(stock: StockDetail) {
    Card {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            ScoreRing(
                score = stock.healthScore,
                tier = stock.healthTier,
                label = stock.healthLabel
            )

            // How much of the scorecard the filings actually supported. Below
            // the engine's threshold there is no composite at all, and saying
            // so is the README's governing rule reaching the screen.
            stock.coverage?.takeIf { it.pct < 100 }?.let { c ->
                Box(Modifier.height(10.dp))
                BasicText(
                    "${c.measured} of ${c.total} measures available in the filings" +
                        if (!c.sufficient) " — too few to produce a score" else "",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                )
            }
        }
    }
}

@Composable
private fun PillarsCard(stock: StockDetail) {
    Card {
        BasicText(
            "Five pillars",
            style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
        )
        Box(Modifier.height(12.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            for (p in stock.pillars) {
                PillarMeter(p.name, p.score, p.max, p.pct, p.measured, p.of)
            }
        }
    }
}

@Composable
private fun ChecklistSummaryBar(stock: StockDetail) {
    val s = stock.checklistSummary
    Card {
        BasicText(
            buildString {
                append("${s.pass} pass · ${s.watch} watch · ${s.fail} fail")
                if (s.na > 0) append(" · ${s.na} not reported")
            },
            style = OmahaType.bodySm
                .toTextStyle(color = Omaha.colors.textSecondary)
                .copy(fontFamily = Omaha.fonts.mono)
        )
    }
}

/**
 * `.checklist-item`, drawer and all.
 *
 * The drawer is the reason to build this rather than a list of coloured dots.
 * Doc 15 §3.3 rates transparency as the second differentiator after the sell
 * triggers, and names the per-item explanations as what distinguishes this from
 * a proprietary rating — they are easy to drop as "detail" during a port, and
 * they are not detail, they are the argument.
 */
@Composable
private fun ChecklistRow(check: Check) {
    var open by remember(check.id) { mutableStateOf(false) }
    val colors = Omaha.colors
    val (dot, tagText) = when (check.status) {
        "pass" -> colors.healthGood to "Pass"
        "watch" -> colors.healthModerate to "Watch"
        "fail" -> colors.healthRisk to "Fail"
        else -> colors.textTertiary to "Not reported"
    }

    Card(onClick = { open = !open }, modifier = Modifier.animateContentSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(dot)
            )
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                BasicText(
                    check.name,
                    style = OmahaType.bodySm.toTextStyle(
                        color = if (check.status == "na") colors.textTertiary else colors.textPrimary
                    )
                )
                BasicText(
                    check.category,
                    style = OmahaType.caption.toTextStyle(color = colors.textTertiary)
                )
            }
            Column(horizontalAlignment = Alignment.End) {
                BasicText(
                    check.value ?: EM_DASH,
                    style = OmahaType.bodySm
                        .toTextStyle(color = colors.textPrimary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
                BasicText(tagText, style = OmahaType.caption.toTextStyle(color = dot))
            }
        }

        if (open) {
            Box(Modifier.height(10.dp))
            check.benchmark?.let {
                BasicText(
                    "Target: $it",
                    style = OmahaType.caption
                        .toTextStyle(color = colors.textSecondary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
                Box(Modifier.height(6.dp))
            }
            BasicText(
                check.explanation,
                style = OmahaType.bodySm.toTextStyle(color = colors.textSecondary)
            )
            if (check.status == "na") {
                Box(Modifier.height(6.dp))
                BasicText(
                    "Not scored — this measure is absent from the filings for this " +
                        "company, so it neither helps nor hurts the composite.",
                    style = OmahaType.caption.toTextStyle(color = colors.textTertiary)
                )
            }
        }
    }
}

/**
 * Revenue's start and end with its CAGR, and how much of it became cash.
 *
 * Uses the first and last *filed* values rather than the first and last slots,
 * so a leading or trailing gap does not silently become an endpoint.
 */
private fun revenueSummary(stock: StockDetail): String? {
    val rev = stock.history.revenue.filterNotNull()
    if (rev.isEmpty()) return null
    val cur = stock.balanceSheet.reportingCurrency
    val years = stock.history.cagrYears
    return buildString {
        append("${fmtBillions(rev.first(), cur)} → ${fmtBillions(rev.last(), cur)}")
        stock.history.revenueCagr?.let {
            append(" (${fmtPercent(it * 100, 1, signed = true)} ${years?.let { y -> "${y}Y " } ?: ""}CAGR)")
        }
        stock.balanceSheet.fcfConversionPct?.let {
            append(" · Cash conversion ${fmtPercent(it, 0)}")
        }
    }
}

private fun marginSummary(bs: com.zandaulion.omaha.data.BalanceSheet): String? {
    val parts = listOfNotNull(
        bs.grossMarginChangeBps?.let { "Gross ${if (it >= 0) "+" else ""}$it bps" },
        bs.operatingMarginChangeBps?.let { "Operating ${if (it >= 0) "+" else ""}$it bps" }
    )
    return parts.takeIf { it.isNotEmpty() }?.joinToString(" · ")
}

@Composable
private fun ChartCard(
    title: String,
    summary: String? = null,
    chart: @Composable () -> Unit
) {
    Card {
        BasicText(title, style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary))
        if (summary != null) {
            Box(Modifier.height(4.dp))
            BasicText(
                summary,
                style = OmahaType.caption
                    .toTextStyle(color = Omaha.colors.textSecondary)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
        }
        Box(Modifier.height(12.dp))
        chart()
    }
}

@Composable
private fun Slice(title: String, detail: String) {
    Card {
        BasicText(title, style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary))
        Box(Modifier.height(6.dp))
        BasicText(detail, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
    }
}

/** `.card`: the surface every block on this screen sits on. */
@Composable
private fun Card(
    onClick: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    content: @Composable androidx.compose.foundation.layout.ColumnScope.() -> Unit
) {
    Column(
        modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.md))
            .background(Omaha.colors.bgSurface)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.md))
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .padding(14.dp),
        content = content
    )
}
