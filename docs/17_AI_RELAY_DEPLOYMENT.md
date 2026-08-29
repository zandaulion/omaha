# 17. Deploying the Cloud Function relay

Every step below happens in a console this project's assistant has no
credentials for — Firebase, Google Cloud, Play Console — the same reason the
PWA is deployed by hand to the A1 server rather than by an agent. This is a
runbook, not a script, because most of the setup here is a checkbox in a web
console rather than a command line.

The code these steps deploy is `functions/`, built from `functions/src/` by
`tools/bundle-functions.mjs` (`npm run bundle:functions`, or `npm run build`
from inside `functions/`). See its header and `docs/13_ANDROID_ARCHITECTURE.md`
§7 for what it does and why it is shaped the way it is; this document is only
the checklist to get it running.

---

## 1. Firebase project

1. Create a Firebase project (console.firebase.google.com), or attach an
   existing GCP project if there already is one this should live under.
2. **Upgrade to the Blaze (pay-as-you-go) plan.** Cloud Functions on the free
   Spark plan cannot make outbound network calls, and this relay calls both
   Gemini and the Play Developer API. At this project's measured cost —
   $0.013 per analysis (docs/16_ROADMAP.md phase 6) — Blaze billing for the
   relay itself is negligible; Firestore and Functions both have a free tier
   well above what a household's worth of traffic will use.
3. Add the Android app to the Firebase project with its real
   `applicationId` — `com.zandaulion.omaha`
   (`android/app/build.gradle.kts`) — and download the generated
   `google-services.json` into `android/app/`. It is not committed to the
   repository; it names the Firebase project and has no reason to be public.

## 2. Google Sign-In

Decided 2026-08-28 (doc 13 §7): the balance and the free grant are both keyed
to a real Google account, not an anonymous per-install identity, so a
purchase or a claimed grant survives a reinstall.

**Order matters here — the fingerprint first, then the provider.** A Google
Sign-In flow started before Firebase knows the signing key it should trust
fails without a clear error on the device; get the key registered before
touching the Authentication tab at all.

1. Get the SHA-1 (and SHA-256) fingerprints for **every signing config this
   build uses**. From `android/`:
   ```
   ./gradlew signingReport        # macOS/Linux
   gradlew.bat signingReport      # Windows
   ```
   Look for the `:app` module's `debug` and `release` variants in the output;
   each prints its own `SHA1` and `SHA256` lines. This project signs release
   builds with the debug config today (`android/app/build.gradle.kts`), so
   for now both variants print the *same* fingerprint — register it anyway
   under both slots in the next step, so nothing breaks silently the day
   release signing changes.
2. Firebase Console → the gear icon → **Project settings** → **Your apps** →
   the Android app (`com.zandaulion.omaha`) → **Add fingerprint**, under
   "SHA certificate fingerprints." Paste the SHA-1 from step 1. Add the
   SHA-256 too, if the console offers a second slot for it — some Firebase
   features want it, Sign-In itself only strictly needs SHA-1.
