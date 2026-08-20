# Financial Data Provider & Technical Implementation Architecture (Path A: 100% Free Self-Hosted Stack)

This document specifies the zero-recurring-cost data ingestion pipeline and the
built-in fundamental scoring engine for **Pocket Omaha**.

> **The single most important constraint in this app.** Yahoo's free
> `quoteSummary` statement modules return empty envelopes. Fundamentals come
> from `fundamentals-timeseries` instead, and anything it does not supply is
> reported as unavailable rather than estimated. Section 2 covers both.

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
     LOCAL SQLITE CACHE                               YAHOO FETCH (no API key)
     • 15-min TTL for quotes                          • quoteSummary  -> price,
     • 24-hr TTL for statements                         multiples, profile
     • Raw statements stored for reuse                • fundamentals-timeseries
                 ▲                                     -> annual + quarterly
                 │                                        statements
                 │                                     • chart -> 5y price history
                 └──────────────── Built-In Calculation Engine ──┘
                                   • Altman Z-Score (non-financials only)
                                   • Piotroski F-Score (9-pt, real prior year)
                                   • ROIC vs. estimated WACC
                                   • 2-stage DCF intrinsic value
                                   • Every metric nullable
```

---

## 2. Yahoo Finance Data Modules Ingestion

### The endpoint that no longer works

`quoteSummary`'s statement modules are the obvious choice and they are empty.
Yahoo still returns the envelope, so the failure is silent:

```
GET /v10/finance/quoteSummary/AAPL?modules=balanceSheetHistory,cashflowStatementHistory,incomeStatementHistory

balanceSheetHistory[0]      -> { maxAge, endDate }            // nothing else
cashflowStatementHistory[0] -> { maxAge, endDate, netIncome } // nothing else
incomeStatementHistory[0]   -> totalRevenue and netIncome real,
                               grossProfit = 0, ebit = 0, incomeTaxExpense = 0,
                               interestExpense absent
```

Any implementation that reads those modules and falls back on a default when a
field is missing will produce a complete-looking scorecard built almost
entirely from its own fallbacks. That is exactly what happened in the first
build of this app, and it is the reason for the rule below.

### The endpoint that does work

`fundamentals-timeseries` still serves complete annual and quarterly statements
with the same cookie and crumb:

```
GET /ws/fundamentals-timeseries/v1/finance/timeseries/{SYMBOL}
      ?symbol={SYMBOL}
      &type=annualTotalRevenue,annualGrossProfit,annualEBIT,annualInterestExpense,
            annualTotalAssets,annualTotalLiabilitiesNetMinorityInterest,
            annualStockholdersEquity,annualCurrentAssets,annualCurrentLiabilities,
            annualInventory,annualRetainedEarnings,annualCashAndCashEquivalents,
            annualOtherShortTermInvestments,annualTotalDebt,annualFreeCashFlow,
            annualOperatingCashFlow,annualCapitalExpenditure,
            annualDilutedAverageShares,annualDilutedEPS,...
      &period1=1200000000&period2={now}&crumb={crumb}
