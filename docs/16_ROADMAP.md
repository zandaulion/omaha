# 16 — Roadmap

> **Status**: plan. Written 2026-08-24 by cross-checking the built state of the
> Android client against `BACKLOG.md` and doc 15's market analysis.
> **Purpose**: sequence the remaining work under a hard constraint — the two
> clients must hold the same feature set — and say which items are cheap now and
> expensive later.
> **Companion to** doc 13, which decided the Android architecture and whose §11
> sequencing this extends. Doc 15 decides what we are shipping against; this one
> decides in what order.

---

## 1. The finding that sets the order

**There is no Android app.** `android/settings.gradle.kts` includes `:engine`,
`:engine-android`, `:data`, `:selftest` and `:probe`. There is no `:app`. The
only `Activity` in the repository is `SelfTestActivity`. Of the seven `android/`
directories doc 13 §5 lays out, five do not exist: `design/`, `work/`,
`billing/`, `ai/`, `app/`.

What does exist is substantial and should not be undersold. The engine fetches,
parses, scores, caches and backs up **byte-identically to Node, on a real
handset** — doc 13 §20 and §24 have the measurements. The hard architectural
questions are all answered. What is missing is the part a user touches.

This changes what the parity requirement means. Parity is not a maintenance
problem here; it is a **one-client gap**:

| | PWA | Android |
|---|---|---|
| Engine — ingest, score, cache | ✅ | ✅ byte-identical |
| Backup format and merge | ✅ | ✅ round-trips |
| User interface | ✅ four views | ❌ none |
| Alerts | ✅ | ❌ none |
| AI analysis | ✅ | ❌ none |

Everything downstream follows from one asymmetry: **a decision made before the
Compose UI exists is implemented once; the same decision made afterwards is
implemented twice.** That is the entire argument for the phase order below, and
it is why several items doc 15 rates as small are scheduled early rather than
last.

---

## 2. What the cross-check found

Beyond the missing client, four gaps that no single document holds.

### 2.1 The parity gate itself is unbuilt

Doc 13 §10 names the mechanism that makes parity real: `design/tokens.json` as
the single source, `tools/gen-tokens.mjs` emitting both `web/tokens.css` and
`android/design/.../Tokens.kt`, with CI failing if committed output has drifted.

Neither file exists. `tools/` holds `bundle-core.mjs` and `fixture-http.js`, and
there is no `design/` directory at all.

This is the one item whose cost is genuinely lower before the UI than after,
because after the UI it means retrofitting every hardcoded colour in the Compose
tree. **It must precede step 4, not accompany it.**

### 2.2 Room is five tables short of the PWA

`OmahaDatabase` registers three entities — `theses`, `watchlists`,
`stock_cache`. `server/db.js` creates eleven tables. Three of the PWA's are
correctly dropped (`devices`, `invites`, `push_subscriptions`) as
multi-device apparatus doc 13 §6 says Android does not need.

That leaves five with no Android equivalent yet:

| Table | Needed by | Phase |
|---|---|---|
| `app_settings` | Settings view | 4 |
| `stock_snapshots` | the alert engine compares against a stored snapshot | 5 |
| `notification_settings` | per-alert-type preferences | 5 |
| `notification_history` | delivered-alert history in Settings | 5 |
| `ai_summaries` | **the primary AI cost control** (doc 13 §7) | 6 |

Doc 13 §22 describes Room as "deliberately narrow: two tables" and that was
right for the backup round trip. It is not the finished schema, and the roadmap
should not treat step 3 as closed.

### 2.3 The notes opt-in toggle doc 13 requires does not exist — in either client

Doc 13 §1 identifies that `buildPrompt(stock, thesis)` transmits the most
personal data in the app, and states the remedy in unusually direct terms: an
explicit, default-off toggle, *"not a line in a privacy policy."*

It was never built. `server/index.js:242` reads the thesis unconditionally and
passes it to `generateStockAISummary`, and `core/analysis/prompt.js:366` packs
`coreRationale`, `conviction`, `targetBuyPrice` and `sellGuardrails` into the
payload. Grepping `web/`, `server/` and `core/` for any `includeNotes`-shaped
flag returns nothing.

So the PWA sends the user's private notes to Google on every analysis, with no
control and no disclosure. This is a shipped privacy gap, not merely an Android
prerequisite — and it sits directly under the product's central privacy claim.
It is scheduled in phase 1 for that reason rather than with the billing work.

