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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.saveable.SaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.zandaulion.omaha.data.Check
import com.zandaulion.omaha.data.StockDetail
import com.zandaulion.omaha.data.StockInsight
import com.zandaulion.omaha.data.StockMetric
import com.zandaulion.omaha.data.assessStaleness
import com.zandaulion.omaha.design.ExplainableLabel
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaCard
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

/**
 * The deep dive, matching `#viewDeepDive`.
 *
 * The PWA carries six sub-tabs. All six are built now that phase 6 (the AI
 * relay and billing) has landed — Overview, the checklist and Gemini read
 * live data; DCF and trends work from the same scored payload.
 */
enum class DeepDiveTab(val label: String) {
    Overview("Overview"),
    Thesis("My reasons"),
    Checklist("12-point checklist"),
    Trends("5-year trends"),
    Dcf("DCF sandbox"),
    Ai("AI analysis")
}

@Composable
fun DeepDiveScreen(
    state: DeepDiveUiState,
    thesis: com.zandaulion.omaha.data.Thesis?,
    aiState: AiUiState,
    aiCreditPackPrice: String?,
    onRetry: () -> Unit,
    onThesisChange: (com.zandaulion.omaha.data.Thesis) -> Unit,
    onAddJournal: (String) -> Unit,
    onAiSignIn: () -> Unit,
    onAiGenerate: () -> Unit,
    onAiClaimFreeGrant: () -> Unit,
    onAiPurchase: () -> Unit,
    onAiDismissError: () -> Unit,
    onBack: () -> Unit = {},
    onBookmark: (String) -> Unit = {},
    isBookmarked: Boolean = false,
    requestedTab: DeepDiveTab = DeepDiveTab.Overview,
    navigationRequest: Int = 0,
    onRecordReview: (String, String) -> Unit = { _, _ -> },
    reviewSaving: Boolean = false,
    reviewSave: String? = null,
    thesisSave: String? = null,
    reviewChanges: List<com.zandaulion.omaha.data.ReviewChange> = emptyList(),
    onFilter: () -> Unit = {},
    onCompare: () -> Unit = {},
    onSearch: () -> Unit = {},
    onSubtabChange: (DeepDiveTab) -> Unit = {}
) {
    val thesisState = rememberSaveableStateHolder()
    // A data-provider outage must not hide the user's saved reasoning.
    if (requestedTab == DeepDiveTab.Thesis && thesis != null && state !is DeepDiveUiState.Ready) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    ReviewAction("← Back", onClick = onBack)
                    BasicText(thesis.ticker, style = OmahaType.title1.toTextStyle())
                }
            }
            item { BasicText("My reasons & reviews", style = OmahaType.title2.toTextStyle()) }
            if (state is DeepDiveUiState.Failed) item {
                BasicText("Financial data unavailable: ${state.message}", style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
                ReviewAction("Retry financial data", onClick = onRetry)
            }
            if (state is DeepDiveUiState.Loading) item {
                BasicText("Updating financial data…", style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
            }
            item { OmahaCard {
                thesisState.SaveableStateProvider(thesis.ticker) {
                    ThesisSection(thesis, onThesisChange, onAddJournal, onRecordReview, reviewSaving, reviewSave, thesisSave)
                }
            } }
        }
        return
    }
    when (state) {
        is DeepDiveUiState.Empty -> CentredMessage(
            "No company selected",
            "Search for a company or open one from your watchlist.",
            actionLabel = "Search companies",
            onAction = onSearch
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

        is DeepDiveUiState.Ready ->
            Loaded(
                state.detail,
                thesis,
                aiState,
                aiCreditPackPrice,
                onThesisChange,
                onAddJournal,
                onAiSignIn,
                onAiGenerate,
                onAiClaimFreeGrant,
                onAiPurchase,
                onAiDismissError,
                onBack,
                onBookmark,
                isBookmarked,
                requestedTab,
                navigationRequest,
                onRecordReview,
                reviewSaving,
                reviewSave,
                thesisSave,
                reviewChanges,
                onFilter,
                onCompare,
                onSubtabChange,
                thesisState
            )
    }
}

