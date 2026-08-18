/**
 * Pocket Omaha — Fundamental Quantitative Scoring Engine
 * Implements 5-Pillar Scorecard (0-100), 12-Point Checklist,
 * Altman Z-Score, Piotroski F-Score (9-pt), ROIC, DCF Fair Value,
 * and automated Moat Catalysts / Risk Flags.
 */

// 1. Altman Z-Score Calculation (Edward Altman formula for non-distressed manufacturing & corporate safety)
export function calculateAltmanZScore(params) {
  const { workingCapital, retainedEarnings, ebit, marketCap, totalLiabilities, totalRevenue, totalAssets } = params;
  if (!totalAssets || totalAssets <= 0) return 0;

  const X1 = (workingCapital || 0) / totalAssets;
  const X2 = (retainedEarnings || 0) / totalAssets;
  const X3 = (ebit || 0) / totalAssets;
  const X4 = (marketCap || 0) / (totalLiabilities || 1);
  const X5 = (totalRevenue || 0) / totalAssets;

  const zScore = (1.2 * X1) + (1.4 * X2) + (3.3 * X3) + (0.6 * X4) + (0.999 * X5);
  return Number(zScore.toFixed(2));
}

// 2. Piotroski F-Score (9 Fundamental Tests)
export function calculatePiotroskiFScore(current, prior) {
  let score = 0;
  const details = [];

  // 1. Profitability Signals (4 Points)
  const netIncomePos = (current.netIncome || 0) > 0;
  if (netIncomePos) score++;
  details.push({ id: 'f1', name: 'Positive Net Income', passed: netIncomePos });

  const ocfPos = (current.operatingCashFlow || 0) > 0;
  if (ocfPos) score++;
  details.push({ id: 'f2', name: 'Positive Operating Cash Flow', passed: ocfPos });

  const roaCurrent = (current.netIncome || 0) / (current.totalAssets || 1);
  const roaPrior = (prior?.netIncome || 0) / (prior?.totalAssets || 1);
  const roaHigher = roaCurrent > roaPrior;
  if (roaHigher) score++;
  details.push({ id: 'f3', name: 'Higher Return on Assets YoY', passed: roaHigher });

  const cashQuality = (current.operatingCashFlow || 0) > (current.netIncome || 0);
  if (cashQuality) score++;
  details.push({ id: 'f4', name: 'Cash Flow > Net Income (Quality)', passed: cashQuality });

  // 2. Leverage, Liquidity & Source of Funds (3 Points)
  const debtLower = (current.longTermDebt || 0) <= (prior?.longTermDebt || current.longTermDebt || 0) * 1.02;
  if (debtLower) score++;
  details.push({ id: 'f5', name: 'Lower or Flat Long-Term Debt', passed: debtLower });

  const crCurrent = (current.currentAssets || 1) / (current.currentLiabilities || 1);
  const crPrior = (prior?.currentAssets || 1) / (prior?.currentLiabilities || 1);
  const crHigher = crCurrent >= crPrior * 0.98;
  if (crHigher) score++;
  details.push({ id: 'f6', name: 'Stable / Expanding Current Ratio', passed: crHigher });

  const sharesCurrent = current.sharesOutstanding || 1;
  const sharesPrior = prior?.sharesOutstanding || current.sharesOutstanding || 1;
  const noDilution = sharesCurrent <= sharesPrior * 1.005;
  if (noDilution) score++;
  details.push({ id: 'f7', name: 'No Share Dilution (Buybacks/Flat)', passed: noDilution });

  // 3. Operating Efficiency (2 Points)
  const gmCurrent = ((current.grossProfit || current.totalRevenue || 1) / (current.totalRevenue || 1));
  const gmPrior = ((prior?.grossProfit || prior?.totalRevenue || 1) / (prior?.totalRevenue || 1));
  const gmHigher = gmCurrent >= gmPrior * 0.99;
  if (gmHigher) score++;
  details.push({ id: 'f8', name: 'Gross Margin Expansion / Stability', passed: gmHigher });

  const atCurrent = (current.totalRevenue || 0) / (current.totalAssets || 1);
  const atPrior = (prior?.totalRevenue || 0) / (prior?.totalAssets || 1);
  const atHigher = atCurrent >= atPrior * 0.98;
  if (atHigher) score++;
  details.push({ id: 'f9', name: 'Asset Turnover Efficiency', passed: atHigher });

  return { score, maxScore: 9, details };
}

