package com.zandaulion.omaha.engine

import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.FunctionBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** Regression coverage for binding defects found in quickjs-kt 1.0.0-alpha13. */
class QuickJsBindingQuirksTest {

    /**
     * Alpha13 failed every second evaluate on one instance. Version 1.0.15
     * repaired that lifecycle, so repeated calls must remain usable.
     */
    @Test
    fun `repeated evaluates on one instance succeed`() = runTest {
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

        assertEquals(listOf("ok", "ok", "ok", "ok"), outcomes)
    }

    /**
     * Alpha13 truncated one UTF-16 code unit from the tail for every non-BMP
     * character. Version 1.0.15 must preserve both surrogate pairs and the full
     * ASCII suffix. The emoji are built in JavaScript so the source crossing
     * the bridge remains ASCII.
     */
    @Test
    fun `non-BMP characters and the complete suffix cross the bridge`() = runTest {
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

        assertEquals("💎🚀" + "x".repeat(50), received)
        assertEquals(54, received?.length)
    }

    /**
     * Where does this engine round a tie?
     *
     * Not a defect report — a measurement. The answer decides whether core/
     * can rely on toFixed at all, or has to round deterministically itself.
     */
    @Test
    fun `record how this engine rounds toFixed ties`() = runTest {
        val quickJs = QuickJs.create(Dispatchers.Default)
        var line: String? = null
        quickJs.defineBinding("__out", FunctionBinding { args ->
            line = args[0] as? String
            null
        })
        quickJs.evaluate<Any?>(TO_FIXED_PROBE_JS, "tofixed.js", true)
        quickJs.close()
        println("[tofixed/jvm-quickjs] $line")
    }
}
