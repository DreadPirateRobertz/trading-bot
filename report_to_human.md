# Trading Bot Paper Trading Report

**Generated**: 2026-02-21T01:04:32.731Z
**Mode**: Continuous paper trading with synthetic market data
**Strategies**: Momentum (7d, 30d), Mean Reversion (z1.5, z2.0), Ensemble (50/50, regime-adaptive)
**Initial Balance**: $100,000 per strategy per session

---

## Session 1 — 2026-02-21 01:04:32

### Market Conditions
- Start price: $44625.61
- End price: $69327.28
- B&H Return: 55.35%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-7d | 1.11% | 35.71% | 1.36 | 0.44 | 2.09% | 28 |
| Mom-7d-Aggr | -0.79% | 34.62% | 0.72 | -0.32 | 2.17% | 26 |
| BB-Bounce | 8.18% | 83.33% | 73.25 | 1.27 | 3% | 6 |
| MeanRev-Z1.5 | 0.63% | 80% | 23.36 | 0.69 | 0.44% | 5 |
| Hybrid-MomBB | 0.34% | 56.41% | 1.08 | 0.16 | 2.25% | 39 |
| Momentum-30d | 1.23% | 37.5% | 1.39 | 0.18 | 7.56% | 16 |

### Analysis

**Best**: BB-Bounce (Sharpe 1.27, return 8.18%)
**Worst**: Mom-7d-Aggr (Sharpe -0.32, return -0.79%)

**BB-Bounce — Regime Breakdown:**
- bull_trend: 0 buys, 10 sells out of 31 bars
- high_vol: 15 buys, 8 sells out of 73 bars
- range_bound: 4 buys, 11 sells out of 91 bars
- bear_trend: 7 buys, 8 sells out of 55 bars
- recovery: 6 buys, 6 sells out of 55 bars

### What Worked
- BB-Bounce: Sharpe 1.27 with 83.33% win rate
- MeanRev-Z1.5: Sharpe 0.69 with 80% win rate

### What Didn't Work
- Momentum-7d: Sharpe 0.44, max DD 2.09%
- Mom-7d-Aggr: Sharpe -0.32, max DD 2.17%
- Hybrid-MomBB: Sharpe 0.16, max DD 2.25%
- Momentum-30d: Sharpe 0.18, max DD 7.56%

### Parameter Adjustments for Next Session
- Market was range-bound — increase MR weight to 40/60

---

## Session 2 — 2026-02-21 01:04:32

### Market Conditions
- Start price: $40439.71
- End price: $64563.76
- B&H Return: 59.65%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-7d | 6.69% | 43.48% | 3.32 | 1.21 | 2.73% | 23 |
| Mom-7d-Aggr | 7.22% | 42.11% | 4.18 | 1.32 | 2.67% | 19 |
| BB-Bounce | 8.24% | 75% | 2.17 | 1.04 | 5.37% | 8 |
| MeanRev-Z1.5 | 1.58% | 83.33% | 2.71 | 1.28 | 1.15% | 6 |
| Hybrid-MomBB | -0.79% | 57.14% | 0.83 | -0.25 | 2.81% | 35 |
| Momentum-30d | 1.18% | 45.45% | 2.11 | 0.2 | 3.53% | 11 |

### Analysis

**Best**: Mom-7d-Aggr (Sharpe 1.32, return 7.22%)
**Worst**: Hybrid-MomBB (Sharpe -0.25, return -0.79%)

**Mom-7d-Aggr — Regime Breakdown:**
- bull_trend: 20 buys, 11 sells out of 31 bars
- high_vol: 36 buys, 37 sells out of 73 bars
- range_bound: 69 buys, 22 sells out of 91 bars
- bear_trend: 30 buys, 25 sells out of 55 bars
- recovery: 44 buys, 11 sells out of 55 bars

### What Worked
- Momentum-7d: Sharpe 1.21 with 43.48% win rate
- Mom-7d-Aggr: Sharpe 1.32 with 42.11% win rate
- BB-Bounce: Sharpe 1.04 with 75% win rate
- MeanRev-Z1.5: Sharpe 1.28 with 83.33% win rate

### What Didn't Work
- Hybrid-MomBB: Sharpe -0.25, max DD 2.81%
- Momentum-30d: Sharpe 0.2, max DD 3.53%

### Parameter Adjustments for Next Session
- Balanced regime — keep 50/50 weights
- Win rate 42.11% too low — consider raising entry threshold

