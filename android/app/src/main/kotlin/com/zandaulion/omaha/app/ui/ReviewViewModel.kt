package com.zandaulion.omaha.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.zandaulion.omaha.data.ReviewOverview
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface ReviewUiState {
    data object Loading : ReviewUiState
    data class Ready(val overview: ReviewOverview) : ReviewUiState
    data class Failed(val message: String) : ReviewUiState
}

class ReviewViewModel(app: Application) : AndroidViewModel(app) {
    private val handles get() = OmahaEngine.get(getApplication())
    private val _state = MutableStateFlow<ReviewUiState>(ReviewUiState.Loading)
    val state = _state.asStateFlow()
    private val _checking = MutableStateFlow(false)
    val checking = _checking.asStateFlow()
    private val _notice = MutableStateFlow<String?>(null)
    val notice = _notice.asStateFlow()
    private var selectedId: String? = null
    private var loadJob: kotlinx.coroutines.Job? = null

    fun load(watchlistId: String? = selectedId) {
        selectedId = watchlistId
        loadJob?.cancel()
        loadJob = viewModelScope.launch {
            _state.value = ReviewUiState.Loading
            read(watchlistId)
        }
    }

    fun checkNow() {
        if (_checking.value) return
        viewModelScope.launch {
            _checking.value = true
            _notice.value = null
            try {
                val result = handles.alerts.sweep()
                _notice.value = when {
                    result.abandonedAt != null -> "Check stopped early. ${result.evaluated} of ${result.swept} companies checked. Try again later."
                    result.evaluated < result.swept -> "Checked ${result.evaluated} of ${result.swept} companies. Some data was unavailable or unchanged in cache."
                    else -> "Checked ${result.evaluated} companies. Recorded changes are shown below."
                }
                read(selectedId)
            } catch (err: CancellationException) {
                throw err
            } catch (err: Throwable) {
                _notice.value = "Could not complete the check. ${err.message?.take(120).orEmpty()}"
            } finally {
                _checking.value = false
            }
        }
    }

    private suspend fun read(id: String?) {
        try {
            _state.value = ReviewUiState.Ready(handles.reviews.summaries(id))
        } catch (err: CancellationException) {
            throw err
        } catch (err: Throwable) {
            _state.value = ReviewUiState.Failed(err.message?.take(160) ?: "Could not load your review history.")
        }
    }
}
