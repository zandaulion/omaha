# Interactive DCF & Intrinsic Fair Value Calculator Sandbox

This document specifies the mathematical model, UI components, and interactive slider logic for the **Intrinsic Fair Value / DCF Sandbox** module in **Pocket Omaha**.

---

## 1. Mathematical DCF Formulation

The calculator employs a **2-Stage Discounted Free Cash Flow (FCF) Model** with an Exit Multiple terminal value and Net Cash adjustment:

### Step 1: 5-Year Projected Free Cash Flows
For each year $t \in [1, 5]$:
$$\text{FCF}_t = \text{FCF}_0 \times (1 + g)^t$$
$$\text{PV}(\text{FCF}_t) = \frac{\text{FCF}_t}{(1 + r)^t}$$
Where:
* $\text{FCF}_0$ = Trailing Twelve Months (TTM) Free Cash Flow.
* $g$ = Projected 5-Year Annual FCF Growth Rate (Slider 1).
* $r$ = Required Rate of Return / Discount Rate (Slider 3).

### Step 2: Discounted Terminal Value (Exit Multiple Method)
$$\text{Terminal Value} = \text{FCF}_5 \times M_{\text{terminal}}$$
$$\text{PV}(\text{Terminal Value}) = \frac{\text{Terminal Value}}{(1 + r)^5}$$
Where:
* $M_{\text{terminal}}$ = Terminal FCF Multiple at Year 5 (Slider 2).

### Step 3: Enterprise to Equity Value & Per-Share Fair Value
$$\text{Enterprise Value} = \sum_{t=1}^5 \text{PV}(\text{FCF}_t) + \text{PV}(\text{Terminal Value})$$
$$\text{Equity Value} = \text{Enterprise Value} + \text{Cash Reserves} - \text{Total Debt}$$
$$\text{Fair Value per Share} = \frac{\text{Equity Value}}{\text{Shares Outstanding}}$$

### Step 4: Margin of Safety (%)
$$\text{Margin of Safety} = \frac{\text{Fair Value} - \text{Current Price}}{\text{Fair Value}} \times 100\%$$

---

## 2. Component Wireframe & Layout

```
┌─────────────────────────────────────────────────────────────┐
│ 🧮 INTRINSIC FAIR VALUE SANDBOX (NVDA)                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│ ┌─ FAIR VALUE SUMMARY CARD ───────────────────────────────┐ │
│ │ Estimated Fair Value:  $144.50                          │ │
│ │ Current Market Price:  $128.60                          │ │
│ │                                                         │ │
│ │ 🟢 MARGIN OF SAFETY: +11.0% Undervalued                 │ │
│ │ [===== Current $128.60 =====| Fair Value $144.50 =====] │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ [ 🐻 Bear Case ]    [ ⚖️ Base Case ]    [ 🐂 Bull Case ]    │
│                                                             │
│ 1. 5-Year Annual FCF Growth: [ 25% ]                        │
│    [─────────────●───────────────────────] (5% to 45%)      │
│                                                             │
│ 2. Terminal Exit Multiple:   [ 28.0x ]                      │
│    [──────────────────●──────────────────] (10x to 40x)     │
│                                                             │
│ 3. Discount Rate (Return):   [ 9.5% ]                       │
│    [────────────●────────────────────────] (7% to 15%)      │
│                                                             │
│ ┌─ DETAILED DCF BREAKDOWN ────────────────────────────────┐ │
│ │ Trailing FCF Base:      $60.8 Billion                   │ │
│ │ 5-Year Cumulative PV:   $214.2 Billion                  │ │
│ │ Present Terminal Value: $240.5 Billion                  │ │
│ │ Net Cash Addition:     +$21.7 Billion                   │ │
│ │ Total Intrinsic Equity: $476.4 Billion                  │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. When the model does not run

A discounted cash flow model requires positive free cash flow and a share
count. Where either is absent the sandbox says so and offers no fair value:

| Condition | What the app shows |
|---|---|
| Trailing FCF $\le 0$ | *Not modelled* — the business is not generating cash to discount; judge it on the balance sheet and the path back to cash generation |
| No filed diluted share count | *Not modelled* — a per-share value cannot be derived |
| Banks, insurers, REITs | *Not modelled* — free cash flow is not owner earnings for a lender; book value and return on equity are the measures that apply |

Substituting a nominal positive cash flow to keep the model running produces a
confident-looking intrinsic value for a company that is burning cash, which is
worse than showing nothing.

**Negative equity value is a real result, not an error.** Where the discounted
flows do not cover the debt, the fair value is reported as negative and the
valuation pillar scores zero for that measure.

---

## 4. Model inputs

### Growth ($g$)

The median of whichever compound rates the filings support — revenue, diluted
EPS, and free cash flow per share — bounded to $[0\%, 20\%]$. Using a single
series lets one noisy line drive the whole valuation; extrapolating an extreme
trailing rate across five years measures the window, not the business.

### Terminal multiple ($M$)

Keyed to business quality, never to the share price:

| Adjustment | Effect |
|---|---|
| Base | $15\times$ |
| ROIC $\ge 25\%$ | $+6$ |
| ROIC $15$–$25\%$ | $+4$ |
| ROIC $10$–$15\%$ | $+1$ |
| ROIC $< 6\%$ | $-3$ |
| Gross margin $\ge 60\%$ | $+2$ |
| Net cash position | $+1$ |
| Net debt $> 3\times$ EBITDA | $-2$ |

Bounded to $[9\times, 26\times]$.

Deriving the multiple from forward P/E — the obvious shortcut — makes fair
value a function of the market price: an expensive stock earns a higher
multiple, a higher fair value, and so can never look expensive. It also applies
an *earnings* multiple to *cash flow*, which are not the same quantity for any
capital-intensive business.

### Discount rate ($r$)

$9.5\%$ by default, adjustable on the slider. The presets move it to $11\%$
bear and $9\%$ bull.

---

## 5. Reporting the result

Margin of safety follows the spec formula when the stock trades **below** fair
value:

$$\text{Margin of Safety} = \frac{\text{Fair Value} - \text{Price}}{\text{Fair Value}} \times 100\%$$

Above fair value that expression runs to $-188\%$ or worse and stops carrying
meaning, so the interface states the **premium to fair value** instead:

$$\text{Premium} = \frac{\text{Price} - \text{Fair Value}}{\text{Fair Value}} \times 100\%$$

rendered as "42.0% above fair value at these assumptions".

---

## 3. Preset Scenario Configurations

| Scenario | Growth ($g$) | Terminal multiple ($M$) | Discount rate ($r$) | Description |
|---|---|---|---|---|
| **🐻 Bear** | $-35\%$ below base | $16.0\times$ | $11.0\%$ | Macro deceleration, margin compression |
| **⚖️ Base** | filed CAGR median | quality-adjusted (see §4) | $9.5\%$ | What the filings imply, unadjusted |
| **🐂 Bull** | $+30\%$ above base | $32.0\times$ | $9.0\%$ | Sustained demand and pricing power |

The sandbox opens on the base case using exactly the assumptions the server
scored the company with, so the interactive model and the scorecard never
disagree at their starting point.
