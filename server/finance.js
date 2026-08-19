import { db } from './db.js';
import { computeComprehensiveHealth } from './scoring.js';

// In-memory session cache for Yahoo Finance crumb and cookie
let yahooSession = {
  cookie: null,
  crumb: null,
  expires: 0
};

/**
 * Get or refresh Yahoo Finance session (cookie + crumb)
 */
export async function getYahooSession(force = false) {
  if (!force && yahooSession.cookie && yahooSession.crumb && Date.now() < yahooSession.expires) {
    return yahooSession;
  }

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9'
  };

  try {
    const cookieRes = await fetch('https://fc.yahoo.com', {
      headers,
      signal: AbortSignal.timeout(4000)
    });
    const cookie = cookieRes.headers.get('set-cookie');

    if (cookie) {
      const crumbRes = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
        headers: { ...headers, Cookie: cookie },
        signal: AbortSignal.timeout(4000)
      });

      if (crumbRes.ok) {
        const crumb = await crumbRes.text();
        if (crumb && !crumb.includes('Too Many Requests') && !crumb.includes('<html')) {
          yahooSession = {
            cookie,
            crumb,
            expires: Date.now() + 6 * 3600 * 1000 // 6 hours
          };
          return yahooSession;
        }
      }
    }
  } catch (err) {
    console.warn('[Finance] Session initialization warning:', err.message);
  }

  return { cookie: null, crumb: null, expires: 0 };
}

/**
 * Search Yahoo Finance live for ticker symbols or company names
 */
export async function searchYahooFinance(query) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) return [];

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const urls = [
    `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleanQuery)}&quotesCount=14&newsCount=0`,
    `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(cleanQuery)}&quotesCount=14&newsCount=0`
  ];

  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const data = await res.json();
        const quotes = data.quotes || [];
        return quotes
          .filter(q => q.quoteType === 'EQUITY' || q.quoteType === 'ETF' || q.quoteType === 'MUTUALFUND')
          .map(q => ({
            ticker: q.symbol,
            name: q.shortname || q.longname || q.symbol,
            sector: q.sector || q.industry || '',
            industry: q.industry || '',
            exchange: q.exchDisp || q.exchange || '',
            quoteType: q.quoteType || 'EQUITY'
          }));
      }
    } catch (e) {
      // Try next endpoint
    }
  }

  return [];
}

/**
 * High-level search combining SQLite cached stocks, live Yahoo Finance search, and curated list
 */
export async function searchStocks(queryStr) {
  const query = (queryStr || '').trim();
  if (!query) return [];
  const upper = query.toUpperCase();

  // 1. Search cached stocks in SQLite
  let cachedMatches = [];
  try {
    cachedMatches = db.prepare(`
      SELECT ticker, name, sector, industry, price, change_pct, health_score
      FROM stock_cache
      WHERE ticker LIKE ? OR UPPER(name) LIKE ?
      ORDER BY CASE WHEN ticker = ? THEN 0 WHEN ticker LIKE ? THEN 1 ELSE 2 END, health_score DESC
      LIMIT 10
    `).all(`${upper}%`, `%${upper}%`, upper, `${upper}%`);
  } catch (err) {
    console.warn('[Finance] DB search query error:', err.message);
  }

  const cachedMap = new Map();
  cachedMatches.forEach(item => cachedMap.set(item.ticker, item));

  // 2. Search Yahoo Finance live
  let liveResults = [];
  try {
    liveResults = await searchYahooFinance(query);
  } catch (err) {
    console.warn('[Finance] Live Yahoo search warning:', err.message);
  }

  const resultMap = new Map();

  // If exact ticker match is in cache, place it first
  if (cachedMap.has(upper)) {
    resultMap.set(upper, { ...cachedMap.get(upper), isCached: true });
  }

  // Add live search results
  liveResults.forEach(item => {
    const sym = item.ticker;
    const cached = cachedMap.get(sym);
    if (cached) {
      resultMap.set(sym, {
        ticker: sym,
        name: cached.name || item.name,
        sector: cached.sector || item.sector,
        industry: cached.industry || item.industry,
        exchange: item.exchange,
        quoteType: item.quoteType,
        price: cached.price,
        change_pct: cached.change_pct,
        health_score: cached.health_score,
        isCached: true
      });
    } else if (!resultMap.has(sym)) {
      resultMap.set(sym, {
        ticker: sym,
        name: item.name,
        sector: item.sector,
        industry: item.industry,
        exchange: item.exchange,
        quoteType: item.quoteType,
        price: null,
        change_pct: null,
        health_score: null,
        isCached: false
      });
    }
  });

  // Add remaining cached matches
  cachedMatches.forEach(item => {
    if (!resultMap.has(item.ticker)) {
      resultMap.set(item.ticker, { ...item, isCached: true });
    }
  });

  // If upper looks like a clean ticker (1-7 uppercase chars) and not found, provide it as a direct option
  if (/^[A-Z0-9.\-]{1,7}$/.test(upper) && !resultMap.has(upper)) {
    resultMap.set(upper, {
      ticker: upper,
      name: `${upper} (Direct Symbol)`,
      sector: 'Equities',
      industry: '',
      exchange: '',
      quoteType: 'EQUITY',
      price: null,
      change_pct: null,
      health_score: null,
      isCached: false
    });
  }

  return Array.from(resultMap.values()).slice(0, 12);
}

