package com.zandaulion.omaha.engine

import com.dokar.quickjs.QuickJs
import com.dokar.quickjs.binding.FunctionBinding
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals

/** Which of the two suspects crashes: multiple addModule, or BigInt/DataView? */
class ModuleGraphProbeTest {

    @Test
    fun bigIntAndDataViewAreSupported() = runTest {
        val quickJs = QuickJs.create(Dispatchers.Default)
        var out: String? = null
        quickJs.defineBinding("__out", FunctionBinding { args -> out = args[0] as? String; null })
        quickJs.evaluate<Any?>(
            """
            const dv = new DataView(new ArrayBuffer(8));
            dv.setFloat64(0, 61.555);
            const hi = dv.getUint32(0), lo = dv.getUint32(4);
            const m = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo);
            __out('bigint=' + (m * 10n ** 2n).toString().slice(0, 12) + ' hi=' + hi);
            """.trimIndent(),
            "bigint.js", true
        )
        quickJs.close()
        println("[probe] BigInt/DataView -> $out")
        assertEquals(true, out?.startsWith("bigint="), "got: $out")
    }
}
