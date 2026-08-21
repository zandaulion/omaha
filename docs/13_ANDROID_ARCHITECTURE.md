# Android Client — Architecture and Migration Plan

> **Status**: agreed plan, nothing built yet. Written 2026-08-20.
> **Purpose**: define how a native Android client reaches feature and visual
> parity with the PWA and *stays* there, without a server and without an account.
> **Scope**: this document decides architecture and sequencing. It does not
> restate the scoring rules (doc 02), the visual tokens (doc 04), or the alert
> semantics (doc 05); it says which side of the device boundary each of them
> runs on.

---

## 1. Requirements, and the one that does not survive contact

Stated requirements for the Android client:

1. Data lives only on-device. No login, no account, no ads.
2. Gemini analysis runs through Firebase and is a paid feature.
3. Import/export, plus quality-of-life features.
4. Feature set stays in sync with the PWA, permanently.
5. Visual design stays in sync with the PWA, permanently.

Requirement 2 was originally stated as *"the only thing leaving the device."*
It cannot be. The app is inert without Yahoo statement and quote requests, and
those leave the device on every cold ticker load. The accurate and still-strong
claim is:

> **No personal data leaves the device.** No account, no telemetry, no sync.
> Watchlists, theses, journal entries and settings are never transmitted.
> Market-data requests do leave the device, and the upstream sees the device IP
> and which tickers are being researched.

A second-order consequence, easy to miss: `buildPrompt(stock, thesis)` in
`server/gemini.js` takes the user's thesis and journal entries as an argument.
The AI feature therefore transmits **the most personal data in the app**. This
requires an explicit, default-off toggle — "include my notes in the analysis" —
not a line in a privacy policy.

---

## 2. Decisions

| # | Decision | Choice | Rejected | Why |
|---|---|---|---|---|
| D1 | Scoring/ingestion engine | Ship `core/` as JS, run on-device in **QuickJS** (`quickjs-kt`) | Port to Kotlin; Kotlin Multiplatform | One implementation, one test suite. Drift becomes impossible rather than merely discouraged |
| D2 | UI | **Compose native**, design tokens generated from one source | WebView shell; hybrid | Engine drift is silent and expensive; UI drift is visible and cheap. Share where failure is invisible |
| D3 | Repository | **Monorepo** — Android lives in this repo under `android/` | Separate repo; git submodule; npm package | Parity requires one commit and one CI run to gate core plus both consumers |
| D4 | User storage | **Room**, mirroring the existing SQLite schema minus the multi-device tables | DataStore only; files | Schema and queries already exist and are proven |
| D5 | Alerts | **WorkManager** + local notifications | FCM; keep server push | No server, nothing transmitted, and `evaluateTriggers` is already pure |
| D6 | AI transport | Firebase AI Logic behind a **Cloud Function relay** | Direct SDK call from app | The relay protects the Gemini quota; a local entitlement flag does not |
| D7 | Market data | **Yahoo at launch, behind a provider interface** | EDGAR now; licensed provider now | Risk scales with install count; the seam is cheap, the migration is not |

The rationale for D1 rests on a measured property rather than a preference:
`server/scoring.js` is 1,422 lines with **zero imports**, and `server/yahoo.js`
is 472 lines whose only environmental dependency is `fetch`. The engine was
already portable; it had simply never been asked to leave Node.

Verified during review: there is **no `Intl` usage and no `toLocaleString`**
anywhere in the portable code. `formatMoney` is hand-rolled over a currency
symbol table and `Number.prototype.toFixed`. QuickJS ships without full ICU, so
this would otherwise have been a blocking incompatibility.

---

## 3. What becomes shared, and what Android simply does not have

| Today | Destination | Change required |
|---|---|---|
| `server/scoring.js` (1422) | `core/scoring.js` | **none** — already pure |
| `server/yahoo.js` (472) | `core/yahoo.js` | **none**, given a host `fetch` |
| `server/finance.js` (661) | split | assembly to core; cache calls move behind an injected `cache` interface |
| `server/gemini.js` (721) | split | `buildComprehensivePayload`, `buildPrompt`, `RESPONSE_SCHEMA` to core; transport to a per-host adapter |
| `server/alerts.js` (504) | split | `evaluateTriggers` to core; sweep loop and delivery to host |
| `server/*.test.js` (941) | `core/` | **none** — keeps running under `node --test` |

Roughly **2,600 lines become shared**. The test suite moves with the engine and
keeps its value: 32 assertions in `scoring.test.js`, each corresponding to a
defect that shipped once already.

Approximately **1,270 lines have no Android equivalent at all** — `auth.js`
(401), `push.js` (127), and most of `index.js` (746). Invites, device binding,
VAPID subscriptions and HTTP routing exist because the PWA is delivered over a
network to multiple devices. A single-device on-device app needs none of it.

---

## 4. Host interface

`core/` must not know which runtime it is in. It requires four things:

| Capability | Node (PWA) | Browser (PWA) | Android |
|---|---|---|---|
| `fetch` | native | via server proxy | OkHttp, injected |
| storage (`core/store.js`) | SQLite (`server/store.js`) | IndexedDB | Room |
| `now()` | `Date.now` | `Date.now` | `Date.now` |
| `log(level, msg)` | `console` | `console` | Timber bridge |

`fetch` is provided as a **global**, not threaded through a factory. This is
what keeps `yahoo.js` at a zero-line diff, and it matches how QuickJS injection
works: `quickjs-kt` exposes `asyncFunction("fetch") { ... }`, which surfaces a
Kotlin suspend function to JS as a Promise-returning async function. ES modules
are nominally supported via `asModule = true`.

**That last point turned out to be wrong**, and only the device work revealed
it: registering a second module on one QuickJS instance crashes the process.
`core/` is therefore flattened to a single ES module before it reaches the
engine — see §20.