// Built-in high-quality seed profiles for instant offline & fast first-run experience
const SEED_PROFILES = {
  AAPL: {
    name: 'Apple Inc.',
    sector: 'Technology',
    industry: 'Consumer Electronics',
    currency: 'USD',
    price: 224.50,
    change_pct: 1.42,
    marketCap: 3420000000000,
    trailingPE: 33.8,
    forwardPE: 28.5,
    pegRatio: 2.1,
    dividendYield: 0.005,
    payoutRatio: 0.15,
    financials: {
      totalRevenue: 385600000000,
      grossProfit: 178000000000,
      ebit: 123000000000,
      netIncome: 100400000000,
      operatingCashFlow: 118200000000,
      capitalExpenditures: 9500000000,
      freeCashFlow: 108700000000,
      cashAndEquivalents: 65000000000,
      totalDebt: 101000000000,
      currentAssets: 153000000000,
      currentLiabilities: 145000000000,
      totalAssets: 352500000000,
      totalLiabilities: 290400000000,
      totalStockholderEquity: 62100000000,
      grossMargin: 0.462,
      operatingMargin: 0.319
    },
    historical: {
      years: [2020, 2021, 2022, 2023, 2024],
      revenue: [274.5, 365.8, 394.3, 383.3, 385.6],
      freeCashFlow: [73.4, 93.0, 111.4, 99.6, 108.7],
      grossMarginPct: [38.2, 41.8, 43.3, 44.1, 46.2],
      operatingMarginPct: [24.1, 29.8, 30.3, 29.8, 31.9],
      sharesOutstanding: [17.5, 16.7, 16.2, 15.7, 15.2],
      revenue3yCAGR: 0.075,
      eps3yCAGR: 0.125,
      shareDilutionYoY: -0.028
    },
    ratios: {
      roic: 54.2,
      pe: 33.8,
      peg: 2.1,
      grossMargin: 0.462
    }
  },
  MSFT: {
    name: 'Microsoft Corporation',
    sector: 'Technology',
    industry: 'Software - Infrastructure',
    currency: 'USD',
    price: 435.20,
    change_pct: 0.85,
    marketCap: 3230000000000,
    trailingPE: 36.2,
    forwardPE: 31.0,
    pegRatio: 1.85,
    dividendYield: 0.007,
    payoutRatio: 0.25,
    financials: {
      totalRevenue: 245100000000,
      grossProfit: 171000000000,
      ebit: 109400000000,
      netIncome: 88100000000,
      operatingCashFlow: 118500000000,
      capitalExpenditures: 44500000000,
      freeCashFlow: 74000000000,
      cashAndEquivalents: 80000000000,
      totalDebt: 58000000000,
      currentAssets: 119000000000,
      currentLiabilities: 104000000000,
      totalAssets: 512000000000,
      totalLiabilities: 243000000000,
      totalStockholderEquity: 269000000000,
      grossMargin: 0.698,
      operatingMargin: 0.446
    },
    historical: {
      years: [2020, 2021, 2022, 2023, 2024],
      revenue: [143.0, 168.1, 198.3, 211.9, 245.1],
      freeCashFlow: [45.2, 56.1, 65.1, 59.5, 74.0],
      grossMarginPct: [67.8, 68.9, 68.4, 68.9, 69.8],
      operatingMarginPct: [37.0, 41.6, 42.1, 41.8, 44.6],
      sharesOutstanding: [7.61, 7.55, 7.48, 7.43, 7.41],
      revenue3yCAGR: 0.138,
      eps3yCAGR: 0.165,
      shareDilutionYoY: -0.005
    },
    ratios: {
      roic: 31.8,
      pe: 36.2,
      peg: 1.85,
      grossMargin: 0.698
    }
  },
  NVDA: {
    name: 'NVIDIA Corporation',
    sector: 'Technology',
    industry: 'Semiconductors',
    currency: 'USD',
    price: 128.60,
    change_pct: 2.84,
    marketCap: 3160000000000,
    trailingPE: 68.5,
    forwardPE: 38.2,
    pegRatio: 1.25,
    dividendYield: 0.001,
    payoutRatio: 0.03,
    financials: {
      totalRevenue: 120800000000,
      grossProfit: 91500000000,
      ebit: 78500000000,
      netIncome: 65200000000,
      operatingCashFlow: 68400000000,
      capitalExpenditures: 3200000000,
      freeCashFlow: 65200000000,
      cashAndEquivalents: 34800000000,
      totalDebt: 9700000000,
      currentAssets: 62000000000,
      currentLiabilities: 18500000000,
      totalAssets: 85000000000,
      totalLiabilities: 32000000000,
      totalStockholderEquity: 53000000000,
      grossMargin: 0.758,
      operatingMargin: 0.649
    },
    historical: {
      years: [2020, 2021, 2022, 2023, 2024],
      revenue: [10.9, 16.7, 26.9, 27.0, 120.8],
      freeCashFlow: [4.3, 4.7, 8.1, 3.8, 65.2],
      grossMarginPct: [62.0, 63.3, 64.9, 56.9, 75.8],
      operatingMarginPct: [26.1, 27.2, 37.3, 20.6, 64.9],
      sharesOutstanding: [24.8, 24.9, 25.0, 24.9, 24.6],
      revenue3yCAGR: 0.742,
      eps3yCAGR: 0.985,
      shareDilutionYoY: -0.012
    },
    ratios: {
      roic: 68.4,
      pe: 68.5,
      peg: 1.25,
      grossMargin: 0.758
    }
  },
  GOOGL: {
    name: 'Alphabet Inc.',
    sector: 'Communication Services',
    industry: 'Internet Content & Information',
    currency: 'USD',
    price: 172.40,
    change_pct: 1.15,
    marketCap: 2150000000000,
    trailingPE: 24.8,
    forwardPE: 20.5,
    pegRatio: 1.18,
    dividendYield: 0.005,
    payoutRatio: 0.10,
    financials: {
      totalRevenue: 328000000000,
      grossProfit: 188000000000,
      ebit: 104000000000,
      netIncome: 86300000000,
      operatingCashFlow: 106000000000,
      capitalExpenditures: 39000000000,
      freeCashFlow: 67000000000,
      cashAndEquivalents: 108000000000,
      totalDebt: 28000000000,
      currentAssets: 178000000000,
      currentLiabilities: 84000000000,
      totalAssets: 425000000000,
      totalLiabilities: 125000000000,
      totalStockholderEquity: 300000000000,
      grossMargin: 0.573,
      operatingMargin: 0.317
    },
    historical: {
      years: [2020, 2021, 2022, 2023, 2024],
      revenue: [182.5, 257.6, 282.8, 307.4, 328.0],
      freeCashFlow: [42.8, 67.0, 60.0, 69.5, 67.0],
      grossMarginPct: [53.6, 56.9, 55.4, 56.5, 57.3],
      operatingMarginPct: [22.6, 30.6, 26.5, 27.4, 31.7],
      sharesOutstanding: [13.7, 13.5, 13.1, 12.7, 12.4],
      revenue3yCAGR: 0.088,
      eps3yCAGR: 0.172,
      shareDilutionYoY: -0.024
    },
    ratios: {
      roic: 28.5,
      pe: 24.8,
      peg: 1.18,
      grossMargin: 0.573
    }
  },
  'BRK-B': {
    name: 'Berkshire Hathaway Inc.',
    sector: 'Financial Services',
    industry: 'Insurance - Diversified',
    currency: 'USD',
    price: 452.10,
    change_pct: 0.42,
    marketCap: 990000000000,
    trailingPE: 19.5,
    forwardPE: 18.2,
    pegRatio: 1.45,
    dividendYield: 0.0,
    payoutRatio: 0.0,
    financials: {
      totalRevenue: 364000000000,
      grossProfit: 95000000000,
      ebit: 48000000000,
      netIncome: 96200000000,
      operatingCashFlow: 49200000000,
      capitalExpenditures: 19400000000,
      freeCashFlow: 29800000000,
      cashAndEquivalents: 276900000000,
      totalDebt: 122000000000,
      currentAssets: 350000000000,
      currentLiabilities: 130000000000,
      totalAssets: 1070000000000,
      totalLiabilities: 510000000000,
      totalStockholderEquity: 560000000000,
      grossMargin: 0.35,
      operatingMargin: 0.132
    },
    historical: {
      years: [2020, 2021, 2022, 2023, 2024],
      revenue: [245.5, 276.1, 302.1, 364.5, 364.0],
      freeCashFlow: [26.8, 26.1, 21.8, 29.8, 29.8],
      grossMarginPct: [32.0, 33.5, 34.0, 35.0, 35.0],
      operatingMarginPct: [11.5, 12.0, 11.8, 13.0, 13.2],
      sharesOutstanding: [2.35, 2.31, 2.25, 2.20, 2.18],
      revenue3yCAGR: 0.098,
      eps3yCAGR: 0.142,
      shareDilutionYoY: -0.010
    },
    ratios: {
      roic: 14.8,
      pe: 19.5,
      peg: 1.45,
      grossMargin: 0.350
    }
  },
  TSLA: {
    name: 'Tesla, Inc.',
    sector: 'Consumer Cyclical',
    industry: 'Auto Manufacturers',
    currency: 'USD',
    price: 218.40,
    change_pct: -2.35,
    marketCap: 695000000000,
    trailingPE: 64.2,
    forwardPE: 58.0,
    pegRatio: 4.20,
    dividendYield: 0.0,
    payoutRatio: 0.0,
    financials: {
      totalRevenue: 96700000000,
      grossProfit: 17200000000,
      ebit: 8200000000,
      netIncome: 14900000000,
      operatingCashFlow: 13200000000,
      capitalExpenditures: 8900000000,
      freeCashFlow: 4300000000,
      cashAndEquivalents: 29000000000,
      totalDebt: 11000000000,
      currentAssets: 49000000000,
      currentLiabilities: 28000000000,
      totalAssets: 106000000000,
      totalLiabilities: 43000000000,
      totalStockholderEquity: 63000000000,
      grossMargin: 0.178,
      operatingMargin: 0.085
    },
    historical: {
      years: [2020, 2021, 2022, 2023, 2024],
      revenue: [31.5, 53.8, 81.5, 96.8, 96.7],
      freeCashFlow: [2.8, 5.0, 7.6, 4.4, 4.3],
      grossMarginPct: [21.0, 25.3, 25.6, 18.2, 17.8],
      operatingMarginPct: [6.3, 12.1, 16.8, 8.2, 8.5],
      sharesOutstanding: [2.95, 3.10, 3.16, 3.18, 3.21],
      revenue3yCAGR: 0.215,
      eps3yCAGR: 0.045,
      shareDilutionYoY: 0.009
    },
    ratios: {
      roic: 11.4,
      pe: 64.2,
      peg: 4.2,
      grossMargin: 0.178
    }
  }
};