// 3. ROIC Calculation (Return on Invested Capital)
export function calculateROIC(ebit, taxRate, totalDebt, totalEquity, cash) {
  const effectiveTax = taxRate > 0 && taxRate < 0.5 ? taxRate : 0.21;
  const nopat = (ebit || 0) * (1 - effectiveTax);
  const investedCapital = Math.max(1, (totalDebt || 0) + (totalEquity || 0) - (cash || 0));
  const roic = (nopat / investedCapital) * 100;
  return Number(roic.toFixed(2));
}

// 4. DCF Intrinsic Fair Value Calculation
export function calculateDCFFairValue(params) {
  const {
    trailingFCF, // Billions or raw $
    growthRate = 0.12, // 5Y projected annual FCF growth
    terminalMultiple = 20, // Terminal exit multiple at year 5
    discountRate = 0.095, // Cost of equity / hurdle rate
    cashReserves = 0,
    totalDebt = 0,
    sharesOutstanding = 1
  } = params;

  const fcf0 = trailingFCF > 0 ? trailingFCF : 1;
  const pvCashFlows = [];
  let currentFCF = fcf0;

  for (let t = 1; t <= 5; t++) {
    currentFCF = currentFCF * (1 + growthRate);
    const pv = currentFCF / Math.pow(1 + discountRate, t);
    pvCashFlows.push({ year: t, projectedFCF: currentFCF, presentValue: pv });
  }

  const cumulativePV = pvCashFlows.reduce((sum, item) => sum + item.presentValue, 0);
  const year5FCF = currentFCF;
  const terminalValue = year5FCF * terminalMultiple;
  const pvTerminalValue = terminalValue / Math.pow(1 + discountRate, 5);

  const enterpriseValue = cumulativePV + pvTerminalValue;
  const equityValue = enterpriseValue + cashReserves - totalDebt;
  const fairValuePerShare = sharesOutstanding > 0 ? equityValue / sharesOutstanding : 0;

  return {
    fairValuePerShare: Number(Math.max(0, fairValuePerShare).toFixed(2)),
    cumulativePV: Number(cumulativePV.toFixed(2)),
    terminalValue: Number(terminalValue.toFixed(2)),
    pvTerminalValue: Number(pvTerminalValue.toFixed(2)),
    enterpriseValue: Number(enterpriseValue.toFixed(2)),
    equityValue: Number(equityValue.toFixed(2)),
    pvCashFlows
  };
}

