# UX Edge States, Onboarding Flow & PWA Offline Architecture

This document specifies the first-run onboarding experience, empty states, error handling, and offline data freshness UX for **Pocket Omaha**.

---

## 1. First-Run Onboarding Flow ("Welcome to Pocket Omaha")

When opening the app for the first time, a zero-friction onboarding modal guides the user to curate her initial watchlist:

```
┌─────────────────────────────────────────────────────────────┐
│ 🎩 WELCOME TO POCKET OMAHA                                  │
│ "Track wonderful businesses with durable economic moats."   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ Choose a curated starter watchlist to begin:                │
│                                                             │
│ ┌─ 👑 THE COMPOUNDERS BUNDLE ─────────────────────────────┐ │
│ │ AAPL · MSFT · GOOGL                                     │ │
│ │ Composite Health: 90/100 · Pristine Cash Conversion     │ │
│ │ [ + Select Bundle ]                                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ 🚀 AI & SEMICONDUCTORS BUNDLE ─────────────────────────┐ │
│ │ NVDA · MSFT · GOOGL                                     │ │
│ │ Composite Health: 92/100 · High ROIC Growth             │ │
│ │ [ + Select Bundle ]                                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ ┌─ 🛡️ DEFENSIVE ARISTOCRATS BUNDLE ───────────────────────┐ │
│ │ JNJ · MSFT · AAPL                                       │ │
│ │ Composite Health: 88/100 · Low Leverage & Safe Dividends│ │
│ │ [ + Select Bundle ]                                     │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [ Or Search & Pick Custom Tickers → ]                       │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Empty States Specifications

### A. Empty Watchlist State
* **Trigger**: User deletes all tickers in a list or creates a blank list.
* **Layout**:
  * Icon: 🏰
  * Headline: *"No Stocks in this Watchlist"*
  * Subtext: *"Add companies with strong financial health and durable moats to calculate your composite score."*
  * CTAs: `[ 🔍 Search Tickers ]` and `[ ⚡ Open Filter ]`.

### B. No Search Results State
* **Trigger**: Search query returns 0 matches.
* **Layout**:
  * Headline: *"No matching ticker or company found for '[query]'"*
  * Subtext: *"Tip: Try searching by symbol (e.g. NVDA, MSFT) or standard company name."*

---

## 3. PWA Offline & Stale Data UX Policy

PWA apps must feel instantaneous even on spotty mobile network connections:

```
┌─────────────────────────────────────────────────────────────┐
│ ⚡ OFFLINE MODE · Viewing cached filings (Updated 2h ago) 🔄 │
└─────────────────────────────────────────────────────────────┘
```

### Stale-While-Revalidate Policy:
1. **Instant Load**: App renders from IndexedDB / CacheStorage in $< 50\text{ ms}$.
2. **Background Sync**: Service worker fetches latest quotes & filings in the background.
3. **Data Freshness Timestamp**: Displays a discreet badge (e.g. `● 10-Q Data: Fresh (Q2 2024)` or `● Offline Cache`).