/**
 * Fetch stock data from cache or live Yahoo Finance with seed/synthetic fallback
 */
export async function getStockData(tickerSymbol, forceRefresh = false) {
  const ticker = tickerSymbol.trim().toUpperCase();

  // 1. Check SQLite Cache
  if (!forceRefresh) {
    try {
      const cached = db.prepare('SELECT * FROM stock_cache WHERE ticker = ?').get(ticker);
      if (cached) {
        const fetchedTime = new Date(cached.last_fetched_at).getTime();
        const ageMinutes = (Date.now() - fetchedTime) / (1000 * 60);
        // If cache is less than 15 minutes old, return immediately
        if (ageMinutes < 15) {
          return formatCachedStock(cached);
        }
      }
    } catch (e) {
      console.warn('[Finance] Cache read warning:', e.message);
    }
  }

  // 2. Attempt Live Yahoo Finance Fetch
  try {
    const rawData = await fetchFromYahoo(ticker);
    if (rawData) {
      const processed = processAndCacheStock(ticker, rawData);
      return processed;
    }
  } catch (err) {
    console.warn(`[Finance] Live fetch failed for ${ticker}: ${err.message}. Checking seed / cache...`);
  }

  // 3. Check if cached data exists (even if older than 15m)
  try {
    const fallbackCache = db.prepare('SELECT * FROM stock_cache WHERE ticker = ?').get(ticker);
    if (fallbackCache) {
      return formatCachedStock(fallbackCache);
    }
  } catch (e) {}

  // 4. Use Seed Profile if available
  if (SEED_PROFILES[ticker]) {
    const seed = SEED_PROFILES[ticker];
    const scoreResult = computeComprehensiveHealth({
      quote: {
        regularMarketPrice: seed.price,
        marketCap: seed.marketCap,
        trailingPE: seed.trailingPE,
        forwardPE: seed.forwardPE,
        pegRatio: seed.pegRatio,
        dividendYield: seed.dividendYield,
        payoutRatio: seed.payoutRatio,
        sharesOutstanding: seed.marketCap / seed.price
      },
      financials: seed.financials,
      ratios: seed.ratios,
      historical: seed.historical
    });

    const stockRecord = {
      ticker,
      name: seed.name,
      sector: seed.sector,
      industry: seed.industry,
      price: seed.price,
      change_pct: seed.change_pct,
      currency: seed.currency,
      market_cap: seed.marketCap,
      health_score: scoreResult.healthScore,
      altman_z: scoreResult.altmanZ,
      piotroski_score: scoreResult.piotroskiScore,
      roic_pct: scoreResult.roicPct,
      fcf_conversion_pct: scoreResult.fcfConversionPct,
      net_cash_b: scoreResult.netCashB,
      financials_json: JSON.stringify({ ...seed.financials, historical: seed.historical }),
      checklist_json: JSON.stringify(scoreResult.checklist),
      catalysts_json: JSON.stringify(scoreResult.catalysts),
      risks_json: JSON.stringify(scoreResult.risks),
      pillars_json: JSON.stringify(scoreResult.pillars),
      summary_json: JSON.stringify({
        healthGrade: scoreResult.healthGrade,
        healthLabel: scoreResult.healthLabel,
        healthTier: scoreResult.healthTier,
        checklistSummary: scoreResult.checklistSummary,
        dcf: scoreResult.dcf,
        ratios: seed.ratios
      })
    };

    saveStockToCache(stockRecord);
    return formatCachedStock(stockRecord);
  }

  // 5. Generate synthesized profile for unknown tickers if offline
  const synth = generateSyntheticProfile(ticker);
  const synthScore = computeComprehensiveHealth(synth);
  const synthRecord = {
    ticker,
    name: synth.name,
    sector: synth.sector,
    industry: synth.industry,
    price: synth.quote.regularMarketPrice,
    change_pct: synth.quote.change_pct,
    currency: synth.currency,
    market_cap: synth.quote.marketCap,
    health_score: synthScore.healthScore,
    altman_z: synthScore.altmanZ,
    piotroski_score: synthScore.piotroskiScore,
    roic_pct: synthScore.roicPct,
    fcf_conversion_pct: synthScore.fcfConversionPct,
    net_cash_b: synthScore.netCashB,
    financials_json: JSON.stringify({ ...synth.financials, historical: synth.historical }),
    checklist_json: JSON.stringify(synthScore.checklist),
    catalysts_json: JSON.stringify(synthScore.catalysts),
    risks_json: JSON.stringify(synthScore.risks),
    pillars_json: JSON.stringify(synthScore.pillars),
    summary_json: JSON.stringify({
      healthGrade: synthScore.healthGrade,
      healthLabel: synthScore.healthLabel,
      healthTier: synthScore.healthTier,
      checklistSummary: synthScore.checklistSummary,
      dcf: synthScore.dcf,
      ratios: synth.ratios
    })
  };

  saveStockToCache(synthRecord);
  return formatCachedStock(synthRecord);
}

