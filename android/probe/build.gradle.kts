plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

/**
 * Exists only to be measured.
 *
 * A library module produces no APK, so the size question — what does embedding
 * a JavaScript engine actually cost the download — cannot be answered from
 * :engine-android alone. This is the smallest application that links it: no
 * activity, no resources, nothing but the engine and what it drags in.
 *
 * Build it and read the report:
 *   ./gradlew :probe:assembleRelease
 */
android {
    namespace = "com.zandaulion.omaha.probe"
    compileSdk = 36

    defaultConfig {
        applicationId = "com.zandaulion.omaha.probe"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.1"
    }

    buildTypes {
        release {
            // Left off deliberately. The point is to measure what the engine
            // costs, not what R8 can shave off a module with no code in it.
            isMinifyEnabled = false
            signingConfig = signingConfigs.getByName("debug")
        }
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

dependencies {
    implementation(project(":engine-android"))
}
