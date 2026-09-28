# User guide

## What Pocket Omaha does

Pocket Omaha helps a long-term investor follow companies, inspect recorded fundamentals, write down an investment thesis, and revisit that thesis when the app records a financial change or 90 days pass. It does not connect to a brokerage, know position sizes, trade securities, or decide whether a thesis is valid.

The main workflow is:

1. Keep companies in one or more watchlists.
2. Use **Review** to see which companies need attention.
3. Open **Research** to inspect the evidence and your earlier reasons.
4. Record an assessment: **intact**, **watch**, or **changed**.
5. Use alerts as prompts to review, not as buy or sell instructions.

## Access and first launch

### PWA

The hosted PWA is invite protected. Open an unused invite URL or enter its code. A valid code creates a random device token, binds the invite to that device, and stores the token in a secure cookie. Codes expire after seven days, are single use, and can be revoked by the operator. Clearing site data removes the local authorization cookie; the operator must issue another invite unless the original device session remains available.

The PWA can be installed from a supporting browser. Its application shell is cached for offline startup, but API calls are network only.

### Android

The Android app does not require an Omaha account or invite for research, watchlists, reviews, backups, alerts, or the widget. All of those features use local Room storage. Google sign-in is requested only when the user explicitly claims free AI credits, generates a new AI analysis, or buys credits. Opening the AI tab alone does not start sign-in.

## Navigation

The default screen is **Watchlist**. The bottom bar contains:

- **Review** — attention queue derived from local or server records.
- **Watchlist** — selected list, aggregate health, and companies.
- **Research** — the current company's full research view.
- **Compare** — side-by-side comparison for up to five companies.

The header opens search, toggles light/dark appearance, and opens Settings. Tapping the logo returns to Watchlist.

On Android, the system Back button first dismisses the visible dialog, picker, explanation, or sheet. Otherwise it returns to the previous in-app screen. If no history remains and the current screen is not Watchlist, it returns to Watchlist.

Terms with a dotted underline and other marked metrics are explainable. Tap them to open a plain-language definition, interpretation, and limitation. Tap outside the explanation or press Back to dismiss it.

## Watchlists

The selected watchlist name and a visible **Change** affordance open the list picker. Selecting a name changes the active list. The last selected list is remembered on the device.

The watchlist summary shows:

- the number of companies;
- a composite fundamental score and grade when enough data is measurable;
- five 20-point pillar averages;
- totals for checklist passes, watches, failures, and unreported checks;
- whether the aggregate used company-size weighting or equal weighting.

The aggregate is based on company market capitalization when all scored companies have usable market caps. It is not weighted by the user's holdings, cost basis, or exposure. If market-cap weights are incomplete, the app uses equal weights. Unscored companies are shown separately and are not treated as zero.

### Watchlist actions

- **Add stock** searches by ticker or company name and adds the selected ticker to the active list.
- **Sort** orders companies by fundamental score, daily change, ROIC, or P/E.
- **Filter** filters the app's known, previously scored universe. It is not a market-wide screener.
- **Compare** opens comparison directly, seeded from saved/current selections.
- **New watchlist** creates an empty named list.
- **Remove stock** removes that ticker from the current list. Cached research and saved thesis data remain.
- **Delete watchlist** removes the list after confirmation. At least one list must remain. Deleting a list does not delete company research or theses.

On a new installation, the PWA seeds The Compounders, AI & Semiconductors, Defensive Aristocrats, and Promising Under $20. Android seeds the first three. The Compounders is the default.

## Review

Review reads stored observations. Merely opening it on Android does not fetch every company. **Check for changes** runs or refreshes the data path exposed by the client.

Companies are grouped by the following rules, in priority order:

1. **Recorded changes** — a delivered alert is newer than the latest recorded review.
2. **Review due** — the latest valid review is at least 90 days old.
3. **Add your reasons** — no meaningful thesis or reconsideration condition exists.
4. **First review** — reasons exist but no review has been recorded.
5. **Reviewed** — none of the conditions above applies.

Future-dated or malformed timestamps do not acknowledge changes. Ordinary journal notes do not count as reviews. The queue is an attention aid: a company shown as Reviewed has no newer *recorded* alert; that does not prove the company or thesis is unchanged.

From a review card, **Review** opens the reasons/reviews workflow and **Research** opens the company evidence. A review requires one of three user judgments:

- **Intact** — the user believes the reasons still hold.
- **Watch** — the user wants closer attention.
- **Changed** — the user believes the thesis changed.

An optional note records what was checked or learned. The app never chooses this assessment automatically.

## Research

Search for a ticker or tap a watchlist/review item to open the company. The research header shows ticker, company name, quote, daily change, reporting period, measurement coverage, composite score, and five pillar scores when available.

### Overview

Shows the main measured health indicators, company profile, catalysts, risks, and data provenance. Missing values display as unreported rather than as zero.

### My reasons & reviews

Stores:

- why the user follows the company;
- what must remain true;
- conditions that would cause reconsideration;
- optional conviction and target buy price;
- dated journal notes;
- dated reviews and their intact/watch/changed assessment.

Reconsideration conditions have manual flags. The app does not infer that a written condition has triggered. Thesis editing preserves journal entries added concurrently.

### 12-point checklist

Shows PASS, WATCH, FAIL, or NOT REPORTED for each check. Tapping a check explains its inputs and limits. Unreported or inapplicable checks are excluded from the score rather than counted as failures. See [Health scoring](02_HEALTH_SCORING_FRAMEWORK.md).

### 5Y trends

