package com.zandaulion.omaha.engine

import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.AsyncFunctionBinding
import com.dokar.quickjs.binding.FunctionBinding
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers

/**
 * Calls one exported function of a bundled `core/` module inside QuickJS.
 *
 * JSON in, JSON out. Kotlin never interprets what it is passing: the meaning
 * stays on the JavaScript side, where there is exactly one implementation of
 * it that the PWA runs too. A Kotlin port of any of this would be a second
 * definition of the same rules, and the two would diverge precisely in the
 * edge cases each is careful about.
 *
 * ## Three defects in quickjs-kt 1.0.0-alpha13 are worked around here
 *
 * **A second module crashes the process.** `addModule` called twice on one
 * instance faults in native code — `EXCEPTION_ACCESS_VIOLATION`, not a
 * catchable exception. So `core/` arrives pre-flattened by
 * `tools/bundle-core.mjs`, one bundle per module, and each bundle gets an
 * interpreter to itself.
 *
 * **A second evaluate on one instance fails.** Calls alternate
 * deterministically — first succeeds, second throws `TypeError: cannot read
 * property 'value' of undefined`, third succeeds — regardless of payload size
 * or what the bindings return. Hence a fresh interpreter per call. Measured at
 * a few milliseconds, which is affordable; see `ScoringParityTest`.
 *
 * **Non-BMP characters truncate the result.** The binding sizes the returned
 * Kotlin string by code-point count rather than UTF-16 code-unit count, so
 * every surrogate pair costs one character off the *end* of the string. This
 * app is squarely in the blast radius — scoring output carries 💎 and 🚀 in
 * catalysts, ⚠️ in risks — and the loss lands on the closing braces, so it
 * surfaces as unparseable JSON rather than a visibly wrong character. Nothing
 * but ASCII therefore crosses the bridge: the JavaScript side escapes every
 * non-ASCII code unit as `\uXXXX`, which is still valid JSON.
 *
 * `QuickJsBindingQuirksTest` pins the last two. A failure there is good news.
 */
class JsBridge(
    private val moduleSource: String,
    private val dispatcher: CoroutineDispatcher = Dispatchers.Default,
    /**
     * Suspending functions the module may call back into.
     *
     * This is how `core/` reaches anything the host owns — a socket, a
     * database — without knowing what the host is. `core/host/fetch-shim.js`
     * rebuilds `fetch` on top of one such function, so the network arrives as
     * a web API rather than as a Kotlin abstraction leaking into the engine.
     */
    private val hostFunctions: Map<String, suspend (Array<Any?>) -> String> = emptyMap(),
    /**
     * Where `console` output goes.
     *
     * QuickJS has no `console`, and `core/` uses it — `yahoo.js` warns when a
     * quarterly series is missing or a session cannot be established. Without
     * a shim those paths throw `'console' is not defined`, turning a handled
     * degradation into a hard failure. Scoring never logs, which is why this
     * only appeared once ingestion ran.
     */
    private val logger: (String, String) -> Unit = { _, _ -> }
) {

    /**
     * Invoke `fn`, exported by the module, with JSON-encoded arguments.
     *
     * @param fn name of an exported function
     * @param jsonArgs each a complete JSON value; they are spliced into an
     *   array literal, so a caller passing a bare string must quote it
     * @return the JSON-encoded return value, or an empty string for `undefined`
     */
    suspend fun call(fn: String, vararg jsonArgs: String): String {
        var result: String? = null
        var failure: String? = null

        val quickJs = QuickJs.create(dispatcher)
        try {
            quickJs.defineBinding("__omahaFn", FunctionBinding { fn })
            quickJs.defineBinding(
                "__omahaArgs",
                FunctionBinding { jsonArgs.joinToString(prefix = "[", postfix = "]") }
            )
            quickJs.defineBinding(
                "__omahaResult",
                FunctionBinding { args -> result = args.firstOrNull() as? String; null }
            )
            quickJs.defineBinding(
                "__omahaError",
                FunctionBinding { args -> failure = args.firstOrNull() as? String; null }
            )

            quickJs.defineBinding(
                "__omahaLog",
                FunctionBinding { args ->
                    logger(
                        args.getOrNull(0) as? String ?: "log",
                        args.getOrNull(1) as? String ?: ""
                    )
                    null
                }
            )

            for ((name, implementation) in hostFunctions) {
                quickJs.defineBinding(name, object : AsyncFunctionBinding<String> {
                    override suspend fun invoke(args: Array<Any?>): String =
                        implementation(args)
                })
            }

            quickJs.addModule(MODULE_NAME, moduleSource)
            quickJs.evaluate<Any?>(DRIVER, "omaha-call.js", true)
        } finally {
            quickJs.close()
        }

        failure?.let { throw JsBridgeException("$fn: $it") }
        return result ?: throw JsBridgeException("$fn returned nothing")
    }

    companion object {
        private const val MODULE_NAME = "omaha-module"

        /**
         * Errors are reported through a binding rather than thrown out of the
         * evaluation. A JavaScript exception crossing this boundary arrives as
         * a QuickJsException whose message loses the original text, and the
         * whole point of `core/`'s typed errors is that the caller can read
         * them.
         */
        private val DRIVER = """
            import * as omahaModule from "$MODULE_NAME";

            const asciiSafe = (s) =>
                s.replace(/[\u0080-\uffff]/g, (c) =>
                    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

            if (typeof globalThis.console === 'undefined') {
                const emit = (level) => (...args) => __omahaLog(
                    level,
                    args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')
                );
                globalThis.console = {
                    log: emit('log'), info: emit('info'), warn: emit('warn'),
                    error: emit('error'), debug: emit('debug')
                };
            }

            try {
                const fn = __omahaFn();
                const target = omahaModule[fn];
                if (typeof target !== 'function') {
                    throw new Error('no exported function named ' + fn);
                }
                // Awaited because an entry point may be async — ingestion is.
                // Without this a Promise would serialise as {} and the caller
                // would receive an empty object reported as success.
                const out = await target(...JSON.parse(__omahaArgs()));
                __omahaResult(out === undefined ? '' : asciiSafe(JSON.stringify(out)));
            } catch (err) {
                __omahaError(asciiSafe(String((err && err.message) || err)));
            }
        """.trimIndent()
    }
}

/** A failure reported from inside the module, carrying its original message. */
class JsBridgeException(message: String) : RuntimeException(message)

/**
 * A bare string, as a JSON value the bridge can splice into its argument list.
 *
 * The strings crossing this boundary are tickers and ISO timestamps, which by
 * construction hold nothing JSON needs escaped. Checked rather than assumed,
 * and checked rather than escaped: a hand-rolled escaper would be a liability
 * out of all proportion to the values it handles.
 */
internal fun jsonString(value: String): String {
    require(value.none { it == '"' || it == '\\' || it < ' ' }) {
        "Expected a plain value with no JSON metacharacters, got: $value"
    }
    return "\"" + value + "\""
}
