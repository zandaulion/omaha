plugins {
    id("org.jetbrains.kotlin.jvm") version "2.2.10" apply false
    id("org.jetbrains.kotlin.android") version "2.2.10" apply false
    id("com.android.library") version "9.3.1" apply false
    id("com.android.application") version "9.3.1" apply false
    id("com.google.devtools.ksp") version "2.2.10-2.0.2" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.10" apply false
}

/**
 * Regenerate core/dist from core/ before anything packages it.
 *
 * Keeps the Android build honest: the bundle it ships is always the one the
 * current sources produce, rather than whatever was last committed.
 */
tasks.register<Exec>("bundleCore") {
    workingDir = rootProject.layout.projectDirectory.dir("..").asFile
    commandLine(
        if (System.getProperty("os.name").startsWith("Windows")) "cmd" else "sh",
        if (System.getProperty("os.name").startsWith("Windows")) "/c" else "-c",
        "node tools/bundle-core.mjs"
    )
}
