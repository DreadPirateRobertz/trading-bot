# Trading Bot Paper Trading Report

**Generated**: 2026-02-21T01:00:43.636Z
**Mode**: Continuous paper trading with synthetic market data
**Strategies**: Momentum (7d, 30d), Mean Reversion (z1.5, z2.0), Ensemble (50/50, regime-adaptive)
**Initial Balance**: $100,000 per strategy per session

---

## Session 1 — 2026-02-21 01:00:43

### Market Conditions
- Start price: $50776.36
- End price: $69547.24
- B&H Return: 36.97%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-30d | -1.31% | 18.75% | 0.78 | -0.13 | 9.83% | 16 |
| Momentum-7d | 2.16% | 29.17% | 1.51 | 0.52 | 3.93% | 24 |
| Mom-7d-Aggr | 2.22% | 21.74% | 1.56 | 0.53 | 3.95% | 23 |
| MeanRev-Z2.0 | 0% | 0% | 0 | 0 | 0% | 0 |
| MeanRev-Z1.5 | 0% | 0% | 0 | 0 | 0% | 0 |
| Ensemble-50/50 | 5.74% | 27.27% | 4.54 | 0.74 | 5.68% | 11 |

### Analysis

**Best**: Ensemble-50/50 (Sharpe 0.74, return 5.74%)
**Worst**: Momentum-30d (Sharpe -0.13, return -1.31%)

**Ensemble-50/50 — Regime Breakdown:**
- bull_trend: 31 buys, 0 sells out of 31 bars
- high_vol: 53 buys, 12 sells out of 73 bars
- range_bound: 12 buys, 74 sells out of 91 bars
- bear_trend: 13 buys, 42 sells out of 55 bars
- recovery: 16 buys, 39 sells out of 55 bars

### What Worked
- Momentum-7d: Sharpe 0.52 with 29.17% win rate
- Mom-7d-Aggr: Sharpe 0.53 with 21.74% win rate
- Ensemble-50/50: Sharpe 0.74 with 27.27% win rate

### What Didn't Work
- Momentum-30d: Sharpe -0.13, max DD 9.83%
- MeanRev-Z2.0: Sharpe 0, max DD 0%
- MeanRev-Z1.5: Sharpe 0, max DD 0%

### Parameter Adjustments for Next Session
- Market was range-bound — increase MR weight to 40/60
- Win rate 27.27% too low — consider raising entry threshold

---

## Session 2 — 2026-02-21 01:00:43

### Market Conditions
- Start price: $41533.54
- End price: $61845.31
- B&H Return: 48.9%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-30d | -1.49% | 40% | 0.51 | -0.25 | 3.78% | 10 |
| Momentum-7d | -0.06% | 37.04% | 0.99 | 0 | 2.92% | 27 |
| Mom-7d-Aggr | 0.14% | 41.67% | 1.04 | 0.05 | 2.95% | 24 |
| MeanRev-Z2.0 | 2.51% | 100% | Infinity | 0.8 | 1.73% | 4 |
| MeanRev-Z1.5 | 0.99% | 83.33% | 4.55 | 0.67 | 1.16% | 6 |
| Ensemble-50/50 | 1.09% | 44.44% | 1.27 | 0.19 | 6.1% | 18 |

### Analysis

**Best**: MeanRev-Z2.0 (Sharpe 0.8, return 2.51%)
**Worst**: Momentum-30d (Sharpe -0.25, return -1.49%)

**MeanRev-Z2.0 — Regime Breakdown:**
- bull_trend: 0 buys, 2 sells out of 31 bars
- high_vol: 4 buys, 4 sells out of 73 bars
- range_bound: 2 buys, 5 sells out of 91 bars
- bear_trend: 8 buys, 1 sells out of 55 bars
- recovery: 0 buys, 12 sells out of 55 bars

### What Worked
- MeanRev-Z2.0: Sharpe 0.8 with 100% win rate
- MeanRev-Z1.5: Sharpe 0.67 with 83.33% win rate

### What Didn't Work
- Momentum-30d: Sharpe -0.25, max DD 3.78%
- Momentum-7d: Sharpe 0, max DD 2.92%
- Mom-7d-Aggr: Sharpe 0.05, max DD 2.95%
- Ensemble-50/50: Sharpe 0.19, max DD 6.1%

