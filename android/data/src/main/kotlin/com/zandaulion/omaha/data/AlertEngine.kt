package com.zandaulion.omaha.data

import com.zandaulion.omaha.engine.HttpBridge
import com.zandaulion.omaha.engine.JsBridge
import com.zandaulion.omaha.engine.jsonString
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The alert sweep, running `core/host/alerts.js` inside QuickJS.
 *
 * A superset of [StockEngine]: the sweep re-fetches each holding through the
 * same pipeline before comparing it, so this bundle carries `host/stock.js`
 * too and needs the same socket and store, plus the two alert-store lookups.
 * One module per interpreter is a hard constraint of the binding (see
 * `JsBridge`), which is why this is a second engine and not a second method on
 * the first.
 *
 * Nothing here decides whether an alert fires, whether it is too soon to
 * repeat, or whether the sweep should continue. All three come back as values
 * from the engine, so the phone and the server agree by construction rather
 * than by two people remembering the same thresholds.
 */
class AlertEngine private constructor(private val bridge: JsBridge) {

    /**
     * Sweep one ticker: fetch, compare against its snapshot, report.
     *
     * @return `{ticker, action, reason, alerts, suppressed, snapshot}` —
     *   `action` is `evaluated`, `skipped` or `abandon`, and a caller that sees
     *   `abandon` must stop rather than move to the next holding.
     */
    suspend fun sweepTicker(ticker: String, settingsJson: String): String =
        bridge.call("sweepTicker", jsonString(ticker), settingsJson)

    /** The five `notify_*` flags as `core/alerts/sweep.js` defines them. */
    suspend fun defaults(): String = bridge.call("defaults")

    /** Milliseconds to wait between tickers, so the host need not hardcode it. */
    suspend fun spacingMs(): String = bridge.call("spacingMs")

    /** How often to sweep, in milliseconds. */
    suspend fun intervalMs(): String = bridge.call("intervalMs")

    /** `{weekday, hour}` for the weekly digest, in JavaScript's day numbering. */
    suspend fun digestSlot(): String = bridge.call("digestSlot")

    /** Compose the Sunday summary from rows the host has already stored. */
    suspend fun digest(inputJson: String): String = bridge.call("digest", inputJson)

    /** Whether an alert composed outside a sweep is still inside its window. */
    suspend fun cooledDown(alertJson: String, lastDeliveredAt: String?): String =
        bridge.call(
            "cooledDown",
            alertJson,
            lastDeliveredAt?.let(::jsonString) ?: "null"
        )

    companion object {
        const val BUNDLE_PATH = "dist/alerts.bundle.js"

        fun fromSource(
            bundleSource: String,
            http: HttpBridge,
            store: RoomStockStore,
            alerts: RoomAlertStore,
            dispatcher: CoroutineDispatcher = Dispatchers.Default,
            logger: (String, String) -> Unit = { _, _ -> }
        ): AlertEngine = AlertEngine(
            JsBridge(
                moduleSource = bundleSource,
                dispatcher = dispatcher,
                hostFunctions = buildMap {
                    put("__httpFetch") { args -> http.request(args.firstOrNull() as? String ?: "{}") }
                    putAll(store.hostFunctions())
                    putAll(alerts.hostFunctions())
                },
                logger = logger
            )
        )
    }
}

/**
 * The two lookups the sweep needs from the alert tables.
 *
 * Reads only. Writing is the caller's, not the engine's, because a snapshot and
 * the history rows that go with it have to land together — see
 * [AlertRepository.sweep].
 */
class RoomAlertStore(private val dao: AlertsDao) {

    /**
     * `{ticker}` in, the stored snapshot out, verbatim.
     *
     * Returned exactly as `snapshotOf` produced it. This layer does not know
     * what is in it and must not: a field it re-spelled on the way through
     * would make `evaluateTriggers` compare against `undefined`, which disables
     * the rule instead of failing it.
     */
    suspend fun snapshotRead(payloadJson: String): String {
        val ticker = payloadJson.field("ticker") ?: return ""
        return dao.snapshot(ticker)?.snapshotJson ?: ""
    }

    /** `{type, ticker}` in, `{at}` out — or nothing if it has never fired. */
    suspend fun lastDelivered(payloadJson: String): String {
        val payload = runCatching {
            Json.parseToJsonElement(payloadJson).jsonObject
        }.getOrNull() ?: return ""

        val type = payload.str("type") ?: return ""
        val at = dao.lastDeliveredAt(type, payload.str("ticker") ?: "") ?: return ""
        return buildJsonObject { put("at", JsonPrimitive(at)) }.toString()
    }

    fun hostFunctions(): Map<String, suspend (Array<Any?>) -> String> = mapOf(
        "__alertSnapshotRead" to { args -> snapshotRead(args.firstArg()) },
        "__alertLastDelivered" to { args -> lastDelivered(args.firstArg()) }
    )

    private companion object {
        fun Array<Any?>.firstArg(): String = firstOrNull() as? String ?: "{}"

        fun JsonObject.str(key: String): String? =
            this[key]?.let { if (it is JsonNull) null else it.jsonPrimitive.contentOrNull }

        fun String.field(key: String): String? =
            runCatching { Json.parseToJsonElement(this).jsonObject.str(key) }.getOrNull()
    }
}
