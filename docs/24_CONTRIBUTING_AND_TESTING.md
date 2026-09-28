# Contributing and testing

## Principles

1. Measured missing data stays missing. Never turn `null` into zero or a plausible default.
2. Domain behavior shared by PWA and Android belongs in `core/`.
3. Host layers provide I/O and presentation; they do not independently redefine scoring, alerts, reviews, backups, DCF, or prompt policy.
4. User-authored data must survive migrations and restore. Never use destructive Room migration fallback.
5. Privacy-bearing features default closed. Personal notes do not leave the host without explicit opt-in.
6. A failed ticker remains visible as failed rather than silently changing the list being summarized.

## Sources of truth

| Concern | Source | Generated/host consumers |
|---|---|---|
| Scoring/model/ingestion | `core/` | Node imports; `core/dist/` QuickJS bundles |
| Alert policy | `core/alerts/` | `server/alerts.js`; Android alert repositories/workers |
| Review queue | `core/review.js` | PWA route; Android `ReviewRepository` |
| Backup schema/merge | `core/backup.js` | SQLite and Room adapters |
| AI prompt/schema | `server/gemini-client.js` and `core/analysis/` | PWA and Firebase callable bundle |
| Glossary | `core/glossary.js` | `web/glossary.js`; Android `Glossary.kt` |
| Colors/type/spacing | `design/tokens.json` | `web/tokens.css`; Android `Tokens.kt` |
| PWA schema | `server/db.js` | SQLite |
| Android schema | Room entities plus `OmahaDatabaseFactory` migrations | Room database |
| Firebase credit/product rules | `functions/src/` | generated `functions/lib/index.js` |

Never hand-edit `core/dist/*.bundle.js`, `functions/lib/index.js`, `web/tokens.css`, generated glossary files, or generated token Kotlin. Change their source and run the matching generator.

## Development setup

```bash
npm install
npm run dev
```

For Android, configure `android/app/google-services.json` and `android/keystore.properties` as described in [Configuration and operations](23_CONFIGURATION_AND_OPERATIONS.md), then open `android/` in Android Studio or use its wrapper.

## Test layers

### JavaScript and server tests

```bash
npm test
```

This runs Node tests under `core/`, `test/`, and `functions/src/`. The suite covers scoring regressions, provider parsing, timestamps, formatting, backups, alert policy, review rules/store behavior, app settings/privacy, Firebase helper rules, and recorded whole-pipeline fixtures.

### Fast Android engine parity

```bash
npm run test:engine
```

This runs the shared engine in JVM QuickJS. It is the fast answer to whether an engine bundle behaves like the Node source.

### Combined verification

```bash
npm run verify
```

This combines the Node suite and fast engine tests. Use it for shared-domain changes.

### Android unit and build checks

```bash
cd android
./gradlew :data:testDebugUnitTest
./gradlew :app:assembleDebug
```

Run connected tests when changing QuickJS integration, Room migrations, backups, or device-specific behavior:

```bash
./gradlew :engine-android:connectedDebugAndroidTest
./gradlew :data:connectedDebugAndroidTest
```

These require an emulator or USB-connected device. Room migration tests are meaningful because theses, conditions, reviews, and watchlists cannot be regenerated.

### Generator drift

The normal test suite checks generated output where a check exists. Direct commands are also available:

```bash
node tools/bundle-core.mjs --check
node tools/bundle-functions.mjs --check
node tools/gen-tokens.mjs --check
node tools/gen-glossary.mjs --check
```

## Recorded fixtures

Whole-pipeline golden tests replay captured Yahoo and SEC responses from `core/__fixtures__/`. They guard the difference between the provider shape developers expect and what the provider actually returned.

Re-record only when an upstream format intentionally changes or a new scenario is needed:

```bash
node scripts/record-fixture.mjs NOK AAPL JPM
node scripts/record-edgar-fixture.mjs NOK AAPL JPM
```

Recording uses the live network and can make large diffs. Review raw fixture changes and corresponding model/scoring outputs. Never “fix” a golden failure by accepting output without understanding the behavioral change.

## Change workflows

### Add or modify a metric

1. Update ingestion/normalization in `core/` and preserve `null` semantics.
2. Add a focused regression for the exact failure or new rule.
3. Update scoring/checklist/pillar coverage rules as needed.
4. Update glossary text and regenerate both clients.
5. Update comparison, chart, or research presentation only if the metric is exposed.
6. Rebuild core bundles and run parity tests.
7. Update scoring/user documentation.

### Change alert behavior

1. Put thresholds, edge rules, cooldowns, snapshot fields, and schedule constants in `core/alerts/`.
2. Add pure tests for first observation, crossings, missing data, cooldown, and rate-limit decisions.
3. Verify both PWA and Android storage adapters carry every snapshot field.
4. Test history-before-delivery and notification routing.
5. Update user, runtime, and data docs.

### Change personal data

1. Decide whether the field is irreplaceable and therefore belongs in backup.
2. Update PWA SQLite and Android Room schemas with non-destructive migrations.
3. Update `core/backup.js` schema version and compatibility rules when an older reader could drop the field.
4. Test PWA-to-Android, Android-to-PWA, repeated import, conflict resolution, and rollback.
5. Update privacy and data-model docs.

### Add an API route or callable

Define auth requirements first. Validate input at the boundary, use typed errors, avoid exposing secrets/tokens, add tests for state-changing rules, and update [API reference](22_API_REFERENCE.md). For Firebase, keep Firestore direct access denied and perform sensitive operations through callable/Admin SDK code.

### Change design or explanatory text

Edit `design/tokens.json` for shared tokens and `core/glossary.js` for definitions. Regenerate outputs. Check PWA and Android in both themes and at narrow widths. Every new financial term shown as an interactive metric should have an explanation key or explicitly use existing glossary wording.

## Android module boundaries

- `:app` owns UI, MainActivity, workers, notification delivery, and widget integration.
- `:data` owns Room and external-service repositories.
- `:engine` owns reusable QuickJS hosting code and JVM tests.
- `:engine-android` binds the same engine source to Android and stages generated assets.
- `:design` owns native tokens, typography, theme, and explanation surfaces.
- `:widget` renders passed Glance state and must not open the app database.
- `:selftest` and `:probe` are diagnostic modules, not production feature homes.

Do not introduce a second Room handle in a widget or worker. Resolve repositories through `OmahaEngine`.

## Review checklist

- User-visible behavior matches this documentation.
- PWA and Android agree where the feature matrix says they should.
- Missing data remains visibly unreported.
- Cache age/provenance remains available.
- Personal notes remain excluded from AI by default.
- Schema changes have forward migrations and backup tests.
- Generated files were regenerated, not edited.
- Appropriate Node/JVM/device tests passed.
- Play Store text/screenshots changed if release-facing behavior changed.

## Commit scope

Keep source and its generated outputs together. Do not commit local databases, `.env`, `google-services.json`, keystore files/passwords, captured personal backups, generated prompt dumps, APKs/AABs, or Play purchase tokens.
