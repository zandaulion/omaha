package com.zandaulion.omaha.selftest

import android.app.Activity
import android.graphics.Color
import android.graphics.Typeface
import android.os.Build
import android.os.Bundle
import android.text.SpannableStringBuilder
import android.text.Spanned
import android.text.style.ForegroundColorSpan
import android.util.Log
import android.util.TypedValue
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.room.Room
import com.zandaulion.omaha.data.AlertEngine
import com.zandaulion.omaha.data.AlertRepository
import com.zandaulion.omaha.data.OmahaDatabase
import com.zandaulion.omaha.data.PersonalDataStore
import com.zandaulion.omaha.data.RoomAlertStore
import com.zandaulion.omaha.data.RoomStockStore
import com.zandaulion.omaha.data.SnapshotRow
import com.zandaulion.omaha.data.StockEngine
import com.zandaulion.omaha.engine.BackupEngine
import com.zandaulion.omaha.engine.IngestEngine
import com.zandaulion.omaha.engine.OkHttpBridge
import com.zandaulion.omaha.engine.JsBridgeException
import com.zandaulion.omaha.engine.ScoringEngine
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlin.system.measureNanoTime

/**
 * Runs the checks CI runs, on this handset, and reports what they cost.
 *
 * The assertions are not new — `ScoringParityTest` and `BackupRoundTripTest`
 * already make them. What is new is the hardware. Every timing recorded so far
 * came from an x86_64 emulator on a desktop CPU, which settles an order of
 * magnitude and nothing finer; doc 13 lists ARM cost as still open, and this is
 * how it gets closed.
 */
class SelfTestActivity : Activity() {