> **Correction — the exposure is narrower than doc 13 §1 and the first draft of
> this section both said.** Both described it as the thesis *and journal
> entries*. The `theses` row does carry `journal_entries_json` and the whole row
> is the argument, so the claim reads correctly from the call site — but
> `buildComprehensivePayload` reads only four fields off it, and the journal is
> not among them. **No journal entry has ever been transmitted.**
>
> What is transmitted is still personal, and the sell guardrails are arguably
> the most personal thing in the app: a record of what would make someone
> abandon a position. The gap is real. It is just not as wide as recorded, and
> the difference matters to anyone deciding how urgently to act on it.
>
> Pinned by a test rather than left as a reading — `test/app-settings.test.js`
> asserts the journal stays out of the payload with the opt-in both off *and*
> on, so this stops being true the moment someone adds it.

**Closed in phase 1.** See §3, phase 1 item 1.

### 2.4 Doc 15's small items are cheaper than doc 15 knew

Doc 15 rates the screener rename (§2.5) as "small" and the disclaimer and AI
labelling (backlog) as Play prerequisites. All three are naming and framing
decisions, and all three are currently **one-client** changes, because the second
client's UI does not exist. Deferring them past phase 4 converts each from one
edit into two.

The same logic runs the other way for the widget: it is Android-only by nature,
so it cannot be made cheaper by sequencing, and it is correctly last.

---

## 3. Phases

Phase 0 blocks scope. Phases 1–3 are deliberately front-loaded with work that is
small *now* and doubles in cost after phase 4. Phase 4 is the bulk.

### Phase 0 — Decide what this is — **decided 2026-08-24**

> **Decision: a household tool shipped publicly, with hybrid statement coverage
> and the widget in scope.**
>
> The commercial frame is doc 13 §7's, unchanged: cost recovery, not revenue
> protection. No free-tier cap, no pricing pressure, no distribution, ASO or
> retention work. Portfolio accounting and dividend planning stay closed.
>
> **Two departures from the pure household answer**, both deliberate:
>
> * **EDGAR *and* Yahoo, not EDGAR alone.** Statements go to EDGAR with Yahoo
>   retained as the fallback for listings EDGAR does not cover. This is doc 15
>   §5's "global hybrid" technically, but not commercially — it is not chosen to
>   win a spec-sheet comparison, it is chosen so a non-US holding in the owner's
>   own watchlist still scores. Doc 14's open decision 3 resolves to *hybrid*.
> * **The widget is in scope**, not optional. It was the cheapest visible gap
>   before and it stays in phase 7.
>
> What this rules out is planning work, not features: nothing downstream needs a
> price point, a free-tier allowance or an acquisition funnel.

The reasoning below is retained because it is what the decision was made
against. Doc 15 §4 and §6.1, and the backlog entry. Is Pocket Omaha a business,
or a household tool shipped publicly?

The audit found a cost-recovery design and no commercial strategy: no price
point, no free-tier allowance, no target market beyond doc 01's "Primary
Investor / Wife", no revenue goal, no distribution or retention thinking. That
is internally consistent and needs no apology — but it is not the position
implied by commissioning a market survey.

It resolves four things this roadmap otherwise has to guess:

| Depends on it | Household answer | Business answer | **Resolved to** |
|---|---|---|---|
| EDGAR scope (doc 15 §5) | US-only, stated as scope | global hybrid, two statement paths | **hybrid** — EDGAR primary, Yahoo fallback |
| Widget (phase 7) | skip | build | **build** |
| Portfolio accounting (§2.1) | stays closed | revisit via CSV import | **stays closed** |
| Free-tier cap | none needed | must be defined | **none** |

**Nothing in phases 1–6 is invalidated by either answer.** Both clients need a
UI, alerts and the privacy toggle regardless. So phase 0 blocks *scope*, not
*start* — but it should be answered before phase 7 is costed.

### Phase 1 — Say it once, before it is built twice — **done 2026-08-24**

All of these were single-client edits, which is the whole reason they came
first: each would have become a two-client edit after phase 4.

1. **The notes opt-in toggle** (§2.3). Default off, in the PWA and in `core/`'s
   payload construction, so the Android UI inherits a parameter that already
   exists rather than growing one. The highest-value item in this phase, and the
   only one that closes a live privacy gap.
