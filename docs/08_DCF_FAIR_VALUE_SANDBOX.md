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

## 3. Preset Scenario Configurations

| Scenario | Growth Rate ($g$) | Terminal Multiple ($M$) | Discount Rate ($r$) | Description |
|---|---|---|---|---|
| **🐻 Bear Case** | $-35\%$ below Base | $16.0x$ | $11.0\%$ | Macro deceleration / margin compression |
| **⚖️ Base Case** | Consensus CAGR | Sector Median ($24.0x$) | $9.5\%$ | Wall St. consensus cash flow forecast |
| **🐂 Bull Case** | $+30\%$ above Base | $32.0x$ | $9.0\%$ | Sustained AI adoption / pricing power |
