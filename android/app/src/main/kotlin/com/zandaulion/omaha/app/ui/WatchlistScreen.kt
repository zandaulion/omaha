package com.zandaulion.omaha.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import com.zandaulion.omaha.data.Holding
import com.zandaulion.omaha.data.PortfolioHealth
import com.zandaulion.omaha.data.WatchlistRow
import com.zandaulion.omaha.design.ExplainableLabel
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaCard
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
    lists: List<WatchlistRow> = emptyList(),
    activeId: String? = null,
    notice: String? = null,
    onRetry: () -> Unit,
    onSelect: (String) -> Unit,
    onSelectList: (String) -> Unit = {},
    onOpenSearch: () -> Unit = {},
    onRemoveTicker: (String) -> Unit = {},
    onCreateList: (String) -> Unit = {},
    onDeleteList: (String) -> Unit = {},
    onFilter: () -> Unit = {},
    onCompare: () -> Unit = {}
) {
    var sortBy by rememberSaveable { mutableStateOf("health") }
    var controlSheet by rememberSaveable { mutableStateOf<String?>(null) }
    var pendingTickerRemoval by rememberSaveable { mutableStateOf<String?>(null) }
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

        is WatchlistUiState.Ready -> WatchlistReadyContent(
            state = state,
            sortBy = sortBy,
            notice = notice,
            onChooseList = { controlSheet = "list" },
            onOpenSearch = onOpenSearch,
            onOpenSort = { controlSheet = "sort" },
            onFilter = onFilter,
            onCompare = onCompare,
            onSelect = onSelect,
            onRemove = { pendingTickerRemoval = it }
        )
    }

    when (controlSheet) {
        "list" -> WatchlistPickerDialog(
            lists = lists,
            selectedId = activeId,
            onDismiss = { controlSheet = null },
            onChoose = { id ->
                onSelectList(id)
                controlSheet = null
            },
            onCreate = { controlSheet = "create" },
            onDelete = { id -> controlSheet = "delete-list:$id" }
        )
        "sort" -> ChoiceDialog(
            title = "Sort companies",
            options = watchlistSortOptions,
            selectedId = sortBy,
            onDismiss = { controlSheet = null }
        ) {
            sortBy = it
            controlSheet = null
        }
        "create" -> EntryDialog(
            title = "New watchlist",
            placeholder = "Watchlist name",
            submitLabel = "Create",
            uppercase = false,
            onDismiss = { controlSheet = null }
        ) {
            onCreateList(it)
            controlSheet = null
        }
        else -> if (controlSheet?.startsWith("delete-list:") == true) {
            val id = controlSheet!!.substringAfter("delete-list:")
            val name = lists.firstOrNull { it.id == id }?.name ?: "this watchlist"
            ConfirmationDialog(
                title = "Delete “$name”?",
                message = "This removes the watchlist. Your saved company data and research remain.",
                confirmLabel = "Delete",
                onDismiss = { controlSheet = "list" }
            ) {
                onDeleteList(id)
                controlSheet = null
            }
        }
    }

    pendingTickerRemoval?.let { ticker ->
        val listName = lists.firstOrNull { it.id == activeId }?.name ?: "this watchlist"
        ConfirmationDialog(
            title = "Remove $ticker?",
            message = "Remove $ticker from $listName? Your saved company data and research remain.",
            confirmLabel = "Remove",
            onDismiss = { pendingTickerRemoval = null }
        ) {
            onRemoveTicker(ticker)
            pendingTickerRemoval = null
        }
    }
}