/**
 * Fetch live data from Yahoo Finance quoteSummary API with crumb session and chart fallback
 */
async function fetchFromYahoo(ticker) {
  const session = await getYahooSession();
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
  if (session.cookie) {
    headers['Cookie'] = session.cookie;
  }

  const modules = 'price,summaryProfile,summaryDetail,financialData,defaultKeyStatistics,incomeStatementHistory,balanceSheetHistory,cashflowStatementHistory';
  const crumbParam = session.crumb ? '&crumb=' + encodeURIComponent(session.crumb) : '';
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}${crumbParam}`;

  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (res.ok) {
      const data = await res.json();
      const result = data.quoteSummary?.result?.[0];
      if (result) {
        const p = result.price || {};
        const fd = result.financialData || {};
        const sd = result.summaryDetail || {};
        const ks = result.defaultKeyStatistics || {};
        const sp = result.summaryProfile || {};

        return {
          quote: {
            regularMarketPrice: p.regularMarketPrice?.raw || fd.currentPrice?.raw || 100,
            regularMarketChangePercent: (p.regularMarketChangePercent?.raw || 0) * 100,
            marketCap: p.marketCap?.raw || sd.marketCap?.raw || 1e9,
            trailingPE: sd.trailingPE?.raw || ks.trailingPE?.raw || 25,
            forwardPE: sd.forwardPE?.raw || ks.forwardPE?.raw || 22,
            pegRatio: ks.pegRatio?.raw || 1.5,
            dividendYield: sd.dividendYield?.raw || fd.dividendYield?.raw || 0,
            payoutRatio: sd.payoutRatio?.raw || fd.payoutRatio?.raw || 0,
            sharesOutstanding: ks.sharesOutstanding?.raw || (p.marketCap?.raw ? p.marketCap.raw / (p.regularMarketPrice?.raw || 1) : 1e8),
            sector: sp.sector || 'Equities',
            industry: sp.industry || 'General Industry',
            currency: p.currency || 'USD',
            longName: p.longName || p.shortName || ticker,
            shortName: p.shortName || p.longName || ticker
          },
          summary: {
            financialData: fd,
            defaultKeyStatistics: ks,
            summaryDetail: sd,
            summaryProfile: sp,
            incomeStatementHistory: result.incomeStatementHistory || {},
            balanceSheetHistory: result.balanceSheetHistory || {},
            cashflowStatementHistory: result.cashflowStatementHistory || {}
          }
        };
      }
    }
  } catch (err) {
    console.warn(`[Finance] quoteSummary fetch failed for ${ticker}:`, err.message);
  }

  // Fallback to Chart API for price & basic company metadata
  try {
    const chartUrl = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1mo&range=5y`;
    const chartRes = await fetch(chartUrl, { headers, signal: AbortSignal.timeout(4000) });
    if (chartRes.ok) {
      const chartData = await chartRes.json();
      const meta = chartData.chart?.result?.[0]?.meta;
      if (meta && meta.regularMarketPrice) {
        const price = meta.regularMarketPrice;
        const prevClose = meta.chartPreviousClose || price;
        const changePct = prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0;
        const name = meta.longName || meta.shortName || ticker;

        return {
          quote: {
            regularMarketPrice: price,
            regularMarketChangePercent: changePct,
            marketCap: price * 1e8,
            trailingPE: 25,
            forwardPE: 22,
            pegRatio: 1.5,
            dividendYield: 0,
            payoutRatio: 0,
            sharesOutstanding: 1e8,
            sector: 'Equities',
            industry: 'General Industry',
            currency: meta.currency || 'USD',
            longName: name,
            shortName: name
          },
          summary: {}
        };
      }
    }
  } catch (err) {
    console.warn(`[Finance] Chart API fallback failed for ${ticker}:`, err.message);
  }

  return null;
}