3. Authentication (may be nested under a "Build" or "Security" section
   depending on the console's current layout) → **Sign-in method** tab →
   **Add new provider** → **Google** → toggle **Enable**.
4. Firebase requires a **project support email** on this screen before it
   will save — pick whichever address should show up if a user ever sees a
   Google consent screen for this app. **Save.**
5. Firebase Console → **Project settings** → **General** tab, scroll to
   "Your apps" → the Android app → confirm `google-services.json` is current
   and re-download it if the console shows a banner saying it changed
   (adding the fingerprint or enabling the provider can trigger this) — drop
   the fresh copy into `android/app/`, replacing the one from §1.

## 3. Link the Firebase CLI to this project

Not yet covered above, and everything from here on needs it. This repo has no
`.firebaserc` — nothing on disk says which Firebase project `firebase`
commands should target until this step creates it.

1. Install the CLI, if `firebase --version` doesn't already work:
   ```
   npm install -g firebase-tools
   ```
2. Authenticate it to the Google account that owns the Firebase project:
   ```
   firebase login
   ```
   Opens a browser for the Google sign-in flow, same as any other Google
   OAuth consent screen.
3. From the repo root, link this checkout to the project created in §1:
   ```
   firebase use --add
   ```
   Pick the project from the list, then give it an alias — `default` is
   fine unless there's a reason to want more than one. This writes
   `.firebaserc`, which **is not committed** (it names the Firebase project,
   same reasoning as `google-services.json`) — every machine that runs
   `firebase deploy` needs to do this once.

## 4. The Gemini key

```
firebase functions:secrets:set GEMINI_API_KEY
```

Paste the same key already configured on the PWA's `.env`. One key, two
hosts — `functions/src/index.js` imports the identical `callGemini` the PWA
uses, so there is no second key to keep in sync, only the one to paste twice.

## 5. Deploy

Moved ahead of the two Play Console steps that follow — both of those need to
know the relay's own service-account identity, and the only reliable way to
know it is to have deployed once and looked. Nothing about deploying itself
needs Play Console configured first; the code does not touch Play at all
until someone actually calls `redeemPurchase`.

```
cd functions && npm install && cd ..
npm run bundle:functions
firebase deploy --only functions,firestore:rules
```

`firebase.json`'s `predeploy` hook runs the bundler automatically, so the
explicit `npm run bundle:functions` above is a local sanity check rather than
a required step — but running it by hand first means a stale bundle shows up
before the deploy does, not during it.

`firestore.rules` denies all client access outright — every read and write
goes through the three callables in `functions/`, running with Admin SDK
privileges the rules do not apply to. There is nothing to grant a client here,
by design.

## 6. Create the app in Play Console

Missed in the original runbook, found while walking through it live: §8 (the
two products) needs the app to exist — Play Console's Products page is
per-app, there is no way to define one before the app is there — and §7's
Play Developer API access grant needs it too, to scope the service account's
permissions to a specific app's purchase data. Neither needs the app
**published**; a draft is enough.

Assumes a Play Console developer account already exists. If it doesn't, that
is a separate, one-time $25 registration plus an identity-verification step
that has gotten stricter over the last couple of years — sometimes minutes,
sometimes days. Settle that first if it applies; nothing below can proceed
without a developer account regardless of anything in this repository.

1. Play Console → **All apps** → **Create app**.
2. App name **Pocket Omaha** (matches `android:label` in
   `android/app/src/main/AndroidManifest.xml`), default language, **App**
   (not Game), **Free**. The base app has no cost; only the AI credits are an
   in-app purchase, configured separately in §8.
3. Accept the standard declarations (Play policies, US export laws).
4. **Create app.** Play registers the package name as part of this flow — no
   separate step needed, though it may prompt for it explicitly if the console's
   current version splits that out.
5. If Play Console separately prompts for **Android developer verification**
   at this point, that is a newer, Google-wide identity requirement unrelated
   to anything in this project — complete it if asked, but it is a Play
   policy matter, not something this runbook or this assistant can help
   with further.

Nothing past this point needs the store listing, screenshots or content
rating finished — those belong to the actual release (phase 7 of
`docs/16_ROADMAP.md`), not to standing up the AI relay.

## 7. Play Developer API access, for the relay to verify purchases

The relay authenticates to the Play Developer API as its own Cloud Functions
runtime service account — deliberately not a downloaded JSON key (see
`functions/src/billing.js`'s header for why: nothing to leak, nothing to
rotate).

1. **Confirmed against a real deploy, 2026-08-29**: this project's functions
   are 2nd Gen (Cloud Run under the hood), and 2nd Gen uses the project's
   **default Compute Engine service account** unless a dedicated one is
   configured — `<project-number>-compute@developer.gserviceaccount.com`.
   The project number, not the project ID; the deploy log itself names it
   (search for `secretmanager.secretAccessor` in the deploy output — the
   automatic grant for `GEMINI_API_KEY` names the exact account), or it's on
   IAM → Service Accounts in the GCP console. Superseded here what an earlier
   draft of this doc only guessed at.
2. **Confirmed against a real console, 2026-08-29: there is no separate
   "API access" / link-the-GCP-project page any more.** An earlier draft of
   this doc described one; current Play Console has no such item in
   Settings or Developer account. Inviting the service account's email is
   the entire mechanism — Play Console → **Users and permissions** →
   **Invite new users** → paste the service account's email (§7.1's
   `<project-number>-compute@developer.gserviceaccount.com`) → assign
   permissions. Play resolves which GCP project it belongs to from the
   address itself; there is nothing to link beforehand.
3. Service accounts don't receive or click an email confirmation the way a
   human invitee does — the row shows **Active** immediately rather than
   sitting in a pending state. That is the confirmation the grant took,
   without a separate verification step.
4. **Confirmed against a real screen, 2026-08-29.** Check both:
   - **"View financial data, orders, and cancellation survey responses"** —
     its own description says it directly: "access the Purchases API." Covers
     `purchases.products.get`.
   - **"Manage orders and subscriptions"** — covers the write side,
     `purchases.products.acknowledge`. Its description ("View orders, refund
     orders, and cancel subscriptions") grants more than the relay actually
     uses — `functions/src/billing.js` never refunds or cancels anything —
     but Play Console offers no narrower checkbox between "read-only" and
     "orders in general," so this is the correct practical choice, not merely
     an acceptable one.

## 8. The two Play Store products

Play Console → Monetize → Products → **In-app products** (or **One-time
products**, depending on which UI generation the console shows — see
`docs/13_ANDROID_ARCHITECTURE.md` §7's note on this rename).

| Product ID | Type | Price | Credits |
|---|---|---|---|
| `omaha_credits_10` | **Consumable** | $0.99 | 10 |
| `omaha_credits_free_5` | **Non-consumable** | $0.00 | 5 |

**The type column is the one thing on this page that must not be gotten
backwards.** A consumable priced at $0.00 can be bought, consumed and bought
again by the same account with no limit — unlimited free credits, the exact
failure the non-consumable type exists to prevent. `functions/src/products.js`
encodes which is which on the relay's side; this table is where that gets
encoded on Play's.

The IDs above are what `functions/src/products.js` already expects. If a
different ID is used in Play Console, update that file to match before
deploying — a mismatch here is silent until someone actually buys or claims
one.

## 9. Verifying it actually works

No Android client exists for this yet (docs/16_ROADMAP.md phase 6, backend
slice) — the relay can be exercised directly once deployed, before any app
code calls it:

- **`getAiSummary`** needs no auth. Callable from the Firebase Console's
  Functions testing tool, or `curl` against its HTTPS trigger URL with
  `{"data": {"ticker": "AAPL"}}` — expect `{"result": {"summary": null}}` on
  a fresh project with nothing cached yet.
- **`generateAiSummary`** and **`redeemPurchase`** both require a real
  Firebase Auth ID token, which needs a signed-in Google account — these are
  realistically only testable once the Android client exists to produce one,
  or via the Firebase emulator suite with the Auth emulator's token-minting
  shortcuts.

The three unit-testable pieces — `functions/src/products.js`,
`functions/src/play-verify.js`, `functions/src/cache-key.js` — already have
coverage that runs with `npm test`, no emulator, no deployment. What is not
yet verified by anything is the actual Firestore transactions and the actual
Play Developer API call, since neither can run in this repository's test
environment. Worth an emulator-based integration pass before this carries
real money.