@Composable
private fun WatchlistReadyContent(
    state: WatchlistUiState.Ready,
    sortBy: String,
    notice: String?,
    onChooseList: () -> Unit,
    onOpenSearch: () -> Unit,
    onOpenSort: () -> Unit,
    onFilter: () -> Unit,
    onCompare: () -> Unit,
    onSelect: (String) -> Unit,
    onRemove: (String) -> Unit
) {
    val holdings = sortedHoldings(state.view.holdings, sortBy)
    BoxWithConstraints(Modifier.fillMaxSize()) {
        if (maxWidth >= 660.dp) {
            Row(
                Modifier.fillMaxSize().padding(16.dp),
                horizontalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                LazyColumn(
                    Modifier.width(300.dp).fillMaxHeight(),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    item {
                        PortfolioHero(
                            health = state.view.health,
                            pending = state.view.pending,
                            onChooseList = onChooseList
                        )
                    }
                    item {
                        WatchlistToolbar(
                            sortBy = sortBy,
                            onOpenSearch = onOpenSearch,
                            onOpenSort = onOpenSort,
                            onFilter = onFilter,
                            onCompare = onCompare
                        )
                    }
                    notice?.let { message ->
                        item {
                            BasicText(
                                message,
                                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                            )
                        }
                    }
                }
                LazyColumn(
                    Modifier.weight(1f).fillMaxHeight(),
                    contentPadding = PaddingValues(bottom = 16.dp),
                    verticalArrangement = Arrangement.spacedBy(10.dp)
                ) {
                    item {
                        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                            BasicText("Companies", style = OmahaType.title2.toTextStyle())
                            BasicText(
                                "${holdings.size} in this watchlist",
                                style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                            )
                        }
                    }
                    items(holdings, key = { it.ticker }) { holding ->
                        HoldingCard(
                            holding,
                            onClick = { if (!holding.loading) onSelect(holding.ticker) },
                            onRemove = { onRemove(holding.ticker) }
                        )
                    }
                }
            }
        } else {
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                item {
                    PortfolioHero(
                        health = state.view.health,
                        pending = state.view.pending,
                        onChooseList = onChooseList
                    )
                }
                item {
                    WatchlistToolbar(
                        sortBy = sortBy,
                        onOpenSearch = onOpenSearch,
                        onOpenSort = onOpenSort,
                        onFilter = onFilter,
                        onCompare = onCompare
                    )
                }
                notice?.let { message ->
                    item {
                        BasicText(
                            message,
                            style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                        )
                    }
                }
                items(holdings, key = { it.ticker }) { holding ->
                    HoldingCard(
                        holding,
                        onClick = { if (!holding.loading) onSelect(holding.ticker) },
                        onRemove = { onRemove(holding.ticker) }
                    )
                }
            }
        }
    }
}

private val watchlistSortOptions = listOf(
    "health" to "Fundamental score",
    "change" to "Price change",
    "roic" to "ROIC",
    "pe" to "P/E ratio"
)

private fun sortedHoldings(holdings: List<Holding>, sortBy: String): List<Holding> = when (sortBy) {
    "change" -> holdings.sortedWith(compareByDescending<Holding> { it.changePct ?: Double.NEGATIVE_INFINITY })
    "roic" -> holdings.sortedWith(compareByDescending<Holding> { it.roicPct ?: Double.NEGATIVE_INFINITY })
    "pe" -> holdings.sortedWith(compareBy<Holding> { it.peRatio ?: Double.POSITIVE_INFINITY })
    else -> holdings.sortedWith(compareByDescending<Holding> { it.healthScore ?: Int.MIN_VALUE })
}

/**
 * `.portfolio-hero`: the list's name, its size, and the composite badge.
 *
 * `.portfolio-hero::before` in the PWA lays a radial glow over the top-right
 * corner (`radial-gradient(circle, var(--brand-glow) 0%, transparent 70%)`).
 * `Omaha.colors.brandGlow` was already generated for this and, until now,
 * never drawn anywhere on Android — the `Brush.radialGradient` below is the
 * same glow, positioned to bleed off the same corner.
 */
