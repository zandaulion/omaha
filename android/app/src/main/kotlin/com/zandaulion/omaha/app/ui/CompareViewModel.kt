package com.zandaulion.omaha.app.ui

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.zandaulion.omaha.data.CompareCandidates
import com.zandaulion.omaha.data.Holding
import com.zandaulion.omaha.data.Pillar
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

/** The PWA's COMPARE_MAX (`web/app.js`) — five, since 5828396 raised it from four. */
const val MAX_COMPARED = 5

/**
 * Holds the comparison screen's picked tickers and, for each, the two
 * things it draws from: a [Holding] for the table (same shape and the same
 * loading/error convention `HoldingCard` already renders for the watchlist)
 * and — once that resolves without error — the [Pillar] list for the radar
 * chart.
 *
 * Two repository calls per ticker, both ultimately reading the same cached
 * record through the shared, mutex-serialised [com.zandaulion.omaha.data.StockEngine]
 * (see `JsBridge.call`) — accepted rather than writing a third parser over
 * the raw record, since `core/host/stock.js`'s own cache tier absorbs the
 * repeat. Launched independently per ticker, not as one sequential flow
 * over the whole list the way `WatchlistRepository.load` is: the picked
 * set changes one ticker at a time as the picker is used, and a per-ticker
 * job is what makes `pick`/`drop` cheap rather than rebuilding everything.
 */
class CompareViewModel(app: Application) : AndroidViewModel(app) {

    private val watchlists get() = OmahaEngine.get(getApplication()).watchlists
    private val details get() = OmahaEngine.get(getApplication()).details
    private val settings get() = OmahaEngine.get(getApplication()).settings
    private val compareCandidates get() = OmahaEngine.get(getApplication()).compareCandidates

    private val _tickers = MutableStateFlow<List<String>>(emptyList())
    val tickers: StateFlow<List<String>> = _tickers.asStateFlow()

    private val _holdings = MutableStateFlow<Map<String, Holding>>(emptyMap())
    val holdings: StateFlow<Map<String, Holding>> = _holdings.asStateFlow()

    private val _pillars = MutableStateFlow<Map<String, List<Pillar>>>(emptyMap())
    val pillars: StateFlow<Map<String, List<Pillar>>> = _pillars.asStateFlow()

    private val _candidates = MutableStateFlow<CompareCandidates?>(null)
    val candidates: StateFlow<CompareCandidates?> = _candidates.asStateFlow()

    private val jobs = mutableMapOf<String, Job>()

    init {
        viewModelScope.launch {
            val saved = settings.compareTickers().take(MAX_COMPARED)
            _tickers.value = saved
            saved.forEach(::loadTicker)
        }
    }

    fun pick(ticker: String) {
        val current = _tickers.value
        if (ticker in current || current.size >= MAX_COMPARED) return
        _tickers.value = current + ticker
        persist()
        loadTicker(ticker)
    }

    fun drop(ticker: String) {
        _tickers.value = _tickers.value - ticker
        jobs.remove(ticker)?.cancel()
        _holdings.value = _holdings.value - ticker
        _pillars.value = _pillars.value - ticker
        persist()
    }

    /** Loaded on demand — the picker's candidates are only worth fetching while it's open. */
    fun openPicker(seedTicker: String?) {
        viewModelScope.launch {
            _candidates.value = compareCandidates.candidates(seedTicker)
        }
    }

    fun closePicker() {
        _candidates.value = null
    }

    private fun persist() {
        viewModelScope.launch { settings.setCompareTickers(_tickers.value) }
    }

    private fun loadTicker(ticker: String) {
        jobs[ticker] = viewModelScope.launch {
            _holdings.value = _holdings.value + (ticker to loadingHolding(ticker))
            val holding = watchlists.holdingFor(ticker)
            _holdings.value = _holdings.value + (ticker to holding)
            if (holding.error == null) {
                runCatching { details.detail(ticker) }
                    .onSuccess { _pillars.value = _pillars.value + (ticker to it.pillars) }
            }
        }
    }

    private fun loadingHolding(ticker: String) = Holding(
        ticker = ticker, name = "", price = null, currency = "",
        changePct = null, healthScore = null, healthTier = "moderate",
        roicPct = null, altmanZ = null, roe = null, peRatio = null,
        isFinancial = false, topCatalyst = null, topRisk = null,
        error = null, loading = true
    )
}
