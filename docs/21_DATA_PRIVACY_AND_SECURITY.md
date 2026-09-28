# Data, privacy, and security

## Scope

Pocket Omaha is self-hosted/open-source software. Privacy depends on both this code and the operator's deployment. This document describes repository behavior; a public deployment should also publish its host, proxy, logging, backup, and retention practices.

## Data inventory

| Data | PWA location | Android location | Backup | Leaves device/server? |
|---|---|---|---|---|
| Watchlists | Server SQLite | On-device Room | Yes | PWA requests send them to its server; Android market requests reveal requested tickers to providers |
| Thesis, reasons, conditions, journal, reviews | Server SQLite | On-device Room | Yes | Sent to Gemini only after explicit notes opt-in and generation |
| Quotes, filings, price history, scores | Server SQLite cache | On-device Room cache | No | Retrieved from SEC/Yahoo; company payload sent to Gemini on AI generation |
| Alert snapshots/settings/history | Server SQLite | On-device Room | No | PWA Web Push payload goes through push services; Android delivery stays local |
| PWA device authorization | Server SQLite, HttpOnly cookie, and browser local storage bearer copy | Not used | No | Credential goes only to the PWA origin on protected calls |
| PWA Web Push subscription | Server SQLite | Not used | No | Endpoint/keys used with the browser push service |
| Appearance/current selection | Server setting plus browser local storage | Room app settings | No | Normally local to the host/device |
| AI result cache | Server SQLite | Room plus Firestore relay cache | No | Gemini/Firebase process the AI request |
| Google identity and credit balance | Not used for PWA | Firebase Auth/Firestore | No | Google/Firebase receives auth and callable metadata |
| Play purchase token/order | Not used for PWA | Cloud Function/Play/Firestore redemption record | No | Verified with Google Play Developer API |

## What leaves Android

Normal research sends ticker-related requests through OkHttp to SEC EDGAR and Yahoo. Requests can expose IP address, user agent, requested symbol, timing, and the normal transport metadata those services observe. The app does not send watchlist quantities because it does not store position sizes.

AI generation sends the complete scored stock payload to Firebase Functions and Gemini. If **Include my notes in AI analysis** is off, no thesis is attached. If it is on, the payload can include conviction, target price, rationale, moat tags, reconsideration conditions, and journal content. The setting defaults off.

Google sign-in sends the chosen Google identity through Credential Manager, Google Identity, and Firebase Auth. The app receives UID, display name, and email through Firebase. It does not silently open the account picker at startup or on AI-tab entry.

Credit purchases use Google Play Billing. The purchase token is sent to the Cloud Function, which verifies package, product, order, and purchase state with the Play Developer API. The function credits an order once, keyed by order ID, then consumes or acknowledges it. The client cannot write its own balance.

Android alerts are evaluated and posted on the device. No FCM, VAPID, or Pocket Omaha notification server is involved in Android delivery.

## What leaves the PWA browser and server

The browser sends protected application requests, watchlist changes, settings, theses, reviews, and backup imports to the self-hosted Express server. The browser cookie identifies the registered device.

The server requests company data from SEC EDGAR and Yahoo. When AI generation is requested, the server sends scored company data and, only with notes opt-in, the saved thesis to Gemini.

When PWA push is enabled, the browser creates a push subscription. The server stores its endpoint and public encryption material and sends alert payloads through the subscription's browser push service. Push payloads contain a title/body, ticker/type/severity, and an app route. Invalid 404/410 subscriptions are removed.

## Android permissions

The manifest requests only:

- `INTERNET` — market data, Firebase, Gemini relay, and Play Billing.
- `ACCESS_NETWORK_STATE` — network-aware jobs and connectivity decisions.
- `POST_NOTIFICATIONS` — visible alerts on Android versions that require runtime permission.

The app does not request contacts, location, camera, microphone, files/media, call logs, SMS, or advertising ID. Backup import/export uses the system document picker and its scoped URI grant rather than broad storage permission.

## PWA authentication

