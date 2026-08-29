package com.zandaulion.omaha.app.ui

import android.content.Context
import com.zandaulion.omaha.data.AiRepository
import com.zandaulion.omaha.data.AlertEngine
import com.zandaulion.omaha.data.AlertRepository
import com.zandaulion.omaha.data.AuthRepository
import com.zandaulion.omaha.data.BillingRepository
import com.zandaulion.omaha.data.OmahaDatabaseFactory
import com.zandaulion.omaha.data.OmahaStore
import com.zandaulion.omaha.data.RelayRepository
import com.zandaulion.omaha.data.RoomAlertStore
import com.zandaulion.omaha.data.RoomStockStore
import com.zandaulion.omaha.data.StockDetailRepository
import com.zandaulion.omaha.data.StockEngine
import com.zandaulion.omaha.data.ThesisRepository
import com.zandaulion.omaha.data.WatchlistRepository
import com.zandaulion.omaha.data.BackupIo
import com.zandaulion.omaha.data.PersonalDataStore
import com.zandaulion.omaha.engine.BackupEngine
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
        val details: StockDetailRepository,
        val theses: ThesisRepository,
        val settings: com.zandaulion.omaha.data.AppSettings,
        val backup: BackupIo,
        val alerts: AlertRepository,
        val auth: AuthRepository,
        val billing: BillingRepository,
        val relay: RelayRepository,
        val ai: AiRepository
    )

    @Synchronized
    fun get(context: Context): Handles = instance ?: build(context).also { instance = it }

    private fun build(context: Context): Handles {
        val app = context.applicationContext
        val store = OmahaDatabaseFactory.open(app)
        val bundle = app.assets.open("core/${StockEngine.BUNDLE_PATH}")
            .bufferedReader().use { it.readText() }
        val engine = StockEngine.fromSource(bundle, OkHttpBridge(), RoomStockStore(store.stockCache))

        // A second bundle, not a second pipeline. `core/host/alerts.js` builds
        // on `host/stock.js`, so the sweep re-scores through the identical
        // path the watchlist reads — and shares its cache, which is why the
        // store handed to both is the same one. One module per interpreter is
        // a hard constraint of the binding, hence two engines rather than two
        // methods on one.
        val alertEngine = AlertEngine.fromSource(
            app.assets.open("core/${AlertEngine.BUNDLE_PATH}").bufferedReader().use { it.readText() },
            OkHttpBridge(),
            RoomStockStore(store.stockCache),
            RoomAlertStore(store.alerts)
        )

        val details = StockDetailRepository(engine)
        val theses = ThesisRepository(store.personalData)
        val settings = com.zandaulion.omaha.data.AppSettings(store.appSettings)
        val relay = RelayRepository()

        return Handles(
            store = store,
            watchlists = WatchlistRepository(store.personalData, engine),
            details = details,
            theses = theses,
            settings = settings,
            backup = BackupIo(
                BackupEngine.fromSource(
                    app.assets.open("core/${BackupEngine.BUNDLE_PATH}")
                        .bufferedReader().use { it.readText() }
                ),
                PersonalDataStore(store.personalData)
            ),
            alerts = AlertRepository(store.alerts, store.personalData, alertEngine),
            auth = AuthRepository(app),
            billing = BillingRepository(app),
            relay = relay,
            ai = AiRepository(details, theses, settings, relay)
        )
    }
}