2. **Rename the screener** to *Filter* or *Compare across watchlist* (doc 15
   §2.5, backlog). `/api/screener` filters the watchlist universe;
   `server/index.js:340` says so in its own comment. Renaming after the Compose
   view is built means renaming twice and migrating a route.
3. **"Not investment advice" framing** (backlog, doc 14 §1). Absent from `web/`
   entirely. Write it to say what the app *is* — algorithmic scores identical for
   every user, thesis fields that are the user's own notes — not only what it
   disclaims.
4. **Audit and label every AI-derived surface** (backlog). Today it is one
   caption at `web/app.js:1480`. Play requires disclosure in the interface.
5. **Write the scope boundaries down** (doc 15 §2.1, §2.6). No portfolio
   accounting, no dividend or cash-flow planning. Doc 15 asks for these to be
   confirmed rather than left to drift; the place for that is doc 01, and the
   cost is a paragraph.
6. **The positioning sentence** (doc 15 §6.5). Lead with the thesis and
   sell-trigger discipline. Never the word *tracker*.

Items 3–6 are prose. Items 1 and 2 are the ones with real code behind them.

**All six landed.** Three things are worth carrying forward:

* **Item 2 could not be taken at face value.** Doc 15 offered *Filter* or
  *Compare across watchlist*, and the second dies on contact with the interface —
  screen 4 is already called Compare. It is **Filter**. The name was also only
  half the problem: the view now states that it narrows what you already follow,
  because the expectation came from the concept as much as the word.
* **Item 4's premise was slightly off.** Doc 14 describes the state as one
  `Generated by Gemini` caption. That caption was the *overview teaser's*; the
  deep-dive dashboard had nothing above its meta bar at the bottom. The audit
  found exactly two rendering surfaces, and both now carry the tag at the top.
* **Item 1 narrowed a recorded claim** — see the correction in §2.3.

### Phase 2 — Spend effort where both clients inherit it — **done 2026-08-24**

> Both landed. EDGAR is `core/providers/edgar.js`, chosen per ticker with Yahoo
> behind it; the staleness verdict is `core/analysis/staleness.js`. Neither
> client can drift from the other, because neither owns the logic.
>
> **Doc 14's research was right about the shape and wrong about five details**,
> each found by running rather than reading, and each recorded in doc 14 §3a.
> The two that would have shipped as defects: `github.com` in the User-Agent is
> a hard 403 from `www.sec.gov` — so the most conscientious version of that
> header is the one that fails, and it fails only against the live host — and
> candidate tags cannot be resolved by taking the first one present, because
> Nokia's abandoned `Revenue` tag otherwise beats the one it has used since
> IFRS 15 and stops its revenue series in 2017.
>
> Verified end to end against live EDGAR: AAPL 66/100 and NOK 52/100, both
> 12/12 checks measured, NOK exercising the EUR-reporting against USD-trading
> split. NESN.SW is not a registrant, returns `not_found`, and falls through to
> Yahoo — the hybrid working as decided.
>
> **Measured on a handset 2026-08-24, and the size worry does not survive it.**
> Doc 14's one open caution was parsing up to 7.5 MB of JSON through QuickJS on
> a phone. Cold fetch-parse-score on a Xiaomi 24117RK2CG: NOK (0.9 MB) 2040 ms,
> AAPL (3.6 MB) 1533 ms, JPM (7.5 MB) 1984 ms. **The largest blob was faster
> than the smallest**, and the same ticker measured twice in one run varied by
> more than the entire spread across an eightfold size range. Size is smaller
> than the noise. No size guard, and `companyconcept` stays rejected. Doc 14 §3a
> has the numbers.

Work landing in `core/` reaches both clients by construction. That makes it the
cheapest place to add value while the Android UI does not exist, and it is worth
doing before phase 4 rather than after.

1. **EDGAR statement migration** (backlog, doc 14 §2–3). One new file —
   `core/providers/edgar.js` exporting `fetchFundamentals(ticker)` in the shape
   `yahoo.js` returns — plus one changed line, because `core/providers/index.js`
   already splits `statementSource` from `quoteSource`. The seam is built.
   - Measure `companyfacts` (~3.8 MB, one request) against `companyconcept`
     (~2 KB, one request per tag) **on a handset**, not a laptop. Parsing 3.8 MB
     of JSON in QuickJS is the part that could disappoint.
   - Foreign private issuers file under `ifrs-full`; capex is the tag that needs
     hunting.
   - **Scope is hybrid** (phase 0): EDGAR is the primary statement source, Yahoo
     stays as the fallback for listings EDGAR does not cover. So this is a new
     implementation *behind* the seam, not a replacement of it, and
     `statementSource` needs a per-ticker fallback rather than a swap. Quotes,
     prices, search and peers were always staying on Yahoo.
