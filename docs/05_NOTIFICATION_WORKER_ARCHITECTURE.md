# Notification Engine & Backend Worker Architecture

This document details the backend pipeline, trigger rules, payload structures, and worker architecture for **Pocket Omaha**'s high-signal notification system.

---

## 1. High-Level Architecture Overview

```
 ┌─────────────────────────────────────────────────────────────┐
 │                DATA INGESTION SOURCES                       │
 │  • SEC EDGAR / Financial Modeling Prep (FMP) / Polygon.io   │
 │  • Real-Time Earnings Calendar & 10-Q / 10-K Filings Hook   │
 │  • Daily Market Close Fundamental Ratios Recalculation      │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │             RULE EVALUATION & DELTA ENGINE                  │
 │  1. Health Score Delta Engine (Score shift ≥ 3 pts)         │
 │  2. 12-Point Checklist Status Diff (Pass ➔ Watch / Fail)    │
 │  3. Margin of Safety Multiples Scanner (P/E, PEG, FCF Yield)│
 │  4. Capital Allocation Detector (Buybacks, Dividend Hikes)  │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │            DISPATCH WORKER & USER PREFERENCES               │
 │  Filter alerts by user watchlist & notification preferences │
 └──────────────┬───────────────────────────────┬──────────────┘
                │                               │
                ▼                               ▼
 ┌──────────────────────────────┐ ┌────────────────────────────┐
 │  Web Push Service (VAPID)    │ │  Weekly Email Worker       │
 │  • Apple Push Notification   │ │  • Transactional Email     │
 │    (APNs for iOS Safari PWA) │ │    (Resend / Postmark)     │
 │  • Google FCM (Android PWA)  │ │  • "Sunday Morning Brief"  │
 └──────────────────────────────┘ └────────────────────────────┘
```

---

## 1a. The Android path — added 2026-08-27

The diagram above is the PWA's. Android runs the same triggers with none of the
infrastructure: no ingestion service, no dispatch worker, no push service.

```
 WorkManager, every 6h, network-constrained
        │
        ▼
 core/host/alerts.js in QuickJS, one ticker per call
   ├── core/host/stock.js ──── the same fetch/score pipeline the watchlist uses
   ├── core/alerts/triggers.js  the same four rules
   └── core/alerts/sweep.js     the same snapshots, cooldowns and stop conditions
        │
        ▼
 Room ── stock_snapshots · notification_settings · notification_history
        │
        ▼
 NotificationManager, five channels, one per notify_* setting
```

**What is shared and what is not.** The rules, the snapshot projection, the
cooldown table, the sweep's stop conditions and the digest's composition are all
in `core/` and run byte-identically on both clients. What differs is storage,
scheduling and delivery — which is the correct line: a phone and a Node server
genuinely differ there, and nowhere else.

**Three departures from this document, all deliberate:**

1. **No `WEEKLY_DIGEST` email path on Android**, and none planned. A local
   notification is the platform equivalent; see the backlog entry, which now
   concerns the *server's* email only.
2. **No VAPID, no APNs, no FCM.** Nothing is transmitted to deliver an alert.
   This is the same privacy position as the rest of the Android client and is
   why phase 5 required no server.
3. **The digest's comparison point is not the previous snapshot.** §2's Trigger 4
   implies comparing against the last stored reading. That is wrong on both
   clients and was wrong in production: the sweep writes the cache row and the
   snapshot from the same fetch, so the difference is zero by construction. See
   `rollBaseline` in `core/alerts/sweep.js` and `docs/16_ROADMAP.md` phase 5.

---

## 2. Notification Trigger Specifications

### Trigger 1: Post-Earnings 10-Q/10-K Health Score Shift
* **Frequency**: Triggered upon ingestion of quarterly SEC filing.
* **Condition**:
  $$\Delta \text{Health Score} = |\text{Score}_{\text{new}} - \text{Score}_{\text{prev}}| \ge 3$$
  OR any checklist item changes state ($Pass \leftrightarrow Watch \leftrightarrow Fail$).
* **Payload**:
  ```json
  {
    "type": "EARNINGS_HEALTH_SHIFT",
    "ticker": "NVDA",
    "title": "NVDA Q2 Health Upgrade (94/100)",
    "body": "Health score increased +3 pts. FCF surged to $13.5B (108% conversion). Gross Margin expanded to 75.8%.",
    "data": {
      "url": "/?tab=deepdive&ticker=NVDA",
      "prevScore": 91,
      "newScore": 94,
      "severity": "positive"
    }
  }
  ```

