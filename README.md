# Pocket Omaha 🎩

> **Scores a company from its filed statements — then holds you to the exit rules
> you wrote while you were calm.**  
> A mobile-first PWA for stock health, economic moats and fundamental rigor, built
> for value investors who want balance-sheet clarity, durable free cash flows and
> zero noise.
>
> Every competitor optimises the *buy* decision. This one is built around the
> exit: a written thesis, pre-committed sell triggers, and a journal that
> remembers what you thought before the price moved. It is an accountability
> instrument, not an oracle — and **not a portfolio tracker**; see
> `docs/01_PRODUCT_SPEC.md` §4 for what it deliberately does not do.

---

## The rule this app is built on

**A number shown to you is a number that was measured.**

Yahoo's free statement endpoints have been hollowed out — `balanceSheetHistory`
now returns nothing but a date. Any app that reads them and quietly substitutes
a default where a field is missing will render a complete, confident, mostly
fictional scorecard. So Pocket Omaha does the opposite:

* A value the filings do not contain is **`null`**, never a plausible constant.
* An unmeasurable check reads **not reported** and is excluded from the score,
  so it neither helps nor hurts.
* Below 60% measurement coverage, **no composite score is produced at all**.
* Charts leave a **gap** for an unreported year. No padding, no extrapolation.
* An unknown ticker is a **404**, not an invented company.
* Every scorecard states the fiscal year it was built from.

Where a metric does not fit a business — Altman Z for a bank, free cash flow
valuation for a lender, debt/equity against negative book equity — it is
reported as inapplicable and a measure that does fit is used instead.

---

## 🌟 Key Features

1. **Composite Health Scorecard (0–100)**:
   - Evaluates companies across 5 pillars (20 pts each):
     - 🛡️ **Financial Health & Solvency** (Altman Z-Score, Net Debt / EBITDA, Current Ratio)
     - 🚀 **Profitability & Moat Quality** (ROIC, Operating Margins, Piotroski F-Score)
     - 🎯 **Valuation & Margin of Safety** (Historical P/E, PEG, EV/FCF, DCF Discount)
     - 📈 **Growth & Operating Leverage** (Revenue, EPS and FCF-per-share CAGR, Gross Margin Trend)
     - 💰 **Capital Allocation & Returns** (Share Dilution / Buyback Yield, Dividend Safety)

2. **12-Point Traffic-Light Fundamental Checklist**:
   - Instant 🟢 `PASS` / 🟡 `WATCH` / 🔴 `FAIL` assessment against rigorous value-investing benchmarks.
   - Interactive detail drawers explaining the economic moat logic behind each test.

3. **Historical Financial Trajectory** (as many years as the company has filed):
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
   - Restore **merges** rather than replaces: the newer version of each thesis wins,
     and journal notes from both sides are kept.

6. **Watchlist Filter & Side-by-Side Peer Comparison**:
   - Multi-factor filtering with instant preset queries (*👑 Fortress Moats*, *🚀 ROIC ≥ 20%*, *💎 Net Cash*).
   - Filters the companies you already follow. It is **not a market screener**:
     there is no universe behind it, so nothing appears that you have not looked
     up before.
   - Side-by-side comparison matrix for up to 4 peer tickers.

7. **Alert Engine**:
   - Watchlist holdings re-checked four times a day against a stored snapshot.
   - Health score moves of 3+ points, checklist state changes, distress
     thresholds, and margin-of-safety entry points.
   - Sunday morning portfolio digest.
   - Per-alert-type preferences and a delivered-alert history in Settings.

8. **Zero-Recurring-Cost Architecture & Offline-First PWA**:
   - Statements from Yahoo's `fundamentals-timeseries` service; no API keys.
   - 15-minute quote caching and 24-hour statement caching in SQLite.
   - Last good API response held in IndexedDB, with an age-stamped banner when
     serving it.
   - Standalone PWA installation for iOS (Safari) and Android (Chrome).

9. **Admin Integration with `pwa-invite-console`**:
   - Standard `/api/admin/*` endpoints, reachable only on the private listener
     that injects `X-Admin: 1`.
   - Passwordless invites: 12-character CSPRNG codes, single-device binding,
     per-IP and global redemption throttling.

---

## Reading the AI prompt

```bash
npm run prompt              # NOK — exercises the traded/reporting currency split
npm run prompt -- AAPL      # any ticker
```

