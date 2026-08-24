package com.zandaulion.omaha.design

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp

/**
 * Generated from design/tokens.json by tools/gen-tokens.mjs.
 *
 * Do not edit. Edit the source and run `npm run tokens`.
 * test/tokens.test.js fails if this file has drifted from its source, which is
 * what stops the two clients diverging one hand-edit at a time.
 */

/** One palette. Two instances: [DarkColors] and [LightColors]. */
class OmahaColors internal constructor(
    val bgCanvas: Color,
    val bgSurface: Color,
    val bgSurfaceElevated: Color,
    val bgSurfaceSubtle: Color,
    val bgSurfaceGlass: Color,
    val borderSubtle: Color,
    val borderProminent: Color,
    val borderGlass: Color,
    val textPrimary: Color,
    val textSecondary: Color,
    val textTertiary: Color,
    val textAccent: Color,
    val healthPristine: Color,
    val healthPristineBg: Color,
    val healthPristineBorder: Color,
    val healthGood: Color,
    val healthGoodBg: Color,
    val healthGoodBorder: Color,
    val healthModerate: Color,
    val healthModerateBg: Color,
    val healthModerateBorder: Color,
    val healthRisk: Color,
    val healthRiskBg: Color,
    val healthRiskBorder: Color,
    val brandCyan: Color,
    val brandViolet: Color,
    val brandBlue: Color,
    val brandGold: Color,
    val brandGlow: Color,
)

val DarkColors: OmahaColors = OmahaColors(
    bgCanvas = Color(0xFF0B0E14),
    bgSurface = Color(0xFF121824),
    bgSurfaceElevated = Color(0xFF1A2234),
    bgSurfaceSubtle = Color(0xFF161F2E),
    bgSurfaceGlass = Color(0xD9121824),
    borderSubtle = Color(0x14FFFFFF),
    borderProminent = Color(0x29FFFFFF),
    borderGlass = Color(0x1FFFFFFF),
    textPrimary = Color(0xFFF3F5F9),
    textSecondary = Color(0xFF94A3B8),
    textTertiary = Color(0xFF64748B),
    textAccent = Color(0xFF38BDF8),
    healthPristine = Color(0xFF10B981),
    healthPristineBg = Color(0x1F10B981),
    healthPristineBorder = Color(0x4D10B981),
    healthGood = Color(0xFF34D399),
    healthGoodBg = Color(0x1F34D399),
    healthGoodBorder = Color(0x4D34D399),
    healthModerate = Color(0xFFFBBF24),
    healthModerateBg = Color(0x1FFBBF24),
    healthModerateBorder = Color(0x4DFBBF24),
    healthRisk = Color(0xFFF87171),
    healthRiskBg = Color(0x1FF87171),
    healthRiskBorder = Color(0x4DF87171),
    brandCyan = Color(0xFF06B6D4),
    brandViolet = Color(0xFF8B5CF6),
    brandBlue = Color(0xFF3B82F6),
    brandGold = Color(0xFFF59E0B),
    brandGlow = Color(0x4006B6D4),
)

val LightColors: OmahaColors = OmahaColors(
    bgCanvas = Color(0xFFF8FAFC),
    bgSurface = Color(0xFFFFFFFF),
    bgSurfaceElevated = Color(0xFFFFFFFF),
    bgSurfaceSubtle = Color(0xFFF1F5F9),
    bgSurfaceGlass = Color(0xE6FFFFFF),
    borderSubtle = Color(0xFFE2E8F0),
    borderProminent = Color(0xFFCBD5E1),
    borderGlass = Color(0x14000000),
    textPrimary = Color(0xFF0F172A),
    textSecondary = Color(0xFF475569),
    textTertiary = Color(0xFF94A3B8),
    textAccent = Color(0xFF0284C7),
    healthPristine = Color(0xFF059669),
    healthPristineBg = Color(0xFFECFDF5),
    healthPristineBorder = Color(0x40059669),
    healthGood = Color(0xFF10B981),
    healthGoodBg = Color(0xFFF0FDF4),
    healthGoodBorder = Color(0x4010B981),
    healthModerate = Color(0xFFD97706),
    healthModerateBg = Color(0xFFFFFBEB),
    healthModerateBorder = Color(0x40D97706),
    healthRisk = Color(0xFFDC2626),
    healthRiskBg = Color(0xFFFEF2F2),
    healthRiskBorder = Color(0x40DC2626),
    brandCyan = Color(0xFF06B6D4),
    brandViolet = Color(0xFF7C3AED),
    brandBlue = Color(0xFF3B82F6),
    brandGold = Color(0xFFF59E0B),
    brandGlow = Color(0x4006B6D4),
)

/** The brand gradient, as its stops. Compose builds the brush. */
object OmahaGradient {
    val brandFrom: Color = Color(0xFF06B6D4)
    val brandTo: Color = Color(0xFF3B82F6)
    const val brandAngleDeg: Float = 135f
}

object OmahaRadius {
    val sm = 8.dp
    val md = 12.dp
    val lg = 18.dp
    val pill = 9999.dp
}

object OmahaLayout {
    val maxAppWidth = 960.dp
    val bottomNavHeight = 64.dp
    val headerHeight = 56.dp
}

/**
 * The type scale from doc 04 §2.
 *
 * Sizes are sp so they honour the reader's font scale; line heights are sp
 * for the same reason. Tracking is em in the source and stays relative here,
 * because Compose letter spacing in sp would not scale with the size.
 */
class OmahaTextStyle internal constructor(
    val size: androidx.compose.ui.unit.TextUnit,
    val lineHeight: androidx.compose.ui.unit.TextUnit,
    val weight: FontWeight,
    val tracking: androidx.compose.ui.unit.TextUnit
)

object OmahaType {
    /** Primary health score number. */
    val displayLg = OmahaTextStyle(32.sp, 38.sp, FontWeight(700), -0.03.em)
    /** Screen titles, stock price. */
    val title1 = OmahaTextStyle(24.sp, 30.sp, FontWeight(600), -0.02.em)
    /** Card headings, section headers. */
    val title2 = OmahaTextStyle(18.sp, 24.sp, FontWeight(600), -0.01.em)
    /** Primary text, descriptions. */
    val bodyMd = OmahaTextStyle(15.sp, 22.sp, FontWeight(400), 0.em)
    /** Ratio labels, sub-metrics. */
    val bodySm = OmahaTextStyle(13.sp, 18.sp, FontWeight(400), 0.01.em)
    /** Badges, pillar tags, timestamps. */
    val caption = OmahaTextStyle(11.sp, 15.sp, FontWeight(500), 0.03.em)
}

/**
 * Bundled faces. Doc 13 §10 requires both in the APK: Roboto does not
 * reproduce doc 04's scale, so falling back to the system face puts the
 * Android build off-parity before a screen is laid out.
 */
object OmahaFonts {
    const val sans = "Inter"
    const val mono = "JetBrains Mono"
}
