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

1. Firebase Console → Authentication → Sign-in method → enable **Google**.
2. Project Settings → Your apps → the Android app → add **both** SHA
   certificate fingerprints — the debug keystore's and the release signing
   config's. Google Sign-In on Android fails silently for a fingerprint it
   does not recognise, and this project signs release builds with the debug
   config today (`android/app/build.gradle.kts`), so for now both fingerprints
   are the same key — add it anyway under both slots, so nothing breaks
   silently the day release signing changes.

## 3. The Gemini key

```
firebase functions:secrets:set GEMINI_API_KEY
```

Paste the same key already configured on the PWA's `.env`. One key, two
hosts — `functions/src/index.js` imports the identical `callGemini` the PWA
uses, so there is no second key to keep in sync, only the one to paste twice.

## 4. Play Developer API access, for the relay to verify purchases

The relay authenticates to the Play Developer API as its own Cloud Functions
runtime service account — deliberately not a downloaded JSON key (see
`functions/src/billing.js`'s header for why: nothing to leak, nothing to
rotate).

1. Deploy once first (§6 below) so the function's service account exists —
   its email is on the function's details page in the Firebase or GCP
   console, of the form
   `<project-id>@appspot.gserviceaccount.com` or a dedicated per-function
   identity, depending on how this project's Cloud Functions generation
   assigns them. Confirm the exact email there rather than assuming the
   pattern above; it has differed between Cloud Functions generations before.
2. Play Console → Setup → **API access** → link the Google Cloud project (if
   not already linked) → grant that service account access. **The exact
   permission names in this page have moved before and may again** — grant
   whatever covers reading and acknowledging a purchase (`purchases.products`
   read and acknowledge, in the API's own terms); Play Console's own UI names
   these more casually and that wording is not worth pinning here.

## 5. The two Play Store products

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

## 6. Deploy

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

## 7. Verifying it actually works

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
