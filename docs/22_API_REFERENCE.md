# HTTP and callable API reference

## Conventions

The Express API uses JSON. Request bodies are limited to 256 KiB. Unmatched `/api/*` routes return JSON 404 rather than the PWA HTML shell.

Authentication classes:

- **Public** — no credential required.
- **Device** — `Authorization: Bearer <token>` or the `pocket_omaha_token` cookie. A valid `X-Admin-Token` also satisfies device access.
- **Admin** — `X-Admin-Token` must match `ADMIN_TOKEN`.
- **Firebase auth** — callable must carry a Firebase ID token; the SDK attaches it automatically after Google sign-in.

Common HTTP failures include 400 invalid input, 401 missing/revoked device, 403 invalid/missing admin secret, 404 missing resource/symbol, 409 state conflict, 429 activation throttle, 500 internal failure, 502 rejected Web Push delivery, and 503 upstream network/rate limit. A market-data 503 can include `kind` and `Retry-After`.

## Public HTTP endpoints

### `GET /api/health`

Returns `{status, app, time}`. It checks that the Express process is serving requests; it does not actively probe SEC, Yahoo, Gemini, push services, or Firebase.

### `POST /api/auth/redeem`

Body:

```json
{
  "code": "ABCD-EFGH-JKLM",
  "device_label": "Daniel's phone",
  "push_subscription": null
}
```

Accepts code input without separators and in any case. On success creates a device, consumes the invite, optionally saves the subscription, returns `{success, device_id, token}`, and sets the token cookie for one year with `HttpOnly`, `SameSite=Lax`, and `Secure` when the request is HTTPS. Activation attempts default to 5/minute per IP and 60/minute globally.

### `GET /api/auth/session`

Returns `{authenticated, revoked, device}`. A valid session updates `last_seen`. A revoked token is reported as authenticated-but-revoked so the client can explain why access stopped.

### `GET /api/push/vapid-key`

Returns `{publicKey}` for browser PushManager subscription creation.

## Device HTTP endpoints

### Stock data and discovery

| Method and path | Input | Result |
|---|---|---|
| `GET /api/stock/:ticker` | `refresh=1|true` bypasses normal read cache | Full normalized/scored company record |
| `GET /api/search?q=...` | Nonempty ticker/company query | Ranked ticker matches; empty query returns `[]` |
| `GET /api/filter` | Query parameters below | Local scored-universe results, maximum 100 |
| `GET /api/compare?tickers=AAPL,MSFT` | Comma list, maximum 5; defaults to AAPL/MSFT/NVDA | `{count, stocks}`; individual failed tickers are omitted |
| `GET /api/stock/:ticker/peers` | Path ticker | `{ticker, peers}`; provider failure degrades to empty peers |
| `GET /api/compare/candidates?ticker=AAPL` | Optional current ticker | Candidate tiers `{watchlists, peers, seen}` |

Filter query parameters:

| Parameter | Meaning | Default |
|---|---|---|
| `minHealth` | Minimum composite score | 0 |
| `minPiotroski` | Minimum Piotroski F-Score | 0 |
| `minRoic` | Minimum ROIC percentage value | 0 |
| `sector` | Exact sector, or `all` | all |
| `netCash` | `1` or `true` requires positive net cash | false |
| `fcfPositive` | `1` or `true` requires positive FCF | false |
| `maxDebtToEquity` | Maximum ratio; positive-net-cash companies also pass | unset |

The filter response is `{count, universe, stocks}`. `universe` counts all locally scored rows, not the global market. Before querying, the endpoint tries to fill at most six missing watchlist cache rows.

### AI on the PWA

| Method and path | Input | Result |
|---|---|---|
| `GET /api/stock/:ticker/ai-summary` | Ticker | `{summary}` from SQLite, possibly null, with staleness when evaluable |
| `POST /api/stock/:ticker/ai-summary` | `refresh=1|true` or `{forceRefresh:true}` forces regeneration | `{success, summary, fromCache}` |

Without force refresh, POST returns the existing cache when present. Generation loads live/cached stock data and conditionally attaches the saved thesis according to `ai_include_notes`. Errors from Gemini return 500 with a message. This path has no end-user credit ledger.

### Watchlists

| Method and path | Body/result |
|---|---|
| `GET /api/watchlists` | Returns default-first `{watchlists:[{id,name,tickers,is_default,updated_at}]}` |
| `POST /api/watchlists` | Body `{name, tickers?}`; creates a generated ID |
| `PUT /api/watchlists/:id` | Partial `{name, tickers, is_default}`; making default clears the former default |
| `DELETE /api/watchlists/:id` | Deletes a list; 409 if it is the only list; returns fallback active ID |
| `POST /api/watchlists/:id/stocks` | Body `{ticker}`; adds if absent and attempts a cache prefetch |
| `DELETE /api/watchlists/:id/stocks/:ticker` | Removes ticker from only that list |
| `GET /api/watchlists/:id/health` | Returns composite, grade, pillars, weighting, counts, checklist aggregates, and stocks |