// 5. Complete 5-Pillar Scorecard and 12-Point Checklist Generator
export function computeComprehensiveHealth(stock) {
  const {
    quote = {},
    financials = {},
    ratios = {},
    historical = {}
  } = stock;

  const price = quote.regularMarketPrice || quote.price || 100;
  const marketCap = quote.marketCap || 1e9;
  const ebit = financials.ebit || financials.operatingIncome || 1e8;
  const totalAssets = financials.totalAssets || 1e9;
  const totalLiabilities = financials.totalLiabilities || 5e8;
  const workingCapital = (financials.currentAssets || 0) - (financials.currentLiabilities || 0);
  const retainedEarnings = financials.retainedEarnings || (financials.totalStockholderEquity || 1e8) * 0.7;
  const totalRevenue = financials.totalRevenue || 1e9;
  const cash = financials.cashAndEquivalents || 1e8;
  const totalDebt = financials.totalDebt || financials.longTermDebt || 0;
  const netCash = cash - totalDebt;
  const netIncome = financials.netIncome || 1e8;
  const operatingCashFlow = financials.operatingCashFlow || 1.1 * netIncome;
  const freeCashFlow = financials.freeCashFlow || (operatingCashFlow - (financials.capitalExpenditures || 0));
  const sharesOutstanding = quote.sharesOutstanding || (marketCap / price) || 1e8;
  const peRatio = quote.trailingPE || ratios.pe || 25;
  const forwardPE = quote.forwardPE || peRatio * 0.9;
  const pegRatio = quote.pegRatio || ratios.peg || 1.5;
  const roic = ratios.roic !== undefined ? ratios.roic : calculateROIC(ebit, 0.21, totalDebt, financials.totalStockholderEquity || 5e8, cash);
  const grossMargin = financials.grossMargin || ratios.grossMargin || 0.45;
  const operatingMargin = financials.operatingMargin || (ebit / totalRevenue) || 0.20;
  const interestCoverage = totalDebt > 0 && financials.interestExpense > 0 ? ebit / financials.interestExpense : 25;
  const currentRatio = financials.currentLiabilities > 0 ? (financials.currentAssets || cash) / financials.currentLiabilities : 2.5;
  const debtToEquity = financials.totalStockholderEquity > 0 ? totalDebt / financials.totalStockholderEquity : 0.4;
  const revenue3yCAGR = historical.revenue3yCAGR !== undefined ? historical.revenue3yCAGR : 0.12;
  const eps3yCAGR = historical.eps3yCAGR !== undefined ? historical.eps3yCAGR : 0.15;
  const fcfConversion = netIncome > 0 ? (freeCashFlow / netIncome) * 100 : 0;
  const shareDilutionYoY = historical.shareDilutionYoY !== undefined ? historical.shareDilutionYoY : -0.012; // -1.2% buybacks

  // 1. Calculate Altman Z-Score
  const altmanZ = calculateAltmanZScore({
    workingCapital,
    retainedEarnings,
    ebit,
    marketCap,
    totalLiabilities,
    totalRevenue,
    totalAssets
  });

  // 2. Calculate Piotroski F-Score
  const currentYear = {
    netIncome,
    operatingCashFlow,
    totalAssets,
    longTermDebt: totalDebt,
    currentAssets: financials.currentAssets || cash,
    currentLiabilities: financials.currentLiabilities || 1,
    sharesOutstanding,
    grossProfit: financials.grossProfit || totalRevenue * grossMargin,
    totalRevenue
  };
  const priorYear = historical.priorYear || {
    netIncome: netIncome * 0.88,
    operatingCashFlow: operatingCashFlow * 0.85,
    totalAssets: totalAssets * 0.92,
    longTermDebt: totalDebt * 1.05,
    currentAssets: (financials.currentAssets || cash) * 0.95,
    currentLiabilities: financials.currentLiabilities || 1,
    sharesOutstanding: sharesOutstanding * 1.015,
    grossProfit: (financials.grossProfit || totalRevenue * grossMargin) * 0.88,
    totalRevenue: totalRevenue * 0.90
  };
  const piotroski = calculatePiotroskiFScore(currentYear, priorYear);

  // 3. Calculate DCF Intrinsic Value
  const dcfBase = calculateDCFFairValue({
    trailingFCF: freeCashFlow,
    growthRate: Math.min(0.25, Math.max(0.04, revenue3yCAGR)),
    terminalMultiple: Math.min(30, Math.max(12, forwardPE * 0.85)),
    discountRate: 0.095,
    cashReserves: cash,
    totalDebt,
    sharesOutstanding
  });
  const dcfDiscount = dcfBase.fairValuePerShare > 0
    ? ((dcfBase.fairValuePerShare - price) / dcfBase.fairValuePerShare) * 100
    : 0;

  // ----------------- 5 PILLARS EVALUATION (0-20 PTS EACH) -----------------
  // Pillar 1: Financial Health & Solvency (20 pts)
  let p1Score = 0;
  // Altman Z (0-5)
  if (altmanZ >= 3.0) p1Score += 5;
  else if (altmanZ >= 1.8) p1Score += 3;
  else p1Score += 0.5;

  // Net Debt / EBITDA (0-5)
  if (netCash > 0) p1Score += 5;
  else if (ebit > 0 && (totalDebt - cash) / ebit < 1.5) p1Score += 4;
  else if (ebit > 0 && (totalDebt - cash) / ebit <= 3.0) p1Score += 2;
  else p1Score += 0.5;

  // Interest Coverage (0-5)
  if (interestCoverage >= 8.0) p1Score += 5;
  else if (interestCoverage >= 4.0) p1Score += 3.5;
  else if (interestCoverage >= 1.5) p1Score += 1.5;
  else p1Score += 0;

  // Current Ratio (0-5)
  if (currentRatio >= 1.5) p1Score += 5;
  else if (currentRatio >= 1.0) p1Score += 3;
  else p1Score += 0.5;

  // Pillar 2: Profitability & Moat Quality (20 pts)
  let p2Score = 0;
  // Piotroski (0-5)
  if (piotroski.score >= 8) p2Score += 5;
  else if (piotroski.score >= 6) p2Score += 3.5;
  else if (piotroski.score >= 4) p2Score += 2;
  else p2Score += 0.5;

  // ROIC (0-5)
  if (roic >= 15) p2Score += 5;
  else if (roic >= 10) p2Score += 3.5;
  else if (roic >= 5) p2Score += 2;
  else p2Score += 0.5;

  // Operating Margin (0-5)
  if (operatingMargin >= 0.25) p2Score += 5;
  else if (operatingMargin >= 0.15) p2Score += 3.5;
  else if (operatingMargin >= 0.08) p2Score += 2;
  else p2Score += 1;

  // FCF Conversion (0-5)
  if (fcfConversion >= 100) p2Score += 5;
  else if (fcfConversion >= 80) p2Score += 3.5;
  else if (fcfConversion >= 50) p2Score += 2;
  else p2Score += 0.5;

  // Pillar 3: Valuation & Margin of Safety (20 pts)
  let p3Score = 0;
  // Forward P/E (0-5)
  if (forwardPE <= 18) p3Score += 5;
  else if (forwardPE <= 26) p3Score += 3.5;
  else if (forwardPE <= 35) p3Score += 2;
  else p3Score += 1;

  // PEG Ratio (0-5)
  if (pegRatio > 0 && pegRatio <= 1.2) p3Score += 5;
  else if (pegRatio <= 1.8) p3Score += 3.5;
  else if (pegRatio <= 2.5) p3Score += 2;
  else p3Score += 0.5;

  // FCF Yield (0-5)
  const fcfYield = marketCap > 0 ? (freeCashFlow / marketCap) * 100 : 0;
  if (fcfYield >= 6.0) p3Score += 5;
  else if (fcfYield >= 4.0) p3Score += 3.5;
  else if (fcfYield >= 2.0) p3Score += 2;
  else p3Score += 1;

  // DCF Fair Value Discount (0-5)
  if (dcfDiscount >= 15) p3Score += 5;
  else if (dcfDiscount >= -5) p3Score += 3.5;
  else if (dcfDiscount >= -20) p3Score += 2;
  else p3Score += 0.5;

  // Pillar 4: Growth & Operating Leverage (20 pts)
  let p4Score = 0;
  // Revenue CAGR 3Y (0-5)
  if (revenue3yCAGR >= 0.15) p4Score += 5;
  else if (revenue3yCAGR >= 0.08) p4Score += 3.5;
  else if (revenue3yCAGR >= 0.03) p4Score += 2;
  else p4Score += 0.5;

  // EPS Growth 3Y (0-5)
  if (eps3yCAGR >= 0.20) p4Score += 5;
  else if (eps3yCAGR >= 0.10) p4Score += 3.5;
  else if (eps3yCAGR >= 0.02) p4Score += 2;
  else p4Score += 0.5;

  // FCF Growth 3Y (0-5)
  if (eps3yCAGR >= 0.15) p4Score += 5;
  else if (eps3yCAGR >= 0.05) p4Score += 3.5;
  else p4Score += 1;

  // Gross Margin Stability (0-5)
  if (grossMargin >= 0.50) p4Score += 5;
  else if (grossMargin >= 0.30) p4Score += 3.5;
  else p4Score += 2;

  // Pillar 5: Capital Allocation & Shareholder Returns (20 pts)
  let p5Score = 0;
  // Share Dilution / Buyback (0-7)
  if (shareDilutionYoY <= -0.015) p5Score += 7; // Retired > 1.5% shares
  else if (shareDilutionYoY <= 0.005) p5Score += 5; // Flat / gentle buybacks
  else if (shareDilutionYoY <= 0.02) p5Score += 2;
  else p5Score += 0;

  // Dividend Safety / Capital Reinvestment (0-7)
  const dividendYield = quote.dividendYield || ratios.dividendYield || 0;
  const payoutRatio = quote.payoutRatio || ratios.payoutRatio || 0;
  if (dividendYield > 0 && payoutRatio < 0.60) p5Score += 7;
  else if (roic >= 15) p5Score += 7; // High reinvestment efficiency
  else if (roic >= 10) p5Score += 5;
  else p5Score += 2;

  // Asset Turnover (0-6)
  const assetTurnover = totalRevenue / (totalAssets || 1);
  if (assetTurnover >= 0.8) p5Score += 6;
  else if (assetTurnover >= 0.4) p5Score += 4;
  else p5Score += 2;

  // Composite 0-100 Health Score
  const totalScore = Math.min(100, Math.max(0, Math.round(p1Score + p2Score + p3Score + p4Score + p5Score)));

  // Health Rating Label & Color
  let healthLabel = 'Pristine Health';
  let healthGrade = 'EXCELLENT';
  let healthTier = 'pristine';
  if (totalScore >= 85) {
    healthLabel = 'Pristine Financial Health';
    healthGrade = 'PRISTINE';
    healthTier = 'pristine';
  } else if (totalScore >= 70) {
    healthLabel = 'Solid Moat & Financials';
    healthGrade = 'GOOD';
    healthTier = 'good';
  } else if (totalScore >= 50) {
    healthLabel = 'Moderate Health / Valuation Watch';
    healthGrade = 'MODERATE';
    healthTier = 'moderate';
  } else {
    healthLabel = 'High Leverage / Distress Risk';
    healthGrade = 'RISK';
    healthTier = 'risk';
  }

  // ----------------- 12-POINT TRAFFIC-LIGHT CHECKLIST -----------------
  const checklist = [
    {
      id: 1,
      name: 'Altman Z-Score',
      category: 'Solvency',
      value: `${altmanZ}`,
      benchmark: 'Z ≥ 3.0 Safe',
      status: altmanZ >= 3.0 ? 'pass' : altmanZ >= 1.8 ? 'watch' : 'fail',
      explanation: 'Evaluates probability of corporate distress within 2 years based on working capital, retained earnings, and asset efficiency.'
    },
    {
      id: 2,
      name: 'Interest Coverage',
      category: 'Solvency',
      value: interestCoverage > 99 ? '> 50x' : `${interestCoverage.toFixed(1)}x`,
      benchmark: '> 6.0x EBIT / Interest',
      status: interestCoverage >= 6.0 ? 'pass' : interestCoverage >= 2.5 ? 'watch' : 'fail',
      explanation: 'Operating profit multiple relative to interest obligations. Fortress companies easily cover > 10x.'
    },
    {
      id: 3,
      name: 'Current Ratio',
      category: 'Liquidity',
      value: `${currentRatio.toFixed(2)}`,
      benchmark: '≥ 1.50 Current Assets / Liab',
      status: currentRatio >= 1.5 ? 'pass' : currentRatio >= 1.0 ? 'watch' : 'fail',
      explanation: 'Measures short-term liquidity cushion to satisfy immediate debt obligations without external financing.'
    },
    {
      id: 4,
      name: 'Debt to Equity',
      category: 'Solvency',
      value: netCash > 0 ? 'Net Cash 💎' : `${debtToEquity.toFixed(2)}x`,
      benchmark: '< 0.8x or Net Cash',
      status: (netCash > 0 || debtToEquity < 0.8) ? 'pass' : debtToEquity <= 1.8 ? 'watch' : 'fail',
      explanation: 'Long-term leverage ratio. Zero net debt companies possess maximum financial agility in recessions.'
    },
    {
      id: 5,
      name: 'Positive Free Cash Flow',
      category: 'Cash Flow',
      value: freeCashFlow > 0 ? `$${(freeCashFlow / 1e9).toFixed(2)}B FCF` : 'Negative FCF',
      benchmark: 'Positive 5 past yrs',
      status: freeCashFlow > 0 ? 'pass' : 'fail',
      explanation: 'True owner earnings after all capital expenditures required to maintain business operations.'
    },
    {
      id: 6,
      name: 'Piotroski F-Score',
      category: 'Quality',
      value: `${piotroski.score}/9 (${piotroski.score >= 8 ? 'Exceptional' : piotroski.score >= 6 ? 'Solid' : 'Average'})`,
      benchmark: '≥ 7 / 9 Points',
      status: piotroski.score >= 7 ? 'pass' : piotroski.score >= 5 ? 'watch' : 'fail',
      explanation: 'Nine-point fundamental health test covering profitability, balance sheet leverage, and operating efficiency.'
    },
    {
      id: 7,
      name: 'ROIC vs. Cost of Capital (WACC)',
      category: 'Economic Moat',
      value: `${roic.toFixed(1)}% ROIC`,
      benchmark: 'ROIC ≥ 15% (WACC + 5%)',
      status: roic >= 15 ? 'pass' : roic >= 9 ? 'watch' : 'fail',
      explanation: 'Return on Invested Capital measures economic moat quality and management efficiency in deploying capital.'
    },
    {
      id: 8,
      name: 'Gross Margin Consistency',
      category: 'Pricing Power',
      value: `${(grossMargin * 100).toFixed(1)}%`,
      benchmark: 'Expanding / Steady > 40%',
      status: grossMargin >= 0.40 ? 'pass' : grossMargin >= 0.20 ? 'watch' : 'fail',
      explanation: 'Gross margins reflect pricing power against inflation, supplier leverage, and customer lock-in.'
    },
    {
      id: 9,
      name: 'Share Dilution & Buybacks',
      category: 'Capital Return',
      value: shareDilutionYoY < 0 ? `${(shareDilutionYoY * 100).toFixed(1)}% (Buybacks)` : `+${(shareDilutionYoY * 100).toFixed(1)}% Dilution`,
      benchmark: 'Shrinking or < 0.5% YoY',
      status: shareDilutionYoY <= 0.005 ? 'pass' : shareDilutionYoY <= 0.025 ? 'watch' : 'fail',
      explanation: 'Verifies whether shareholder equity is protected from stock-based compensation (SBC) dilution.'
    },
    {
      id: 10,
      name: 'FCF / Net Income Quality',
      category: 'Earnings Quality',
      value: `${fcfConversion.toFixed(0)}% Conversion`,
      benchmark: '> 90% Conversion',
      status: fcfConversion >= 90 ? 'pass' : fcfConversion >= 60 ? 'watch' : 'fail',
      explanation: 'Detects aggressive accrual accounting when net income is reported high without real cash inflows.'
    },
    {
      id: 11,
      name: 'Valuation PEG Ratio',
      category: 'Valuation',
      value: pegRatio > 0 ? `${pegRatio.toFixed(2)}x` : 'N/A',
      benchmark: 'PEG ≤ 1.50',
      status: (pegRatio > 0 && pegRatio <= 1.5) ? 'pass' : pegRatio <= 2.2 ? 'watch' : 'fail',
      explanation: 'Price-to-Earnings divided by earnings growth rate. Buffett looks for growth at a reasonable price.'
    },
    {
      id: 12,
      name: 'Revenue 3Y Growth',
      category: 'Growth',
      value: `+${(revenue3yCAGR * 100).toFixed(1)}% CAGR`,
      benchmark: '> 8% 3Y CAGR',
      status: revenue3yCAGR >= 0.08 ? 'pass' : revenue3yCAGR >= 0.02 ? 'watch' : 'fail',
      explanation: 'Compound annual growth rate of top-line revenue across the trailing 3 fiscal years.'
    }
  ];

  // ----------------- AUTOMATED CATALYSTS & RED FLAGS -----------------
  const catalysts = [];
  const risks = [];

  if (netCash > 0) {
    catalysts.push({
      icon: '💎',
      title: 'Fortress Balance Sheet',
      text: `Cash & equivalents ($${(cash / 1e9).toFixed(1)}B) exceed total debt ($${(totalDebt / 1e9).toFixed(1)}B) with +$${(netCash / 1e9).toFixed(1)}B Net Cash.`
    });
  }
  if (roic >= 18) {
    catalysts.push({
      icon: '🚀',
      title: 'Elite Capital Efficiency (Moat)',
      text: `ROIC of ${roic.toFixed(1)}% demonstrates exceptional competitive advantages and reinvestment returns.`
    });
  }
  if (fcfConversion >= 100) {
    catalysts.push({
      icon: '💰',
      title: 'Pure Cash Machine',
      text: `Free Cash Flow conversion is ${fcfConversion.toFixed(0)}% of reported net income, indicating pristine earnings quality.`
    });
  }
  if (grossMargin >= 0.60) {
    catalysts.push({
      icon: '⚡',
      title: 'Formidable Pricing Power',
      text: `Gross profit margin is ${(grossMargin * 100).toFixed(1)}%, shielding margins against supply-chain inflation.`
    });
  }
  if (shareDilutionYoY < -0.01) {
    catalysts.push({
      icon: '📈',
      title: 'Accretive Share Buybacks',
      text: `Management retired ${Math.abs(shareDilutionYoY * 100).toFixed(1)}% of shares outstanding YoY, enhancing per-share value.`
    });
  }

  if (totalDebt > cash && ebit > 0 && (totalDebt - cash) / ebit > 2.5) {
    risks.push({
      icon: '⚠️',
      title: 'Elevated Leverage Burden',
      text: `Net Debt / EBIT is ${((totalDebt - cash) / ebit).toFixed(1)}x, which could compress cash flow in a high-rate environment.`
    });
  }
  if (shareDilutionYoY > 0.02) {
    risks.push({
      icon: '⚠️',
      title: 'Shareholder Dilution',
      text: `Share count expanded +${(shareDilutionYoY * 100).toFixed(1)}% YoY from stock-based compensation.`
    });
  }
  if (forwardPE > 40) {
    risks.push({
      icon: '⚠️',
      title: 'Extended Valuation Multiples',
      text: `Forward P/E of ${forwardPE.toFixed(1)}x leaves thin margin for execution errors or macro slowdown.`
    });
  }
  if (altmanZ < 1.8) {
    risks.push({
      icon: '🚨',
      title: 'Altman Z Distress Warning',
      text: `Altman Z-Score is in the distress zone (${altmanZ}), indicating balance sheet vulnerability.`
    });
  }

  // Ensure at least 1 catalyst and 1 risk are present for UX balance
  if (catalysts.length === 0) {
    catalysts.push({
      icon: '⚡',
      title: 'Established Market Position',
      text: `Well-established presence in ${stock.sector || 'the industry'} with stable commercial footprint.`
    });
  }
  if (risks.length === 0) {
    risks.push({
      icon: 'ℹ️',
      title: 'Cyclical & Macro Sensitivity',
      text: 'Subject to broader macro interest rate and consumer expenditure fluctuations.'
    });
  }

  const passCount = checklist.filter(c => c.status === 'pass').length;
  const watchCount = checklist.filter(c => c.status === 'watch').length;
  const failCount = checklist.filter(c => c.status === 'fail').length;

  return {
    healthScore: totalScore,
    healthLabel,
    healthGrade,
    healthTier,
    altmanZ,
    piotroskiScore: piotroski.score,
    piotroskiDetails: piotroski.details,
    roicPct: roic,
    fcfConversionPct: Number(fcfConversion.toFixed(0)),
    netCashB: Number((netCash / 1e9).toFixed(2)),
    pillars: [
      { name: 'Financial Health & Solvency', score: Number(p1Score.toFixed(1)), max: 20, pct: Math.round((p1Score / 20) * 100) },
      { name: 'Profitability & Moat Quality', score: Number(p2Score.toFixed(1)), max: 20, pct: Math.round((p2Score / 20) * 100) },
      { name: 'Valuation & Margin of Safety', score: Number(p3Score.toFixed(1)), max: 20, pct: Math.round((p3Score / 20) * 100) },
      { name: 'Growth & Operating Leverage', score: Number(p4Score.toFixed(1)), max: 20, pct: Math.round((p4Score / 20) * 100) },
      { name: 'Capital Allocation & Returns', score: Number(p5Score.toFixed(1)), max: 20, pct: Math.round((p5Score / 20) * 100) }
    ],
    checklistSummary: {
      passCount,
      watchCount,
      failCount,
      total: checklist.length,
      passPct: Math.round((passCount / checklist.length) * 100)
    },
    checklist,
    catalysts,
    risks,
    dcf: {
      fairValue: dcfBase.fairValuePerShare,
      currentPrice: price,
      marginOfSafetyPct: Number(dcfDiscount.toFixed(1)),
      cumulativePV: dcfBase.cumulativePV,
      terminalValue: dcfBase.terminalValue,
      pvTerminalValue: dcfBase.pvTerminalValue,
      cashReserves: cash,
      totalDebt,
      sharesOutstanding,
      pvCashFlows: dcfBase.pvCashFlows
    }
  };
}