function processAndCacheStock(ticker, raw) {
  const q = raw.quote || {};
  const fd = raw.summary?.financialData || {};
  const ks = raw.summary?.defaultKeyStatistics || {};
  const sd = raw.summary?.summaryDetail || {};
  const sp = raw.summary?.summaryProfile || {};

  const isHistory = raw.summary?.incomeStatementHistory?.incomeStatementHistory || [];
  const bsHistory = raw.summary?.balanceSheetHistory?.balanceSheetStatements || [];
  const cfHistory = raw.summary?.cashflowStatementHistory?.cashflowStatements || [];

  const price = q.regularMarketPrice || fd.currentPrice?.raw || 100;
  const changePct = q.regularMarketChangePercent !== undefined ? q.regularMarketChangePercent : 0;
  const name = q.longName || q.shortName || ticker;
  const marketCap = q.marketCap || (price * (ks.sharesOutstanding?.raw || 1e8));

  // Extract latest statement metrics
  const latestBS = bsHistory[0] || {};
  const priorBS = bsHistory[1] || latestBS;
  const latestIS = isHistory[0] || {};
  const priorIS = isHistory[1] || latestIS;
  const latestCF = cfHistory[0] || {};
  const priorCF = cfHistory[1] || latestCF;

  const totalRevenue = latestIS.totalRevenue?.raw || fd.totalRevenue?.raw || 1e9;
  const grossProfit = latestIS.grossProfit?.raw || fd.grossProfits?.raw || totalRevenue * 0.45;
  const ebit = latestIS.ebit?.raw || latestIS.operatingIncome?.raw || (fd.ebitda?.raw ? fd.ebitda.raw * 0.85 : totalRevenue * 0.20);
  const netIncome = latestIS.netIncome?.raw || fd.netIncome?.raw || totalRevenue * 0.15;
  const operatingCashFlow = latestCF.totalCashFromOperatingActivities?.raw || fd.operatingCashflow?.raw || netIncome * 1.1;
  const capitalExpenditures = Math.abs(latestCF.capitalExpenditures?.raw || (operatingCashFlow * 0.25));
  const freeCashFlow = fd.freeCashflow?.raw || (operatingCashFlow - capitalExpenditures);

  const cashAndEquivalents = latestBS.cash?.raw || latestBS.cashAndCashEquivalents?.raw || fd.totalCash?.raw || 1e8;
  const totalDebt = latestBS.longTermDebt?.raw || latestBS.shortLongTermDebt?.raw || fd.totalDebt?.raw || 0;
  const currentAssets = latestBS.totalCurrentAssets?.raw || cashAndEquivalents * 1.5;
  const currentLiabilities = latestBS.totalCurrentLiabilities?.raw || (currentAssets / 1.5);
  const totalAssets = latestBS.totalAssets?.raw || currentAssets * 2.5;
  const totalLiabilities = latestBS.totalLiab?.raw || totalAssets * 0.5;
  const totalStockholderEquity = latestBS.totalStockholderEquity?.raw || (totalAssets - totalLiabilities);

  // Construct 5-year historical trends
  const years = [];
  const revTrend = [];
  const fcfTrend = [];
  const gmTrend = [];
  const omTrend = [];
  const sharesTrend = [];

  const histLen = Math.max(1, isHistory.length);
  for (let i = histLen - 1; i >= 0; i--) {
    const is = isHistory[i] || {};
    const cf = cfHistory[i] || {};
    const yr = is.endDate ? new Date(is.endDate).getFullYear() : (2024 - i);
    years.push(yr);
    const r = (is.totalRevenue?.raw || totalRevenue) / 1e9;
    revTrend.push(Number(r.toFixed(1)));
    const ocf = cf.totalCashFromOperatingActivities?.raw || (r * 1e9 * 0.2);
    const cap = Math.abs(cf.capitalExpenditures?.raw || (ocf * 0.25));
    const fcf = (ocf - cap) / 1e9;
    fcfTrend.push(Number(fcf.toFixed(1)));
    const gp = is.grossProfit?.raw || (r * 1e9 * 0.45);
    gmTrend.push(Number(((gp / (r * 1e9)) * 100).toFixed(1)));
    const opInc = is.operatingIncome?.raw || is.ebit?.raw || (r * 1e9 * 0.20);
    omTrend.push(Number(((opInc / (r * 1e9)) * 100).toFixed(1)));
    sharesTrend.push(Number(((ks.sharesOutstanding?.raw || (marketCap / price)) / 1e9).toFixed(2)));
  }

  // Ensure at least 4 years in trend
  while (years.length < 5) {
    const prevYr = (years[0] || 2024) - 1;
    years.unshift(prevYr);
    revTrend.unshift(Number((revTrend[0] * 0.88).toFixed(1)));
    fcfTrend.unshift(Number((fcfTrend[0] * 0.85).toFixed(1)));
    gmTrend.unshift(gmTrend[0] || 45.0);
    omTrend.unshift(omTrend[0] || 20.0);
    sharesTrend.unshift(Number((sharesTrend[0] * 1.01).toFixed(2)));
  }

  const historical = {
    years,
    revenue: revTrend,
    freeCashFlow: fcfTrend,
    grossMarginPct: gmTrend,
    operatingMarginPct: omTrend,
    sharesOutstanding: sharesTrend,
    revenue3yCAGR: revTrend.length >= 4 ? ((revTrend[revTrend.length - 1] / revTrend[revTrend.length - 4]) ** (1 / 3)) - 1 : 0.10,
    eps3yCAGR: 0.12,
    shareDilutionYoY: sharesTrend.length >= 2 ? (sharesTrend[sharesTrend.length - 1] - sharesTrend[sharesTrend.length - 2]) / sharesTrend[sharesTrend.length - 2] : -0.01,
    priorYear: {
      netIncome: priorIS.netIncome?.raw || netIncome * 0.9,
      operatingCashFlow: priorCF.totalCashFromOperatingActivities?.raw || operatingCashFlow * 0.9,
      totalAssets: priorBS.totalAssets?.raw || totalAssets * 0.95,
      longTermDebt: priorBS.longTermDebt?.raw || totalDebt,
      currentAssets: priorBS.totalCurrentAssets?.raw || currentAssets * 0.95,
      currentLiabilities: priorBS.totalCurrentLiabilities?.raw || currentLiabilities,
      sharesOutstanding: (ks.sharesOutstanding?.raw || 1e9) * 1.01,
      grossProfit: priorIS.grossProfit?.raw || grossProfit * 0.9,
      totalRevenue: priorIS.totalRevenue?.raw || totalRevenue * 0.9
    }
  };

  const financials = {
    totalRevenue,
    grossProfit,
    ebit,
    netIncome,
    operatingCashFlow,
    capitalExpenditures,
    freeCashFlow,
    cashAndEquivalents,
    totalDebt,
    currentAssets,
    currentLiabilities,
    totalAssets,
    totalLiabilities,
    totalStockholderEquity,
    grossMargin: totalRevenue > 0 ? grossProfit / totalRevenue : 0.45,
    operatingMargin: totalRevenue > 0 ? ebit / totalRevenue : 0.20
  };

  const scoreResult = computeComprehensiveHealth({
    quote: {
      regularMarketPrice: price,
      marketCap,
      trailingPE: q.trailingPE || sd.trailingPE?.raw || ks.trailingPE?.raw || 25,
      forwardPE: q.forwardPE || sd.forwardPE?.raw || ks.forwardPE?.raw || 22,
      pegRatio: ks.pegRatio?.raw || q.pegRatio || 1.5,
      dividendYield: fd.dividendYield?.raw || sd.dividendYield?.raw || q.dividendYield || 0,
      payoutRatio: fd.payoutRatio?.raw || sd.payoutRatio?.raw || 0,
      sharesOutstanding: ks.sharesOutstanding?.raw || marketCap / price
    },
    financials,
    historical,
    ratios: {
      pe: q.trailingPE || sd.trailingPE?.raw || 25,
      peg: ks.pegRatio?.raw || 1.5,
      grossMargin: financials.grossMargin
    }
  });

  const record = {
    ticker,
    name,
    sector: q.sector || sp.sector || 'Equities',
    industry: q.industry || sp.industry || 'General Industry',
    price,
    change_pct: changePct,
    currency: q.currency || 'USD',
    market_cap: marketCap,
    health_score: scoreResult.healthScore,
    altman_z: scoreResult.altmanZ,
    piotroski_score: scoreResult.piotroskiScore,
    roic_pct: scoreResult.roicPct,
    fcf_conversion_pct: scoreResult.fcfConversionPct,
    net_cash_b: scoreResult.netCashB,
    financials_json: JSON.stringify({ ...financials, historical }),
    checklist_json: JSON.stringify(scoreResult.checklist),
    catalysts_json: JSON.stringify(scoreResult.catalysts),
    risks_json: JSON.stringify(scoreResult.risks),
    pillars_json: JSON.stringify(scoreResult.pillars),
    summary_json: JSON.stringify({
      healthGrade: scoreResult.healthGrade,
      healthLabel: scoreResult.healthLabel,
      healthTier: scoreResult.healthTier,
      checklistSummary: scoreResult.checklistSummary,
      dcf: scoreResult.dcf,
      ratios: {
        pe: q.trailingPE || sd.trailingPE?.raw || 25,
        forwardPE: q.forwardPE || sd.forwardPE?.raw || 22,
        peg: ks.pegRatio?.raw || 1.5,
        dividendYield: fd.dividendYield?.raw || sd.dividendYield?.raw || 0
      }
    })
  };

  saveStockToCache(record);
  return formatCachedStock(record);
}

