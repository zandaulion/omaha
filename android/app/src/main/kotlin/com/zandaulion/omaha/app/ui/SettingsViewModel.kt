package com.zandaulion.omaha.app.ui

import android.app.Application
import android.net.Uri
import com.zandaulion.omaha.app.alerts.AlertNotifier
import com.zandaulion.omaha.data.Alert
import com.zandaulion.omaha.data.AlertSettings
import com.zandaulion.omaha.data.NotificationRow
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.zandaulion.omaha.design.ThemeChoice
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class SettingsViewModel(app: Application) : AndroidViewModel(app) {

    private val _includeNotes = MutableStateFlow(false)
    val includeNotes: StateFlow<Boolean> = _includeNotes.asStateFlow()

    private val _theme = MutableStateFlow(ThemeChoice.System)
    val theme: StateFlow<ThemeChoice> = _theme.asStateFlow()

    private val _status = MutableStateFlow<String?>(null)
    val status: StateFlow<String?> = _status.asStateFlow()

    private val _alerts = MutableStateFlow<AlertsUi?>(null)
    val alerts: StateFlow<AlertsUi?> = _alerts.asStateFlow()

    private val settings get() = OmahaEngine.get(getApplication()).settings
    private val alertRepo get() = OmahaEngine.get(getApplication()).alerts

    init {
        viewModelScope.launch {
            _includeNotes.value = settings.aiIncludeNotes()
            _theme.value = settings.themeChoice().toThemeChoice()
        }
        // Its own launch, and its own guard. This ViewModel is now built
        // eagerly at app launch rather than only when Settings is opened, and
        // the alert path is the newest, least-exercised code in the app — a
        // defect in it must not block the notes toggle or the theme from
        // loading, and must not crash a cold start.
        viewModelScope.launch {
            runCatching { loadAlerts() }
                .onFailure { android.util.Log.e("OmahaSettings", "could not load alerts", it) }
        }
    }

    /**
     * Reload the alert card, and mark what it shows as read.
     *
     * Called on open and after the permission dialog resolves, because
     * `permitted()` is a live system state rather than something we store —
     * a person can revoke notifications from system settings while the app is
     * running, and the card would otherwise keep claiming they are on.
     */
    fun refreshAlerts() {
        viewModelScope.launch {
            runCatching { loadAlerts() }
                .onFailure { android.util.Log.e("OmahaSettings", "could not reload alerts", it) }
        }
    }

    private suspend fun loadAlerts() {
        val notifier = AlertNotifier(getApplication())
        _alerts.value = AlertsUi(
            settings = alertRepo.settings(),
            history = alertRepo.history(HISTORY_SHOWN),
            lastSweepAt = alertRepo.lastSweepAt(),
            permitted = notifier.permitted()
        )
        // Reading the list is what marks it read, exactly as the PWA's
        // notification centre does on load. There is no separate acknowledge
        // step on either client.
        alertRepo.markAllRead()
    }

    /**
     * Post a sample alert, matching the PWA's "Send a test notification".
     *
     * Worth having on a phone more than in a browser. Channel importance, OEM
     * battery rules and a per-channel mute the user set months ago are all
     * invisible until something is actually posted, and "I have not had an
     * alert" is otherwise indistinguishable from "nothing has happened".
     *
     * Deliberately routed through [AlertNotifier.show] rather than building a
     * notification here, so it exercises the real path — the real channel, the
     * real deep link, the real permission check.
     */
    fun sendTestNotification() {
        viewModelScope.launch {
            runCatching {
                val notifier = AlertNotifier(getApplication())
                notifier.ensureChannels()
                if (!notifier.permitted()) {
                    refreshAlerts()
                    return@launch
                }
                notifier.show(
                    Alert(
                        type = "EARNINGS_HEALTH_SHIFT",
                        ticker = "",
                        title = "Notifications are working",
                        body = "Real alerts look like this: health changes, distress signals " +
                            "and entry points. This one is a test and is not recorded.",
                        severity = "info",
                        url = ""
                    )
                )
                _status.value = "Test notification sent."
            }.onFailure {
                android.util.Log.e("OmahaSettings", "could not send test notification", it)
                _status.value = "Could not send a test notification."
            }
        }
    }

    fun setAlertPreferences(next: AlertSettings) {
        _alerts.value = _alerts.value?.copy(settings = next)
        viewModelScope.launch {
            runCatching {
                // Re-read rather than trusting the optimistic value, for the
                // same reason the notes opt-in does: a switch showing a state
                // that was never stored is a switch that lies about what will
                // happen.
                val stored = alertRepo.updateSettings(next)
                _alerts.value = _alerts.value?.copy(settings = stored)
            }.onFailure { android.util.Log.e("OmahaSettings", "could not save alert preferences", it) }
        }
    }

    fun setIncludeNotes(enabled: Boolean) {
        _includeNotes.value = enabled
        viewModelScope.launch {
            settings.setAiIncludeNotes(enabled)
            // Re-read rather than trusting the optimistic value. This is an
            // opt-in for sending personal data; a switch left showing "on"
            // after a failed write would claim consent that was never stored.
            _includeNotes.value = settings.aiIncludeNotes()
        }
    }

    fun setTheme(choice: ThemeChoice) {
        _theme.value = choice
        viewModelScope.launch { settings.setThemeChoice(choice.wireName()) }
    }

    /** The JSON to write, or null if it could not be produced. */
    suspend fun exportJson(): String? = runCatching {
        OmahaEngine.get(getApplication()).backup.export()
    }.getOrNull()

    fun onExported(uri: Uri?) {
        _status.value = if (uri == null) "Export cancelled." else "Backup written."
    }

    fun importFrom(uri: Uri) {
        viewModelScope.launch {
            _status.value = "Restoring…"
            _status.value = try {
                val text = withContext(Dispatchers.IO) {
                    getApplication<Application>().contentResolver.openInputStream(uri)
                        ?.bufferedReader()?.use { it.readText() }
                } ?: return@launch run { _status.value = "Could not read that file." }

                val result = OmahaEngine.get(getApplication()).backup.import(text)
                "Restored. ${result.theses} theses and ${result.watchlists} watchlists on this device."
            } catch (err: Throwable) {
                // The engine's message, not a generic one. core/backup.js
                // refuses a newer schema outright and says why, and that
                // sentence is more useful than "import failed".
                "Could not restore: ${err.message?.take(140) ?: err.javaClass.simpleName}"
            }
        }
    }

    private companion object {
        /** The PWA's notification centre shows 30. */
        const val HISTORY_SHOWN = 30
    }
}

/**
 * Everything the Settings screen shows about alerts.
 *
 * One object rather than four flows because the four are read together and
 * would otherwise recompose the card in stages — the toggles arriving before
 * the history, then the permission state, which reads as the screen thinking
 * twice about something the user did not ask it to reconsider.
 */
data class AlertsUi(
    val settings: AlertSettings,
    val history: List<NotificationRow>,
    /** ISO-8601, or null if no sweep has completed on this device yet. */
    val lastSweepAt: String?,
    /** Whether Android will show what the sweep posts. */
    val permitted: Boolean
)

/**
 * The theme is stored as the PWA's own string rather than an enum ordinal.
 *
 * `:data` deliberately does not depend on `:design` — storage should not know
 * about a palette — and an ordinal would also make the stored value meaningless
 * to the other client. "system", "dark" and "light" are what `omaha_theme`
 * holds in the browser.
 */
private fun String.toThemeChoice(): ThemeChoice = when (this) {
    "dark" -> ThemeChoice.Dark
    "light" -> ThemeChoice.Light
    else -> ThemeChoice.System
}

private fun ThemeChoice.wireName(): String = when (this) {
    ThemeChoice.Dark -> "dark"
    ThemeChoice.Light -> "light"
    ThemeChoice.System -> "system"
}
