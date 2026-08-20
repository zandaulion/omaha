package com.zandaulion.omaha.data

import androidx.room.Room
import androidx.test.platform.app.InstrumentationRegistry
import com.zandaulion.omaha.engine.ReplayHttpBridge
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonObject
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The whole pipeline on device: cache check, fetch, assemble, score, persist.
 *
 * Replays the same `<TICKER>.http.json` fixtures the Node suites replay and
 * asserts the scored model matches `<TICKER>.model.json` byte for byte. Since
 * the bytes and the engine are identical on both sides, a difference can only
 * come from the bridges — the socket, the store, or the JSON crossing between
 * them.
 *
 * This is the last of the three: scoring was proved first, ingestion second,
 * and this closes the loop by adding the storage the other two did not need.
 */
class StockPipelineTest {

    private lateinit var db: OmahaDatabase
    private lateinit var store: RoomStockStore

    private val context get() = InstrumentationRegistry.getInstrumentation().context

    private fun asset(path: String) =
        context.assets.open(path).bufferedReader().use { it.readText() }

    private fun engineFor(ticker: String, bridge: ReplayHttpBridge) =
        StockEngine.fromSource(
            asset("core/${StockEngine.BUNDLE_PATH}"),
            bridge,
            store,
            logger = { _, _ -> }
        )

    @BeforeTest
    fun open() {
        db = Room.inMemoryDatabaseBuilder(
            InstrumentationRegistry.getInstrumentation().targetContext,
            OmahaDatabase::class.java
        ).build()
        store = RoomStockStore(db.stockCache())
    }

    @AfterTest
    fun close() = db.close()

    @Test
    fun everyFixtureProducesTheSameModelAsNode() = runTest {
        for (ticker in listOf("NOK", "AAPL", "JPM")) {
            db.stockCache().clear()

            val bridge = ReplayHttpBridge(asset("$ticker.http.json"))
            val raw = engineFor(ticker, bridge).stock(ticker, forceRefresh = true)
            val result = Json.parseToJsonElement(raw).jsonObject

            assertTrue(
                (result["ok"] as? JsonPrimitive)?.content == "true",
                "$ticker failed: ${result["error"]}"
            )

            val actual = canonical(stripVolatile(result["data"]!!))
            val expected =
                canonical(stripVolatile(Json.parseToJsonElement(asset("$ticker.model.json"))))

            assertEquals(
                expected,
                actual,
                "$ticker scored differently on device. Same bytes, same engine, " +
                    "so the difference is in a bridge."
            )
        }
    }

    @Test
    fun aSecondCallIsServedFromTheCacheWithoutTouchingTheNetwork() = runTest {
        db.stockCache().clear()

        val first = ReplayHttpBridge(asset("NOK.http.json"))
        engineFor("NOK", first).stock("NOK", forceRefresh = true)
        assertTrue(first.requested.isNotEmpty(), "the first call should have fetched")

        // A fixture that answers nothing: if the cache tiers work, the second
        // call never asks. This is the fifteen-minute quote tier — the one that
        // had never functioned in the PWA because of local-time parsing.
        val second = ReplayHttpBridge("{}")
        val raw = engineFor("NOK", second).stock("NOK")
        val result = Json.parseToJsonElement(raw).jsonObject

        assertTrue(
            (result["ok"] as? JsonPrimitive)?.content == "true",
            "the cached read failed: ${result["error"]}"
        )
        assertEquals(
            emptyList(), second.requested,
            "a fresh cache entry must not be re-fetched"
        )
    }

    @Test
    fun aRateLimitServesStaleDataRatherThanFailing() = runTest {
        db.stockCache().clear()

        engineFor("NOK", ReplayHttpBridge(asset("NOK.http.json"))).stock("NOK", forceRefresh = true)

        // Forced refresh with nothing available: the cached copy must still be
        // served, marked stale, rather than the call failing outright.
        val blocked = ReplayHttpBridge("{}")
        val raw = engineFor("NOK", blocked).stock("NOK", forceRefresh = true)
        val result = Json.parseToJsonElement(raw).jsonObject

        assertTrue(
            (result["ok"] as? JsonPrimitive)?.content == "true",
            "expected stale data, got: ${result["error"]}"
        )
        val data = result["data"]!!.jsonObject
        assertEquals("true", (data["stale"] as? JsonPrimitive)?.content, "not marked stale")
        assertEquals(
            "network", (data["staleReason"] as? JsonPrimitive)?.content,
            "the reason should reach the caller so it can back off"
        )
    }

    @Test
    fun anUnknownTickerIsReportedAsNotFoundRatherThanInvented() = runTest {
        db.stockCache().clear()
        val raw = engineFor("ZZZZ", ReplayHttpBridge("{}")).stock("ZZZZ", forceRefresh = true)
        val result = Json.parseToJsonElement(raw).jsonObject

        assertEquals("false", (result["ok"] as? JsonPrimitive)?.content)
        val kind = (result["error"]!!.jsonObject["kind"] as? JsonPrimitive)?.content
        assertTrue(
            kind == "network" || kind == "not_found",
            "expected an honest failure, got kind=$kind"
        )
    }

    // ------------------------------------------------------------ helpers

    /**
     * Drop the two timestamps the store owns, rather than redacting them.
     *
     * They move every run, so they cannot be compared — but removing beats
     * substituting, because the two hosts disagree about whether the key is
     * even present. On a fresh fetch neither sets one: `formatCachedStock`
     * returns the in-memory record, whose timestamp is `undefined`. Node's
     * fixture normaliser materialises that key and `JSON.stringify` drops it,
     * so redaction compared a present key against an absent one and called it
     * a scoring difference.
     *
     * Nothing is lost by removing them. That the timestamps are read and
     * written correctly is what the cache-tier test proves, and it proves it
     * far better than an equality check on a redacted placeholder could.
     */
    private fun stripVolatile(element: JsonElement): JsonElement = when (element) {
        is JsonObject -> JsonObject(
            element
                .filterKeys { it != "last_fetched_at" && it != "financials_fetched_at" }
                .mapValues { (_, value) -> stripVolatile(value) }
        )
        is JsonArray -> JsonArray(element.map { stripVolatile(it) })
        else -> element
    }

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
}