function saveStockToCache(r) {
  try {
    const stmt = db.prepare(`
      INSERT INTO stock_cache (
        ticker, name, sector, industry, price, change_pct, currency, market_cap,
        health_score, altman_z, piotroski_score, roic_pct, fcf_conversion_pct, net_cash_b,
        financials_json, checklist_json, catalysts_json, risks_json, pillars_json, summary_json,
        last_fetched_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        datetime('now')
      )
      ON CONFLICT(ticker) DO UPDATE SET
        name=excluded.name,
        sector=excluded.sector,
        industry=excluded.industry,
        price=excluded.price,
        change_pct=excluded.change_pct,
        currency=excluded.currency,
        market_cap=excluded.market_cap,
        health_score=excluded.health_score,
        altman_z=excluded.altman_z,
        piotroski_score=excluded.piotroski_score,
        roic_pct=excluded.roic_pct,
        fcf_conversion_pct=excluded.fcf_conversion_pct,
        net_cash_b=excluded.net_cash_b,
        financials_json=excluded.financials_json,
        checklist_json=excluded.checklist_json,
        catalysts_json=excluded.catalysts_json,
        risks_json=excluded.risks_json,
        pillars_json=excluded.pillars_json,
        summary_json=excluded.summary_json,
        last_fetched_at=datetime('now')
    `);

    stmt.run(
      r.ticker, r.name, r.sector, r.industry, r.price, r.change_pct, r.currency, r.market_cap,
      r.health_score, r.altman_z, r.piotroski_score, r.roic_pct, r.fcf_conversion_pct, r.net_cash_b,
      r.financials_json, r.checklist_json, r.catalysts_json, r.risks_json, r.pillars_json, r.summary_json
    );
  } catch (err) {
    console.warn('[Finance] DB save error:', err.message);
  }
}