    private lateinit var out: TextView
    private val tickers = listOf("NOK", "AAPL", "JPM")
    private var failures = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(BG)
            setPadding(dp(16), dp(24), dp(16), dp(24))
        }
        val title = TextView(this).apply {
            text = "Pocket Omaha - engine self-test"
            setTextColor(TEXT)
            setTypeface(Typeface.DEFAULT_BOLD)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        }
        out = TextView(this).apply {
            setTextColor(TEXT)
            setTypeface(Typeface.MONOSPACE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setPadding(0, dp(12), 0, 0)
            setTextIsSelectable(true)
        }
        root.addView(title)
        root.addView(
            ScrollView(this).apply {
                addView(out)
                layoutParams = LinearLayout.LayoutParams(
                    ViewGroup.LayoutParams.MATCH_PARENT,
                    ViewGroup.LayoutParams.MATCH_PARENT
                )
            }
        )
        setContentView(root)

        CoroutineScope(Dispatchers.Main).launch { runAll() }
    }

    // ------------------------------------------------------------ reporting

    private fun line(text: String, colour: Int = TEXT) {
        // Mirrored to logcat so the run can be read over adb without looking
        // at the screen — which is how it gets checked in the first place.
        Log.i(TAG, text.trim())
        val span = SpannableStringBuilder(out.text)
        val start = span.length
        span.append(text)
        span.append(NEWLINE)
        span.setSpan(
            ForegroundColorSpan(colour), start, span.length, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE
        )
        out.text = span
    }

    private fun heading(text: String) = line(NEWLINE + text, ACCENT)

    private fun check(label: String, condition: Boolean, detail: String = "") {
        if (condition) {
            line("  PASS  " + label, GOOD)
        } else {
            failures++
            line("  FAIL  " + label + (if (detail.isEmpty()) "" else " - " + detail), BAD)
        }
    }

    // ------------------------------------------------------------ the checks

    private suspend fun runAll() {
        heading("Device")
        line("  model      " + Build.MANUFACTURER + " " + Build.MODEL)
        line("  abi        " + Build.SUPPORTED_ABIS.joinToString())
        line("  api        " + Build.VERSION.SDK_INT + " (" + Build.VERSION.RELEASE + ")")
        line("  page size  " + pageSize())

        try {
            localeChecks()
            scoringChecks()
            backupChecks()
            livePipeline()
            alertChecks()
            edgarSizeCurve()
        } catch (err: Throwable) {
            failures++
            line("  FAIL  unexpected: " + err.javaClass.simpleName + ": " + err.message, BAD)
        }

        heading(if (failures == 0) "All checks passed." else failures.toString() + " check(s) FAILED.")
        line(
            NEWLINE + "Every assertion above also runs in CI. What this run adds is" +
                NEWLINE + "the hardware: timings from a real handset, not an emulator.",
            MUTED
        )
    }

    /**
     * Does this runtime read a decimal point as a decimal point?
     *
     * Expected to pass, and worth asserting anyway. The JVM build of QuickJS
     * takes the decimal separator from the C library locale, so on a desktop
     * set to a comma locale `8.5` evaluates to `8` — silently, in source
     * literals and `JSON.parse` alike — which took the scoring parity suite red
     * while looking exactly like an engine fault.
     *
     * Android should be immune because bionic implements only the C locale.
     * That is a claim about the platform, and this is the difference between
     * having checked it on this handset and having read it somewhere.
     */
    private suspend fun localeChecks() {
        heading("Numeric locale  (does 8.5 mean 8.5 here?)")
        line("  default locale " + java.util.Locale.getDefault(), MUTED)

        val quickJs = com.dokar.quickjs.QuickJs.create(Dispatchers.Default)
        try {
            var out: String? = null
            quickJs.defineBinding(
                "__out",
                com.dokar.quickjs.binding.FunctionBinding { args -> out = args.firstOrNull() as? String; null }
            )
            quickJs.evaluate<Any?>(
                "__out([8.5, JSON.parse('8.5'), parseFloat('8.5'), (8.5).toFixed(2)].join('|'));",
                "locale-probe.js",
                false
            )
            check(
                "decimals survive source, JSON.parse, parseFloat and toFixed",
                out == "8.5|8.5|8.5|8.50",
                out ?: "no result"
            )
        } finally {
            quickJs.close()
        }
    }

    private suspend fun scoringChecks() {
        val bundle = asset("core/" + ScoringEngine.BUNDLE_PATH)
        heading("Scoring engine  (core/scoring.js in QuickJS)")
        line("  bundle     " + (bundle.length / 1024) + " KB")

        for (ticker in tickers) {
            val input = asset(ticker + ".scoring-input.json")
            val expected = canonical(Json.parseToJsonElement(asset(ticker + ".scoring-output.json")))
            val actual = withContext(Dispatchers.Default) {
                canonical(Json.parseToJsonElement(ScoringEngine.fromSource(bundle).score(input)))
            }
            check(ticker + " scores identically to Node", expected == actual)
        }

        // The number this app exists to collect.
        val input = asset("NOK.scoring-input.json")
        val timings = withContext(Dispatchers.Default) {
            val cold = measureNanoTime { ScoringEngine.fromSource(bundle).score(input) }
            val engine = ScoringEngine.fromSource(bundle)
            engine.score(input)
            var total = 0L
            repeat(10) { total += measureNanoTime { engine.score(input) } }
            Pair(cold / 1_000_000.0, total / 10 / 1_000_000.0)
        }

        line(String.format("  first score            %.1f ms", timings.first))
        line(String.format("  per score (mean of 10) %.1f ms", timings.second))
        check(
            "scoring is quick enough to go unnoticed",
            timings.second < 250.0,
            timings.second.toInt().toString() + " ms"
        )
    }

    private suspend fun backupChecks() {
        heading("Backup  (core/backup.js in QuickJS, into Room)")

        val engine = BackupEngine.fromSource(asset("core/" + BackupEngine.BUNDLE_PATH))
        val db = Room.inMemoryDatabaseBuilder(applicationContext, OmahaDatabase::class.java).build()
        val store = PersonalDataStore(db.personalData())
        val file = asset("backup.pwa.json")
        val now = "2026-08-20T12:00:00.000Z"

        try {
            val roundTripped = withContext(Dispatchers.Default) {
                store.write(engine.merge(file, store.read()), now)
                engine.build(store.read(), now)
            }

            val original = Json.parseToJsonElement(file) as JsonObject
            val round = Json.parseToJsonElement(roundTripped) as JsonObject
            check(
                "a PWA backup imports and exports unchanged",
                original["theses"].toString() == round["theses"].toString() &&
                    original["watchlists"].toString() == round["watchlists"].toString()
            )

            val notes = notesFor(withContext(Dispatchers.Default) { store.read() }, "NOK")
            check(
                "emoji in a journal note survive the bridge",
                notes.contains(String(Character.toChars(0x1F680))),
                "got: " + notes.take(60)
            )

            val repeated = withContext(Dispatchers.Default) {
                val before = store.read()
                store.write(engine.merge(file, store.read()), now)
                Pair(before, store.read())
            }
            check("a repeated import changes nothing", repeated.first == repeated.second)

            val refused = withContext(Dispatchers.Default) {
                try {
                    engine.merge(FUTURE_BACKUP, store.read())
                    false
                } catch (err: JsBridgeException) {
                    err.message?.contains("version 99") == true
                }
            }
            check("a backup from a newer schema is refused", refused)
        } finally {
            db.close()
        }
    }

    /**
     * The whole pipeline, live, on this device: fetch, assemble, score, cache.
     *
     * The one check here that is not a repeat of CI. Everything above replays
     * recorded bytes; this proves the shim, the socket, the store and the
     * engine work together against the live upstream — which is what the PWA
     * needs a server for and this client does not.
     *
     * A failure is reported as SKIP rather than FAIL. No network, or a rate
     * limit, says nothing about the code, and marking it red would train
     * whoever runs this to ignore red.
     */
    private suspend fun livePipeline() {
        heading("Live pipeline  (fetch, score and cache, on device)")

        val db = Room.inMemoryDatabaseBuilder(applicationContext, OmahaDatabase::class.java).build()
        try {
            val engine = StockEngine.fromSource(
                asset("core/" + StockEngine.BUNDLE_PATH),
                OkHttpBridge(),
                RoomStockStore(db.stockCache())
            )

            val started = System.nanoTime()
            val raw = withContext(Dispatchers.IO) { engine.stock("NOK", forceRefresh = true) }
            val coldMs = (System.nanoTime() - started) / 1_000_000.0

            val result = Json.parseToJsonElement(raw) as JsonObject
            if ((result["ok"] as? JsonPrimitive)?.content != "true") {
                val error = result["error"] as? JsonObject
                val kind = (error?.get("kind") as? JsonPrimitive)?.content ?: "unknown"
                val message = (error?.get("message") as? JsonPrimitive)?.content ?: ""
                line("  SKIP  no live data (" + kind + ") " + message.take(60), MUTED)
                return
            }

            val data = result["data"] as JsonObject
            val name = (data["name"] as? JsonPrimitive)?.content ?: "?"
            val price = (data["price"] as? JsonPrimitive)?.content ?: "?"
            val currency = (data["currency"] as? JsonPrimitive)?.content ?: ""
            val score = (data["health_score"] as? JsonPrimitive)?.content ?: "null"
            val checks = (data["checklist"] as? JsonArray)?.size ?: 0

            line("  fetched    " + name)
            line("  price      " + price + " " + currency)
            line("  health     " + score + "/100, " + coverage(data) + " checks measured")
            line(String.format("  cold       %.0f ms", coldMs))

            // The tier that had never worked in the PWA, exercised for real.
            val warmStart = System.nanoTime()
            val warm = withContext(Dispatchers.IO) { engine.stock("NOK") }
            val warmMs = (System.nanoTime() - warmStart) / 1_000_000.0
            val warmOk = (Json.parseToJsonElement(warm) as JsonObject)["ok"]

            line(String.format("  cached     %.0f ms", warmMs))
            check("a live ticker fetches, scores and caches on device", checks > 0)
            check(
                "the second read is served from cache",
                (warmOk as? JsonPrimitive)?.content == "true" && warmMs < coldMs / 2
            )
        } finally {
            db.close()
        }
    }

    /**
     * What EDGAR costs on this phone, against blob size.
     *
     * This is the one question doc 14 §3a leaves open, and it cannot be
     * answered anywhere but here. `companyfacts` is a single request whose body
     * ranges from about 0.9 MB to 7.5 MB — measured on a laptop, where
     * `JSON.parse` of the largest costs 129 ms under V8. QuickJS on an ARM
     * handset is a different proposition, and doc 13 §20 records that handset
     * and emulator figures moved in the opposite direction from intuition, so
     * an estimate is worth nothing here.
     *
     * Three tickers spanning the range, smallest first. Each is forced past
     * both cache tiers so the number is a genuine cold fetch-parse-score.
     *
     * There are two ways this can be informative. A time is the expected
     * outcome. A failure on JPM alone would be at least as useful: it would
     * mean the 7.5 MB body does not survive the bridge, and that is a design
     * constraint rather than a bug — the JS side escapes every non-ASCII code
     * unit before it crosses, so a large body arrives larger still.
     */
    /**
     * The alert sweep, end to end, against a throwaway database.
     *
     * Worth running on a handset rather than only in CI because the sweep is
     * the one feature whose whole job happens where nobody is looking. A
     * trigger that has stopped firing produces silence, and silence is
     * indistinguishable from "nothing changed" — so the only honest way to know
     * the chain works is to make something change and watch it fire.
     *
     * The sequence deliberately mirrors what a real device does over a week:
     * a first sighting that establishes a baseline, an unchanged sweep that
     * must stay quiet, a genuine move that must not, and an immediate repeat
     * that the cooldown must swallow.
     */
    private suspend fun alertChecks() {
        heading("Alert sweep  (core/host/alerts.js in QuickJS, over Room)")

        val db = Room.inMemoryDatabaseBuilder(applicationContext, OmahaDatabase::class.java).build()
        try {
            val engine = AlertEngine.fromSource(
                asset("core/" + AlertEngine.BUNDLE_PATH),
                OkHttpBridge(),
                RoomStockStore(db.stockCache()),
                RoomAlertStore(db.alerts())
            )
            val alerts = AlertRepository(db.alerts(), db.personalData(), engine)

            // --- policy, straight from the shared module ---------------------
            val settings = alerts.settings()
            check(
                "capital returns starts off, everything else on",
                settings.earningsAndFilings && settings.redFlags &&
                    settings.marginOfSafety && settings.sundayDigest &&
                    !settings.capitalReturns
            )
            val interval = alerts.sweepIntervalMs()
            check(
                "sweeps four times a day",
                interval == 6L * 60 * 60 * 1000,
                interval.toString() + " ms"
            )

            // --- one holding, four sweeps ------------------------------------
            db.personalData().upsertWatchlists(
                listOf(
                    com.zandaulion.omaha.data.WatchlistRow(
                        id = "selftest",
                        name = "Self test",
                        tickersJson = "[\"NOK\"]",
                        isDefault = true,
                        updatedAt = "2026-01-01T00:00:00Z"
                    )
                )
            )

            val first = withContext(Dispatchers.IO) { alerts.sweep() }
            if (first.evaluated == 0) {
                line("  SKIP  no live data for NOK; the rest of this section needs it", MUTED)
                return
            }

            // A first sighting is a baseline, not an event. Firing here would
            // mean every newly added holding announces itself on day one.
            check(
                "first sighting establishes a baseline and says nothing",
                first.delivered.isEmpty(),
                first.delivered.size.toString() + " fired"
            )
            check("a snapshot was stored", db.alerts().snapshot("NOK") != null)

            val unchanged = withContext(Dispatchers.IO) { alerts.sweep() }
            check(
                "an unchanged holding stays quiet",
                unchanged.delivered.isEmpty(),
                unchanged.delivered.joinToString { it.type }
            )

            // --- make something move -----------------------------------------
            // The snapshot is rewritten with a health score nine points lower,
            // which is a real EARNINGS_HEALTH_SHIFT by the shared threshold of
            // three. Doctoring the stored past rather than the fetched present
            // keeps the live data honest: what is being tested is the
            // comparison, not the scoring.
            val stored = db.alerts().snapshot("NOK")!!
            val current = (Json.parseToJsonElement(stored.snapshotJson) as JsonObject)
            val score = (current["health_score"] as? JsonPrimitive)?.content?.toIntOrNull()
            if (score == null) {
                line("  SKIP  NOK scored null; nothing to move", MUTED)
                return
            }
            db.alerts().putSnapshot(
                stored.copy(
                    snapshotJson = stored.snapshotJson.replace(
                        "\"health_score\":" + score,
                        "\"health_score\":" + (score - 9)
                    ),
                    healthScore = score - 9
                )
            )

            val moved = withContext(Dispatchers.IO) { alerts.sweep() }
            check(
                "a 9-point health move fires",
                moved.delivered.any { it.type == "EARNINGS_HEALTH_SHIFT" },
                moved.delivered.joinToString { it.type + " / " + it.title }
            )

            // --- and does not fire twice --------------------------------------
            db.alerts().putSnapshot(
                stored.copy(
                    snapshotJson = stored.snapshotJson.replace(
                        "\"health_score\":" + score,
                        "\"health_score\":" + (score - 9)
                    ),
                    healthScore = score - 9
                )
            )
            val repeat = withContext(Dispatchers.IO) { alerts.sweep() }
            check(
                "the same alert is suppressed by its cooldown",
                repeat.delivered.none { it.type == "EARNINGS_HEALTH_SHIFT" } &&
                    repeat.suppressed.any { it.contains("EARNINGS_HEALTH_SHIFT") },
                repeat.suppressed.joinToString()
            )
        } catch (err: JsBridgeException) {
            failures++
            line("  FAIL  bridge: " + (err.message ?: "").take(120), BAD)
        } finally {
            db.close()
        }
    }

    private suspend fun edgarSizeCurve() {
        heading("EDGAR on device  (cold fetch, parse and score by blob size)")
        line("  companyfacts sizes measured 2026-08-24 on a laptop:", MUTED)
        line("  NOK 0.9 MB · AAPL 3.6 MB · JPM 7.5 MB", MUTED)

        val db = Room.inMemoryDatabaseBuilder(applicationContext, OmahaDatabase::class.java).build()
        try {
            for ((ticker, blob) in listOf("NOK" to "0.9 MB", "AAPL" to "3.6 MB", "JPM" to "7.5 MB")) {
                // A fresh engine per ticker, so one interpreter never carries
                // another ticker's heap into the next measurement.
                val engine = StockEngine.fromSource(
                    asset("core/" + StockEngine.BUNDLE_PATH),
                    OkHttpBridge(),
                    RoomStockStore(db.stockCache())
                )

                try {
                    val started = System.nanoTime()
                    val raw = withContext(Dispatchers.IO) { engine.stock(ticker, forceRefresh = true) }
                    val ms = (System.nanoTime() - started) / 1_000_000.0

                    val result = Json.parseToJsonElement(raw) as JsonObject
                    if ((result["ok"] as? JsonPrimitive)?.content != "true") {
                        val error = result["error"] as? JsonObject
                        val kind = (error?.get("kind") as? JsonPrimitive)?.content ?: "unknown"
                        line("  " + ticker.padEnd(5) + blob.padEnd(8) + "SKIP  (" + kind + ")", MUTED)
                        continue
                    }

                    val data = result["data"] as JsonObject
                    val score = (data["health_score"] as? JsonPrimitive)?.content ?: "null"
                    line(
                        String.format(
                            "  %-5s %-8s %6.0f ms   health %s/100, %s measured",
                            ticker, blob, ms, score, coverage(data)
                        )
                    )
                } catch (err: Throwable) {
                    // Recorded rather than thrown. A failure here is a
                    // measurement, and the run should continue to the next size.
                    line(
                        "  " + ticker.padEnd(5) + blob.padEnd(8) +
                            "FAILED  " + err.javaClass.simpleName + ": " +
                            (err.message ?: "").take(80),
                        BAD
                    )
                }
            }
        } finally {
            db.close()
        }

        line(
            NEWLINE + "  These numbers decide whether EDGAR needs a smaller endpoint" +
                NEWLINE + "  on mobile. Report them into docs/14 §3a.",
            MUTED
        )
    }

    /**
     * How many checklist items were actually answered, and how many exist.
     *
     * The length of the checklist is not coverage. JPM is the case that makes
     * the difference visible: EDGAR carries no free cash flow or total debt for
     * a bank, so several checks are genuinely unmeasurable and report
     * NOT_REPORTED rather than a number. Printing only the total read as
     * full coverage, which is the one claim this app exists not to make.
     */
    private fun coverage(data: JsonObject): String {
        val list = data["checklist"] as? JsonArray ?: return "0/0"
        val measured = list.count {
            val status = ((it as? JsonObject)?.get("status") as? JsonPrimitive)?.content
            status != null && status != "NOT_REPORTED"
        }
        return measured.toString() + "/" + list.size
    }

    // ------------------------------------------------------------ helpers

    private fun asset(path: String): String =
        assets.open(path).bufferedReader().use { it.readText() }

    private fun notesFor(dataJson: String, ticker: String): String {
        val theses = (Json.parseToJsonElement(dataJson) as JsonObject)["theses"] as? JsonArray
            ?: return ""
        val thesis = theses.map { it as JsonObject }
            .firstOrNull { (it["ticker"] as? JsonPrimitive)?.content == ticker } ?: return ""
        val entries = thesis["journalEntries"] as? JsonArray ?: return ""
        return entries.joinToString { ((it as JsonObject)["note"] as? JsonPrimitive)?.content ?: "" }
    }

    /** Central to the 16 KB page size question. */
    private fun pageSize(): String = runCatching {
        val bytes = android.system.Os.sysconf(android.system.OsConstants._SC_PAGESIZE)
        (bytes / 1024).toString() + " KB"
    }.getOrElse { "unknown" }

    /** Sorted-key JSON, so key order is never mistaken for a difference. */
    private fun canonical(element: JsonElement): String {
        val sb = StringBuilder()
        write(element, sb)
        return sb.toString()
    }

    private fun write(element: JsonElement, sb: StringBuilder) {
        when (element) {
            is JsonObject -> {
                sb.append("{")
                var first = true
                for (key in element.keys.sorted()) {
                    if (!first) sb.append(",")
                    first = false
                    sb.append(JsonPrimitive(key).toString()).append(":")
                    write(element.getValue(key), sb)
                }
                sb.append("}")
            }
            is JsonArray -> {
                sb.append("[")
                element.forEachIndexed { i, item ->
                    if (i > 0) sb.append(",")
                    write(item, sb)
                }
                sb.append("]")
            }
            else -> sb.append(element.toString())
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    private companion object {
        const val TAG = "OmahaSelfTest"
        const val NEWLINE = "\n"
        const val FUTURE_BACKUP = """{"schemaVersion":99,"theses":[],"watchlists":[]}"""

        val BG = Color.parseColor("#0B0E14")
        val TEXT = Color.parseColor("#F3F5F9")
        val MUTED = Color.parseColor("#94A3B8")
        val ACCENT = Color.parseColor("#38BDF8")
        val GOOD = Color.parseColor("#34D399")
        val BAD = Color.parseColor("#F87171")
    }
}