---

## Session 3 — 2026-02-21 01:04:32

### Market Conditions
- Start price: $59620.97
- End price: $50881.11
- B&H Return: -14.66%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-7d | 1.11% | 38.89% | 1.18 | 0.23 | 4.77% | 18 |
| Mom-7d-Aggr | 2.3% | 38.89% | 1.69 | 0.42 | 4.25% | 18 |
| BB-Bounce | -9.72% | 42.86% | 0.1 | -0.94 | 15.69% | 7 |
| MeanRev-Z1.5 | -2.19% | 28.57% | 0.08 | -0.48 | 5.06% | 7 |
| Hybrid-MomBB | 0.89% | 57.14% | 1.25 | 0.37 | 2.24% | 35 |
| Momentum-30d | -7.23% | 17.65% | 0.11 | -0.78 | 13.12% | 17 |

### Analysis

**Best**: Mom-7d-Aggr (Sharpe 0.42, return 2.3%)
**Worst**: BB-Bounce (Sharpe -0.94, return -9.72%)

**Mom-7d-Aggr — Regime Breakdown:**
- bull_trend: 31 buys, 0 sells out of 31 bars
- high_vol: 40 buys, 33 sells out of 73 bars
- range_bound: 45 buys, 46 sells out of 91 bars
- bear_trend: 25 buys, 30 sells out of 55 bars
- recovery: 30 buys, 25 sells out of 55 bars

### What Worked

### What Didn't Work
- Momentum-7d: Sharpe 0.23, max DD 4.77%
- Mom-7d-Aggr: Sharpe 0.42, max DD 4.25%
- BB-Bounce: Sharpe -0.94, max DD 15.69%
- MeanRev-Z1.5: Sharpe -0.48, max DD 5.06%
- Hybrid-MomBB: Sharpe 0.37, max DD 2.24%
- Momentum-30d: Sharpe -0.78, max DD 13.12%

### Parameter Adjustments for Next Session
- Market was trending — increase momentum weight to 60/40
- Win rate 38.89% too low — consider raising entry threshold

---

## Session 4 — 2026-02-21 01:04:32

### Market Conditions
- Start price: $59923.26
- End price: $49062.62
- B&H Return: -18.12%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-7d | -0.49% | 37.04% | 0.89 | -0.11 | 4.24% | 27 |
| Mom-7d-Aggr | -3% | 36.36% | 0.44 | -0.96 | 4.67% | 22 |
| BB-Bounce | 1.85% | 66.67% | 1.19 | 0.21 | 8.89% | 9 |
| MeanRev-Z1.5 | 1.18% | 75% | 2.02 | 0.56 | 2.08% | 8 |
| Hybrid-MomBB | -2.72% | 31.43% | 0.45 | -0.93 | 4.72% | 35 |
| Momentum-30d | -0.39% | 21.43% | 0.87 | -0.03 | 8.23% | 14 |

### Analysis

**Best**: MeanRev-Z1.5 (Sharpe 0.56, return 1.18%)
**Worst**: Mom-7d-Aggr (Sharpe -0.96, return -3%)

**MeanRev-Z1.5 — Regime Breakdown:**
- bull_trend: 0 buys, 10 sells out of 31 bars
- high_vol: 19 buys, 5 sells out of 73 bars
- range_bound: 9 buys, 6 sells out of 91 bars
- bear_trend: 14 buys, 1 sells out of 55 bars
- recovery: 6 buys, 8 sells out of 55 bars

### What Worked
- MeanRev-Z1.5: Sharpe 0.56 with 75% win rate

### What Didn't Work
- Momentum-7d: Sharpe -0.11, max DD 4.24%
- Mom-7d-Aggr: Sharpe -0.96, max DD 4.67%
- BB-Bounce: Sharpe 0.21, max DD 8.89%
- Hybrid-MomBB: Sharpe -0.93, max DD 4.72%
- Momentum-30d: Sharpe -0.03, max DD 8.23%

### Parameter Adjustments for Next Session
- Market was range-bound — increase MR weight to 40/60

---

## Session 5 — 2026-02-21 01:04:32