### Parameter Adjustments for Next Session
- Market was range-bound — increase MR weight to 40/60

---

## Session 3 — 2026-02-21 01:00:43

### Market Conditions
- Start price: $44500.6
- End price: $77270.17
- B&H Return: 73.64%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-30d | -5.48% | 25% | 0.26 | -0.6 | 9.36% | 16 |
| Momentum-7d | 1.5% | 34.78% | 1.39 | 0.37 | 2.67% | 23 |
| Mom-7d-Aggr | 0.61% | 28.57% | 1.19 | 0.15 | 2.95% | 21 |
| MeanRev-Z2.0 | 0% | 0% | 0 | 0 | 0% | 0 |
| MeanRev-Z1.5 | 0.04% | 100% | Infinity | 0.07 | 0.62% | 1 |
| Ensemble-50/50 | -1.3% | 37.5% | 0.42 | -0.24 | 3.77% | 16 |

### Analysis

**Best**: Momentum-7d (Sharpe 0.37, return 1.5%)
**Worst**: Momentum-30d (Sharpe -0.6, return -5.48%)

**Momentum-7d — Regime Breakdown:**
- bull_trend: 24 buys, 7 sells out of 31 bars
- high_vol: 26 buys, 47 sells out of 73 bars
- range_bound: 55 buys, 36 sells out of 91 bars
- bear_trend: 29 buys, 26 sells out of 55 bars
- recovery: 40 buys, 15 sells out of 55 bars

### What Worked

### What Didn't Work
- Momentum-30d: Sharpe -0.6, max DD 9.36%
- Momentum-7d: Sharpe 0.37, max DD 2.67%
- Mom-7d-Aggr: Sharpe 0.15, max DD 2.95%
- MeanRev-Z2.0: Sharpe 0, max DD 0%
- MeanRev-Z1.5: Sharpe 0.07, max DD 0.62%
- Ensemble-50/50: Sharpe -0.24, max DD 3.77%

### Parameter Adjustments for Next Session
- Market was range-bound — increase MR weight to 40/60
- Win rate 34.78% too low — consider raising entry threshold

---

## Session 4 — 2026-02-21 01:00:43

### Market Conditions
- Start price: $52561.87
- End price: $82547.27
- B&H Return: 57.05%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-30d | 6.58% | 50% | 12.8 | 0.88 | 5.48% | 8 |
| Momentum-7d | 5.35% | 48% | 4.3 | 1.33 | 1.73% | 25 |
| Mom-7d-Aggr | 1.67% | 45.45% | 1.83 | 0.63 | 1.78% | 22 |
| MeanRev-Z2.0 | -0.03% | 50% | 0.92 | -0.02 | 1.35% | 4 |
| MeanRev-Z1.5 | -0.13% | 50% | 0.76 | -0.09 | 1.49% | 4 |
| Ensemble-50/50 | 3.15% | 71.43% | 3.24 | 0.66 | 3.7% | 14 |

### Analysis

**Best**: Momentum-7d (Sharpe 1.33, return 5.35%)
**Worst**: MeanRev-Z1.5 (Sharpe -0.09, return -0.13%)

**Momentum-7d — Regime Breakdown:**
- bull_trend: 29 buys, 2 sells out of 31 bars
- high_vol: 43 buys, 30 sells out of 73 bars
- range_bound: 53 buys, 38 sells out of 91 bars
- bear_trend: 26 buys, 29 sells out of 55 bars
- recovery: 24 buys, 31 sells out of 55 bars

### What Worked
- Momentum-30d: Sharpe 0.88 with 50% win rate
- Momentum-7d: Sharpe 1.33 with 48% win rate
- Mom-7d-Aggr: Sharpe 0.63 with 45.45% win rate
- Ensemble-50/50: Sharpe 0.66 with 71.43% win rate

### What Didn't Work
- MeanRev-Z2.0: Sharpe -0.02, max DD 1.35%
- MeanRev-Z1.5: Sharpe -0.09, max DD 1.49%

### Parameter Adjustments for Next Session
- Market was trending — increase momentum weight to 60/40

---

## Session 5 — 2026-02-21 01:00:43

