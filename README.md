# Pocket Omaha 🎩

> **A Mobile-First Progressive Web App (PWA) for Stock Health, Economic Moats, and Fundamental Rigor.**  
> Built for modern value investors who demand deep balance-sheet clarity, durable free cash flows, and zero noise.

---

## 🌟 Key Features

1. **Composite Health Scorecard (0–100)**:
   - Evaluates companies across 5 pillars (20 pts each):
     - 🛡️ **Financial Health & Solvency** (Altman Z-Score, Net Debt / EBITDA, Current Ratio)
     - 🚀 **Profitability & Moat Quality** (ROIC, Operating Margins, Piotroski F-Score)
     - 🎯 **Valuation & Margin of Safety** (Historical P/E, PEG, EV/FCF, DCF Discount)
     - 📈 **Growth & Operating Leverage** (Revenue & EPS 3-Year CAGR, Gross Margin Trend)
     - 💰 **Capital Allocation & Returns** (Share Dilution / Buyback Yield, Dividend Safety)

2. **12-Point Traffic-Light Fundamental Checklist**:
   - Instant 🟢 `PASS` / 🟡 `WATCH` / 🔴 `FAIL` assessment against rigorous value-investing benchmarks.
   - Interactive detail drawers explaining the economic moat logic behind each test.

3. **5-Year Historical Financial Trajectory**:
   - Dual bar chart of **Revenue vs. Free Cash Flow ($B)** with real cash conversion analysis.
   - **Balance Sheet Cushion Stack** comparing Liquid Cash directly against Total Debt obligations.
   - Gross vs. Operating Margin expansion trends.
   - Shares outstanding trajectory (buybacks vs. stock-based compensation dilution).

4. **Interactive DCF & Intrinsic Fair Value Sandbox**:
   - 2-stage Discounted Cash Flow model with Exit Multiple terminal value.
   - Real-time slider controls for 5-Year FCF Growth Rate, Terminal Exit Multiple, and Discount Hurdle Rate.
   - Instant 🐻 *Bear Case*, ⚖️ *Base Case*, and 🐂 *Bull Case* presets.

5. **Personal Investment Thesis & Journaling Log**:
   - Written buy thesis and conviction level (1 to 5 stars / *Fortress Moat*).
   - Target entry buy price tracking.
   - Pre-committed exit guardrails with interactive checklist triggers.
   - Dated chronological journal entries with JSON backup export and restore.

6. **Fundamental Screener & Side-by-Side Peer Comparison**:
   - Multi-factor filtering with instant preset queries (*👑 Fortress Moats*, *🚀 ROIC ≥ 20%*, *💎 Net Cash*).
   - Side-by-side comparison matrix for up to 4 peer tickers.

7. **Zero-Recurring-Cost Architecture & Offline-First PWA**:
   - `yahoo-finance2` zero-cost financial statement ingestion.
   - 15-minute quote caching and 24-hour financial statement caching in SQLite.
   - Standalone mobile PWA installation for iOS (Safari) and Android (Chrome).
   - Service worker offline cache and VAPID Web Push notifications.

8. **Admin Integration with `pwa-invite-console`**:
   - Exposes standard `/api/admin/*` endpoints protected by `X-Admin: 1` header.
   - Passwordless invite code generation and single-device token binding.

---

## 🚀 Quick Start

### 1. Install Dependencies & Run

```bash
cd pocket-omaha
npm install
npm start
```

Open `http://localhost:3000` in your browser.

### 2. Run in Development Mode with Auto-Reload

```bash
npm run dev
```

---

## 🛠️ CLI Administration (`admin.sh`)

Manage device invites and authorizations from the terminal:

```bash
# Create a new 7-day invite code
./admin.sh invite "Wife's iPhone"

# List active and redeemed invites
./admin.sh invites

# List registered devices
./admin.sh devices

# Revoke a device
./admin.sh revoke <device_id>
```

---

## 📡 API Overview

| Endpoint | Method | Description |
|---|---|---|
| `/api/stock/:ticker` | `GET` | Full stock profile, 5 pillars, 12-point checklist, and 5Y trends |
| `/api/watchlists` | `GET`, `POST` | Watchlists management |
| `/api/watchlists/:id/health` | `GET` | Aggregated portfolio composite health score |
| `/api/screener` | `GET` | Fundamental multi-factor stock filtering |
| `/api/compare` | `GET` | Side-by-side comparison for multiple tickers |
| `/api/theses/:ticker` | `GET`, `POST` | Personal investment thesis, sell triggers, and journal entries |
| `/api/theses` | `GET` | Download full personal data backup JSON |
| `/api/auth/redeem` | `POST` | Redeem invite code and bind device |
| `/api/auth/session` | `GET` | Validate device authorization |
| `/api/admin/devices` | `GET` | Admin: List registered devices (`X-Admin: 1`) |
| `/api/admin/invites` | `GET`, `POST` | Admin: Manage invite codes (`X-Admin: 1`) |
| `/api/push/vapid-key` | `GET` | Retrieve Web Push public VAPID key |
| `/api/push/subscribe` | `POST` | Register Web Push subscription |

---

## 📂 Project Architecture

```
pocket-omaha/
├── docs/                      # 12 detailed architecture and product specifications
├── server/
│   ├── index.js               # Express API and static server
│   ├── db.js                  # SQLite database engine (node:sqlite)
│   ├── scoring.js             # Quantitative scoring (Altman Z, Piotroski, ROIC, DCF)
│   ├── finance.js             # yahoo-finance2 data provider and multi-tier cache
│   ├── auth.js                # Device management and pwa-invite-console integration
│   └── push.js                # Web Push VAPID notification service
├── web/
│   ├── index.html             # Mobile-first PWA shell
│   ├── app.css                # FinTech dark/light design system
│   ├── app.js                 # Reactive state controller, DCF sandbox, checklist
│   ├── manifest.webmanifest   # PWA web manifest
│   ├── sw.js                  # Offline caching and push listener
│   └── icons/                 # High-res PWA icons and SVG assets
├── admin.sh                   # Administration CLI tool
└── package.json               # Node.js project manifest
```
