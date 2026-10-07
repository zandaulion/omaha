package com.zandaulion.omaha.app.ui

import android.app.Activity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.border
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Image
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.window.Dialog
import androidx.compose.runtime.collectAsState
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.zandaulion.omaha.design.LocalExplainOpener
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaExplainSheet
import com.zandaulion.omaha.design.OmahaLayout
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.Glossary
import com.zandaulion.omaha.design.OmahaCard
import com.zandaulion.omaha.design.ThemeChoice
import com.zandaulion.omaha.design.toTextStyle
import com.zandaulion.omaha.app.R
import com.zandaulion.omaha.data.StockSearchResult
import kotlinx.coroutines.delay

/** Stable route names retain saved navigation; three destinations are primary. */
enum class OmahaTab(val label: String, val route: String, val icon: ImageVector) {
    Review("Review", "review", IconReview),
    Watchlist("Watchlist", "watchlist", IconWatchlist),
    Scorecard("Research", "deepdive", IconScorecard),
    Filter("Filter", "filter", IconFilter),
    Compare("Compare", "compare", IconCompare),

    /** Settings is a full-screen secondary route, not a bottom-bar destination. */
    Settings("Settings", "settings", IconSettings)
}

/**
 * The shell.
 *
 * Tab state rather than a navigation library, because that is what the PWA
 * does: four panels, one visible, `switchView` toggling a class. A back stack
 * would be a second navigation model to keep in step with a client that has
 * none, and phase 4 is explicitly about not doing things twice.
 *
 * `rememberSaveable` so a rotation or a process death returns to the same tab,
 * which is what `omaha_active_view` in localStorage buys the web client.
 */