**The one real integration wrinkle.** `yahoo.js` uses `AbortSignal.timeout(...)`
and reads `res.headers.get('set-cookie')`. QuickJS has neither `AbortSignal` nor
`Response`. The fix is a small JS shim over a single Kotlin
`asyncFunction("__httpFetch")` returning `{status, ok, headers, body}`, with
`Response` and `AbortSignal` reconstructed in JS. **Keep the shim on the JS side
of the bridge** — that is what prevents `yahoo.js` from ever growing an
Android-specific branch.

Note that the browser is the constrained runtime here, not Android. `Cookie` and
`User-Agent` are forbidden headers in `fetch`, and Yahoo sends no CORS headers,
so the PWA can never call Yahoo directly. That restriction is the entire reason
`server/` exists. Android, using OkHttp, has no such limit and can be genuinely
serverless.

---

## 5. Repository layout

```
omaha/
├── core/                    # shared JS engine + tests — single source of truth
│   ├── scoring.js           #   moved verbatim
│   ├── errors.js            #   typed ingestion failures
│   ├── time.js              #   engine-independent timestamp parsing
│   ├── providers/           #   market-data seam (§8) + yahoo.js
│   ├── analysis/prompt.js   #   Gemini payload and prompt
│   ├── alerts/triggers.js   #   trigger rules
│   ├── model/               #   assembly — pending, step 1b
│   └── __fixtures__/        #   recorded upstream responses (§17)
├── design/tokens.json       # single source for both palettes
├── test/golden.test.js      # whole pipeline, replayed offline
├── tools/
│   ├── fixture-http.js      # record/replay classifier
│   └── gen-tokens.mjs       # emits web/tokens.css + Tokens.kt
├── server/                  # PWA host: express, sqlite, auth, push
├── web/                     # PWA client, unchanged
└── android/
    ├── core-js/             # core/ as assets + QuickJS engine + fetch bridge
    ├── data/                # Room, DataStore, import/export
    ├── design/              # generated Tokens.kt + shared composables
    ├── work/                # WorkManager sweep + local notifications
    ├── billing/             # Play Billing + entitlement
    ├── ai/                  # Cloud Function client
    └── app/                 # Compose UI — four views
```

A submodule or published package would put a version-skew window between a
scoring change and its arrival in each consumer. That window is precisely the
drift requirement 4 forbids, so it is designed out rather than managed.

---

## 6. Data and privacy model

On-device, in Room, mirroring the current schema: `theses`, `watchlists`,
`app_settings`, `stock_snapshots`, `notification_settings`,
`notification_history`, `stock_cache`, `ai_summaries`. Dropped: `devices`,
`invites`, `push_subscriptions`.

What crosses the device boundary, exhaustively:

| Traffic | Contains | When |
|---|---|---|
| Yahoo market data | ticker symbol, device IP | every cold load and every alert sweep |
| Cloud Function to Gemini | financial data package, **and thesis/journal if opted in** | only on explicit user request, only when paid |
| Play Billing | purchase token | at purchase and entitlement check |

No telemetry, no crash reporting that carries user content, no analytics.

---

## 7. Paid AI feature

Free app, paywall only on the component with a marginal cost. The paywall's
purpose is **cost control, not revenue protection** — copying and forking are
explicitly not a concern.

That framing decides the design. If the app called Firebase AI Logic directly,
App Check (Play Integrity) would prove the *app* is genuine but not that the
*entitlement* is real; a flipped local flag on a rooted device spends the
project's Gemini quota. A **Cloud Function** that verifies the Play purchase
token against the Play Developer API before relaying is what actually protects
the budget.

* **Consumable credit packs**, not a one-time unlock. A permanent unlock against
  a Re-Analyze button is unbounded cost liability.
* **Anonymous Firebase Auth** provides an install identity for the credit
  balance. It is not a login and requires no user action.
* **Play Billing is mandatory** for a digital feature. A Play account is not an
  app account, so requirement 1 holds.
* The existing on-device `ai_summaries` cache is the primary cost control and
  must be preserved.
* Prompt construction stays in `core/` on-device; the function is a thin
  verified relay, not a second implementation.

Play requires disclosure of AI-generated content, and a financial app needs
explicit "not investment advice" framing.

---

## 8. Market data

### The position

Yahoo's endpoints are unofficial. Yahoo shut the public finance API down in
2017; `yahoo.js` sends a spoofed desktop User-Agent and a crumb harvested from
`fc.yahoo.com`. On a self-hosted invite-only PWA this is unremarkable. Shipping
it to Play changes the risk profile in four specific ways:

* **Total** — ingestion failure blanks every number on every screen
* **Not reproducible** — carrier CGNAT pools many subscribers behind one IP, so
  failures correlate with carrier, not with anything observable locally
* **Not fixable quickly** — staged rollout instead of a service restart
* **Publicly attributed** — users see the app failing, and Play ratings persist

The ToS exposure is real but secondary; the operational profile is the problem.

### Why not simply switch providers

Feature 8 in the README is *"Zero-Recurring-Cost Architecture ... no API keys."*
Yahoo is load-bearing for the product's economics, not merely its data. And the
substitution is not clean: a licensed provider needs a key, a key in a client
binary gets extracted, protecting it needs a relay — and **free tiers are
per-key, not per-user**, so a 250–800 request/day allowance shared across an
install base is exhausted at single-digit user counts. "Use a proper provider"
means "accept a permanent monthly bill."

### The asymmetry

The two data needs have different answers, and the split maps onto criticality:

* **Statements** — a proper free solution exists. SEC EDGAR's XBRL
  `companyfacts` API is official, unlimited, keyless, and returns the filed
  number rather than Yahoo's re-derivation of it. Covers US registrants
  including foreign private issuers filing 20-F/40-F; does not cover
  non-US-listed companies. Tag variance across filers is real work — but it is
  the same shape as the alias handling `FIELD_MAP` already performs.
* **Quotes, prices, search, peers** — no credible free legitimate source.

Moving statements to EDGAR would make a Yahoo outage *degrading* rather than
*fatal*: solvency, moat quality, growth, capital allocation, the full checklist
and every chart would survive; only the live price and the valuation pillar
would be lost.

