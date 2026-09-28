# 18 — Ongoing company reviews

Product direction accepted 2026-09-27, for the PWA and Android.

**Understand what changed in the companies you follow. Revisit your reasons.**

The intended user already follows individual companies and understands basic
financial statements. The recurring job is to revisit an investment rationale
when recorded financial checks change, and periodically even when no alert was
recorded. Market demand and willingness to pay still need user validation.

## Workflow

1. **Watchlist** is the starting screen. **Review** shows recorded changes,
   overdue reviews, companies needing reasons, and first reviews for the selected list.
2. Open a company, read the recorded changes, and revisit three optional prompts:
   why I follow it; what must remain true; what would make me reconsider.
3. Use **Research** for the underlying scorecard, checklist, financials, ratios,
   and valuation assumptions. AI analysis is secondary and optional.
4. Record **Reasons still hold**, **Needs watching**, or **Reasons changed**, with
   an optional note. Each save appends a dated review to the journal.
5. Keep ordinary journal notes independently. Writing a note does not count as
   reviewing the company or acknowledge its recorded changes.

Watchlist manages the followed companies. Filter and Compare remain secondary
tools. Adding reasons is encouraged after adding a company, but never required
before research can be used.

## Shared queue rules

`core/review.js` is the shared policy for Node and Android's JavaScript engine.
It consumes local watchlist membership, theses, and stored alert history.

| State | Meaning |
| --- | --- |
| Recorded changes | At least one dated alert is newer than the latest valid review. |
| Review due | At least 90 days since the latest valid review, with no newer alert. |
| Add your reasons | No rationale, must-remain-true text, or written reconsideration condition. |
| First review | Reasons exist, with no valid dated review yet. |
| Reviewed | A recent review exists and no newer alert was recorded. |

This is also the display priority. Only a `kind: review` journal entry with a
valid timestamp and supported assessment acknowledges recorded changes. Read
status of notifications is irrelevant. Future or malformed timestamps cannot
acknowledge history. Manual condition flags remain visible after a review.

An empty queue never means the business is safe or unchanged. Alert delivery
preferences, data coverage, successful sweeps, and retained history constrain
what can appear here. A recorded-check timestamp is a freshness cue, not proof
that all companies or every filing were checked successfully.

## Evidence and language

The **Fundamental score** combines measured solvency, profitability, valuation,
growth, and capital-allocation checks. The numerical methodology is unchanged.
Pillar scores are separately displayed on a 20-point scale; the overall score
uses earned points divided by possible measured points. Low coverage suppresses
the overall score. Neither the total nor the profitability pillar proves an
economic moat. A low total alone does not establish financial distress.

Watchlist aggregate scores are weighted by company market capitalisation when
available. They do not measure personal exposure, performance, or portfolio risk.
User-written reconsideration conditions are **manual flags**; automated alerts
evaluate the shared financial rules, not those sentences.

## Persistence and compatibility

Existing theses and ordinary notes survive. `mustRemainTrue` is an additive
thesis field. Journal entries retain `kind` and `assessment`, with older entries
treated as ordinary notes. Review saves append; a stale thesis form must not
erase reviews saved since it opened. JSON backups preserve the new fields and
accept older backup versions. This is data portability, not automatic sync
between PWA and Android.

PWA routes retain legacy research links. New company alerts open its review;
the weekly digest opens the Review queue. Android notifications follow the same
intent. No AI generation is required to save reasons or complete a review.
