plugins {
    id("com.android.library")
    id("org.jetbrains.kotlin.android")
}

/**
 * The generated design tokens, and nothing else yet.
 *
 * `Tokens.kt` is emitted from `design/tokens.json` by `tools/gen-tokens.mjs`,
 * which also emits `web/tokens.css`. Doc 13 §10 makes that pair the mechanism
 * for visual parity; `test/tokens.test.js` fails if either committed output has
 * drifted from the source.
 *
 * This module exists now, before there is a UI to use it, because a generator
 * whose output is never compiled is not a gate. Two syntax errors were already
 * caught this way on the first emission — a `title-1` identifier a hyphen made
 * illegal, and a missing `em` import — and neither is visible in the JSON or in
 * the CSS half. The shared composables doc 13 §5 puts here arrive with step 4.
 */
android {
    namespace = "com.zandaulion.omaha.design"
    compileSdk = 36

    defaultConfig {
        minSdk = 26
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

tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    dependsOn(generateTokens)
}

/**
 * No Compose compiler plugin, deliberately.
 *
 * Tokens.kt declares no @Composable — it is colours, dimensions and a type
 * scale. It uses Compose's value types (Color, TextUnit, FontWeight), which
 * live in ui-graphics, ui-text and ui-unit and need no compiler support.
 *
 * Enabling the plugin here fails outright: it requires the Compose *runtime*
 * on the classpath, which this module has no reason to carry. The plugin
 * belongs with the first module that actually declares composables, in step 4.
 */
dependencies {
    // The token types only. No material, no foundation: this module defines a
    // palette and a type scale, and should not decide which widget set uses it.
    implementation(platform("androidx.compose:compose-bom:2025.09.00"))
    implementation("androidx.compose.ui:ui-graphics")
    implementation("androidx.compose.ui:ui-text")
    implementation("androidx.compose.ui:ui-unit")
}
