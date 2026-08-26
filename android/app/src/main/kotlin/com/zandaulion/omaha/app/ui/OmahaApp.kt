package com.zandaulion.omaha.app.ui

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicText
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.rememberVectorPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.Image
import com.zandaulion.omaha.design.Omaha
import com.zandaulion.omaha.design.OmahaLayout
import com.zandaulion.omaha.design.OmahaRadius
import com.zandaulion.omaha.design.OmahaType
import com.zandaulion.omaha.design.toTextStyle

/**
 * The four views, in the PWA's order.
 *
 * `Scorecard` is the label the web client shows for the deep dive, and the two
 * should not diverge — a person reading the release notes for one client is
 * reading them for both. The route names match the PWA's deep-link aliases so
 * `?view=filter` and this enum cannot drift apart.
 */
enum class OmahaTab(val label: String, val route: String, val icon: ImageVector) {
    Watchlist("Watchlist", "watchlist", IconWatchlist),
    Scorecard("Scorecard", "deepdive", IconScorecard),
    Filter("Filter", "filter", IconFilter),
    Compare("Compare", "compare", IconCompare)
}

/**
 * The shell.
 *
 * Tab state rather than a navigation library, because that is what the PWA
 * does: four panels, one visible, `switchView` toggling a class. A back stack
 * would be a second navigation model to keep in step with a client that has
 * none, and phase 4 is explicitly about not doing things twice.
 *
 * `rememberSaveable` so a rotation or a process death returns to the same tab,
 * which is what `omaha_active_view` in localStorage buys the web client.
 */
@Composable
fun OmahaApp() {
    var tab by rememberSaveable { mutableStateOf(OmahaTab.Watchlist) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Omaha.colors.bgCanvas)
    ) {
        Box(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .windowInsetsPadding(WindowInsets.statusBars)
        ) {
            when (tab) {
                OmahaTab.Watchlist -> PlaceholderScreen(
                    "Watchlist",
                    "Holdings and the aggregate portfolio health score. Phase 4c."
                )
                OmahaTab.Scorecard -> PlaceholderScreen(
                    "Scorecard",
                    "Five pillars, the 12-point checklist, charts, the DCF sandbox, " +
                        "and the thesis with its sell triggers. Phase 4d — most of the product."
                )
                OmahaTab.Filter -> PlaceholderScreen(
                    "Filter",
                    "Narrows the companies you already follow. It does not search the " +
                        "wider market. Phase 4e."
                )
                OmahaTab.Compare -> PlaceholderScreen(
                    "Compare",
                    "Side by side, up to four tickers. Phase 4e."
                )
            }
        }

        BottomNav(selected = tab, onSelect = { tab = it })
    }
}

/**
 * Matches `.bottom-nav` in `web/app.css`: a top hairline, the surface colour,
 * and a fixed height from the shared layout tokens.
 *
 * The web version uses `backdrop-filter: blur(20px)` over a translucent
 * surface. That is not reproduced here — a Compose blur costs a render pass and
 * would be doing it behind an opaque list — so the opaque surface colour is used
 * instead. Worth recording as a deliberate difference rather than an oversight:
 * it is the one place this shell knowingly departs from the CSS.
 */
@Composable
private fun BottomNav(selected: OmahaTab, onSelect: (OmahaTab) -> Unit) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(Omaha.colors.bgSurface)
    ) {
        Box(
            Modifier
                .fillMaxWidth()
                .height(1.dp)
                .background(Omaha.colors.borderSubtle)
        )
        Row(
            Modifier
                .fillMaxWidth()
                .height(OmahaLayout.bottomNavHeight)
                .padding(horizontal = 8.dp),
            horizontalArrangement = Arrangement.SpaceAround,
            verticalAlignment = Alignment.CenterVertically
        ) {
            for (t in OmahaTab.entries) {
                NavTab(
                    tab = t,
                    active = t == selected,
                    onClick = { onSelect(t) },
                    modifier = Modifier.weight(1f)
                )
            }
        }
        // Sits above the gesture bar rather than under it.
        Box(Modifier.windowInsetsPadding(WindowInsets.navigationBars))
    }
}

/**
 * `.nav-tab`: icon over label, tertiary until active, then brand cyan with the
 * icon at 1.1×. The scale is animated because the CSS transitions it
 * (`transform 0.15s ease`), and a step change would read as a different
 * interaction rather than the same one.
 */
@Composable
private fun NavTab(
    tab: OmahaTab,
    active: Boolean,
    onClick: () -> Unit,
    modifier: Modifier = Modifier
) {
    val tint = if (active) Omaha.colors.brandCyan else Omaha.colors.textTertiary
    val scale by animateFloatAsState(if (active) 1.1f else 1f, label = "navIconScale")

    Column(
        modifier
            .clip(RoundedCornerShape(OmahaRadius.md))
            .clickable(
                interactionSource = remember { MutableInteractionSource() },
                indication = null,
                onClick = onClick
            )
            .padding(vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(3.dp)
    ) {
        Image(
            painter = rememberVectorPainter(tab.icon),
            contentDescription = tab.label,
            colorFilter = ColorFilter.tint(tint),
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .size(20.dp)
                .scale(scale)
        )
        BasicText(
            text = tab.label,
            style = OmahaType.caption.toTextStyle(color = tint)
                .copy(textAlign = TextAlign.Center)
        )
    }
}

/**
 * A view that does not exist yet, saying so and saying when.
 *
 * Deliberately not "Coming soon". Each of these is a scheduled slice in
 * `docs/16_ROADMAP.md` phase 4, and naming the slice makes the shell a
 * checklist of what is left rather than a set of dead ends.
 */
@Composable
private fun PlaceholderScreen(title: String, detail: String) {
    Column(
        Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        BasicText(
            text = title,
            style = OmahaType.title1.toTextStyle(color = Omaha.colors.textPrimary)
        )
        Box(Modifier.height(8.dp))
        BasicText(
            text = detail,
            style = OmahaType.bodyMd
                .toTextStyle(color = Omaha.colors.textSecondary)
                .copy(textAlign = TextAlign.Center)
        )
    }
}
