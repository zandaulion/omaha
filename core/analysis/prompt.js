/**
 * Pocket Omaha — Gemini analysis payload and prompt.
 *
 * Pure. Takes a scored stock and an optional thesis, returns the data package,
 * the instruction text and the response schema the API is asked to enforce.
 * No network, no database, no environment.
 *
 * It lives in core/ because the prompt has to be built where the data already
 * is — on the device — and because a second implementation of it would be a
 * second definition of what the model is told, which is the kind of drift that
 * shows up as an analysis quietly answering a different question.
 */

import { formatMoney } from '../scoring.js';
import { fixed as fixedDecimal } from '../format.js';

/**
 * Build a structured payload containing all available stock information and computed KPIs
 */
export function buildComprehensivePayload(stock, thesis = null) {
  const sum = stock.summary || {};
  const m = sum.metrics || {};
  const r = sum.ratios || {};
  const dcf = sum.dcf || {};
  const pe = sum.peHistory || {};
  const hist = stock.financials?.historical || {};
  // The currency the statements are in, which is not always the one the
  // shares trade in. `stock.currency` is the traded one, so using it here
  // labelled Nokia's entire EUR balance sheet with dollar signs.
  const currency =
    m.reportingCurrency || stock.financials?.reportingCurrency || stock.currency || 'USD';

  // Anything the filings do not contain is sent as the string "not reported",
  // never as a plausible-looking number. The previous payload asserted
  // "Fortress (> 25x)" interest coverage for every company, so the model
  // confidently explained a ratio that had never been measured.
  const NR = 'not reported';
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const pct = (v, dp = 1) => (n(v) === null ? NR : `${fixedDecimal((v * 100), dp)}%`);
  const pctRaw = (v, dp = 1) => (n(v) === null ? NR : `${fixedDecimal(v, dp)}%`);
  const mult = (v, dp = 2) => (n(v) === null ? NR : `${fixedDecimal(v, dp)}x`);
  const money = (v) => (n(v) === null ? NR : formatMoney(v, currency));
  const signed = (v, dp = 1) =>
    n(v) === null ? NR : `${v >= 0 ? '+' : ''}${fixedDecimal(v, dp)}%`;

  const checklistFormatted = (stock.checklist || []).map((c) => ({
    id: c.id,
    name: c.name,
    category: c.category,
    value: c.value,
    benchmark: c.benchmark,
    // 'na' means the measure is absent from the filings, not that it failed.
    status: c.status === 'na' ? 'not measurable from the filings' : c.status
  }));

  const pillarsFormatted = (stock.pillars || []).map((p) => ({
    name: p.name,
    score: p.score === null ? NR : `${p.score}/${p.max}`,
    measuresAvailable: `${p.measured} of ${p.of}`,
    // Flagged explicitly: a pillar scored on half its measures is a weaker
    // claim than the same number scored on all of them.
    partiallyMeasured: p.measured < p.of
  }));

  // Everything the engine had to infer, estimate or carry forward. Without
  // this the model presents a derived figure with the same confidence as a
  // filed one, which is the failure this whole app is built to avoid.
  const provenance = [];
  if (m.marketCapDerived) {
    provenance.push('Market capitalisation is price x filed share count — Yahoo did not report it.');
  }
  if (m.totalLiabilitiesDerived) {
    provenance.push('Total liabilities derived from assets minus equity — not separately filed.');
  }
  if (m.interestExpenseCarried && m.interestExpenseAsOf) {
    provenance.push(
      `Interest expense is the last figure the company filed, for ${m.interestExpenseAsOf}, ` +
      'carried forward because more recent years do not report it.'
    );
  }
  if (m.taxRateEstimated) {
    provenance.push(
      'Effective tax rate was not meaningful this year (loss-making or anomalous), ' +
      'so the 21% statutory rate was used for NOPAT.'
    );
  }
  if (m.betaClamped) {
    provenance.push(
      `Reported beta of ${m.beta} was clamped to the [0.6, 2.5] range before the WACC estimate. ` +
      'A trailing beta this far outside the range usually reflects a structural break in the ' +
      'regression window rather than genuine risk, and the unclamped figure would imply a cost ' +
      'of equity below government bonds. Treat the WACC as an estimate with wide error bars.'
    );
  }
  if (m.shareChangeIsAnnual === false && m.shareChangeYears) {
    provenance.push(
      `The share-count change spans ${m.shareChangeYears} fiscal years, not one — the ` +
      'intervening year is not filed. The annualised rate is the comparable figure.'
    );
  }
  if (pe.available && pe.scoreable === false) {
    provenance.push(
      `The P/E history covers only ${pe.months} months across ${pe.epsPeriods} profitable ` +
      'filed years, so it is too short to read as a valuation range and was excluded from ' +
      'scoring. Do not describe it as a five-year range or draw a percentile conclusion from it.'
    );
  }
  if (sum.coverage && sum.coverage.pct < 100) {
    provenance.push(
      `${sum.coverage.total - sum.coverage.measured} of ${sum.coverage.total} sub-scores ` +
      'could not be measured from the filings.'
    );
  }

  return {
    readMeFirst: {
      dataIntegrity:
        'Every figure below comes from filed statements or is derived from them. ' +
        '"not reported" means the company does not disclose that line item — do not ' +
        'estimate it, do not infer it from a peer, and do not describe it as strong or weak. ' +
        'Saying "the company does not disclose X" is a useful finding; inventing a figure is ' +
        'the one failure that makes this analysis worthless.',
      currencies: m.fx?.needed
        ? `The shares trade in ${m.tradedCurrency} at ${formatMoney(m.tradedPrice, m.tradedCurrency)}, ` +
          `but the company reports in ${currency}. Every figure below is in ${currency}, ` +
          `including the share price used for every ratio and the discounted-cash-flow ` +
          `comparison (${formatMoney(m.price, currency)}), converted at ` +
          `1 ${m.tradedCurrency} = ${m.fx.rate} ${currency}. When you quote a price to the ` +
          `reader, give the traded figure in ${m.tradedCurrency} and say the fundamentals are ` +
          `in ${currency}. Never mix the two in one comparison.`
        : `The shares trade and the company reports in the same currency, ${currency}.`,
      units:
        `All money figures are in ${currency}, the company's reporting currency, and are ` +
        'pre-formatted — quote them exactly as written and never convert them. Arrays under ' +
        'growthAndHistory are in BILLIONS of ' + currency + ' except the margin arrays, ' +
        'which are percentages, and dilutedSharesByYear, which is billions of shares.',
      asOf:
        `Today is ${new Date().toISOString().slice(0, 10)}. Market figures are live; ` +
        `fundamentals are as filed to ${m.fiscalPeriodEnd || 'an unstated period'}. ` +
        'Anything you say about the "current" position refers to those dates.',
      provenance: provenance.length
        ? provenance
        : ['Every figure below is filed data with no estimation or carry-forward.']
    },

    company: {
      ticker: stock.ticker,
      name: stock.name,
      sector: stock.sector || NR,
      industry: stock.industry || NR,
      businessModel: m.isFinancial
        ? 'Bank, insurer or REIT — working-capital ratios, gross margin and free-cash-flow valuation do not apply'
        : 'Operating company',
      reportingCurrency: currency,
      fiscalPeriodEnd: m.fiscalPeriodEnd || NR,
      tradedPrice: `${formatMoney(m.tradedPrice ?? stock.price, m.tradedCurrency || currency)} (as quoted)`,
      priceUsedForRatios: `${formatMoney(m.price, currency)} (reporting currency)`,
      changePercent: n(stock.change_pct) === null ? NR : signed(stock.change_pct, 2),
      marketCap: money(m.marketCap),
      sharesOutstanding: n(m.sharesOutstanding) === null
        ? NR
        : `${fixedDecimal((m.sharesOutstanding / 1e6), 1)}M shares`,
      enterpriseValue: money(m.enterpriseValue)
    },

    healthScoring: {
      compositeHealthScore:
        stock.health_score === null
          ? 'not scored — too few line items filed to form a composite'
          : `${stock.health_score}/100`,
      grade: sum.healthGrade || NR,
      label: sum.healthLabel || NR,
      measurementCoverage: sum.coverage
        ? `${sum.coverage.measured} of ${sum.coverage.total} sub-scores measurable (${sum.coverage.pct}%)`
        : NR,
      pillars: pillarsFormatted
    },

    incomeAndCashFlow: {
      revenue: money(m.revenue),
      grossProfit: money(stock.financials?.grossProfit),
      operatingIncome: money(stock.financials?.operatingIncome),
      ebit: money(m.ebit),
      ebitda: money(m.ebitda),
      netIncome: money(m.netIncome),
      // A material operating cost for a lender, even though the coverage
      // ratio built from it is not meaningful for one.
      interestExpense: money(m.interestExpense),
      operatingCashFlow: money(m.operatingCashFlow),
      capitalExpenditure: money(stock.financials?.capitalExpenditures),
      freeCashFlow: money(m.freeCashFlow),
      dilutedEPS: n(stock.financials?.dilutedEPS) === null
        ? NR
        : formatMoney(stock.financials.dilutedEPS, currency)
    },

    quantitativeKPIs: {
      altmanZScore: {
        score: n(stock.altman_z) === null ? NR : fixedDecimal(stock.altman_z, 2),
        zone:
          n(stock.altman_z) === null
            ? (m.isFinancial ? 'not defined for financial institutions' : NR)
            : stock.altman_z >= 3 ? 'safe zone'
            : stock.altman_z >= 1.8 ? 'grey zone'
            : 'distress zone'
      },
      piotroskiFScore: m.piotroski
        ? {
            raw: `${m.piotroski.score} of ${m.piotroski.testable} testable signals`,
            scaled: `${m.piotroski.normalised}/9`,
            note: m.piotroski.testable < 9
              ? `${9 - m.piotroski.testable} signal(s) could not be tested from the filings; ` +
                'the scaled figure is comparable with a full 9-signal score but rests on less evidence.'
              : 'all nine signals testable'
          }
        : NR,
      returnOnInvestedCapital: pctRaw(m.roic),
      estimatedWACC: pctRaw(m.wacc),
      roicSpreadOverWACC: n(m.roicSpread) === null ? NR : `${m.roicSpread >= 0 ? '+' : ''}${fixedDecimal(m.roicSpread, 1)} points`,
      returnOnEquity: pct(m.roe),
      returnOnAssets: pct(m.roa),
      assetTurnover: n(m.assetTurnover) === null ? NR : `${fixedDecimal(m.assetTurnover, 2)}x`,
      sectorMedianAssetTurnover: n(m.sectorMedianAssetTurnover) === null
        ? 'no sector peers cached for comparison'
        : `${fixedDecimal(m.sectorMedianAssetTurnover, 2)}x`,
      freeCashFlowConversion: n(stock.fcf_conversion_pct) === null ? NR : `${stock.fcf_conversion_pct}% of net income`,
      grossMargin: pct(m.grossMargin),
      operatingMargin: pct(m.operatingMargin),
      freeCashFlowMargin: pct(m.fcfMargin),
      effectiveTaxRate: m.taxRateEstimated ? `${NR} (statutory 21% assumed)` : pct(m.effectiveTaxRate)
    },

    balanceSheet: {
      cashAndShortTermInvestments: money(m.cash),
      totalDebt: money(m.totalDebt),
      netPosition:
        n(m.netCash) === null ? NR
          : m.netCash >= 0 ? `${money(m.netCash)} net cash`
          : `${money(Math.abs(m.netCash))} net debt`,
      shareholderEquity: m.negativeEquity ? 'negative book equity' : money(m.equity),
      totalLiabilities: money(m.totalLiabilities),
      workingCapital: money(m.workingCapital),
      currentRatio: n(m.currentRatio) === null ? NR : fixedDecimal(m.currentRatio, 2),
      quickRatio: n(m.quickRatio) === null ? NR : fixedDecimal(m.quickRatio, 2),
      debtToEquity: m.negativeEquity ? 'undefined — book equity is negative' : mult(m.debtToEquity),
      netDebtToEbitda: mult(m.netDebtToEbitda),
      equityToAssets: pct(m.equityToAssets),
      interestCoverage: m.interestCoverageUnburdened
        ? 'no debt burden to cover'
        : n(m.interestCoverage) === null ? NR : `${fixedDecimal(m.interestCoverage, 1)}x`
    },

    valuation: {
      trailingPE: mult(r.pe, 1),
      forwardPE: mult(r.forwardPE, 1),
      pegRatio: n(r.peg) === null ? NR : r.peg <= 0 ? 'undefined — expected growth is negative' : mult(r.peg),
      priceToBook: mult(r.priceToBook),
      dividendYield: pct(r.dividendYield, 2),
      dividendPayoutOfFreeCashFlow: pct(m.dividendPayoutOnFcf),
      consecutiveDividendYears: n(m.dividendStreakYears) === null || m.dividendStreakYears === 0
        ? 'no dividend paid in the filed years'
        : `${m.dividendStreakYears}`,
      freeCashFlowYield: pct(m.fcfYield, 2),
      evToFreeCashFlowYield: pct(m.evToFcfYield, 2),
      // Reported with its true span. Saying "five-year range" for eighteen
      // months of trough-earnings multiples is exactly the kind of confident
      // wrong statement the integrity rule above exists to prevent.
      priceEarningsVersusOwnHistory: pe.available
        ? {
            currentMultiple: `${pe.current}x`,
            historyCovers: `${pe.months} months across ${pe.epsPeriods} profitable filed years`,
            range: `${pe.min}x to ${pe.max}x, median ${pe.median}x`,
            percentileOfOwnHistory: `${pe.percentile}th`,
            usableAsAValuationRange: pe.scoreable === true,
            caution: pe.scoreable === true
              ? null
              : 'Too short to be a valuation range. A low percentile here reflects earnings ' +
                'recovering off a trough, not a multiple compressing. Do not present it as a ' +
                'five-year range or draw a cheapness conclusion from it.'
          }
        : `not available — ${pe.reason || 'insufficient history'}`,
      dcfFairValue: dcf.applicable
        ? `${formatMoney(dcf.fairValue, currency)} per share`
        : `not modelled (${dcf.reason || 'inputs unavailable'})`,
      dcfAssumptions: dcf.applicable
        ? {
            cashFlowBase: `${formatMoney(dcf.assumptions.cashFlowBase, currency)} — ${dcf.assumptions.cashFlowBasis}`,
            latestFiledCashFlow: money(dcf.assumptions.latestFiledCashFlow),
            growth: `${fixedDecimal((dcf.assumptions.growthRate * 100), 1)}% a year for 5 years — ${dcf.assumptions.growthBasis}`,
            terminalMultiple: `${dcf.assumptions.terminalMultiple}x on year-5 free cash flow`,
            discountRate: `${fixedDecimal((dcf.assumptions.discountRate * 100), 1)}%`
          }
        : NR,
      // The rate that would reconcile the model with the traded price. Where
      // the two disagree sharply this is the more informative number, and the
      // model should reason from it rather than declaring the market wrong.
      growthRateImpliedByMarketPrice: n(dcf.impliedGrowthRate) === null
        ? NR
        : `${fixedDecimal((dcf.impliedGrowthRate * 100), 1)}% a year`,
      modelVersusMarket: dcf.divergenceWarning
        ? `The modelled fair value is ${dcf.divergenceFactor}x the traded price. A gap this wide ` +
          'usually means the assumptions need revisiting or the market is pricing in something ' +
          'the filings do not show. Say so plainly rather than presenting it as free money.'
        : 'The model and the market are within a normal range of each other.',
      marginOfSafety:
        !dcf.applicable ? NR
          : n(dcf.marginOfSafetyPct) === null ? NR
          : dcf.marginOfSafetyPct >= 0
            ? `trading ${dcf.marginOfSafetyPct}% below the modelled fair value`
            : `trading ${dcf.premiumToFairValuePct}% above the modelled fair value`
    },

    growthAndHistory: {
      unitsNote:
        'Units are in each key name. A null means the company did not report that line that ' +
        'year — there is no padding or extrapolation anywhere in these arrays.',
      fiscalYears: hist.periods || [],
      // The unit is carried in the key rather than in a note: a model reading
      // an array of -8.9 alongside dollar figures elsewhere will otherwise
      // describe a -8.9% operating margin as "negative $8.9M".
      [`revenueByYear_billions${currency}`]: hist.revenue || [],
      [`freeCashFlowByYear_billions${currency}`]: hist.freeCashFlow || [],
      [`netIncomeByYear_billions${currency}`]: hist.netIncome || [],
      grossMarginByYear_percent: hist.grossMarginPct || [],
      operatingMarginByYear_percent: hist.operatingMarginPct || [],
      dilutedSharesByYear_billionsOfShares: hist.sharesOutstanding || [],
      [`dilutedEPSByYear_${currency}perShare`]: hist.dilutedEPS || [],
      revenueCAGR: n(m.revenueCAGR) === null ? NR : `${fixedDecimal((m.revenueCAGR * 100), 1)}% over ${m.cagrYears} years`,
      epsCAGR: n(m.epsCAGR) === null
        ? `${NR} (undefined when the series crosses zero)`
        : `${fixedDecimal((m.epsCAGR * 100), 1)}%`,
      fcfPerShareCAGR: n(m.fcfPerShareCAGR) === null
        ? `${NR} (undefined when the series crosses zero)`
        : `${fixedDecimal((m.fcfPerShareCAGR * 100), 1)}%`,
      shareCountChange: n(m.shareChangeYoY) === null
        ? NR
        : `${fixedDecimal((m.shareChangeYoY * 100), 1)}% over ${m.shareChangeYears || 1} fiscal ` +
          `year${(m.shareChangeYears || 1) === 1 ? '' : 's'} ` +
          `(${m.shareChangeAnnualisedPct >= 0 ? '+' : ''}${m.shareChangeAnnualisedPct}% a year), ` +
          `${m.shareChangeYoY < 0 ? 'buybacks' : 'dilution'}`,
      freeCashFlowPositiveYears: `${m.fcfPositiveYears} of ${m.fcfReportedYears} filed years`,
      grossMarginTrend: m.quarterlyGrossMarginTrend
        ? `${m.quarterlyGrossMarginTrend.changeBps >= 0 ? '+' : ''}${m.quarterlyGrossMarginTrend.changeBps} bps across ` +
          `${m.quarterlyGrossMarginTrend.quarters} filed quarters ` +
          `(${m.quarterlyGrossMarginTrend.margins.join('% -> ')}%)`
        : n(m.grossMarginChangeBps) === null ? NR : `${m.grossMarginChangeBps >= 0 ? '+' : ''}${m.grossMarginChangeBps} bps year on year`,
      operatingMarginTrend: n(m.operatingMarginChangeBps) === null
        ? NR
        : `${m.operatingMarginChangeBps >= 0 ? '+' : ''}${m.operatingMarginChangeBps} bps year on year`
    },

    twelvePointChecklist: {
      summary: sum.checklistSummary || {},
      items: checklistFormatted
    },

    systemGeneratedFlags: {
      note:
        'These fire on fixed thresholds and are not an exhaustive assessment. An empty risk ' +
        'list means no threshold tripped, NOT that the company carries no risks — derive ' +
        'those yourself from the data above.',
      catalysts: (stock.catalysts || []).map((c) => c.title + ': ' + c.text),
      risks: (stock.risks || []).map((c) => c.title + ': ' + c.text)
    },

    userInvestmentThesis: thesis
      ? {
          conviction: thesis.conviction,
          targetBuyPrice: thesis.target_buy_price
            ? formatMoney(thesis.target_buy_price, currency)
            : null,
          coreRationale: thesis.core_rationale,
          sellGuardrails: thesis.sell_triggers_json ? JSON.parse(thesis.sell_triggers_json) : []
        }
      : 'The user has not written a thesis for this company yet.'
  };
}