@Composable
fun OmahaApp(
    /**
     * The company an alert was about, if the app was opened by tapping one.
     *
     * Handled here rather than in the watchlist because an alert is about a
     * company, not about a list — the ticker may not be on the list currently
     * selected, and the scorecard can show any of them.
     */
    initialTicker: String? = null,
    onTickerConsumed: () -> Unit = {},
    /**
     * The watchlist a home-screen widget tap was about.
     *
     * Handled here rather than left to whatever the Watchlist tab already
     * has selected — a widget is bound to a specific list at configuration
     * time, and that may not be the one this activity last had active. See
     * `MainActivity.EXTRA_WATCHLIST_ID`.
     */
    initialWatchlistId: String? = null,
    onWatchlistConsumed: () -> Unit = {}
) {
    var tab by rememberSaveable { mutableStateOf(OmahaTab.Watchlist) }
    var backStackRoutes by rememberSaveable { mutableStateOf("") }
    var requestedSubtab by rememberSaveable { mutableStateOf(DeepDiveTab.Overview) }
    var navigationRequest by rememberSaveable { mutableStateOf(0) }
    var searchOpen by remember { mutableStateOf(false) }
    // Not rememberSaveable: a glossary key is not navigation state, and
    // surviving a rotation with the sheet re-opened would be surprising.
    var explainKey by remember { mutableStateOf<String?>(null) }
    val deepDive: DeepDiveViewModel = viewModel()
    val ai: AiViewModel = viewModel()
    // The same instance every OmahaTab.Watchlist/Filter/Compare branch below
    // resolves via its own viewModel() call — Compose scopes it to this
    // activity regardless of call site, so selecting here is selecting for
    // all three.
    val watchlist: WatchlistViewModel = viewModel()
    val watchlistRows by watchlist.lists.collectAsState()
    val watchlistState by watchlist.state.collectAsState()
    val activeListId = (watchlistState as? WatchlistUiState.Ready)?.view?.id ?: watchlist.activeId
    val reviews: ReviewViewModel = viewModel()
    val reviewState by reviews.state.collectAsState()
    val reviewChecking by reviews.checking.collectAsState()
    val reviewNotice by reviews.notice.collectAsState()
    val reviewSave by deepDive.reviewSave.collectAsState()
    val reviewSaving by deepDive.reviewSaving.collectAsState()
    val thesisSave by deepDive.thesisSave.collectAsState()

    fun routeStack(): List<String> = backStackRoutes
        .split('|')
        .filter { it.isNotBlank() }

    fun navigateTo(destination: OmahaTab) {
        if (destination == tab) return
        backStackRoutes = (routeStack() + tab.route).takeLast(20).joinToString("|")
        tab = destination
    }

    fun navigateBack() {
        val routes = routeStack()
        val previous = routes.lastOrNull()?.let { route ->
            OmahaTab.entries.firstOrNull { it.route == route }
        }
        if (previous != null) {
            backStackRoutes = routes.dropLast(1).joinToString("|")
            tab = previous
        } else if (tab != OmahaTab.Watchlist) {
            tab = OmahaTab.Watchlist
        }
    }

    LaunchedEffect(tab, activeListId, watchlistRows, reviewSave) {
        if (tab == OmahaTab.Review || reviewSave == "Review saved") reviews.load(activeListId)
    }

    fun openCompany(ticker: String, review: Boolean = false) {
        requestedSubtab = if (review) DeepDiveTab.Thesis else DeepDiveTab.Overview
        navigationRequest++
        deepDive.open(ticker)
        ai.open(ticker)
        navigateTo(OmahaTab.Scorecard)
    }
    val appContext = LocalContext.current
    val appScope = rememberCoroutineScope()
    val isTablet = LocalConfiguration.current.smallestScreenWidthDp >= 600

    LaunchedEffect(initialTicker) {
        val ticker = initialTicker ?: return@LaunchedEffect
        backStackRoutes = OmahaTab.Review.route
        requestedSubtab = DeepDiveTab.Thesis
        navigationRequest++
        deepDive.open(ticker)
        ai.open(ticker)
        tab = OmahaTab.Scorecard
        reviews.load(activeListId)
        // Cleared so returning to the app later does not re-open the same
        // company over whatever the person navigated to since.
        onTickerConsumed()
    }

    LaunchedEffect(initialWatchlistId) {
        val id = initialWatchlistId ?: return@LaunchedEffect
        watchlist.select(id)
        backStackRoutes = ""
        tab = OmahaTab.Watchlist
        onWatchlistConsumed()
    }

    BackHandler(enabled = explainKey != null) {
        explainKey = null
    }
    BackHandler(
        enabled = explainKey == null && (tab != OmahaTab.Watchlist || backStackRoutes.isNotBlank())
    ) {
        navigateBack()
    }

    val selectedPrimaryTab = when (tab) {
        OmahaTab.Review -> OmahaTab.Review
        OmahaTab.Scorecard -> OmahaTab.Scorecard
        else -> OmahaTab.Watchlist
    }
    fun selectPrimaryTab(selected: OmahaTab) {
        if (selected == OmahaTab.Scorecard) {
            requestedSubtab = DeepDiveTab.Overview
            navigationRequest++
            if (deepDive.state.value is DeepDiveUiState.Empty) appScope.launch {
                OmahaEngine.get(appContext).settings.lastViewedTicker()?.let { openCompany(it) }
            }
        }
        navigateTo(selected)
    }

    CompositionLocalProvider(LocalExplainOpener provides { explainKey = it }) {
    Box(Modifier.fillMaxSize()) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Omaha.colors.bgCanvas)
    ) {
        Box(
            Modifier.fillMaxWidth().background(Color(0xFF0B0E14))
                .windowInsetsPadding(WindowInsets.statusBars)
        )
        OmahaHeader(
            onHome = { navigateTo(OmahaTab.Watchlist) },
            onSearch = { searchOpen = true },
            onSettings = { navigateTo(OmahaTab.Settings) }
        )
        Row(
            Modifier
                .weight(1f)
                .fillMaxWidth()
        ) {
            if (isTablet && tab != OmahaTab.Settings) {
                TabletNavigationRail(
                    selected = selectedPrimaryTab,
                    onSelect = ::selectPrimaryTab
                )
            }
            Box(
                Modifier.weight(1f).fillMaxHeight(),
                contentAlignment = Alignment.TopCenter
            ) {
                Box(
                    Modifier.fillMaxSize().widthIn(max = OmahaLayout.maxAppWidth)
                ) {
                when (tab) {
                OmahaTab.Review -> ReviewScreen(
                    state = reviewState,
                    lists = watchlistRows,
                    activeId = activeListId,
                    checking = reviewChecking,
                    notice = reviewNotice,
                    onSelectList = { watchlist.select(it); reviews.load(it) },
                    onCheck = { reviews.checkNow() },
                    onRetry = { reviews.load(activeListId) },
                    onAdd = { searchOpen = true },
                    onReview = { openCompany(it, review = true) },
                    onResearch = { openCompany(it) }
                )
                OmahaTab.Watchlist -> {
                    val vm: WatchlistViewModel = viewModel()
                    val ui by vm.state.collectAsState()
                    val lists by vm.lists.collectAsState()
                    val notice by vm.notice.collectAsState()
                    WatchlistScreen(
                        state = ui,
                        lists = lists,
                        activeId = vm.activeId,
                        notice = notice,
                        onRetry = { vm.load() },
                        onSelect = { ticker -> openCompany(ticker) },
                        onSelectList = { vm.select(it) },
                        onOpenSearch = { searchOpen = true },
                        onRemoveTicker = { vm.removeTicker(it) },
                        onCreateList = { vm.createWatchlist(it) },
                        onDeleteList = { vm.deleteWatchlist(it) },
                        onFilter = { navigateTo(OmahaTab.Filter) },
                        onCompare = { navigateTo(OmahaTab.Compare) }
                    )
                }
                OmahaTab.Scorecard -> {
                    val ui by deepDive.state.collectAsState()
                    val thesis by deepDive.thesis.collectAsState()
                    val aiState by ai.state.collectAsState()
                    val context = LocalContext.current
                    val ticker = (ui as? DeepDiveUiState.Ready)?.detail?.ticker
                    val activeList = watchlistRows.firstOrNull { it.id == watchlist.activeId }
                    val bookmarked = ticker != null && activeList?.tickersJson
                        ?.contains("\"$ticker\"") == true
                    DeepDiveScreen(
                        state = ui,
                        thesis = thesis,
                        aiState = aiState,
                        // Play's formatted price for the credit pack isn't queried
                        // yet — the "Buy" button falls back to its plain label
                        // rather than block on a QueryProductDetails round trip
                        // just to open this tab.
                        aiCreditPackPrice = null,
                        onRetry = { deepDive.retry() },
                        onThesisChange = { deepDive.updateThesis(it) },
                        onAddJournal = { deepDive.addJournalEntry(it) },
                        onAiSignIn = { ai.signIn() },
                        onAiGenerate = { ai.generate() },
                        onAiClaimFreeGrant = { ai.claimFreeGrant() },
                        onAiPurchase = { (context as? Activity)?.let { ai.purchase(it) } },
                        onAiDismissError = { ai.dismissError() },
                        onBack = { navigateBack() },
                        requestedTab = requestedSubtab,
                        navigationRequest = navigationRequest,
                        onRecordReview = { assessment, note -> deepDive.recordReview(assessment, note) },
                        reviewSaving = reviewSaving,
                        reviewSave = reviewSave,
                        thesisSave = thesisSave,
                        reviewChanges = (reviewState as? ReviewUiState.Ready)?.overview?.items?.firstOrNull { it.ticker == ticker }?.changes.orEmpty(),
                        onFilter = { navigateTo(OmahaTab.Filter) },
                        onCompare = { navigateTo(OmahaTab.Compare) },
                        onSearch = { searchOpen = true },
                        onSubtabChange = { requestedSubtab = it },
                        isBookmarked = bookmarked,
                        onBookmark = { symbol ->
                            if (bookmarked) watchlist.removeTicker(symbol)
                            else watchlist.addTicker(symbol)
                        }
                    )
                }
                OmahaTab.Filter -> {
                    val vm: WatchlistViewModel = viewModel()
                    androidx.compose.runtime.LaunchedEffect(Unit) { vm.refreshFilterUniverse() }
                    val universe by vm.filterUniverse.collectAsState()
                    FilterScreen(
                        holdings = universe,
                        onSelect = { ticker -> openCompany(ticker) }
                    )
                }
                OmahaTab.Compare -> {
                    val vm: CompareViewModel = viewModel()
                    val tickers by vm.tickers.collectAsState()
                    val holdings by vm.holdings.collectAsState()
                    val pillars by vm.pillars.collectAsState()
                    val candidates by vm.candidates.collectAsState()
                    // The ticker a scorecard was open on seeds the picker's
                    // "peers of" tier — arriving from a scorecard, that
                    // company is the subject, the same reasoning the PWA's
                    // initCompareView uses.
                    val deepDiveTicker = (deepDive.state.collectAsState().value as? DeepDiveUiState.Ready)
                        ?.detail?.ticker
                    androidx.compose.runtime.LaunchedEffect(deepDiveTicker) { vm.seedIfEmpty(deepDiveTicker) }
                    CompareScreen(
                        tickers = tickers,
                        holdings = holdings,
                        pillars = pillars,
                        candidates = candidates,
                        seedTicker = deepDiveTicker,
                        onPick = { vm.pick(it) },
                        onDrop = { vm.drop(it) },
                        onOpenPicker = { vm.openPicker(deepDiveTicker) },
                        onClosePicker = { vm.closePicker() }
                    )
                }

                    OmahaTab.Settings -> SettingsPage(onBack = { navigateBack() })
                }
            }
        }
        }

        if (!isTablet && tab != OmahaTab.Settings) BottomNav(selectedPrimaryTab, ::selectPrimaryTab)
    }

    OmahaExplainSheet(
        entry = Glossary.explain(explainKey),
        onClose = { explainKey = null }
    )
    if (searchOpen) {
        SearchTickerDialog(
            watchlist = watchlist,
            onDismiss = { searchOpen = false },
            onOpen = { ticker ->
                openCompany(ticker)
                searchOpen = false
            },
            onReview = { ticker ->
                openCompany(ticker, review = true)
                searchOpen = false
            }
        )
    }
    } // Box
    } // CompositionLocalProvider
}

