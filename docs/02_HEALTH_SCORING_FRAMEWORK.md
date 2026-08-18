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

## 2. Pillar Scoring Model (100 Points Total)

Each pillar is scored from 0 to 20 points based on weighted sub-metrics and sector-normalized benchmarks.

### Pillar 1: Financial Health & Solvency (Weight: 20 pts)
*Measures insolvency risk, leverage, and liquidity cushion.*
* **Altman Z-Score** (0–5 pts):
  * $Z > 3.0$ (Safe Zone): **5 pts**
  * $1.8 \le Z \le 3.0$ (Grey Zone): **3 pts**
  * $Z < 1.8$ (Distress Zone): **0 pts**
* **Net Debt to EBITDA** (0–5 pts):
  * Net Cash (Cash > Debt): **5 pts**
  * $< 1.5x$: **4 pts**
  * $1.5x - 3.0x$: **2 pts**
  * $> 3.0x$: **0 pts**
* **Interest Coverage (EBIT / Interest Expense)** (0–5 pts):
  * $> 8.0x$: **5 pts**
  * $4.0x - 8.0x$: **3 pts**
  * $1.5x - 4.0x$: **1 pt**
  * $< 1.5x$: **0 pts**
* **Current & Quick Ratios** (0–5 pts):
  * Current $> 1.5$ & Quick $> 1.0$: **5 pts**
  * Current $> 1.0$: **3 pts**
  * Current $< 1.0$: **0 pts**

---

### Pillar 2: Profitability & Moat Quality (Weight: 20 pts)
*Measures capital allocation efficiency and economic moat durability.*
* **Piotroski F-Score (0–9 scale converted to 0–5 pts)**:
  * 8–9 (Exceptional): **5 pts**
  * 6–7 (Good): **3.5 pts**
  * 4–5 (Average): **2 pts**
  * $\le 3$ (Weak): **0 pts**
* **Return on Invested Capital (ROIC)** (0–5 pts):
  * $\text{ROIC} > 15\%$ (Substantial Moat): **5 pts**
  * $10\% - 15\%$: **3.5 pts**
  * $5\% - 10\%$: **2 pts**
  * $< 5\%$: **0 pts**
* **Operating Margin Stability (3-Year Trend)** (0–5 pts):
  * Expanding margins $> +100\text{ bps}$: **5 pts**
  * Stable ($\pm 50\text{ bps}$): **3.5 pts**
  * Compressing margins: **0–1 pts**
* **Free Cash Flow Conversion (FCF / Net Income)** (0–5 pts):
  * $> 100\%$ (High quality earnings): **5 pts**
  * $80\% - 100\%$: **3.5 pts**
  * $< 50\%$ or Negative FCF: **0 pts**

---

### Pillar 3: Valuation & Margin of Safety (Weight: 20 pts)
*Measures price paid relative to intrinsic value, historical multiples, and peers.*
* **Forward P/E vs. 5-Year Historical Average** (0–5 pts):
  * $> 15\%$ below historical average: **5 pts**
  * Within $\pm 10\%$ of historical average: **3.5 pts**
  * $> 25\%$ above historical average: **1 pt**
* **PEG Ratio (P/E to Forward Growth)** (0–5 pts):
  * $\text{PEG} < 1.0$ (Undervalued for growth): **5 pts**
  * $1.0 \le \text{PEG} \le 1.8$: **3.5 pts**
  * $1.8 < \text{PEG} \le 2.5$: **2 pts**
  * $\text{PEG} > 2.5$: **0 pts**
* **EV / Free Cash Flow Yield** (0–5 pts):
  * FCF Yield $> 6.0\%$: **5 pts**
  * $4.0\% - 6.0\%$: **3.5 pts**
  * $2.0\% - 4.0\%$: **2 pts**
  * $< 2.0\%$: **0.5 pts**
* **DCF Fair Value Discount** (0–5 pts):
  * Trading at $> 20\%$ discount to 2-stage DCF: **5 pts**
  * At fair value ($\pm 10\%$): **3 pts**
  * $> 20\%$ premium: **0 pts**

