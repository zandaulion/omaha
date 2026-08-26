package com.zandaulion.omaha.app.ui

import kotlin.math.abs
import kotlin.math.roundToLong

/**
 * Number formatting for the interface.
 *
 * Deliberately not `String.format` or `toFixed`. `core/format.js` exists
 * because decimal formatting is not portable — doc 13 §20 records the PWA
 * printing "ROIC of 4.3%" and the app "4.2%" for the same filings, because
 * Bionic rounds ties to even and desktop libcs round away from zero. That fix
 * lives in the engine, and the numbers below have already been through it.
 *
 * These functions therefore only *present* values the engine already decided:
 * an em dash where it reported nothing, and a currency symbol where it named
 * a currency. Nothing here rounds a scored figure.
 */

const val EM_DASH = "—"

private val SYMBOLS = mapOf(
    "USD" to "$", "EUR" to "€", "GBP" to "£", "JPY" to "¥",
    "CHF" to "CHF ", "CAD" to "C$", "AUD" to "A$", "SEK" to "kr ",
    "NOK" to "kr ", "DKK" to "kr ", "INR" to "₹", "BRL" to "R$"
)

/** Fixed decimals without libc rounding: scale, round half away from zero, split. */
private fun fixed(value: Double, places: Int): String {
    var scale = 1L
    repeat(places) { scale *= 10 }
    val scaled = (abs(value) * scale).roundToLong()
    val whole = scaled / scale
    val frac = scaled % scale
    val sign = if (value < 0 && scaled != 0L) "-" else ""
    return if (places == 0) "$sign$whole"
    else "$sign$whole.${frac.toString().padStart(places, '0')}"
}

fun fmtPrice(value: Double?, currency: String?): String {
    if (value == null) return EM_DASH
    val symbol = SYMBOLS[currency?.uppercase()] ?: (currency?.let { "$it " } ?: "")
    return symbol + fixed(value, 2)
}

/**
 * A percentage the engine already expressed as one — `roic_pct` is 23.4, not
 * 0.234. Passing a ratio here would be wrong by two orders of magnitude, so
 * the two cases are separate functions rather than a boolean argument.
 */
fun fmtPercent(value: Double?, places: Int = 1, signed: Boolean = false): String {
    if (value == null) return EM_DASH
    val sign = if (signed && value >= 0) "+" else ""
    return "$sign${fixed(value, places)}%"
}

fun fmtRatio(value: Double?, places: Int = 1, suffix: String = ""): String =
    if (value == null) EM_DASH else fixed(value, places) + suffix
