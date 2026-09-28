# Data model and backups

## Ownership categories

Pocket Omaha separates data by whether it can be reconstructed.

1. **Personal records** — watchlists, theses, conditions, journal entries, and reviews. These are backed up and must survive migration.
2. **Derived market records** — quotes, filings, normalized models, scores, and AI summaries. These are caches and can be fetched/recomputed.
3. **Device/runtime records** — authorization, push endpoints, settings, snapshots, alert history, UI selections, and widget state. These describe one host/device and are not portable backup data.
4. **Cloud commerce records** — Firebase credits and redeemed Play orders. These belong to the signed-in Google/Firebase identity, not a backup file.

## PWA SQLite

The server opens `${DATA_DIR}/omaha.db` with WAL, normal synchronous mode, and foreign keys.

| Table | Key | Purpose | Portable? |
|---|---|---|---|
| `stock_cache` | `ticker` | Denormalized scored company, source JSON sections, quote/statement timestamps, queryable score fields | No |
| `devices` | numeric `id`; unique `token` | Invite-created browser authorization, label, last seen, revoke/push flags | No |
| `invites` | numeric `id`; unique live `code` | Seven-day activation grants and redemption/revocation state | No |
| `theses` | `ticker` | Conviction, target price, rationale, must-remain-true text, tags, conditions, journal/reviews | Yes |
| `push_subscriptions` | numeric `id`; unique `endpoint` | Browser push endpoint and encryption public material, linked to device | No |
| `watchlists` | string `id` | Name, ticker JSON, default flag, update time | Yes |
| `app_settings` | `key` | AI notes flag and persisted VAPID keypair | No |
| `stock_snapshots` | `ticker` | Last alert comparison plus slow weekly baseline | No |
| `notification_settings` | fixed `id=1` | Five alert category flags | No |
| `notification_history` | numeric `id` | Delivered alert, route, read state, and timestamp | No |
| `ai_summaries` | `ticker` | PWA household Gemini result cache | No |

`stock_cache` lifts score, sector, currencies, price, health metrics, and timestamps into columns while retaining JSON for financials, checklist, catalysts, risks, pillars, summary, and statements. A migration can rebuild this table because it is derived; personal tables are never intentionally rebuilt destructively.

Deleting a device cascades to its push subscriptions. Invite `device_id` becomes null if the device is deleted. Used/revoked invite plaintext code and URL are nulled.

## Android Room

The database is `omaha.db`, schema version 5. Every migration is additive and registered in `OmahaDatabaseFactory`; destructive fallback is intentionally absent.

| Entity/table | Key | Purpose | Portable? |
|---|---|---|---|
| `theses` / `ThesisRow` | `ticker` | User-authored reasons and journal JSON | Yes |
| `watchlists` / `WatchlistRow` | `id` | Named ticker lists and default selection | Yes |
| `stock_cache` / `StockCacheRow` | `ticker` | Opaque shared-engine record JSON plus query projections | No |
| `app_settings` / `AppSettingRow` | `key` | AI flag, theme, comparison tickers, current ticker | No |
| `stock_snapshots` / `SnapshotRow` | `ticker` | Opaque alert snapshot plus health/baseline projection | No |
| `notification_settings` | fixed `id=1` | Five alert flags | No |
| `notification_history` | generated `id` | Delivered alerts and cooldown history | No |
| `ai_summaries` / `AiSummaryRow` | `ticker` | Local parsed response JSON and cache time | No |

Room stores the full scored record as opaque JSON. Kotlin lifts only fields needed for searches and queries (`name`, `sector`, `health_score`, timestamps, and financials JSON). This prevents a second Kotlin model from silently dropping a newly added core field.

Android notification history retains the newest 200 records and Settings displays the newest 30. The longest cooldown is shorter than that retention floor in normal use.

### Android migrations

- 1 → 2: add `app_settings`.
- 2 → 3: add snapshots, notification settings, notification history, and history index.
- 3 → 4: add AI summaries.
- 4 → 5: add non-null `mustRemainTrue` to theses with an empty default.

## Browser-local storage

The PWA keeps presentation/session conveniences in `localStorage`:

- `omaha_token` — bearer copy of the device token used alongside the HttpOnly cookie;
- `omaha_active_watchlist`;
- `omaha_current_ticker`;
- `omaha_active_subtab` and `omaha_active_view`;
- `omaha_theme`;
- `omaha_compare_tickers`;
- `omaha_onboarded`.

