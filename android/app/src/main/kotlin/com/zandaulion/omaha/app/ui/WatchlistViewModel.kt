package com.zandaulion.omaha.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.zandaulion.omaha.data.WatchlistRepository
import com.zandaulion.omaha.data.WatchlistRow
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

    private val _lists = MutableStateFlow<List<WatchlistRow>>(emptyList())
    val lists: StateFlow<List<WatchlistRow>> = _lists.asStateFlow()

    private val _notice = MutableStateFlow<String?>(null)
    val notice: StateFlow<String?> = _notice.asStateFlow()

    private var currentId: String? = null
    val activeId: String? get() = currentId

    init {
        load()
    }

    fun load(watchlistId: String? = currentId) {
        _state.value = WatchlistUiState.Loading
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            try {
                val id = watchlistId ?: withContext(Dispatchers.IO) {
                    val all = repository.watchlists()
                    all.firstOrNull { it.isDefault }?.id ?: all.first().id
                }
                currentId = id
                withContext(Dispatchers.IO) { _lists.value = repository.watchlists() }

                // Collected rather than awaited: the engine is serialised, so a
                // cold list arrives one company at a time and the screen should
                // fill as it does rather than stay blank until the last one.
                repository.load(id).collect { view ->
                    currentId = view.id
                    _state.value = WatchlistUiState.Ready(view)
                }
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

    fun addTicker(raw: String) {
        val id = currentId ?: return
        viewModelScope.launch {
            _notice.value = when (val result = repository.addTicker(id, raw)) {
                is WatchlistRepository.AddResult.Added -> {
                    load(id)
                    "Added ${result.ticker}${if (result.name.isNotBlank()) " — ${result.name}" else ""}."
                }
                is WatchlistRepository.AddResult.Duplicate ->
                    "${result.ticker} is already on this list."
                is WatchlistRepository.AddResult.Invalid -> result.message
            }
        }
    }

    fun removeTicker(ticker: String) {
        val id = currentId ?: return
        viewModelScope.launch {
            repository.removeTicker(id, ticker)
            load(id)
        }
    }

    fun createWatchlist(name: String) {
        viewModelScope.launch {
            val id = repository.createWatchlist(name)
            _notice.value = "Created \"$name\"."
            load(id)
        }
    }

    fun select(id: String) = load(id)

    fun clearNotice() { _notice.value = null }

    private var loadJob: kotlinx.coroutines.Job? = null

    // No onCleared: the store and engine outlive this view model by design.
    // See OmahaEngine — one handle per process, shared so the two screens read
    // the same cache rather than two.
}
