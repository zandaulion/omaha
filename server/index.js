import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initDatabase, db } from './db.js';
import { getStockData, searchStocks } from './finance.js';
import { getPeers as fetchPeers } from '../core/providers/index.js';
import {
  requireAdmin,
  requireDeviceAuth,
  getAdminDevices,
  updateDeviceRevoke,
  updateDeviceLabel,
  deleteDevice,
  getAdminInvites,
  createAdminInvite,
  revokeAdminInvite,
  redeemInvite,
  checkSession
} from './auth.js';
import { initVapid, getVapidPublicKey, saveSubscription, broadcastPush, sendToDevice } from './push.js';
import { generateStockAISummary, getCachedAISummary } from './gemini.js';
import { getAppSettings, updateAppSettings, shouldIncludeNotesInAI } from './app-settings.js';
import { assessSummaryStaleness } from '../core/analysis/staleness.js';
import { buildBackup, mergeBackup } from '../core/backup.js';
import { readPersonalData, writePersonalData } from './backup-store.js';
import {
  startAlertWorker,
  runSweep,
  sendWeeklyDigest,
  getNotificationSettings,
  updateNotificationSettings,
  getNotificationHistory,
  markNotificationsRead
} from './alerts.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite database and VAPID keys
initDatabase();
initVapid();

const app = express();
const PORT = process.env.PORT || 3000;