Writes `gemini-prompt.<TICKER>.md`: the exact instruction text and data package
sent to the model, the response schema the API enforces, and a token breakdown.
It fetches real data rather than a fixture, because the point of reading a
prompt is to see what the model actually gets. Generated files are gitignored —
regenerate rather than committing a snapshot that will drift.

---

## Testing

```bash
npm test
```

132 assertions. The 48 in `core/scoring.test.js` each correspond to a defect that
shipped in an earlier build of the scoring engine, and they are the reason the
engine can be changed with any confidence — every one of them produced a
plausible, wrong number that looked correct on screen. The rest cover ingestion
failure handling (`core/providers/yahoo.test.js`), portable decimal formatting
(`core/format.test.js`), timestamp parsing (`core/time.test.js`), the backup
merge rules (`core/backup.test.js`), the alert rules, the Gemini payload, and
the AI notes opt-in (`test/app-settings.test.js`) — which asserts the payload
itself, so a leak of personal data fails the build rather than a flag flipping.

`test/golden.test.js` runs the whole pipeline — raw upstream bytes to scored
model — against recorded responses in `core/__fixtures__/`, for a bank, a
depositary receipt with a currency split, and an industrial on a September year
end. Re-record with:

```bash
node scripts/record-fixture.mjs NOK AAPL JPM
```

Those fixtures are real captured responses, not hand-written. A hand-made
fixture encodes what we believe the upstream returns, and the defects worth
catching are the ones where that belief is wrong.

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
| `/api/filter` | `GET` | Multi-factor filtering across the watchlist universe |
| `/api/compare` | `GET` | Side-by-side comparison for multiple tickers |
| `/api/settings` | `GET`, `POST` | Application preferences, including the AI notes opt-in |
| `/api/theses/:ticker` | `GET`, `POST` | Personal investment thesis, sell triggers, and journal entries |
| `/api/theses` | `GET` | Download full personal data backup JSON |
| `/api/backup/import` | `POST` | Restore a backup, merging rather than replacing |
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
├── core/                      # Shared engine — pure JS, no I/O, no environment
│   ├── scoring.js             # Scoring engine (Altman Z, Piotroski, ROIC, WACC, DCF)
│   ├── scoring.test.js        # Regression suite — one test per historical defect
│   ├── errors.js              # Typed ingestion failures (rate limit vs dead ticker)
│   ├── time.js                # Timestamp parsing that does not vary by JS engine
│   ├── providers/
│   │   ├── index.js           # Market-data seam — getStatements, getQuote, …
│   │   └── yahoo.js           # Statement ingestion; returns null for absent fields
│   ├── analysis/prompt.js     # Gemini payload, prompt and response schema
│   ├── alerts/triggers.js     # Trigger rules — what counts as a real change
│   └── __fixtures__/          # Recorded upstream responses for the golden tests
├── docs/                      # Architecture and product specifications
├── scripts/
│   ├── dump-prompt.mjs        # Renders the exact Gemini prompt as Markdown
│   └── record-fixture.mjs     # Captures live upstream responses as fixtures
├── test/
│   └── golden.test.js         # Whole pipeline, replayed offline from fixtures
├── tools/
│   └── fixture-http.js        # Record/replay classifier shared by both
├── server/                    # PWA host — everything core/ deliberately is not
│   ├── index.js               # Express API and static server
│   ├── db.js                  # SQLite database engine (node:sqlite)
│   ├── finance.js             # Model assembly, cache tiers, sector and P/E context
│   ├── alerts.js              # Sweep and digest worker, delivery, snapshots
│   ├── gemini.js              # Gemini transport and summary cache
│   ├── auth.js                # Invites, device binding, redemption throttle
│   └── push.js                # Web Push VAPID notification service
├── web/
│   ├── index.html             # Mobile-first PWA shell
│   ├── app.css                # FinTech dark/light design system
│   ├── app.js                 # Reactive state controller, DCF sandbox, checklist
│   ├── manifest.webmanifest   # PWA web manifest
│   ├── sw.js                  # Offline caching and push listener
│   └── icons/                 # High-res PWA icons and SVG assets
├── BACKLOG.md                 # Deferred work with pick-up-cold context
├── admin.sh                   # Administration CLI tool
├── LICENSE                    # GNU General Public License v3.0 (GPL-3.0)
└── package.json               # Node.js project manifest
```

---

## 📄 License

This project is open-source software licensed under the [GNU General Public License v3.0 (GPL-3.0)](LICENSE).