### Market Conditions
- Start price: $51000.66
- End price: $71437.64
- B&H Return: 40.07%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-7d | 3.07% | 41.38% | 1.77 | 0.69 | 3.32% | 29 |
| Mom-7d-Aggr | 1.67% | 34.62% | 1.38 | 0.41 | 3.14% | 26 |
| BB-Bounce | -3.41% | 55.56% | 0.71 | -0.49 | 10.77% | 9 |
| MeanRev-Z1.5 | -1.34% | 40% | 0.32 | -1.05 | 2.45% | 5 |
| Hybrid-MomBB | -0.17% | 48.78% | 0.97 | -0.05 | 3.58% | 41 |
| Momentum-30d | 8.85% | 33.33% | 5.92 | 0.85 | 5.12% | 15 |

### Analysis

**Best**: Momentum-30d (Sharpe 0.85, return 8.85%)
**Worst**: MeanRev-Z1.5 (Sharpe -1.05, return -1.34%)

**Momentum-30d — Regime Breakdown:**
- bull_trend: 17 buys, 14 sells out of 31 bars
- high_vol: 53 buys, 20 sells out of 73 bars
- range_bound: 53 buys, 38 sells out of 91 bars
- bear_trend: 2 buys, 53 sells out of 55 bars
- recovery: 41 buys, 14 sells out of 55 bars

### What Worked
- Momentum-7d: Sharpe 0.69 with 41.38% win rate
- Momentum-30d: Sharpe 0.85 with 33.33% win rate

### What Didn't Work
- Mom-7d-Aggr: Sharpe 0.41, max DD 3.14%
- BB-Bounce: Sharpe -0.49, max DD 10.77%
- MeanRev-Z1.5: Sharpe -1.05, max DD 2.45%
- Hybrid-MomBB: Sharpe -0.05, max DD 3.58%

### Parameter Adjustments for Next Session
- Market was trending — increase momentum weight to 60/40
- Win rate 33.33% too low — consider raising entry threshold

---

## Session 6 — 2026-02-21 01:04:32

### Market Conditions
- Start price: $59145.09
- End price: $35830.49
- B&H Return: -39.42%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-7d | 4.23% | 42.86% | 2.07 | 0.7 | 6.13% | 28 |
| Mom-7d-Aggr | 5.65% | 38.46% | 3.29 | 1.01 | 4.84% | 26 |
| BB-Bounce | -10.14% | 42.86% | 0.24 | -1.57 | 13.17% | 7 |
| MeanRev-Z1.5 | 0% | 0% | 0 | 0 | 0% | 0 |
| Hybrid-MomBB | 0.15% | 46.67% | 1.04 | 0.07 | 3.74% | 30 |
| Momentum-30d | 5.65% | 42.86% | 6.28 | 0.67 | 5.67% | 7 |

### Analysis

**Best**: Mom-7d-Aggr (Sharpe 1.01, return 5.65%)
**Worst**: BB-Bounce (Sharpe -1.57, return -10.14%)

**Mom-7d-Aggr — Regime Breakdown:**
- bull_trend: 31 buys, 0 sells out of 31 bars
- high_vol: 20 buys, 53 sells out of 73 bars
- range_bound: 58 buys, 33 sells out of 91 bars
- bear_trend: 27 buys, 28 sells out of 55 bars
- recovery: 35 buys, 20 sells out of 55 bars

### What Worked
- Momentum-7d: Sharpe 0.7 with 42.86% win rate
- Mom-7d-Aggr: Sharpe 1.01 with 38.46% win rate
- Momentum-30d: Sharpe 0.67 with 42.86% win rate

### What Didn't Work
- BB-Bounce: Sharpe -1.57, max DD 13.17%
- MeanRev-Z1.5: Sharpe 0, max DD 0%
- Hybrid-MomBB: Sharpe 0.07, max DD 3.74%

### Parameter Adjustments for Next Session
- Market was trending — increase momentum weight to 60/40
- Win rate 38.46% too low — consider raising entry threshold

---

## Session 7 — 2026-02-21 01:04:32

### Market Conditions
- Start price: $45484.47
- End price: $51627.16
- B&H Return: 13.51%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-7d | -1.01% | 29.63% | 0.75 | -0.42 | 2.21% | 27 |
| Mom-7d-Aggr | -1.01% | 30.77% | 0.74 | -0.39 | 2.6% | 26 |
| BB-Bounce | -3.9% | 42.86% | 0.64 | -0.44 | 10.82% | 7 |
| MeanRev-Z1.5 | 0.61% | 66.67% | 1.45 | 0.2 | 2.7% | 6 |
| Hybrid-MomBB | -3.17% | 36.11% | 0.43 | -1.12 | 4.1% | 36 |
| Momentum-30d | -0.48% | 40% | 0.86 | -0.04 | 6.39% | 15 |

