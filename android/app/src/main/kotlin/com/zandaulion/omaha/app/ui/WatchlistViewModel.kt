package com.zandaulion.omaha.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.zandaulion.omaha.data.WatchlistView
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface WatchlistUiState {
    data object Loading : WatchlistUiState
    data class Ready(val view: WatchlistView) : WatchlistUiState
    data class Failed(val message: String) : WatchlistUiState
}

/**
 * Holds the watchlist across configuration changes and owns the engine.
 *
 * The engine reads a 96 KB bundle from assets and builds a QuickJS interpreter
 * per call, so it is constructed once here rather than per recomposition. Doc
 * 13 §24 measures the interpreter start at about 21 ms — imperceptible for a
 * screen load, and pure waste on every frame.
 */
class WatchlistViewModel(app: Application) : AndroidViewModel(app) {

    private val repository get() = OmahaEngine.get(getApplication()).watchlists

    private val _state = MutableStateFlow<WatchlistUiState>(WatchlistUiState.Loading)
    val state: StateFlow<WatchlistUiState> = _state.asStateFlow()

    private var currentId: String? = null

    init {
        load()
    }

    fun load(watchlistId: String? = currentId) {
        _state.value = WatchlistUiState.Loading
        viewModelScope.launch {
            try {
                val view = withContext(Dispatchers.IO) {
                    val id = watchlistId ?: repository.watchlists()
                        .firstOrNull { it.isDefault }?.id
                        ?: repository.watchlists().first().id
                    repository.load(id)
                }
                currentId = view.id
                _state.value = WatchlistUiState.Ready(view)
            } catch (err: Throwable) {
                // The message is the engine's where there is one. A holding that
                // failed individually never reaches here — it arrives as a
                // Holding carrying its own error — so this is the whole-screen
                // case: no watchlist, or the engine itself refusing to start.
                _state.value = WatchlistUiState.Failed(
                    err.message?.take(160) ?: err.javaClass.simpleName
                )
            }
        }
    }

    // No onCleared: the store and engine outlive this view model by design.
    // See OmahaEngine — one handle per process, shared so the two screens read
    // the same cache rather than two.
}
