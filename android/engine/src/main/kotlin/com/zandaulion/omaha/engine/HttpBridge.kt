package com.zandaulion.omaha.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * The one primitive `core/host/fetch-shim.js` is built on.
 *
 * JSON in, JSON out, because that is all the bridge can carry. The shim
 * reconstructs `fetch`, `Response` and `AbortSignal` on the JavaScript side
 * from this; the host only has to open a socket.
 *
 * Drawn this way so `core/providers/yahoo.js` never learns which host it is
 * running in. It sets a `Cookie` header and a spoofed `User-Agent` — things a
 * browser forbids and OkHttp does not care about — and that asymmetry is
 * exactly why the Android client can talk to Yahoo directly while the PWA
 * needs a proxy. The engine should not have to know that.
 */
fun interface HttpBridge {
    /**
     * @param requestJson `{url, method, headers, body, timeoutMs}`
     * @return `{status, ok, headers, body}`, or `{error}` for a transport
     *   failure — which the shim turns back into a thrown `Error`, so
     *   `yahoo.js` classifies it as an IngestError of kind `network`.
     */
    suspend fun request(requestJson: String): String
}

/** Parsed view of what the shim sends. */
data class HttpRequest(
    val url: String,
    val method: String,
    val headers: Map<String, String>,
    val body: String?,
    val timeoutMs: Long?
) {
    companion object {
        fun parse(json: String): HttpRequest {
            val o = Json.parseToJsonElement(json).jsonObject
            val headers = (o["headers"] as? JsonObject).orEmpty()
                .mapValues { (_, v) -> v.jsonPrimitive.contentOrNull ?: "" }
            return HttpRequest(
                url = o["url"]?.jsonPrimitive?.contentOrNull.orEmpty(),
                method = o["method"]?.jsonPrimitive?.contentOrNull ?: "GET",
                headers = headers,
                body = o["body"]?.jsonPrimitive?.contentOrNull,
                timeoutMs = o["timeoutMs"]?.jsonPrimitive?.intOrNull?.toLong()
            )
        }

        private fun JsonObject?.orEmpty(): Map<String, kotlinx.serialization.json.JsonElement> =
            this ?: emptyMap()
    }
}

/** Build the response the shim expects. */
fun httpResponse(status: Int, headers: Map<String, String>, body: String): String =
    buildJsonObject {
        put("status", JsonPrimitive(status))
        put("headers", buildJsonObject {
            for ((name, value) in headers) put(name, JsonPrimitive(value))
        })
        put("body", JsonPrimitive(body))
    }.toString()

/** Report a transport failure, which the shim rethrows as an `Error`. */
fun httpFailure(message: String): String =
    buildJsonObject { put("error", JsonPrimitive(message)) }.toString()

/**
 * Serves recorded responses and refuses everything else.
 *
 * The device tests replay the same `<TICKER>.http.json` fixtures the Node
 * suites use, so a difference between the two can only come from the engine or
 * the bridge — never from the upstream having moved between runs. A request
 * with no recorded answer fails loudly rather than reaching the network: a test
 * that quietly starts calling Yahoo is a test that passes for the wrong reason.
 *
 * @param fixtureJson the recorded `{key: {status, headers, body}}` map
 */
class ReplayHttpBridge(fixtureJson: String) : HttpBridge {

    private val entries = Json.parseToJsonElement(fixtureJson).jsonObject

    val requested = mutableListOf<String>()

    override suspend fun request(requestJson: String): String {
        val url = HttpRequest.parse(requestJson).url
        val key = classify(url)
        requested += key

        val entry = entries[key]?.jsonObject
            ?: return httpFailure(
                "no recorded response for \"$key\" (${entries.keys.joinToString()})"
            )

        val headers = (entry["headers"] as? JsonObject).orEmpty()
            .mapValues { (_, v) -> v.jsonPrimitive.contentOrNull ?: "" }

        // Recorded bodies are stored parsed where they were JSON, so they have
        // to be re-serialised: the shim hands `yahoo.js` a string, exactly as a
        // real response body would arrive.
        val bodyElement = entry["body"]
        val body = when {
            bodyElement == null -> ""
            bodyElement is JsonPrimitive && bodyElement.isString -> bodyElement.content
            else -> bodyElement.toString()
        }

        return httpResponse(
            status = entry["status"]?.jsonPrimitive?.intOrNull ?: 200,
            headers = headers,
            body = body
        )
    }

    private fun JsonObject?.orEmpty(): Map<String, kotlinx.serialization.json.JsonElement> =
        this ?: emptyMap()

    companion object {
        /**
         * The same classifier `tools/fixture-http.js` uses.
         *
         * Kept deliberately in step with it: a fixture recorded under one set
         * of keys and replayed under another would miss on every request, and
         * the failure would look like a network problem rather than a naming
         * one.
         */
        fun classify(url: String): String = when {
            url.contains("fc.yahoo.com") -> "cookie"
            url.contains("getcrumb") -> "crumb"
            url.contains("fundamentals-timeseries") ->
                if (url.contains("type=quarterly") || url.contains("%2Cquarterly")) {
                    "timeseries:quarterly"
                } else {
                    "timeseries:annual"
                }
            url.contains("quoteSummary") -> "quoteSummary"
            url.contains("recommendationsbysymbol") -> "peers"
            url.contains("/finance/search") -> "search"
            url.contains("/chart/") ->
                if (url.substringBefore("?").contains("%3DX") ||
                    url.substringBefore("?").contains("=X")
                ) "fx" else "chart"
            else -> "other:$url"
        }
    }
}
