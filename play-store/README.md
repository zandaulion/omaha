# Google Play listing package

Prepared for the default `en-US` store listing from the Android build captured
on a Samsung Fold4 and a physical Pixel Tablet on 28 September 2026.

## Build snapshot

| Field | Value |
| --- | --- |
| Package | `com.zandaulion.omaha` |
| Version name | `0.4` |
| Version code | `4` |
| Store status | Initial Android release candidate |
| Brand mark | Review Radar |

## Copy

| Play Console field | File | Validated length | Limit |
| --- | --- | ---: | ---: |
| Short description | `en-US/short-description.txt` | 77 | 80 |
| Full description | `en-US/full-description.txt` | 2,187 | 4,000 |
| Release notes | `en-US/release-notes.txt` | 458 | 500 |

The positioning is intentionally limited to research and ongoing review. It does
not claim that a fundamental score proves a moat, predicts returns or provides a
personalised buy/sell recommendation.

## App icon

`app-icon.png` is the upload-ready 512×512 px, 32-bit RGBA PNG. It is 73,136
bytes, its alpha channel is fully opaque, and the artwork fills the square.
Google Play applies the display mask and shadow. The editable vector is
`source/app-icon.svg`.

The Review Radar has five axes for the five fundamental categories, an open
ring for recurring review, and an amber centre point for the investor's thesis.
Run `python3 tools/render-brand-icons.py` from the repository root to regenerate
the Play Store, PWA, Android launcher, themed and notification forms together.

## Feature graphic

`feature-graphic.png` is the upload-ready 1,024×500 px opaque RGB PNG. The design
keeps the wordmark and research-radar focal point inside the central safe area.
English alt text is in `en-US/feature-graphic-alt-text.txt`; the generated
background and reproducible generation prompt are preserved in `source/`.

## Screenshots

`screenshots/phone/` contains six upload-ready opaque RGB PNG files at 904×1,808
px. They were recaptured from the installed Review Radar build without adding
promotional text or altering the interface. `screenshots/phone-raw/` keeps the
original 904×2,316 device captures.

`screenshots/tablet/` contains six upload-ready 1,600×2,560 opaque RGB PNG files
captured on a physical Google Pixel Tablet running Android 16 (API 36) in
Firebase Test Lab. `screenshots/tablet-raw/` preserves the returned artifacts;
the upload-ready copies are identical because the original 10-inch tablet
captures already satisfy the Play dimension and aspect-ratio constraints. The
test uses fixed AAPL, JPM and NOK model fixtures and does not contact market-data
providers. Its reproducible workflow is documented in
`docs/24_CONTRIBUTING_AND_TESTING.md`.

The upload order and optional campaign captions are in `screenshot-captions.md`.
English accessibility descriptions for both device sets are in
`en-US/screenshot-alt-text.md`.

These images satisfy Google Play's mandatory phone-screenshot dimensions and
2:1 aspect-ratio limit. They do not satisfy the separate promotional-placement
recommendation of at least four 9:16 screenshots with a minimum 1,080 px short
edge; the Fold4 cover-display captures are 904 px wide.

## Validated asset inventory

| Asset | Count | Dimensions | Format |
| --- | ---: | ---: | --- |
| App icon | 1 | 512×512 | 32-bit RGBA PNG, opaque alpha |
| Feature graphic | 1 | 1,024×500 | 24-bit RGB PNG |
| Phone screenshots | 6 | 904×1,808 | 24-bit RGB PNG |
| Raw phone captures | 6 | 904×2,316 | 24-bit RGB PNG |
| 10-inch tablet screenshots | 6 | 1,600×2,560 | 24-bit RGB PNG |
| Raw 10-inch tablet captures | 6 | 1,600×2,560 | 24-bit RGB PNG |

## Android 16 native-library verification

The first physical Pixel Tablet run exposed an Android compatibility warning:
the `libquickjs.so` packaged by `quickjs-kt-android:1.0.0-alpha13` used `0x1000`
ELF LOAD alignment. The app now uses `quickjs-kt-android:1.0.15`. Verification
of the rebuilt APK found:

- APK ZIP entries pass `zipalign -c -P 16 4`.
- Every arm64 `libquickjs.so` LOAD segment uses `0x4000` alignment.
- The engine's 23 JVM tests pass, including fixture parity, repeated evaluation,
  and non-BMP string regression coverage.
- A second physical Pixel Tablet/API 36 Test Lab run passed its complete
  screenshot flow without showing the compatibility warning.

This proves the packaged native-library alignment and operation on that physical
Android 16 tablet. It does not identify the tablet's kernel page size, so a run
on a device explicitly configured for 16 KB pages remains the final end-to-end
compatibility check. Google has announced Play enforcement for apps targeting
API 35 or higher from 1 February 2027; see the
[Android 16 KB page-size guide](https://developer.android.com/guide/practices/page-sizes).

## Current Google Play constraints

- The app icon must be a 512×512 32-bit PNG no larger than 1,024 KB. Its source
  should remain square because Google Play adds the mask and shadow.
- The feature graphic must be a 1,024×500 JPEG or 24-bit PNG without alpha.
- At least two screenshots are required across supported device types.
- Screenshots must be JPEG or 24-bit PNG without alpha.
- Each screenshot dimension must be between 320 and 3,840 px.
- The longer screenshot dimension may be no more than twice the shorter one.
- Google recommends contextual alt text of 140 characters or fewer for each
  graphic asset.

Official references:

- https://developer.android.com/distribute/google-play/resources/icon-design-specifications
- https://support.google.com/googleplay/android-developer/answer/9866151
- https://support.google.com/googleplay/android-developer/answer/9859152
- https://support.google.com/googleplay/android-developer/answer/9859348
