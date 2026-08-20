package com.zandaulion.omaha.engine

import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.FunctionBinding
import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import java.io.File

/**
 * Runs the shared scoring engine — `core/scoring.js`, unmodified — inside
 * QuickJS.
 *
 * This is the point of the architecture in doc 13: the 1,422 lines that decide
 * what every number in the app means exist once, in one language, and both the
 * PWA and this app execute that same file. A Kotlin port would be a second
 * definition of the same thing, and the two would diverge in exactly the edge
 * cases the engine is careful about — an unmeasurable metric, a ratio that does
 * not apply to a lender — where a wrong answer still looks like a plausible
 * number.
 *
 * Nothing here interprets the model. Kotlin hands JSON in and takes JSON out;
 * the meaning stays on the JavaScript side.
 *
 * ## Two defects in quickjs-kt 1.0.0-alpha13 are worked around here
 *
 * **Non-BMP characters truncate the result.** The binding sizes the returned
 * Kotlin string by code-point count rather than by UTF-16 code-unit count, so
 * every surrogate pair costs one character off the *end* of the string.
 * Measured exactly: a result containing two emoji came back two characters
 * short, one emoji one character short. That matters here because the scoring
 * output is full of emoji — 💎 and 🚀 in catalysts, ⚠️ in risks — and the
 * damage lands on the closing braces, so the failure surfaces as unparseable
 * JSON rather than as a wrong character. The fix is to let nothing but ASCII
 * cross the bridge: the JavaScript side escapes every non-ASCII code unit as
 * `\uXXXX`, which is valid JSON, and parsing on this side restores it.
 *
 * **A second module crashes the process.** `addModule` called twice on one
 * instance faults in native code — `EXCEPTION_ACCESS_VIOLATION`, not a
 * catchable exception. So `core/` is flattened into a single ES module by
 * `tools/bundle-core.mjs` before it ever reaches here. This is the defect that
 * only the device work surfaced, and it is why doc 13's original claim that
 * `core/` "needs no bundler" was wrong.
 *
 * **A second evaluate on the same instance fails.** Calls alternate
 * deterministically — first succeeds, second throws `TypeError: cannot read
 * property 'value' of undefined`, third succeeds — independent of payload size
 * and of what the bindings return. So each scoring run gets its own
 * interpreter. Measure before assuming that is expensive; see
 * `ScoringParityTest`.
 *
 * Both are worth revisiting when the binding reaches a stable release, since
 * both cost something: the escaping inflates the bridge payload, and a fresh
 * interpreter per call throws away any warm state.
 */
class ScoringEngine private constructor(
    private val scoringSource: String,
    private val dispatcher: CoroutineDispatcher
) {

    /**
     * Score one model.
     *
     * @param inputJson the model object, exactly as `computeComprehensiveHealth`
     *   receives it in Node.
     * @return the returned score object, serialised.
     */
    suspend fun score(inputJson: String): String {
        var result: String? = null

        val quickJs = QuickJs.create(dispatcher)
        try {
            quickJs.defineBinding("__omahaInput", FunctionBinding { inputJson })
            quickJs.defineBinding(
                "__omahaResult",
                FunctionBinding { args ->
                    result = args.firstOrNull() as? String
                    null
                }
            )

            // Exactly one module, always. A second addModule on the same
            // instance crashes the process — see the class comment — which is
            // why core/ arrives pre-bundled rather than as a graph.
            quickJs.addModule(MODULE_NAME, scoringSource)

            quickJs.evaluate<Any?>(DRIVER, "omaha-call.js", true)
        } finally {
            quickJs.close()
        }

        return result ?: error("scoring.js returned nothing for the supplied model")
    }

    companion object {
        private const val MODULE_NAME = "omaha-scoring"

        /**
         * `asciiSafe` escapes every code unit above 0x7F individually, which
         * includes each half of a surrogate pair. That is well-formed JSON —
         * `JSON.parse` recombines the halves — and it keeps the bridge free of
         * the non-BMP characters the binding mishandles.
         *
         * This is a Kotlin raw string, which performs no escape processing, so
         * the sequences below reach JavaScript exactly as written.
         */
        private val DRIVER = """
            import { computeComprehensiveHealth } from "${MODULE_NAME}";

            const asciiSafe = (s) =>
                s.replace(/[\u0080-\uffff]/g, (c) =>
                    '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));

            const scored = computeComprehensiveHealth(JSON.parse(__omahaInput()));
            __omahaResult(asciiSafe(JSON.stringify(scored)));
        """.trimIndent()

        /**
         * @param scoringSource the contents of `core/scoring.js`.
         *
         * A string rather than a path, because the two hosts get at it
         * differently — a file on the JVM, an asset on Android — and neither
         * difference should reach the engine.
         */
        /** Where the generated bundle sits, relative to `core/`. */
        const val BUNDLE_PATH = "dist/scoring.bundle.js"

        fun fromSource(
            scoringSource: String,
            dispatcher: CoroutineDispatcher = Dispatchers.Default
        ): ScoringEngine = ScoringEngine(scoringSource, dispatcher)

        /** Convenience for hosts that do have a real directory. */
        fun create(
            coreDir: File,
            dispatcher: CoroutineDispatcher = Dispatchers.Default
        ): ScoringEngine {
            val bundle = File(coreDir, BUNDLE_PATH)
            require(bundle.isFile) {
                "${bundle.absolutePath} not found. Run `npm run bundle:core`."
            }
            return fromSource(bundle.readText(), dispatcher)
        }
    }
}
