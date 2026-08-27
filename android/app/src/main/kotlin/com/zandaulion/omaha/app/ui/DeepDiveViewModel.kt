package com.zandaulion.omaha.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.zandaulion.omaha.data.StockDetail
import com.zandaulion.omaha.data.StockUnavailable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface DeepDiveUiState {
    data object Empty : DeepDiveUiState
    data class Loading(val ticker: String) : DeepDiveUiState
    data class Ready(val detail: StockDetail) : DeepDiveUiState
    data class Failed(val ticker: String, val message: String) : DeepDiveUiState
}

/**
 * Holds one company's scorecard.
 *
 * Shares [OmahaEngine]'s single store and engine rather than opening its own.
 * Two Room handles on one file is a way to get a locked database, and two
 * engines would each read the 96 KB bundle for no gain — the cache tier in
 * `core/host/stock.js` means a ticker opened from the watchlist is already warm.
 */
class DeepDiveViewModel(app: Application) : AndroidViewModel(app) {

    private val _state = MutableStateFlow<DeepDiveUiState>(DeepDiveUiState.Empty)
    val state: StateFlow<DeepDiveUiState> = _state.asStateFlow()

    private var current: String? = null

    fun open(ticker: String) {
        if (ticker == current && _state.value is DeepDiveUiState.Ready) return
        current = ticker
        load(ticker)
    }

    fun retry() {
        current?.let { load(it) }
    }

    private fun load(ticker: String) {
        _state.value = DeepDiveUiState.Loading(ticker)
        viewModelScope.launch {
            _state.value = try {
                DeepDiveUiState.Ready(OmahaEngine.get(getApplication()).details.detail(ticker))
            } catch (err: StockUnavailable) {
                // The engine's own vocabulary, translated once. `kind` is what
                // core/ asks callers to branch on, and each of these is an
                // ordinary outcome rather than a bug.
                DeepDiveUiState.Failed(
                    ticker,
                    when (err.kind) {
                        "rate_limited" -> "The data provider is rate limiting. Try again shortly."
                        "not_found" -> "No listing found for $ticker."
                        "network" -> "No connection to the data provider."
                        else -> err.message ?: "Could not load $ticker."
                    }
                )
            } catch (err: Throwable) {
                DeepDiveUiState.Failed(ticker, err.message?.take(160) ?: err.javaClass.simpleName)
            }
        }
    }
}