The `omaha-data` IndexedDB database contains a `responses` object store keyed by request URL with `{url, body, storedAt}`. Only successful GET response bodies are cached there; writes are never replayed from it. The service-worker Cache Storage contains static application assets, not `/api/` responses.

## Android auxiliary storage

- `last_crash.txt` in app-private storage holds a fatal trace until consumed on the next launch.
- Glance per-widget state holds a rendered watchlist presentation and configuration ID.
- WorkManager stores unique job metadata in its own app-private database.
- Firebase Auth SDK stores the current sign-in session using its platform-managed storage.

These records are not part of Pocket Omaha JSON export.

## Firestore

Clients have no direct Firestore permission. Callable functions use Admin SDK paths:

| Path | Content |
|---|---|
| `users/{uid}` | Credit balance and `freeGrantClaimedAt` |
| `users/{uid}/aiCache/{TICKER}` | AI output that included that user's notes |
| `aiCache/{TICKER}` | Shared notes-free AI output |
| `redeemedPurchases/{orderId}` | UID, product, credits, redemption time for idempotency |

Firestore data is not included in app backup. A user signing out does not erase their server credit ledger or private AI cache.

## Backup schema

Current `schemaVersion` is 2. Files without a version are interpreted as version 1. A version greater than the reader supports is rejected in full.

Top-level shape:

```json
{
  "schemaVersion": 2,
  "exportedAt": "2026-09-28T12:00:00.000Z",
  "theses": [],
  "watchlists": []
}
```

Normalized thesis shape:

```json
{
  "ticker": "AAPL",
  "conviction": "high",
  "targetBuyPrice": 180,
  "coreRationale": "...",
  "mustRemainTrue": "...",
  "moatTags": [],
  "sellTriggers": [
    {"id":"...", "text":"...", "triggered":false}
  ],
  "journalEntries": [
    {
      "id": "...",
      "date": "2026-09-28T12:00:00.000Z",
      "note": "...",
      "kind": "review",
      "assessment": "intact"
    }
  ],
  "updatedAt": "2026-09-28T12:00:00.000Z"
}
```

`kind` is `note` or `review`. Review `assessment` is `intact`, `watch`, or `changed`; invalid values normalize to null. Legacy entries without an ID receive a stable content-derived ID.

Normalized watchlist shape:

```json
{
  "id": "compounders",
  "name": "The Compounders",
  "tickers": ["AAPL", "MSFT"],
  "is_default": true,
  "updatedAt": "2026-09-28T12:00:00.000Z"
}
```

The reader also accepts `isDefault`, but the writer emits `is_default` for backward compatibility.

## Merge algorithm

Before merging, both incoming and local data are normalized, tickers are uppercased, malformed items are discarded, and the schema version is checked.

For each thesis:

1. A ticker absent locally is added.
2. If both exist, the one with the strictly newer parseable `updatedAt` supplies thesis fields.
3. Journal entries from both are unioned.
4. Identical IDs with identical content deduplicate.
5. Identical IDs with different content preserve both by suffixing the incoming ID.
6. Entries sort newest first with a stable tie break.

For each watchlist:

1. An ID absent locally is added.
2. If both exist, the strictly newer entire object wins, including tickers.
3. Equal/missing timestamps favor the local version.
4. Multiple resulting defaults collapse to one, preferring the local default.

The lists are not unioned. Union would re-add a ticker that was deliberately removed on the newer device.

PWA applies the merge inside an explicit SQLite transaction. Android writes through a Room transaction. A failure should leave the previous state intact. Re-importing the same file is idempotent.

## Deletion behavior

- Removing a stock edits only that watchlist's ticker array.
- Deleting a watchlist does not delete theses, stock cache, snapshots, alerts, or AI cache for its former tickers.
- At least one watchlist is retained by the UI/API flow.
- There is no current whole-thesis delete operation in the primary user workflow; fields and journal entries can be edited according to the client UI.
- Clearing browser site data removes local token/preferences/IndexedDB/static cache but not the server SQLite records.
- Clearing Android app data or uninstalling removes Room, crash, widget, WorkManager, and local auth state. Export first to retain personal data.
