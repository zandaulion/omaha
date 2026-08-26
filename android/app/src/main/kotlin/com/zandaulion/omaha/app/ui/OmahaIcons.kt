package com.zandaulion.omaha.app.ui

import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.unit.dp

/**
 * The navigation icons, transcribed from the PWA rather than substituted.
 *
 * `web/index.html` draws each tab as inline SVG on a 24×24 box, stroked at
 * width 2 with no fill. Reaching for a Material icon of roughly the same
 * meaning would be quicker and would put the two clients visibly out of step —
 * doc 13 §10 calls UI drift visible and cheap, which is an argument for
 * noticing it, not for allowing it.
 *
 * The shapes here are the same path data. Where the web uses `<polyline>`,
 * `<line>`, `<polygon>` or `<circle>`, the equivalent path is written out,
 * because Compose has one primitive where SVG has five.
 */
private fun featherIcon(name: String, vararg pathData: String): ImageVector {
    val builder = ImageVector.Builder(
        name = name,
        defaultWidth = 24.dp,
        defaultHeight = 24.dp,
        viewportWidth = 24f,
        viewportHeight = 24f
    )
    for (d in pathData) {
        builder.addPath(
            pathData = PathParser().parsePathString(d).toNodes(),
            fill = null,
            stroke = SolidColor(Color.Black), // tinted at the call site
            strokeLineWidth = 2f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round
        )
    }
    return builder.build()
}

/** House with a door. `<path>` + `<polyline points="9 22 9 12 15 12 15 22">`. */
val IconWatchlist: ImageVector = featherIcon(
    "watchlist",
    "M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
    "M9 22 L9 12 L15 12 L15 22"
)

/** Clock. `<circle cx=12 cy=12 r=10>` becomes two half arcs. */
val IconScorecard: ImageVector = featherIcon(
    "scorecard",
    "M22 12 A10 10 0 1 1 2 12 A10 10 0 1 1 22 12 Z",
    "M12 6v6l4 2"
)

/** Funnel. `<polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3">`. */
val IconFilter: ImageVector = featherIcon(
    "filter",
    "M22 3 L2 3 L10 12.46 L10 19 L14 21 L14 12.46 Z"
)

/** Three bars. Three `<line>` elements. */
val IconCompare: ImageVector = featherIcon(
    "compare",
    "M18 20 L18 10",
    "M12 20 L12 4",
    "M6 20 L6 14"
)