### Decision

**Ship Yahoo. Build the seam. Defer the migration.**

> **Revised 2026-08-22 — see `14_DATA_SOURCING_AND_PLAY_RELEASE.md`.** The seam
> is built. The migration trigger below ("sustained 429s or a schema break")
> should be brought forward to precede the public Play release: EDGAR turns out
> to cost nothing, cover every ticker tested including foreign issuers, and
> carry the reporting currency explicitly. Doc 14 has the verified numbers, the
> IFRS tag map and the provider contract.

Risk is a function of install count. The seam — a provider interface
(`getStatements(ticker)`, `getQuote(ticker)`) with Yahoo as the sole
implementation — costs an hour of care during a refactor already scheduled, and
converts a future migration from a rewrite into a new file.

**Migration trigger**: sustained 429 rates in the field, or a Yahoo schema
break, whichever comes first.

### Hotfix path

Because `core/` is interpreted JS loaded from assets, an ingestion fix can ship
out-of-band and take effect in minutes instead of days. Google Play permits OTA
updates of interpreted code and assets provided they do not materially change
the app's purpose or bypass review — the same mechanism React Native's CodePush
and Expo Updates rely on. **Scope this strictly to `core/` ingestion fixes.**
Shipping features this way is not permitted and would put the listing at risk.

This is a second, independent argument for a clean `core/` boundary: it is the
outage remedy.

---

## 9. Defects found during review — fix during extraction

These are present in the PWA today. Each is survivable on a single-user server
and becomes materially worse on mobile.

**Status: all five fixed during step 1.** Two entries below were revised once
the code was actually changed rather than only read — the corrections are
recorded rather than silently replaced, since the original readings drove
decisions above.

| # | Defect | Location | Consequence | State |
|---|---|---|---|---|
| 1 | `getSession(force)` is **never called with `true`** — all five call sites pass no argument, so there is no crumb-expiry recovery | `yahoo.js` | A crumb invalidated before the local 6h timer leaves every request failing until the timer expires | fixed |
| 2 | No 429/403 typing — every failure is a generic `Error` | `yahoo.js`, all fetches | Rate limiting indistinguishable from a dead ticker; no caller can back off | fixed |
| 3 | ~~Alert sweep fires as an unjittered burst~~ **Corrected**: the sweep is already serialised at 1200 ms per ticker. The real defect is that it called `getStockData(ticker, true)`, force-refreshing past *both* cache tiers | `alerts.js` | Four requests per holding per sweep — full statement history re-fetched four times a day for filings that change quarterly | fixed |
| 4 | `new Date(ts)` on a SQLite `'YYYY-MM-DD HH:MM:SS'` string | `finance.js:17` | **Corrected — worse than recorded.** Not merely a QuickJS portability risk: V8 reads that form as *local* time, so every cache age was inflated by the host's UTC offset. Measured at UTC+3: a row written 24 s earlier read as 180.4 minutes old. The 15-minute quote tier had **never** been reachable, and every page load re-fetched from Yahoo | fixed |
| 5 | **Found during step 1.** A rate limit on an uncached ticker returned `null`, which the route rendered as `404 No listing found for <TICKER>` | `finance.js`, `index.js` | The app asserting a real company does not exist — the exact class of confident fiction the README's rule forbids. Now a 503 with `Retry-After` | fixed |

Defect 4 is the largest single reduction in upstream traffic in this plan, and
it was invisible from reading alone; it needed the value printed. Defect 3
compounds it: between them the sweep's cost per holding drops from four
requests to one on three sweeps in four.

**Also worth recording**: `search()` already loops over `query1` and `query2` as
a fallback, which is evidence of host-level flakiness handled in exactly one
place. The peers endpoint is on **v6** while the rest of the surface is v8/v10,
making it the most likely to disappear.

### Request fan-out, for reference

Measured from `getStockData` in `server/finance.js:86`:

| Scenario | Requests |
|---|---|
| Warm (quote <15min, statements <24h) | 0 |
| Quote stale, statements fresh | 1 |
| Cold or forced | 4 — quote, then annual + quarterly statements, plus price history |
| Currency mismatch | +1 (FX) |
| Session expired | +2 (cookie + crumb) |

Extending the statement TTL well past 24 hours is defensible — filings change
quarterly — and cuts worst-case sweep cost proportionally.

---

## 10. Keeping the two clients in sync

Parity is only real if a mechanism enforces it. Two gates:

**Visual.** `design/tokens.json` is the single source. `tools/gen-tokens.mjs`
emits both `web/tokens.css` and `android/design/.../Tokens.kt`. CI fails if
generated output differs from what is committed, so neither side can be
hand-edited. Bundle **Inter** and **JetBrains Mono** in the APK — Roboto will
not reproduce the type scale in doc 04.

Charts are lower risk than they appear: the revenue/FCF and liquidity charts are
CSS-styled div columns, and only the margin trajectory uses inline SVG. Compose
equivalents are weighted `Column`s and one `Canvas` path — not a charting
library dependency.

**Behavioural.** Record real Yahoo responses as fixtures. Run `core/` against
them under Node and snapshot the complete stock model JSON. Then run **the same
fixtures through QuickJS** in an Android instrumented test and assert
byte-identical output.

That test does not verify the scoring logic — the existing suite does that, and
it is literally the same source file. It is an alarm for *engine* divergence:
date parsing, number formatting, `toFixed` rounding edges. It is the mechanism
that turns "always in sync" from an intention into a build failure.

---

## 11. Sequencing

The test baseline is **61**, not the 32 the README cites — that figure counts
`scoring.test.js` alone, and `alerts.test.js` (7) and `gemini.test.js` (6) also
run. Step 1 took it to 76.

**Steps 1 and 2 were reordered once step 1 was underway.** Splitting `finance.js`
meant moving ~450 lines of model assembly that had no test coverage at all, so
the golden-model gate from §10 — planned as an Android parity check for much
later — was brought forward to serve as the safety net for that move. It also
decoupled the two open risks: `core/` already holds scoring, ingestion, the
prompt and the alert rules, which is enough to answer the QuickJS question
without waiting for `finance.js`.

