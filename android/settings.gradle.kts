pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "omaha-android"

// :engine is plain Kotlin/JVM — the parity question is answerable there in
// seconds, without an emulator. :engine-android runs the same source against
// the Android build of QuickJS, on a device. :probe exists only to produce an
// APK whose size can be measured.
include(":engine")
include(":engine-android")
include(":data")
include(":selftest")
include(":probe")