@Composable
private fun OmahaHeader(
    onHome: () -> Unit,
    onSearch: () -> Unit,
    onSettings: () -> Unit
) {
    Row(
        Modifier.fillMaxWidth().height(OmahaLayout.headerHeight)
            .background(Omaha.colors.bgSurface)
            .border(1.dp, Omaha.colors.borderSubtle)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Row(
            Modifier.weight(1f).clickable(onClick = onHome),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Image(
                painter = painterResource(R.drawable.omaha_brand),
                contentDescription = null,
                modifier = Modifier.size(30.dp).clip(RoundedCornerShape(OmahaRadius.sm))
            )
            BasicText("Pocket Omaha", style = OmahaType.title2.toTextStyle())
        }
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            HeaderIconAction(IconSearch, "Search", onSearch)
            HeaderIconAction(IconSettings, "Settings", onSettings)
        }
    }
}

@Composable
private fun HeaderIconAction(icon: ImageVector, description: String, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).clip(RoundedCornerShape(50))
            .background(Omaha.colors.bgSurfaceSubtle)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(50))
            .semantics { contentDescription = description; role = Role.Button }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        Image(
            painter = rememberVectorPainter(icon),
            contentDescription = null,
            colorFilter = ColorFilter.tint(Omaha.colors.textSecondary),
            modifier = Modifier.size(20.dp)
        )
    }
}