| # | Milestone | Exit criterion |
|---|---|---|
| 1 | Extract `core/`, keep the PWA green | No unintended behaviour change. Includes defects 1–5 and the provider seam — **done**, see §16 |
| 1a | Golden model fixtures | Recorded upstream responses replay offline to a byte-identical model — **done**, see §17 |
| 1b | `finance.js` split | Store contract defined; assembly in `core/`; golden snapshots unchanged — **done**, see §19 |
| 2 | QuickJS spike | Reproduces the golden snapshots for `NOK`, `AAPL` and `JPM` — **done on JVM (§18) and on device (§20)** |
| 3 | Room + import/export | A PWA backup imports into Android and back out, losslessly — **done, see §21 and §22**. SAF file picker outstanding |
| 4 | Compose UI | Watchlist → Deep Dive → Screener → Compare, tokens generated, screenshot diffs passing |
| 5 | WorkManager sweep + local notifications | Alerts fire on-device with no network beyond market data |
| 6 | Billing + relay + Firebase AI Logic | Paid analysis end-to-end |

Step 1 carries the most risk and touches the working PWA, so it ships alone.
Step 2 validates the entire D1 premise in a day or two — if QuickJS proves
unworkable, that is when to find out, before any UI exists. Steps 1–5 are
shippable without any infrastructure at all; only step 6 needs Firebase.

---

## 12. Import / export

The interchange format is shared with the PWA's existing `/api/theses` backup,
in both directions.

* `schemaVersion` field on every export; refuse to import an unknown major
* Last-write-wins per ticker on `updated_at`
* Journal entries merged by id — they are append-only, so union is correct
* Android side via SAF, so the user picks the destination
* Optional passphrase encryption, since journals are personal

Getting the format aligned in step 3 is what makes the two clients usable
together rather than as alternatives.

---

## 13. Open questions

* **EDGAR coverage** against the actual watchlist — worth measuring before
  committing to it as the statement path, since non-US listings fall outside it.
* **QuickJS APK size and cold-start cost** — unmeasured. `quickjs-kt` documents
  neither. Step 2 should record both, including bytecode-cache warm start.
* **Sweep reliability under Doze and OEM task killers** (Samsung, Xiaomi). A 6h
  cadence will be approximate. Whether to prompt for a battery-optimisation
  exemption is a UX decision deferred to step 5.
* **Android 13+ `POST_NOTIFICATIONS`** — where in the flow to request it.
* **Credit pack pricing** — needs a measured cost-per-analysis from real Gemini
  token counts before it can be set.

---

## 14. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Yahoo breaks ingestion again | High — it already happened once (doc 10 §2) | OTA hotfix via `core/`; provider seam; EDGAR migration trigger |
| Rate limiting via carrier CGNAT | Medium | Jittered serialised sweep, `Retry-After`, longer statement TTL, legible stale-data messaging |
| Compose UI drifts from the PWA | Medium | Generated tokens, screenshot diffs, one view at a time |
| QuickJS proves unworkable | Low | Discovered at step 2, before UI investment |
| Gemini quota drained by modified clients | Low | Cloud Function verifies the Play purchase token server-side |
| Play policy on OTA updates | Low | Scope strictly to ingestion fixes, never features |

---

## 15. What this does not change

The PWA keeps needing `server/`, permanently. Browsers cannot set `Cookie` or
`User-Agent` and Yahoo sends no CORS headers, so the proxy is not removable.
This plan makes the *engine* shared; it does not retire the PWA's host.

---

## 16. Step 1 status

Done, on branch `extract-core`. 76 tests pass, up from a 61 baseline; the
end-to-end path was verified against live Yahoo via `npm run prompt` on `NOK`,
which returned 19 of 19 sub-scores measurable against FY2025 with the
EUR-reporting / USD-trading conversion exercised.

| Item | State |
|---|---|
| `core/scoring.js` + tests | moved verbatim, zero diff |
| `core/providers/yahoo.js` | moved, typed errors and crumb recovery added |
| `core/providers/index.js` | provider seam — `getStatements`/`getQuote`/… |
| `core/errors.js` + `core/time.js` | new, both pure, both tested |
| `core/analysis/prompt.js` | 587 lines out of `gemini.js` (721 → 156) |
| `core/alerts/triggers.js` | `evaluateTriggers` and its rule tables |
| Defects 1–5 | fixed, each pinned by a test |

**Deliberate behaviour changes** — all four are corrections, but none is a pure
refactor and each should be read as a change:

1. The 15-minute quote cache now functions (defect 4). Upstream request volume
   falls sharply; nothing else about the data changes.
2. The alert sweep no longer force-refreshes (defect 3).
3. A rate limit on an uncached ticker is a 503 with `Retry-After`, not a 404
   (defect 5). Clients treating any non-200 as "unknown ticker" will need to
   distinguish the two.
4. The sweep abandons its run on `rate_limited` rather than continuing down the
   watchlist into a block that just rejected it.

### Not done at the time

`finance.js` still reached for `db` directly, and the model-assembly half had
not moved. Both were completed in step 1b — see §19.

### Follow-up found but not fixed

`search()` returns `[]` when every host fails, so a rate-limited search is
indistinguishable from a genuine no-results — the same conflation as defect 5,
in a place where fixing it changes a function's contract. `stale` is also set on
every cached response and no client reads it, so the age-stamped banner doc 09
specifies is not actually driven by it.

---

## 17. Golden model fixtures

`test/golden.test.js` replays recorded upstream responses through the entire
pipeline — raw bytes to scored model — and asserts the result field for field.
84 tests total, verified on Node 24 and on Node 22, the container's runtime.

| Fixture | Exercises |
|---|---|
| `NOK` | EUR reporting against USD trading; the FX conversion path |
| `AAPL` | Full measurement coverage; a September fiscal year end |
| `JPM` | Financial sector — Altman Z inapplicable, 5 of 12 checks unmeasurable |

