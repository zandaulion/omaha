import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { initDatabase, db } from './db.js';
import { getStockData } from './finance.js';
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
import { initVapid, getVapidPublicKey, saveSubscription, broadcastPush } from './push.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize SQLite database and VAPID keys
initDatabase();
initVapid();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend files
const WEB_DIR = path.join(__dirname, '../web');
app.use(express.static(WEB_DIR));

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
app.post('/api/push/test', requireAdmin, async (req, res) => {
  const { title = 'Pocket Omaha Alert 🎩', body = 'Test health score update notification' } = req.body || {};
  const results = await broadcastPush({
    title,
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: '/' }
  });
  res.json({ success: true, delivered: results.length });
});

// ----------------- FINANCIAL DATA & SCORING API (PROTECTED) -----------------

// Single Stock Deep Dive
app.get('/api/stock/:ticker', requireDeviceAuth, async (req, res) => {
  const { ticker } = req.params;
  const forceRefresh = req.query.refresh === '1' || req.query.refresh === 'true';

  try {
    const data = await getStockData(ticker, forceRefresh);
    if (!data) {
      return res.status(404).json({ error: `Ticker ${ticker} not found` });
    }
    return res.json(data);
  } catch (err) {
    console.error(`Error fetching ${ticker}:`, err);
    return res.status(500).json({ error: 'Failed to fetch financial data' });
  }
});

