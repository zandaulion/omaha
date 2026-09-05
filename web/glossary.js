// core/glossary.js
var MISSING_RULE = "A measure the filings do not contain is reported as unavailable and dropped from its pillar, so it neither helps nor hurts. It is never assumed to be zero.";
var GLOSSARY = {
  // ---------------------------------------------------------------- score
  "health-score": {
    title: "Health score",
    means: "One number from 0 to 100 summarising the five pillars below it: solvency, profitability, valuation, growth and capital allocation.",
    matters: "It is a starting point for a shortlist, not a verdict. Two companies scoring 70 can be strong in opposite ways, and the pillars are where that shows.",
    computes: "Each pillar is scored out of 20 and the five are added. Within a pillar, the score is rescaled over the items that could actually be measured. " + MISSING_RULE + " If too little of the scorecard can be measured at all, no composite is published rather than a confident number resting on three inputs."
  },
  // --------------------------------------------------------------- pillars
  "Financial Health & Solvency": {
    title: "Financial health & solvency",
    means: "Whether the business can pay what it owes, through a bad year as well as a good one.",
    matters: "Solvency is the pillar that decides whether the other four ever get to matter. A company that cannot refinance does not get the chance to compound.",
    computes: "For an ordinary company: Altman Z, net debt to EBITDA, interest cover and the liquidity ratios. For a bank none of those are defined \u2014 there is no working-capital cycle and no EBITDA \u2014 so the pillar rests on equity to assets instead. That makes it a single measure carrying twenty points, which is worth knowing when a bank scores badly here."
  },
  "Profitability & Moat Quality": {
    title: "Profitability & moat quality",
    means: "How much the business earns on the capital it employs, and whether the earnings are real cash.",
    matters: "A durable high return on capital is the clearest evidence of a moat. Anyone can grow revenue by buying it; earning well on what you already own is harder to copy.",
    computes: "Piotroski F-Score, plus return on invested capital for an ordinary company or return on equity for a lender \u2014 invested capital is not a meaningful denominator for a bank. Cash conversion is scored for ordinary companies only, because deposit and loan flows dominate a bank's cash flow and say nothing about its earnings quality."
  },
  "Valuation & Margin of Safety": {
    title: "Valuation & margin of safety",
    means: "What you are being asked to pay, against what the business appears to be worth.",
    matters: "This is the only pillar that prices the shares rather than judging the company. A wonderful business at a foolish price is still a foolish purchase.",
    computes: "Forward P/E against the company's own history, the PEG ratio, cash-flow yield on enterprise value for ordinary companies, and the discount to fair value. Where a fair-value model applies to the business but its inputs fail, that item scores half marks rather than being dropped \u2014 not knowing must not outscore knowing."
  },
  "Growth & Operating Leverage": {
    title: "Growth & operating leverage",
    means: "Whether revenue and earnings per share are rising, and whether margins widen as they do.",
    matters: "Growth is only worth paying for when it earns above the cost of the capital funding it. Growth that consumes cash at a poor return destroys value while looking impressive.",
    computes: "Compound growth in revenue and diluted earnings per share over the filed years. For ordinary companies, free cash flow per share and the gross margin trajectory as well. Per *share* throughout, so growth funded by issuing stock does not read as growth."
  },
  "Capital Allocation & Returns": {
    title: "Capital allocation & returns",
    means: "What management does with the money: buys back stock, pays it out, or reinvests it.",
    matters: "Over a decade this is often the largest single driver of per-share returns, and it is the decision most within management's control.",
    computes: "The annualised change in share count, dividend safety for a payer or reinvestment quality for a non-payer, and asset turnover against the sector median. Buybacks are annualised so a two-year reduction is not scored as if it happened in twelve months."
  },
  // ----------------------------------------------------- solvency measures
  "Altman Z-Score": {
    title: "Altman Z-Score",
    means: "A distress score built from working capital, retained earnings, operating profit and asset efficiency. Above 3.0 is safe ground; below 1.8 is the distress zone.",
    matters: "It has predicted bankruptcy two years out with reasonable accuracy since 1968, and it reads the balance sheet as a whole rather than one ratio at a time.",
    computes: "The classic five-factor formula. It is not defined for banks, insurers or REITs \u2014 their balance sheets have no working-capital cycle \u2014 so for those it is reported as not applicable rather than computed and shown as a low number."
  },
  "Equity to assets": {
    title: "Equity to assets",
    means: "The share of a lender's balance sheet funded by its own capital rather than by depositors and creditors.",
    matters: "It is the plain-language form of the regulatory leverage ratio, and the right solvency question to ask of a bank: how much can the asset side fall before the equity is gone.",
    computes: "Total equity divided by total assets, unweighted. Worth reading with care: regulators measure banks on *risk-weighted* capital, where a government bond counts for little and an unsecured loan for much. A universal bank with a large trading book will always look thinly capitalised on this unweighted measure next to a simple retail lender, even where the regulatory ratio says otherwise."
  },
  "Net debt / EBITDA": {
    title: "Net debt / EBITDA",
    means: "How many years of operating earnings it would take to repay borrowings, net of cash.",
    matters: "It is the covenant lenders most often write into loan agreements, so it approximates the constraint the company itself is managing to.",
    computes: "Borrowings less cash, over EBITDA. A company holding more cash than debt scores full marks outright rather than being ranked on a negative ratio that would sort backwards."
  },
  "Interest coverage": {
    title: "Interest coverage",
    means: "How many times over operating profit covers the interest bill.",
    matters: "It is the most direct measure of whether debt is currently affordable, and it deteriorates before a covenant breach rather than after one.",
    computes: "Operating profit over interest expense. A company with no borrowings at all scores full marks rather than dividing by zero."
  },
  "Current & quick ratio": {
    title: "Current & quick ratio",
    means: "Whether short-term assets cover short-term obligations \u2014 the quick ratio being the stricter version that excludes inventory.",
    matters: "A solvent company can still fail if it cannot meet the next twelve months of obligations. These two catch that.",
    computes: "Both are read, and both must be healthy for full marks: a comfortable current ratio built entirely on unsold inventory is not liquidity."
  },
  "Debt to Equity": {
    title: "Debt to equity",
    means: "Borrowings measured against shareholders' capital.",
    matters: "It says who really funds the business, and how much of the return is being amplified by leverage rather than earned by the operation.",
    computes: "Total debt over total equity. A company in a net cash position is treated as passing regardless of the ratio, since the borrowings are more than covered."
  },
  // ------------------------------------------------ profitability measures
  "Piotroski F-Score": {
    title: "Piotroski F-Score",
    means: "Nine pass-or-fail tests of whether the business improved on last year \u2014 profitability, leverage and operating efficiency, one point each.",
    matters: "It measures direction rather than level. A merely decent company getting better has historically outperformed an excellent one quietly deteriorating.",
    computes: "Scored over the tests that can actually be evaluated and reported as a fraction of those, so a company missing one input is not marked down for the gap. " + MISSING_RULE
  },
  "Return on invested capital": {
    title: "Return on invested capital",
    means: "After-tax operating profit as a percentage of the capital \u2014 debt and equity together \u2014 put into the business.",
    matters: "The single best summary of business quality. Sustained ROIC above the cost of capital is what compounding actually is; below it, growth destroys value.",
    computes: "NOPAT over invested capital. Read it next to the cost of capital rather than alone: 12% is excellent for a utility and poor for a software company."
  },
  "Return on equity": {
    title: "Return on equity",
    means: "Profit as a percentage of shareholders' capital.",
    matters: "For a bank this is the measure the industry and its investors actually use, because a lender's business *is* deploying its equity against a regulatory constraint.",
    computes: "Net income over total equity. Used in place of return on invested capital for financials, where invested capital is not a meaningful denominator \u2014 deposits are raw material, not funding to be earned on."
  },
  "Free cash flow conversion": {
    title: "Free cash flow conversion",
    means: "How much of reported net income arrives as actual cash.",
    matters: "Profit is an opinion and cash is a fact. Conversion persistently below 80% usually means earnings are being recognised well ahead of collection.",
    computes: "Free cash flow over net income. Not scored for banks: deposit and loan flows dominate a lender's cash flow, and a large negative figure there is funding movement rather than distress."
  },
  "Operating margin trend": {
    title: "Operating margin trend",
    means: "Which way the operating margin is moving, in basis points.",
    matters: "The direction says more than the level. A 25% margin compressing from 40% is a different business from one expanding towards 25%.",
    computes: "The change between the two most recent filed years. Scored on the trend, deliberately, rather than on the absolute margin."
  },
  "ROIC vs. Cost of Capital": {
    title: "ROIC vs. cost of capital",
    means: "The spread between what the business earns on its capital and what that capital costs.",
    matters: "This is the line between compounding and value destruction. Growth above the spread creates value; growth below it burns money impressively.",
    computes: "ROIC less a CAPM-derived weighted average cost of capital. Beta is clamped to a sensible range first \u2014 a trailing regression through a structural break can imply a cost of equity below government bonds, which would flatter the spread on arithmetic alone."
  },
  "Gross Margin Consistency": {
    title: "Gross margin consistency",
    means: "Whether the gross margin holds steady across years.",
    matters: "A stable gross margin through a cost shock is direct evidence of pricing power \u2014 the company passed the increase on. A wobbling one suggests it could not.",
    computes: "The spread of gross margin across the filed years. Not defined for banks, which report no gross profit line."
  },
  "Free Cash Flow History": {
    title: "Free cash flow history",
    means: "Whether the business has produced positive free cash flow consistently, or only in good years.",
    matters: "One strong year can be a working-capital release or a deferred investment. A record is much harder to fake.",
    computes: "Read across every filed year available, not just the most recent."
  },
  // -------------------------------------------------------- growth measures
  "Revenue CAGR": {
    title: "Revenue growth",
    means: "Compound annual growth in revenue across the filed years.",
    matters: "Revenue growth is the raw material for everything else, but on its own it is the least informative growth measure \u2014 it can be bought, and often is.",
    computes: "Compounded between the first and last filed year, so a single exceptional year does not set the rate."
  },
  "Diluted EPS CAGR": {
    title: "Diluted EPS growth",
    means: "Compound annual growth in earnings per share, counting all shares that could exist.",
    matters: "Per share is the number that reaches you. Earnings can rise while EPS falls, if the growth was funded by issuing stock.",
    computes: "On the diluted count, which includes options and convertibles, rather than the basic count."
  },
  "FCF per share CAGR": {
    title: "Free cash flow per share growth",
    means: "Compound growth in free cash flow, per share.",
    matters: "The strictest of the growth measures: it is cash, and it is per share, so neither accounting choices nor issuance can flatter it.",
    computes: "Not scored for banks \u2014 free cash flow is not a value driver for a lender."
  },
  "Gross margin trajectory": {
    title: "Gross margin trajectory",
    means: "Whether gross margin is widening or narrowing as the business grows.",
    matters: "Growth with widening margins is operating leverage. Growth with narrowing margins is often just discounting.",
    computes: "Quarterly where enough quarters are filed, annual otherwise."
  },
  // ----------------------------------------------------- valuation measures
  "Forward P/E vs. own history": {
    title: "Forward P/E vs. own history",
    means: "Today's forward earnings multiple against what this company has typically traded at.",
    matters: "Comparing a company to itself sidesteps the argument about which peer group is fair. A quality compounder always looks dear against the market and may be cheap against its own record.",
    computes: "Against the company's own multiple history, and only where the history is long enough to mean something. Where it is not, the raw forward multiple is scored instead."
  },
  "PEG ratio": {
    title: "PEG ratio",
    means: "The price-to-earnings multiple divided by the earnings growth rate. Around 1.0 is the traditional line between fair and expensive.",
    matters: "It is the simplest way to ask whether the multiple is justified by the growth, rather than judging either in isolation.",
    computes: "A negative PEG \u2014 which arises when earnings are shrinking \u2014 is excluded rather than scored as cheap. Shrinking earnings are a growth signal, not a valuation one, and scoring them as cheapness is how a declining business scores well."
  },
  "EV / free cash flow yield": {
    title: "EV / free cash flow yield",
    means: "Free cash flow as a percentage of enterprise value \u2014 the whole business, debt included.",
    matters: "It is the closest thing to an interest rate on the shares, and unlike the earnings yield it is hard to influence with accounting choices.",
    computes: "Not applied to banks. Enterprise value assumes debt funds the assets; for a lender deposits do, and the ratio stops describing anything."
  },
  "Discount to fair value": {
    title: "Discount to fair value",
    means: "How far today's price sits below \u2014 or above \u2014 what the model thinks the shares are worth.",
    matters: "It is the only item in the scorecard that prices the business rather than judging it. Everything else can be excellent and this one still say wait.",
    computes: "Which model runs depends on the balance sheet: banks and insurers get a return-on-tangible-equity model, ordinary companies get a discounted cash flow, and the rest of the financial sector gets neither and is told which reason applies. Where a model covers the business but its inputs fail, this scores half marks rather than dropping out \u2014 an untestable valuation must not outscore a tested one."
  },
  "Estimated Fair Value": {
    title: "Estimated fair value",
    means: "What the shares appear to be worth on the model's assumptions, per share.",
    matters: "Treat it as the midpoint of a wide range, not a target. Small changes in the growth and discount assumptions move it a long way.",
    computes: "For an ordinary company, a discounted cash flow with a terminal multiple. For a bank, Gordon growth on tangible book: the justified price-to-tangible-book is (return on tangible equity \u2212 growth) \xF7 (cost of equity \u2212 growth). The return used is the median across *every* filed year, crises included, because a lender's cycle includes its crises. Where a company has filed only a few years, that median is much weaker evidence than it looks \u2014 read the best-year and worst-year figures beside it."
  },
  "P/E Ratio": {
    title: "P/E ratio",
    means: "The share price divided by earnings per share.",
    matters: "The most quoted valuation measure and the least self-sufficient: it says nothing about growth, debt or earnings quality.",
    computes: "From the filed earnings and the current price. Read it against the company's own history rather than against the market."
  },
  "Current Price": {
    title: "Current price",
    means: "The last traded price, in the currency the shares trade in.",
    matters: "Where a company reports in a different currency from the one its shares trade in, mixing the two silently is how valuation errors happen.",
    computes: "Reported in the traded currency, and converted where a figure must be compared with statements filed in another."
  },
  "Net Cash": {
    title: "Net cash",
    means: "Cash and equivalents less total borrowings. Positive means the company holds more cash than debt.",
    matters: "Net cash is optionality: it funds a downturn, a buyback or an acquisition without asking anyone's permission.",
    computes: "Not reported for banks, where cash is inventory rather than a cushion \u2014 a lender's cash balance says nothing about its financial strength."
  },
  // -------------------------------------------------- capital allocation
  "Buybacks vs. dilution": {
    title: "Buybacks vs. dilution",
    means: "Whether the share count is falling or rising.",
    matters: "A rising count quietly transfers value from existing holders. A falling one is a dividend that is not taxed until you sell.",
    computes: "Annualised, so a reduction spanning more than one filing period is not scored as if it happened in a single year. Buybacks are not automatically good: repurchasing above intrinsic value destroys value just as issuing below it does."
  },
  "Dividend safety & coverage": {
    title: "Dividend safety & coverage",
    means: "Whether the dividend is comfortably covered by cash flow, and how long it has been sustained.",
    matters: "A cut is usually the confirmation of a problem that was visible in the coverage a year earlier.",
    computes: "Payout against free cash flow rather than against earnings, since the dividend is paid in cash. A dividend line the filings do not report is treated as unknown, not as zero."
  },
  "Reinvestment quality": {
    title: "Reinvestment quality",
    means: "For a company that pays no dividend, what it earns on the money it keeps.",
    matters: "Retaining everything is only the right decision if the returns justify it. Otherwise the cash would be worth more in the shareholder's hands.",
    computes: "Return on invested capital, used as the test for non-payers in place of dividend coverage."
  },
  "Asset turnover efficiency": {
    title: "Asset turnover efficiency",
    means: "Revenue generated per unit of assets.",
    matters: "It separates two ways of earning the same return: high margin on few assets, or thin margin on many.",
    computes: "Against the median of cached companies in the same sector, because a grocer and a software company are not comparable on turnover. That median moves as more companies are looked up, so the same company can score differently as the cache grows \u2014 and it is a weak measure for banks, whose asset base is a loan book rather than an operating one."
  },
  "Price / book": {
    title: "Price to book",
    means: "The share price measured against the accounting value of the company's net assets.",
    matters: "For a bank it is the central valuation measure, because the balance sheet largely *is* the business. For a software company it is close to meaningless \u2014 the assets that matter are not on it.",
    computes: "Price over book value per share, from the latest filing. Read it beside return on equity: below one is correct, not cheap, when the return sits under the cost of equity."
  },
  "Share count YoY": {
    title: "Share count, year on year",
    means: "How much the number of shares in issue has changed over the last year.",
    matters: "Everything else on this screen is per share. A rising count dilutes each of the other figures without any of them appearing to change.",
    computes: "On the diluted count where it is filed, so options and convertibles are included rather than counted only once exercised."
  },
  "Dividend yield": {
    title: "Dividend yield",
    means: "The annual dividend as a percentage of the current share price.",
    matters: "A high yield is as often a falling price as a generous payout. It is a starting question, not an answer.",
    computes: "From the trailing declared dividend and the current price. Read it with the payout coverage: a yield the cash flow does not support is a cut waiting to happen."
  },
  "Gross margin": {
    title: "Gross margin",
    means: "What is left of revenue after the direct cost of producing the goods or services.",
    matters: "It is the cleanest single indicator of pricing power, and the hardest line to improve by cost-cutting alone.",
    computes: "Gross profit over revenue. Not reported for banks, which file no gross profit line."
  },
  // -------------------------------------------------- DCF sandbox inputs
  "dcf-growth": {
    title: "Five-year free cash flow growth",
    means: "The rate you are assuming free cash flow compounds at over the next five years.",
    matters: "It is the assumption the answer is most sensitive to, and the one nobody can know. Moving it a few points moves the fair value a long way, which is the point of being able to move it yourself.",
    computes: "It seeds from the company's own recent growth rather than from an optimistic default, and the slider reaches below zero on purpose \u2014 a shrinking business should have its decline projected rather than be floored at flat."
  },
  "dcf-terminal-multiple": {
    title: "Terminal exit multiple",
    means: "What you assume the market pays for the business in year five, as a multiple of its cash flow then.",
    matters: "Usually more than half the answer comes from this single number, which makes a discounted cash flow far less scientific than it looks. Setting it near the company's own historical multiple is more honest than setting it where you would like the value to land.",
    computes: "Applied to the final projected year and discounted back at the rate below."
  },
  "dcf-discount-rate": {
    title: "Required discount rate",
    means: "The annual return you demand for taking the risk \u2014 your hurdle rate.",
    matters: "It expresses your own required return rather than a market fact. Raise it and everything looks expensive; lower it and everything looks cheap. Choose it once and hold it steady across companies, or the comparison stops meaning anything.",
    computes: "Every projected year and the terminal value are discounted back to today at this rate."
  },
  "bank-payout": {
    title: "Paid out as dividends",
    means: "The share of profit a bank hands to shareholders rather than retaining.",
    matters: "What is retained is what funds growth, so the payout sets the growth rate in the model rather than being cosmetic. A bank paying everything out cannot grow its book value from earnings.",
    computes: "Growth is taken as the return on tangible equity multiplied by the share retained, then capped. Where the filings report no dividend line the ratio is treated as unknown and defaults to half \u2014 reading an absent line as zero made Soci\xE9t\xE9 G\xE9n\xE9rale appear to retain everything and pushed growth to its cap on an assumption nobody filed."
  },
  // ------------------------------------------------------ model internals
  "return-on-tangible-equity": {
    title: "Return on tangible equity",
    means: "Profit as a percentage of tangible book value \u2014 equity with goodwill and intangibles removed.",
    matters: "It is the engine of a bank valuation. A lender earning above its cost of equity is worth more than its book value; one earning below it is worth less, however good the franchise sounds.",
    computes: "Computed per year against that year's own tangible equity, so a bank that raised or burned capital is not measured against a base it did not have at the time. The figure used for valuation is the median of every filed year. Where no filed year reports an intangibles line at all, tangible book is taken as book value."
  },
  "justified-ptbv": {
    title: "Justified price to tangible book",
    means: "The multiple of tangible book value the shares deserve, given what the bank earns and what its capital costs.",
    matters: "It explains why a bank trades below book without anything being wrong: if the return on equity is below the cost of equity, below book is the correct price.",
    computes: "(return on tangible equity \u2212 growth) \xF7 (cost of equity \u2212 growth). Gordon growth divides one small difference by another, so when the return sits near the growth rate a modest change in either moves the answer a long way \u2014 which is why the best-year and worst-year values are published beside it."
  },
  "margin-of-safety": {
    title: "Margin of safety",
    means: "The gap between the price and the estimated value, as a percentage of the value.",
    matters: "It is protection against being wrong, not a forecast of return. The wider the gap, the more the assumptions can be mistaken without costing money.",
    computes: "Where the price sits above fair value the figure is expressed as a premium instead, because the margin-of-safety form runs to \u2212188% and stops meaning anything."
  },
  "implied-growth": {
    title: "Implied growth",
    means: "The growth rate the current price would require the model to be worth paying.",
    matters: "It inverts the question usefully. Rather than arguing about your assumptions, it asks what the market must already believe \u2014 and whether that belief is reasonable.",
    computes: "Solved by bisection on the same model that produces the fair value, holding every other assumption fixed."
  },
  "earnings-power": {
    title: "Earnings power value",
    means: "What the business is worth on its current earnings alone, assuming no growth at all.",
    matters: "It separates what you are paying for today's business from what you are paying for its future. The gap between this and the price is the growth premium, stated explicitly.",
    computes: "Normalised operating profit, taxed, capitalised at the cost of capital. Not meaningful for financials, and reported as such rather than computed."
  },
  "cost-of-equity": {
    title: "Cost of equity",
    means: "The return a shareholder should demand for owning this business rather than a government bond.",
    matters: "It is the hurdle every other number is judged against. Set it too low and everything looks cheap.",
    computes: "A risk-free rate plus beta times an equity risk premium, with beta clamped to a sensible range. A trailing five-year beta through a structural break can imply a cost of equity below government bonds, which is not a number any real investor would accept."
  }
};
var ALIASES = {
  // The watchlist header aggregates the five pillars under shorter labels
  // (server/index.js), positionally mapped to the same five.
  "Solvency": "Financial Health & Solvency",
  "Profitability": "Profitability & Moat Quality",
  "Valuation": "Valuation & Margin of Safety",
  "Growth": "Growth & Operating Leverage",
  "Capital Return": "Capital Allocation & Returns",
  // Short forms used on the deep-dive ratio cards.
  "ROIC": "Return on invested capital",
  "ROIC \u2212 WACC": "ROIC vs. Cost of Capital",
  "FCF conversion": "Free cash flow conversion",
  "Equity / assets": "Equity to assets",
  "Net cash": "Net Cash",
  "Trailing P/E": "P/E Ratio",
  "Interest Coverage": "Interest coverage",
  "Current Ratio": "Current & quick ratio",
  "FCF / Net Income Quality": "Free cash flow conversion",
  "Valuation PEG Ratio": "PEG ratio",
  "Revenue Growth": "Revenue CAGR",
  "Share Dilution & Buybacks": "Buybacks vs. dilution"
};
function explain(key) {
  if (!key) return null;
  return GLOSSARY[key] || GLOSSARY[ALIASES[key]] || null;
}
var GLOSSARY_KEYS = Object.keys(GLOSSARY);
export {
  GLOSSARY,
  GLOSSARY_KEYS,
  explain
};
