package com.zandaulion.omaha.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.double
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.contentOrNull
import java.io.File
import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The gate on the project's only deliberate second implementation.
 *
 * `core/analysis/dcf.js` is the definition; `Dcf.kt` exists because the sandbox
 * recomputes on every slider frame and a QuickJS round trip costs about 21 ms.
 * These vectors are the JS module's own output, recorded by
 * `scripts/gen-dcf-vectors.mjs`, so a change to the model that is not mirrored
 * in Kotlin fails here rather than shipping two fair values for one company.
 *
 * Compared to 1e-9 relative rather than exactly. Both sides do the same
 * arithmetic on IEEE 754 doubles, which is identical across engines — it is
 * decimal *formatting* that is not portable, and neither side formats here.
 */
class DcfParityTest {

    private val vectors: List<JsonObject> by lazy {
        // Resolved from the module directory, since Gradle runs tests with the
        // module as the working directory rather than the repository root.
        val file = File("../../core/__fixtures__/dcf.vectors.json")
        assertTrue(file.exists(), "missing ${file.absolutePath} — run scripts/gen-dcf-vectors.mjs")
        Json.parseToJsonElement(file.readText()).jsonObject["vectors"]!!.jsonArray.map { it.jsonObject }
    }

    private fun near(expected: Double, actual: Double, what: String) {
        val scale = maxOf(abs(expected), 1.0)
        assertTrue(
            abs(expected - actual) / scale < 1e-9,
            "$what: expected $expected, got $actual"
        )
    }

    @Test
    fun `every recorded case is reproduced`() {
        assertTrue(vectors.isNotEmpty(), "no vectors recorded")

        for (v in vectors) {
            val name = v["name"]!!.jsonPrimitive.content
            val input = v["input"]!!.jsonObject
            val assumptions = input["assumptions"]!!.jsonObject

            val baselines = Dcf.baselines(
                growthRate = assumptions["growthRate"]?.jsonPrimitive?.double,
                terminalMultiple = assumptions["terminalMultiple"]?.jsonPrimitive?.double,
                discountRate = assumptions["discountRate"]?.jsonPrimitive?.double
            )
            val expectedBaselines = v["baselines"]!!.jsonObject
            assertEquals(
                expectedBaselines["growthPct"]!!.jsonPrimitive.int, baselines.growthPct,
                "$name baseline growth"
            )
            near(expectedBaselines["multiple"]!!.jsonPrimitive.double, baselines.multiple, "$name baseline multiple")
            near(expectedBaselines["discountPct"]!!.jsonPrimitive.double, baselines.discountPct, "$name baseline discount")

            val cashFlowBase = input["cashFlowBase"]!!.jsonPrimitive.double
            val shares = input["shares"]!!.jsonPrimitive.double
            val netCash = input["netCash"]!!.jsonPrimitive.double
            val price = input["price"]!!.jsonPrimitive.double

            val presets = v["presets"]!!.jsonObject
            for (preset in listOf("bear", "base", "bull")) {
                val expected = presets[preset]!!.jsonObject
                val ea = expected["assumptions"]!!.jsonObject

                val a = Dcf.preset(preset, baselines)
                assertEquals(ea["growthPct"]!!.jsonPrimitive.int, a.growthPct, "$name/$preset growth")
                near(ea["multiple"]!!.jsonPrimitive.double, a.multiple, "$name/$preset multiple")
                near(ea["discountPct"]!!.jsonPrimitive.double, a.discountPct, "$name/$preset discount")

                val p = Dcf.project(cashFlowBase, shares, netCash, a.growthPct, a.multiple, a.discountPct)

                near(expected["cumulativePV"]!!.jsonPrimitive.double, p.cumulativePV, "$name/$preset cumulativePV")
                near(expected["pvTerminal"]!!.jsonPrimitive.double, p.pvTerminal, "$name/$preset pvTerminal")
                near(expected["equityValue"]!!.jsonPrimitive.double, p.equityValue, "$name/$preset equityValue")
                near(expected["fairValue"]!!.jsonPrimitive.double, p.fairValue, "$name/$preset fairValue")

                val rows = expected["rows"]!!.jsonArray
                assertEquals(rows.size, p.rows.size, "$name/$preset year count")
                rows.forEachIndexed { i, row ->
                    val r = row.jsonObject
                    near(r["fcf"]!!.jsonPrimitive.double, p.rows[i].fcf, "$name/$preset year ${i + 1} fcf")
                    near(r["pv"]!!.jsonPrimitive.double, p.rows[i].pv, "$name/$preset year ${i + 1} pv")
                }

                val ev = expected["verdict"]!!.jsonObject
                val verdict = Dcf.verdict(p.fairValue, price)
                assertEquals(
                    ev["kind"]!!.jsonPrimitive.content, verdict.kind.toWireName(),
                    "$name/$preset verdict kind"
                )
                ev["pct"]?.jsonPrimitive?.contentOrNull?.toDoubleOrNull()?.let {
                    near(it, verdict.pct!!, "$name/$preset verdict pct")
                }
            }
        }
    }

    @Test
    fun `blocked reasons agree`() {
        for (v in vectors) {
            val input = v["input"]!!.jsonObject
            val expected = v["blocked"]!!.jsonPrimitive.contentOrNull
            val actual = Dcf.blockedReason(
                applicable = null,
                reason = null,
                cashFlowBase = input["cashFlowBase"]!!.jsonPrimitive.double,
                shares = input["shares"]!!.jsonPrimitive.double
            )
            assertEquals(expected, actual, v["name"]!!.jsonPrimitive.content)
        }
    }
}

/** The JS module's vocabulary, which the vectors are recorded in. */
private fun Dcf.VerdictKind.toWireName(): String = when (this) {
    Dcf.VerdictKind.NoEquityValue -> "no-equity-value"
    Dcf.VerdictKind.NoPrice -> "no-price"
    Dcf.VerdictKind.Divergent -> "divergent"
    Dcf.VerdictKind.Undervalued -> "undervalued"
    Dcf.VerdictKind.Overvalued -> "overvalued"
}