// Search / Autocomplete Tickers
app.get('/api/search', requireDeviceAuth, async (req, res) => {
  const query = (req.query.q || '').trim().toUpperCase();
  if (!query) {
    return res.json([]);
  }

  const cachedMatches = db.prepare(`
    SELECT ticker, name, sector, price, change_pct, health_score
    FROM stock_cache
    WHERE ticker LIKE ? OR UPPER(name) LIKE ?
    LIMIT 8
  `).all(`${query}%`, `%${query}%`);

  const popularTickers = [
    { ticker: 'AAPL', name: 'Apple Inc.', sector: 'Technology' },
    { ticker: 'MSFT', name: 'Microsoft Corporation', sector: 'Technology' },
    { ticker: 'NVDA', name: 'NVIDIA Corporation', sector: 'Technology' },
    { ticker: 'GOOGL', name: 'Alphabet Inc.', sector: 'Communication Services' },
    { ticker: 'AMZN', name: 'Amazon.com Inc.', sector: 'Consumer Cyclical' },
    { ticker: 'META', name: 'Meta Platforms Inc.', sector: 'Communication Services' },
    { ticker: 'BRK-B', name: 'Berkshire Hathaway Inc.', sector: 'Financial Services' },
    { ticker: 'TSLA', name: 'Tesla Inc.', sector: 'Consumer Cyclical' },
    { ticker: 'JNJ', name: 'Johnson & Johnson', sector: 'Healthcare' },
    { ticker: 'V', name: 'Visa Inc.', sector: 'Financial Services' },
    { ticker: 'PG', name: 'Procter & Gamble Co.', sector: 'Consumer Defensive' },
    { ticker: 'KO', name: 'Coca-Cola Company', sector: 'Consumer Defensive' },
    { ticker: 'ASML', name: 'ASML Holding N.V.', sector: 'Technology' },
    { ticker: 'TSM', name: 'Taiwan Semiconductor Manufacturing', sector: 'Technology' }
  ];

  const matchedPopular = popularTickers.filter(t =>
    t.ticker.startsWith(query) || t.name.toUpperCase().includes(query)
  );

  const map = new Map();
  cachedMatches.forEach(item => map.set(item.ticker, item));
  matchedPopular.forEach(item => {
    if (!map.has(item.ticker)) {
      map.set(item.ticker, { ...item, price: null, change_pct: null, health_score: null });
    }
  });

  return res.json(Array.from(map.values()).slice(0, 10));
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

// Screener Endpoint
app.get('/api/screener', requireDeviceAuth, async (req, res) => {
  const minHealth = parseInt(req.query.minHealth || '0', 10);
  const minPiotroski = parseInt(req.query.minPiotroski || '0', 10);
  const minRoic = parseFloat(req.query.minRoic || '0');
  const sector = req.query.sector || '';

  const starterList = ['AAPL', 'MSFT', 'NVDA', 'GOOGL', 'BRK-B', 'TSLA', 'JNJ', 'PG', 'KO', 'V'];
  for (const t of starterList) {
    const cached = db.prepare('SELECT ticker FROM stock_cache WHERE ticker = ?').get(t);
    if (!cached) {
      await getStockData(t).catch(() => {});
    }
  }

  let query = 'SELECT * FROM stock_cache WHERE health_score >= ? AND piotroski_score >= ? AND roic_pct >= ?';
  const params = [minHealth, minPiotroski, minRoic];

  if (sector && sector !== 'all') {
    query += ' AND sector = ?';
    params.push(sector);
  }

  query += ' ORDER BY health_score DESC LIMIT 50';

  const rows = db.prepare(query).all(...params);
  const stocks = rows.map(r => ({
    ticker: r.ticker,
    name: r.name,
    sector: r.sector,
    price: r.price,
    change_pct: r.change_pct,
    health_score: r.health_score,
    piotroski_score: r.piotroski_score,
    altman_z: r.altman_z,
    roic_pct: r.roic_pct,
    fcf_conversion_pct: r.fcf_conversion_pct,
    net_cash_b: r.net_cash_b,
    summary: JSON.parse(r.summary_json || '{}')
  }));

  return res.json({ count: stocks.length, stocks });
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
  const { name, tickers } = req.body || {};

  const existing = db.prepare('SELECT * FROM watchlists WHERE id = ?').get(id);
  if (!existing) {
    return res.status(404).json({ error: 'Watchlist not found' });
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

  const avgHealth = Math.round(validStocks.reduce((sum, s) => sum + s.health_score, 0) / validStocks.length);
  
  const pillarSums = [0, 0, 0, 0, 0];
  validStocks.forEach(s => {
    if (s.pillars) {
      s.pillars.forEach((p, idx) => {
        pillarSums[idx] += p.score || 0;
      });
    }
  });

  const avgPillars = [
    { name: 'Solvency', score: Number((pillarSums[0] / validStocks.length).toFixed(1)), max: 20, pct: Math.round((pillarSums[0] / validStocks.length / 20) * 100) },
    { name: 'Profitability', score: Number((pillarSums[1] / validStocks.length).toFixed(1)), max: 20, pct: Math.round((pillarSums[1] / validStocks.length / 20) * 100) },
    { name: 'Valuation', score: Number((pillarSums[2] / validStocks.length).toFixed(1)), max: 20, pct: Math.round((pillarSums[2] / validStocks.length / 20) * 100) },
    { name: 'Growth', score: Number((pillarSums[3] / validStocks.length).toFixed(1)), max: 20, pct: Math.round((pillarSums[3] / validStocks.length / 20) * 100) },
    { name: 'Capital Return', score: Number((pillarSums[4] / validStocks.length).toFixed(1)), max: 20, pct: Math.round((pillarSums[4] / validStocks.length / 20) * 100) }
  ];

  let totalPass = 0;
  let totalWatch = 0;
  let totalFail = 0;
  validStocks.forEach(s => {
    if (s.summary?.checklistSummary) {
      totalPass += s.summary.checklistSummary.passCount || 0;
      totalWatch += s.summary.checklistSummary.watchCount || 0;
      totalFail += s.summary.checklistSummary.failCount || 0;
    }
  });

  let grade = 'EXCELLENT';
  if (avgHealth >= 85) grade = 'EXCELLENT';
  else if (avgHealth >= 70) grade = 'GOOD';
  else if (avgHealth >= 50) grade = 'MODERATE';
  else grade = 'CAUTION';

  return res.json({
    watchlistId: id,
    name: wl.name,
    compositeScore: avgHealth,
    grade,
    stockCount: validStocks.length,
    pillars: avgPillars,
    checklistAggregates: {
      totalPass,
      totalWatch,
      totalFail
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
  const theses = db.prepare('SELECT * FROM theses').all();
  const watchlists = db.prepare('SELECT * FROM watchlists').all();

  const exportData = {
    exportedAt: new Date().toISOString(),
    theses: theses.map(t => ({
      ticker: t.ticker,
      conviction: t.conviction,
      targetBuyPrice: t.target_buy_price,
      coreRationale: t.core_rationale,
      moatTags: JSON.parse(t.moat_tags_json || '[]'),
      sellTriggers: JSON.parse(t.sell_triggers_json || '[]'),
      journalEntries: JSON.parse(t.journal_entries_json || '[]'),
      updatedAt: t.updated_at
    })),
    watchlists: watchlists.map(w => ({
      id: w.id,
      name: w.name,
      tickers: JSON.parse(w.tickers_json || '[]'),
      is_default: Boolean(w.is_default)
    }))
  };

  res.setHeader('Content-Disposition', 'attachment; filename="pocket-omaha-backup.json"');
  res.setHeader('Content-Type', 'application/json');
  return res.json(exportData);
});

// Fallback to PWA index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(WEB_DIR, 'index.html'));
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🎩 Pocket Omaha backend is live at http://0.0.0.0:${PORT}`);
  console.log(`   Admin endpoints ready under /api/admin/* (Protected by X-Admin: 1)`);
});