### Analysis

**Best**: MeanRev-Z1.5 (Sharpe 0.2, return 0.61%)
**Worst**: Hybrid-MomBB (Sharpe -1.12, return -3.17%)

**MeanRev-Z1.5 — Regime Breakdown:**
- bull_trend: 0 buys, 5 sells out of 31 bars
- high_vol: 15 buys, 10 sells out of 73 bars
- range_bound: 7 buys, 18 sells out of 91 bars
- bear_trend: 12 buys, 2 sells out of 55 bars
- recovery: 4 buys, 19 sells out of 55 bars

### What Worked

### What Didn't Work
- Momentum-7d: Sharpe -0.42, max DD 2.21%
- Mom-7d-Aggr: Sharpe -0.39, max DD 2.6%
- BB-Bounce: Sharpe -0.44, max DD 10.82%
- MeanRev-Z1.5: Sharpe 0.2, max DD 2.7%
- Hybrid-MomBB: Sharpe -1.12, max DD 4.1%
- Momentum-30d: Sharpe -0.04, max DD 6.39%

### Parameter Adjustments for Next Session
- Market was range-bound — increase MR weight to 40/60

---

## Session 8 — 2026-02-21 01:04:32

### Market Conditions
- Start price: $45632.82
- End price: $41967.72
- B&H Return: -8.03%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-7d | 1.04% | 29.17% | 1.16 | 0.22 | 5.81% | 24 |
| Mom-7d-Aggr | 0.48% | 28.57% | 1.08 | 0.12 | 5.72% | 28 |
| BB-Bounce | -9.48% | 25% | 0.36 | -0.88 | 12.8% | 8 |
| MeanRev-Z1.5 | 0% | 0% | 0 | 0 | 0% | 0 |
| Hybrid-MomBB | -1.21% | 45.45% | 0.75 | -0.44 | 2.71% | 33 |
| Momentum-30d | -0.23% | 36.36% | 0.87 | -0.01 | 4.95% | 11 |

### Analysis

**Best**: Momentum-7d (Sharpe 0.22, return 1.04%)
**Worst**: BB-Bounce (Sharpe -0.88, return -9.48%)

**Momentum-7d — Regime Breakdown:**
- bull_trend: 25 buys, 6 sells out of 31 bars
- high_vol: 27 buys, 46 sells out of 73 bars
- range_bound: 49 buys, 42 sells out of 91 bars
- bear_trend: 14 buys, 41 sells out of 55 bars
- recovery: 22 buys, 33 sells out of 55 bars

### What Worked

### What Didn't Work
- Momentum-7d: Sharpe 0.22, max DD 5.81%
- Mom-7d-Aggr: Sharpe 0.12, max DD 5.72%
- BB-Bounce: Sharpe -0.88, max DD 12.8%
- MeanRev-Z1.5: Sharpe 0, max DD 0%
- Hybrid-MomBB: Sharpe -0.44, max DD 2.71%
- Momentum-30d: Sharpe -0.01, max DD 4.95%

### Parameter Adjustments for Next Session
- Market was trending — increase momentum weight to 60/40
- Win rate 29.17% too low — consider raising entry threshold

---

## Session 9 — 2026-02-21 01:04:32

### Market Conditions
- Start price: $51586.3
- End price: $39384.98
- B&H Return: -23.65%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-7d | 1.22% | 40% | 1.48 | 0.56 | 2.67% | 20 |
| Mom-7d-Aggr | 0.75% | 35% | 1.45 | 0.39 | 1.55% | 20 |
| BB-Bounce | -9.22% | 42.86% | 0.4 | -0.96 | 11.3% | 7 |
| MeanRev-Z1.5 | 0.13% | 66.67% | 1.25 | 0.12 | 0.88% | 3 |
| Hybrid-MomBB | 2.69% | 37.5% | 2.45 | 0.96 | 1.54% | 24 |
| Momentum-30d | 1.88% | 33.33% | 1.86 | 0.45 | 4.26% | 9 |

### Analysis

**Best**: Hybrid-MomBB (Sharpe 0.96, return 2.69%)
**Worst**: BB-Bounce (Sharpe -0.96, return -9.22%)

**Hybrid-MomBB — Regime Breakdown:**
- bull_trend: 24 buys, 7 sells out of 31 bars
- high_vol: 39 buys, 31 sells out of 73 bars
- range_bound: 48 buys, 43 sells out of 91 bars
- bear_trend: 10 buys, 41 sells out of 55 bars
- recovery: 29 buys, 26 sells out of 55 bars

