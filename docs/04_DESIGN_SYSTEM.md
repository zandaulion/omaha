# Design System & Token Specifications

This document defines the visual language, color tokens, typography scales, and component specifications for the StockPulse PWA.

---

## 1. Color Palette & Semantic Tokens

The design uses a refined, modern FinTech palette inspired by Apple Stocks, Linear, and Copilot. It avoids generic dashboard clichés and focuses on high-contrast legibility, tactile depth, and functional semantic cues.

### Core Canvas & Surfaces (Dark Mode Primary, Light Mode Supported)

```css
:root {
  /* Dark Theme (Default) */
  --bg-canvas: #0B0E14;             /* Deep slate-tinted black */
  --bg-surface: #121824;            /* Primary card background */
  --bg-surface-elevated: #1A2234;   /* Modals, drawers, high elevation */
  --bg-surface-subtle: #161F2E;     /* Secondary nested panels */
  
  --border-subtle: rgba(255, 255, 255, 0.08);
  --border-prominent: rgba(255, 255, 255, 0.16);

  /* Typography Colors */
  --text-primary: #F3F5F9;          /* High contrast crisp white */
  --text-secondary: #94A3B8;        /* Slate muted secondary */
  --text-tertiary: #64748B;         /* Tertiary / hints */
  --text-accent: #38BDF8;           /* Sky blue primary interaction */

  /* Health & Financial Semantics */
  --health-pristine: #10B981;       /* Emerald / Mint (Score 85 - 100) */
  --health-pristine-bg: rgba(16, 185, 129, 0.12);
  --health-good: #34D399;           /* Soft Emerald (Score 70 - 84) */
  --health-good-bg: rgba(52, 211, 153, 0.12);
  --health-moderate: #FBBF24;       /* Amber / Ochre (Score 50 - 69) */
  --health-moderate-bg: rgba(251, 191, 36, 0.12);
  --health-risk: #F87171;           /* Coral / Crimson (Score < 50) */
  --health-risk-bg: rgba(248, 113, 113, 0.12);

  /* Accent & Brand */
  --brand-cyan: #06B6D4;
  --brand-indigo: #6366F1;
  --brand-gradient: linear-gradient(135deg, #06B6D4 0%, #3B82F6 100%);
}

/* Light Theme Variables */
[data-theme="light"] {
  --bg-canvas: #F8FAFC;
  --bg-surface: #FFFFFF;
  --bg-surface-elevated: #FFFFFF;
  --bg-surface-subtle: #F1F5F9;
  
  --border-subtle: #E2E8F0;
  --border-prominent: #CBD5E1;

  --text-primary: #0F172A;
  --text-secondary: #475569;
  --text-tertiary: #94A3B8;
  --text-accent: #0284C7;

  --health-pristine: #059669;
  --health-pristine-bg: #ECFDF5;
  --health-good: #10B981;
  --health-good-bg: #F0FDF4;
  --health-moderate: #D97706;
  --health-moderate-bg: #FFFBEB;
  --health-risk: #DC2626;
  --health-risk-bg: #FEF2F2;
}
```

---

## 2. Typography System

* **Primary Font Family**: `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Inter", "Segoe UI", Roboto, sans-serif`
* **Monospace / Numerical Family**: `"SF Mono", "JetBrains Mono", "Roboto Mono", monospace` (for exact ticker prices, ratios, and percentages)

| Token | Size | Line Height | Weight | Tracking | Usage |
|---|---|---|---|---|---|
| `display-lg` | 32px | 38px | 700 | -0.03em | Primary Health Score number |
| `title-1` | 24px | 30px | 600 | -0.02em | Screen titles, Stock price |
| `title-2` | 18px | 24px | 600 | -0.01em | Card headings, Section headers |
| `body-md` | 15px | 22px | 400 | 0 | Primary text, descriptions |
| `body-sm` | 13px | 18px | 400 | +0.01em | Ratio labels, sub-metrics |
| `caption` | 11px | 15px | 500 | +0.03em | Badges, pillar tags, timestamps |

---

## 3. Key Component Specs

### 1. Circular / Radial Health Score Ring
* Inner score display with animated SVG circular progress ring.
* Colored according to score tier (Emerald for $85+$, Amber for $50-84$, Red for $<50$).
* Dynamic subtitle rating: "Pristine Solvency", "Solid Moat", "Valuation Watch", "High Leverage Risk".

### 2. Traffic Light Checklist Item
* Interactive row with:
  * Status badge: 🟢 `PASS` / 🟡 `WATCH` / 🔴 `FAIL`
  * Metric name + actual value (e.g. *Interest Coverage: 14.2x*)
  * Target benchmark rule (e.g. *Benchmark > 6.0x*)
  * Info tooltip/drawer explanation on click.

### 3. Financial Ratio Card & Percentile Bar
* Metric value vs. 5-year range mini-scrubber.
* Sector median reference pin.
* Instant visual indicator whether the current valuation is at the historical low, median, or high end.

### 4. Moat / Catalyst Tags
* Pill component with subtle glassmorphic backdrop.
* Green spark icon ⚡ for key positive strengths.
* Amber warning icon ⚠️ for caution factors.
