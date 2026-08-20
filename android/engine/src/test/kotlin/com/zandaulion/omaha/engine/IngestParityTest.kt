package com.zandaulion.omaha.engine

import kotlinx.coroutines.test.runTest
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Ingestion parity — the same recorded bytes, parsed by the same parser.
 *
 * `core/providers/yahoo.js` runs under QuickJS with `fetch` rebuilt on top of a
 * host socket, replaying the identical `<TICKER>.http.json` fixtures the Node
 * suites replay. Any difference in the result is engine or bridge divergence,
 * because the input bytes and the parser are the same on both sides.
 *
 * This is the half of the engine the scoring gate could not reach: scoring is
 * pure arithmetic on a prepared model, while ingestion is string handling,
 * alias resolution and a session dance with cookies and crumbs.
 */
class IngestParityTest {

    private val coreDir = File("../../core").canonicalFile
    private val fixtures = File(coreDir, "__fixtures__")
    private val tickers = listOf("NOK", "AAPL", "JPM")

    private fun fixture(ticker: String, kind: String) =
        File(fixtures, "$ticker.$kind.json").readText()

    private fun engineFor(ticker: String, bridge: HttpBridge) =
        IngestEngine.create(coreDir, bridge)

    @Test
    fun `every fixture ingests identically to Node`() = runTest {
        for (ticker in tickers) {
            val bridge = ReplayHttpBridge(fixture(ticker, "http"))
            val actual = canonical(parseJson(engineFor(ticker, bridge).ingest(ticker)))
            val expected = canonical(parseJson(fixture(ticker, "ingest")))

            assertEquals(
                expected,
                actual,
                "$ticker ingested differently under QuickJS than under Node. Same " +
                    "bytes, same core/providers/yahoo.js, so this is the bridge."
            )
        }
    }

    @Test
    fun `the session dance actually happens`() = runTest {
        // yahoo.js fetches a cookie, then a crumb, then the data. If the shim
        // silently dropped the cookie header the crumb request would still
        // succeed against a fixture, and the parity assertion alone would not
        // notice — so the call sequence is asserted directly.
        val bridge = ReplayHttpBridge(fixture("NOK", "http"))
        engineFor("NOK", bridge).ingest("NOK")

        assertEquals("cookie", bridge.requested.first(), "expected a session bootstrap first")
        assertTrue(bridge.requested.contains("crumb"), "no crumb was requested")
        assertTrue(bridge.requested.contains("quoteSummary"), "no quote was requested")
        assertTrue(
            bridge.requested.contains("timeseries:annual"),
            "no annual statements were requested"
        )
    }

    @Test
    fun `a currency split is carried through ingestion`() = runTest {
        val bridge = ReplayHttpBridge(fixture("NOK", "http"))
        val out = engineFor("NOK", bridge).ingest("NOK")

        assertTrue(out.contains("\"reportingCurrency\":\"EUR\""), "EUR reporting lost: ${out.take(300)}")
        assertTrue(out.contains("\"currency\":\"USD\""), "USD trading lost")
    }

    @Test
    fun `an unrecorded request fails as a network error rather than reaching out`() = runTest {
        // The guard on the guard. An empty fixture means every call misses, and
        // the shim must turn that into something yahoo.js classifies rather
        // than into a silent success.
        val out = engineFor("NOK", ReplayHttpBridge("{}")).ingest("NOK")

        assertTrue(out.contains("\"ok\":false"), "expected failure, got: ${out.take(300)}")
        assertTrue(
            out.contains("no recorded response"),
            "the bridge's reason should survive to the caller: ${out.take(300)}"
        )
    }
}
