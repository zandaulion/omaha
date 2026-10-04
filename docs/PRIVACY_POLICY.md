# Privacy Policy

**Pocket Omaha (Android app and web app)** · Effective 3 October 2026

Pocket Omaha helps long-term stock owners record why they follow a company and review whether those reasons still hold. This policy explains what data the app handles, where it goes, and the choices you have. In short: **your watchlists and investment notes stay on your device**, we do not sell data, and we do not show ads or use advertising IDs.

"We" means the developer of Pocket Omaha, zandaulion. Contact details are at the end.

## 1. What stays on your device

On Android, the following is stored only in the app's private storage on your phone:

- Watchlists and the tickers you follow
- Your theses, reasons, reconsideration conditions, journal entries, and review history
- Cached market data and scores, alert settings and alert history, and app settings

We do not collect position sizes or portfolio holdings because the app does not ask for them. Android alerts are generated on your device; no notification server is involved. Uninstalling the app or clearing its data deletes this information, except for any backup file you chose to export (see section 6).

## 2. Data that leaves your device

| Why | What is sent | To whom |
|---|---|---|
| Market data and filings | The ticker or search text you request, plus the normal technical data any request carries (IP address, user agent, timing) | SEC EDGAR and Yahoo Finance |
| AI summaries (optional) | The scored company data for the stock. **Your notes are included only if you turn on "Include my notes in AI analysis"**, which is off by default. If on, this can include conviction, target price, rationale, tags, conditions and journal content. | Our Firebase Cloud Functions and Google Gemini (paid API tier, so Google does not use this content to train its models) |
| Google sign-in (needed for AI credits) | Your Google account identifier, display name and email, through Google sign-in and Firebase Authentication. The app never opens the account picker on its own. | Google / Firebase |
| Credit purchases | A Google Play purchase token and order ID, which our server verifies with the Google Play Developer API and credits once per order. We never see your payment card details. | Google Play |

We store your Firebase user ID, email, and credit balance, and records of credit redemptions, so that credits can be granted and not double-spent. We also cache AI output: notes-free output is cached by ticker and can be read without sign-in; output generated with your notes is cached under your account only and is not publicly readable.

## 3. The web app (PWA)

The web app at omaha.zandaulion.com stores your watchlists, notes, settings and alert data in a database on the server that hosts it, because the web app has no on-device database. Access is by invite code; the server sets a cookie and stores a device token to recognise your registered device. If you enable web push, your browser's push subscription (endpoint and public keys) is stored so alerts can be delivered through your browser's push service. The same optional AI rules apply: your notes go to Gemini only if you opt in. The web app also keeps a last-good copy of stock data in your browser for offline display. Clearing site data removes it.

## 4. Permissions

The Android app requests only **Internet** and **network state** (to fetch data and decide when to sync) and **notifications** (to show alerts, where Android asks you first). It does not access your contacts, location, camera, microphone, photos or files, SMS, or advertising ID.

## 5. What we do not do

- No advertising, ad networks, or cross-app tracking
- No sale or rental of personal data
- No third-party analytics SDK in the app

We use your data only to provide the features above. Third parties listed in section 2 process data under their own terms, including [Google's Privacy Policy](https://policies.google.com/privacy), and we do not control their retention.

## 6. Backups and your choices

- **Export:** you can export your theses and watchlists to a JSON file at a location you choose. This file is **not encrypted**; store it carefully.
- **AI notes:** leave "Include my notes in AI analysis" off to keep your writing out of AI requests.
- **Sign-in:** you can use the research and review features without signing in; sign-in is only for AI credits.
- **Deletion:** see [Deleting your data](#deleting-your-data) below.

## Deleting your data

This section explains how to delete your Pocket Omaha data, either your whole account or only part of it.

**Data on your phone.** Uninstall Pocket Omaha, or go to Android Settings → Apps → Pocket Omaha → Storage → Clear storage. This removes your watchlists, notes, reviews, alerts, cached data and settings immediately. It does not remove a backup file you exported yourself. Delete that file separately.

**Data on our servers (Google sign-in and AI credits).**

1. Email **[zandaulion@gmail.com](mailto:zandaulion@gmail.com)** with the subject **"Pocket Omaha data deletion"**.
2. Send it from the Google account you signed in with, so we can verify the request is yours.
3. Say whether you want **everything** deleted, or only part of it (for example, only your saved AI analyses).

We confirm by email and complete the deletion within **30 days**.

**What is deleted:**

- Your sign-in record: Google account ID, name and email address
- Your credit balance and free-credit record
- AI analyses generated with your notes, which are stored under your account
- Data from the web app, if you used it

**What is kept:**

- **Purchase order records.** For each credit purchase we keep the Google Play order ID, product, credit amount and date, **with your user ID removed**. We keep these indefinitely so the same order can never be credited twice. On their own they do not identify you.
- **AI analyses generated without notes.** These are shared by ticker, contain nothing about you, and are not deleted.
- **Records held by Google.** Google keeps its own records of your Google account and Play purchases under [Google's Privacy Policy](https://policies.google.com/privacy).

Unused credits are lost when your account is deleted.

## 7. Retention

On-device data remains until you delete it. Account data is kept while your account is active and deleted on request as described in [Deleting your data](#deleting-your-data). Purchase order records without your user ID are kept indefinitely to prevent duplicate crediting. Server-side web-app data remains until you or the operator delete it. Invite codes are cleared after use.

## 8. Security

Data in transit uses HTTPS. Our Firebase database rules deny all direct client access; data is reached only through server functions, and credit changes are made transactionally on the server. On-device data relies on your phone's own protections (screen lock, device encryption). The app has no separate app lock.

## 9. Children

Pocket Omaha is not directed to children under 13 (or the minimum age in your country), and we do not knowingly collect their data.

## 10. Not investment advice

Scores and AI-generated text are produced from public filings and may be stale, incomplete or wrong. They are not financial advice.

## 11. Changes

If we change this policy we will update the date above and, for material changes, tell you in the app.

## 12. Contact

Questions or deletion requests: [zandaulion@gmail.com](mailto:zandaulion@gmail.com)