Recorded live with `node scripts/record-fixture.mjs`, not written by hand: a
hand-made fixture encodes what we believe the upstream returns, and the defects
worth catching are the ones where that belief is wrong. Recording captures 6–7
calls per ticker, which is the cold-load fan-out §9 predicts.

**This is a characterisation test, not a correctness test.** The snapshots were
generated by the code they now guard, so they cannot show that today's numbers
are right — `core/scoring.test.js` is what argues for that. They show that
tomorrow's numbers are the same. The test file carries a second set of
assertions that do not depend on the snapshots at all (a bank must report
Altman Z as `null`, a depositary receipt must keep its two currencies apart), so
a snapshot regenerated around a defect still fails.

The guard was verified by breaking it: changing `toFixed(2)` to `toFixed(3)` in
`buildHistory` — one character — failed all three snapshots while leaving the
independent assertions green, which is the intended layering.

The replay stub refuses any call it has no fixture for, rather than falling
through to the network. A golden test that quietly reaches upstream is not a
golden test, and that failure mode is invisible unless it is asserted; one of
the tests asserts it.

### For the QuickJS spike

These files are the spike's exit criterion. Run the same fixtures through
QuickJS on Android and diff against `<TICKER>.model.json`. Any difference is
engine divergence — date parsing, number formatting, `toFixed` rounding edges —
not a logic difference, because it is the same source file. That makes the
spike a measurement rather than an impression.

`tools/fixture-http.js` holds the classifier both the recorder and the replayer
use. It lives in `tools/` rather than `test/` because Node's test runner treats
every `.js` under `test/` as a test file, and a helper counted as a passing test
inflates the suite for no reason.

---

## 18. QuickJS spike — results

**D1 is validated.** `core/scoring.js` runs unmodified under QuickJS and
produces output byte-identical to Node for all three fixtures, including the
bank whose Altman Z must stay `null` and the depositary receipt with its two
currencies.

Run it with `cd android && ./gradlew :engine:test`.

| Measurement | Value |
|---|---|
| First score, cold interpreter | ~5 ms |
| Per score, mean of 10 | ~3.3 ms |
| Scoring parity, NOK / AAPL / JPM | byte-identical to Node |

Both figures include **building a whole new interpreter per call** (see below),
so they are an upper bound rather than a warm-path number. Against a 6-hourly
sweep of a 20-holding watchlist — 60 ms of scoring in total — the cost is not a
consideration. This closes the cold-start half of the §13 open question; APK
size is still unmeasured, because the spike is a JVM module and carries no APK.

`:engine` is deliberately plain Kotlin/JVM. QuickJS is the same engine on both
targets, so the parity question was answerable without an emulator, in seconds,
in CI. The Android variant follows.

### The dependency is pre-release

`io.github.dokar3:quickjs-kt` is at **1.0.0-alpha13**, which doc 13 did not
account for when D1 was decided. The spike found two defects in it. Neither
changes the decision — the binding is a thin JNI layer over QuickJS itself,
which is mature and widely embedded — but both had to be worked around, and
both are the kind that fail silently rather than loudly.

**Non-BMP characters truncate the returned string.** The binding sizes the
Kotlin string by code-point count rather than UTF-16 code-unit count, so every
surrogate pair costs one character off the *end*. Measured exactly: two emoji,
two characters lost; one emoji, one character. This app is squarely in the
blast radius — scoring output carries 💎 and 🚀 in catalysts and ⚠️ in risks —
and because the loss lands on the tail, it destroys the closing braces and
surfaces as unparseable JSON rather than as a visibly wrong character.

*Workaround*: nothing but ASCII crosses the bridge. The JavaScript side escapes
every non-ASCII code unit as a `\uXXXX` sequence, which is valid JSON, and
parsing on the Kotlin side restores it.

**A second evaluate on one instance fails.** Calls alternate deterministically —
first succeeds, second throws `TypeError: cannot read property 'value' of
undefined`, third succeeds — independent of payload size and of what the
bindings return.

*Workaround*: one interpreter per scoring call. The measurements above show
that is affordable.

`QuickJsBindingQuirksTest` pins both defects. **A failure there is good news**:
it means an upgrade fixed one, and `ScoringEngine` can drop the corresponding
workaround. Without those tests the workarounds would be carried indefinitely
on the strength of a comment.

### What the spike did not cover

* The `fetch` shim — `AbortSignal` and `Response` reconstruction for
  `providers/yahoo.js`. Scoring needs no I/O; ingestion does.
* Multi-module resolution. `scoring.js` imports nothing, so a flat module name
  sufficed. `providers/yahoo.js` imports `../errors.js` and will need specifiers
  registered under the exact strings it uses.
* Anything on an actual device: APK size, ABI splits, cold start on ARM.

---

## 19. Step 1b — the finance.js split

`core/` is now host-independent. It imports nothing from `server/`; the whole
import graph is internal plus `node:assert` in the tests. A host supplies two
things and gets a scored stock back.

| | Before | After |
|---|---|---|
| `server/finance.js` | 661 lines, four direct `db` call sites | **19 lines** — registers the SQLite store, re-exports `core/` |
| `core/stock.js` | — | 210 — `getStockData`, `searchStocks`, the cache-tier and staleness decisions |
| `core/model/assemble.js` | — | 223 — `buildModel`, trend series, FX normalisation |
| `core/model/pe-history.js` | — | 98 — the stock's own P/E range |
| `core/model/record.js` | — | 122 — `toRecord` and `formatCachedStock`, a matched pair |
| `core/store.js` | — | the storage contract, plus the sector median |

`getStockData` moved rather than staying behind, because it is not plumbing:
which cache tier is still valid, when stale data beats no data, and when a
failure must be reported rather than papered over are judgements, and a Kotlin
reimplementation of them would be a second set of answers to the same
questions.

### The storage contract

