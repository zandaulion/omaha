# Stock Health Evaluation Engine & Quantitative Framework

This document outlines the scoring architecture used to convert raw financial statements (Income Statement, Balance Sheet, Cash Flow Statement) into an intuitive, multi-tiered health evaluation.

---

## 1. Overall Architecture: The 4-Layer Assessment

```
                      ┌─────────────────────────────────────────┐
                      │      Overall Health Score (0 - 100)     │
                      │       [ 88/100 · Strong Financials ]    │
                      └────────────────────┬────────────────────┘
                                           │
         ┌───────────────────┬─────────────┴───────┬───────────────────┐
         ▼                   ▼                     ▼                   ▼
┌─────────────────┐ ┌─────────────────┐ ┌───────────────────┐ ┌─────────────────┐
│ 5 Pillar Scores │ │ Traffic-Light   │ │ Pros & Cons       │ │ Deep Financial  │
│ (20 pts each)   │ │ Checklist (12)  │ │ Automated Insights│ │ Ratios & Trends │
│ • Solvency      │ │ 🟢 9 Pass       │ │ ⚡ 3 Catalysts    │ │ • Balance Sheet │
│ • Profitability │ │ 🟡 2 Watch      │ │ ⚠️ 1 Red Flag     │ │ • Margins       │
│ • Valuation     │ │ 🔴 1 Fail       │ │                   │ │ • FCF & Debt    │
│ • Growth        │ │                 │ │                   │ │ • Multiples     │
│ • Dividends/Moat│ │                 │ │                   │ │                 │
└─────────────────┘ └─────────────────┘ └───────────────────┘ └─────────────────┘
```

---

## 2. How an unmeasurable metric is handled

This comes before the pillars because it governs all of them.

A company's filings may not contain a given line item. A bank files no gross
profit; a company with only one filed year has no Piotroski score; some filers
stop disclosing interest expense. In every such case:

1. The metric is `null` — never a default, a sector average, or a scaled copy
   of an adjacent year.
2. Its sub-score is marked **unavailable** and contributes nothing.
3. The pillar's denominator shrinks accordingly, so the company is neither
   credited nor penalised for the gap, and the pillar is rescaled to 20.
4. If fewer than **60%** of all sub-scores can be measured, **no composite
   score is emitted at all** — the app shows "Not enough filed data to score"
   with the coverage ratio, rather than a number built mostly from absences.

Metrics that are *inapplicable to the business model* rather than merely
missing are removed from the scorecard entirely instead of counted as
unmeasured. A bank is scored on equity/assets and return on equity; it is not
marked down for having no working-capital cycle.

The interface always states which fiscal year the fundamentals come from and,
where coverage is below 100%, how many measures were available.

---

## 3. Pillar Scoring Model (100 Points Total)

Each pillar carries 20 points, scored over whichever of its sub-measures the
filings support.

### Pillar 1: Financial Health & Solvency

*Operating companies* — four measures at 5 points each:

| Measure | 5 pts | 3–4 pts | 0 pts |
|---|---|---|---|
| **Altman Z-Score** | $Z \ge 3.0$ | $1.8 \le Z < 3.0$ → 3 | $Z < 1.8$ |
| **Net debt / EBITDA** | net cash | $< 1.5\times$ → 4; $\le 3.0\times$ → 2 | $> 3.0\times$ |
| **Interest coverage** | $> 8\times$, or no debt | $4$–$8\times$ → 3; $1.5$–$4\times$ → 1 | $< 1.5\times$ |
| **Current & quick ratio** | current $\ge 1.5$ and quick $\ge 1.0$ | current $\ge 1.0$ → 3 | current $< 1.0$ |

*Banks, insurers and REITs* — one measure, the others being inapplicable:

| Measure | 5 pts | 2.5–4 pts | 0 pts |
|---|---|---|---|
| **Equity / assets** | $\ge 10\%$ | $\ge 8\%$ → 4; $\ge 6\%$ → 2.5 | $< 6\%$ |