Protected endpoints accept either a valid registered-device token or the admin secret. Activation sets the HttpOnly `pocket_omaha_token` cookie and the web client retains the returned token as `omaha_token` in local storage for bearer requests and degraded session startup. This means script execution in the PWA origin can access the bearer copy; deploy a strict Content Security Policy at the reverse proxy and treat any same-origin script compromise as credential compromise. A revoked or missing device returns 401.

Invite codes contain 12 CSPRNG characters in three groups. Ambiguous characters are excluded. Input is case/separator tolerant. Codes expire after seven days, bind to one device, and are erased from the invite row after use. Redemption is limited by sliding one-minute per-IP and global counters.

Admin endpoints require `X-Admin-Token` to equal `ADMIN_TOKEN` using a constant-time comparison. If `ADMIN_TOKEN` is absent, admin access fails closed. Deployments should terminate TLS at a trusted reverse proxy, strip incoming admin headers on the public listener, and expose admin routes only through a private listener that injects the secret.

## Firebase and AI isolation

Firestore rules deny every direct client read and write. Admin SDK code in callable functions is the only data path.

Notes-free AI output uses `aiCache/{TICKER}` and can be read without authentication. Notes-included output uses `users/{uid}/aiCache/{TICKER}` and is never reachable through the public cache callable. Android's local AI cache is keyed only by ticker, so on a shared device it shows whichever account last fetched/generated that ticker. It is a device cache, not an account archive, and is excluded from backup.

Credit spending is transactional. Concurrent generation requests cannot both spend the same final credit. A Gemini failure increments the credit back. The introductory grant is transactionally limited to one claim per Firebase UID; a different Google account is a different grant identity.

Purchase credits are idempotent by verified Play order ID. Package name and product ID are checked. The Play runtime service account uses Application Default Credentials rather than a downloaded key file.

## Storage and retention

The PWA stores its database under `DATA_DIR` (default `data/omaha.db`) in WAL mode. Container deployment mounts `/data` as a persistent volume. Server/device logs and infrastructure backups are outside the app's retention controls.

Android stores Room data in the app sandbox. Uninstalling or clearing app data removes it unless Android/OS backup behavior or an exported Omaha JSON file preserves it. The repository's explicit portable backup contains only theses and watchlists.

Alert history is bounded on Android and used for UI plus cooldowns. Market caches, snapshots, settings, and AI caches can be deleted/rebuilt without losing user-authored records. The PWA currently retains database rows until changed/deleted by the application or operator; used invite plaintext is cleared.

## Backup sensitivity

The JSON export is unencrypted plaintext. It contains the user's watchlists and written reasoning. The app lets the user choose its destination but does not encrypt it. Store and transmit it accordingly. Restore validates the schema and merges records; it does not upload the file to a synchronization service.

## Network and browser caching

The service worker never caches `/api/` traffic. Static code and icons are cached. The web client can keep a last-good stock response in IndexedDB for degraded/offline display, so clearing only the HTTP cache may leave that record until site data is cleared.

Android Room caches scored stock JSON. It can reveal which companies were researched to someone with access to an unlocked/rooted device or its backups. The app does not add an application-level encryption layer.

## Security boundaries and limitations

- Yahoo endpoints are unofficial and can change or rate limit the app.
- SEC/Yahoo/Gemini/Firebase/Google Play follow their own privacy and retention terms.
- Self-hosted operators control TLS, reverse-proxy logs, server access, volume backups, and admin-secret handling.
- The app provides no multi-user separation inside one PWA SQLite database; it is designed as one household/self-hosted installation.
- Android has no app lock. Device OS protections guard local data.
- AI output is generated text and must not be treated as verified financial advice.
- Scores use available filings and can be stale, incomplete, or inappropriate for unusual business structures even with explicit financial-sector handling.

## Reporting a vulnerability

Do not publish live invite codes, device tokens, `ADMIN_TOKEN`, VAPID private keys, Gemini keys, signing passwords, `google-services.json` replacements, purchase tokens, or personal backup files in an issue. Provide a minimal reproduction with secrets removed and identify whether the finding affects the PWA, Android, the Firebase relay, or deployment configuration.
