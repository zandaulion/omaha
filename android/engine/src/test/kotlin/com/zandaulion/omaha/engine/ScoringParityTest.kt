package com.zandaulion.omaha.engine

import kotlinx.coroutines.test.runTest
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue
import kotlin.time.measureTime

/**
 * Scoring parity — the QuickJS half.
 *
 * The mirror of `test/scoring-parity.test.js` in the repository root. Both run
 * the same `core/scoring.js` against the same fixtures and assert the same
 * output. Any difference between them is *engine* divergence — date parsing,
 * number formatting, `toFixed` rounding — because it is one source file, not
 * two implementations.
 *
 * That is what makes this a measurement rather than an impression, and it is
 * the exit criterion for the QuickJS spike in doc 13 §11.
 *
 * Keep this and the Node test in step. If one grows an allowance the other
 * does not have, the gate stops meaning anything.
 */
class ScoringParityTest {

    private val coreDir = File("../../core").canonicalFile
    private val fixtures = File(coreDir, "__fixtures__")

    private val tickers = listOf("NOK", "AAPL", "JPM")

    private fun fixture(ticker: String, kind: String): String =
        File(fixtures, "$ticker.$kind.json").readText()

    @Test
    fun `core scoring js loads and runs under QuickJS`() = runTest {
        val out = ScoringEngine.create(coreDir).score(fixture("AAPL", "scoring-input"))
        assertTrue(out.isNotBlank(), "engine returned nothing")
        assertTrue(
            out.contains("healthScore"),
            "expected a scored object, got: ${out.take(200)}"
        )
    }

    @Test
    fun `every fixture scores identically to Node`() = runTest {
        for (ticker in tickers) {
            val expected = normalise(fixture(ticker, "scoring-output"))
            val actual = normalise(
                ScoringEngine.create(coreDir).score(fixture(ticker, "scoring-input"))
            )

            assertEquals(
                expected,
                actual,
                "$ticker scored differently under QuickJS than under Node. " +
                    "This is engine divergence, not a logic difference — the " +
                    "same core/scoring.js produced both."
            )
        }
    }

    @Test
    fun `a lender still reports Altman Z as inapplicable`() = runTest {
        // The independent claim, restated on this engine. A null that survives
        // Node but not QuickJS would be the exact failure this gate exists for.
        val out = ScoringEngine.create(coreDir).score(fixture("JPM", "scoring-input"))
        assertTrue(
            Regex(""""altmanZ"\s*:\s*null""").containsMatchIn(out),
            "expected altmanZ to be null for a bank; got: ${out.take(300)}"
        )
    }

    @Test
    fun `startup and scoring cost are recorded`() = runTest {
        // Doc 13 §13 lists cold start as unmeasured. This is the measurement.
        val input = fixture("NOK", "scoring-input")

        val coldStart = measureTime { ScoringEngine.create(coreDir).score(input) }

        // Each call builds its own interpreter (see ScoringEngine), so this is
        // the real per-score cost, not a warm-path figure.
        val engine = ScoringEngine.create(coreDir)
        engine.score(input)
        val perScore = measureTime { repeat(10) { engine.score(input) } } / 10

        println("[spike] QuickJS first score (cold JIT)  : $coldStart")
        println("[spike] QuickJS per score (mean of 10)  : $perScore")

        assertTrue(
            coldStart.inWholeMilliseconds < 5_000,
            "cold start took $coldStart, which would be felt on a deep-dive open"
        )
    }

    /**
     * Compare as parsed values rather than as text: key order and whitespace
     * are not part of the contract, and asserting on them would fail for
     * reasons that do not matter.
     */
    private fun normalise(json: String): String = canonical(parseJson(json))
}