2. **Flag AI summaries as stale** (backlog). `fiscalPeriodEnd` and
   `priceAtGeneration` are already stored. Comparison logic belongs in `core/`;
   the PWA renders it now and Android renders it in phase 4 for free. Do not
   auto-regenerate.

Both raise the value of the app before either client's UI work begins, and
neither can drift, because there is one implementation.

### Phase 3 — Build the parity gate — **done 2026-08-24**

> Built, and it closes: `design/tokens.json` → `web/tokens.css` +
> `android/design/.../Tokens.kt`, with `test/tokens.test.js` failing on any
> hand-edit to either output.
>
> The palette was **moved** out of `web/app.css`, not copied. Two definitions of
> `--bg-canvas` is the exact drift this exists to prevent.
>
> **`android/design` compiles.** That was the decision worth making: a generator
> whose output is never compiled is not a gate, and compiling caught three
> errors invisible in the JSON and in the CSS half — a `title-1` identifier a
> hyphen makes illegal in Kotlin, an `em` import used only by the tracking
> values, and the Compose compiler plugin demanding a runtime that a file with
> no `@Composable` has no reason to carry.

Before any Compose UI. Doc 13 §10.

- `design/tokens.json` as the single source for both palettes.
- `tools/gen-tokens.mjs` emitting `web/tokens.css` and `Tokens.kt`.
- CI fails if generated output differs from what is committed, so neither side
  can be hand-edited.
- Bundle **Inter** and **JetBrains Mono** in the APK. Roboto will not reproduce
  doc 04's type scale.

This is the mechanism that turns "the two clients look the same" from an
intention into a build failure. Retrofitting it after the UI exists means
revisiting every colour in the tree.

### Phase 4 — The Android client (doc 13 step 4) — **done 2026-08-27**

> Every slice landed. The Android client now does what the PWA does, minus the
> AI analysis, which is gated on billing in phase 6.
>
> **The parity ledger's UI rows are closed.** What remains between the clients
> is alerts (phase 5), paid AI (phase 6) and the widget (phase 7).

The bulk of the remaining work, and the phase that actually closes the parity
gap. Sequenced so each slice is independently reviewable against its PWA
counterpart.

| # | Slice | Notes |
|---|---|---|
| 4a | ~~`:app` module, navigation shell, theme from generated tokens~~ **done 2026-08-26** | four tabs, matching the PWA's `nav-tab` structure |
| 4b | ~~Room: `app_settings`~~ **done 2026-08-26** | the rest arrive with their features in 5 and 6 |
| 4c | ~~**Watchlist** view~~ **done 2026-08-26** | plus the aggregate portfolio health score |
| 4d | ~~**Deep Dive** view~~ **done 2026-08-27** | the large one — see below |
| 4e | ~~**Filter** and **Compare** views~~ **done 2026-08-27** | under phase 1's new name |
| 4f | ~~**Settings**, and SAF import/export~~ **done 2026-08-27** | closes doc 13 step 3's outstanding item |

> **4a landed 2026-08-26.** `:app` builds and runs on foundation only — no
> Material. That was the load-bearing decision: Material3 carries its own colour
> scheme and type scale, and a component reading `MaterialTheme.colorScheme`
> would be off-parity while looking entirely correct. `NavigationBar` would also
> not match the PWA's nav, so the component that saves the most work is the one
> that matches least.
>
> `OmahaTheme` bridges the generated tokens into Compose, and the nav icons are
> the PWA's own SVG path data transcribed rather than Material icons of roughly
> the same meaning.
>
> **Fonts are bundled and subset.** Inter and JetBrains Mono whole are 1,064 KB
> — larger than the entire engine, which doc 13 §20 puts at about 900 KB. Subset
> to Latin plus the punctuation, currency and maths signs the app actually
> renders, they are 411 KB. Both keep their `wght` axis, so one file covers 400
> through 700. See `android/design/FONTS.md`.
>
> **APK: 9.6 MB, four ABIs, unminified.** `classes.dex` is the whole story now
> that Compose is present. Doc 13 §20's "~0.9 MB real cost" figure predates the
> UI toolkit and should not be quoted for this build; R8 keep rules for the JNI
> surface remain open there, and this is the build that makes them worth doing.