---

### Pillar 4: Growth & Operating Leverage (Weight: 20 pts)
*Measures top-line and bottom-line expansion velocity.*
* **Revenue CAGR (3-Year)** (0–5 pts):
  * $> 15\%$: **5 pts**
  * $8\% - 15\%$: **3.5 pts**
  * $3\% - 8\%$: **2 pts**
  * $< 0\%$: **0 pts**
* **EPS Growth (Diluted, 3-Year CAGR)** (0–5 pts):
  * $> 20\%$: **5 pts**
  * $10\% - 20\%$: **3.5 pts**
  * $0\% - 10\%$: **1.5 pts**
  * Negative: **0 pts**
* **FCF per Share Growth (3-Year)** (0–5 pts):
  * $> 15\%$: **5 pts**
  * $5\% - 15\%$: **3.5 pts**
  * Negative: **0 pts**
* **Gross Margin Trend** (0–5 pts):
  * Stable or expanding over 5 consecutive quarters: **5 pts**

---

### Pillar 5: Capital Allocation & Shareholder Returns (Weight: 20 pts)
*Measures how responsibly management allocates capital.*
* **Share Count Dilution / Buyback Yield** (0–7 pts):
  * Net share reduction $> 2\%$ / year (Accretive buybacks): **7 pts**
  * Share count flat ($\pm 0.5\%$): **5 pts**
  * Share dilution $> 2\%$ / year (Excessive SBC): **0 pts**
* **Dividend Safety & Coverage (if paying dividend) OR Reinvestment Rate**:
  * For dividend payers: FCF Payout Ratio $< 60\%$ + 5+ yr streak: **7 pts**
  * For non-dividend payers: Reinvestment Rate with ROIC $> 15\%$: **7 pts**
* **Return on Assets (ROA) / Asset Turnover Efficiency** (0–6 pts):
  * High asset turnover relative to sector median: **6 pts**

---

## 3. The 12-Point Traffic-Light Fundamental Checklist

The checklist gives an instant binary/ternary health test:

| # | Check Name | 🟢 Pass Criteria | 🟡 Watch Criteria | 🔴 Fail Criteria |
|---|------------|-------------------|-------------------|------------------|
| 1 | **Altman Z-Score** | $Z \ge 3.0$ | $1.8 \le Z < 3.0$ | $Z < 1.8$ |
| 2 | **Interest Coverage** | $> 6.0x$ | $2.5x - 6.0x$ | $< 2.5x$ |
| 3 | **Current Ratio** | $\ge 1.5$ | $1.0 - 1.49$ | $< 1.0$ |
| 4 | **Debt to Equity** | $< 0.8$ or Net Cash | $0.8 - 1.8$ | $> 1.8$ |
| 5 | **Positive Free Cash Flow** | Positive all 5 past yrs | Positive 3-4 yrs | Negative $\ge 2$ yrs |
| 6 | **Piotroski F-Score** | 7, 8, 9 | 5, 6 | $\le 4$ |
| 7 | **ROIC vs WACC** | $\text{ROIC} \ge \text{WACC} + 5\%$ | $\text{ROIC} \ge \text{WACC}$ | $\text{ROIC} < \text{WACC}$ |
| 8 | **Gross Margin Consistency** | Expanding / Steady | $\le 100\text{ bps}$ drop | Sharp compression |
| 9 | **Share Dilution** | Shrinking or $< 0.5\%$ | $0.5\% - 2.5\%$ | $> 2.5\%$ dilution |
| 10| **FCF / Net Income Quality** | $> 90\%$ | $60\% - 90\%$ | $< 60\%$ |
| 11| **Valuation PEG Ratio** | $\le 1.5$ | $1.5 - 2.2$ | $> 2.2$ |
| 12| **Revenue 3Y Growth** | $> 8\%$ CAGR | $2\% - 8\%$ CAGR | Declining ($< 0\%$) |

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