Four calls. Android implements these against Room; `server/store.js` is the
SQLite reference.

| Call | Returns |
|---|---|
| `read(ticker)` | the cached row, or null |
| `save(record, hasFundamentals)` | — upserts; the flag decides whether the statement timestamp advances |
| `searchCached(query)` | locally known tickers, best match first |
| `sectorFinancials(sector, excludeTicker)` | parsed `financials` for a sector's other constituents |

The line is drawn so **queries live in the host and arithmetic lives in core**.
`sectorFinancials` returns rows rather than a median, because the median is a
scoring input: it is the threshold a company's asset turnover is judged
against, and a host computing it independently would be a second definition of
a number the user sees. `hasFundamentals` matters for the same kind of reason —
a quote-only refresh that advanced the statement timestamp would make stale
filings look fresh and quietly disable the 24-hour tier.

### The golden gate earned its keep immediately

Moving `applyFxNormalisation` into `core/model/assemble.js`, the provider was
imported under its seam name `getFxRate` while the function body still called
`fetchFxRate`. **Only NOK caught it.** AAPL and JPM return before the FX call
because they report and trade in one currency, so both passed; the suite would
have gone green and the defect would have shipped, breaking every depositary
receipt and nothing else.

That is the argument for §17's fixture selection in one line: three tickers
chosen for materially different paths, not three tickers.

---

## 20. On-device results

`core/scoring.js` now scores byte-identically in **Node, JVM QuickJS and
Android QuickJS**. Six instrumented tests pass on a Pixel 9a emulator running
API 37 with a 16 KB page size.

```bash
cd android && ./gradlew :engine-android:connectedDebugAndroidTest
```

Getting there took three findings that no amount of reading would have
produced. Each is recorded here because each one changed the design.

### The engine cannot be shipped as a module graph

`quickjs-kt` accepts ES modules, so §4 originally said `core/` needed no
bundler. Registering a **second** module on one instance faults in native code
— `EXCEPTION_ACCESS_VIOLATION`, a process kill rather than a catchable error.

`core/` is now flattened by `tools/bundle-core.mjs` (esbuild) into
`core/dist/scoring.bundle.js`, 44 KB, one module, no imports. Gradle regenerates
it before packaging, so the APK cannot ship a stale engine, and
`test/bundle.test.js` fails if a committed bundle has drifted from its sources.

This is a build step, not a second source of truth. It is also not a workaround
that should be undone lightly: one module per interpreter is a reasonable thing
for an embedded engine to want, and the bundle loads faster than a graph would.

### `toFixed` is not portable, and it changed a number the user reads

The same source, three engines:

| | Node (V8) | QuickJS/JVM | QuickJS/Android |
|---|---|---|---|
| `(4.25).toFixed(1)` | 4.3 | 4.3 | **4.2** |
| `(0.125).toFixed(2)` | 0.13 | 0.13 | **0.12** |
| `(2.5).toFixed(0)` | 3 | 3 | **2** |

Android rounds ties to even; the others round away from zero, which is what
ECMAScript specifies — "if there are two such n, pick the larger n". QuickJS
delegates decimal conversion to the platform C library, and Bionic differs from
the desktop libcs.

It surfaced as the PWA reporting *"ROIC of 4.3%"* and the app *"ROIC of 4.2%"*
for the same company on the same filings. The underlying value was identical.
Only the rendering differed — and the rendering is what a person reads.

`core/format.js` replaces `toFixed` throughout `core/` (72 call sites). It
decomposes the double to its exact `m * 2 ** e` form and rounds in integer
arithmetic, because IEEE 754 *arithmetic* is identical on every engine and only
decimal *formatting* varies.

A first attempt scaled by a power of ten and rounded that — which is wrong, and
the golden fixtures caught it: `61.555` is below its midpoint but `61.555 * 100`
lands above it, and a cash balance moved by a cent. `format.test.js` now sweeps
~160,000 values against V8 plus every three-decimal midpoint under 400.

### The measurements

Measured on a **Samsung SM-F936B (Galaxy Z Fold 4), Android 16 (API 36),
arm64-v8a** via the sideloadable harness in `android/selftest`, and on the
Pixel 9a emulator via the instrumented suite.

| | Handset (arm64) | Emulator (x86_64) |
|---|---|---|
| Scoring parity, all three fixtures | byte-identical to Node | byte-identical |
| First score | **7.1 ms** | 22.5 ms |
| Per score, mean of 10 | **6.0 ms** | 43.1 ms |
| Page size | 4 KB | 16 KB |

| Artifact | Size |
|---|---|
| APK total, 4 ABIs, unminified | 4,079 KB |
| Native library, arm64-v8a | 833 KB |
| Engine bundle (the assets) | 44 KB |

**Roughly 0.9 MB is the real cost on a modern phone** — one ABI via App Bundle
plus the JS. The remaining ~3 MB of the probe APK is `classes.dex`, almost all
Kotlin stdlib and coroutines, which a real app carries anyway and R8 would cut.

**The handset is about seven times faster than the emulator**, which is the
opposite of the direction the earlier caution here implied. The emulator figures
were pessimistic, not optimistic: a software-rendered x86_64 image on a desktop
CPU is slower at this than the ARM core it is standing in for. The caveat was
right that emulator numbers do not transfer; it was wrong about which way they
would move.

At 6 ms a score, a six-hourly sweep of a twenty-holding watchlist spends about
**120 ms scoring**. Whatever eventually constrains this app, it is not the cost
of running the engine in JavaScript.

### Still open

* ~~The `fetch` shim~~ — **done, see §23.**
* R8 keep rules for the JNI surface, once there is an app to minify.

---

## 21. The interchange format

`core/backup.js` defines the format and the merge rules; both clients apply the
same ones, because a merge implemented twice is a merge that eventually loses
somebody's note.

The PWA half is wired end to end: `GET /api/theses` exports through
`buildBackup`, and `POST /api/backup/import` merges. **Restore did not exist
before this** — the README had promised "backup export and restore" while only
export was built, so a person who exported a file had no way to use it.