@Composable
private fun PortfolioHero(
    health: PortfolioHealth,
    pending: Int = 0,
    onChooseList: () -> Unit
) {
    val shape = RoundedCornerShape(OmahaRadius.lg)
    var detailsOpen by rememberSaveable(health.watchlistName) { mutableStateOf(false) }
    Box(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(Omaha.colors.bgSurfaceElevated)
            .border(1.dp, Omaha.colors.borderProminent, shape)
    ) {
        Box(Modifier.fillMaxWidth()) {
            Box(
                Modifier
                    .align(Alignment.TopEnd)
                    .offset(x = 50.dp, y = (-50).dp)
                    .size(140.dp)
                    .background(
                        Brush.radialGradient(
                            colorStops = arrayOf(0f to Omaha.colors.brandGlow, 0.7f to Color.Transparent)
                        )
                    )
            )

            Column(Modifier.padding(20.dp)) {
                val isStarter = health.watchlistName in setOf("The Compounders", "AI & Semiconductors", "Defensive Aristocrats")
                BasicText(
                    if (isStarter) "STARTER WATCHLIST" else "CURRENT WATCHLIST",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.brandCyan)
                        .copy(fontWeight = FontWeight.Bold)
                )
                if (isStarter) {
                    Box(Modifier.height(3.dp))
                    BasicText(
                        "Example companies are preloaded. Change this list or create your own.",
                        style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                    )
                }
                Box(Modifier.height(5.dp))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(OmahaRadius.sm))
                        .background(Omaha.colors.bgSurfaceSubtle)
                        .border(1.dp, Omaha.colors.borderProminent, RoundedCornerShape(OmahaRadius.sm))
                        .semantics {
                            contentDescription = "Change watchlist. Current watchlist: ${health.watchlistName}"
                            role = Role.Button
                        }
                        .clickable(onClick = onChooseList)
                        .padding(horizontal = 10.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    BasicText(
                        health.watchlistName,
                        modifier = Modifier.weight(1f),
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                        style = OmahaType.title2.toTextStyle(color = Omaha.colors.textPrimary)
                            .copy(fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    )
                    Box(Modifier.width(8.dp))
                    BasicText(
                        "Change  ⌄",
                        style = OmahaType.caption.toTextStyle(color = Omaha.colors.brandCyan)
                            .copy(fontWeight = FontWeight.Bold)
                    )
                }
                Box(Modifier.height(6.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    BasicText(
                        "${health.holdingCount} companies" +
                            if (pending == 0 && health.scoredCount < health.holdingCount)
                                " · ${health.holdingCount - health.scoredCount} not scored" else "",
                        style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
                    )
                    HeroGradeBadge(health)
                }

                val totals = health.checklistTotals
                Box(Modifier.height(8.dp))
                BasicText(
                    "🟢 ${totals.pass} pass · 🟡 ${totals.watch} watch · 🔴 ${totals.fail} fail" +
                        if (totals.notReported > 0) " · ${totals.notReported} not reported" else "",
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
                )
                Box(Modifier.height(8.dp))
                BasicText(
                    if (detailsOpen) "Hide portfolio breakdown  ⌃" else "View portfolio breakdown  ⌄",
                    modifier = Modifier.fillMaxWidth().clickable { detailsOpen = !detailsOpen }.padding(vertical = 4.dp),
                    style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.brandCyan).copy(fontWeight = FontWeight.Bold)
                )
                if (detailsOpen) {
                    Box(Modifier.height(12.dp))
                    val names = listOf("Solvency", "Profitability", "Valuation", "Growth", "Capital Return")
                    names.forEachIndexed { index, name ->
                        PillarMeter(name, health.pillarScores.getOrNull(index))
                        if (index != names.lastIndex) Box(Modifier.height(10.dp))
                    }
                    Box(Modifier.height(12.dp))
                    BasicText(
                        if (health.weighting == "market-cap")
                            "Company-size weighted average; this does not use your position sizes."
                        else "Average of available scores; this does not use your position sizes.",
                        style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                    )
                }

                // States what the average is an average of. A composite over three
                // of five holdings is a different claim from one over all five, and
                // the engine reports null rather than zero where too few line items
                // were filed — averaging those in would read "bad" instead of
                // "unmeasured". While the list is still loading the composite is a
                // partial figure, and saying "averaged over 1 of 5" would read as a
                // finding about the holdings rather than as progress. The two cases
                // are worded apart.
                if (pending > 0) {
                    Box(Modifier.height(10.dp))
                    BasicText(
                        "Scoring… $pending of ${health.holdingCount} still to go.",
                        style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                    )
                } else if (health.scoredCount != health.holdingCount) {
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
    }
}

@Composable
private fun HeroGradeBadge(health: PortfolioHealth) {
    val (fg, bg, border) = tierColors(health.tier, Omaha.colors)
    val grade = when (health.tier) {
        "pristine" -> "STRONG"
        "good" -> "GOOD"
        "moderate" -> "MIXED"
        else -> if (health.compositeScore == null) "NOT SCORED" else "WEAK"
    }
    Box(
        Modifier
            .padding(start = 8.dp)
            .width(112.dp)
            .clip(RoundedCornerShape(OmahaRadius.pill))
            .background(bg)
            .border(1.dp, border, RoundedCornerShape(OmahaRadius.pill))
            .padding(horizontal = 12.dp, vertical = 6.dp)
    ) {
        BasicText(
            if (health.compositeScore == null) grade else "$grade\n(${health.compositeScore}/100)",
            style = OmahaType.bodySm.toTextStyle(color = fg).copy(textAlign = TextAlign.Center),
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun PillarMeter(name: String, score: Double?) {
    val pct = ((score ?: 0.0) / 20.0).coerceIn(0.0, 1.0).toFloat()
    val barColor = when {
        score == null -> Omaha.colors.borderSubtle
        pct >= 0.85f -> Color(0xFF10B981)
        pct >= 0.70f -> Color(0xFF34D399)
        pct >= 0.50f -> Color(0xFFFBBF24)
        else -> Color(0xFFF87171)
    }
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(Omaha.colors.bgSurfaceSubtle)
            .padding(horizontal = 10.dp, vertical = 8.dp)
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            ExplainableLabel(
                key = name,
                text = name,
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
            )
            BasicText(
                if (score == null) EM_DASH else "${fmtRatio(score, 1)}/20",
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary)
                    .copy(fontFamily = Omaha.fonts.mono)
            )
        }
        Box(Modifier.height(5.dp))
        Box(
            Modifier.fillMaxWidth().height(5.dp)
                .clip(RoundedCornerShape(OmahaRadius.pill))
                .background(Omaha.colors.borderSubtle)
        ) {
            Box(Modifier.fillMaxWidth(pct).height(5.dp).background(barColor))
        }
    }
}

/** `.stock-card`. */
@Composable
private fun HoldingCard(holding: Holding, onClick: () -> Unit, onRemove: () -> Unit = {}) {
    OmahaCard(onClick = onClick) {
        if (holding.loading) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                BasicText(
                    holding.ticker,
                    style = OmahaType.title2.toTextStyle(color = Omaha.colors.textTertiary)
                        .copy(fontFamily = Omaha.fonts.mono)
                )
                Box(Modifier.padding(start = 10.dp)) {
                    BasicText(
                        "queued",
                        style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary)
                    )
                }
            }
            return@OmahaCard
        }

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
            Box(Modifier.height(8.dp))
            Box(
                Modifier
                    .clip(RoundedCornerShape(OmahaRadius.pill))
                    .background(Omaha.colors.bgSurfaceSubtle)
                    .clickable(onClick = onRemove)
                    .padding(horizontal = 12.dp, vertical = 6.dp)
            ) {
                BasicText(
                    "Remove from watchlist",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary)
                )
            }
            return@OmahaCard
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
                val ind = when {
                    !holding.sector.isNullOrBlank() && !holding.industry.isNullOrBlank() && holding.sector != holding.industry ->
                        "${holding.sector} · ${holding.industry}"
                    !holding.industry.isNullOrBlank() -> holding.industry
                    !holding.sector.isNullOrBlank() -> holding.sector
                    else -> null
                }
                if (ind != null) {
                    Box(Modifier.height(2.dp))
                    BasicText(
                        ind,
                        style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary),
                        maxLines = 1
                    )
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
                Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    BasicText(
                        fmtPrice(holding.price, holding.currency),
                        style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.textPrimary)
                            .copy(fontFamily = Omaha.fonts.mono)
                    )
                    BasicText(
                        "×",
                        modifier = Modifier.clickable(onClick = onRemove).padding(horizontal = 2.dp),
                        style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.textTertiary)
                    )
                }
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