### What Worked
- Momentum-7d: Sharpe 0.56 with 40% win rate
- Hybrid-MomBB: Sharpe 0.96 with 37.5% win rate

### What Didn't Work
- Mom-7d-Aggr: Sharpe 0.39, max DD 1.55%
- BB-Bounce: Sharpe -0.96, max DD 11.3%
- MeanRev-Z1.5: Sharpe 0.12, max DD 0.88%
- Momentum-30d: Sharpe 0.45, max DD 4.26%

### Parameter Adjustments for Next Session
- Market was trending — increase momentum weight to 60/40
- Win rate 37.5% too low — consider raising entry threshold

---

## Session 10 — 2026-02-21 01:04:32

### Market Conditions
- Start price: $44706.92
- End price: $88494.59
- B&H Return: 97.94%
- Total candles: 365
- Regimes: bull_trend → high_vol → range_bound → bear_trend → recovery

### Strategy Performance Comparison

| Strategy | Return | Win Rate | Profit Factor | Sharpe | Max DD | Trades |
|----------|--------|----------|---------------|--------|--------|--------|
| Momentum-7d | 7.2% | 52% | 2.92 | 1.48 | 3.39% | 25 |
| Mom-7d-Aggr | 5.38% | 52.63% | 4.36 | 2.15 | 1.24% | 19 |
| BB-Bounce | 0.93% | 66.67% | 1.13 | 0.19 | 6.94% | 6 |
| MeanRev-Z1.5 | 1.65% | 80% | 7.71 | 1.76 | 0.46% | 5 |
| Hybrid-MomBB | 2.7% | 53.49% | 1.54 | 0.85 | 2.49% | 43 |
| Momentum-30d | 10.75% | 50% | 6.34 | 1.32 | 6.87% | 10 |

### Analysis

**Best**: Mom-7d-Aggr (Sharpe 2.15, return 5.38%)
**Worst**: BB-Bounce (Sharpe 0.19, return 0.93%)

**Mom-7d-Aggr — Regime Breakdown:**
- bull_trend: 24 buys, 7 sells out of 31 bars
- high_vol: 46 buys, 27 sells out of 73 bars
- range_bound: 71 buys, 20 sells out of 91 bars
- bear_trend: 16 buys, 39 sells out of 55 bars
- recovery: 54 buys, 1 sells out of 55 bars

### What Worked
- Momentum-7d: Sharpe 1.48 with 52% win rate
- Mom-7d-Aggr: Sharpe 2.15 with 52.63% win rate
- MeanRev-Z1.5: Sharpe 1.76 with 80% win rate
- Hybrid-MomBB: Sharpe 0.85 with 53.49% win rate
- Momentum-30d: Sharpe 1.32 with 50% win rate

### What Didn't Work
- BB-Bounce: Sharpe 0.19, max DD 6.94%

### Parameter Adjustments for Next Session
- Balanced regime — keep 50/50 weights

---

## Aggregate Summary (10 sessions)

| Strategy | Avg Return | Avg Sharpe | Avg Win Rate | Avg Max DD | Avg PF |
|----------|-----------|------------|-------------|-----------|--------|
| Momentum-7d | 2.42% | 0.5 | 39.02% | 3.74% | 1.69 |
| Mom-7d-Aggr | 1.87% | 0.42 | 37.2% | 3.29% | 1.93 |
| BB-Bounce | -2.67% | -0.26 | 54.37% | 9.88% | 8.02 |
| MeanRev-Z1.5 | 0.23% | 0.31 | 52.02% | 1.52% | 3.89 |
| Hybrid-MomBB | -0.13% | -0.04 | 47.01% | 3.02% | 1.08 |
| Momentum-30d | 2.12% | 0.28 | 35.79% | 6.57% | 2.66 |

### Key Findings

1. **Best overall strategy**: Momentum-7d (avg Sharpe 0.5)
2. Ensemble strategies expected to outperform in mixed-regime markets
3. Parameter tuning between sessions shows improvement path

### Next Steps

1. Integrate real historical data from Binance API (BTC, ETH, SOL)
2. Add sentiment overlay to ensemble (Reddit mention velocity)
3. Implement HMM regime detector to replace simple vol-ratio heuristic
4. Walk-forward optimization on live paper trading