@Composable
private fun HeaderAction(symbol: String, description: String, onClick: () -> Unit) {
    Box(
        Modifier.size(36.dp).clip(RoundedCornerShape(50))
            .background(Omaha.colors.bgSurfaceSubtle)
            .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(50))
            .semantics { contentDescription = description; role = Role.Button }
            .clickable(onClick = onClick),
        contentAlignment = Alignment.Center
    ) {
        BasicText(symbol, style = OmahaType.bodyMd.toTextStyle(), maxLines = 1)
    }
}

@Composable
private fun SearchTickerDialog(
    watchlist: WatchlistViewModel,
    onDismiss: () -> Unit,
    onOpen: (String) -> Unit,
    onReview: (String) -> Unit
) {
    var query by remember { mutableStateOf("") }
    val lists by watchlist.lists.collectAsState()
    val notice by watchlist.notice.collectAsState()
    var targetId by remember { mutableStateOf(watchlist.activeId) }
    var choosingList by remember { mutableStateOf(false) }
    var results by remember { mutableStateOf<List<StockSearchResult>>(emptyList()) }
    var searching by remember { mutableStateOf(false) }
    var searchError by remember { mutableStateOf<String?>(null) }
    var addedTicker by remember { mutableStateOf<String?>(null) }
    val focusRequester = remember { FocusRequester() }
    val keyboard = LocalSoftwareKeyboardController.current

    LaunchedEffect(query) {
        results = emptyList()
        searchError = null
        if (query.isBlank()) { searching = false; return@LaunchedEffect }
        searching = true
        delay(200)
        try {
            results = watchlist.search(query.trim())
        } catch (err: Throwable) {
            searchError = err.message ?: "Search is unavailable right now."
        } finally {
            searching = false
        }
    }

    Dialog(onDismissRequest = onDismiss) {
        OmahaCard(modifier = Modifier.widthIn(max = 380.dp), contentPadding = 20.dp) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                BasicText("Search companies", style = OmahaType.title2.toTextStyle())
                HeaderAction("✕", "Close search", onDismiss)
            }
            Box(Modifier.height(14.dp))
            BasicTextField(
                value = query,
                onValueChange = { query = it },
                singleLine = true,
                textStyle = OmahaType.bodyMd.toTextStyle(),
                cursorBrush = SolidColor(Omaha.colors.brandCyan),
                modifier = Modifier.fillMaxWidth().focusRequester(focusRequester)
                    .clip(RoundedCornerShape(OmahaRadius.sm))
                    .background(Omaha.colors.bgSurfaceSubtle)
                    .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.sm))
                    .padding(12.dp),
                decorationBox = { inner ->
                    Box {
                        if (query.isBlank()) BasicText(
                            "Search by symbol or company name",
                            style = OmahaType.bodyMd.toTextStyle(color = Omaha.colors.textTertiary)
                        )
                        inner()
                    }
                }
            )
            LaunchedEffect(Unit) {
                focusRequester.requestFocus()
                keyboard?.show()
            }
            Box(Modifier.height(10.dp))
            Row(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(OmahaRadius.sm))
                    .background(Omaha.colors.bgSurfaceSubtle)
                    .clickable { choosingList = !choosingList }
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween
            ) {
                BasicText("Add to", style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
                BasicText(
                    (lists.firstOrNull { it.id == targetId }?.name ?: "Watchlist") + "  ⌄",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textPrimary)
                )
            }
            if (choosingList) {
                lists.forEach { list ->
                    Box(Modifier.fillMaxWidth().clickable {
                        targetId = list.id; choosingList = false
                    }.padding(10.dp)) {
                        BasicText(list.name, style = OmahaType.bodySm.toTextStyle())
                    }
                }
            }
            Box(Modifier.height(12.dp))
            if (query.isBlank()) {
                BasicText("Popular:", style = OmahaType.caption.toTextStyle(color = Omaha.colors.textTertiary))
                Box(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("AAPL", "MSFT", "NVDA", "COST").forEach { symbol ->
                        Box(Modifier.clip(RoundedCornerShape(OmahaRadius.sm))
                            .background(Omaha.colors.bgSurfaceSubtle)
                            .clickable { query = symbol }.padding(horizontal = 8.dp, vertical = 5.dp)) {
                            BasicText(symbol, style = OmahaType.caption.toTextStyle())
                        }
                    }
                }
            } else if (searching) {
                BasicText("Searching global markets…", style = OmahaType.bodySm.toTextStyle(
                    color = Omaha.colors.textSecondary
                ))
            } else if (searchError != null) {
                BasicText(searchError ?: "", style = OmahaType.bodySm.toTextStyle(
                    color = Omaha.colors.healthRisk
                ))
            } else if (results.isEmpty()) {
                BasicText("No matching companies found.", style = OmahaType.bodySm.toTextStyle(
                    color = Omaha.colors.textSecondary
                ))
                Box(Modifier.height(8.dp))
                SearchAction("+ Add ${query.trim().uppercase()} directly", primary = true) {
                    watchlist.addTicker(query.trim(), targetId) { addedTicker = it }
                }
            } else {
                Column(Modifier.heightIn(max = 340.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    results.forEach { result ->
                        val inList = lists.firstOrNull { it.id == targetId }?.tickersJson
                            ?.contains("\"${result.ticker}\"") == true
                        Column(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(OmahaRadius.sm))
                                .border(1.dp, Omaha.colors.borderSubtle, RoundedCornerShape(OmahaRadius.sm))
                                .padding(10.dp)
                        ) {
                            BasicText(result.ticker, style = OmahaType.bodyMd.toTextStyle().copy(
                                fontFamily = Omaha.fonts.mono
                            ))
                            BasicText(result.name, style = OmahaType.bodySm.toTextStyle(
                                color = Omaha.colors.textSecondary
                            ))
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                SearchAction("Research", primary = true) { onOpen(result.ticker) }
                                SearchAction(if (inList) "✓ Added" else "+ Add") {
                                    if (!inList) watchlist.addTicker(result.ticker, targetId) { addedTicker = it }
                                }
                            }
                        }
                    }
                }
            }
            addedTicker?.let { ticker ->
                Box(Modifier.height(10.dp))
                BasicText("$ticker is on your watchlist. Capture your reasons whenever you are ready.",
                    style = OmahaType.caption.toTextStyle(color = Omaha.colors.textSecondary))
                SearchAction("Add your reasons", primary = true) { onReview(ticker) }
            }
            if (notice != null) {
                Box(Modifier.height(8.dp))
                BasicText(notice ?: "", style = OmahaType.caption.toTextStyle(
                    color = Omaha.colors.textSecondary
                ))
            }
        }
    }
}

