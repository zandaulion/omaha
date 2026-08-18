# Financial Data Provider & Technical Implementation Architecture (Path A: 100% Free Self-Hosted Stack)

This document specifies the complete, zero-recurring-cost data ingestion pipeline using **`yahoo-finance2`** and the built-in fundamental scoring calculation engine for **Pocket Omaha**.

---

## 1. Architecture Overview: Zero-Cost Financial Engine

```
                             POCKET OMAHA PWA (Client)
                                         │
                                         ▼
                         NODE.JS / NEXT.JS BACKEND API
                                         │
                 ┌───────────────────────┴───────────────────────┐
                 ▼                                               ▼
     SQLITE / SUPABASE CACHE                          `yahoo-finance2` FETCH
     • 15-min TTL for Quotes                          (100% Free, No API Keys)
     • 24-hr TTL for Financials                       • `quote` (Live price)
     • Local SQLite / Turso / Postgres                • `quoteSummary` (Statements)
                 ▲                                               │
                 │                                               ▼
                 └──────────────── Built-In Calculation Engine ──┘
                                   • Altman Z-Score Formula
                                   • Piotroski F-Score (9-Pt)
                                   • ROIC vs. WACC
                                   • 2-Stage DCF Intrinsic Value
```

---

## 2. Yahoo Finance Data Modules Ingestion

Using the open-source [`yahoo-finance2`](https://github.com/gadicc/node-yahoo-finance2) library:

```typescript
import yahooFinance from 'yahoo-finance2';

export async function fetchRawStockData(ticker: string) {
  // Suppress community survey notices
  yahooFinance.suppressNotices(['yahooSurvey']);

  const [quote, summary] = await Promise.all([
    yahooFinance.quote(ticker),
    yahooFinance.quoteSummary(ticker, {
      modules: [
        'financialData',
        'defaultKeyStatistics',
        'incomeStatementHistory',
        'balanceSheetHistory',
        'cashflowStatementHistory',
        'incomeStatementHistoryQuarterly',
        'balanceSheetHistoryQuarterly'
      ]
    })
  ]);

  return { quote, summary };
}
```

---

## 3. The Quantitative Scoring Engine (TypeScript Implementation)

### 1. Altman Z-Score Calculation
$$\text{Altman } Z = 1.2 X_1 + 1.4 X_2 + 3.3 X_3 + 0.6 X_4 + 0.999 X_5$$

```typescript
export function calculateAltmanZScore(params: {
  workingCapital: number;    // Current Assets - Current Liabilities
  retainedEarnings: number;
  ebit: number;
  marketCap: number;
  totalLiabilities: number;
  totalRevenue: number;
  totalAssets: number;
}): number {
  const { workingCapital, retainedEarnings, ebit, marketCap, totalLiabilities, totalRevenue, totalAssets } = params;
  if (!totalAssets || totalAssets <= 0) return 0;

  const X1 = workingCapital / totalAssets;
  const X2 = retainedEarnings / totalAssets;
  const X3 = ebit / totalAssets;
  const X4 = marketCap / (totalLiabilities || 1);
  const X5 = totalRevenue / totalAssets;

  const zScore = (1.2 * X1) + (1.4 * X2) + (3.3 * X3) + (0.6 * X4) + (0.999 * X5);
  return parseFloat(zScore.toFixed(2));
}
```

---

### 2. Piotroski F-Score (0–9 Fundamental Health Tests)

```typescript
export function calculatePiotroskiFScore(current: any, prior: any): number {
  let score = 0;

  // 1. Profitability Signals (4 Points)
  if (current.netIncome > 0) score++;                                       // F1: Positive Net Income
  if (current.operatingCashFlow > 0) score++;                              // F2: Positive Operating Cash Flow
  if (current.roa > prior.roa) score++;                                    // F3: Higher Return on Assets YoY
  if (current.operatingCashFlow > current.netIncome) score++;              // F4: Cash Flow > Net Income (Earnings Quality)

  // 2. Leverage, Liquidity & Source of Funds (3 Points)
  if (current.longTermDebt <= prior.longTermDebt) score++;                 // F5: Lower/Flat Long-Term Debt
  if (current.currentRatio > prior.currentRatio) score++;                  // F6: Higher Current Ratio
  if (current.sharesOutstanding <= prior.sharesOutstanding) score++;       // F7: No Dilution / Share Count Shrink

  // 3. Operating Efficiency (2 Points)
  if (current.grossMargin > prior.grossMargin) score++;                    // F8: Gross Margin Expansion
  if (current.assetTurnover > prior.assetTurnover) score++;                // F9: Asset Turnover Improvement

  return score;
}
```

---

### 3. Return on Invested Capital (ROIC)

$$\text{Invested Capital} = \text{Total Debt} + \text{Total Equity} - \text{Cash}$$
$$\text{NOPAT} = \text{EBIT} \times (1 - \text{Effective Tax Rate})$$
$$\text{ROIC} = \frac{\text{NOPAT}}{\text{Invested Capital}} \times 100\%$$

---

## 4. Database Schema for Local Caching (SQLite / PostgreSQL)

```sql
CREATE TABLE stock_cache (
    ticker VARCHAR(10) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    sector VARCHAR(100),
    price DECIMAL(10, 2) NOT NULL,
    change_pct DECIMAL(5, 2) NOT NULL,
    health_score INT NOT NULL,               -- 0 to 100
    altman_z DECIMAL(5, 2) NOT NULL,
    piotroski_score INT NOT NULL,            -- 0 to 9
    roic_pct DECIMAL(5, 2) NOT NULL,
    fcf_conversion_pct INT NOT NULL,
    net_cash_b DECIMAL(10, 2) NOT NULL,
    financials_json JSON NOT NULL,          -- 5-year historical trend arrays
    checklist_json JSON NOT NULL,           -- 12-point checklist status
    last_fetched_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast ticker searches
CREATE INDEX idx_stock_cache_health ON stock_cache(health_score);
```

---

## 5. Summary of Why Path A is Ideal for Pocket Omaha

1. **Zero Recurring Cost**: No $20–$50/month API subscriptions.
2. **Offline-Ready**: Statements are stored in SQLite/Supabase and cached in the client PWA.
3. **Completely Private**: Data is fetched directly by your personal server and stored locally.
4. **Tailored Control**: Full ownership over the health scoring formulas and thresholds.
