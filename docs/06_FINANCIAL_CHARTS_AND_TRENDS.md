# 5-Year Financial Trends & Capital Structure Visualizations

This document details the visual chart specifications, data structures, and layout standards for the historical trends module in **Pocket Omaha**.

---

## 1. Objectives & Financial Narrative

Traditional stock apps present dense tabular financial filings that are tedious to parse on mobile.  
The **5-Year Trends Module** translates 5 years of SEC filings into 4 high-clarity visual cards:

1. **Revenue vs. Free Cash Flow Trajectory**: Visualizes top-line growth coupled with cash conversion quality.
2. **Balance Sheet Cushion Stack**: Compares Liquid Cash & Short-Term Investments directly against Total Debt.
3. **Margin Trajectory (Gross & Operating)**: Shows whether the company's pricing power and operating leverage are expanding or decaying.
4. **Share Count & Capital Return History**: Shows whether management is retiring shares via buybacks or diluting investors via stock-based compensation (SBC).

---

## 2. Component Specifications & Layout

```
┌─────────────────────────────────────────────────────────────┐
│ 📊 5-YEAR HISTORICAL FINANCIAL TRAJECTORY                   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 1. REVENUE VS. FREE CASH FLOW ($B)                          │
│    ■ Revenue  ■ Free Cash Flow                              │
│                                                             │
│    $120B ┤         █                                        │
│     $80B ┤     █   █ ▒                                      │
│     $40B ┤ █ ▒ █ ▒ █ ▒                                      │
│       $0 ┴───┴───┴───┴───┴──                                │
│          2020 2021 2022 2023 2024                           │
│    5Y Revenue CAGR: +74.2%  •  FCF Conversion: 108%         │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 2. BALANCE SHEET LIQUIDITY & DEBT STACK                     │
│    [$31.4B Cash & Equivalents  ░░░░░░░░░░░░░░░░░░░░░░░░░░]   │
│    [$9.7B Total Debt           ███████                  ]   │
│    ───────────────────────────────────────────────────────  │
│    💎 Net Cash Fortress: +$21.7B (Zero solvency risk)       │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 3. 5-YEAR MARGIN EXPANSION (%)                              │
│    ── Gross Margin:     62% ➔ 65% ➔ 68% ➔ 72% ➔ 75.8% 🟢   │
│    ── Operating Margin: 32% ➔ 36% ➔ 38% ➔ 45% ➔ 54.2% 🟢   │
│    Pricing power expanded +920 bps YoY                      │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ 4. SHARES OUTSTANDING DILUTION / BUYBACKS                   │
│    2.60B ➔ 2.55B ➔ 2.50B ➔ 2.47B ➔ 2.45B (-5.8% 5Y) 🟢      │
│    Management retired 150M shares over 5 years              │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Data Schema for Historical Trends

```typescript
interface HistoricalFinancials {
  years: number[]; // e.g. [2020, 2021, 2022, 2023, 2024]
  revenue: number[]; // in Billions USD
  freeCashFlow: number[]; // in Billions USD
  grossMarginPct: number[];
  operatingMarginPct: number[];
  cashAndEquivalents: number; // Current ($B)
  totalDebt: number; // Current ($B)
  sharesOutstanding: number[]; // Billions of shares
}
```

---

## 4. Visual Styling Guidelines

* **Revenue Bars**: Slate Cyan gradient (`linear-gradient(180deg, #38BDF8 0%, #0284C7 100%)`).
* **Free Cash Flow Bars**: Emerald Green gradient (`linear-gradient(180deg, #10B981 0%, #059669 100%)`).
* **Net Cash Stack**: Green track for cash reserves vs. subtle coral bar for debt obligations.
* **Micro-tooltips**: Tapping any bar in the PWA displays the exact dollar value and YoY growth rate.
