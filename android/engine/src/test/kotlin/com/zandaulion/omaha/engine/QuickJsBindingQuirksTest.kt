package com.zandaulion.omaha.engine

import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.FunctionBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Characterisation of two defects in quickjs-kt 1.0.0-alpha13.
 *
 * ScoringEngine works around both. These tests exist so the workarounds are not
 * carried forever out of superstition: when the binding is upgraded, a failure
 * here means the defect is fixed and ScoringEngine can be simplified.
 *
 * Read a failure in this file as good news, and check the note it carries.
 */
class QuickJsBindingQuirksTest {

    /**
     * Defect 1 — every second evaluate on one instance throws
     * `TypeError: cannot read property 'value' of undefined`.
     *
     * Deterministic alternation, independent of payload size and of what the
     * bindings return. This is why ScoringEngine builds a fresh interpreter per
     * call rather than holding one open across scores.
     */
    @Test
    fun `a second evaluate on the same instance still fails`() = runTest {
        val quickJs = QuickJs.create(Dispatchers.Default)
        quickJs.defineBinding("__sink", FunctionBinding { null })

        val outcomes = (1..4).map { i ->
            try {
                quickJs.evaluate<Any?>("__sink('ok');", "q$i.js", true)
                "ok"
            } catch (e: Throwable) {
                "threw"
            }
        }
        quickJs.close()

        assertEquals(
            listOf("ok", "threw", "ok", "threw"),
            outcomes,
            "The alternation changed. If every call now succeeds, ScoringEngine " +
                "no longer needs one interpreter per score."
        )
    }

    /**
     * Defect 2 — a returned string loses one character per non-BMP character.
     *
     * The binding sizes the Kotlin string by code-point count rather than by
     * UTF-16 code-unit count, so each surrogate pair costs one character off the
     * end. It truncates the tail, which for JSON means the closing braces — so
     * it surfaces as a parse error rather than as a visibly wrong character.
     *
     * The emoji are built with fromCharCode so this source stays pure ASCII and
     * cannot itself be mangled in transit.
     */
    @Test
    fun `non-BMP characters still truncate the returned string`() = runTest {
        val quickJs = QuickJs.create(Dispatchers.Default)
        var received: String? = null
        quickJs.defineBinding("__out", FunctionBinding { args ->
            received = args[0] as? String
            null
        })

        // Two surrogate pairs (a gem and a rocket) plus 50 ASCII characters:
        // 54 UTF-16 units, 52 code points.
        quickJs.evaluate<Any?>(
            "__out(String.fromCharCode(0xd83d, 0xdc8e, 0xd83d, 0xde80) + 'x'.repeat(50));",
            "trunc.js",
            true
        )
        quickJs.close()

        assertEquals(
            52,
            received?.length,
            "Expected one character lost per surrogate pair (54 -> 52). If this " +
                "is now 54, the truncation is fixed and ScoringEngine can drop " +
                "the ASCII-escaping bridge and return JSON directly."
        )
    }
}