@Composable
private fun SearchAction(label: String, primary: Boolean = false, onClick: () -> Unit) {
    Box(Modifier.padding(top = 8.dp).clip(RoundedCornerShape(OmahaRadius.sm))
        .background(if (primary) Omaha.colors.brandBlue else Omaha.colors.bgSurfaceSubtle)
        .semantics { role = Role.Button }
        .clickable(onClick = onClick).padding(horizontal = 10.dp, vertical = 7.dp)) {
        BasicText(label, style = OmahaType.caption.toTextStyle(
            color = if (primary) Color.White else Omaha.colors.textPrimary
        ))
    }
}

/** Primary navigation for screens with at least 600 dp of usable width. */
@Composable
private fun TabletNavigationRail(selected: OmahaTab, onSelect: (OmahaTab) -> Unit) {
    Column(
        Modifier
            .width(96.dp)
            .fillMaxHeight()
            .background(Omaha.colors.bgSurface)
            .border(1.dp, Omaha.colors.borderSubtle)
            .padding(horizontal = 8.dp, vertical = 16.dp)
            .windowInsetsPadding(WindowInsets.navigationBars),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(10.dp)
    ) {
        for (tab in listOf(OmahaTab.Watchlist, OmahaTab.Review, OmahaTab.Scorecard)) {
            TabletNavTab(
                tab = tab,
                active = tab == selected,
                onClick = { onSelect(tab) }
            )
        }
    }
}