@Composable
private fun Loaded(
    stock: StockDetail,
    thesis: com.zandaulion.omaha.data.Thesis?,
    aiState: AiUiState,
    aiCreditPackPrice: String?,
    onThesisChange: (com.zandaulion.omaha.data.Thesis) -> Unit,
    onAddJournal: (String) -> Unit,
    onAiSignIn: () -> Unit,
    onAiGenerate: () -> Unit,
    onAiClaimFreeGrant: () -> Unit,
    onAiPurchase: () -> Unit,
    onAiDismissError: () -> Unit,
    onBack: () -> Unit,
    onBookmark: (String) -> Unit,
    isBookmarked: Boolean,
    requestedTab: DeepDiveTab,
    navigationRequest: Int,
    onRecordReview: (String, String) -> Unit,
    reviewSaving: Boolean,
    reviewSave: String?,
    thesisSave: String?,
    reviewChanges: List<com.zandaulion.omaha.data.ReviewChange>,
    onFilter: () -> Unit,
    onCompare: () -> Unit,
    onSubtabChange: (DeepDiveTab) -> Unit,
    thesisState: SaveableStateHolder
) {
    var tab by rememberSaveable(stock.ticker) { mutableStateOf(requestedTab) }
    LaunchedEffect(stock.ticker, navigationRequest) { tab = requestedTab }
    val selectTab: (DeepDiveTab) -> Unit = { tab = it; onSubtabChange(it) }
    val isTablet = LocalConfiguration.current.smallestScreenWidthDp >= 600

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item { Header(stock, onBack, { selectTab(DeepDiveTab.Thesis) }, onBookmark, isBookmarked, tab != DeepDiveTab.Thesis) }
        item {
            if (isTablet) SubTabs(tab, selectTab)
            else ResearchSectionSelector(tab, selectTab)
        }
        if (tab == DeepDiveTab.Overview) item { ScoreCard(stock) }

        when (tab) {
            DeepDiveTab.Overview -> {
                item { OverviewTeaser { selectTab(DeepDiveTab.Thesis) } }
                item { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    ReviewAction("Filter companies", onClick = onFilter)
                    ReviewAction("Compare", onClick = onCompare)
                } }
                item { InsightCard("Financial strengths", stock.catalysts, Omaha.colors.healthPristine) }
                item { InsightCard("Watchpoints", stock.risks, Omaha.colors.healthModerate) }
                item { KeyMetricsCard(stock) }
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
                OmahaCard { DcfSandbox(stock) }
            }
            DeepDiveTab.Thesis -> {
                if (reviewChanges.isNotEmpty()) item {
                    OmahaCard {
                        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            BasicText("Changes to consider", style = OmahaType.title2.toTextStyle())
                            reviewChanges.take(3).forEach { change ->
                                BasicText(change.title, style = OmahaType.bodySm.toTextStyle())
                                BasicText(change.body, style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
                            }
                        }
                    }
                }
                item {
                    OmahaCard {
                        if (thesis == null) {
                            BasicText(
                                "Loading your notes…",
                                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
                            )
                        } else {
                            thesisState.SaveableStateProvider(thesis.ticker) {
                                ThesisSection(thesis, onThesisChange, onAddJournal, onRecordReview, reviewSaving, reviewSave, thesisSave)
                            }
                        }
                    }
                }
            }
            DeepDiveTab.Ai -> {
                when (aiState) {
                    AiUiState.Loading -> item {
                        OmahaCard {
                            BasicText(
                                "Checking for a saved analysis…",
                                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
                            )
                        }
                    }
                    is AiUiState.Ready -> {
                        item {
                            OmahaCard {
                                AiStatusSection(
                                    aiState,
                                    aiCreditPackPrice,
                                    onAiSignIn,
                                    onAiGenerate,
                                    onAiClaimFreeGrant,
                                    onAiPurchase,
                                    onAiDismissError
                                )
                            }
                        }
                        aiState.summary?.let { summary ->
                            val staleness = assessStaleness(summary, stock)
                            if (staleness.stale) {
                                item { OmahaCard { AiStalenessCard(staleness, onReanalyze = onAiGenerate) } }
                            }
                            item { OmahaCard { AiVerdictCard(summary) } }
                            item { OmahaCard { AiRatingsCard(summary) } }
                            item { OmahaCard { AiStrengthsRisksCard(summary) } }
                            item { OmahaCard { AiBuyZoneCard(summary) } }
                            item { OmahaCard { AiCaveatsCard(summary) } }
                        }
                    }
                }
            }
        }
    }
}

