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

// :engine is plain Kotlin/JVM for now. QuickJS is the same engine on both
// targets, so the scoring-parity question is answerable without an emulator;
// the Android variant is added once that answer is in.
include(":engine")
