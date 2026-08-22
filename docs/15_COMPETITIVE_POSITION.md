# 15 — Competitive Position

> **Status**: analysis, no code. Written 2026-08-22 against an external market
> survey of the Android stock-tracking sector (six archetypes, ten-platform
> feature matrix, pricing tiers). Findings are summarised and attributed here
> rather than reproduced.
> **Companion to** doc 14, which settles *whether* we can ship. This one is
> about *what we are shipping against*.

---

## 1. Which market we are actually in

The survey segments the sector into six archetypes. Pocket Omaha is
**archetype 1 — fundamental and quantitative research**, alongside Simply Wall
St, Seeking Alpha and Stock Unlock. Those are the comparators. Empower, Kubera
and My Stocks Portfolio are not: they are wealth aggregators and portfolio
ledgers, solving a different problem.

The complication is that Omaha also satisfies most of **archetype 6 —
native, lightweight and privacy-centric** (Uplift, Ghostfolio, Capitally): no
account, no broker credentials, on-device engine, offline-first, zero
recurring cost.

**No platform in the survey occupies both.** The privacy-centric tools are all
*trackers* with no fundamental analysis; the research platforms are all
subscription SaaS requiring an account. That intersection is the position worth
defending, and section 3 argues it is the most valuable thing we have after the
thesis layer.

---

## 2. Feature gaps

Ranked by whether they should change the roadmap, not by how large they are.

### 2.1 No portfolio accounting — deliberate, but say so

There is no share count, cost basis, lot tracking, realised/unrealised split,
XIRR, TWR or MWRR anywhere in the codebase. Every platform in the survey has
some form of this, and the survey treats the MWRR-versus-TWR distinction as a
tier marker separating serious tools from basic ones.

The "portfolio health aggregator" aggregates **scores, not money**. Omaha can
answer *is this company sound?* but not *how am I doing?*

This is a legitimate scope choice and probably the right one — it is what keeps
the app free of broker credentials, which is the privacy claim. But it should be
an explicit stated boundary rather than an apparent omission, because "stock
tracker" sets an expectation the product deliberately does not meet. Positioning
language should say *research and conviction*, never *tracking*.

### 2.2 No CSV import — the achievable half of ingestion

Broker synchronisation is structurally incompatible with zero-recurring-cost:
the survey is explicit that per-institution aggregator fees (Plaid, SnapTrade,
Yodlee) are exactly what forces the 10–15 holding caps on the independent SaaS
tier, and drives Stock Events to unbundle sync as a separate weekly charge.

CSV import carries no such cost, and is how My Stocks Portfolio and Ghostfolio
sidestep the problem entirely. If 2.1 is ever revisited, this is the entry
point — not an aggregator.

### 2.3 No Android home-screen widget — the cheapest real gap

Doc 13 does not mention widgets anywhere. The survey gives widget depth its own
column in the feature matrix, and for the native/lightweight archetype it is
*the* differentiator — My Stocks Portfolio's principal selling point is
resizable, sortable, themable home-screen widgets.

For an Android release specifically this is the most visible omission relative
to effort. Glance makes it contained work, and a health-score-plus-delta widget
would be unusual: the widgets in the market show prices, not fundamentals.

**Recommended for the launch scope.**

### 2.4 No forward-looking data — a virtue, but name it

Seeking Alpha's EPS Revisions factor and Simply Wall St's Future Performance
axis both run on analyst consensus. Omaha is entirely backward-looking: filed
statements plus user-driven DCF assumptions.

This is a genuine feature difference against both close comparators, and it is
one we should claim rather than concede. Consensus estimates are a survey of
opinion; filed statements are fact. But the DCF sandbox already exists precisely
so the user supplies the forward view themselves — so the honest framing is
*"we do not tell you the future, we give you the instrument to model it"*.

### 2.5 Screener scope — rename it

`/api/screener` filters the watchlist universe (`server/index.js:340` — the
comment says so plainly: cover the portfolio rather than an arbitrary subset).
Simply Wall St screens 120,000 stocks across 90 global markets. These are
different tools: ours filters things already under consideration, theirs is
discovery.

The name oversells and will disappoint. Consider *Filter* or *Compare across
watchlist*. Building true discovery screening is out of scope — it needs a
universe we do not ingest.

### 2.6 No dividend or cash-flow planning — out of scope, confirm it

Pillar 5 scores dividend safety, but there is no ex-date calendar, no forward
payout projection, no yield-on-cost. Stock Events, Snowball Analytics and
DivTracker own this segment for income and FIRE investors.

That persona is not the one in doc 01. Confirm it stays out of scope rather than
drifting in feature by feature.

---

## 3. Differentiators

### 3.1 Pre-committed sell triggers — unmatched in the survey

Checked against all ten platforms in the feature matrix: **nothing comparable
exists.** No competitor asks the user to record, in advance, what would make
them sell, and then holds them to it with an interactive checklist.

This is the strongest asset in the product, and it is strong because of what it
targets. Every competitor optimises the *buy* decision — Seeking Alpha issues a
Quant Rating, Simply Wall St draws a Snowflake. None addresses the exit, which
is where undisciplined selling does its damage.