@Composable
private fun TabletNavTab(tab: OmahaTab, active: Boolean, onClick: () -> Unit) {
    val tint = if (active) Omaha.colors.brandCyan else Omaha.colors.textTertiary
    val shape = RoundedCornerShape(OmahaRadius.md)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(shape)
            .background(if (active) Omaha.colors.bgSurfaceSubtle else Color.Transparent)
            .border(
                width = 1.dp,
                color = if (active) Omaha.colors.borderProminent else Color.Transparent,
                shape = shape
            )
            .clickable(onClick = onClick)
            .padding(horizontal = 6.dp, vertical = 12.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        Image(
            painter = rememberVectorPainter(tab.icon),
            contentDescription = tab.label,
            colorFilter = ColorFilter.tint(tint),
            contentScale = ContentScale.Fit,
            modifier = Modifier.size(22.dp)
        )
        BasicText(
            tab.label,
            style = OmahaType.caption.toTextStyle(color = tint).copy(textAlign = TextAlign.Center)
        )
    }
}

/**
 * Matches `.bottom-nav` in `web/app.css`: a top hairline, the surface colour,
 * and a fixed height from the shared layout tokens.
 *
 * The web version uses `backdrop-filter: blur(20px)` over a translucent
 * surface. That is not reproduced here — a Compose blur costs a render pass and
 * would be doing it behind an opaque list — so the opaque surface colour is used
 * instead. Worth recording as a deliberate difference rather than an oversight:
 * it is the one place this shell knowingly departs from the CSS.
 */