@Composable
private fun WatchlistToolbar(
    sortBy: String,
    onOpenSearch: () -> Unit,
    onOpenSort: () -> Unit,
    onFilter: () -> Unit,
    onCompare: () -> Unit
) {
    val compactSortLabel = when (sortBy) {
        "change" -> "Change"
        "roic" -> "ROIC"
        "pe" -> "P/E"
        else -> "Score"
    }
    Column(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { ControlButton("+ Add company", primary = true, onClick = onOpenSearch) }
            SelectControl("↕ $compactSortLabel", onClick = onOpenSort)
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Box(Modifier.weight(1f)) { ControlButton("Filter", onClick = onFilter) }
            Box(Modifier.weight(1f)) { ControlButton("Compare", onClick = onCompare) }
        }
    }
}

@Composable
private fun SelectControl(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(Omaha.colors.bgSurfaceSubtle)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.sm))
            .semantics { role = Role.Button }
            .clickable(onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp)
    ) {
        BasicText(
            "$label  ⌄",
            style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary)
        )
    }
}

@Composable
private fun ControlButton(label: String, primary: Boolean = false, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(if (primary) Omaha.colors.brandBlue else Omaha.colors.bgSurfaceSubtle)
            .border(1.dp, if (primary) Omaha.colors.brandBlue else Omaha.colors.borderSubtle,
                RoundedCornerShape(OmahaRadius.sm))
            .semantics { role = Role.Button }
            .clickable(onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 8.dp)
    ) {
        BasicText(
            label,
            style = OmahaType.bodySm.toTextStyle(
                color = if (primary) Color.White else Omaha.colors.textPrimary
            )
        )
    }
}

