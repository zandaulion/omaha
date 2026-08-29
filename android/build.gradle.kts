plugins {
    id("org.jetbrains.kotlin.jvm") version "2.2.10" apply false
    id("org.jetbrains.kotlin.android") version "2.2.10" apply false
    id("com.android.library") version "9.3.2" apply false
    id("com.android.application") version "9.3.2" apply false
    id("com.google.devtools.ksp") version "2.3.6" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.2.10" apply false
    // Reads android/app/google-services.json and generates the resources
    // FirebaseApp.initializeApp() needs — the project number, the API key, the
    // OAuth client IDs. Declared here, applied only in :app: the one module
    // with a real google-services.json to read.
    id("com.google.gms.google-services") version "4.4.4" apply false
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

/**
 * Every JVM test process gets the C numeric locale.
 *
 * Not a preference. The QuickJS native library reaches libc for decimal
 * conversion, and glibc's `strtod` and `snprintf` honour `LC_NUMERIC` — so on a
 * host whose locale uses a comma as the decimal separator, QuickJS parses
 * `8.5` as **8**. Not an error, not a NaN: it stops at the `.` and keeps the
 * integer part. Source literals, `JSON.parse`, `parseFloat` and `Number()` are
 * all affected, and `(8.5).toFixed(2)` comes back as `"8,00"`.
 *
 * This machine runs `LC_NUMERIC=ro_RO.UTF-8`, which is how it was found: the
 * scoring parity suite went red with 116 differing fields, every one of them
 * explained by a truncated decimal somewhere upstream of it. The engine was
 * never at fault, which is why an investigation that looked only at the engine
 * found nothing.
 *
 * `LC_NUMERIC` alone rather than `LC_ALL`, deliberately. `LC_ALL=C` would also
 * force `LC_CTYPE` to C, and this project's tests deliberately push non-BMP
 * characters through the bridge; changing the character locale to fix a number
 * problem would be trading one environmental variable for another.
 *
 * **Android is unaffected**, and that is a property of the platform rather than
 * luck: bionic implements only the C locale, so `LC_NUMERIC` cannot be set to
 * anything else on a device. `DeviceScoringParityTest` and the self-test assert
 * it rather than taking that on trust.
 */
subprojects {
    tasks.withType<Test>().configureEach {
        environment("LC_NUMERIC", "C")
    }
}
