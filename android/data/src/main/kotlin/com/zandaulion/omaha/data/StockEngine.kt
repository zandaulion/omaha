package com.zandaulion.omaha.data

import com.zandaulion.omaha.engine.HttpBridge
import com.zandaulion.omaha.engine.JsBridge
import com.zandaulion.omaha.engine.jsonString
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

/**
 * The whole pipeline on device: cache check, fetch, assemble, score, persist.
 *
 * `core/host/stock.js` runs in QuickJS with two things supplied from here — a
 * socket and a store — and calls the identical `getStockData` the PWA server
 * calls. Which cache tier is still valid, when stale data beats no data, and
 * when a failure must be reported rather than papered over are all decided
 * there, once, for both clients.
 *
 * This class supplies capabilities and holds no opinions. That is the whole
 * arrangement: the host answers questions, `core/` makes judgements.
 */
class StockEngine private constructor(private val bridge: JsBridge) {

    /**
     * Fetch, score and cache one ticker.
     *
     * @return `{ok: true, data}` or `{ok: false, error: {kind, ...}}`.
     *   Failures arrive as values because a rate limit or a dead symbol is
     *   ordinary, and `kind` is what a caller acts on.
     */
    suspend fun stock(ticker: String, forceRefresh: Boolean = false): String =
        bridge.call(
            "stock",
            jsonString(ticker),
            """{"forceRefresh":$forceRefresh}"""
        )

    /** Ticker and company-name search, cached rows merged with live results. */
    suspend fun search(query: String): String = bridge.call("search", jsonString(query))

    companion object {
        const val BUNDLE_PATH = "dist/stock.bundle.js"

        fun fromSource(
            bundleSource: String,
            http: HttpBridge,
            store: RoomStockStore,
            dispatcher: CoroutineDispatcher = Dispatchers.Default,
            logger: (String, String) -> Unit = { _, _ -> }
        ): StockEngine = StockEngine(
            JsBridge(
                moduleSource = bundleSource,
                dispatcher = dispatcher,
                hostFunctions = buildMap {
                    put("__httpFetch") { args -> http.request(args.firstOrNull() as? String ?: "{}") }
                    putAll(store.hostFunctions())
                },
                logger = logger
            )
        )

    }
}