### Pillar 2: Profitability & Moat Quality

| Measure | 5 pts | 2–3.5 pts | 0 pts |
|---|---|---|---|
| **Piotroski F-Score** | 8–9 | 6–7 → 3.5; 4–5 → 2 | $\le 3$ |
| **ROIC** (operating cos.) | $\ge 15\%$ | $\ge 10\%$ → 3.5; $\ge 5\%$ → 2 | $< 5\%$ |
| **Return on equity** (financials) | $\ge 15\%$ | $\ge 10\%$ → 3.5; $\ge 6\%$ → 2 | $< 6\%$ |
| **Operating margin trend** | $> +100$ bps YoY | $\ge -50$ bps → 3.5; $\ge -200$ bps → 1.5 | worse |
| **FCF conversion** | $\ge 100\%$ | $\ge 80\%$ → 3.5; $\ge 50\%$ → 2 | $< 50\%$ |

Note the operating-margin row measures the **trend**, not the level. A 25%
margin compressing from 40% is a different business from one expanding towards
25%, and only the trend distinguishes them.

### Pillar 3: Valuation & Margin of Safety

| Measure | 5 pts | 2–3.5 pts | 0 pts |
|---|---|---|---|
| **Forward P/E vs. its own 5-year range** | $> 15\%$ below median | within $\pm 10\%$ → 3.5; $\le 25\%$ above → 2 | further above |
| **PEG ratio** | $< 1.0$ | $\le 1.8$ → 3.5; $\le 2.5$ → 2 | $> 2.5$ |
| **EV / FCF yield** | $\ge 6\%$ | $\ge 4\%$ → 3.5; $\ge 2\%$ → 2 | $< 2\%$ |
| **Discount to DCF fair value** | $\ge 20\%$ | $\ge -10\%$ → 3; $\ge -20\%$ → 1 | further above |

The P/E row compares against the stock's own history, built from five years of
monthly closes divided by the diluted EPS filed at each point. A negative PEG
means earnings are shrinking, which is not a cheapness signal — that row is
marked unavailable rather than scored.

### Pillar 4: Growth & Operating Leverage

| Measure | 5 pts | 1.5–3.5 pts | 0 pts |
|---|---|---|---|
| **Revenue CAGR** | $\ge 15\%$ | $\ge 8\%$ → 3.5; $\ge 3\%$ → 2 | $< 3\%$ |
| **Diluted EPS CAGR** | $\ge 20\%$ | $\ge 10\%$ → 3.5; $\ge 0\%$ → 1.5 | negative |
| **FCF per share CAGR** | $\ge 15\%$ | $\ge 5\%$ → 3.5; $\ge 0\%$ → 1.5 | negative |
| **Gross margin trajectory** | expanding | $\ge -100$ bps → 3.5; $\ge -300$ bps → 1.5 | sharper fall |

EPS and FCF per share are separate measurements taken from separate series.
The margin trajectory uses the filed quarters where available, falling back to
year-on-year. Financials are scored on the first two rows only.

### Pillar 5: Capital Allocation & Shareholder Returns

| Measure | Full marks | Partial | 0 |
|---|---|---|---|
| **Buybacks vs. dilution** (7 pts) | shares down $\ge 2\%$ | flat $\pm 0.5\%$ → 5; $\le +2\%$ → 2 | $> +2\%$ dilution |
| **Dividend safety** (7 pts, payers) | FCF payout $< 60\%$ and $\ge 5$-year streak | covered but shorter streak → 5.5; payout $< 90\%$ → 3 | above 90% |
| **Reinvestment quality** (7 pts, non-payers) | ROIC $\ge 15\%$ | $\ge 10\%$ → 5; $\ge 5\%$ → 3 | $< 5\%$ |
| **Asset turnover** (6 pts) | $\ge 1.25\times$ sector median | $\ge 0.9\times$ → 4.5; $\ge 0.6\times$ → 3 | below |