// The PWA is served from the same origin as the API, so no cross-origin
// access is needed. A wide-open policy was a larger door than the app uses.
app.use(cors({ origin: false }));
app.use(express.json({ limit: '256kb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
const WEB_DIR = path.join(__dirname, '../web');
// Before express.static, or the unstamped worker wins.
app.get('/bust', (req, res) => {
  // The escape hatch for a client wedged on an old worker. Ahead of
  // express.static so the file cannot be served without these headers, and
  // sw.js refuses to intercept the path.
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
  res.setHeader('Clear-Site-Data', '"cache"');
  res.sendFile(path.join(WEB_DIR, 'bust.html'));
});

app.use(swVersion(WEB_DIR));
app.use(express.static(WEB_DIR, {
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css') || filePath.endsWith('.webmanifest')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ----------------- SYSTEM & HEALTH -----------------
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'Pocket Omaha',
    time: new Date().toISOString()
  });
});

// ----------------- ADMIN API (pwa-invite-console) -----------------
app.get('/api/admin/devices', requireAdmin, getAdminDevices);
app.post('/api/admin/devices/:id/revoke', requireAdmin, updateDeviceRevoke);
app.post('/api/admin/devices/:id/label', requireAdmin, updateDeviceLabel);
app.delete('/api/admin/devices/:id', requireAdmin, deleteDevice);

app.get('/api/admin/invites', requireAdmin, getAdminInvites);
app.post('/api/admin/invites', requireAdmin, createAdminInvite);
app.post('/api/admin/invites/:id/revoke', requireAdmin, revokeAdminInvite);

// ----------------- PUBLIC AUTH API -----------------
app.post('/api/auth/redeem', redeemInvite);
app.get('/api/auth/session', checkSession);

// ----------------- PUSH NOTIFICATIONS API -----------------
app.get('/api/push/vapid-key', getVapidPublicKey);
app.post('/api/push/subscribe', requireDeviceAuth, saveSubscription);
/**
 * Send a test notification to the calling device.
 *
 * Deliberately built from the same shape a real alert uses — same icon, badge,
 * tag and payload — so it exercises the delivery path rather than proving only
 * that the endpoint responds. Scoped to the caller: several devices are
 * registered in this household and a test on one should not wake the rest.
 * The admin listener, which has no device of its own, still broadcasts.
 */
app.post('/api/push/test', requireDeviceAuth, async (req, res) => {
  const payload = {
    title: '🎩 Pocket Omaha — test',
    body: 'Notifications are working. Real alerts look like this: health changes, distress signals and entry points.',
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: 'TEST_NOTIFICATION',
    data: { url: '/', type: 'TEST_NOTIFICATION', severity: 'info' }
  };

  try {
    if (!req.device) {
      const results = await broadcastPush(payload);
      return res.json({ success: true, scope: 'all devices', delivered: results.length });
    }

    const result = await sendToDevice(req.device.id, payload);

    if (result.subscriptions === 0) {
      return res.status(409).json({
        error: 'This device has not subscribed to notifications yet. Enable them first.',
        code: 'no-subscription'
      });
    }
    if (result.delivered === 0) {
      return res.status(502).json({
        error: 'The push service rejected the message. Re-enable notifications and try again.',
        code: 'delivery-failed',
        detail: result.errors[0] || null
      });
    }

    return res.json({ success: true, scope: 'this device', delivered: result.delivered });
  } catch (err) {
    console.error('Push test error:', err);
    return res.status(500).json({ error: 'Could not send the test notification.' });
  }
});

// ----------------- ALERTS & NOTIFICATIONS (PROTECTED) -----------------
app.get('/api/notifications', requireDeviceAuth, (req, res) => {
  res.json({
    settings: getNotificationSettings(),
    history: getNotificationHistory(parseInt(req.query.limit || '50', 10))
  });
});

app.post('/api/notifications/settings', requireDeviceAuth, (req, res) => {
  res.json({ success: true, settings: updateNotificationSettings(req.body || {}) });
});

app.post('/api/notifications/read', requireDeviceAuth, (req, res) => {
  markNotificationsRead();
  res.json({ success: true });
});

// Application preferences. Separate from /api/notifications because these are
// not alert settings and should not be loaded only when the alert centre is.
app.get('/api/settings', requireDeviceAuth, (req, res) => {
  res.json({ settings: getAppSettings() });
});

app.post('/api/settings', requireDeviceAuth, (req, res) => {
  res.json({ success: true, settings: updateAppSettings(req.body || {}) });
});

// Manual trigger for the sweep and the digest, so both can be exercised
// without waiting for the schedule.
app.post('/api/admin/alerts/sweep', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, ...(await runSweep()) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/admin/alerts/digest', requireAdmin, async (req, res) => {
  try {
    res.json({ success: true, alert: await sendWeeklyDigest() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ----------------- FINANCIAL DATA & SCORING API (PROTECTED) -----------------

// Single Stock Deep Dive
app.get('/api/stock/:ticker', requireDeviceAuth, async (req, res) => {
  const { ticker } = req.params;
  const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

  try {
    const data = await getStockData(ticker, forceRefresh);
    if (!data) {
      // An unresolvable symbol is an error. The previous build synthesised a
      // company from the ticker string and cached it as though it were real.
      return res.status(404).json({
        error: `No listing found for ${ticker.toUpperCase()}.`,
        ticker: ticker.toUpperCase()
      });
    }
    return res.json(data);
  } catch (err) {
    // A blocked upstream is not a missing company and not a bug in this
    // server. 503 with Retry-After so the client can wait rather than retry.
    if (err?.kind === 'rate_limited' || err?.kind === 'network') {
      if (err.retryAfterMs) {
        res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
      }
      return res.status(503).json({
        error:
          err.kind === 'rate_limited'
            ? 'Market data is rate-limited upstream. Try again shortly.'
            : 'Market data is unreachable. Try again shortly.',
        kind: err.kind,
        ticker: ticker.toUpperCase()
      });
    }
    console.error(`Error fetching ${ticker}:`, err);
    return res.status(500).json({ error: 'Failed to fetch financial data' });
  }
});

/**
 * Whether a cached analysis still describes the company it was written about.
 *
 * The comparison itself is `core/analysis/staleness.js`, so Android reaches the
 * same verdict through its own bridge rather than through a second opinion
 * written in Kotlin.
 *
 * The stock read is deliberately not forced. `getStockData` serves the
 * 15-minute quote tier, and the deep dive has just fetched this ticker, so on
 * the path that matters this costs a cache read and no upstream request. If it
 * fails, the analysis is returned without a verdict rather than not at all: a
 * missing staleness banner is a smaller loss than a missing analysis.
 */
async function withStaleness(ticker, summary) {
  if (!summary) return summary;
  try {
    const current = await getStockData(ticker);
    return { ...summary, staleness: assessSummaryStaleness(summary, current) };
  } catch (err) {
    console.warn(`[Staleness] could not evaluate ${ticker}:`, err.message);
    return summary;
  }
}

// Get Cached Gemini AI Summary
app.get('/api/stock/:ticker/ai-summary', requireDeviceAuth, async (req, res) => {
  const { ticker } = req.params;
  try {
    const cached = getCachedAISummary(ticker);
    return res.json({ summary: await withStaleness(ticker, cached) });
  } catch (err) {
    console.error(`Error retrieving AI summary for ${ticker}:`, err);
    return res.status(500).json({ error: 'Failed to retrieve AI summary' });
  }
});

// Generate or Refresh Gemini AI Fundamental & Moat Analysis
app.post('/api/stock/:ticker/ai-summary', requireDeviceAuth, async (req, res) => {
  const { ticker } = req.params;
  const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true' || req.body?.forceRefresh === true;

  try {
    if (!forceRefresh) {
      const cached = getCachedAISummary(ticker);
      if (cached) {
        return res.json({
          success: true,
          summary: await withStaleness(ticker, cached),
          fromCache: true
        });
      }
    }

    const stock = await getStockData(ticker);
    if (!stock) {
      return res.status(404).json({ error: `Ticker ${ticker} not found` });
    }

    // The user's thesis is the most personal data in the app, so it travels
    // only on an explicit opt-in. Off by default; see server/app-settings.js.
    const thesis = shouldIncludeNotesInAI()
      ? db.prepare('SELECT * FROM theses WHERE ticker = ?').get(ticker.toUpperCase())
      : null;
    const result = await generateStockAISummary(stock, thesis);

    return res.json({ success: true, summary: result, fromCache: false });
  } catch (err) {
    console.error(`Error generating Gemini summary for ${ticker}:`, err);
    return res.status(500).json({ error: err.message || 'Failed to generate Gemini analysis' });
  }
});

// Search / Autocomplete Tickers & Company Names
app.get('/api/search', requireDeviceAuth, async (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) {
    return res.json([]);
  }

  try {
    const results = await searchStocks(query);
    return res.json(results);
  } catch (err) {
    // Same shape as the /api/stock handler above: a blocked upstream is not a
    // missing company. Search is the one place where flattening it does real
    // damage, because an empty list is also a valid answer -- the client would
    // otherwise report a live ticker as nonexistent.
    if (err?.kind === 'rate_limited' || err?.kind === 'network') {
      if (err.retryAfterMs) {
        res.set('Retry-After', String(Math.ceil(err.retryAfterMs / 1000)));
      }
      return res.status(503).json({
        error:
          err.kind === 'rate_limited'
            ? 'Search is rate-limited upstream. Try again shortly.'
            : 'Search is unreachable. Try again shortly.',
        kind: err.kind
      });
    }
    console.error('Search endpoint error:', err);
    return res.status(503).json({
      error: 'Search is unavailable right now.',
      kind: err?.kind || 'upstream'
    });
  }
});

// Compare Multiple Tickers Side-by-Side
app.get('/api/compare', requireDeviceAuth, async (req, res) => {
  const rawTickers = req.query.tickers || 'AAPL,MSFT,NVDA';
  const tickers = rawTickers
    .split(',')
    .map(t => t.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 4);

  if (tickers.length === 0) {
    return res.status(400).json({ error: 'At least one ticker required' });
  }

  try {
    const stockPromises = tickers.map(t => getStockData(t).catch(() => null));
    const results = await Promise.all(stockPromises);
    const validStocks = results.filter(Boolean);

    return res.json({
      count: validStocks.length,
      stocks: validStocks
    });
  } catch (err) {
    console.error('Compare error:', err);
    return res.status(500).json({ error: 'Failed to compare stocks' });
  }
});

// Suggested peers for the comparison view.
app.get('/api/stock/:ticker/peers', requireDeviceAuth, async (req, res) => {
  const ticker = req.params.ticker.trim().toUpperCase();
  try {
    const symbols = await fetchPeers(ticker);
    // Anything already scored comes back with its numbers attached, so the
    // suggestion list can show why a peer is worth comparing.
    const peers = symbols.map((sym) => {
      const row = db
        .prepare('SELECT ticker, name, sector, health_score FROM stock_cache WHERE ticker = ?')
        .get(sym);
      return {
        ticker: sym,
        name: row?.name || null,
        sector: row?.sector || null,
        health_score: row?.health_score ?? null,
        isCached: Boolean(row)
      };
    });
    return res.json({ ticker, peers });
  } catch (err) {
    console.warn(`Peer lookup failed for ${ticker}:`, err.message);
    return res.json({ ticker, peers: [] });
  }
});

// Filter Endpoint
//
// Filters the stocks this install has data for — the watchlists plus anything
// looked up before. It is deliberately not presented as a market-wide screen:
// there is no free universe endpoint behind it, and implying otherwise would
// suggest the absence of a match means something it does not.
//
// Renamed from /api/screener for that reason (docs/15 §2.5). The comment below
// had always said what this does; the name was the part that disagreed.
app.get('/api/filter', requireDeviceAuth, async (req, res) => {
  const minHealth = parseInt(req.query.minHealth || '0', 10);
  const minPiotroski = parseInt(req.query.minPiotroski || '0', 10);
  const minRoic = parseFloat(req.query.minRoic || '0');
  const sector = req.query.sector || '';
  const netCashOnly = req.query.netCash === '1' || req.query.netCash === 'true';
  const fcfPositive = req.query.fcfPositive === '1' || req.query.fcfPositive === 'true';
  const maxDebtToEquity = req.query.maxDebtToEquity
    ? parseFloat(req.query.maxDebtToEquity)
    : null;

  // Make sure everything on a watchlist is present, so the filter covers the
  // portfolio rather than an arbitrary subset of it.
  try {
    const lists = db.prepare('SELECT tickers_json FROM watchlists').all();
    const wanted = new Set();
    for (const l of lists) {
      for (const t of JSON.parse(l.tickers_json || '[]')) wanted.add(t);
    }
    const missing = [...wanted].filter(
      (t) => !db.prepare('SELECT 1 FROM stock_cache WHERE ticker = ?').get(t)
    );
    // Bounded so a large watchlist cannot turn one request into fifty fetches.
    for (const t of missing.slice(0, 6)) {
      await getStockData(t).catch(() => {});
    }
  } catch (err) {
    console.warn('Filter warm-up warning:', err.message);
  }

  let query = `SELECT * FROM stock_cache
               WHERE health_score IS NOT NULL
                 AND health_score >= ?
                 AND COALESCE(piotroski_score, -1) >= ?
                 AND COALESCE(roic_pct, -999) >= ?`;
  const params = [minHealth, minPiotroski, minRoic];

  if (sector && sector !== 'all') {
    query += ' AND sector = ?';
    params.push(sector);
  }
  if (netCashOnly) query += ' AND net_cash_b > 0';

  query += ' ORDER BY health_score DESC LIMIT 100';

  const rows = db.prepare(query).all(...params);

  const stocks = rows
    .map((r) => {
      const summary = JSON.parse(r.summary_json || '{}');
      const financials = JSON.parse(r.financials_json || '{}');
      return {
        ticker: r.ticker,
        name: r.name,
        sector: r.sector,
        currency: r.currency || 'USD',
        // Statement figures below are in this, which is not always the same.
        reporting_currency: financials.reportingCurrency || r.currency || 'USD',
        price: r.price,
        change_pct: r.change_pct,
        health_score: r.health_score,
        piotroski_score: r.piotroski_score,
        altman_z: r.altman_z,
        roic_pct: r.roic_pct,
        fcf_conversion_pct: r.fcf_conversion_pct,
        net_cash_b: r.net_cash_b,
        debt_to_equity: summary.metrics?.debtToEquity ?? null,
        free_cash_flow: financials.freeCashFlow ?? null,
        summary
      };
    })
    .filter((s) => {
      if (fcfPositive && !(s.free_cash_flow > 0)) return false;
      if (maxDebtToEquity !== null) {
        const netCash = s.net_cash_b !== null && s.net_cash_b > 0;
        if (!netCash && !(s.debt_to_equity !== null && s.debt_to_equity <= maxDebtToEquity)) {
          return false;
        }
      }
      return true;
    });

  const universe = db
    .prepare('SELECT COUNT(*) AS n FROM stock_cache WHERE health_score IS NOT NULL')
    .get();

  return res.json({
    count: stocks.length,
    universe: universe?.n ?? stocks.length,
    stocks
  });
});

// ----------------- WATCHLISTS API (PROTECTED) -----------------
app.get('/api/watchlists', requireDeviceAuth, (req, res) => {
  const lists = db.prepare('SELECT * FROM watchlists ORDER BY is_default DESC, name ASC').all();
  return res.json({
    watchlists: lists.map(l => ({
      id: l.id,
      name: l.name,
      tickers: JSON.parse(l.tickers_json || '[]'),
      is_default: Boolean(l.is_default),
      updated_at: l.updated_at
    }))
  });
});

app.post('/api/watchlists', requireDeviceAuth, (req, res) => {
  const { name, tickers = [] } = req.body || {};
  if (!name || typeof name !== 'string') {
    return res.status(400).json({ error: 'Watchlist name is required' });
  }

  const id = name.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30) + '-' + Date.now().toString(36);
  const cleanTickers = Array.isArray(tickers) ? tickers.map(t => String(t).toUpperCase().trim()) : [];

  db.prepare(`
    INSERT INTO watchlists (id, name, tickers_json, is_default, updated_at)
    VALUES (?, ?, ?, 0, datetime('now'))
  `).run(id, name.trim(), JSON.stringify(cleanTickers));

  return res.json({ success: true, id, name: name.trim(), tickers: cleanTickers });
});

app.put('/api/watchlists/:id', requireDeviceAuth, (req, res) => {
  const { id } = req.params;
  const { name, tickers, is_default } = req.body || {};

  const existing = db.prepare('SELECT * FROM watchlists WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Watchlist not found' });
  }

  if (is_default === true || is_default === 1) {
    db.prepare('UPDATE watchlists SET is_default = 0').run();
    db.prepare('UPDATE watchlists SET is_default = 1 WHERE id = ?').run(id);
  }

  const newName = name ? name.trim() : existing.name;
  const newTickers = Array.isArray(tickers) ? JSON.stringify(tickers.map(t => String(t).toUpperCase().trim())) : existing.tickers_json;

  db.prepare(`
    UPDATE watchlists
    SET name = ?, tickers_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(newName, newTickers, id);

  return res.json({ success: true });
});

app.delete('/api/watchlists/:id', requireDeviceAuth, (req, res) => {
  const { id } = req.params;
  db.prepare('DELETE FROM watchlists WHERE id = ?').run(id);
  return res.json({ success: true });
});

// Add a Stock to a Watchlist
app.post('/api/watchlists/:id/stocks', requireDeviceAuth, async (req, res) => {
  const { id } = req.params;
  const { ticker } = req.body || {};
  if (!ticker || typeof ticker !== 'string') {
    return res.status(400).json({ error: 'Ticker symbol is required' });
  }

  const cleanTicker = ticker.trim().toUpperCase();
  const existing = db.prepare('SELECT * FROM watchlists WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Watchlist not found' });
  }

  let currentTickers = JSON.parse(existing.tickers_json || '[]');
  if (!currentTickers.includes(cleanTicker)) {
    currentTickers.push(cleanTicker);
    db.prepare(`
      UPDATE watchlists
      SET tickers_json = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(JSON.stringify(currentTickers), id);
  }

  // Pre-fetch stock data to ensure it is cached
  let stockData = null;
  try {
    stockData = await getStockData(cleanTicker);
  } catch (err) {
    console.warn(`[Finance] Pre-fetch warning on adding ${cleanTicker}:`, err.message);
  }

  return res.json({
    success: true,
    watchlistId: id,
    ticker: cleanTicker,
    tickers: currentTickers,
    stock: stockData
  });
});

// Remove a Stock from a Watchlist
app.delete('/api/watchlists/:id/stocks/:ticker', requireDeviceAuth, (req, res) => {
  const { id, ticker } = req.params;
  const cleanTicker = (ticker || '').trim().toUpperCase();

  const existing = db.prepare('SELECT * FROM watchlists WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Watchlist not found' });
  }

  let currentTickers = JSON.parse(existing.tickers_json || '[]');
  currentTickers = currentTickers.filter(t => t !== cleanTicker);

  db.prepare(`
    UPDATE watchlists
    SET tickers_json = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(JSON.stringify(currentTickers), id);

  return res.json({
    success: true,
    watchlistId: id,
    ticker: cleanTicker,
    tickers: currentTickers
  });
});

// Watchlist Health Composite Details
app.get('/api/watchlists/:id/health', requireDeviceAuth, async (req, res) => {
  const { id } = req.params;
  const wl = db.prepare('SELECT * FROM watchlists WHERE id = ?').get(id);
  if (!wl) {
    return res.status(404).json({ error: 'Watchlist not found' });
  }

  const tickers = JSON.parse(wl.tickers_json || '[]');
  if (tickers.length === 0) {
    return res.json({
      watchlistId: id,
      name: wl.name,
      compositeScore: 0,
      grade: 'EMPTY',
      stockCount: 0,
      stocks: []
    });
  }

  const stockPromises = tickers.map(t => getStockData(t).catch(() => null));
  const fetched = await Promise.all(stockPromises);
  const validStocks = fetched.filter(Boolean);

  if (validStocks.length === 0) {
    return res.json({
      watchlistId: id,
      name: wl.name,
      compositeScore: 0,
      grade: 'N/A',
      stockCount: 0,
      stocks: []
    });
  }

  // Weighted by market cap, as the spec asks: a composite that treats a
  // $3tn position and a $2bn position alike is not a portfolio health index.
  // Stocks with too little filed data to score are excluded and counted
  // separately rather than being folded in as a zero.
  const scored = validStocks.filter((s) => typeof s.health_score === 'number');
  const unscored = validStocks.length - scored.length;

  const weightOf = (s) => (typeof s.market_cap === 'number' && s.market_cap > 0 ? s.market_cap : null);
  const haveWeights = scored.every((s) => weightOf(s) !== null);
  const totalWeight = haveWeights ? scored.reduce((sum, s) => sum + weightOf(s), 0) : scored.length;

  const weighted = (pick) => {
    if (!scored.length) return null;
    const total = scored.reduce((sum, s) => {
      const v = pick(s);
      if (v === null || v === undefined) return sum;
      return sum + v * (haveWeights ? weightOf(s) : 1);
    }, 0);
    return total / totalWeight;
  };

  const avgHealth = scored.length ? Math.round(weighted((s) => s.health_score)) : null;

  const pillarNames = ['Solvency', 'Profitability', 'Valuation', 'Growth', 'Capital Return'];
  const avgPillars = pillarNames.map((name, idx) => {
    const value = weighted((s) => s.pillars?.[idx]?.score ?? null);
    return {
      name,
      score: value === null ? null : Number(value.toFixed(1)),
      max: 20,
      pct: value === null ? null : Math.round((value / 20) * 100)
    };
  });

  let totalPass = 0;
  let totalWatch = 0;
  let totalFail = 0;
  let totalNa = 0;
  validStocks.forEach((s) => {
    const c = s.summary?.checklistSummary;
    if (!c) return;
    totalPass += c.passCount || 0;
    totalWatch += c.watchCount || 0;
    totalFail += c.failCount || 0;
    totalNa += c.naCount || 0;
  });

  let grade = 'N/A';
  if (avgHealth !== null) {
    if (avgHealth >= 85) grade = 'EXCELLENT';
    else if (avgHealth >= 70) grade = 'GOOD';
    else if (avgHealth >= 50) grade = 'MODERATE';
    else grade = 'CAUTION';
  }

  return res.json({
    watchlistId: id,
    name: wl.name,
    compositeScore: avgHealth,
    grade,
    stockCount: validStocks.length,
    pillars: avgPillars,
    weighting: haveWeights ? 'market-cap' : 'equal',
    unscoredCount: unscored,
    checklistAggregates: {
      totalPass,
      totalWatch,
      totalFail,
      totalNa
    },
    stocks: validStocks
  });
});

// ----------------- INVESTMENT THESIS & JOURNAL API (PROTECTED) -----------------
app.get('/api/theses/:ticker', requireDeviceAuth, (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const thesis = db.prepare('SELECT * FROM theses WHERE ticker = ?').get(ticker);
  if (!thesis) {
    return res.json({
      ticker,
      conviction: 'high',
      targetBuyPrice: null,
      coreRationale: '',
      moatTags: [],
      sellTriggers: [],
      journalEntries: []
    });
  }

  return res.json({
    ticker: thesis.ticker,
    conviction: thesis.conviction,
    targetBuyPrice: thesis.target_buy_price,
    coreRationale: thesis.core_rationale,
    moatTags: JSON.parse(thesis.moat_tags_json || '[]'),
    sellTriggers: JSON.parse(thesis.sell_triggers_json || '[]'),
    journalEntries: JSON.parse(thesis.journal_entries_json || '[]'),
    updatedAt: thesis.updated_at
  });
});

app.post('/api/theses/:ticker', requireDeviceAuth, (req, res) => {
  const ticker = req.params.ticker.toUpperCase();
  const { conviction = 'high', targetBuyPrice = null, coreRationale = '', moatTags = [], sellTriggers = [], journalEntries = [] } = req.body || {};

  db.prepare(`
    INSERT INTO theses (ticker, conviction, target_buy_price, core_rationale, moat_tags_json, sell_triggers_json, journal_entries_json, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(ticker) DO UPDATE SET
      conviction=excluded.conviction,
      target_buy_price=excluded.target_buy_price,
      core_rationale=excluded.core_rationale,
      moat_tags_json=excluded.moat_tags_json,
      sell_triggers_json=excluded.sell_triggers_json,
      journal_entries_json=excluded.journal_entries_json,
      updated_at=datetime('now')
  `).run(
    ticker,
    conviction,
    targetBuyPrice,
    coreRationale,
    JSON.stringify(moatTags),
    JSON.stringify(sellTriggers),
    JSON.stringify(journalEntries)
  );

  return res.json({ success: true, ticker });
});

// Full Backup Export
app.get('/api/theses', requireDeviceAuth, (req, res) => {
  const exportData = buildBackup(readPersonalData(), new Date().toISOString());

  res.setHeader('Content-Disposition', 'attachment; filename="pocket-omaha-backup.json"');
  res.setHeader('Content-Type', 'application/json');
  return res.json(exportData);
});

/**
 * Restore a backup.
 *
 * Merges rather than replaces. The README has promised "backup export and
 * restore" while only export existed, and a restore that wiped what was
 * already here would be worse than none — people import onto a device that
 * already has notes on it.
 *
 * The merge rules live in core/backup.js so the Android client applies exactly
 * the same ones. This handler reads the current state, hands both sides over,
 * and writes the result back.
 *
 * Deliberately not /api/theses/import: `/api/theses/:ticker` is declared above
 * and would match it first, quietly filing the whole backup as a thesis for a
 * company called IMPORT. It did exactly that once. A path that cannot collide
 * survives someone reordering the routes later.
 */
app.post('/api/backup/import', requireDeviceAuth, (req, res) => {
  let merged;
  try {
    merged = mergeBackup(req.body, readPersonalData());
  } catch (err) {
    if (err?.name === 'BackupError') {
      return res.status(400).json({ error: err.message, kind: err.kind });
    }
    throw err;
  }

  try {
    writePersonalData(merged);
  } catch (err) {
    console.error('[Import] rolled back:', err.message);
    return res.status(500).json({ error: 'Import failed; nothing was changed.' });
  }

  return res.json({ success: true, ...merged.report });
});

// Unmatched API routes get a JSON 404. Falling through to index.html made a
// mistyped endpoint return 200 with an HTML body to a caller expecting JSON.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Unknown endpoint: ${req.method} /api${req.path}` });
});

// Everything else falls through to the PWA shell for client-side routing.
app.get('*', (req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎩 Pocket Omaha backend is live at http://0.0.0.0:${PORT}`);
  console.log('   Admin endpoints ready under /api/admin/* (X-Admin: 1, private listener only)');
  startAlertWorker();
});
