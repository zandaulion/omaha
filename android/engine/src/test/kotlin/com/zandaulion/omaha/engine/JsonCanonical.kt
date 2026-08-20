package com.zandaulion.omaha.engine

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Canonical JSON, for comparing a QuickJS result against a Node fixture.
 *
 * Key order and whitespace are not part of the contract — Node's recorder
 * sorts keys, QuickJS `JSON.stringify` emits insertion order — so comparing
 * the raw strings would fail for reasons that say nothing about the engine.
 *
 * Numbers are compared by their textual form deliberately. Two engines
 * agreeing that a value is "close enough" is precisely the divergence this
 * gate exists to catch: `toFixed` rounding at a boundary, or a double printed
 * as `0.1` by one and `0.10000000000000001` by the other, changes a number the
 * user is shown. No tolerance is applied.
 */
internal fun parseJson(text: String): JsonElement = Json.parseToJsonElement(text)

internal fun canonical(element: JsonElement): String = buildString { write(element, this) }

private fun write(element: JsonElement, out: StringBuilder) {
    when (element) {
        is JsonObject -> {
            out.append('{')
            var first = true
            for (key in element.keys.sorted()) {
                if (!first) out.append(',')
                first = false
                out.append(Json.encodeToString(JsonPrimitive.serializer(), JsonPrimitive(key)))
                out.append(':')
                write(element.getValue(key), out)
            }
            out.append('}')
        }

        is JsonArray -> {
            out.append('[')
            element.forEachIndexed { index, item ->
                if (index > 0) out.append(',')
                write(item, out)
            }
            out.append(']')
        }

        is JsonPrimitive -> out.append(element.toString())
    }
}
