package com.zandaulion.omaha.app

import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.zandaulion.omaha.app.alerts.AlertNotifier
import com.zandaulion.omaha.app.alerts.AlertSweepWorker
import com.zandaulion.omaha.app.widget.WidgetRefreshWorker
import com.zandaulion.omaha.app.ui.OmahaApp
import com.zandaulion.omaha.app.ui.SettingsViewModel
import com.zandaulion.omaha.design.OmahaTheme
import kotlinx.coroutines.launch

/**
 * The only activity.
 *
 * The PWA is a single page with four panels and no history beyond its own tab
 * state; mirroring that with one activity keeps the two clients' navigation
 * models identical rather than merely similar.
 */
class MainActivity : ComponentActivity() {

    /**
     * Set when the activity was opened by tapping an alert, cleared once the
     * deep dive has been pointed at it.
     *
     * Held here rather than read inside the composition because
     * [onNewIntent] can replace the intent while the app is already running —
     * a second alert tapped while the first is open — and a composable reading
     * `getIntent()` would keep seeing the original.
     */
    private var pendingTicker by mutableStateOf<String?>(null)

    /** Same shape as [pendingTicker], for a widget tap — see [EXTRA_WATCHLIST_ID]. */
    private var pendingWatchlistId by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        // Read before anything else touches the alert plumbing, so a crash
        // caused by the code below this line is not what erases the evidence
        // of a crash caused by the code below this line on the *previous*
        // launch.
        val crash = CrashLog.consumePending(this)

        pendingTicker = intent?.getStringExtra(EXTRA_TICKER)
        pendingWatchlistId = intent?.getStringExtra(EXTRA_WATCHLIST_ID)

        // Channels before any alert can be posted, and the schedule on every
        // launch — WorkManager keeps an existing one, so this re-establishes
        // the sweep after an app update or a "force stop" without restarting
        // its period on an ordinary launch.
        //
        // Guarded, all of it. This is the newest code in the app and the only
        // part that had never run on a device before shipping — everything
        // else here was exercised on a handset before phase 5 existed. A
        // defect anywhere in the alert path should cost the alert feature,
        // never the rest of the app.
        try {
            AlertNotifier(this).ensureChannels()
        } catch (err: Throwable) {
            Log.e("OmahaStartup", "could not create notification channels", err)
        }
        lifecycleScope.launch {
            try {
                AlertSweepWorker.schedule(this@MainActivity)
            } catch (err: Throwable) {
                Log.e("OmahaStartup", "could not schedule the alert sweep", err)
            }
        }
        lifecycleScope.launch {
            try {
                WidgetRefreshWorker.schedule(this@MainActivity)
            } catch (err: Throwable) {
                Log.e("OmahaStartup", "could not schedule the widget refresh", err)
            }
        }

        setContent {
            if (crash != null) {
                // Shown once, in place of the app, rather than logged only —
                // there is no adb in this project's test loop, so a trace
                // nobody can read is a trace that does not exist. Selectable
                // so it can be copied into a message without retyping it.
                CrashScreen(crash)
                return@setContent
            }

            // The same ViewModel instance the Settings screen writes to, since
            // both resolve against this activity's store. Until now the theme
            // picker stored a choice that nothing read, so choosing Light
            // persisted correctly and changed nothing on screen.
            val settings: SettingsViewModel = viewModel()
            val choice by settings.theme.collectAsState()

            OmahaTheme(
                choice = choice,
                systemInDarkTheme = isSystemInDarkTheme()
            ) {
                OmahaApp(
                    initialTicker = pendingTicker,
                    onTickerConsumed = { pendingTicker = null },
                    initialWatchlistId = pendingWatchlistId,
                    onWatchlistConsumed = { pendingWatchlistId = null }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingTicker = intent.getStringExtra(EXTRA_TICKER)
        pendingWatchlistId = intent.getStringExtra(EXTRA_WATCHLIST_ID)
    }

    companion object {
        /** The ticker an alert was about. See `AlertNotifier.show`. */
        const val EXTRA_TICKER = "com.zandaulion.omaha.TICKER"

        /**
         * The watchlist a home-screen widget tap was about — see
         * `PocketOmahaWidget`'s tap intent, `:widget` module. Not the
         * currently-active watchlist: a widget is bound to a specific list at
         * configuration time, possibly not whichever one the app last had
         * selected, and opening the wrong one on tap would be exactly the
         * kind of two-numbers-for-one-thing mismatch this app avoids.
         */
        const val EXTRA_WATCHLIST_ID = "com.zandaulion.omaha.WATCHLIST_ID"
    }
}

/**
 * The whole of the fallback UI: the trace, selectable, on a plain background.
 *
 * Deliberately independent of [OmahaTheme], [Omaha.colors] and every other
 * screen in the app. If the crash came from anything those depend on — the
 * database, the design tokens, a ViewModel — this still has to render.
 */
@Composable
private fun CrashScreen(trace: String) {
    Column(
        Modifier
            .fillMaxSize()
            .background(Color(0xFF14181F))
            .verticalScroll(rememberScrollState())
            .padding(20.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        BasicText(
            "Pocket Omaha crashed on the previous launch",
            style = TextStyle(color = Color(0xFFF3F5F9), fontSize = 18.sp)
        )
        BasicText(
            "This is the exception it threw. Copy it into a message if you " +
                "are reporting it — the app will open normally next time.",
            style = TextStyle(color = Color(0xFF94A3B8), fontSize = 13.sp)
        )
        androidx.compose.foundation.text.selection.SelectionContainer {
            BasicText(
                trace,
                style = TextStyle(
                    color = Color(0xFFF3F5F9),
                    fontSize = 11.sp,
                    fontFamily = FontFamily.Monospace
                )
            )
        }
    }
}