@Composable
private fun BottomNav(selected: OmahaTab, onSelect: (OmahaTab) -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Omaha.colors.bgSurface)
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(Omaha.colors.borderSubtle)
        )
        Row(
            Modifier
                .fillMaxWidth()
                .height(OmahaLayout.bottomNavHeight)
                .padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.SpaceAround,
            verticalAlignment = Alignment.CenterVertically
        ) {
            for (t in listOf(OmahaTab.Watchlist, OmahaTab.Review, OmahaTab.Scorecard)) {
                NavTab(
                    tab = t,
                    active = t == selected,
                    onClick = { onSelect(t) },
                    modifier = Modifier.weight(1f)
                )
            }
        }
        // Sits above the gesture bar rather than under it.
        Box(Modifier.windowInsetsPadding(WindowInsets.navigationBars))
    }
}

/**
 * `.nav-tab`: icon over label, tertiary until active, then brand cyan with the
 * icon at 1.1×. The scale is animated because the CSS transitions it
 * (`transform 0.15s ease`), and a step change would read as a different
 * interaction rather than the same one.
 */
@Composable
private fun NavTab(
    tab: OmahaTab,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val tint = if (active) Omaha.colors.brandCyan else Omaha.colors.textTertiary
    val scale by animateFloatAsState(if (active) 1.1f else 1f, label = "navIconScale")

    Column(
        modifier
            .clip(RoundedCornerShape(OmahaRadius.md))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                role = Role.Tab,
                onClick = onClick
            )
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        Image(
            painter = rememberVectorPainter(tab.icon),
            contentDescription = tab.label,
            colorFilter = ColorFilter.tint(tint),
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .size(20.dp)
                .scale(scale)
        )
        BasicText(
            text = tab.label,
            style = OmahaType.caption.toTextStyle(color = tint)
                .copy(textAlign = TextAlign.Center)
        )
    }
}

