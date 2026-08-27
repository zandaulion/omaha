package com.zandaulion.omaha.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * One alert, as `core/alerts/triggers.js` composed it.
 *
 * The wording is not ours. Both clients show the same sentence about the same
 * change, which is the whole reason the triggers are shared — a person who
 * reads the web app's notification and then opens the phone should not have to
 * work out whether they are looking at two events or one.
 */
data class Alert(
    val type: String,
    val ticker: String,
    val title: String,
    val body: String,
    /** `positive`, `info`, `warning` or `critical`. Drives the accent colour. */
    val severity: String,
    /** The PWA's deep link. Kept verbatim; [ticker] is what Android navigates by. */
    val url: String
)

/** What the user has asked to be told about. */
data class AlertSettings(
    val earningsAndFilings: Boolean,
    val redFlags: Boolean,
    val marginOfSafety: Boolean,
    val capitalReturns: Boolean,
    val sundayDigest: Boolean
)

/**
 * The outcome of one sweep, for the log and for the Settings screen.
 *
 * [abandonedAt] is the interesting field. A sweep that stopped early because
 * the upstream rate-limited us is not a failed sweep and not a successful one:
 * the holdings after that point were never looked at, so "0 alerts" says
 * nothing about them.
 */
data class SweepResult(
    val swept: Int,
    val evaluated: Int,
    val delivered: List<Alert>,
    val suppressed: List<String>,
    val abandonedAt: String?
)

/**
 * The alert sweep on device.
 *
 * The counterpart of `server/alerts.js`, and deliberately much thinner than it.
 * Every judgement — is this a real change, is it too soon to repeat, is the
 * data fit to compare, should the sweep continue — is made by
 * `core/host/alerts.js` and arrives here as a value. What is left is the part
 * that genuinely differs between a Node server and a phone: which holdings to
 * look at, when to persist, and how to hand an alert to the operating system.
 *
 * Delivery is a callback rather than a dependency. `:data` has no business
 * holding a `NotificationManager`, and the same sweep has to be runnable from a
 * test with nothing to deliver to.
 */
