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
import com.zandaulion.omaha.data.OmahaDatabase
import com.zandaulion.omaha.data.PersonalDataStore
import com.zandaulion.omaha.engine.BackupEngine
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
            scoringChecks()
            backupChecks()
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
