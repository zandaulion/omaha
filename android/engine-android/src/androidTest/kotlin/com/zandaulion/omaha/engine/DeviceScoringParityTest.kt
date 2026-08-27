package com.zandaulion.omaha.engine

import android.content.res.AssetManager
import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.FunctionBinding
import kotlinx.coroutines.Dispatchers
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.measureTime

/**
 * Scoring parity — on an actual Android runtime.
 *
 * The JVM suite (`:engine`) proved QuickJS executes `core/scoring.js`
 * identically to Node. This one proves the same thing about the *Android*
 * build: a different native artifact, loaded by ART through JNI, reading the
 * engine out of packaged assets rather than off the developer's disk.
 *
 * Three things can only fail here and nowhere else:
 *
 *  - the `.so` failing to load at all, including on a **16 KB page size**
 *    device, which Android 15+ requires and which older native builds do not
 *    satisfy;
 *  - `core/` not actually reaching the assets, the Android equivalent of the
 *    Containerfile that built cleanly and then died on a missing import;
 *  - a divergence between the host and device builds of QuickJS.
 *
 * Fixtures and expectations are the same files the Node and JVM suites use.
 */
class DeviceScoringParityTest {

    private val assets: AssetManager
        get() = InstrumentationRegistry.getInstrumentation().context.assets

    private val tickers = listOf("NOK", "AAPL", "JPM")

    private fun asset(path: String): String =
        assets.open(path).bufferedReader().use { it.readText() }

    /** The generated bundle, as packaged — not as it exists in the repository. */
    private fun scoringSource(): String = asset("core/${ScoringEngine.BUNDLE_PATH}")

    private fun engine() = ScoringEngine.fromSource(scoringSource())

    private fun fixture(ticker: String, kind: String): String = asset("$ticker.$kind.json")

    @Test
    fun coreIsActuallyPackagedIntoAssets() {
        val listed = assets.list("core/dist")?.toList().orEmpty()
        assertTrue(
            "scoring.bundle.js" in listed,
            "the bundle did not reach the assets. Packaged: $listed"
        )
        assertTrue(scoringSource().contains("computeComprehensiveHealth"))

        // The suite that proves the engine must not be shipped inside it.
        assertTrue(
            listed.none { it.endsWith(".test.js") },
            "test files were packaged into the library: $listed"
        )
    }

    @Test
    fun quickJsNativeLibraryLoadsOnThisDevice() = runTest {
        // Fails outright if the .so is missing for this ABI, or is not aligned
        // for a 16 KB page size device.
        val out = engine().score(fixture("AAPL", "scoring-input"))
        assertTrue(out.contains("healthScore"), "got: ${out.take(200)}")
    }

    @Test
    fun everyFixtureScoresIdenticallyOnDevice() = runTest {
        // Scored in full before anything is asserted, for the same reason as
        // the JVM suite: a loop that asserts inside it reports only the first
        // ticker, and "one ticker differs" and "all of them differ" are
        // different diagnoses that were once confused for months.
        val differed = tickers.filter { ticker ->
            canonical(parseJson(fixture(ticker, "scoring-output"))) !=
                canonical(parseJson(engine().score(fixture(ticker, "scoring-input"))))
        }

        if (differed.isEmpty()) return@runTest

        val ticker = differed.first()
        assertEquals(
            canonical(parseJson(fixture(ticker, "scoring-output"))),
            canonical(parseJson(engine().score(fixture(ticker, "scoring-input")))),
            "Differed from Node: ${differed.joinToString()} (of ${tickers.joinToString()}). " +
                "The diff below is $ticker's. Same core/scoring.js, so this is " +
                "engine or platform divergence."
        )
    }

    @Test
    fun aLenderStillReportsAltmanZAsInapplicable() = runTest {
        val out = engine().score(fixture("JPM", "scoring-input"))
        assertTrue(
            Regex(""""altmanZ"\s*:\s*null""").containsMatchIn(out),
            "expected altmanZ to be null for a bank; got: ${out.take(300)}"
        )
    }

    @Test
    fun scoringCostIsRecorded() = runTest {
        val input = fixture("NOK", "scoring-input")

        val cold = measureTime { engine().score(input) }
        val warm = engine()
        warm.score(input)
        val perScore = measureTime { repeat(10) { warm.score(input) } } / 10

        // Read these as an order of magnitude, not a phone number: an x86_64
        // emulator on a desktop CPU is not an ARM handset. What they do settle
        // is whether scoring is milliseconds or seconds.
        println("[device] abi                : ${android.os.Build.SUPPORTED_ABIS.joinToString()}")
        println("[device] api                : ${android.os.Build.VERSION.SDK_INT}")
        println("[device] first score        : $cold")
        println("[device] per score (mean 10): $perScore")

        assertTrue(cold.inWholeSeconds < 5, "first score took $cold")
    }

    /**
     * Where does the Android build of QuickJS round a tie?
     *
     * Node and the JVM build of QuickJS agree on every case here. If this
     * device disagrees, the divergence is in the platform, not in core/.
     */
    @Test
    fun recordHowThisEngineRoundsToFixedTies() = runTest {
        val quickJs = QuickJs.create(Dispatchers.Default)
        var line: String? = null
        quickJs.defineBinding("__out", FunctionBinding { args ->
            line = args[0] as? String
            null
        })
        quickJs.evaluate<Any?>(TO_FIXED_PROBE_JS, "tofixed.js", true)
        quickJs.close()
        // Asserted rather than printed: instrumented stdout does not reach the
        // Gradle report, and a failure message does.
        // Characterisation, not a demand. This asserts what Android's QuickJS
        // *does*, which is round ties to even where Node and the JVM build
        // round away from zero, as the spec requires. core/ no longer relies on
        // toFixed for exactly this reason — see core/format.js.
        //
        // A failure here is good news: the platform was fixed, and core/format
        // could in principle go back to the built-in.
        assertEquals(
            "4.25.toFixed(1)=4.2  0.125.toFixed(2)=0.12  2.5.toFixed(0)=2  " +
                "1.005.toFixed(2)=1.00  8.75.toFixed(1)=8.8  3.375.toFixed(2)=3.38",
            line,
            "Android toFixed behaviour changed. abi=" +
                android.os.Build.SUPPORTED_ABIS.joinToString() +
                " api=" + android.os.Build.VERSION.SDK_INT
        )
    }
}
