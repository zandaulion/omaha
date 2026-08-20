/**
 * Pocket Omaha — the stored record, and the shape served to clients.
 *
 * `toRecord` flattens a scored model into the columns a host persists;
 * `formatCachedStock` reads one back. They are a pair and must move together —
 * a field added to one and not the other is written and never read, or read
 * and never written.
 *
 * Pure: no storage, no clock. The host supplies both.
 */

import { sumOrNull } from './assemble.js';

export function toRecord(ticker, quote, fundamentals, model, score) {
  const latest = model.latest || {};
  const cash = sumOrNull(latest.cash, latest.shortTermInvestments);

  return {
    ticker,
    name: quote.name,
    sector: quote.sector,
    industry: quote.industry,
    price: quote.price,
    change_pct: quote.changePct,
    // The currency the shares trade in, which is what a broker screen shows.
    currency: quote.currency || model.reportingCurrency,
    market_cap: quote.marketCap,
    health_score: score.healthScore,
    altman_z: score.altmanZ,
    piotroski_score: score.piotroskiScore,
    roic_pct: score.roicPct,
    fcf_conversion_pct: score.fcfConversionPct,
    net_cash_b: score.netCashB,
    financials_json: JSON.stringify({
      reportingCurrency: model.reportingCurrency,
      tradedCurrency: model.tradedCurrency,
      fx: model.fx,
      fiscalPeriodEnd: latest.asOfDate || null,
      isFinancial: model.isFinancial,
      revenue: latest.revenue ?? null,
      grossProfit: latest.grossProfit ?? null,
      operatingIncome: latest.operatingIncome ?? null,
      ebit: latest.ebit ?? null,
      ebitda: latest.ebitda ?? null,
      interestExpense: latest.interestExpense ?? null,
      netIncome: latest.netIncome ?? null,
      operatingCashFlow: latest.operatingCashFlow ?? null,
      capitalExpenditures: latest.capitalExpenditure ?? null,
      freeCashFlow: latest.freeCashFlow ?? null,
      cashAndEquivalents: cash,
      totalDebt: latest.totalDebt ?? null,
      currentAssets: latest.currentAssets ?? null,
      currentLiabilities: latest.currentLiabilities ?? null,
      inventory: latest.inventory ?? null,
      totalAssets: latest.totalAssets ?? null,
      totalLiabilities: latest.totalLiabilities ?? null,
      totalStockholderEquity: latest.equity ?? null,
      retainedEarnings: latest.retainedEarnings ?? null,
      dilutedShares: latest.dilutedShares ?? null,
      dilutedEPS: latest.dilutedEPS ?? null,
      grossMargin: score.metrics.grossMargin,
      operatingMargin: score.metrics.operatingMargin,
      historical: model.history
    }),
    checklist_json: JSON.stringify(score.checklist),
    catalysts_json: JSON.stringify(score.catalysts),
    risks_json: JSON.stringify(score.risks),
    pillars_json: JSON.stringify(score.pillars),
    summary_json: JSON.stringify({
      healthGrade: score.healthGrade,
      healthLabel: score.healthLabel,
      healthTier: score.healthTier,
      checklistSummary: score.checklistSummary,
      dcf: score.dcf,
      metrics: score.metrics,
      coverage: score.coverage,
      peHistory: score.peHistory || null,
      ratios: {
        pe: quote.trailingPE,
        forwardPE: quote.forwardPE,
        peg: quote.pegRatio,
        priceToBook: quote.priceToBook,
        dividendYield: quote.dividendYield,
        beta: quote.beta
      }
    }),
    statements_json: JSON.stringify(fundamentals)
  };
}

export function formatCachedStock(row, opts = {}) {
  const summary = JSON.parse(row.summary_json || '{}');
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
    summary,
    last_fetched_at: row.last_fetched_at,
    financials_fetched_at: row.financials_fetched_at || null,
    stale: Boolean(opts.stale),
    // Why the data is stale, when known: 'rate_limited', 'network', ...
    // Lets the alert sweep stop rather than keep asking, and lets the client
    // say something more useful than "offline".
    staleReason: opts.reason ?? null
  };
}
