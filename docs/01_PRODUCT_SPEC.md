# Pocket Omaha — PWA Product Specification

> **Target User**: Modern advanced investor who values deep fundamental rigor, clean cash flows, and durable moats.  
> **Platform**: Progressive Web App (PWA) — Mobile-First (iOS / Android Home Screen installable) + Responsive Desktop/Tablet companion.  
> **Design Philosophy**: Modern FinTech (Apple Stocks × Copilot × Linear aesthetic) — High information density balanced with breathability, crisp typography, and instant visual health diagnosis.

---

## 1. Executive Summary & Vision

> **Positioning — added 2026-08-24, per `docs/15_COMPETITIVE_POSITION.md` §6.5.**
>
> **Pocket Omaha scores a company from its filed statements, and then holds you
> to the exit rules you wrote while you were calm.**
>
> Lead with that. Doc 15 checked the pre-committed sell triggers against all ten
> platforms in the market survey and found nothing comparable: every competitor
> optimises the *buy* decision, and none addresses the exit, which is where
> undisciplined selling does its damage. Together with the thesis and journal
> that makes this an **accountability instrument rather than an oracle** — a
> position no incumbent occupies.
>
> **Never describe it as a tracker.** The word sets an expectation of portfolio
> accounting that §4 deliberately does not meet, and it gives away the one thing
> nothing else in the market does. *Research and conviction*, not *tracking*.

The goal of this PWA is to empower the user to rapidly assess, track, and monitor individual stock health without having to jump between complex financial spreadsheets, 10-K filings, and noisy social feeds. 

It unifies **macro health scoring**, **rule-based fundamental checklists**, **automated pros/cons risk detection**, and **deep ratio breakdowns** into an elegant, tactile mobile app.

---

## 2. User Persona & Needs

* **Name**: Primary Investor / Wife
* **Investing Approach**: In-depth fundamental analysis, high standards for financial safety, valuation awareness, cash flow durability.
* **Key Pain Points**:
  * Traditional broker apps (Schwab, Interactive Brokers, Fidelity) are cluttered, slow, or have outdated UI.
  * Casual apps (Robinhood) lack deep balance-sheet & fundamental health metrics.
  * Difficult to quickly know if a stock is fundamentally healthy or a "value trap" at a glance.
* **Core Desires**:
  * Immediate 0–100 health score breakdown upon opening any ticker.
  * A clear checklist showing which financial health tests pass, warn, or fail.
  * Bulleted bullet-proof strengths vs. red flags.
  * Deep-dive balance sheet, cash flow, margins, and valuation multiples.
  * Seamless mobile feel with fast search, custom watchlists, and price/health alerts.

---

## 3. Core Feature Pillars

### A. Dynamic Health Scorecard (0–100 Composite)
Evaluates companies across 5 distinct pillars (20 points each):
1. **Financial Health & Solvency** (Altman Z-Score, Debt/Equity, Current Ratio, Interest Coverage)
2. **Profitability & Quality** (Return on Equity, ROIC, Gross/Net Margins, Piotroski F-Score)
3. **Valuation & Fair Value** (P/E vs. 5yr Historical & Sector, PEG, EV/EBITDA, Discounted Cash Flow estimate)
4. **Growth & Momentum** (Revenue 3-5yr CAGR, EPS Growth, Free Cash Flow Growth)
5. **Dividend & Capital Return** (Payout ratio, Dividend streak, FCF yield, Buyback yield)

### B. Traffic-Light Fundamental Checklist (Pass / Watch / Fail)
* Instant 12-to-15 point fundamental rule test.
* Examples:
  * 🟢 *Interest Coverage > 5x* (Pass)
  * 🟡 *Current Ratio between 1.0 and 1.3* (Watch)
  * 🔴 *Share Dilution > 3% YoY* (Fail)

### C. Automated Strengths & Red Flags (Pros & Cons Engine)
* AI/Algorithmic summary cards highlighting:
  * **Top 3 Catalysts / Moat Indicators** (e.g. "Pricing power: Gross margin expanded 220 bps", "Robust fortress balance sheet: $12B Net Cash").
  * **Top 3 Risk Flags** (e.g. "Debt maturity wall in 2027", "Customer concentration: Top 3 clients = 42% revenue").

### D. Deep Financial Multiples & Peer Benchmarking
* Full ratio explorer with interactive range sliders and historical percentiles (5yr Min / Avg / Max).
* Side-by-side peer radar chart / comparison table against top 3 competitors in the same sector.

### E. Watchlists & Portfolio Health Aggregator
* Ability to group stocks into custom watchlists (e.g. "Core Long Term", "Dividend Aristocrats", "Growth Radar").
* **Portfolio Health Index**: Aggregated weighted health score of the entire watchlist.

### F. Offline-First PWA Capabilities
* Installable to iOS / Android Home Screen with standalone display mode.
* Instant cached data load with background syncing.
* Haptic feedback on mobile interactions.

---

## 4. Scope Boundaries — what this deliberately is not

> **Added 2026-08-24.** `docs/15_COMPETITIVE_POSITION.md` §2.1 and §2.6 asked for
> these to be confirmed as decisions rather than left as apparent omissions, so
> that they stop being re-litigated one feature at a time. Reaffirmed by the
> phase 0 decision in `docs/16_ROADMAP.md`.
>
> Each of these is closed. Re-opening one is a product decision, not a backlog
> item.

### A. No portfolio accounting

No share counts, cost basis, lot tracking, realised/unrealised split, XIRR, TWR
or MWRR. The portfolio aggregator sums **scores, not money**.

The app answers *is this company sound?* It does not answer *how am I doing?*

This is what keeps the app free of broker credentials, and the privacy claim is
downstream of it: no account, no aggregator, nothing to link. Every platform in
the market survey has some form of this, and every one of them pays for it with
either a per-institution aggregator fee or a credential prompt.

**If this is ever revisited, the entry point is CSV import, not an aggregator.**
Aggregator fees (Plaid, SnapTrade, Yodlee) are precisely what forces the 10–15
holding caps on the independent tier and are structurally incompatible with
zero recurring cost. CSV carries no such cost.

### B. No dividend or cash-flow planning

Pillar 5 scores dividend *safety*, and that is the extent of it. No ex-date
calendar, no forward payout projection, no yield-on-cost.

Income and FIRE investors are a real segment and a well-served one — Stock
Events, Snowball Analytics and DivTracker own it. That persona is not the one in
§2, and serving it properly would mean becoming a different product.

### C. No discovery screening

The Filter view narrows the companies already under consideration. It is not a
market screener and is no longer named like one (see doc 03, screen 3).

Real discovery needs a universe this app does not ingest, and cannot ingest for
free.

### D. No forward-looking consensus data

No analyst estimates, no EPS revisions, no consensus price targets. The app is
backward-looking by construction: filed statements, plus whatever assumptions
the user supplies to the DCF sandbox.

**This is a position, not a gap.** Consensus estimates are a survey of opinion;
filed statements are fact. The DCF sandbox exists so the user supplies the
forward view themselves — *we do not tell you the future, we give you the
instrument to model it*.
