package com.zandaulion.omaha.app.ui

import android.app.Application
import android.net.Uri
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

    private val settings get() = OmahaEngine.get(getApplication()).settings

    init {
        viewModelScope.launch {
            _includeNotes.value = settings.aiIncludeNotes()
            _theme.value = settings.themeChoice().toThemeChoice()
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
}

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
