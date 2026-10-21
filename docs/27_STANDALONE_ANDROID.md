# Pocket Omaha Core for Android

Pocket Omaha Core is the standalone GitHub edition. It includes watchlists,
company research and scoring, recorded reasons and reviews, comparisons, the
DCF sandbox, local alerts, widgets, and JSON backup and restore. Internet
access is needed to fetch market data; previously cached research remains
available offline.

Cloud AI summaries, Google sign-in, AI credits and purchases are omitted.
The APK contains no Firebase configuration, OAuth client ID, Firebase SDK,
Credential Manager or Play Billing SDK. Market-data requests identify the
public project website rather than a personal contact address.

## Install

Download the APK and `SHA256SUMS` from [GitHub Releases](https://github.com/zandaulion/omaha/releases).
Verify the checksum with `sha256sum --check SHA256SUMS` on Linux or
`shasum -a 256 -c SHA256SUMS` on macOS, then allow your browser or file manager
to install the APK. Android 8.0 or newer is required.

The app appears as **Pocket Omaha Core**, with package
`com.zandaulion.omaha.standalone`. It can coexist with the Play edition. Its
local data is separate: use JSON backup and restore to transfer your records.
Future GitHub APK updates must use the same signing certificate. Uninstalling
removes local records, so export a backup before doing so.

## Build from source

Use Node.js 22+, JDK 21, and the Android SDK specified
by the Gradle build. From the repository root:

```sh
npm ci
cp android/keystore.properties.example android/keystore.properties
# Fill in your own signing key path and credentials in this ignored file.
cd android
./gradlew :app:assembleRelease -Pstandalone=true
```

No `google-services.json` is needed. The `standalone` property selects local
implementations of the account, billing and relay repositories and removes
their SDK dependencies. The Google Services plugin is applied only to the
default Play build. Do not omit the property when building the core edition.

Output: `android/app/build/outputs/apk/release/app-release.apk`.
The core and Play builds share the same version sequence; this edition starts
at version 0.7.1, code 9. Signing files and generated APKs are never committed.

## Validate

```sh
npm test
cd android
./gradlew :engine:test :data:testDebugUnitTest :design:testDebugUnitTest \
  :app:lintRelease -Pstandalone=true
```

Run device tests only against a fresh isolated test application, with synthetic
records. Check the merged manifest, runtime dependency report and final APK
for absent cloud SDKs/configuration, verify its signing certificate, then test
launch, research, local records and backup round trips on a real device.

The `StandaloneCoreTest` suite refuses to seed a regular app installation.
Create a local Gradle init script (outside the repository), for example
`/tmp/omaha-validation.gradle`:

```groovy
gradle.beforeProject { p ->
    if (p.path == ':app') p.plugins.withId('com.android.application') {
        p.android.buildTypes.getByName('debug') {
            applicationIdSuffix '.releasecheck'
            versionNameSuffix '-validation'
            resValue 'string', 'app_name', 'Omaha Core Validation'
        }
    }
}
```

Select your dedicated test device with `ANDROID_SERIAL`, then run from `android/`:

```sh
./gradlew -Pstandalone=true -I /tmp/omaha-validation.gradle \
  :app:connectedDebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=com.zandaulion.omaha.app.StandaloneCoreTest
```

This uses a separate `com.zandaulion.omaha.standalone.releasecheck` installation.
It seeds public company fixtures and clearly synthetic notes, checks the omitted
cloud services, opens research and settings, and round-trips a JSON backup.