### Rules, and why they differ

**A thesis takes the newer version whole; its journal entries are unioned.** A
thesis is a document that gets rewritten, so the later `updatedAt` wins. Journal
entries are append-only — nothing in either client deletes one — so entries from
the *losing* side are kept. Editing a thesis on one device and writing a note on
another must not cost you the note. That is the single most important line in
the module.

**A watchlist takes the newer version whole, tickers included.** Unioning them
would be friendlier right up until it resurrected a holding someone deliberately
sold. A list that will not let go is worse than one that occasionally needs
re-adding.

**Ties go to what is already here**, which is what makes a repeated import a
no-op rather than a slow accumulation of duplicates.

### Details that turned out to matter

* **Entry ids are `Date.now()`** — unique on one device, not across two. Two
  genuinely different notes can collide. Colliding entries with different
  content are both kept, with the newcomer's id disambiguated, because silently
  dropping one is the exact failure this module exists to prevent.
* **`updatedAt` arrives from SQLite as `YYYY-MM-DD HH:MM:SS`**, so comparison
  goes through `core/time.js` rather than `Date.parse`. Read as local time, a
  close conflict would be resolved by the importing machine's timezone offset.
* **Watchlists now carry `updatedAt` in the export.** Its absence meant every
  watchlist conflict would have been a guess.
* **Files exported before versioning are readable.** Version 1 is deliberately
  the shape the PWA has always emitted, `is_default` spelling included. People
  have those files already; refusing them would be a poor first act.
* **A newer major version is refused, not partially read.** Dropping fields it
  does not understand would lose data while reporting success.

### The routing bug a live test caught

The import endpoint was first written as `POST /api/theses/import`. Express
matches in declaration order and `/api/theses/:ticker` is declared above it, so
the whole backup was filed as a thesis for a company called **IMPORT**. Every
unit test passed; only an HTTP call against a running server showed it.

It now lives at `/api/backup/import`, a path that cannot collide however the
routes are later reordered.

### Still to build

Room, and the Android side of import/export via SAF. The format, the merge and
the PWA end are done and tested — `core/backup.test.js` for the rules,
`test/backup-roundtrip.test.js` for the SQLite mapping either side of them.

---

## 22. Room, and the backup round trip on device

A backup produced by the PWA imports into Android and exports again unchanged.
Five instrumented tests, run on a Pixel 9a emulator.

```bash
cd android && ./gradlew :data:connectedDebugAndroidTest
```

The fixture is not hand-written: `core/__fixtures__/backup.pwa.json` was
produced by the PWA's own export path, so the Android test reads what the other
client actually emits. `test/backup-roundtrip.test.js` asserts that file still
round-trips through Node, so it cannot drift away from the format it claims to
represent.

| Test | What it protects |
|---|---|
| imports and exports unchanged | every thesis, tag, trigger and journal entry survives |
| emoji survive | the bridge truncation, in the place people actually use emoji |
| repeated import is a no-op | ties resolve to what is already here |
| a local note survives an older import | the rule the merge module exists for |
| a newer schema is refused | and nothing is written |

### Nothing about meaning was written in Kotlin

`core/backup.js` runs in QuickJS through `JsBridge`; `PersonalDataStore` only
moves rows between Room and the interchange shape, exactly as
`server/backup-store.js` does for SQLite. Which version wins and which entries
merge is decided in one place, by one implementation, for both clients.

`JsBridge` generalises what `ScoringEngine` had been doing alone: JSON in, JSON
out, one interpreter per call, ASCII across the wire, and errors reported
through a binding so the message `core/` wrote survives instead of being
flattened into a QuickJsException.

### Two things the device found

**Export order was not canonical.** `mergeBackup` sorted theses by ticker while
`buildBackup` preserved input order — and the PWA reads theses with no
`ORDER BY` while Room's DAO orders by ticker. The same data would have exported
in two different orders from the two clients, making the files
non-comparable and every diff noisy. `buildBackup` now sorts, so a merged
export and a fresh one agree.

**Room stores ISO-8601, SQLite stores `datetime('now')`.** Both are read through
`core/time.js`, which is why a thesis edited on the phone and one edited in the
browser compare correctly rather than by whichever host happened to write the
timestamp.

### Still to build

The SAF file picker — choosing a file to import and a destination to export to.
That is UI, and it belongs with the Compose work in step 4 rather than ahead of
it. The storage, the format and the merge are done and tested on both clients.

Room is deliberately narrow: two tables. The PWA's schema has ten, but the rest
are either cache that will be re-fetched or the multi-device apparatus —
devices, invites, push subscriptions — that exists only because the PWA is
served over a network.

---

## 23. The fetch bridge

`core/providers/yahoo.js` runs under QuickJS and parses byte-identically to
Node, replaying the same recorded fixtures. On a real handset it then does it
for real — measured on the Galaxy Z Fold 4:

```
Live ingestion  (core/providers/yahoo.js over OkHttp)
  fetched    Nokia Corporation Sponsored
  price      9.945 USD
  filings    4 annual periods
  round trip 1805 ms
```

Cookie fetch, crumb extraction, quote, statements, alias resolution — the whole
path, on a phone, with no server involved. **That closes the last question
under D1: the Android client can be genuinely serverless.**

The proportions are worth stating, because they settle where effort belongs.
Ingestion costs about 1,800 ms; scoring costs about 5.5 ms. **The network is
roughly three hundred times the cost of running the engine in JavaScript.**
Whatever the case against interpreting the engine on-device was, it was never
about speed — and it means the caching tiers in `core/stock.js`, particularly
the fifteen-minute quote tier that had never worked, matter far more to how the
app feels than the engine ever will.

This is the half of the engine the scoring gate could never reach. Scoring is
arithmetic on a prepared model; ingestion is string handling, alias resolution
and a stateful session — 472 lines of accumulated knowledge about which fields
are aliases and which "empty" responses are real answers. Rewriting that in
Kotlin would have meant rewriting all of it, and the mistakes would have been
invisible, because a field resolved to the wrong alias still produces a
plausible number.