Together with the thesis and journal, this makes Omaha an **accountability
instrument rather than an oracle**. That is a coherent product philosophy no
incumbent occupies, and all positioning should lead with it.

Caveat worth holding: it only pays off for users who actually write things down.
That is a power-user behaviour. It fits doc 01's persona and caps reach at the
same time.

### 3.2 Research depth without an account or a subscription

See section 1. The empty quadrant. Against Simply Wall St at roughly $90–260/yr
and Seeking Alpha at $239–299/yr, *free, and it never sees your brokerage
account* is a real proposition — and one the incumbents cannot copy without
dismantling their revenue model.

### 3.3 Transparency, which the survey names as the incumbents' weakness

The survey's own critique of visual factor abstraction: it "reduces cognitive
friction for individual investors but abstracts the underlying quantitative
weighting parameters." That lands squarely on the Snowflake and on letter
grades.

Omaha uses named, externally-defined, checkable measures — Altman Z, Piotroski
F — with per-item drawers explaining the reasoning, and after the audit work it
**declines to score what it cannot measure** rather than filling gaps
favourably. A user can verify our arithmetic against the filings. They cannot
verify a proprietary 1.0–5.0 rating derived from 100+ undisclosed weights.

Caveat: transparency loses the first three seconds against a Snowflake. It wins
the second week. Onboarding has to survive the gap.

### 3.4 Monetisation shape

Every platform in the survey runs subscription tiers or advertising. A free app
with pay-per-use AI is genuinely unusual, and it reinforces 3.2 rather than
fighting it.

### 3.5 Rated lower than instinct suggests

* **DCF sandbox** — Stock Unlock ships custom DCF tools and Simply Wall St runs
  automated two-stage DCF. The model is table stakes in this archetype. The
  live sliders and bear/base/bull presets are the differentiated part, not the
  DCF itself.
* **AI analysis** — already arriving in the market; Stock Events includes AI
  queries on its *free* tier. Ours is better integrated, but it is not a moat.

---

## 4. What the docs say about commercial strategy

Audited across all docs, the README and the backlog. The finding is sharper than
expected and belongs in this document because positioning depends on it.

**What exists is a cost-recovery design, not a commercial strategy.** Doc 13 §7
is well reasoned and states its own frame explicitly: the paywall's purpose is
*"cost control, not revenue protection"*, and *"copying and forking are
explicitly not a concern."* From that follow consumable credit packs rather than
a permanent unlock, anonymous auth for the credit balance, mandatory Play
Billing, and a Cloud Function verifying the purchase token so a flipped local
flag cannot drain the Gemini quota. All sound.

**What does not exist anywhere:**

| | |
| --- | --- |
| Price point | Open item in doc 13 — needs measured cost-per-analysis first |
| Free-tier allowance | Undefined. No stated number of free analyses |
| Target market | Doc 01 §2 names the persona as *"Primary Investor / Wife"* — a household of two, not a market |
| Competitive positioning | Nothing before this document |
| Revenue goal | Never stated; §7 implicitly disclaims one |
| Distribution and discovery | Absent entirely — no acquisition, ASO or launch thinking |
| Retention | Absent |

This is internally consistent: a personal tool, shipped publicly, whose paywall
exists so a stranger's Re-Analyze button cannot spend the author's money. That
is a defensible position and needs no apology.

**But it is not the position implied by commissioning a market survey.** The
gap between "cost recovery for a household tool" and "a product competing with
Simply Wall St" is a decision, not a detail, and everything downstream depends
on it — whether 2.3 is worth building, whether 2.1 stays closed, whether the
free tier has a limit, whether doc 14's coverage question resolves toward US-only
or global.

**Resolve this before the launch scope is fixed.** See §6.1.

---

## 5. Tension with doc 14: coverage

The EDGAR migration narrows statement coverage to SEC registrants. That is
precisely the axis on which the comparators advertise: Simply Wall St covers
120,000 stocks across 90 markets; Stock Events covers 100,000 instruments across
50+ exchanges.

This does not reverse doc 14's recommendation, but it sharpens its open decision
3 into a positioning question rather than a technical one:

* **US-equity research tool** → EDGAR is strictly better. Official, free, filed
  numbers rather than re-derivations, explicit reporting currency. Coverage
  becomes a stated scope, not a shortfall.
* **Global coverage** → Yahoo must be retained as fallback for non-US listings,
  and the migration becomes a hybrid rather than a replacement, with two
  statement paths to keep correct.

The first is more honest about what the product is good at. The second is more
competitive on a spec sheet.

---

## 6. Open decisions

1. **Is this a business or a household tool shipped publicly?** Everything in
   §4 hangs on this, and so does §5. Decide explicitly.
2. **Widget in launch scope?** Recommended — cheapest closure of a visible gap
   (§2.3).
3. **Rename the screener** (§2.5). Small, and prevents a disappointed
   expectation.
4. **Confirm portfolio accounting and dividend planning stay out of scope**
   (§2.1, §2.6) rather than drifting in.
5. **Positioning sentence.** Whatever §6.1 decides, lead with the thesis and
   sell-trigger discipline (§3.1) and never use the word *tracker*.