function formatCachedStock(row) {
  return {
    ticker: row.ticker,
    name: row.name,
    sector: row.sector,
    industry: row.industry,
    price: row.price,
    change_pct: row.change_pct,
    currency: row.currency || 'USD',
    market_cap: row.market_cap,
    health_score: row.health_score,
    altman_z: row.altman_z,
    piotroski_score: row.piotroski_score,
    roic_pct: row.roic_pct,
    fcf_conversion_pct: row.fcf_conversion_pct,
    net_cash_b: row.net_cash_b,
    financials: JSON.parse(row.financials_json || '{}'),
    checklist: JSON.parse(row.checklist_json || '[]'),
    catalysts: JSON.parse(row.catalysts_json || '[]'),
    risks: JSON.parse(row.risks_json || '[]'),
    pillars: JSON.parse(row.pillars_json || '[]'),
    summary: JSON.parse(row.summary_json || '{}'),
    last_fetched_at: row.last_fetched_at
  };
}

function generateSyntheticProfile(ticker) {
  const hash = Array.from(ticker).reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const price = 50 + (hash % 200);
  const marketCap = (10 + (hash % 100)) * 1e9;
  const rev = (5 + (hash % 50)) * 1e9;
  const ebit = rev * 0.22;
  const netIncome = rev * 0.16;
  const fcf = rev * 0.18;
  const cash = (3 + (hash % 20)) * 1e9;
  const debt = (2 + (hash % 15)) * 1e9;

  return {
    name: `${ticker} Global Corp`,
    sector: 'Diversified Industries',
    industry: 'Business Operations',
    currency: 'USD',
    quote: {
      regularMarketPrice: price,
      change_pct: Number((((hash % 50) - 25) / 10).toFixed(2)),
      marketCap,
      trailingPE: 22.0,
      forwardPE: 19.5,
      pegRatio: 1.4,
      sharesOutstanding: marketCap / price
    },
    financials: {
      totalRevenue: rev,
      grossProfit: rev * 0.50,
      ebit,
      netIncome,
      operatingCashFlow: fcf * 1.15,
      capitalExpenditures: fcf * 0.15,
      freeCashFlow: fcf,
      cashAndEquivalents: cash,
      totalDebt: debt,
      currentAssets: cash * 2,
      currentLiabilities: cash,
      totalAssets: marketCap * 0.4,
      totalLiabilities: marketCap * 0.2,
      totalStockholderEquity: marketCap * 0.2,
      grossMargin: 0.50,
      operatingMargin: 0.22
    },
    historical: {
      years: [2020, 2021, 2022, 2023, 2024],
      revenue: [rev * 0.7 / 1e9, rev * 0.8 / 1e9, rev * 0.9 / 1e9, rev * 0.95 / 1e9, rev / 1e9],
      freeCashFlow: [fcf * 0.65 / 1e9, fcf * 0.75 / 1e9, fcf * 0.85 / 1e9, fcf * 0.9 / 1e9, fcf / 1e9],
      grossMarginPct: [48, 49, 49.5, 50, 50],
      operatingMarginPct: [19, 20, 21, 21.5, 22],
      sharesOutstanding: [(marketCap / price) / 1e9, (marketCap / price) / 1e9, (marketCap / price) / 1e9, (marketCap / price) / 1e9, (marketCap / price) / 1e9],
      revenue3yCAGR: 0.11,
      eps3yCAGR: 0.14,
      shareDilutionYoY: -0.008
    },
    ratios: {
      roic: 18.5,
      pe: 22.0,
      peg: 1.4,
      grossMargin: 0.50
    }
  };
}

