# Backlog

Deferred work, with enough context to pick up cold. Known limitations that are
*not* planned work live in `docs/12_FINAL_SYSTEM_AUDIT_AND_CHECKLIST.md` §3.

---

## ~~Flag AI summaries as stale when the fundamentals move~~ — done 2026-08-24

**Deferred 2026-08-20, done 2026-08-24** as `docs/16_ROADMAP.md` phase 2.

The comparison is `core/analysis/staleness.js`, so Android reaches the same
verdict through its own bridge rather than through a second opinion written in
Kotlin. The server attaches it to both AI-summary responses; the deep dive shows
it above the verdict, and the overview teaser carries a one-line version.

Both signals are separated as specified: superseded filings undermine every
section, price drift undermines the valuation paragraphs and leaves the moat and
solvency reasoning standing. Nothing auto-regenerates.

One thing worth recording. The 15% threshold could not be compared exactly: a
price precisely 15% above the recorded one yields 0.14999999999999991 in binary,
so the boundary is compared with one part in a billion of slack. Pinned by a
test.

The original entry follows, since it is the specification this was built to.

Cached analyses in `ai_summaries` already store the two fields needed to detect
staleness — added when the Gemini payload was rebuilt:

- `fiscalPeriodEnd` — the filing period the analysis was written against
- `priceAtGeneration` — the share price at the time

Today the interface shows only the generation timestamp and waits for the user
to press **Re-Analyze**. So an analysis written against FY2025 keeps presenting
itself with full confidence after FY2026 lands, and its valuation paragraphs
can be discussing a price that has moved materially.

**What to build**

1. On the deep-dive load, compare the cached summary's `fiscalPeriodEnd`
   against `stock.summary.metrics.fiscalPeriodEnd`. A mismatch means new
   statements have been filed since the analysis was written — that is the
   strong signal, and it should be stated plainly rather than merely styled.
2. Separately, compare `priceAtGeneration` with the live price. A drift beyond
   roughly 15% invalidates the valuation and buy-zone sections specifically,
   not the moat or solvency ones. Worth wording it that way rather than
   condemning the whole analysis.
3. Surface it on the AI card, next to the existing timestamp, with a one-tap
   refresh. Reuse the freshness-banner vocabulary already in `app.css` rather
   than inventing a third staleness idiom.

**Do not** auto-regenerate on staleness. Every call costs money and latency,
the alert sweep already touches every watchlist holding four times a day, and
silently rewriting an analysis the user may have read and acted on is worse
than telling them it is out of date.

---

## Sunday digest by email

**Dropped during the notification build, 2026-08-19.** Doc 05 specifies a rich
HTML "Sunday Morning Brief" alongside the web push. The push digest is built
and scheduled (`server/alerts.js`, `sendWeeklyDigest`); only the email path is
missing, because no transactional email provider is configured on this host.

Needs a provider decision first (Resend and Postmark are the two doc 05 names).
The digest content function is already separated from its delivery, so the
email path is a renderer plus a send call, not new logic.

---

## Move statements to SEC EDGAR before the Play release

**Raised 2026-08-22.** Full research and the verified numbers are in
`docs/14_DATA_SOURCING_AND_PLAY_RELEASE.md` §2–3. Summary for triage:

EDGAR costs nothing — no key, no registration, no quota tier. The limits are
10 requests/second per IP and a mandatory `User-Agent` naming the project with
a contact email. Coverage is not the problem: 10,403 tickers map to CIKs and
every ticker used in testing is present, foreign issuers included.

**The work is a second tag dictionary.** Foreign private issuers file under
`ifrs-full` rather than `us-gaap` — NOK, SBSW and NU all do; TAL does not. Nine
of ten core concepts map cleanly (`Revenues`→`Revenue`,
`NetIncomeLoss`→`ProfitLoss`, `StockholdersEquity`→`Equity`); capex is the one
that needs hunting, since IFRS filers spread it across several variants.

The seam is already built. `core/providers/index.js` splits `statementSource`
from `quoteSource`, so this is one new file — `core/providers/edgar.js`
exporting `fetchFundamentals(ticker)` in the shape `yahoo.js:307` returns — and
one changed line. Quotes, prices, search and peers stay on Yahoo.

**Measure before committing to the endpoint.** `companyfacts` is one request
but ~3.8 MB per company; `companyconcept` is ~2 KB but one request per tag,
against a 10/sec budget. On-device and cached the single blob is probably
right, but parsing 3.8 MB of JSON in QuickJS on a real handset is the part that
could disappoint. Test it there, not on a laptop.

**Do not** consolidate Android behind a server proxy to simplify this. Fetching
on-device means the rate budget is per user rather than shared across the
install base, which is a structural advantage worth protecting.

Two things fall out of the migration beyond resilience: EDGAR returns the filed
number rather than a re-derivation, and it labels the reporting currency
explicitly per fact (Nokia returns `units: ['EUR']`) — which is exactly the
defect class that contaminated 7 of 20 tickers in the earlier audit.