class AlertRepository(
    private val dao: AlertsDao,
    private val personalData: PersonalDataDao,
    private val engine: AlertEngine
) {
    private val json = Json { ignoreUnknownKeys = true }

    // ------------------------------------------------------------- settings

    /**
     * The user's preferences, seeded from the engine on first read.
     *
     * The defaults are `core/alerts/sweep.js`'s, fetched rather than repeated
     * here. That costs one QuickJS call, once, on a device that has never
     * opened Settings — and it buys the guarantee that "buyback alerts start
     * off" cannot come to mean one thing in the browser and another on the
     * phone without somebody noticing.
     */
    suspend fun settings(): AlertSettings = withContext(Dispatchers.IO) {
        dao.settings()?.toSettings() ?: seedSettings()
    }

    private suspend fun seedSettings(): AlertSettings {
        val defaults = json.parseToJsonElement(engine.defaults()).jsonObject
        val row = NotificationSettingsRow(
            id = NotificationSettingsRow.ID,
            notifyEarningsFilings = defaults.flag("notify_earnings_filings"),
            notifyRedFlags = defaults.flag("notify_red_flags"),
            notifyMarginOfSafety = defaults.flag("notify_margin_of_safety"),
            notifyCapitalReturns = defaults.flag("notify_capital_returns"),
            notifySundayDigest = defaults.flag("notify_sunday_digest")
        )
        dao.putSettings(row)
        return row.toSettings()
    }

    suspend fun updateSettings(next: AlertSettings): AlertSettings = withContext(Dispatchers.IO) {
        dao.putSettings(
            NotificationSettingsRow(
                id = NotificationSettingsRow.ID,
                notifyEarningsFilings = next.earningsAndFilings,
                notifyRedFlags = next.redFlags,
                notifyMarginOfSafety = next.marginOfSafety,
                notifyCapitalReturns = next.capitalReturns,
                notifySundayDigest = next.sundayDigest
            )
        )
        // Re-read rather than returning the argument. The screen should show
        // what is stored, not what was asked for.
        dao.settings()?.toSettings() ?: next
    }

    // -------------------------------------------------------------- history

    suspend fun history(limit: Int = 30): List<NotificationRow> =
        withContext(Dispatchers.IO) { dao.history(limit) }

    suspend fun unreadCount(): Int = withContext(Dispatchers.IO) { dao.unreadCount() }

    suspend fun markAllRead() = withContext(Dispatchers.IO) { dao.markAllRead() }

    suspend fun lastSweepAt(): String? = withContext(Dispatchers.IO) { dao.lastSweepAt() }

    // ------------------------------------------------------------- schedule

    /**
     * How often to sweep.
     *
     * From `core/alerts/sweep.js`, so "four times a day" cannot come to mean
     * something different on each client. The fallback applies only if the
     * engine cannot be reached at all, at which point the app has larger
     * problems than its cadence.
     */
    suspend fun sweepIntervalMs(): Long = withContext(Dispatchers.IO) {
        runCatching { engine.intervalMs().trim().toLong() }
            .getOrDefault(6 * 60 * 60 * 1000L)
    }

    /**
     * Is the weekly digest due right now?
     *
     * The slot — Sunday, 09:00 — comes from the engine, so the two clients
     * cannot drift onto different days. Evaluated in **local** time, matching
     * the server's `getDay()`/`getHours()`: a Sunday-morning summary is about
     * the reader's Sunday morning, not UTC's.
     *
     * Answered here rather than in the worker so JSON parsing stays inside this
     * module; `:app` deliberately holds no serialization dependency.
     */
    suspend fun digestIsDue(now: java.time.ZonedDateTime = java.time.ZonedDateTime.now()): Boolean =
        withContext(Dispatchers.IO) {
            val slot = runCatching {
                json.parseToJsonElement(engine.digestSlot()).jsonObject
            }.getOrNull() ?: return@withContext false

            val weekday = slot.int("weekday") ?: return@withContext false
            val hour = slot.int("hour") ?: return@withContext false

            // java.time counts Monday as 1 and Sunday as 7; JavaScript counts
            // Sunday as 0. Converted rather than assumed, because the two agree
            // on every other day and would diverge only on the one that matters.
            (now.dayOfWeek.value % 7) == weekday && now.hour >= hour
        }

    // ---------------------------------------------------------------- sweep

    /**
     * Re-score every watched holding and deliver whatever fired.
     *
     * @param deliver called once per alert, after it has been recorded. A
     *   throw here is caught and logged rather than abandoning the sweep: an
     *   alert that could not be *shown* is still an alert that happened, and
     *   losing the rest of the watchlist over it would be a worse trade.
     */
    suspend fun sweep(
        deliver: suspend (Alert) -> Unit = {},
        log: (String) -> Unit = {}
    ): SweepResult = withContext(Dispatchers.IO) {
        val settings = settings().toJson()
        val tickers = watchedTickers()
        val spacing = runCatching { engine.spacingMs().trim().toLong() }.getOrDefault(1200L)

        val delivered = mutableListOf<Alert>()
        val suppressed = mutableListOf<String>()
        var evaluated = 0
        var abandonedAt: String? = null

        for ((index, ticker) in tickers.withIndex()) {
            val step = runCatching {
                json.parseToJsonElement(engine.sweepTicker(ticker, settings)).jsonObject
            }.getOrElse { err ->
                // One holding failing to score is ordinary — a delisted symbol,
                // a malformed filing. The sweep continues; the snapshot is
                // simply not updated, so the next pass compares against the
                // last reading that was actually good.
                log("sweep: $ticker failed — ${err.message?.take(160)}")
                null
            } ?: run {
                if (index < tickers.lastIndex) delay(spacing)
                continue
            }

            when (step.str("action")) {
                "abandon" -> {
                    // The endpoint said no, not this ticker. Another request
                    // every 1.2 s into that block is how a transient limit
                    // becomes a sustained one; the next sweep is six hours out.
                    abandonedAt = ticker
                    log("sweep: abandoned at $ticker (${step.str("reason")})")
                    break
                }
                "evaluated" -> {
                    evaluated++
                    suppressed += step.strings("suppressed")

                    val fired = step["alerts"]?.jsonArray.orEmpty().map { it.jsonObject.toAlert() }
                    for (alert in fired) {
                        // Recorded before delivery, exactly as the server does
                        // it. The history row is what the cooldown is enforced
                        // against, so an alert that rang without being recorded
                        // would ring again on the next sweep.
                        dao.record(alert.toRow())
                        delivered += alert
                        runCatching { deliver(alert) }
                            .onFailure { log("sweep: could not show ${alert.type} for $ticker") }
                    }

                    step["snapshot"]?.takeIf { it is JsonObject }?.let { snapshot ->
                        dao.putSnapshot(
                            SnapshotRow(
                                ticker = ticker,
                                // Stored as the engine emitted it. See Alerts.kt
                                // for why this layer does not look inside.
                                snapshotJson = snapshot.toString(),
                                healthScore = snapshot.jsonObject.int("health_score"),
                                baselineScore = snapshot.jsonObject.int("week_ago_score"),
                                capturedAt = isoNow()
                            )
                        )
                    }
                }
                // "skipped": stale or unreadable. Deliberately no snapshot
                // write — overwriting a good baseline with a copy of itself
                // would make the next comparison silently meaningless.
            }

            if (index < tickers.lastIndex) delay(spacing)
        }

        dao.trimTo(HISTORY_LIMIT)

        SweepResult(
            swept = tickers.size,
            evaluated = evaluated,
            delivered = delivered,
            suppressed = suppressed,
            abandonedAt = abandonedAt
        )
    }

    /**
     * The Sunday summary across the default list.
     *
     * Reads what the week's sweeps already stored rather than re-fetching.
     * Twenty cold ingests at 09:00 on a Sunday is a good way to be
     * rate-limited every Sunday at 09:01, and nothing in a weekly summary
     * needs a number fresher than six hours.
     */
    suspend fun digest(deliver: suspend (Alert) -> Unit = {}): Alert? = withContext(Dispatchers.IO) {
        if (!settings().sundayDigest) return@withContext null

        val lists = personalData.watchlists()
        val list = lists.firstOrNull { it.isDefault } ?: lists.firstOrNull() ?: return@withContext null

        val holdings = buildJsonArray {
            for (ticker in tickersOf(list)) {
                val snapshot = dao.snapshot(ticker) ?: continue
                val score = snapshot.healthScore ?: continue
                add(
                    buildJsonObject {
                        put("ticker", JsonPrimitive(ticker))
                        put("healthScore", JsonPrimitive(score))
                        // Null until a baseline has rolled, which the engine
                        // reads as "no comparison possible" and leaves out of
                        // the movers — rather than reporting a new holding as
                        // having gained its entire score this week.
                        put(
                            "previousScore",
                            snapshot.baselineScore?.let(::JsonPrimitive) ?: JsonNull
                        )
                        // No market cap: the cache holds one, but reading
                        // twenty cached records to weight a summary is the cost
                        // the digest exists to avoid. The engine falls back to
                        // a plain mean, so a phone digest and a web digest can
                        // differ by a point or two on the same list. Named here
                        // because it is a real asymmetry, not an oversight.
                    }
                )
            }
        }

        val payload = buildJsonObject {
            put("listName", JsonPrimitive(list.name))
            put("holdings", holdings)
        }

        val composed = runCatching {
            json.parseToJsonElement(engine.digest(payload.toString()))
        }.getOrNull()
        val obj = composed as? JsonObject ?: return@withContext null

        val alert = obj.toAlert()
        val last = dao.lastDeliveredAt(alert.type, alert.ticker)
        val cooled = runCatching {
            engine.cooledDown(obj.toString(), last).trim() == "true"
        }.getOrDefault(false)
        if (cooled) return@withContext null

        dao.record(alert.toRow())
        runCatching { deliver(alert) }
        alert
    }

    /** Every ticker on any list — the set the user has asked to be told about. */
    private suspend fun watchedTickers(): List<String> =
        personalData.watchlists().flatMap(::tickersOf).distinct()

    private fun tickersOf(list: WatchlistRow): List<String> = runCatching {
        json.parseToJsonElement(list.tickersJson).jsonArray.mapNotNull { it.jsonPrimitive.contentOrNull }
    }.getOrDefault(emptyList())

    private fun AlertSettings.toJson(): String = buildJsonObject {
        // snake_case, because these keys are read by `triggers.js` directly.
        put("notify_earnings_filings", JsonPrimitive(earningsAndFilings))
        put("notify_red_flags", JsonPrimitive(redFlags))
        put("notify_margin_of_safety", JsonPrimitive(marginOfSafety))
        put("notify_capital_returns", JsonPrimitive(capitalReturns))
        put("notify_sunday_digest", JsonPrimitive(sundayDigest))
    }.toString()

    private fun Alert.toRow() = NotificationRow(
        ticker = ticker,
        alertType = type,
        title = title,
        body = body,
        severity = severity,
        url = url,
        deliveredAt = isoNow()
    )

    private companion object {
        /**
         * How many history rows to keep.
         *
         * Comfortably longer than the longest cooldown window (14 days at four
         * sweeps a day), so trimming can never resurrect a suppressed alert —
         * which would be the one bug here nobody would attribute to pruning.
         */
        const val HISTORY_LIMIT = 200
    }
}

private fun NotificationSettingsRow.toSettings() = AlertSettings(
    earningsAndFilings = notifyEarningsFilings,
    redFlags = notifyRedFlags,
    marginOfSafety = notifyMarginOfSafety,
    capitalReturns = notifyCapitalReturns,
    sundayDigest = notifySundayDigest
)

private fun JsonObject.toAlert() = Alert(
    type = str("type") ?: "UNKNOWN",
    ticker = str("ticker") ?: "",
    title = str("title") ?: "",
    body = str("body") ?: "",
    severity = str("severity") ?: "info",
    url = str("url") ?: ""
)

private fun JsonObject.flag(key: String): Boolean =
    when (val v = (this[key] as? JsonPrimitive)?.contentOrNull) {
        null, "0", "false", "null" -> false
        else -> v != ""
    }

private fun JsonObject.str(key: String): String? =
    (this[key] as? JsonPrimitive)?.contentOrNull?.takeUnless { it == "null" }

private fun JsonObject.int(key: String): Int? =
    (this[key] as? JsonPrimitive)?.intOrNull

private fun JsonObject.strings(key: String): List<String> =
    this[key]?.jsonArray.orEmpty().mapNotNull { (it as? JsonPrimitive)?.contentOrNull }
