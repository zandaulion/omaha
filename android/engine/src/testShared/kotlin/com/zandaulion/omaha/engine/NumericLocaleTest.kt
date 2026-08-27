package com.zandaulion.omaha.engine

import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.FunctionBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * QuickJS must read a decimal point as a decimal point.
 *
 * ## What this is guarding against
 *
 * The native library reaches libc for decimal conversion, and glibc's `strtod`
 * and `snprintf` honour `LC_NUMERIC`. On a host whose locale uses a **comma**
 * as the decimal separator, `strtod("8.5")` stops at the `.` and returns `8`.
 * Not an error and not a NaN — a plausible, wrong, smaller number.
 *
 * It corrupts everything at once: source literals in the bundle, `JSON.parse`,
 * `parseFloat`, `Number()`. `0.1 + 0.2` evaluates to `0`. And it corrupts the
 * other direction too — `(8.5).toFixed(2)` comes back as `"8,00"`, which is not
 * valid JSON and is the string a person would have read on screen.
 *
 * ## Why it earns its own test rather than being left to the parity suite
 *
 * The parity suite does catch it, but it catches it as 116 differing fields
 * across five pillars, a DCF that declines to run and an Altman Z of zero —
 * which reads exactly like an engine that has gone wrong. It cost an
 * investigation of `core/scoring.js`, of the bundle, of the fixtures and of the
 * pinned binding version, none of which were at fault. Six assertions that fail
 * with the word `LC_NUMERIC` in them are worth more than the whole diff.
 *
 * ## The two halves of the fix
 *
 * `android/build.gradle.kts` sets `LC_NUMERIC=C` on every JVM test process, so
 * a Gradle run is correct regardless of the host. This file is what catches a
 * run that bypassed it — from an IDE, or from a future CI image whose test
 * task is configured elsewhere.
 *
 * **On Android this asserts a platform property rather than a workaround.**
 * Bionic implements only the C locale, so `LC_NUMERIC` cannot be set to
 * anything else on a device and the shipped app was never exposed. That is a
 * claim worth measuring rather than repeating, which is why this lives in
 * `testShared` and runs on both targets.
 */
class NumericLocaleTest {

    private suspend fun evaluate(expression: String): String {
        val quickJs = QuickJs.create(Dispatchers.Default)
        var result = "<nothing>"
        try {
            quickJs.defineBinding(
                "__out",
                FunctionBinding { args -> result = args.firstOrNull() as? String ?: "<null>"; null }
            )
            quickJs.evaluate<Any?>("__out(String($expression));", "locale-probe.js", false)
        } finally {
            quickJs.close()
        }
        return result
    }

    private fun assertNumeric(expected: String, actual: String, what: String) {
        assertEquals(
            expected,
            actual,
            "$what came back as \"$actual\".\n\n" +
                "QuickJS is reading the decimal separator from the C library " +
                "locale. Set LC_NUMERIC=C for this process — Gradle already " +
                "does, so this is most likely an IDE or CI run that bypassed " +
                "it. Nothing is wrong with core/ or with the fixtures; every " +
                "decimal in the engine is being truncated at the point."
        )
    }

    @Test
    fun `a decimal literal in source keeps its fraction`() = runTest {
        assertNumeric("8.5", evaluate("8.5"), "The literal 8.5")
        // Two literals, so a failure here cannot be read as one unlucky value.
        assertNumeric("0.30000000000000004", evaluate("0.1 + 0.2"), "0.1 + 0.2")
    }

    @Test
    fun `JSON parse keeps its fraction`() = runTest {
        // The path every fixture, every cached record and every API response
        // takes into the engine.
        assertNumeric("8.5", evaluate("""JSON.parse('{"a":8.5}').a"""), "JSON.parse of 8.5")
    }

    @Test
    fun `string to number conversions keep their fraction`() = runTest {
        assertNumeric("8.5", evaluate("parseFloat('8.5')"), "parseFloat('8.5')")
        assertNumeric("8.5", evaluate("Number('8.5')"), "Number('8.5')")
    }

    @Test
    fun `toFixed emits a point and not a comma`() = runTest {
        // The output half. core/format.js runs every displayed number through
        // toFixed, so a comma here reaches both the interface and the JSON
        // crossing the bridge — where it is a parse error rather than a typo.
        assertNumeric("8.50", evaluate("(8.5).toFixed(2)"), "(8.5).toFixed(2)")
    }
}
