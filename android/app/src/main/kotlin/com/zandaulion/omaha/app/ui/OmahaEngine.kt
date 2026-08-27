package com.zandaulion.omaha.app.ui

import android.content.Context
import com.zandaulion.omaha.data.OmahaDatabaseFactory
import com.zandaulion.omaha.data.OmahaStore
import com.zandaulion.omaha.data.RoomStockStore
import com.zandaulion.omaha.data.StockDetailRepository
import com.zandaulion.omaha.data.StockEngine
import com.zandaulion.omaha.data.WatchlistRepository
import com.zandaulion.omaha.engine.OkHttpBridge

/**
 * One store and one engine for the whole process.
 *
 * Each screen having its own was the obvious arrangement and the wrong one.
 * Two Room handles on the same file is how a database gets locked, and the
 * caches are the point: `core/host/stock.js` serves a warm ticker in about
 * 21 ms against 1,800 cold (doc 13 §24), which only helps if the watchlist and
 * the deep dive are reading the same cache rather than two.
 *
 * Deliberately not a dependency-injection framework. There are two consumers.
 */
object OmahaEngine {

    private var instance: Handles? = null

    class Handles internal constructor(
        val store: OmahaStore,
        val watchlists: WatchlistRepository,
        val details: StockDetailRepository
    )

    @Synchronized
    fun get(context: Context): Handles = instance ?: build(context).also { instance = it }

    private fun build(context: Context): Handles {
        val app = context.applicationContext
        val store = OmahaDatabaseFactory.open(app)
        val bundle = app.assets.open("core/${StockEngine.BUNDLE_PATH}")
            .bufferedReader().use { it.readText() }
        val engine = StockEngine.fromSource(bundle, OkHttpBridge(), RoomStockStore(store.stockCache))

        return Handles(
            store = store,
            watchlists = WatchlistRepository(store.personalData, engine),
            details = StockDetailRepository(engine)
        )
    }
}
