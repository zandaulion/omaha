# Personal Investment Thesis & Journaling Architecture

This document specifies the design, data model, and user interactions for the **Personal Investment Thesis & Journaling** module in **Pocket Omaha**.

---

## 1. Purpose & Investor Psychology

Disciplined value investors like Warren Buffett emphasize having a written investment thesis *before* investing, along with predefined sell criteria to prevent emotional trading.

The **My Thesis & Journal** tab equips the user with:
1. **Core Buy Thesis & Moat Rationale**: A concise statement of why she believes in the business.
2. **Conviction Level & Target Buy Price**: Custom ratings (e.g., `⭐⭐⭐⭐⭐ Fortress Conviction`) and personal buy target.
3. **Pre-Committed Sell Triggers (Guardrails)**: Objective checklist of events that invalidate the thesis (e.g. *Gross margin drops below 60%*, *Debt/Equity exceeds 1.5*).
4. **Chronological Journal Log**: Timestamped notes (e.g. post-earnings thoughts, dividend reinvestments).

---

## 2. Component Wireframe & Layout

```
┌─────────────────────────────────────────────────────────────┐
│ 📝 MY INVESTMENT THESIS & JOURNAL (NVDA)                    │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ┌─ THESIS & CONVICTION ───────────────────────────────────┐ │
│ │ Conviction: [ ⭐⭐⭐⭐⭐ Fortress Moat ▼ ]                  │ │
│ │ Target Entry Price: [ $115.00 ]  (Current: $128.60)     │ │
│ │                                                         │ │
│ │ Core Rationale:                                         │ │
│ │ "Dominant AI compute monopoly with CUDA software lock-in│ │
│ │  and 85%+ market share. Unleveraged balance sheet with  │ │
│ │  $31B cash and ROIC > 60%."                             │ │
│ │                                                         │ │
│ │ Moat Tags: [ ⚡ Pricing Power ] [ 💎 Net Cash ] [ 🔒 Lock-in ]│ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ PRE-COMMITTED SELL TRIGGERS (GUARDRAILS) ──────────────┐ │
│ │ 🔲 Auto Gross Margin drops below 60% for 2 quarters     │ │
│ │ 🔲 Hyperscaler CapEx cuts announced > 20% YoY           │ │
│ │ 🔲 Share dilution exceeds 3% from SBC                   │ │
│ │ [ + Add Custom Sell Trigger ]                           │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ CHRONOLOGICAL JOURNAL & ACTIVITY LOG ──────────────────┐ │
│ │ 📅 Aug 28, 2024:                                        │ │
│ │ "Q2 earnings beat by 12%. Data center revenue +154%.    │ │
│ │  Reinvested dividend. Holding strong."                  │ │
│ │                                                         │ │
│ │ 📅 May 22, 2024:                                        │ │
│ │ "Announced 10-for-1 stock split. Gross margins at 78%." │ │
│ │                                                         │ │
│ │ [ + Write New Journal Note... ]                         │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Data Schema & Persistence

```typescript
interface InvestmentThesis {
  ticker: string;
  conviction: 'low' | 'medium' | 'high' | 'fortress'; // 1 to 4/5
  targetBuyPrice: number | null;
  coreRationale: string;
  moatTags: string[];
  sellTriggers: {
    id: string;
    text: string;
    triggered: boolean;
  }[];
  journalEntries: {
    id: string;
    date: string; // ISO date string
    note: string;
  }[];
  updatedAt: string;
}
```

### Storage Strategy:
* **Client-side (PWA Offline First)**: Stored in `localStorage` / `IndexedDB` keyed by `thesis_${ticker}` with instant auto-save.
* **Cloud Sync (Future Backend)**: Synchronized with PostgreSQL table `user_investment_theses` via REST/GraphQL.