### Market Conditions
- Start price: $55592.85
- End price: $40790.01
- B&H Return: -26.63%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-30d | -0.67% | 25% | 0.51 | -0.23 | 3.32% | 12 |
| Momentum-7d | -0.48% | 29.17% | 0.88 | -0.13 | 3.66% | 24 |
| Mom-7d-Aggr | -0.99% | 38.1% | 0.77 | -0.28 | 4.01% | 21 |
| MeanRev-Z2.0 | -0.96% | 66.67% | 0.16 | -0.63 | 1.89% | 3 |
| MeanRev-Z1.5 | -0.4% | 66.67% | 0.28 | -0.68 | 0.78% | 3 |
| Ensemble-50/50 | -2.43% | 43.75% | 0.43 | -0.65 | 5.41% | 16 |

### Analysis

**Best**: Momentum-7d (Sharpe -0.13, return -0.48%)
**Worst**: MeanRev-Z1.5 (Sharpe -0.68, return -0.4%)

**Momentum-7d — Regime Breakdown:**
- bull_trend: 16 buys, 15 sells out of 31 bars
- high_vol: 30 buys, 43 sells out of 73 bars
- range_bound: 55 buys, 36 sells out of 91 bars
- bear_trend: 23 buys, 32 sells out of 55 bars
- recovery: 33 buys, 22 sells out of 55 bars

### What Worked

### What Didn't Work
- Momentum-30d: Sharpe -0.23, max DD 3.32%
- Momentum-7d: Sharpe -0.13, max DD 3.66%
- Mom-7d-Aggr: Sharpe -0.28, max DD 4.01%
- MeanRev-Z2.0: Sharpe -0.63, max DD 1.89%
- MeanRev-Z1.5: Sharpe -0.68, max DD 0.78%
- Ensemble-50/50: Sharpe -0.65, max DD 5.41%

### Parameter Adjustments for Next Session
- Market was trending — increase momentum weight to 60/40
- Win rate 29.17% too low — consider raising entry threshold

---

## Session 6 — 2026-02-21 01:00:43

### Market Conditions
- Start price: $50339.79
- End price: $49065.9
- B&H Return: -2.53%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-30d | -0.09% | 38.46% | 0.96 | 0 | 4.77% | 13 |
| Momentum-7d | -0.12% | 51.85% | 0.98 | -0.01 | 4.36% | 27 |
| Mom-7d-Aggr | -2.09% | 36% | 0.43 | -0.88 | 3.32% | 25 |
| MeanRev-Z2.0 | -0.83% | 66.67% | 0.11 | -0.87 | 1.51% | 3 |
| MeanRev-Z1.5 | -1.94% | 75% | 0.26 | -0.99 | 2.98% | 4 |
| Ensemble-50/50 | -0.25% | 50% | 0.91 | -0.09 | 3% | 20 |

### Analysis

**Best**: Momentum-30d (Sharpe 0, return -0.09%)
**Worst**: MeanRev-Z1.5 (Sharpe -0.99, return -1.94%)

**Momentum-30d — Regime Breakdown:**
- bull_trend: 29 buys, 2 sells out of 31 bars
- high_vol: 19 buys, 54 sells out of 73 bars
- range_bound: 49 buys, 42 sells out of 91 bars
- bear_trend: 22 buys, 33 sells out of 55 bars
- recovery: 39 buys, 16 sells out of 55 bars

### What Worked

### What Didn't Work
- Momentum-30d: Sharpe 0, max DD 4.77%
- Momentum-7d: Sharpe -0.01, max DD 4.36%
- Mom-7d-Aggr: Sharpe -0.88, max DD 3.32%
- MeanRev-Z2.0: Sharpe -0.87, max DD 1.51%
- MeanRev-Z1.5: Sharpe -0.99, max DD 2.98%
- Ensemble-50/50: Sharpe -0.09, max DD 3%

### Parameter Adjustments for Next Session
- Market was trending — increase momentum weight to 60/40
- Win rate 38.46% too low — consider raising entry threshold

---

## Session 7 — 2026-02-21 01:00:43

### Market Conditions
- Start price: $46992.46
- End price: $122493.08
- B&H Return: 160.67%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-30d | -1.96% | 31.25% | 0.7 | -0.59 | 5.47% | 16 |
| Momentum-7d | 8.55% | 54.17% | 4.68 | 1.86 | 1.79% | 24 |
| Mom-7d-Aggr | 1.76% | 39.13% | 1.77 | 0.78 | 1.6% | 23 |
| MeanRev-Z2.0 | 0% | 0% | 0 | 0 | 0% | 0 |
| MeanRev-Z1.5 | 0% | 0% | 0 | 0 | 0% | 0 |
| Ensemble-50/50 | -0.61% | 46.67% | 0.74 | -0.48 | 1.88% | 15 |