> **4b and 4c landed 2026-08-26.** The watchlist scores real tickers on device
> through the same `core/host/stock.js` the PWA server calls.
>
> Two decisions worth carrying into 4d. **A holding that fails to load stays on
> screen carrying its error** rather than vanishing — a missing row would make
> the composite an average over a different set than the one being read. And
> **the composite excludes unscored holdings rather than counting them as
> zero**, then says what it averaged over: the engine reports `null` where too
> few line items were filed, and averaging that in turns "not measured" into
> "bad", which is the exact inversion the README's governing rule exists to
> prevent.
>
> Room went to version 2 with a hand-written migration. There is deliberately no
> `fallbackToDestructiveMigration`: two of these tables hold things a person
> wrote, with no server copy to restore from, so a failed migration must crash
> loudly rather than quietly discard the material the app exists to protect.
>
> `:data` now returns an `OmahaStore` rather than the `OmahaDatabase` itself.
> Returning the database put `RoomDatabase` on every consumer's compile
> classpath, which contradicts that module's own statement that what it exposes
> is a store and not a particular way of storing.

> **4d is being built in slices. Three landed 2026-08-27**: the deep-dive shell
> with its sub-tabs, the score ring and five pillars, the 12-point checklist
> with its explanation drawers, and the four 5Y trend charts. The DCF sandbox
> and the thesis name their slice; Gemini is absent rather than placeholdered, since
> it is gated on billing and a relay in phase 6 and a tab that cannot work even
> in principle is the wrong promise.
>
> **The drawers were built first rather than last.** Doc 15 §3.3 rates
> transparency second only to the sell triggers and names the per-item
> explanations as the thing distinguishing this from a proprietary rating. They
> are the easiest part of a checklist to defer as "detail", and they are not
> detail.
>
> Three places where the honest rendering differs from the obvious one, all the
> same rule: an unscored company draws **no ring at all** rather than an empty
> one, because an empty ring says "scored zero" and absence says "could not be
> scored"; a pillar states how many of its measures were filed when that is
> fewer than all of them; and the header carries the filing period and the
> reporting-versus-traded currency split, so a euro balance sheet never sits
> silently under a dollar price.
>
> **The charts confirmed doc 13 §10's prediction**: three are weighted rows and
> boxes, only the margin trajectory needs a path, and no charting dependency was
> required. That mattered for a reason beyond size — a charting library brings
> its own opinion about what to do with a missing point, which is the one thing
> these charts must get right. A gap draws nothing: no bar, and a lifted pen
> rather than a line joining across it. JPM exercises the fully-absent case, since
> a bank files no gross or operating margin at all.
>
> **The DCF is the project's only deliberate dual implementation**, and it has a
> gate. `core/analysis/dcf.js` is the definition, shipped to the browser so the
> PWA's copy could be deleted rather than duplicated; Kotlin reimplements it
> because the sandbox recomputes on every drag frame and a QuickJS call costs
> about 21 ms. `DcfParityTest` caught a real divergence on its first run.
>
> **Settings is a fifth tab rather than a header button.** The PWA reaches it
> from a header because a browser page has one; the Android alternative is an
> overflow menu, which would put the privacy opt-in and the backup one tap
> further away than anything else on the screen.
>
> `OmahaEngine` holds one store and one engine per process. Per-screen instances
> were the obvious arrangement and the wrong one — two Room handles on one file
> is how a database gets locked, and the shared cache is the point: a ticker
> opened from the watchlist is already warm.

**4d is not one view.** The PWA's Deep Dive carries the five pillars, the
12-point checklist with its explanation drawers, four chart types, the DCF
sandbox with live sliders and bear/base/bull presets, and the thesis, sell
triggers and journal. It is most of the product. Doc 13 §10 is reassuring on the
charts specifically — three of the four are CSS-styled div columns, becoming
weighted `Column`s, and only the margin trajectory needs a `Canvas` path, so no
charting dependency is required.

Two things carry disproportionate weight here and should not be treated as
ordinary screens:

- **The sell-trigger checklist is the product's single differentiator.** Doc 15
  §3.1 checked it against all ten platforms in the survey and found nothing
  comparable. It should be built with more care than its size suggests.
