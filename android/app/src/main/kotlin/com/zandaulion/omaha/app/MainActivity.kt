package com.zandaulion.omaha.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.viewmodel.compose.viewModel
import com.zandaulion.omaha.app.alerts.AlertNotifier
import com.zandaulion.omaha.app.alerts.AlertSweepWorker
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

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        pendingTicker = intent?.getStringExtra(EXTRA_TICKER)

        // Channels before any alert can be posted, and the schedule on every
        // launch — WorkManager keeps an existing one, so this re-establishes
        // the sweep after an app update or a "force stop" without restarting
        // its period on an ordinary launch.
        AlertNotifier(this).ensureChannels()
        lifecycleScope.launch { AlertSweepWorker.schedule(this@MainActivity) }

        setContent {
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
                    onTickerConsumed = { pendingTicker = null }
                )
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        pendingTicker = intent.getStringExtra(EXTRA_TICKER)
    }

    companion object {
        /** The ticker an alert was about. See `AlertNotifier.show`. */
        const val EXTRA_TICKER = "com.zandaulion.omaha.TICKER"
    }
}
