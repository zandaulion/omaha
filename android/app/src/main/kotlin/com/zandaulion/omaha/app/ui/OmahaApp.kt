package com.zandaulion.omaha.app.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Image
import androidx.compose.runtime.collectAsState
import androidx.lifecycle.viewmodel.compose.viewModel
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaLayout
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

/**
 * The four views, in the PWA's order.
 *
 * `Scorecard` is the label the web client shows for the deep dive, and the two
 * should not diverge — a person reading the release notes for one client is
 * reading them for both. The route names match the PWA's deep-link aliases so
 * `?view=filter` and this enum cannot drift apart.
 */
enum class OmahaTab(val label: String, val route: String, val icon: ImageVector) {
    Watchlist("Watchlist", "watchlist", IconWatchlist),
    Scorecard("Scorecard", "deepdive", IconScorecard),
    Filter("Filter", "filter", IconFilter),
    Compare("Compare", "compare", IconCompare),

    /**
     * The PWA reaches Settings from a header button rather than a tab, because
     * a browser page has a header to put it in. A fifth tab is the Android
     * equivalent: the alternative is an overflow menu, which is one more tap to
     * reach the privacy opt-in and the backup — the two things most worth
     * finding.
     */
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
    onTickerConsumed: () -> Unit = {}
) {
    var tab by rememberSaveable { mutableStateOf(OmahaTab.Watchlist) }
    val deepDive: DeepDiveViewModel = viewModel()

    LaunchedEffect(initialTicker) {
        val ticker = initialTicker ?: return@LaunchedEffect
        deepDive.open(ticker)
        tab = OmahaTab.Scorecard
        // Cleared so returning to the app later does not re-open the same
        // company over whatever the person navigated to since.
        onTickerConsumed()
    }

    Column(
        Modifier
            .fillMaxSize()
            .background(Omaha.colors.bgCanvas)
    ) {
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
        ) {
            when (tab) {
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
                        onSelect = { ticker ->
                            deepDive.open(ticker)
                            tab = OmahaTab.Scorecard
                        },
                        onSelectList = { vm.select(it) },
                        onAddTicker = { vm.addTicker(it) },
                        onRemoveTicker = { vm.removeTicker(it) },
                        onCreateList = { vm.createWatchlist(it) }
                    )
                }
                OmahaTab.Scorecard -> {
                    val ui by deepDive.state.collectAsState()
                    val thesis by deepDive.thesis.collectAsState()
                    DeepDiveScreen(
                        state = ui,
                        thesis = thesis,
                        onRetry = { deepDive.retry() },
                        onThesisChange = { deepDive.updateThesis(it) },
                        onAddJournal = { deepDive.addJournalEntry(it) }
                    )
                }
                OmahaTab.Filter -> {
                    // Shares the watchlist's view model: the filter acts on
                    // what is already loaded and scored, so it neither fetches
                    // nor keeps a second copy that could disagree.
                    val vm: WatchlistViewModel = viewModel()
                    val ui by vm.state.collectAsState()
                    FilterScreen(
                        state = ui,
                        onRetry = { vm.load() },
                        onSelect = { ticker -> deepDive.open(ticker); tab = OmahaTab.Scorecard }
                    )
                }
                OmahaTab.Compare -> {
                    val vm: WatchlistViewModel = viewModel()
                    val ui by vm.state.collectAsState()
                    CompareScreen(state = ui, onRetry = { vm.load() })
                }

                OmahaTab.Settings -> SettingsTab()
            }
        }

        BottomNav(selected = tab, onSelect = { tab = it })
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
            for (t in OmahaTab.entries) {
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
private fun SettingsTab() {
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
