# System Audit & Implementation Status

Measured status of every specified feature, re-checked against the code rather
than against intent. An earlier version of this document marked all eleven rows
"✅ Complete"; several were not, and the discrepancy is the reason this file now
records how each row was verified.

**Legend** — ● built as specified · ◐ built with a documented deviation · ○ specified, not built

---

## 1. Feature status

### Scoring engine

| Feature | Status | Notes |
|---|---|---|
| 5-pillar composite (0–100) | ● | Spans the full range; no per-band floor. Emits `null` below 60% measurement coverage |
| 12-point checklist | ● | Four states including *not reported*; #5 and #8 measure history, not level |
| Altman Z-Score | ● | All five terms required; not applied to financials |
| Piotroski F-Score | ● | Real filed prior year; unavailable without one; scaled when a line is omitted |
| ROIC | ● | `null` on non-positive invested capital; effective tax rate from the filings |
| WACC comparison | ● | CAPM cost of equity from beta, cost of debt from interest paid |
| 2-stage DCF | ● | Quality-linked terminal multiple; not run without positive FCF |
| Catalysts & red flags | ● | Fire only on measured values; no filler when a company has none |
| Sector-relative asset turnover | ◐ | Median of cached peers once ≥3 exist, else absolute thresholds |
| Peer benchmarking | ● | Suggested peers from Yahoo, one tap to add to the comparison |
| 5-year percentile bars | ◐ | Built for P/E from filed EPS and monthly closes; other multiples show current value only |

### Data engine

| Feature | Status | Notes |
|---|---|---|
| Statement ingestion | ● | `fundamentals-timeseries`; `quoteSummary` statement modules are empty (doc 10 §2) |
| Split cache TTLs | ● | 15 minutes for quotes, 24 hours for statements, stored separately |
| Multi-exchange tickers | ● | Verified against `ASML.AS`; suffixed symbols resolve |
| Currency handling | ● | Reporting currency carried per stock and used in every rendered figure |
| Unknown ticker | ● | Returns 404. Synthetic company generation removed |
| Offline behaviour | ● | Last good API response per URL in IndexedDB, with an age-stamped banner |

### Notifications

| Feature | Status | Notes |
|---|---|---|
| VAPID web push | ● | Key generation, subscribe, SW handler, click routing |
| Trigger 1 · health shift ≥3 pts or checklist state change | ● | Compares against the stored snapshot; ignores moves in or out of *not reported* |
| Trigger 2 · distress thresholds | ● | Altman, current ratio, gross margin −300 bps, Piotroski ≤4 |
| Trigger 3 · margin-of-safety entry | ● | Health ≥85 and P/E in its cheapest quintile, or PEG ≤1.30 |
| Trigger 4 · Sunday digest | ● | Hourly window check at 09:00 local, so a restart cannot drop it |
| Preferences & history | ● | `notification_settings`, `notification_history`, both surfaced in Settings |
| Email digest | ○ | Push only. No transactional email provider is configured |

### PWA & interface

| Feature | Status | Notes |
|---|---|---|
| Installable, manifest, icons | ● | |
| Dark / light / system theme | ● | Three-state toggle; follows the OS by default |
| Pull to refresh | ● | Arms only at scroll top on a downward drag |
| Haptic feedback | ● | Respects `prefers-reduced-motion` |
| Radial score ring, traffic-light rows, moat pills | ● | |
| Radar comparison chart | ● | Five pillar spokes across up to four companies |
| Onboarding bundles, empty states | ● | Bundle cards state their size rather than a composite score that was never computed |
| Export theses & watchlists | ● | |
| Screener | ◐ | Filters health, Piotroski, ROIC, debt/equity, net cash, positive FCF, sector — over the stocks this install holds data for. There is no free market-wide universe endpoint behind it |

### Auth

| Feature | Status | Notes |
|---|---|---|
| 7 admin endpoints for `pwa-invite-console` | ● | Registered in `apps.json` |
| `X-Admin: 1` private-listener contract | ● | Public listener 404s `/api/admin/*` and strips the header |
| Invite codes | ● | 12 characters from a CSPRNG over a 32-symbol alphabet, unique-indexed |
| Redemption throttle | ● | Per-IP and global sliding one-minute windows |
| Plaintext wiped on redemption | ● | Revoked and redeemed are distinguishable |

---

## 2. The rule that governs the whole system

**A number shown to the user is a number that was measured.**

Yahoo's free statement modules return empty envelopes, and the first build of
this app answered every gap with a plausible constant. The result passed every
visual inspection: a full scorecard, a five-year chart, a confident grade. It
was also, for most line items, fiction — an empty input object scored 86/100,
and a ticker that does not exist scored 89.

Everything downstream follows from refusing that:

* Absent data is `null`, and `null` renders as an em dash or *not reported*.
* An unmeasurable check is excluded from its pillar's denominator, so it
  neither helps nor hurts.
* Below 60% coverage no composite is produced at all.
* Charts draw a gap for an unreported year; no padding, no extrapolation.
* The AI payload sends `"not reported"` as a literal string and instructs the
  model not to estimate around it.
* An unknown ticker is a 404.

---

## 3. Edge cases verified

**Business models the standard ratios do not fit.** Banks, insurers and REITs
are detected by sector and industry, and scored on equity/assets and return on
equity in place of Altman, working-capital ratios and the DCF. Verified against
`BAC`, which now scores on bank-appropriate measures instead of returning
"Net Cash 💎" against $789B of debt.

**Negative book equity.** Common after sustained buybacks — AutoZone, Home
Depot, McDonald's. Debt/equity is undefined and reported as such; ROIC returns
`null` rather than a nine-digit percentage. Verified against `AZO`.

**Loss-making companies.** The effective tax rate is meaningless in a loss
year, so the statutory rate is substituted and flagged; the DCF does not run.
Verified against `F`, which scores in the high thirties rather than the
mid-fifties.

**Filers that stop disclosing a line.** Apple's interest expense ends at
FY2023. The most recent filed value is carried forward with its year attached,
rather than the check reading as unavailable.

**Missing total liabilities.** Yahoo omits it for some filers including
Alphabet. Derived from `assets − equity`, which is an identity.

**Non-USD reporting.** Verified against `ASML.AS`: figures render in EUR
throughout, including the comparison table alongside USD peers.

---

## 4. Test coverage

`npm test` — 32 assertions in `server/scoring.test.js`, each corresponding to a
defect found in the audit. The load-bearing ones:

* An empty input produces no score.
* Piotroski's year-on-year tests can actually fail.
* ROIC is `null` when invested capital is not positive.
* A cash-burning company gets no fair value.
* Negative equity fails the leverage check rather than passing it.
* Collapsing gross margin fails the consistency check.
* EPS growth and FCF growth are separate measurements.
* The terminal multiple does not move with the share price.
* Altman Z matches a hand-computed value for a real company.
* The composite reaches the bottom of its range.
