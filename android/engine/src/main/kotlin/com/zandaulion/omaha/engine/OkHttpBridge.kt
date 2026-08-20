package com.zandaulion.omaha.engine

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * The real socket behind [HttpBridge].
 *
 * Note what it does *not* do: no cookie jar, no redirect rewriting, no header
 * of its own. `core/providers/yahoo.js` manages its own session — it fetches a
 * cookie, extracts a crumb, and replays both — and a client that helpfully
 * managed cookies would quietly break that by consuming the `Set-Cookie` this
 * engine needs to read.
 *
 * Setting `Cookie` and `User-Agent` is the whole reason an Android client can
 * talk to Yahoo directly. A browser refuses both as forbidden headers, and
 * Yahoo sends no CORS headers, which is why the PWA needs a server and this
 * does not.
 */
class OkHttpBridge(
    private val client: OkHttpClient = defaultClient()
) : HttpBridge {

    override suspend fun request(requestJson: String): String = withContext(Dispatchers.IO) {
        val spec = HttpRequest.parse(requestJson)

        val builder = Request.Builder().url(spec.url)
        for ((name, value) in spec.headers) builder.header(name, value)
        if (spec.method.equals("GET", ignoreCase = true)) {
            builder.get()
        } else {
            builder.method(spec.method, null)
        }

        // The deadline travels per request because yahoo.js sets a different
        // one for each call — nine seconds for statements, four for search.
        val call = spec.timeoutMs
            ?.let { client.newBuilder().callTimeout(it, TimeUnit.MILLISECONDS).build() }
            ?.newCall(builder.build())
            ?: client.newCall(builder.build())

        try {
            call.execute().use { response ->
                val headers = buildMap {
                    for (name in response.headers.names()) {
                        // Set-Cookie can repeat, and the session dance needs
                        // them together; joining matches what a browser's
                        // headers.get() returns.
                        put(name, response.headers.values(name).joinToString(", "))
                    }
                }
                httpResponse(
                    status = response.code,
                    headers = headers,
                    body = response.body?.string().orEmpty()
                )
            }
        } catch (err: IOException) {
            // Reported as a value, not thrown: the shim turns this into a
            // thrown Error inside JavaScript, where yahoo.js classifies it as
            // an IngestError of kind 'network' and the caller can back off.
            httpFailure(err.message ?: err.javaClass.simpleName)
        }
    }

    companion object {
        fun defaultClient(): OkHttpClient = OkHttpClient.Builder()
            .followRedirects(true)
            // No cookie jar on purpose — see the class comment.
            .connectTimeout(10, TimeUnit.SECONDS)
            .readTimeout(15, TimeUnit.SECONDS)
            .build()
    }
}
