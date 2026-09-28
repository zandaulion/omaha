# PWA and Android feature matrix

Both clients aim for the same financial meaning and comparable workflow. Platform services differ where a browser/server and an installed Android app have different capabilities.

| Capability | PWA | Android | Notes |
|---|---|---|---|
| Default view | Watchlist | Watchlist | Explicit links/notification intents can override |
| Primary navigation | Bottom bar: Review, Watchlist, Research, Compare | Bottom bar on phones; navigation rail on tablets | Filter is reached from actions, not a primary tab |
| Search | Server-backed cache + provider | Room cache + provider through QuickJS | Same provider seam/ranking intent |
| Watchlists | SQLite on self-hosted server | Room on device | Shared backup format, no live synchronization |
| Starter lists | 4 lists, including Promising Under $20 | 3 lists | The first three and default contents match |
| Add/remove stock | Yes | Yes | Removing from list keeps thesis/cache |
| Create/delete list | Yes | Yes | At least one list remains |
| Aggregate score | Company-size weighted when possible | Company-size weighted when possible | Equal fallback; never position weighted |
| Scoring/checklist | Shared `core/` directly | Same `core/` in QuickJS | Same missing-data and coverage rules |
| Research tabs | Six | Six | Overview, reasons/reviews, checklist, trends, DCF, AI |
| Explainable metrics | Shared glossary-driven popover | Generated glossary + native sheet | Outside tap/Back dismisses |
| Review queue | Server records | Device records | Same `core/review.js` ordering |
| Manual review assessment | Yes | Yes | Intact/watch/changed chosen by user |
| Filter | Local server scored universe | Local device scored universe | Neither is market-wide |
| Compare | Up to 5 | Up to 5 | Watchlists/peers/seen candidates |
| Market providers | Server calls SEC/Yahoo | Device calls SEC/Yahoo | EDGAR statements first; Yahoo fallback/quote/history/search/peers |
| Quote/statement TTL | 15 min / 24 h | 15 min / 24 h | Policy comes from shared engine |
| Offline shell | Service worker | Installed app binary | PWA APIs remain network only |
| Offline stock cache | IndexedDB last-good GET responses | Room scored records | Both show stale/age state rather than inventing freshness |
| Alerts | Server timer + Web Push | WorkManager + local notification | Shared triggers/cooldowns; delivery differs |
| Notification permission | Browser Push permission | Android runtime permission | PWA stores push subscription on server |
| Sunday digest weighting | Market-cap when cached | Equal-weight fallback in current Android implementation | Android snapshot path intentionally avoids opening all stock records; a point or two can differ |
| Alert history | SQLite | Room, newest 200 retained, 30 shown | Used for cooldown and Settings |
| Backup/restore | Browser file download/upload | System document picker | Same schema and merge engine |
| Invite activation | Required for hosted app | Not used | Android core features are local/accountless |
| Google sign-in | Not used | Only for AI grant/generation/purchase | Not requested at startup |
| PWA AI generation | Operator-funded Gemini call | N/A | Shared SQLite ticker cache, no user credits |
| Android AI cache read | N/A | Shared notes-free cache can be anonymous | Local Room cache is checked first |
| Android AI generation | N/A | One Firebase credit, Google sign-in | Five-credit one-time grant; ten-credit Play product |
| Personal notes in AI | Explicit setting, default off | Explicit setting, default off | PWA stores private-derived result in its household cache; Android private results use UID path |
| Home-screen widget | No dedicated widget | Responsive Glance health card | Bound to a selected watchlist; compact score and grade; larger sizes add score trends, freshness, and attention-ranked companies; hourly/manual refresh |
| Theme | System/dark/light | System/dark/light | Shared tokens, platform rendering |
| Back behavior | Browser/app history and modal handling | Overlay dismissal then in-app stack | Android returns to Watchlist at root |
| Crash trace UI | Server/browser logs | Previous fatal trace shown once | Android trace is selectable |
| Admin console/API | Yes | No | Manages PWA invites/devices and manual jobs |

## Expected parity

The following must remain semantically identical:

- normalized company facts and currencies;
- score/checklist/pillar calculations and measurement coverage;
- DCF arithmetic for the same inputs;
- alert trigger and cooldown policy;
- review-queue classification;
- backup versioning and conflict resolution;
- AI prompt/data schema, apart from host-specific auth/cache/credit wrapping;
- glossary meanings and design-token values.

Parity tests and generators exist because these rules are easier to drift than visual screens. A host can present data differently for its form factor but must not reach a different financial conclusion from the same input.

## Intentional differences

The PWA centralizes storage and background work on a self-hosted server, which enables Web Push and multiple invited browsers sharing one household database. Android keeps user data on one device and performs local background work, so it needs no Omaha invite account.

Android's Firebase identity exists solely around paid/limited AI generation. It does not turn Room data into cloud-synchronized application data. Backup files are the deliberate transport between clients.

The current Android digest uses equal weighting because its snapshot query omits market cap to keep the weekly job lightweight; the PWA uses cached market caps when complete. The watchlist-screen aggregate itself remains company-size weighted on both clients when possible.

## Verifying a parity-sensitive change

1. Add a source-level test in `core/`.
2. Rebuild `core/dist/`.
3. Run `npm run verify`.
4. Run the relevant Android connected parity/migration tests when storage or QuickJS is involved.
5. Exercise the same captured ticker and input in both clients.
6. Update this matrix if the difference is intentional.