@Composable
private fun ChoiceDialog(
    title: String,
    options: List<Pair<String, String>>,
    selectedId: String? = null,
    onDismiss: () -> Unit,
    onChoose: (String) -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(
            usePlatformDefaultWidth = false,
            dismissOnClickOutside = true
        )
    ) {
        Box(
            Modifier
                .fillMaxSize()
                .clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = onDismiss
                )
                .padding(horizontal = 12.dp, vertical = 16.dp),
            contentAlignment = Alignment.BottomCenter
        ) {
            OmahaCard(
                modifier = Modifier
                    .fillMaxWidth()
                    .widthIn(max = 520.dp)
                    .clickable(
                        interactionSource = remember { MutableInteractionSource() },
                        indication = null,
                        onClick = {}
                    ),
                contentPadding = 20.dp
            ) {
                BasicText(title, style = OmahaType.title2.toTextStyle())
                Box(Modifier.height(12.dp))
                options.forEach { (id, label) ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(OmahaRadius.sm))
                            .clickable { onChoose(id) }
                            .padding(horizontal = 4.dp, vertical = 13.dp),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        BasicText(label, style = OmahaType.bodyMd.toTextStyle())
                        if (id == selectedId) {
                            BasicText("✓", style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.brandCyan))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun WatchlistPickerDialog(
    lists: List<WatchlistRow>,
    selectedId: String?,
    onDismiss: () -> Unit,
    onChoose: (String) -> Unit,
    onCreate: () -> Unit,
    onDelete: (String) -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = true)
    ) {
        Box(
            Modifier.fillMaxSize().clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismiss
            ).padding(horizontal = 12.dp, vertical = 16.dp),
            contentAlignment = Alignment.BottomCenter
        ) {
            OmahaCard(
                modifier = Modifier.fillMaxWidth().widthIn(max = 520.dp).clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {}
                ),
                contentPadding = 20.dp
            ) {
                BasicText("Choose watchlist", style = OmahaType.title2.toTextStyle())
                Box(Modifier.height(12.dp))
                lists.forEach { list ->
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(OmahaRadius.sm)),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(
                            Modifier.weight(1f).clickable { onChoose(list.id) }
                                .padding(horizontal = 4.dp, vertical = 13.dp),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            BasicText(list.name, style = OmahaType.bodyMd.toTextStyle())
                            if (list.id == selectedId) {
                                BasicText("✓", style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.brandCyan))
                            }
                        }
                        if (lists.size > 1) {
                            Box(
                                Modifier.clip(RoundedCornerShape(OmahaRadius.sm))
                                    .clickable { onDelete(list.id) }
                                    .padding(horizontal = 12.dp, vertical = 13.dp)
                            ) {
                                BasicText("Delete", style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.healthRisk))
                            }
                        }
                    }
                }
                Box(Modifier.height(4.dp))
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(OmahaRadius.sm))
                        .clickable(onClick = onCreate)
                        .padding(horizontal = 4.dp, vertical = 13.dp)
                ) {
                    BasicText("+ Create new watchlist", style = OmahaType.bodyMd.toTextStyle())
                }
            }
        }
    }
}