---

### Trigger 2: Red Flag / Distress Threshold Breached
* **Frequency**: Ingestion or daily balance sheet recalculation.
* **Condition**:
  * Altman Z-Score falls below $1.8$ (Distress zone).
  * Current Ratio drops below $1.0$.
  * Gross margin contracts by $> 300\text{ bps}$ YoY.
  * Piotroski F-Score drops to $\le 4$.
* **Payload**:
  ```json
  {
    "type": "RED_FLAG_WARNING",
    "ticker": "TSLA",
    "title": "⚠️ Caution Flag: TSLA Gross Margin",
    "body": "Auto Gross Margin compressed -680 bps to 17.8%. Piotroski score downgraded to 5/9.",
    "data": {
      "url": "/?tab=deepdive&ticker=TSLA&subtab=checklist",
      "severity": "critical"
    }
  }
  ```

---

### Trigger 3: Margin of Safety Entry Alert
* **Frequency**: Evaluated at daily market close.
* **Condition**:
  * Stock has Overall Health Score $\ge 85$ (Pristine/Good).
  * Forward P/E reaches $\le 5$-year 20th percentile OR PEG Ratio $\le 1.30$.
* **Payload**:
  ```json
  {
    "type": "MARGIN_OF_SAFETY",
    "ticker": "MSFT",
    "title": "🎯 MSFT Margin of Safety Entry",
    "body": "Health is Pristine (92/100) and Forward P/E reached 31.2x near its historical median value.",
    "data": {
      "url": "/?tab=deepdive&ticker=MSFT",
      "severity": "info"
    }
  }
  ```

---

### Trigger 4: Sunday Morning Portfolio Health Brief (Digest)
* **Frequency**: Cron `0 9 * * 0` (Every Sunday at 9:00 AM local time).
* **Delivery**: Web Push notification + Optional Rich HTML Email.
* **Content Structure**:
  1. Watchlist Health Grade & Composite Score (e.g. `89/100 · Excellent`).
  2. Weekly Health Movers summary (any score upgrades/downgrades).
  3. Upcoming Earnings & Filing calendar for the week ahead.

---

## 3. Web Push Protocol (PWA Implementation)

To support **iOS Safari (iOS 16.4+)** and **Android Chrome**, the PWA uses standard VAPID Web Push:

### 1. Client-Side Service Worker (`sw.js`) Push Handler:
```javascript
self.addEventListener('push', (event) => {
  const data = event.data ? event.data.json() : {};
  const options = {
    body: data.body || 'New stock health update available.',
    icon: '/icon-192.png',
    badge: '/badge-72.png',
    vibrate: [100, 50, 100],
    data: data.data || {},
    actions: [
      { action: 'open_scorecard', title: 'View Scorecard' },
      { action: 'dismiss', title: 'Dismiss' }
    ]
  };
  event.waitUntil(self.registration.showNotification(data.title || 'Pocket Buffett', options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const targetUrl = event.notification.data.url || '/';
  event.waitUntil(clients.openWindow(targetUrl));
});
```

### 2. Database Schema for Push Tokens & Subscriptions

```sql
CREATE TABLE user_push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    device_type VARCHAR(20) DEFAULT 'mobile_pwa',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    last_active TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE user_notification_settings (
    user_id UUID PRIMARY KEY,
    notify_earnings_filings BOOLEAN DEFAULT TRUE,
    notify_red_flags BOOLEAN DEFAULT TRUE,
    notify_margin_of_safety BOOLEAN DEFAULT TRUE,
    notify_capital_returns BOOLEAN DEFAULT FALSE,
    notify_sunday_digest BOOLEAN DEFAULT TRUE,
    email_digest_enabled BOOLEAN DEFAULT TRUE,
    digest_day_of_week INT DEFAULT 0, -- Sunday
    digest_hour_utc INT DEFAULT 13    -- 9:00 AM EST
);

CREATE TABLE notification_history (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    ticker VARCHAR(10) NOT NULL,
    alert_type VARCHAR(50) NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    read BOOLEAN DEFAULT FALSE,
    delivered_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## 4. Sunday Email Digest Responsive HTML Design

The weekly email is rendered using clean semantic tables with dark-mode support:
* **Header**: Pocket Buffett branding + Watchlist composite grade.
* **Section 1**: Health Scorecard Bar Summary.
* **Section 2**: Highlight of the week (Top Moat & Any Caution Items).
* **Section 3**: Upcoming filings calendar for the week ahead with countdown badges.
* **Action Button**: Direct single-tap link opening the PWA.
