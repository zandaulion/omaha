# Pocket Omaha — PWA Product Specification

> **Target User**: Modern advanced investor who values deep fundamental rigor, clean cash flows, and durable moats.  
> **Platform**: Progressive Web App (PWA) — Mobile-First (iOS / Android Home Screen installable) + Responsive Desktop/Tablet companion.  
> **Design Philosophy**: Modern FinTech (Apple Stocks × Copilot × Linear aesthetic) — High information density balanced with breathability, crisp typography, and instant visual health diagnosis.

---

## 1. Executive Summary & Vision

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