/**
 * Structured-output schema.
 *
 * Gemini enforces this server-side, so the shape, the enums and the array
 * bounds are guaranteed rather than requested. It also removes ~800 tokens of
 * inline JSON-shape prose from every call, and it is the reason the prompt
 * below can talk about analysis instead of formatting.
 */
export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    verdict: { type: 'STRING' },
    verdictGrade: {
      type: 'STRING',
      enum: [
        'PRISTINE_MOAT', 'SOLID_COMPOUNDER', 'VALUATION_WATCH',
        'CYCLICAL_LEVERAGE', 'DISTRESS_RISK', 'INSUFFICIENT_DATA'
      ]
    },
    verdictBadge: { type: 'STRING' },
    buffettPrinciple: { type: 'STRING' },
    executiveSummary: { type: 'STRING' },
    moatAndProfitability: {
      type: 'OBJECT',
      properties: {
        rating: { type: 'STRING', enum: ['WIDE_MOAT', 'NARROW_MOAT', 'NO_MOAT', 'NOT_ASSESSABLE'] },
        ratingLabel: { type: 'STRING' },
        explanation: { type: 'STRING' }
      },
      required: ['rating', 'ratingLabel', 'explanation']
    },
    solvencyAndSafety: {
      type: 'OBJECT',
      properties: {
        rating: { type: 'STRING', enum: ['FORTRESS', 'SOLID', 'MODERATE', 'DISTRESSED', 'NOT_ASSESSABLE'] },
        ratingLabel: { type: 'STRING' },
        explanation: { type: 'STRING' }
      },
      required: ['rating', 'ratingLabel', 'explanation']
    },
    valuationAndDCF: {
      type: 'OBJECT',
      properties: {
        rating: {
          type: 'STRING',
          enum: ['ATTRACTIVE_DISCOUNT', 'FAIRLY_VALUED', 'RICH_PREMIUM', 'HIGH_RISK_BUBBLE', 'NOT_ASSESSABLE']
        },
        ratingLabel: { type: 'STRING' },
        explanation: { type: 'STRING' }
      },
      required: ['rating', 'ratingLabel', 'explanation']
    },
    keyStrengths: {
      type: 'ARRAY',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, detail: { type: 'STRING' } },
        required: ['title', 'detail']
      }
    },
    keyRisks: {
      type: 'ARRAY',
      minItems: 2,
      maxItems: 3,
      items: {
        type: 'OBJECT',
        properties: { title: { type: 'STRING' }, detail: { type: 'STRING' } },
        required: ['title', 'detail']
      }
    },
    // Kept apart from everything else so the interface can label it. The model
    // knows things the filings do not contain — why margins collapsed, who the
    // competitors are — and that context is the most valuable thing it adds.
    // But it is recall, not measurement, and the reader must be able to tell.
    contextFromModelKnowledge: {
      type: 'OBJECT',
      properties: {
        hasContext: { type: 'BOOLEAN' },
        asOfCaveat: { type: 'STRING' },
        points: {
          type: 'ARRAY',
          maxItems: 4,
          items: {
            type: 'OBJECT',
            properties: {
              claim: { type: 'STRING' },
              confidence: { type: 'STRING', enum: ['HIGH', 'MEDIUM', 'LOW'] }
            },
            required: ['claim', 'confidence']
          }
        }
      },
      required: ['hasContext', 'points']
    },
    dataLimitations: { type: 'ARRAY', maxItems: 4, items: { type: 'STRING' } },
    conclusion: { type: 'STRING' },
    buyZone: {
      type: 'OBJECT',
      properties: {
        // Numeric so the interface can compare it with the live price rather
        // than parsing prose like "Under $125.00 for 15%+ Margin of Safety".
        maxPrice: { type: 'NUMBER' },
        // Named explicitly because the two can differ: a buy zone quoted in
        // the trading currency against a fair value computed in the reporting
        // one is not a comparison, it is a category error.
        currency: { type: 'STRING' },
        impliedDiscountToFairValuePct: { type: 'NUMBER' },
        alreadyInZone: { type: 'BOOLEAN' },
        perspective: { type: 'STRING' }
      },
      required: ['maxPrice', 'currency', 'alreadyInZone', 'perspective']
    },
    whatToWatch: { type: 'ARRAY', minItems: 2, maxItems: 4, items: { type: 'STRING' } }
  },
  required: [
    'verdict', 'verdictGrade', 'verdictBadge', 'buffettPrinciple', 'executiveSummary',
    'moatAndProfitability', 'solvencyAndSafety', 'valuationAndDCF',
    'keyStrengths', 'keyRisks', 'contextFromModelKnowledge', 'dataLimitations',
    'conclusion', 'buyZone', 'whatToWatch'
  ],
  propertyOrdering: [
    'verdict', 'verdictGrade', 'verdictBadge', 'buffettPrinciple', 'executiveSummary',
    'moatAndProfitability', 'solvencyAndSafety', 'valuationAndDCF',
    'keyStrengths', 'keyRisks', 'contextFromModelKnowledge', 'dataLimitations',
    'conclusion', 'buyZone', 'whatToWatch'
  ]
};

