package com.zandaulion.omaha.data

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonPrimitive

/** Null selects all lists for background alerts; a missing explicit ID selects none. */
internal fun watchedTickers(lists: List<WatchlistRow>, watchlistId: String? = null): List<String> =
    lists.filter { watchlistId == null || it.id == watchlistId }.flatMap { list ->
        runCatching {
            Json.parseToJsonElement(list.tickersJson).jsonArray.mapNotNull {
                it.jsonPrimitive.contentOrNull
            }
        }.getOrDefault(emptyList())
    }.distinct()