/** The PWA's back, company, AI, bookmark, then price row. */
@Composable
private fun Header(
    stock: StockDetail,
    onBack: () -> Unit,
    onReview: () -> Unit,
    onBookmark: (String) -> Unit,
    isBookmarked: Boolean,
    showPrice: Boolean
) {
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Box(
                Modifier.clip(RoundedCornerShape(OmahaRadius.sm))
                    .background(Omaha.colors.bgSurfaceSubtle)
                    .clickable(onClick = onBack)
                    .padding(horizontal = 10.dp, vertical = 8.dp)
            ) {
                BasicText("← Back", style = OmahaType.bodySm.toTextStyle())
            }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally) {
                BasicText(
                    stock.ticker,
                    style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
                BasicText(
                    stock.name,
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary),
                    maxLines = 1
                )
            }
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(
                    Modifier.clip(RoundedCornerShape(OmahaRadius.pill))
                        .background(Omaha.colors.bgSurfaceSubtle)
                        .clickable(onClick = onReview)
                        .padding(horizontal = 9.dp, vertical = 7.dp)
                ) {
                    BasicText("Review", style = OmahaType.caption.toTextStyle(color = Omaha.colors.brandCyan))
                }
                Box(
                    Modifier.size(36.dp).clip(RoundedCornerShape(OmahaRadius.pill))
                        .background(Omaha.colors.bgSurfaceSubtle)
                        .clickable { onBookmark(stock.ticker) },
                    contentAlignment = Alignment.Center
                ) {
                    BasicText(if (isBookmarked) "⭐" else "☆", style = OmahaType.title2.toTextStyle(
                        color = Omaha.colors.brandGold
                    ))
                }
            }
        }
        if (showPrice) {
        Box(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                BasicText(
                    fmtPrice(stock.price, stock.currency),
                    style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary)
                        .copy(fontFamily = Omaha.fonts.mono, fontSize = 28.sp, fontWeight = FontWeight.Bold)
                )
                BasicText(stock.currency, style = OmahaType.caption.toTextStyle(
                    color = Omaha.colors.textTertiary
                ))
            }
            BasicText(
                fmtPercent(stock.changePct, 2, signed = true),
                style = OmahaType.bodyMd.toTextStyle(
                    color = if ((stock.changePct ?: 0.0) >= 0)
                        Omaha.colors.healthGood else Omaha.colors.healthRisk
                ).copy(fontFamily = Omaha.fonts.mono)
            )
        }
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

/** A discoverable mobile section switcher: all destinations fit on screen. */
@Composable
private fun ResearchSectionSelector(selected: DeepDiveTab, onSelect: (DeepDiveTab) -> Unit) {
    var expanded by rememberSaveable { mutableStateOf(false) }
    Column(
        Modifier.fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(Omaha.colors.bgSurfaceSubtle)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.sm))
    ) {
        Row(
            Modifier.fillMaxWidth().clickable { expanded = !expanded }
                .padding(horizontal = 14.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                BasicText("Research section", style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
                BasicText(selected.label, style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.textPrimary).copy(fontWeight = FontWeight.Bold))
            }
            BasicText(if (expanded) "⌃" else "⌄", style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.brandCyan))
        }
        if (expanded) {
            DeepDiveTab.entries.forEach { section ->
                val active = section == selected
                BasicText(
                    (if (active) "✓  " else "   ") + section.label,
                    modifier = Modifier.fillMaxWidth()
                        .background(if (active) Omaha.colors.brandGlow else Color.Transparent)
                        .clickable { onSelect(section); expanded = false }
                        .padding(horizontal = 14.dp, vertical = 11.dp),
                    style = OmahaType.bodySm.toTextStyle(
                        color = if (active) Omaha.colors.brandCyan else Omaha.colors.textSecondary
                    )
                )
            }
        }
    }
}

@Composable
private fun ScoreCard(stock: StockDetail) {
    OmahaCard(contentPadding = 16.dp) {
        Column(
            Modifier.fillMaxWidth(),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            ExplainableLabel(
                key = "Fundamental score",
                text = "Fundamental score",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
            )
            Box(Modifier.height(8.dp))
            ScoreRing(
                score = stock.healthScore,
                tier = stock.healthTier,
                label = fundamentalGrade(stock.healthTier, stock.healthScore),
                diameter = 116.dp
            )

            Box(Modifier.height(6.dp))
            BasicText(
                "${stock.sector} · ${stock.industry}",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary),
                maxLines = 2
            )
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
                BasicText(provenance, style = OmahaType.caption.toTextStyle(
                    color = Omaha.colors.textTertiary
                ))
            }

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
        Box(Modifier.height(16.dp))
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            for (p in stock.pillars) {
                PillarMeter(p.name, p.score, p.max, p.pct, p.measured, p.of)
            }
        }
    }
}