---

## Play release prerequisites: ~~disclaimer and AI labelling~~ → declaration only

**Raised 2026-08-22. Both in-app items done 2026-08-24**, as `docs/16_ROADMAP.md`
phase 1 — see `docs/14_DATA_SOURCING_AND_PLAY_RELEASE.md` §1 for what landed
where.

**What is left is the Financial features declaration in Play Console**, which is
a form rather than code, and cannot be done from this repository. The two items
described below are closed; the text is kept because it is the reasoning the
declaration itself should follow.

Context in `docs/14_DATA_SOURCING_AND_PLAY_RELEASE.md` §1.

There is **no credential gate** on investment apps — Google requires licensing
documentation only for personal-loan apps, and nothing demands broker-dealer or
adviser registration. The release is not gated on permission. It is gated on
these two items, plus the declaration.

1. **"Not investment advice" framing is missing entirely** — grep `web/` and
   there is nothing. Doc 13 §7 already called for it. The app shows 0–100
   grades, DCF fair values and buy targets, so it needs the framing. Worth
   writing it to say what the app *is* rather than only what it disclaims: the
   scores are algorithmic and identical for every user, and the thesis fields
   are the user's own notes, so nothing here is personalised advice.

2. **AI labelling is one caption** — `Generated by Gemini` at `web/app.js:1480`.
   Play requires disclosure in the interface, not only in a policy document.
   Audit every AI-derived surface and label each one.

Then complete the **Financial features declaration** in Play Console, and
declare generously: portfolio management for the watchlist and aggregator,
financial advice for the Gemini analysis. Neither attracts a licensing
requirement, while an inaccurate declaration is a documented and repeated cause
of rejection.

---

## ~~Decide whether Pocket Omaha is a business or a household tool~~ — decided 2026-08-24

**Raised 2026-08-22, decided 2026-08-24.** Full reasoning in
`docs/15_COMPETITIVE_POSITION.md` §4 and §6; the decision and what falls out of
it are recorded in `docs/16_ROADMAP.md` phase 0.

**A household tool shipped publicly, with two deliberate departures:** statements
go to EDGAR *with Yahoo retained as fallback* rather than US-only, and the widget
is in scope rather than skipped. Portfolio accounting and dividend planning stay
closed — now written down as `docs/01_PRODUCT_SPEC.md` §4 rather than left as
apparent omissions. No free-tier cap, no price point pressure, no distribution or
retention work.

The original text is kept below because it is what the decision was made against.

An audit of every doc found a **cost-recovery design but no commercial
strategy**. Doc 13 §7 is explicit and self-consistent — the paywall exists for
"cost control, not revenue protection", copying and forking are "explicitly not
a concern" — and from that follow credit packs, anonymous auth and server-side
purchase verification. All sound for a personal tool shipped publicly.

Undefined anywhere: the price point (open item in doc 13, needs a measured
cost-per-analysis), any free-tier allowance, the target market beyond doc 01's
"Primary Investor / Wife", revenue expectations, distribution, discovery and
retention.

That is a coherent position. It is simply not the position implied by
benchmarking against Simply Wall St. The two answers lead to different launch
scopes, so decide before fixing scope — it determines whether the widget is
worth building, whether portfolio accounting stays closed, whether the free tier
is capped, and whether doc 14's EDGAR migration resolves toward US-only or a
global hybrid.

---

## Android home-screen widget

**Raised 2026-08-22.** Context in `docs/15_COMPETITIVE_POSITION.md` §2.3.
Gated on the decision above.

Doc 13 never mentions widgets. The market survey gives widget depth its own
column, and for the native/lightweight archetype it is the primary
differentiator — My Stocks Portfolio sells largely on resizable, sortable,
themable home-screen widgets.

This is the most visible gap relative to effort for an Android launch. Glance
keeps it contained. Worth noting that every widget in that market shows
**prices**; one showing a health score and its delta would have no direct
equivalent, which fits the positioning in §3.

---

## ~~Rename the screener~~ — done 2026-08-24

**Raised 2026-08-22, closed 2026-08-24.** `docs/15_COMPETITIVE_POSITION.md` §2.5,
scheduled as `docs/16_ROADMAP.md` phase 1.

It is **Filter** — view, tab, route and identifiers. Doc 15's other suggestion,
*Compare across watchlist*, was rejected on contact with the interface: screen 4
is already called Compare, so it would have replaced an overselling name with an
ambiguous one.

The name was only half of it. The view now carries a subtitle saying it narrows
what you already follow and does not search the wider market, because the
expectation doc 15 identified came from the concept as much as the word.

Two legacy aliases are kept deliberately: `?view=screener` still resolves, and a
`viewScreener` left in `localStorage` still restores. Nothing generates the
former, but a bookmark might exist, and every install that last used this view
has the latter stored.

Building real discovery screening remains out of scope: it needs a universe we
do not ingest.
