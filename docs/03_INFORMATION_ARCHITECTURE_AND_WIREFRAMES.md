# Information Architecture, Screen Flows & Wireframes

This document details the navigation hierarchy, screen wireframes, and interaction patterns for the Stock Health PWA.

---

## 1. PWA Navigation Structure (5 Bottom Nav Items)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        BOTTOM NAVIGATION TABS                          │
├───────────────┬────────────────┬────────────────┬──────────────────────┤
│ 1. Watchlist  │ 2. Deep Dive   │ 3. Screener    │ 4. Compare           │ 
│ (Portfolio &  │ (Ticker Health │ (Filter Stocks │ (Side-by-side        │
│  Watchlists)  │  Scorecard)    │  by Health)    │  Peer Matrix)        │
└───────────────┴────────────────┴────────────────┴──────────────────────┘
```

---

## 2. Screen Breakdown & Wireframe Layouts

### Screen 1: Watchlist & Portfolio Health Dashboard (`/watchlist`)

```
┌─────────────────────────────────────────────────────────────────┐
│ 9:41                             [WiFi] [Battery 100%]          │
│                                                                 │
│  StockPulse                              [ Search 🔍 ] [ 🔔 ]   │
│  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  │
│                                                                 │
│  ┌─ PORTFOLIO HEALTH COMPOSITE ───────────────────────────────┐ │
│  │  Health Grade: EXCELLENT (89/100)                          │ │
│  │  [==== Solvency 94% ====]  [==== Profitability 91% ====]   │ │
│  │  [==== Valuation 76% ===]  [==== Growth 88% ===========]   │ │
│  │  14 Pass · 2 Watch · 0 Red Flags                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [ Core Long-Term ▼ ]   [ + New List ]   Sort: [ Health Score ▼]│
│                                                                 │
│  ┌─ TICKER CARD: AAPL · Apple Inc. ───────────────────────────┐ │
│  │  $189.84   +1.4%             HEALTH SCORE: 88/100 🟢        │ │
│  │  P/E: 28.4 | ROIC: 54.2%     Checklist: 10 Pass · 2 Watch   │ │
│  │  ⚡ Fortress Balance Sheet    ⚠️ Extended Multiples          │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ TICKER CARD: MSFT · Microsoft Corp. ──────────────────────┐ │
│  │  $420.55   +0.8%             HEALTH SCORE: 92/100 🟢        │ │
│  │  P/E: 34.1 | ROIC: 31.8%     Checklist: 11 Pass · 1 Watch   │ │
│  │  ⚡ High FCF Margin 33%       ⚡ Revenue Growth +15%         │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌─ TICKER CARD: TSLA · Tesla Inc. ───────────────────────────┐ │
│  │  $177.20   -3.2%             HEALTH SCORE: 64/100 🟡        │ │
│  │  P/E: 62.0 | ROIC: 11.4%     Checklist: 6 Pass · 4 Watch ·2🔴│
│  │  ⚡ Clean Balance Sheet       ⚠️ Auto Gross Margin Pressure  │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [ Watchlist ]   [ Deep Dive ]   [ Screener ]   [ Compare ]     │
└─────────────────────────────────────────────────────────────────┘
```

---

### Screen 2: Stock Deep Dive & Health Scorecard (`/stock/:ticker`)

```
┌─────────────────────────────────────────────────────────────────┐
│ [ < Back ]       NVDA · NVIDIA Corporation        [ ⭐ Bookmark ]│
│ $125.40   +$3.20 (+2.62%)   •   Tech / Semiconductors           │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌── OVERALL HEALTH SCORE ────────────────────────────────────┐ │
│  │                     ╭──────────╮                           │ │
│  │                     │  94/100  │  "Pristine Health"        │ │
│  │                     ╰──────────╯                           │ │
│  │   Solvency: 19/20  •  Profitability: 20/20  •  Growth: 20/20│ │
│  │   Valuation: 16/20 •  Capital Return: 19/20                │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  [ Segmented Tabs: Overview | 5 Pillars | Checklist | Ratios ]  │
│                                                                 │
│  ⚡ KEY CATALYSTS & STRENGTHS                                    │
│  • 🟢 Ultra-high ROIC (68.4%) indicating monopolistic moat      │
│  • 🟢 Gross Margin expanded +920 bps YoY to 75.8%               │
│  • 🟢 Zero net debt; $31B cash cushion protects downturns       │
│                                                                 │
│  ⚠️ CAUTION FLAGS                                               │
│  • 🟡 Forward P/E of 38.5x is 1.4x higher than 5Y sector median │
│                                                                 │
│  ┌── 12-POINT TRAFFIC LIGHT CHECKLIST ────────────────────────┐ │
│  │ 🟢 Altman Z-Score: 18.2 (Safe Zone > 3.0)           [PASS] │ │
│  │ 🟢 Interest Coverage: 44.2x (Safe > 6.0x)           [PASS] │ │
│  │ 🟢 Piotroski F-Score: 9/9 (Top Decile)              [PASS] │ │
│  │ 🟢 Free Cash Flow Conversion: 112%                  [PASS] │ │
│  │ 🟡 Forward PEG Ratio: 1.82 (Watch 1.5 - 2.0)        [WATCH]│ │
│  │ 🟢 Share Count Trend: -1.2% YoY Buybacks            [PASS] │ │
│  │ (Tap to expand all 12 checks...)                           │ │
│  └────────────────────────────────────────────────────────────┘ │
│                                                                 │
│  ┌── DEEP FINANCIAL RATIO MATRIX ─────────────────────────────┐ │
│  │ Metric             Value        Sector Median    5Y Percent│ │
│  │ Gross Margin       75.8%        48.2% 🟢         98th %    │ │
│  │ Operating Margin   54.1%        22.4% 🟢         99th %    │ │
│  │ Debt / Equity      0.18         0.65  🟢         15th %    │ │
│  │ Current Ratio      3.8          1.8   🟢         85th %    │ │
│  │ EV / FCF           36.2x        24.0x 🟡         80th %    │ │
│  └────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

---

### Screen 3: Fundamental Health Screener (`/screener`)

* Filters stocks by:
  * Minimum Health Score (e.g. $\ge 80$)
  * Minimum Piotroski F-Score ($\ge 7$)
  * Minimum ROIC ($\ge 15\%$)
  * Debt/Equity $(< 0.5$ or Net Cash)
  * Free Cash Flow Positive (Yes)
  * Sector & Market Cap presets.

---

### Screen 4: Peer Health & Moat Comparison (`/compare`)

* Side-by-side column comparison of up to 4 companies (e.g. `AAPL vs MSFT vs GOOGL`):
  * Overall Health Score Radar Chart.
  * Solvency comparison (Net Debt / EBITDA, Current Ratio).
  * Profitability comparison (ROIC, Operating Margin).
  * Valuation comparison (Forward P/E, EV/FCF, PEG).
  * Checklist Pass Rate comparison (% of rules passed).

---

## 3. PWA Responsive & Mobile Gestures
* **Smooth Pull-to-Refresh**: Updates real-time prices and financial filings.
* **Haptic Touch Cards**: Subtle haptic feedback when tapping scorecards or toggling checklist items.
* **Bottom Sheet Drawers**: Sliding detail sheets for ratio explanations without leaving the main view.
* **Dark / Light Mode**: System auto-detect + manual high-contrast toggle.