Shows the available filed history for revenue, free cash flow, cash/debt, margins, and share count. The label is a product shorthand; the app uses the available annual periods and leaves gaps where a period is absent. It does not invent or interpolate values. See [Financial charts](06_FINANCIAL_CHARTS_AND_TRENDS.md).

### DCF Sandbox

For ordinary companies, this runs a two-stage free-cash-flow model with sliders for five-year growth, terminal multiple, and discount rate, plus bear/base/bull presets. Banks use a tangible-book model with return on tangible equity, payout ratio, and cost of equity because deposit and loan flows make ordinary free cash flow unsuitable. It is an interactive scenario calculator. Inputs and outputs are estimates, not a target price or recommendation. A company with insufficient inputs may not produce a result. See [DCF](08_DCF_FAIR_VALUE_SANDBOX.md).

### AI analysis

AI analysis sends the scored company data to the configured Gemini relay. Personal thesis and journal data are excluded by default. The Settings switch **Include my notes in AI analysis** must be enabled before those notes are attached.

The response includes a verdict, executive summary, a Buffett-style principle, ratings, strengths, risks, assumptions, and data-freshness metadata. A staleness assessment compares a cached response with the current company data and prompt version.

PWA generation uses the self-hosted Gemini key and a shared SQLite cache per ticker. Android can read a shared notes-free Firebase cache without signing in. Generating a fresh Android analysis requires Google sign-in and one credit; a failed Gemini call refunds that credit. A Google account can claim one five-credit introductory grant. The Play product `omaha_credits_10` adds ten consumable credits after server-side purchase verification.

AI output can be wrong or stale. Verify claims against filings and the displayed source data.

## Filter

Filter operates only on companies this installation has already scored, including watchlist companies and earlier lookups. Supported criteria include minimum health score, minimum Piotroski score, minimum ROIC, sector, positive free cash flow, net cash, and maximum debt/equity. The PWA warms at most six missing watchlist cache entries during one filter request.

Absence from results means the company is outside the local universe, lacks a score, or does not meet the selected conditions. It does not mean the wider market contains no match.

## Compare

Compare accepts up to five tickers. The picker groups candidates from watchlists, provider-suggested peers, and previously scored companies. It displays a five-pillar radar chart when at least two companies have sufficient pillar data, plus a metric table covering score, solvency, profitability, cash conversion, margins, balance sheet, valuation, growth, and checklist results.

Missing metrics remain blank/unreported. A comparison should be interpreted in the context of business model, sector, currency, and fiscal period.

## Alerts and notifications

Default preferences enable earnings/filing changes, red flags, margin-of-safety changes, and the Sunday digest. Capital-return alerts start disabled.

The shared rules can record:

- a fundamental score move of at least three points or checklist-state changes;
- crossings into Altman Z distress, current ratio below 1, material gross-margin compression, or Piotroski at 4 or below;
- a high-score company crossing into a cheap historical P/E or PEG range;
- share-count reduction crossing the capital-return threshold, when enabled;
- a Sunday watchlist digest and material weekly movers.

Rules are edge triggered where applicable and use per-type cooldowns. Repeated standing conditions are suppressed. The latest sweep can be partial when a provider rate limit stops the remaining requests.

The PWA runs the worker in the server process and delivers standards-based Web Push through saved VAPID subscriptions. Android schedules local WorkManager sweeps approximately every six hours with network required and posts local notifications. Android requests `POST_NOTIFICATIONS` on supported versions; denying it prevents visible notifications but does not remove the rest of the app.

Recent delivered alerts appear in Settings. Opening an alert routes to the relevant company/review. Android retains a bounded history and uses it for cooldown enforcement.

## Settings

Settings contains:

- AI notes privacy opt-in;
- notification categories, permission request, and test notification;
- System, Dark, and Light appearance;
- backup export and restore;
- product explanation and data/privacy summary;
- recent alert history.

The header theme button is a fast light/dark switch. The Settings selection can also follow the system.

## Backup and restore

Export creates a versioned JSON file containing theses, reconsideration conditions, journal/review history, and watchlists. It excludes market caches, settings, notification history, snapshots, device authorization, push subscriptions, and AI results.

Restore merges in one operation:

- For a thesis, the newer `updatedAt` version wins, but journal entries from both copies are unioned and deduplicated.
- For a watchlist with the same ID, the newer complete list wins. Tickers are not unioned because doing so could resurrect a deliberately removed company.
- Equal timestamps keep the local record.
- At most one watchlist remains the default, preferring the local default.
- Files from a newer unsupported schema are rejected instead of partially imported.

Keep exported files private; they contain the user's written investment reasoning.

## Android home-screen widget

Adding the widget opens a configuration screen to bind that widget instance to a watchlist. Small widgets show the list and composite. Medium widgets add leading movers. Large widgets add more holdings, up to the layout limit. Tapping the widget opens its bound watchlist, even if another list was active in the app. The refresh action requests an immediate refresh.

When at least one widget exists, WorkManager refreshes widget state about hourly with network required. The widget renders its last stored state while a refresh is pending or fails.

## Offline and failure behavior

The PWA service worker precaches the shell, icons, styles, and JavaScript. It does not cache `/api/` responses. The web client keeps the last good stock response in IndexedDB and may show it with an age/stale banner when live retrieval fails.

Android keeps market records in Room and follows the shared 15-minute quote and 24-hour statement cache tiers. Cached data remains readable offline. Searches or uncached companies need a network connection.

An unknown ticker is an error, never a synthetic company. Rate limits and provider outages are distinct from “not found” and should be retried later. A failed company remains visible in a watchlist with an error instead of disappearing from the aggregate silently.