@Composable
private fun ConfirmationDialog(
    title: String,
    message: String,
    confirmLabel: String,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit
) {
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = true)
    ) {
        Box(
            Modifier.fillMaxSize().clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onDismiss
            ).padding(horizontal = 12.dp, vertical = 16.dp),
            contentAlignment = Alignment.BottomCenter
        ) {
            OmahaCard(
                modifier = Modifier.fillMaxWidth().widthIn(max = 520.dp).clickable(
                    interactionSource = remember { MutableInteractionSource() },
                    indication = null,
                    onClick = {}
                ),
                contentPadding = 20.dp
            ) {
                BasicText(title, style = OmahaType.title2.toTextStyle())
                Box(Modifier.height(8.dp))
                BasicText(message, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textSecondary))
                Box(Modifier.height(20.dp))
                Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)
                ) {
                    ControlButton("Cancel", onClick = onDismiss)
                    Box(
                        Modifier.clip(RoundedCornerShape(OmahaRadius.sm))
                            .background(Omaha.colors.healthRiskBg)
                            .border(1.dp, Omaha.colors.healthRiskBorder, RoundedCornerShape(OmahaRadius.sm))
                            .clickable(onClick = onConfirm)
                            .padding(horizontal = 14.dp, vertical = 8.dp)
                    ) {
                        BasicText(confirmLabel, style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.healthRisk))
                    }
                }
            }
        }
    }
}

@Composable
private fun EntryDialog(
    title: String,
    placeholder: String,
    submitLabel: String,
    uppercase: Boolean,
    onDismiss: () -> Unit,
    onSubmit: (String) -> Unit
) {
    var text by remember { mutableStateOf("") }
    Dialog(onDismissRequest = onDismiss) {
        OmahaCard(modifier = Modifier.widthIn(max = 380.dp), contentPadding = 20.dp) {
            BasicText(title, style = OmahaType.title2.toTextStyle())
            Box(Modifier.height(16.dp))
            InlineField(text, placeholder) { text = if (uppercase) it.uppercase() else it }
            Box(Modifier.height(16.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                ControlButton("Cancel", onClick = onDismiss)
                Pill2(submitLabel, text.isNotBlank()) { onSubmit(text.trim()) }
            }
        }
    }
}

@Composable
private fun InlineField(value: String, placeholder: String, onChange: (String) -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(OmahaRadius.sm))
            .background(Omaha.colors.bgSurface)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.sm))
            .padding(horizontal = 12.dp, vertical = 10.dp)
    ) {
        if (value.isEmpty()) {
            BasicText(
                placeholder,
                style = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textTertiary)
            )
        }
        BasicTextField(
            value = value,
            onValueChange = onChange,
            singleLine = true,
            textStyle = OmahaType.bodySm.toTextStyle(color = Omaha.colors.textPrimary),
            cursorBrush = SolidColor(Omaha.colors.brandCyan),
            modifier = Modifier.fillMaxWidth()
        )
    }
}

@Composable
private fun Pill2(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier
            .clip(RoundedCornerShape(OmahaRadius.pill))
            .background(if (enabled) Omaha.colors.brandCyan else Omaha.colors.bgSurfaceSubtle)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 9.dp)
    ) {
        BasicText(
            label,
            style = OmahaType.caption.toTextStyle(
                color = if (enabled) Omaha.colors.bgCanvas else Omaha.colors.textTertiary
            )
        )
    }
}