/**
 * The instruction text sent alongside the data package.
 *
 * Exported so it can be rendered and read on its own — `npm run prompt`
 * prints exactly what the model receives for a given ticker. A prompt that
 * can only be read by reverse-engineering the code is a prompt nobody
 * reviews.
 */
export function buildPrompt(stock, thesis = null) {
  const payloadData = buildComprehensivePayload(stock, thesis);
  return `
You are a fundamental equity analyst working in the tradition of Buffett, Munger
and Graham: business quality first, price second, and an unflinching account of
what you do not know.

Company: ${stock.name} (${stock.ticker})
Sector / industry: ${stock.sector || 'not reported'} - ${stock.industry || 'not reported'}

## How to use the data package

Read readMeFirst before anything else. It states the reporting currency, the
units of every array, the dates the figures refer to, and — most importantly —
a provenance list of everything that was derived, estimated, carried forward or
clamped rather than filed.

Three rules follow from it, in order of importance:

1. NEVER INVENT A NUMBER. A field reading "not reported" is absent from this
   company's filings. Do not estimate it, do not borrow a peer's, do not call it
   strong or weak. "The company does not disclose X" is a finding worth stating.

2. HONOUR THE PROVENANCE NOTES. Where readMeFirst.provenance says a figure was
   derived, carried forward, clamped or excluded, treat it with that caveat and
   say so where it matters to the conclusion. If a note tells you not to draw a
   particular inference, do not draw it, even if the underlying number is right
   there. Notably: where the P/E history is marked unusable, a low percentile
   reflects earnings recovering off a trough, not a multiple compressing.

3. SEPARATE MEASUREMENT FROM RECALL. Everything in the package is measured. You
   also know things about this company that are not in it — why margins moved,
   who it competes with, what its regulatory or end-market situation is — and
   that context is genuinely valuable, often the most valuable thing you add.
   But it is recall, with a training cutoff, and the reader must be able to tell
   it apart. So: put every claim that is not derivable from the package into
   contextFromModelKnowledge, each with an honest confidence rating, and keep it
   out of the other fields. Do not smuggle unsourced narrative into the
   executive summary or the ratings.

## What makes this analysis good

- Interpret; do not narrate. The reader is looking at these numbers on the
  screen already. Tell them what the numbers mean together, which ones are load
  bearing, and which ones would change your mind. A paragraph that restates
  revenue, margin and cash in sequence has added nothing.
- Weigh the evidence honestly. A pillar marked partiallyMeasured is a weaker
  claim than a fully measured one. Say so. Where the composite score is "not
  scored", do not substitute a grade of your own — set verdictGrade to
  INSUFFICIENT_DATA, explain which measures were missing, and analyse what can
  be analysed.
- systemGeneratedFlags fire on fixed thresholds and are not exhaustive. An empty
  risk list means nothing tripped, not that the company is safe. Derive the real
  risks yourself.
- Quote money figures exactly as formatted in the package, in the company's own
  reporting currency. Never convert, never re-denominate in dollars.
- Fill dataLimitations with the specific things that constrain your confidence
  here — drawn from the provenance list and the unmeasured items — not with
  generic disclaimers.
- buyZone.maxPrice is a number in the REPORTING currency, and buyZone.currency
  must name that currency. Compare it against priceUsedForRatios, not against
  the traded price, and make the perspective text state both figures where the
  two currencies differ. A buy zone in one currency compared against a price in
  another is a category error, not a conclusion.
- Write plainly. No filler, no hedging for its own sake, no restating the
  question. Assume a reader who understands accounting and wants judgement.

## Data package

${JSON.stringify(payloadData, null, 2)}
`.trim();
}
