package com.zandaulion.omaha.design

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp

/**
 * `.card` / `.card-elevated` / `.card-clickable`, in one place.
 *
 * Every screen had its own private copy of this — background, border, radius
 * agreed on `bgSurface`/`borderSubtle`/`OmahaRadius.md` everywhere, but none
 * of them carried a shadow or tap feedback, because `Card.kt` did not exist
 * yet to hold the definition once. `elevated` mirrors `.card-elevated`
 * (`bgSurfaceElevated`, [OmahaElevation.md] instead of `.sm`); the press
 * scale below is the direct port of `.card-clickable:active { transform:
 * scale(0.99) }`'s 150ms transition, and only applies when [onClick] is set
 * — a non-clickable card has nothing to give feedback about.
 */
@Composable
fun OmahaCard(
    modifier: Modifier = Modifier,
    onClick: (() -> Unit)? = null,
    elevated: Boolean = false,
    contentPadding: Dp = 14.dp,
    content: @Composable ColumnScope.() -> Unit
) {
    val shape = RoundedCornerShape(OmahaRadius.md)
    val elevation = if (elevated) OmahaElevation.md else OmahaElevation.sm

    var pressModifier: Modifier = Modifier
    if (onClick != null) {
        val interactionSource = remember { MutableInteractionSource() }
        val pressed by interactionSource.collectIsPressedAsState()
        val scale by animateFloatAsState(
            targetValue = if (pressed) 0.99f else 1f,
            animationSpec = tween(150),
            label = "cardPressScale"
        )
        pressModifier = Modifier
            .scale(scale)
            .clickable(interactionSource = interactionSource, indication = null, onClick = onClick)
    }

    Column(
        modifier
            .fillMaxWidth()
            .then(pressModifier)
            .shadow(elevation, shape)
            .clip(shape)
            .background(if (elevated) Omaha.colors.bgSurfaceElevated else Omaha.colors.bgSurface)
            .border(1.dp, Omaha.colors.borderSubtle, shape)
            .padding(contentPadding),
        content = content
    )
}