@Composable
private fun OverviewTeaser(onReview: () -> Unit) {
    OmahaCard {
        BasicText(
            "Revisit your reasons",
            style = OmahaType.title2.toTextStyle(color = Omaha.colors.brandViolet)
        )
        Box(Modifier.height(8.dp))
        BasicText(
            "Your view of this company",
            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
        )
        Box(Modifier.height(8.dp))
        BasicText(
            "Put the financial picture beside your own reasons. Record what still holds, what needs watching, or what changed.",
            style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
        )
        Box(Modifier.height(12.dp))
        Box(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(OmahaRadius.sm))
                .background(Omaha.colors.brandBlue)
                .clickable(onClick = onReview)
                .padding(10.dp),
            contentAlignment = Alignment.Center
        ) {
            BasicText("My reasons & reviews", style = OmahaType.bodySm.toTextStyle(
                color = Color.White
            ))
        }
    }
}

@Composable
private fun InsightCard(title: String, insights: List<StockInsight>, tint: Color) {
    OmahaCard {
        BasicText(title, style = OmahaType.title2.toTextStyle(color = tint))
        Box(Modifier.height(12.dp))
        if (insights.isEmpty()) {
            BasicText("No flags from the available filings.", style = OmahaType.bodySm.toTextStyle(
                color = Omaha.colors.textSecondary
            ))
        }
        insights.forEach { insight ->
            Row(
                Modifier.fillMaxWidth().padding(bottom = 8.dp)
                    .clip(RoundedCornerShape(OmahaRadius.sm))
                    .background(Omaha.colors.bgSurfaceSubtle)
                    .padding(10.dp),
                horizontalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                BasicText(insight.icon, style = OmahaType.title2.toTextStyle())
                Column(Modifier.weight(1f)) {
                    BasicText(insight.title, style = OmahaType.bodySm.toTextStyle(color = tint)
                        .copy(fontWeight = FontWeight.Bold))
                    BasicText(insight.text, style = OmahaType.caption.toTextStyle(
                        color = Omaha.colors.textSecondary
                    ))
                }
            }
        }
    }
}

@Composable
private fun KeyMetricsCard(stock: StockDetail) {
    OmahaCard {
        BasicText("📊 Key Fundamental Ratios", style = OmahaType.title2.toTextStyle())
        Box(Modifier.height(12.dp))
        stock.keyMetrics.chunked(2).forEach { row ->
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                row.forEach { metric ->
                    Column(
                        Modifier.weight(1f).padding(bottom = 8.dp)
                            .clip(RoundedCornerShape(OmahaRadius.sm))
                            .background(Omaha.colors.bgSurfaceSubtle)
                            .padding(10.dp)
                    ) {
                        ExplainableLabel(
                            key = metric.label,
                            text = metric.label,
                            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                        )
                        BasicText(formatMetric(metric, stock.currency), style = OmahaType.bodyMd.toTextStyle(
                            color = Omaha.colors.textPrimary
                        ).copy(fontFamily = Omaha.fonts.mono))
                    }
                }
                if (row.size == 1) Box(Modifier.weight(1f))
            }
        }
    }
}

private fun formatMetric(metric: StockMetric, currency: String): String {
    val value = metric.value ?: return EM_DASH
    return when (metric.format) {
        "percent" -> fmtPercent(value * 100.0)
        "percent-point" -> fmtPercent(value)
        "multiple" -> fmtRatio(value, 1, "x")
        "score9" -> "${value.toInt()}/9"
        "billions" -> "${if (currency == "USD") "$" else "$currency "}${fmtRatio(value, 1)}B"
        else -> fmtRatio(value, 2)
    }
}

@Composable
private fun ChecklistSummaryBar(stock: StockDetail) {
    val s = stock.checklistSummary
    OmahaCard {
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

    OmahaCard(onClick = { open = !open }, modifier = Modifier.animateContentSize()) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Box(
                Modifier
                    .size(8.dp)
                    .clip(CircleShape)
                    .background(dot)
            )
            Column(Modifier.weight(1f).padding(start = 10.dp)) {
                ExplainableLabel(
                    key = check.name,
                    text = check.name,
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
    OmahaCard {
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
    OmahaCard {
        BasicText(title, style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary))
        Box(Modifier.height(6.dp))
        BasicText(detail, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
    }
}
