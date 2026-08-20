package com.zandaulion.omaha.engine

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import java.io.File

/**
 * Reads filings and quotes using `core/providers/`, unmodified, over a host
 * socket.
 *
 * The parser that turns Yahoo's timeseries envelopes into statements is 472
 * lines of accumulated knowledge about which fields are aliases, which filers
 * omit which lines, and which "empty" responses are real answers. Rewriting it
 * in Kotlin would be rewriting all of that, and the mistakes would be invisible
 * — a field resolved to the wrong alias still produces a plausible number.
 *
 * The network arrives through [HttpBridge] and is reassembled into `fetch` by
 * `core/host/fetch-shim.js`, so nothing in `core/` learns what host it is in.
 */
class IngestEngine private constructor(private val bridge: JsBridge) {

    /**
     * Fetch and parse one ticker.
     *
     * @return `{ok, ticker, quote, statements}` on success, or
     *   `{ok: false, error: {kind, message, ...}}`. Failures come back as a
     *   value rather than an exception because ingestion failing is ordinary —
     *   a rate limit, a dead symbol — and `kind` is what the caller acts on.
     */
    suspend fun ingest(ticker: String): String = bridge.call("ingest", jsonString(ticker))

    companion object {
        const val BUNDLE_PATH = "dist/ingest.bundle.js"

        fun fromSource(
            bundleSource: String,
            http: HttpBridge,
            dispatcher: CoroutineDispatcher = Dispatchers.Default
        ): IngestEngine = IngestEngine(
            JsBridge(
                bundleSource,
                dispatcher,
                mapOf("__httpFetch" to { args -> http.request(args[0] as String) })
            )
        )

        fun create(
            coreDir: File,
            http: HttpBridge,
            dispatcher: CoroutineDispatcher = Dispatchers.Default
        ): IngestEngine {
            val bundle = File(coreDir, BUNDLE_PATH)
            require(bundle.isFile) {
                "${bundle.absolutePath} not found. Run `npm run bundle:core`."
            }
            return fromSource(bundle.readText(), http, dispatcher)
        }
    }
}