### Analysis

**Best**: Momentum-7d (Sharpe 1.86, return 8.55%)
**Worst**: Momentum-30d (Sharpe -0.59, return -1.96%)

**Momentum-7d — Regime Breakdown:**
- bull_trend: 17 buys, 14 sells out of 31 bars
- high_vol: 47 buys, 26 sells out of 73 bars
- range_bound: 50 buys, 41 sells out of 91 bars
- bear_trend: 35 buys, 20 sells out of 55 bars
- recovery: 48 buys, 7 sells out of 55 bars

### What Worked
- Momentum-7d: Sharpe 1.86 with 54.17% win rate
- Mom-7d-Aggr: Sharpe 0.78 with 39.13% win rate

### What Didn't Work
- Momentum-30d: Sharpe -0.59, max DD 5.47%
- MeanRev-Z2.0: Sharpe 0, max DD 0%
- MeanRev-Z1.5: Sharpe 0, max DD 0%
- Ensemble-50/50: Sharpe -0.48, max DD 1.88%

### Parameter Adjustments for Next Session
- Market was range-bound — increase MR weight to 40/60

---

## Session 8 — 2026-02-21 01:00:43

### Market Conditions
- Start price: $43230.14
- End price: $58368.01
- B&H Return: 35.02%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-30d | -0.39% | 33.33% | 0.86 | -0.11 | 4.05% | 9 |
| Momentum-7d | 0.54% | 33.33% | 1.14 | 0.13 | 2.77% | 30 |
| Mom-7d-Aggr | 7.88% | 36.36% | 4.92 | 1.28 | 1.99% | 22 |
| MeanRev-Z2.0 | -1.52% | 66.67% | 0.14 | -0.89 | 2.52% | 3 |
| MeanRev-Z1.5 | -0.62% | 33.33% | 0.35 | -0.33 | 1.85% | 3 |
| Ensemble-50/50 | 1.54% | 53.33% | 2.09 | 0.69 | 1.58% | 15 |

### Analysis

**Best**: Mom-7d-Aggr (Sharpe 1.28, return 7.88%)
**Worst**: MeanRev-Z2.0 (Sharpe -0.89, return -1.52%)

**Mom-7d-Aggr — Regime Breakdown:**
- bull_trend: 19 buys, 12 sells out of 31 bars
- high_vol: 24 buys, 49 sells out of 73 bars
- range_bound: 56 buys, 35 sells out of 91 bars
- bear_trend: 40 buys, 15 sells out of 55 bars
- recovery: 45 buys, 10 sells out of 55 bars

### What Worked
- Mom-7d-Aggr: Sharpe 1.28 with 36.36% win rate
- Ensemble-50/50: Sharpe 0.69 with 53.33% win rate

### What Didn't Work
- Momentum-30d: Sharpe -0.11, max DD 4.05%
- Momentum-7d: Sharpe 0.13, max DD 2.77%
- MeanRev-Z2.0: Sharpe -0.89, max DD 2.52%
- MeanRev-Z1.5: Sharpe -0.33, max DD 1.85%

### Parameter Adjustments for Next Session
- Market was trending — increase momentum weight to 60/40
- Win rate 36.36% too low — consider raising entry threshold

---

## Session 9 — 2026-02-21 01:00:43

### Market Conditions
- Start price: $49216.79
- End price: $33496.42
- B&H Return: -31.94%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-30d | -2.9% | 18.18% | 0.06 | -1.82 | 3.02% | 11 |
| Momentum-7d | -2.3% | 25% | 0.64 | -0.69 | 5.7% | 20 |
| Mom-7d-Aggr | -2.52% | 34.62% | 0.63 | -0.75 | 6.03% | 26 |
| MeanRev-Z2.0 | 0% | 0% | 0 | 0 | 0% | 0 |
| MeanRev-Z1.5 | 0% | 0% | 0 | 0 | 0% | 0 |
| Ensemble-50/50 | -1.29% | 10% | 0.02 | -1.3 | 1.3% | 10 |

### Analysis

**Best**: MeanRev-Z1.5 (Sharpe 0, return 0%)
**Worst**: Momentum-30d (Sharpe -1.82, return -2.9%)