Asset turnover is scored against the median of cached peers in the same sector
once at least three exist; below that it falls back to absolute thresholds. A
grocer and a software company are not comparable on turnover in absolute terms.

### The composite

The composite is $\text{earned} / \text{possible} \times 100$ over the
measurable sub-scores. **There is no floor.** A company that fails every
measurable test scores 0, and the tier boundaries (85 / 70 / 50) are calibrated
against a scale that genuinely reaches the bottom.

---

## 4. The 12-Point Traffic-Light Fundamental Checklist

Each item resolves to 🟢 pass, 🟡 watch, 🔴 fail, or **not reported** — the
fourth state being as informative as the others, and never silently folded
into one of the first three.

| # | Check | 🟢 Pass | 🟡 Watch | 🔴 Fail |
|---|-------|---------|----------|---------|
| 1 | **Altman Z-Score** | $Z \ge 3.0$ | $1.8 \le Z < 3.0$ | $Z < 1.8$ |
| 2 | **Interest coverage** | $> 6\times$, or no debt | $2.5$–$6\times$ | $< 2.5\times$ |
| 3 | **Current ratio** | $\ge 1.5$ | $1.0$–$1.49$ | $< 1.0$ |
| 4 | **Debt to equity** | $< 0.8$ or net cash | $0.8$–$1.8$ | $> 1.8$, or negative equity |
| 5 | **Free cash flow history** | positive every filed year | one negative year | two or more |
| 6 | **Piotroski F-Score** | $\ge 7$ | $5$–$6$ | $\le 4$ |
| 7 | **ROIC vs. WACC** | spread $\ge +5$ pts | spread $\ge 0$ | ROIC below WACC |
| 8 | **Gross margin consistency** | expanding or steady | $\le 100$ bps drop | sharper compression |
| 9 | **Share dilution** | shrinking or $< 0.5\%$ | $0.5\%$–$2.5\%$ | $> 2.5\%$ |
| 10 | **FCF / net income** | $> 90\%$ | $60\%$–$90\%$ | $< 60\%$ |
| 11 | **PEG ratio** | $\le 1.5$ | $1.5$–$2.2$ | $> 2.2$ |
| 12 | **Revenue growth** | $> 8\%$ CAGR | $2\%$–$8\%$ | $< 2\%$ |

Items that report **not reported** rather than a status:

* **#1** for banks, insurers and REITs — Altman is undefined for them.
* **#3** likewise: those balance sheets are not classified current/non-current.
* **#4** shows *negative book equity* as its own fail state. A ratio cannot be
  formed against negative equity, and defaulting it into the pass band inverts
  the single loudest leverage signal there is.
* **#7** falls back to an absolute 15% threshold when beta or market cap is
  unavailable and WACC cannot be estimated.
* **#11** when expected growth is negative — a shrinking business is not cheap.

Checks #5 and #8 measure history and direction rather than the latest level,
which is what the words "history" and "consistency" mean.

---

## 4. Automated Strength & Red Flag Detection Rules

The engine dynamically generates human-readable tags:
* **Moat Strengths**:
  * 💎 *Fortress Balance Sheet*: Cash & ST investments exceed total debt.
  * 🚀 *High Capital Efficiency*: ROIC $> 20\%$ for 3 consecutive years.
  * 📈 *Operating Leverage*: Revenue grew $12\%$ while Operating Income grew $24\%$.
  * 💰 *Cash Machine*: Free Cash Flow margin $> 25\%$.
* **Risk Flags**:
  * ⚠️ *Debt Maturity Pressure*: Short-term debt $> 40\%$ of total cash balance.
  * ⚠️ *Share Dilution*: Stock-based compensation causing share count expansion $> 3\%$ YoY.
  * ⚠️ *Margin Squeeze*: Gross margin declined 3 quarters in a row.
  * ⚠️ *Valuation Stretch*: Price to Sales $> 90\text{th}$ percentile of 10-year range.