Empty-list health uses score 0 and grade `EMPTY`. A list with no successfully loaded stocks uses grade `N/A`. Otherwise unscored stocks are excluded; market-cap weighting is used only when every scored stock has a usable market cap.

### Reasons, reviews, and backup

| Method and path | Body/result |
|---|---|
| `GET /api/theses/:ticker` | Normalized thesis, creating no row merely by reading |
| `POST /api/theses/:ticker` | Partial thesis fields; arrays required for `moatTags`, `sellTriggers`, `journalEntries` |
| `POST /api/theses/:ticker/reviews` | `{assessment:"intact"|"watch"|"changed", note:"..."}`; appends review |
| `GET /api/reviews?watchlistId=...` | `{items,lastCheckedAt}` for requested/default list |
| `GET /api/theses` | Downloads the complete versioned personal-data backup |
| `POST /api/backup/import` | Backup JSON; returns merge report or leaves all data unchanged on write failure |

### Settings and notifications

| Method and path | Body/result |
|---|---|
| `GET /api/settings` | `{settings:{ai_include_notes:0|1}}` |
| `POST /api/settings` | Partial setting patch; unknown keys ignored |
| `GET /api/notifications?limit=50` | Current preferences and newest delivered history |
| `POST /api/notifications/settings` | Partial `notify_*` boolean/0/1 fields |
| `POST /api/notifications/read` | Marks all history read |
| `POST /api/push/subscribe` | `{subscription, device_id?}`; the authenticated device ID wins when present |
| `POST /api/push/test` | Sends only to the calling device; an admin caller with no device broadcasts |

Notification preference keys are `notify_earnings_filings`, `notify_red_flags`, `notify_margin_of_safety`, `notify_capital_returns`, and `notify_sunday_digest`.

## Admin HTTP endpoints

| Method and path | Input/result |
|---|---|
| `GET /api/admin/devices` | Device IDs, labels, creation/last-seen, revoked, push status; never returns tokens |
| `POST /api/admin/devices/:id/revoke` | `{revoked:true|false}` |
| `POST /api/admin/devices/:id/label` | `{label}` |
| `DELETE /api/admin/devices/:id` | Deletes device; linked push subscriptions cascade |
| `GET /api/admin/invites` | Invite status; plaintext code/URL absent after use |
| `POST /api/admin/invites` | `{label}`; returns code, URL, and seven-day TTL |
| `POST /api/admin/invites/:id/revoke` | Revokes only an unused invite and clears plaintext |
| `POST /api/admin/alerts/sweep` | Runs the alert sweep immediately and returns its report |
| `POST /api/admin/alerts/digest` | Attempts the weekly digest immediately |

`ADMIN_TOKEN` is mandatory for this surface. A deployment can have a private reverse proxy inject `X-Admin-Token`; public proxy paths should strip/reject it.

## Firebase callable API

Android uses the Firebase Functions SDK; these are callable protocols, not ordinary REST endpoints.

### `getAiSummary`

- Auth: none.
- Input: `{ticker}`.
- Output: `{summary: object|null}`.
- Reads only `aiCache/{TICKER}`, which is notes free. It cannot read private notes-included paths.

### `generateAiSummary`

- Auth: Firebase user required.
- Input: `{ticker, stock, thesis|null}`.
- Output: `{summary, credits}` where credits is the post-spend balance.
- Atomically spends one credit, calls Gemini, refunds on Gemini failure, then stores shared or user-private cache according to the response's `includedNotes` flag.

### `claimFreeGrant`

- Auth: Firebase user required.
- Input: empty object.
- Output: `{credits, granted, productLabel}`.
- Grants five credits once per Firebase UID using a transaction. Repeated calls return `granted:false` without adding credits.

### `getBalance`

- Auth: Firebase user required.
- Input: empty object.
- Output: `{credits}`.

### `redeemPurchase`

- Auth: Firebase user required.
- Input: `{productId, purchaseToken}`.
- Output: `{credits, productLabel}`.
- Accepts the known `omaha_credits_10` product, verifies it for package `com.zandaulion.omaha`, credits the verified order once, then settles it through Play.

Callable failures use Firebase codes such as `invalid-argument`, `unauthenticated`, `resource-exhausted`, `failed-precondition`, and `internal`.

## Non-API routes

- `GET /bust` serves a no-store recovery page and requests site-cache clearing.
- Existing static files under `web/` are served directly.
- Other non-API GET paths serve `index.html` for the single-page client.