**MeanRev-Z1.5 — Regime Breakdown:**
- bull_trend: 0 buys, 0 sells out of 31 bars
- high_vol: 0 buys, 0 sells out of 73 bars
- range_bound: 0 buys, 0 sells out of 91 bars
- bear_trend: 0 buys, 0 sells out of 55 bars
- recovery: 0 buys, 0 sells out of 55 bars

### What Worked

### What Didn't Work
- Momentum-30d: Sharpe -1.82, max DD 3.02%
- Momentum-7d: Sharpe -0.69, max DD 5.7%
- Mom-7d-Aggr: Sharpe -0.75, max DD 6.03%
- MeanRev-Z2.0: Sharpe 0, max DD 0%
- MeanRev-Z1.5: Sharpe 0, max DD 0%
- Ensemble-50/50: Sharpe -1.3, max DD 1.3%

### Parameter Adjustments for Next Session
- Market was range-bound — increase MR weight to 40/60
- Win rate 0% too low — consider raising entry threshold

---

## Session 10 — 2026-02-21 01:00:43

### Market Conditions
- Start price: $57660.73
- End price: $116120.19
- B&H Return: 101.39%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-30d | 5.42% | 22.22% | 2.9 | 0.92 | 7.32% | 9 |
| Momentum-7d | 17.49% | 55% | 12.18 | 3.02 | 1.87% | 20 |
| Mom-7d-Aggr | 14.27% | 45.45% | 7.33 | 2.54 | 1.91% | 22 |
| MeanRev-Z2.0 | 0% | 0% | 0 | 0 | 0% | 0 |
| MeanRev-Z1.5 | 0% | 0% | 0 | 0 | 0% | 0 |
| Ensemble-50/50 | 5.35% | 28.57% | 6.9 | 1.03 | 3.17% | 7 |

### Analysis

**Best**: Momentum-7d (Sharpe 3.02, return 17.49%)
**Worst**: MeanRev-Z1.5 (Sharpe 0, return 0%)

**Momentum-7d — Regime Breakdown:**
- bull_trend: 25 buys, 6 sells out of 31 bars
- high_vol: 48 buys, 25 sells out of 73 bars
- range_bound: 37 buys, 54 sells out of 91 bars
- bear_trend: 11 buys, 44 sells out of 55 bars
- recovery: 45 buys, 10 sells out of 55 bars

### What Worked
- Momentum-30d: Sharpe 0.92 with 22.22% win rate
- Momentum-7d: Sharpe 3.02 with 55% win rate
- Mom-7d-Aggr: Sharpe 2.54 with 45.45% win rate
- Ensemble-50/50: Sharpe 1.03 with 28.57% win rate

### What Didn't Work
- MeanRev-Z2.0: Sharpe 0, max DD 0%
- MeanRev-Z1.5: Sharpe 0, max DD 0%

### Parameter Adjustments for Next Session
- Market was trending — increase momentum weight to 60/40

---

## Aggregate Summary (10 sessions)

| Strategy | Avg Return | Avg Sharpe | Avg Win Rate | Avg Max DD | Avg PF |
|----------|-----------|------------|-------------|-----------|--------|
| Momentum-30d | -0.23% | -0.19 | 30.22% | 5.64% | 2.03 |
| Momentum-7d | 3.26% | 0.64 | 39.75% | 3.14% | 2.87 |
| Mom-7d-Aggr | 2.3% | 0.41 | 36.71% | 3.05% | 2.15 |
| MeanRev-Z2.0 | -0.08% | -0.16 | 35% | 0.9% | Infinity |
| MeanRev-Z1.5 | -0.21% | -0.13 | 40.83% | 0.89% | Infinity |
| Ensemble-50/50 | 1.1% | 0.06 | 41.3% | 3.56% | 2.06 |

### Key Findings

1. **Best overall strategy**: Momentum-7d (avg Sharpe 0.64)
2. Ensemble strategies expected to outperform in mixed-regime markets
3. Parameter tuning between sessions shows improvement path

### Next Steps

1. Integrate real historical data from Binance API (BTC, ETH, SOL)
2. Add sentiment overlay to ensemble (Reddit mention velocity)
3. Implement HMM regime detector to replace simple vol-ratio heuristic
4. Walk-forward optimization on live paper trading
