package com.zandaulion.omaha.app

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.isSystemInDarkTheme
import com.zandaulion.omaha.app.ui.OmahaApp
import com.zandaulion.omaha.design.OmahaTheme
import com.zandaulion.omaha.design.ThemeChoice

/**
 * The only activity.
 *
 * The PWA is a single page with four panels and no history beyond its own tab
 * state; mirroring that with one activity keeps the two clients' navigation
 * models identical rather than merely similar.
 *
 * The theme choice is hard-coded to [ThemeChoice.System] for now. The web
 * client cycles system → dark → light from a button and stores the result in
 * `omaha_theme`; the Android equivalent belongs in Settings, which is phase 4f,
 * and inventing a second place to put it here would be work to undo.
 */
class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            OmahaTheme(
                choice = ThemeChoice.System,
                systemInDarkTheme = isSystemInDarkTheme()
            ) {
                OmahaApp()
            }
        }
    }
}