- **Transparency is the other one** (doc 15 §3.3). The per-item drawers that
  explain each check are what distinguishes this from a Snowflake, and they are
  easy to drop as "detail" during a port. They are not detail; they are the
  argument.

Screenshot diffs against the PWA gate each slice.

### Phase 5 — Alerts on device (doc 13 step 5) — **done 2026-08-27**

- Room: `stock_snapshots`, `notification_settings`, `notification_history`.
- WorkManager sweep, local notifications, `evaluateTriggers` already pure in
  `core/alerts/triggers.js`.
- `POST_NOTIFICATIONS` on Android 13+ — doc 13 §13 leaves the placement in the
  flow open.
- Doze and OEM task killers make a 6-hourly cadence approximate. Whether to
  prompt for a battery-optimisation exemption is the open UX call.

No server, and nothing transmitted beyond market data.

> **Half of this phase turned out to belong in `core/`.** `triggers.js` was
> already shared, but everything *around* it — which fields a snapshot must
> carry, how long an alert may not repeat, when a sweep should stop rather than
> keep asking — lived only in `server/alerts.js`. Those are policy, not
> plumbing: a cooldown of 14 days in the browser and 3 on the phone is not a
> difference either client can see. They moved to `core/alerts/sweep.js`, which
> the server now imports and the phone runs through `core/host/alerts.js`.
>
> **The extraction found two defects, both of which had shipped.**
>
> `server/alerts.js:293` called `both(...)`, a helper private to `triggers.js`
> and never imported there. Every Sunday digest with at least one scored holding
> threw `ReferenceError`, and the hourly timer's `.catch()` logged and swallowed
> it — so the feature reported healthy while having never once sent. Nothing
> pointed at it because the composition had no seam to test at.
>
> Underneath that was a worse one. Both clients computed movers as
> `current - previousSnapshot`, and the sweep writes the cache row and the
> snapshot **from the same fetch** — so the difference is zero by construction.
> Every digest either client could ever have produced would have said "no
> material health changes this week", correctly according to its arithmetic and
> wrongly about the world. Fixed with `rollBaseline`: a second, slower-moving
> reading adopted from the snapshot being replaced and then left alone for six
> days. `stock_snapshots` gains `week_ago_score` and `week_ago_at` on both
> clients. Verified against a seeded database — *"🎩 The Compounders: 80/100.
> 2 holdings scored. Movers: AAPL +8, NVDA -3."*
>
> **The sweep splits per ticker, not per sweep.** Every `JsBridge.call` builds a
> fresh interpreter and the engine is serialised process-wide (phase 4's
> handset bug), so one call per sweep would hold the lock for `tickers × ~2 s`
> with the watchlist frozen behind it if the app were opened mid-sweep. Per
> ticker, a foreground read waits for one company at worst. What the Kotlin loop
> is left deciding is *which* holdings and *when to persist*; `evaluated`,
> `skipped` and `abandon` all arrive as values from the engine.
>
> **The snapshot is one column, not ten.** `server/db.js` gives it a column per
> compared field because SQL is how the server queries them; nothing on Android
> queries them, so the engine's JSON is stored verbatim and handed back
> unexamined. The failure mode of mapping it is what settles this:
> `evaluateTriggers` guards every comparison with "are both of these numbers?",
> so a field the host dropped or re-spelled reads as `undefined` and the rule
> goes **quiet** rather than throwing. A trigger that silently stops firing is
> the one defect nobody can notice, because the symptom is an absence. Two
> fields are denormalised as a named exception, for the digest's cross-holding
> query.
>
> **No battery-optimisation prompt.** It is a system dialog asking someone to
> weaken a protection, for a feature whose worst failure is a filing noticed six
> hours late — and asking before the app has shown a single useful alert is how
> the request gets refused permanently. Settings shows *when the last sweep
> actually ran* instead, so a schedule the OEM is not honouring is visible
> rather than merely absent. Notification permission is offered the same way:
> from the Alerts card, never on launch, and the sweep keeps running and
> recording without it — refusing turns the feature into an in-app one rather
> than turning it off, and the cooldowns stay in step.
>
> **Five notification channels, one per setting.** Android gives each channel
> its own switch, importance and sound, so silencing "Buybacks and dividends"
> in system settings means exactly what unticking it in ours means. One channel
> would have made the OS control all-or-nothing. Only a distress signal is
> `IMPORTANCE_HIGH`; a weekly summary at the same weight is how the distress
> signal stops being noticed.
>
> **Fixed in passing: the theme picker did nothing.** `MainActivity` hard-coded
> `ThemeChoice.System` while Settings stored the choice correctly, so picking
> Light persisted and changed nothing. Phase 4 was marked done with that live.
>
> **The app crashed on the first real-device launch, 2026-08-27, and the fix
> that shipped a build before that one made it worse rather than better.**
> `MIGRATION_2_3` created an index on `notification_history` —
> `CREATE INDEX ... index_notification_history_deliveredAt` — that
> `NotificationRow` never declared with `@Index`. Room derives its *expected*
> schema from the entity annotations alone, so on any install upgrading from
> schema version 2 (every phone that already had the app), `onValidateSchema`
> found an index it had no way to know it should expect, could not tell that
> apart from real drift, and refused to open the database.
>
> The interim crash-guard build ([`eac348a`](../BACKLOG.md)) made this
> *survivable* — `OmahaApplication` recorded the trace, `MainActivity` showed
> it on the next launch — but the app underneath it still could not open its
> own database, which is a state worth naming honestly rather than filing
> under "fixed." The actual fix was one `indices = [Index("deliveredAt")]` on
> the entity, verified against Room's own regenerated `onValidateSchema`
> before it shipped.
>
> **No test had ever opened a database through this migration.** Every other
> Room test in the module uses `inMemoryDatabaseBuilder`, which builds the
> *current* schema straight from the entities and never runs a `Migration` at
> all — so a migration whose raw SQL disagrees with its own entities cannot
> fail a test that never exercises it. `AlertMigrationTest` now seeds a
> version-2-shaped database by hand and opens it through the real migration
> path, which is what should have caught this before it reached a phone. It
> compiles; **it has not yet been run**, since running it needs a connected
> device or emulator and this session had neither. Worth doing before phase 6.

