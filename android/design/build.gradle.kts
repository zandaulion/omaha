plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

/**
 * The generated design tokens, and the generated glossary.
 *
 * `Tokens.kt` is emitted from `design/tokens.json` by `tools/gen-tokens.mjs`,
 * which also emits `web/tokens.css`. Doc 13 §10 makes that pair the mechanism
 * for visual parity; `test/tokens.test.js` fails if either committed output has
 * drifted from the source. `Glossary.kt` is the same shape, one generator
 * narrower: `tools/gen-glossary.mjs` emits it from `core/glossary.js`, the
 * PWA's own explain-on-tap source of truth, and `test/glossary-kt.test.js`
 * is its drift gate.
 *
 * This module exists now, before there is a UI to use it, because a generator
 * whose output is never compiled is not a gate. Two syntax errors were already
 * caught this way on the first emission — a `title-1` identifier a hyphen made
 * illegal, and a missing `em` import — and neither is visible in the JSON or in
 * the CSS half. The shared composables doc 13 §5 puts here arrive with step 4
 * have arrived: `Card.kt`'s `OmahaCard` is the first one, which is why
 * `foundation` and `ui` join the dependency list below.
 */
android {
    namespace = "com.zandaulion.omaha.design"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
    }

    buildFeatures {
        compose = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

/**
 * Regenerate before compiling, so the module cannot build against a stale
 * Tokens.kt. The same argument as `bundleCore`: the artifact that ships is
 * always the one the current source produces.
 */
val generateTokens by tasks.registering(Exec::class) {
    workingDir = rootProject.layout.projectDirectory.dir("..").asFile
    commandLine(
        if (System.getProperty("os.name").startsWith("Windows")) "cmd" else "sh",
        if (System.getProperty("os.name").startsWith("Windows")) "/c" else "-c",
        "node tools/gen-tokens.mjs"
    )
}

/** Same reasoning as generateTokens, for Glossary.kt / core/glossary.js. */
val generateGlossary by tasks.registering(Exec::class) {
    workingDir = rootProject.layout.projectDirectory.dir("..").asFile
    commandLine(
        if (System.getProperty("os.name").startsWith("Windows")) "cmd" else "sh",
        if (System.getProperty("os.name").startsWith("Windows")) "/c" else "-c",
        "node tools/gen-glossary.mjs"
    )
}

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    dependsOn(generateTokens, generateGlossary)
}

/**
 * Compose runtime, but still no Material.
 *
 * Tokens.kt declares no @Composable and needed no compiler support. Theme.kt
 * does — it provides the palette through a CompositionLocal — so the plugin and
 * the runtime arrive here together, which is the point at which they are
 * actually earned rather than assumed.
 *
 * Material3 is deliberately absent, and should stay absent. It carries its own
 * colour scheme and type scale, and a component reading MaterialTheme.colorScheme
 * would be off-parity while looking entirely correct. Everything visual in this
 * app comes from OmahaColors or it does not come at all.
 */
dependencies {
    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.compose.runtime:runtime")
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-text")
    implementation("androidx.compose.ui:ui-unit")
    // OmahaCard: background/border/clickable/shadow/RoundedCornerShape and the
    // press-scale's interactionSource all live here, matching :app's own
    // foundation+ui coordinates so a consumer never needs a third declaration.
    implementation("androidx.compose.foundation:foundation")
    implementation("androidx.compose.ui:ui")

    // GlossaryTest: plain-JVM, no device needed — same coordinate :data uses
    // for its own non-instrumented tests (e.g. WidgetRepositoryTest.kt).
    testImplementation(kotlin("test"))
}
