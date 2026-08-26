package com.zandaulion.omaha.design

import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.ProvidableCompositionLocal
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.ExperimentalTextApi
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle

/**
 * The theme, assembled from the generated tokens.
 *
 * `Tokens.kt` is emitted from `design/tokens.json` and holds values only. This
 * file is the hand-written half: it decides how those values reach a
 * composable, and it is the only place in the app allowed to have an opinion
 * about typography or colour that the JSON does not already state.
 *
 * There is deliberately **no Material theme underneath**. Material3 carries its
 * own colour scheme and its own type scale, and a component reading
 * `MaterialTheme.colorScheme` would be off-parity while looking perfectly
 * correct — the failure mode doc 13 §10 calls out as visible but cheap, except
 * that a palette leaking in through a default is neither. Everything here comes
 * from `OmahaColors` or it does not come at all.
 */

val LocalOmahaColors: ProvidableCompositionLocal<OmahaColors> =
    staticCompositionLocalOf { DarkColors }

val LocalOmahaTypography: ProvidableCompositionLocal<OmahaTypography> =
    staticCompositionLocalOf { OmahaTypography(FontFamily.Default, FontFamily.Default) }

/**
 * Which palette to use.
 *
 * Three states, matching the PWA exactly: an explicit choice wins, and
 * [System] follows the OS. The web client stores the same three in
 * `omaha_theme` and resolves them the same way, so a person moving between the
 * two clients does not find the setting means something different on each.
 */
enum class ThemeChoice { System, Dark, Light }

/**
 * The bundled faces, resolved once.
 *
 * Both are variable fonts with a `wght` axis, so a single file serves every
 * weight in the scale. [FontVariation] is what selects a weight from that axis;
 * without the settings the renderer would synthesise bold by smearing the
 * regular master, which is exactly the difference doc 04's scale would lose.
 */
class OmahaTypography internal constructor(
    val sans: FontFamily,
    val mono: FontFamily
)

/**
 * Opted in rather than avoided. `FontVariation` is the only way to select a
 * weight from a variable font's axis; without it the renderer synthesises bold
 * by smearing the regular master, which is precisely the difference doc 04's
 * scale exists to specify. The alternative is four static files per family,
 * which is larger and no more stable.
 */
@OptIn(ExperimentalTextApi::class)
private fun variableFamily(resId: Int): FontFamily =
    FontFamily(
        listOf(400, 500, 600, 700).map { weight ->
            Font(
                resId = resId,
                weight = FontWeight(weight),
                variationSettings = FontVariation.Settings(FontVariation.weight(weight))
            )
        }
    )

@Composable
fun OmahaTheme(
    choice: ThemeChoice = ThemeChoice.System,
    systemInDarkTheme: Boolean,
    content: @Composable () -> Unit
) {
    val dark = when (choice) {
        ThemeChoice.System -> systemInDarkTheme
        ThemeChoice.Dark -> true
        ThemeChoice.Light -> false
    }

    val typography = OmahaTypography(
        sans = variableFamily(R.font.inter_variable),
        mono = variableFamily(R.font.jetbrains_mono_variable)
    )

    CompositionLocalProvider(
        LocalOmahaColors provides if (dark) DarkColors else LightColors,
        LocalOmahaTypography provides typography,
        content = content
    )
}

/** Short accessors, so a call site reads as `Omaha.colors.textPrimary`. */
object Omaha {
    val colors: OmahaColors
        @Composable @ReadOnlyComposable get() = LocalOmahaColors.current

    val fonts: OmahaTypography
        @Composable @ReadOnlyComposable get() = LocalOmahaTypography.current
}

/**
 * A generated [OmahaTextStyle] as a Compose [TextStyle].
 *
 * The scale stores size, line height, weight and tracking; this attaches a
 * family and trims the first line's leading, because Compose otherwise adds
 * half the line height above the first baseline and the block sits lower than
 * the CSS equivalent. That single difference is enough to fail a screenshot
 * diff on every screen at once.
 */
@Composable
fun OmahaTextStyle.toTextStyle(
    family: FontFamily = Omaha.fonts.sans,
    color: androidx.compose.ui.graphics.Color = Omaha.colors.textPrimary
): TextStyle = TextStyle(
    fontFamily = family,
    fontSize = size,
    lineHeight = lineHeight,
    fontWeight = weight,
    letterSpacing = tracking,
    color = color,
    lineHeightStyle = LineHeightStyle(
        alignment = LineHeightStyle.Alignment.Center,
        trim = LineHeightStyle.Trim.FirstLineTop
    )
)