### The division

The host supplies exactly one primitive: `__httpFetch`, taking a request and
returning a response, both as JSON. Everything shaped like a web API is rebuilt
in JavaScript by `core/host/web-shim.js` — `fetch`, `Response`, `Headers`,
`AbortSignal`, `URLSearchParams`.

That line is drawn deliberately. A Kotlin `Response` would be a second
implementation of a web standard, and it would drift. This way the host does
only what a host can do, which is open a socket, and `yahoo.js` never learns
which runtime it is in.

`OkHttpBridge` deliberately has **no cookie jar**. `yahoo.js` manages its own
session — it fetches a cookie, extracts a crumb, replays both — and a client
that helpfully managed cookies would consume the `Set-Cookie` the engine needs
to read. Setting `Cookie` and `User-Agent` at all is the asymmetry that lets
this client reach Yahoo directly while the PWA cannot.

### What QuickJS turned out to be missing

Found by running rather than by reading, one failure at a time until it was
faster to enumerate them:

| API | Where it bit |
|---|---|
| `fetch`, `Response`, `AbortSignal` | anticipated in §4 |
| `console` | **not anticipated.** `yahoo.js` warns when a quarterly series is missing; without a shim that handled degradation threw `'console' is not defined` |
| `URLSearchParams` | **not anticipated.** Every query string is built with it |
| `URL` | referenced only in a comment |

`console` is the instructive one. It appears on failure paths, so the code that
handles a problem gracefully was itself the code that crashed. Scoring never
logs, which is why three earlier rounds of device testing never found it. The
shim now lives in `JsBridge`, so every bundle gets it rather than each entry
point remembering.

### Tests

`IngestParityTest` replays the same `<TICKER>.http.json` fixtures the Node
suites use, so a difference can only come from the engine or the bridge, never
from the upstream having moved. Beyond parity it asserts the session dance
actually happens — cookie, then crumb, then data — because a shim that silently
dropped the cookie header would still satisfy a fixture and pass a
parity-only check.

`<TICKER>.ingest.json` is the expectation, generated by the recorder from the
same bytes.

### Still to build

~~Storage bridged as well as the network.~~ **Done — see §24.**

---

## 24. The store bridge — the pipeline runs whole

`core/host/stock.js` runs the entire pipeline on device: cache check, fetch,
assemble, score, persist. The model it produces is byte-identical to Node's for
all three fixtures. Nine instrumented tests.

Measured on the Galaxy Z Fold 4:

```
Live pipeline  (fetch, score and cache, on device)
  fetched    Nokia Corporation Sponsored
  price      10.06 USD
  health     55/100 across 12 checks
  cold       1733 ms
  cached       21 ms
```

**The cached read is about eighty times faster than the cold one.** That is the
fifteen-minute quote tier — the one that had never worked in the PWA, because
`new Date()` read SQLite's timestamps as local time and inflated every cache age
by the host's UTC offset. Fixed in step 1 as a portability concern; measured
here as the difference between an instant screen and a two-second one.

### Where the 21 ms goes, and what it is paying for

A cached read never scores anything — `getStockData` returns early from
`formatCachedStock`. So those 21 ms are almost entirely the cost of *starting*:
a fresh QuickJS interpreter, and parsing an 83 KB bundle, on every call.

That is the price of the alpha13 workaround. A second evaluate on one instance
throws, so each call gets its own interpreter and re-parses the whole bundle.
When the binding is fixed and a warm instance can be held, a cached read should
fall to something close to the Room query alone.

It is not worth optimising now — 21 ms is imperceptible, and the cold path is
eighty times larger and entirely network. But it is worth knowing that the
number is a workaround cost rather than an inherent one, so that nobody later
concludes the engine is slow.

### Making the contract awaitable cost nothing

`core/store.js` was written synchronously, which SQLite can satisfy and Room
cannot. Rather than forcing the Android side to block a thread on every cache
read, `core/` now awaits its store — and because `await` on a plain value is a
no-op, **`server/store.js` needed no change at all**. Four call sites, all
already inside async functions.

The contract now documents that every method may return a promise. That is the
sort of thing worth writing down at the time: it is invisible until a second
host arrives, and by then it is expensive.

### Kotlin does not parse the record

`RoomStockStore` stores the scored record **as JSON, verbatim**, lifting out
only the handful of fields something queries on — ticker, name, sector, health
score, and the financials the sector median needs.

A Kotlin mirror of the record's twenty-odd fields would be a second definition
of a shape `core/model/record.js` already owns, and it would silently lose the
first field added to one side and not the other. The PWA spreads the same record
across twenty-odd SQLite columns, which is fine there because the same file
writes and reads them. Here the writer is JavaScript and the reader is
JavaScript; Kotlin is the filing cabinet.

`hasFundamentals` is honoured the same way it is on the server: a quote-only
refresh does not advance the statement timestamp, or stale filings would look
fresh and the 24-hour tier would stop meaning anything.

### A comparison that was asserting the wrong thing

The parity test first *redacted* the two store-owned timestamps and compared
the placeholders. It failed — the fixture had `last_fetched_at` and the device
did not. Neither host sets one on a fresh fetch: `formatCachedStock` returns the
in-memory record, whose timestamp is `undefined`. Node's fixture normaliser
materialises that key; `JSON.stringify` drops it. So the test was comparing a
present key against an absent one and calling it a scoring difference.

They are now stripped from both sides. Nothing is lost: that the timestamps are
read and written correctly is what the cache-tier test proves, and it proves it
far better than an equality check on a placeholder could.

### What the Android client can now do unaided

Fetch a ticker, parse its filings, score it, cache it, serve the next read from
that cache, fall back to stale data when the upstream refuses, and refuse to
invent a company that does not exist. No server, no account.

What remains is a user interface, a background sweep, and the paid analysis —
steps 4, 5 and 6. None of them is an open question about whether the
architecture works.