```

Four annual periods come back for most filers, plus quarterly series, each
datapoint carrying its own `currencyCode`. Implemented in `server/yahoo.js`.

### The rule this module enforces

**A value Yahoo does not supply is returned as `null`.** No estimate, no
sector average, no scaled copy of an adjacent year. Downstream, a `null`
input produces an unavailable metric, an unavailable metric produces an
unscored checklist item, and an unscored item is excluded from its pillar's
denominator rather than counted as a zero or a pass.

Two exceptions, both arithmetic rather than estimation:

* **Accounting identity.** Where two of `assets = liabilities + equity` are
  filed, the third is derived. Yahoo omits `TotalLiabilities` for some filers
  (Alphabet among them); computing it is not a guess.
* **Carry-forward.** Where a filer stops populating a line — Apple's interest
  expense ends at FY2023 — the most recent filed value is used, and the year it
  came from is carried alongside so the interface can label it.

---

## 3. The Quantitative Scoring Engine (TypeScript Implementation)

### 1. Altman Z-Score

$$\text{Altman } Z = 1.2 X_1 + 1.4 X_2 + 3.3 X_3 + 0.6 X_4 + 0.999 X_5$$

Where $X_1$ = working capital / assets, $X_2$ = retained earnings / assets,
$X_3$ = EBIT / assets, $X_4$ = market cap / total liabilities, $X_5$ = revenue
/ assets.

Two constraints the formula itself does not express:

* **All five terms are required.** A missing term returns `null`, not a partial
  sum. Treating an absent retained-earnings figure as zero biases $X_2$ toward
  the safe zone, and the reader has no way to know.
* **It does not apply to banks, insurers or REITs.** Their balance sheets have
  no working-capital cycle, so $X_1$ and $X_5$ are meaningless. For those, the
  scorecard substitutes equity / assets — the plain-language form of the
  regulatory leverage ratio — and marks the Z-score as not applicable.

---

### 2. Piotroski F-Score (0–9)

Nine binary signals, of which **six compare against the prior fiscal year**:

| # | Signal | Category |
|---|--------|----------|
| F1 | Positive net income | Profitability |
| F2 | Positive operating cash flow | Profitability |
| F3 | Return on assets improved YoY | Profitability |
| F4 | Operating cash flow exceeds net income | Earnings quality |
| F5 | Leverage (LTD / assets) steady or lower | Leverage |
| F6 | Current ratio improved | Liquidity |
| F7 | Diluted share count did not rise | Dilution |
| F8 | Gross margin expanded | Efficiency |
| F9 | Asset turnover improved | Efficiency |

**Without a filed prior year the score is unavailable.** Synthesising one is
the failure mode to avoid: a prior year generated by scaling the current year
down makes all six comparisons pass by construction, which produces a floor of
6/9 for every company and destroys the signal entirely.

Where a filer omits a line item the affected signals are excluded and the score
is scaled to the canonical 0–9 range, so a bank's 7-of-7 stays comparable with
an industrial's 9-of-9.

---

### 3. Return on Invested Capital (ROIC)

$$\text{Invested Capital} = \text{Total Debt} + \text{Total Equity} - \text{Cash}$$
$$\text{NOPAT} = \text{EBIT} \times (1 - \text{Effective Tax Rate})$$
$$\text{ROIC} = \frac{\text{NOPAT}}{\text{Invested Capital}} \times 100\%$$

**Invested capital can be zero or negative** — AutoZone, Home Depot, McDonald's
and Starbucks have all bought back stock into negative book equity. ROIC is
undefined there and must be reported as unavailable. Clamping the denominator
to a small positive number turns a real edge case into a nine-digit percentage
that passes every moat test.

The effective tax rate comes from `TaxProvision / PretaxIncome`. A loss-making
year makes that ratio meaningless (negative, or far above 100%), so the
statutory 21% is substituted and flagged — NOPAT is negative either way.

### 4. Cost of Capital (WACC)

The checklist compares ROIC against an estimated WACC rather than a fixed
threshold, because a 12% return means something different for a utility than
for a semiconductor company:

$$\text{Cost of Equity} = r_f + \beta \times \text{ERP}$$
$$\text{Cost of Debt} = \frac{\text{Interest Expense}}{\text{Total Debt}}$$
$$\text{WACC} = k_e \cdot \frac{E}{D+E} + k_d(1-t) \cdot \frac{D}{D+E}$$

With $r_f = 4.2\%$ and $\text{ERP} = 5\%$. It is labelled an estimate in the
interface because beta and market capitalisation are market-implied, not filed.

---

## 4. Database Schema for Local Caching (SQLite / PostgreSQL)

```sql
CREATE TABLE stock_cache (
    ticker VARCHAR(10) PRIMARY KEY,
    name VARCHAR(150) NOT NULL,
    sector VARCHAR(100),
    price DECIMAL(10, 2) NOT NULL,
    change_pct DECIMAL(5, 2),
    -- Every derived metric is nullable. A company whose filings do not support
    -- a measure stores NULL for it; NOT NULL here would force the fabrication
    -- this pipeline exists to avoid.
    health_score INT,                       -- 0 to 100, or NULL when unscoreable
    altman_z DECIMAL(5, 2),
    piotroski_score INT,                    -- 0 to 9
    roic_pct DECIMAL(5, 2),
    fcf_conversion_pct INT,
    net_cash_b DECIMAL(10, 2),
    financials_json JSON NOT NULL,          -- headline figures + trend arrays
    checklist_json JSON NOT NULL,           -- 12-point checklist status
    statements_json JSON,                   -- raw filed statements, for reuse
    last_fetched_at TIMESTAMPTZ DEFAULT NOW(),        -- quote, 15-minute TTL
    financials_fetched_at TIMESTAMPTZ                 -- statements, 24-hour TTL
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
