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

### Phase 1 — Say it once, before it is built twice

All of these are single-client edits today. Each becomes a two-client edit after
phase 4. None is large.

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

Items 3–6 are prose. Item 1 is the one with real code behind it.

### Phase 2 — Spend effort where both clients inherit it

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

### Phase 3 — Build the parity gate

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

### Phase 4 — The Android client (doc 13 step 4)

The bulk of the remaining work, and the phase that actually closes the parity
gap. Sequenced so each slice is independently reviewable against its PWA
counterpart.

| # | Slice | Notes |
|---|---|---|
| 4a | `:app` module, navigation shell, theme from generated tokens | four tabs, matching the PWA's `nav-tab` structure |
| 4b | Room: `app_settings` (§2.2) | the rest arrive with their features in 5 and 6 |
| 4c | **Watchlist** view | plus the aggregate portfolio health score |
| 4d | **Deep Dive** view | the large one — see below |
| 4e | **Filter** and **Compare** views | under phase 1's new name |
| 4f | **Settings**, and SAF import/export | closes doc 13 step 3's outstanding item |

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

### Phase 5 — Alerts on device (doc 13 step 5)

- Room: `stock_snapshots`, `notification_settings`, `notification_history`.
- WorkManager sweep, local notifications, `evaluateTriggers` already pure in
  `core/alerts/triggers.js`.
- `POST_NOTIFICATIONS` on Android 13+ — doc 13 §13 leaves the placement in the
  flow open.
- Doze and OEM task killers make a 6-hourly cadence approximate. Whether to
  prompt for a battery-optimisation exemption is the open UX call.

No server, and nothing transmitted beyond market data.

### Phase 6 — Paid AI (doc 13 step 6)

- Room: `ai_summaries` — the cache **is** the primary cost control, not a
  performance nicety.
- Cloud Function relay verifying the Play purchase token; consumable credit
  packs; anonymous Firebase Auth for the balance.
- Prompt construction stays in `core/` on-device. The function is a thin
  verified relay, not a second implementation.
- **Price point needs a measured cost-per-analysis first** — open in doc 13 §13
  and unresolved.
- The phase 1 notes toggle must be honoured on this path too.

The only phase requiring infrastructure. Phases 1–5 ship without any.

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
| Backup export/import + merge | ✅ | ✅ engine; ❌ picker | 4f |
| Notes opt-in toggle | ❌ | ❌ | 1 |
| Screener → Filter rename | ❌ | n/a | 1 |
| Disclaimer, AI labelling | ❌ | n/a | 1 |
| EDGAR statements | ❌ | inherits | 2 |
| AI staleness flag | ❌ | inherits | 2 |
| Watchlist view | ✅ | ❌ | 4c |
| Deep Dive: pillars, checklist, charts | ✅ | ❌ | 4d |
| DCF sandbox | ✅ | ❌ | 4d |
| Thesis, sell triggers, journal | ✅ | ❌ | 4d |
| Filter, Compare | ✅ | ❌ | 4e |
| Settings | ✅ | ❌ | 4f |
| Alerts | ✅ push | ❌ | 5 |
| Sunday digest | ⚠️ push only, no email | n/a — local notifications | backlog |
| AI analysis | ✅ free | ❌ | 6 |
| Home-screen widget | n/a | ❌ | 7 — **named exception** |
| Invites, devices, push subs | ✅ | n/a by design | — |

Two rows are permanent asymmetries rather than gaps: the multi-device apparatus
exists only because the PWA is served over a network, and the widget has no web
counterpart. Everything else should converge.

---

## 5. What this roadmap does not decide

- ~~**Phase 0.**~~ **Answered 2026-08-24** — see the phase 0 note above.
- **Credit pack pricing** — blocked on a measured cost-per-analysis. The
  household frame lowers the stakes: the number only has to cover cost.
- **Sunday digest email** — needs a provider decision (Resend or Postmark). The
  digest content function is already separated from delivery, so it stays in the
  backlog rather than entering a phase.
- **Effort estimates.** Deliberately absent. The phase *order* is the argument
  here, and it holds regardless of how long phase 4 takes.