/**
 * A view that does not exist yet, saying so and saying when.
 *
 * Deliberately not "Coming soon". Each of these is a scheduled slice in
 * `docs/16_ROADMAP.md` phase 4, and naming the slice makes the shell a
 * checklist of what is left rather than a set of dead ends.
 */
@Composable
private fun PlaceholderScreen(title: String, detail: String) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        BasicText(
            text = title,
            style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary)
        )
        Box(Modifier.height(8.dp))
        BasicText(
            text = detail,
            style = OmahaType.bodyMd
                .toTextStyle(color = Omaha.colors.textSecondary)
                .copy(textAlign = TextAlign.Center)
        )
    }
}

/**
 * Settings, with the two SAF pickers.
 *
 * The file is chosen by the user through the system picker rather than written
 * to a path the app decides. Doc 13 §12 asks for SAF specifically, and the
 * reason is ownership: this is the only copy of what someone wrote, and it
 * should land somewhere they chose and can find again.
 */
@Composable
private fun SettingsPage(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            ReviewAction("← Back", onClick = onBack)
            BasicText("App settings", style = OmahaType.title2.toTextStyle())
        }
        Box(Modifier.weight(1f)) { SettingsTab(showTitle = false) }
    }
}

@Composable
private fun SettingsTab(showTitle: Boolean = true) {
    val vm: SettingsViewModel = viewModel()
    val includeNotes by vm.includeNotes.collectAsState()
    val theme by vm.theme.collectAsState()
    val status by vm.status.collectAsState()
    val alerts by vm.alerts.collectAsState()
    val scope = rememberCoroutineScope()
    val context = LocalContext.current

    // Asked for from the Alerts card, never on launch. Whatever the person
    // answers, `refreshAlerts` re-reads the live permission state rather than
    // assuming the dialog's result — it can also be answered by the system
    // without showing, once it has been permanently declined.
    val notificationPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { vm.refreshAlerts() }

    // CreateDocument hands back a URI the app may write to exactly once.
    val exporter = rememberLauncherForActivityResult(
        ActivityResultContracts.CreateDocument("application/json")
    ) { uri ->
        if (uri == null) {
            vm.onExported(null)
        } else {
            scope.launch {
                val json = vm.exportJson()
                if (json == null) {
                    vm.onExported(null)
                } else {
                    withContext(Dispatchers.IO) {
                        context.contentResolver.openOutputStream(uri)?.use {
                            it.write(json.toByteArray())
                        }
                    }
                    vm.onExported(uri)
                }
            }
        }
    }

    val importer = rememberLauncherForActivityResult(
        ActivityResultContracts.OpenDocument()
    ) { uri -> uri?.let { vm.importFrom(it) } }

    SettingsScreen(
        showTitle = showTitle,
        includeNotes = includeNotes,
        theme = theme,
        backupStatus = status,
        alerts = alerts,
        onIncludeNotesChange = { vm.setIncludeNotes(it) },
        onThemeChange = { vm.setTheme(it) },
        onAlertsChange = { vm.setAlertPreferences(it) },
        onTestNotification = { vm.sendTestNotification() },
        onRequestPermission = {
            if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.TIRAMISU) {
                notificationPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
            } else {
                // Below 13 there is no runtime permission to request: the only
                // way notifications are off is that they were switched off in
                // system settings, which is where the person has to go.
                context.startActivity(
                    android.content.Intent(android.provider.Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                        .putExtra(android.provider.Settings.EXTRA_APP_PACKAGE, context.packageName)
                )
            }
        },
        onExport = {
            exporter.launch("pocket-omaha-backup-${System.currentTimeMillis()}.json")
        },
        // Narrowed to JSON, but "*/*" would be the safer net if a provider
        // reports the type oddly; keep an eye on this if a restore ever fails
        // to see a file that is plainly there.
        onImport = { importer.launch(arrayOf("application/json")) }
    )
}
