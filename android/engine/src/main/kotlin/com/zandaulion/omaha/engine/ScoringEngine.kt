package com.zandaulion.omaha.engine

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
 * The QuickJS mechanics, and the binding defects they work around, live in
 * [JsBridge].
 */
class ScoringEngine private constructor(private val bridge: JsBridge) {

    /**
     * Score one model.
     *
     * @param inputJson the model object, exactly as `computeComprehensiveHealth`
     *   receives it in Node.
     * @return the returned score object, serialised.
     */
    suspend fun score(inputJson: String): String =
        bridge.call("computeComprehensiveHealth", inputJson)

    companion object {
        /** Where the generated bundle sits, relative to `core/`. */
        const val BUNDLE_PATH = "dist/scoring.bundle.js"

        fun fromSource(
            bundleSource: String,
            dispatcher: CoroutineDispatcher = Dispatchers.Default
        ): ScoringEngine = ScoringEngine(JsBridge(bundleSource, dispatcher))

        /**
         * @param coreDir the repository's `core/` directory. On Android the
         *   bundle comes from assets instead; the source read is identical
         *   either way, which is what keeps the two hosts honest.
         */
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