### Phase 6 — Paid AI (doc 13 step 6)

- Room: `ai_summaries` — the cache **is** the primary cost control, not a
  performance nicety.
- Cloud Function relay verifying the Play purchase token; consumable credit
  packs; anonymous Firebase Auth for the balance.
- Prompt construction stays in `core/` on-device. The function is a thin
  verified relay, not a second implementation.
- **Credit pack: 10 for $0.99** — decided 2026-08-28, measurement below.
- The phase 1 notes toggle must be honoured on this path too.

The only phase requiring infrastructure. Phases 1–5 ship without any.

> **Cost-per-analysis, measured 2026-08-28** via `scripts/measure-ai-cost.mjs`
> — five real tickers (AAPL, JPM, NOK, NOVN.SW, O) through the real prompt
> builder and the real Gemini call, chosen for shape rather than convenience:
> a lender where Altman Z is inapplicable, a foreign filer that falls back to
> Yahoo, a REIT.
>
> | | mean | worst of 5 |
> |---|---|---|
> | Input tokens | 4,936 | — |
> | Output tokens | 1,725 (+ 753 thinking, billed as output) | — |
> | **Cost per analysis** | **$0.0130** | $0.01375 |
>
> An offline estimate taken before this run — chars/4 against a locally-built
> prompt — had guessed ~3,800 input tokens. The real count was 4,936, 30%
> higher. That is why the script insists on a live call rather than an
> estimate: Gemini's tokenizer is not a character-count heuristic, and a
> pricing decision built on the wrong number would be wrong quietly.
>
> **The rate holds only through 2026-12-31.** Both input and output roughly
> double on 2027-01-01 (`ai.google.dev/gemini-api/docs/pricing`, Gemini 3.7
> Flash standard tier), which puts cost-per-analysis at ~$0.026 four months
> after a plausible ship date. The pack price had to survive that without a
> second pricing decision in January, which is what ruled out the
> higher-volume option below.
>
> | Pack | Net per credit (after Play's ~15%) | Margin today | Margin after Jan 2027 |
> |---|---|---|---|
> | **10 for $0.99 — chosen** | $0.0842 | 6.5× | 3.2× |
> | 25 for $0.99 — rejected | $0.0337 | 2.6× | 1.3×, thin |
>
> Consistent with the phase 0 framing — a household tool, priced to recover
> cost rather than to maximise revenue. 6.5× today is not the number a
> for-profit app would stop at; it is the number that still reads as
> "comfortable" once the rate doubles, for a price a family will not think
> twice about.

### Phase 7 — Release, then the widget

1. **Financial features declaration** in Play Console. Declare generously —
   portfolio management for the watchlist and aggregator, financial advice for
   the Gemini analysis. Neither attracts a licensing requirement; an inaccurate
   declaration is a documented cause of rejection. There is no credential gate on
   investment apps.
2. **Android home-screen widget** (doc 15 §2.3, backlog). **In scope** per phase
   0. Glance keeps it contained, and a health-score-plus-delta widget would have
   no direct equivalent — every widget in that market shows prices.

**The widget is the one deliberate parity exception**, and it is worth stating
plainly rather than letting it look like drift. A home-screen widget has no
meaningful PWA counterpart. The parity rule should be read as *feature parity
where the platform allows it*, with this as the named exception and the
reasoning recorded here.

---

## 4. Parity ledger

The state to hold each client against. "Inherits" means the work lands in
`core/` and the client gets it when its UI exists.

| Feature | PWA | Android | Closes in |
|---|---|---|---|
| Ingest, score, cache | ✅ | ✅ | done |
| Backup export/import + merge | ✅ | ✅ | done |
| Notes opt-in toggle | ✅ | ✅ | done |
| Screener → Filter rename | ✅ | ✅ built as Filter | done |
| Disclaimer, AI labelling | ✅ | ✅ disclaimer; AI label with phase 6 | 6 |
| EDGAR statements | ✅ | ✅ inherited | done |
| AI staleness flag | ✅ | core inherited; surfaces with the AI tab | 6 |
| Watchlist view | ✅ | ✅ | done |
| Deep Dive: pillars, checklist, charts | ✅ | ✅ | done |
| DCF sandbox | ✅ | ✅ | done |
| Thesis, sell triggers, journal | ✅ | ✅ | done |
| Filter, Compare | ✅ | ✅ | done |
| Settings | ✅ | ✅ | done |
| Alerts | ✅ push | ✅ local, WorkManager | done |
| Alert centre / history | ✅ | ✅ in Settings | done |
| Sunday digest | ✅ push — **fixed 2026-08-27**, had never sent | ✅ local | done; email in backlog |
| AI analysis | ✅ free | ❌ | 6 |
| Home-screen widget | n/a | ❌ | 7 — **named exception** |
| Invites, devices, push subs | ✅ | n/a by design | — |

**PWA column verified against the deployment, 2026-08-26.** The five rows
above were still marked ❌ after phases 1 and 2 closed; the ledger had not been
updated with them. Each was checked against the running instance rather than
against its commit message:

* *Notes opt-in* — `shouldIncludeNotesInAI()` in `server/app-settings.js`,
  off by default, with the client checkboxes left unticked on load.
* *Filter rename* — `/api/filter` serves; `/api/screener` returns 404. The
  seven remaining `screener` strings are deliberate: a `localStorage`
  migration for installs that saved the old view name, plus the comments
  explaining it.
* *Disclaimer and AI labelling* — both render; a disclaimer note is visible on
  the deep dive, and `.ai-origin-tag` marks model output where it starts.
* *EDGAR* — serving live. AAPL 19 annual periods (USD), NOK 11 (**EUR**),
  NU 6 (USD), and **zero fallback-to-Yahoo events in three days** of logs. The
  EUR on NOK is the currency correctness doc 14 §2 predicted, arriving as
  designed.
* *AI staleness* — `fiscalPeriodEnd` and the stale-analysis branch are both in
  `web/app.js`.

Two rows are permanent asymmetries rather than gaps: the multi-device apparatus
exists only because the PWA is served over a network, and the widget has no web
counterpart. Everything else should converge.

---

## 5. What this roadmap does not decide

- ~~**Phase 0.**~~ **Answered 2026-08-24** — see the phase 0 note above.
- ~~**Credit pack pricing.**~~ **Answered 2026-08-28** — 10 for $0.99, see the
  phase 6 note above.
- **Sunday digest email** — needs a provider decision (Resend or Postmark). The
  digest content function is already separated from delivery, so it stays in the
  backlog rather than entering a phase.
- **Effort estimates.** Deliberately absent. The phase *order* is the argument
  here, and it holds regardless of how long phase 4 takes.
