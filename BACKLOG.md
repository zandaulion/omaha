# Backlog

Deferred work, with enough context to pick up cold. Known limitations that are
*not* planned work live in `docs/12_FINAL_SYSTEM_AUDIT_AND_CHECKLIST.md` §3.

---

## Flag AI summaries as stale when the fundamentals move

**Deferred 2026-08-20.** The groundwork is already in place, so this is small.

Cached analyses in `ai_summaries` already store the two fields needed to detect
staleness — added when the Gemini payload was rebuilt:

- `fiscalPeriodEnd` — the filing period the analysis was written against
- `priceAtGeneration` — the share price at the time

Today the interface shows only the generation timestamp and waits for the user
to press **Re-Analyze**. So an analysis written against FY2025 keeps presenting
itself with full confidence after FY2026 lands, and its valuation paragraphs
can be discussing a price that has moved materially.

**What to build**

1. On the deep-dive load, compare the cached summary's `fiscalPeriodEnd`
   against `stock.summary.metrics.fiscalPeriodEnd`. A mismatch means new
   statements have been filed since the analysis was written — that is the
   strong signal, and it should be stated plainly rather than merely styled.
2. Separately, compare `priceAtGeneration` with the live price. A drift beyond
   roughly 15% invalidates the valuation and buy-zone sections specifically,
   not the moat or solvency ones. Worth wording it that way rather than
   condemning the whole analysis.
3. Surface it on the AI card, next to the existing timestamp, with a one-tap
   refresh. Reuse the freshness-banner vocabulary already in `app.css` rather
   than inventing a third staleness idiom.

**Do not** auto-regenerate on staleness. Every call costs money and latency,
the alert sweep already touches every watchlist holding four times a day, and
silently rewriting an analysis the user may have read and acted on is worse
than telling them it is out of date.

---

## Sunday digest by email

**Dropped during the notification build, 2026-08-19.** Doc 05 specifies a rich
HTML "Sunday Morning Brief" alongside the web push. The push digest is built
and scheduled (`server/alerts.js`, `sendWeeklyDigest`); only the email path is
missing, because no transactional email provider is configured on this host.

Needs a provider decision first (Resend and Postmark are the two doc 05 names).
The digest content function is already separated from its delivery, so the
email path is a renderer plus a send call, not new logic.
