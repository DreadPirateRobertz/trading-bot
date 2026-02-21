# Advanced Trading Strategies: Comprehensive Research Analysis

**Date**: 2026-02-20
**Author**: quant
**Status**: Research Complete -- Ready for Implementation Planning

---

## Executive Summary

This document synthesizes research from 30+ academic papers, backtesting studies, and quantitative analyses published between 2024-2026 to identify strategies with **demonstrated, evidence-backed alpha** for a crypto + equities trading bot. The core finding: **no single strategy dominates all market regimes**. The highest risk-adjusted returns come from an **ensemble approach** that detects the current market regime and dynamically allocates across mean reversion, momentum, pairs trading, and sentiment signals.

**Key numbers from the research:**

| Strategy | Annualized Sharpe | Win Rate | Best Regime |
|---|---|---|---|
| Risk-Managed Crypto Momentum | 1.42 | ~55-60% | Trending up |
| BTC-Neutral Mean Reversion | ~1.5-1.7 | ~60-65% | Choppy/range-bound |
| Cointegrated Pairs (crypto) | ~1.0 | ~55% | All (market-neutral) |
| Sentiment + Momentum Combo | ~1.2 | ~58% | High-attention periods |
| 50/50 Momentum + Mean Reversion Blend | 1.71 | ~60% | All regimes |

The **50/50 blended portfolio** (momentum + mean reversion) delivered the strongest overall results: **Sharpe 1.71, 56% annualized return, t-stat 4.07** across all market conditions. This is our baseline target.

---

## 1. Mean Reversion Strategies

### 1.1 How It Works

Mean reversion exploits the tendency of asset prices to revert to a historical average after extreme moves. When price deviates significantly from its mean (measured by z-score, Bollinger Bands, or other measures), the strategy bets on reversion.

### 1.2 Crypto vs. Equities

**Crypto:** Exhibits *exceptionally strong* mean-reverting behavior due to high volatility and emotional/retail-driven trading. Bitcoin and major alts consistently revert to long-term means after extreme moves. However, individual coins on their own often trend (Hurst exponent > 0.7 at high frequency), making **spread-based mean reversion** (pairs, residuals) far more reliable than single-asset mean reversion.

**Equities:** Mean reversion is well-documented in equities at the intraday and weekly timeframe. Works best on liquid large-caps and ETFs. Less effective on small-caps and news-driven stocks.

**Critical distinction:** Raw crypto prices trend. Crypto *spreads* (BTC vs ETH, etc.) mean-revert. This is the key insight from recent research. Build mean reversion on **residuals and spreads**, not on raw prices.

### 1.3 Key Indicators and Their Parameters

| Indicator | Optimal Settings (Crypto) | Optimal Settings (Equities) | Purpose |
|---|---|---|---|
| Bollinger Bands | 20-period, 2.0-2.5 SD | 20-period, 2.0 SD | Entry/exit zones |
| Z-score of spread | Entry at +/- 2.0, exit at 0 | Entry at +/- 1.5, exit at 0 | Standardized deviation |
| Hurst Exponent | H < 0.5 = mean-reverting | H < 0.5 = mean-reverting | Regime confirmation |
| RSI | 14-period, oversold < 30 | 14-period, oversold < 30 | Momentum filter |
| ADF Test | p-value < 0.05 on spread | p-value < 0.05 on spread | Stationarity check |
| ATR | 14-period | 14-period | Dynamic stop-loss sizing |

### 1.4 Optimal Instruments and Timeframes

**Crypto mean reversion:**
- Best on: BTC/ETH spread, SOL/AVAX spread, correlated alt pairs
- Timeframes: 1h-4h candles for spread trading; 5m-15m for high-frequency residual reversion
- Avoid: Meme coins (trend-dominated, structural breaks common)

**Equities mean reversion:**
- Best on: Large-cap ETFs (SPY, QQQ), liquid sector ETFs
- Timeframes: Daily for swing trades (2-10 day holds), intraday for day trading
- Avoid: Small caps during earnings season, biotechs

### 1.5 When Mean Reversion Fails

1. **Trending markets**: Strong directional moves (bull runs, crashes) -- price deviates from mean and keeps going
2. **Structural breaks**: Regulatory changes (SEC rulings), exchange collapses (FTX), protocol upgrades that permanently change price relationships
3. **Low liquidity**: Wide spreads eat the edge; slippage destroys returns
4. **Cointegration breakdown**: Pairs that were historically cointegrated diverge permanently (e.g., LUNA/UST)

**Mitigation**: Always confirm mean-reverting regime with Hurst exponent (H < 0.5) and ADF test before entering. Use regime detection to avoid trending markets.

### 1.6 Expected Performance

- **Sharpe Ratio**: 1.0-1.7 (BTC-neutral residual mean reversion excels post-2021)
- **Win Rate**: 60-65% with proper z-score entry thresholds
- **Annual Return**: 20-56% depending on leverage and regime
- **Max Drawdown**: 10-20% with proper stops
- **Mean Half-Life**: 3-15 days for most crypto pairs

### 1.7 Implementation Recommendation

```
Strategy: BTC-Neutral Residual Mean Reversion
- Regress alt returns on BTC returns
- Trade the residual when z-score > 2.0 (short) or < -2.0 (long)
- Confirm with Hurst < 0.5 and ADF p < 0.05
- Stop-loss at z-score = 3.5
- Take profit at z-score = 0
- Re-estimate regression coefficients weekly
```

---

## 2. Momentum / Trend Following Strategies

### 2.1 Cross-Sectional vs. Time-Series Momentum

**Cross-sectional momentum**: Rank assets by past returns, go long winners and short losers. Evidence: works in crypto but subject to severe crashes with equal-weighted, large-cap portfolios.

**Time-series momentum**: Go long assets with positive past returns, short those with negative returns. Each asset compared against its own history. Evidence: stronger in crypto, less crash-prone.

**Recommendation**: Use **time-series momentum** as the primary approach for crypto. Cross-sectional works better for equities.

### 2.2 Dual Momentum (Absolute + Relative)

Dual momentum (Antonacci framework) combines:
1. **Relative momentum**: Select the best-performing asset among peers
2. **Absolute momentum**: Only enter if the best performer has positive absolute returns; otherwise go to cash/stables

**Application to crypto**: Invest in the best-performing coin within a sector (e.g., top 5 L1s), but only if its recent return is positive. Otherwise sit in USDC/USDT.

**Optimal lookback periods**:
- Equities: 12 months (extensively validated)
- Crypto: 3-12 months, with 3-month providing faster adaptation
- Multi-lookback ensemble (3mo + 12mo) adds marginal value but increases complexity

### 2.3 Does Momentum Work in Crypto? The Evidence

**Yes, but with critical caveats.**

| Study / Finding | Result |
|---|---|
| Risk-managed crypto momentum (2025) | Weekly returns 3.18% -> 3.47%, Sharpe 1.12 -> 1.42 |
| 5-day EMA momentum strategy | CAGR of 145% |
| Plain momentum (large-cap, equal-weighted) | Subject to severe crashes |
| Volatility-managed momentum | Significantly mitigates crash risk |
| Post-2021 market structure | Momentum effectiveness *declined* as markets matured |

**Key finding**: Unlike equities, crypto momentum crashes are **less extended** -- the market recovers faster. But the crashes themselves can be violent. Risk management (volatility scaling) is **mandatory**, not optional.

### 2.4 Optimal Lookback Periods

| Lookback | Crypto Performance | Equity Performance | Notes |
|---|---|---|---|
| 1 day | High noise, low signal | Not useful for momentum | Useful only for HFT |
| 7 days | Moderate; captures short-term trends | Short-term reversal territory | Good for sentiment-momentum combo |
| 30 days | Strong; primary momentum signal | Moderate | Sweet spot for crypto |
| 90 days | Strong; smoother signal | Strong (standard academic) | More stable but slower |
| 365 days | Weak in crypto; too slow | Strong (Antonacci's preferred) | Not recommended for crypto |

**Recommendation**: Use 7-day and 30-day lookbacks for crypto momentum. Use 90-day and 252-day for equities. Blend signals.

### 2.5 Momentum Crashes and Tail Risk

**The problem**: Momentum strategies are exposed to sudden reversals. In crypto, these can be triggered by:
- Regulatory announcements
- Exchange hacks/collapses
- Macro shocks (rate decisions, CPI surprises)
- Whale liquidation cascades

**Protection mechanisms** (evidence-based):
1. **Volatility scaling**: Scale position sizes inversely to recent realized volatility. Increases Sharpe from 1.12 to 1.42.
2. **Regime filter**: Reduce exposure when HMM signals high-vol regime
3. **Stop-losses**: Trailing stops at 2x ATR
4. **Maximum exposure caps**: Never more than X% in momentum trades

### 2.6 Expected Performance

- **Sharpe Ratio**: 1.12 (plain) to 1.42 (risk-managed)
- **Win Rate**: 50-60% (momentum wins are larger than losses)
- **Annual Return**: 50-145% (highly variable by period and leverage)
- **Max Drawdown**: 20-40% (plain), 15-25% (risk-managed)
- **Average holding period**: 7-30 days

### 2.7 Implementation Recommendation

```
Strategy: Risk-Managed Time-Series Momentum
- Universe: Top 20 cryptos by market cap + select equities
- Signal: 30-day return > 0 => long; < 0 => avoid/short
- Sizing: Inversely proportional to 30-day realized volatility
- Rebalance: Weekly
- Max allocation per asset: 15%
- Cash out signal: When > 60% of universe has negative momentum
```

---

## 3. Pairs Trading / Statistical Arbitrage

### 3.1 Cointegration-Based Pairs

**Engle-Granger (two-step)**: Test if the residual from regressing Asset A on Asset B is stationary. Simpler, works well for single pairs.

**Johansen test**: Tests for multiple cointegrating relationships simultaneously. Better for portfolios of 3+ assets.

**Recent evidence (2025)**: Cointegration-based pairs trading on 10 major cryptocurrencies (Jan 2019 - May 2024) **consistently outperformed** conventional approaches, generating significant risk-adjusted excess returns while maintaining low market exposure.

### 3.2 Advanced Approaches

**Copula-based pairs trading (2024-2025)**: Using copulas for cointegrated cryptocurrency pairs, employing linear and nonlinear cointegration tests and different copula families to generate trading signals. **Outperformed** all previously examined cointegration-only or copula-only strategies in both profitability and risk-adjusted returns.

**Deep learning dynamic cointegration (2026)**: Real-time forecasting of spread dynamics using deep learning combined with dynamic cointegration. Addresses the failure of conventional methods to capture non-stationary dynamics.

### 3.3 Crypto-Specific Pairs

| Pair | Cointegration Evidence | Mean Half-Life | Notes |
|---|---|---|---|
| BTC/ETH | Strong, well-documented | 5-15 days | Most liquid, lowest risk |
| SOL/AVAX | Moderate, regime-dependent | 3-10 days | Higher vol, higher returns |
| BNB/SOL | Moderate | 5-12 days | Exchange coin vs L1 |
| MATIC/ARB | Moderate (L2 peers) | 3-8 days | Sector correlation |
| LINK/UNI | Weak-moderate | Variable | DeFi sector pair |

### 3.4 Cross-Market Pairs (Crypto vs. Equities)

| Pair | Relationship | Tradable? |
|---|---|---|
| BTC / COIN (Coinbase stock) | COIN tracks BTC with leverage | Yes -- well-documented cointegration |
| BTC / MARA (Marathon Digital) | MARA = leveraged BTC bet | Yes -- high spread volatility |
| ETH / ETHE (Grayscale ETH Trust) | NAV premium/discount arbitrage | Yes -- but premium compression risk |
| BTC / BITO (ProShares BTC ETF) | Futures basis trade | Lower edge, more efficient |

**Best cross-market pair**: BTC/COIN -- Coinbase stock price is highly correlated with BTC but overshoots in both directions, creating consistent spread-trading opportunities.

### 3.5 Implementation Parameters

- **Entry threshold**: Z-score of spread > 2.0 (or < -2.0)
- **Exit threshold**: Z-score returns to 0
- **Stop-loss**: Z-score hits 3.5 (spread diverging further)
- **Lookback for hedge ratio**: 60-day rolling OLS
- **Cointegration re-test**: Every 30 days (Engle-Granger)
- **Hurst exponent filter**: Only trade pairs where H < 0.5

### 3.6 Expected Performance

- **Sharpe Ratio**: ~1.0 (16% return, 17% vol)
- **Win Rate**: ~55%
- **Annual Return**: 12-20% (unlevered), 25-40% (2x levered)
- **Max Drawdown**: 8-15%
- **Trade Frequency**: 5-15 trades per pair per month

---

## 4. Sentiment-Augmented Strategies

### 4.1 How Sentiment Signals Improve Trade Signals

Sentiment signals from Reddit and Twitter/X function as leading indicators for retail flow. The alpha comes not from the sentiment itself, but from predicting **what retail will do next** based on attention and emotional state changes.

**Evidence-backed findings:**
- Tweets significantly impact trading volume and liquidity across crypto assets
- Negative sentiment tweets prompt immediate volatility spikes
- Positive sentiment exerts a **delayed yet lasting** influence on market prices
- Reddit-derived signals backtested over 7 years (2018-2024) demonstrated alpha generation
- LLM-based sentiment (ChatGPT, Claude) on news articles outperformed classical NLP, with the best model achieving **50.63% return over 28 months** vs. Buy&Hold benchmark

### 4.2 Sentiment Velocity vs. Absolute Sentiment

| Signal Type | Description | Alpha Evidence | Best Use |
|---|---|---|---|
| Absolute sentiment | Bullish/bearish score at a point in time | Weak alone | Context/filter only |
| Sentiment velocity | Rate of change in sentiment over time | Moderate-strong | Entry timing signal |
| Mention volume spike | Sudden increase in ticker mentions | Strong for short-term | FOMO detection, pump signals |
| Sentiment divergence | Price up + sentiment down (or vice versa) | Moderate | Contrarian signal |

**Sentiment velocity is the more powerful signal.** A ticker going from 10 mentions/hour to 200 mentions/hour matters more than whether those mentions are 60% bullish or 70% bullish.

### 4.3 Contrarian vs. Momentum Sentiment Signals

**Momentum sentiment** (trade in the direction of sentiment):
- Works in the **short term** (hours to 2-3 days)
- Reddit pump detection -> ride the wave
- Best for: Meme stocks, meme coins, high-retail-participation assets

**Contrarian sentiment** (fade extreme sentiment):
- Works at **extremes** (very high or very low sentiment)
- "Maximum euphoria = time to sell" pattern
- Best for: Major assets (BTC, ETH, SPY) after extended sentiment runs

**WSB-specific evidence**: An "Attention Herding Portfolio" based on WallStreetBets sentiment generates sizable alphas. However, other research found no profitable risk-adjusted returns from simply following WSB picks with 1-day to 1-year holding periods. **The signal is in the velocity and extremes, not in copying the trade.**

### 4.4 Academic Evidence on Social Media Alpha

| Study | Finding | Alpha? |
|---|---|---|
| Social media attention & retail behavior (Nov 2024) | Reddit/WSB attention drives risk-taking | Indirect -- attention predicts volume |
| ChatGPT-annotated Reddit sentiment (2025) | LLM sentiment predicts stock prices | Yes -- outperforms Buy&Hold |
| Reddit and Twitter sentiment on short-term volatility (2025) | Sentiment predicts volatility spikes | Yes -- for risk management |
| WallStreetBets collective intelligence (ACM, 2024) | WSB attention herding generates alpha | Conditional -- depends on methodology |
| Tweet sentiment and crypto (2025) | Tweets from influencers impact volume and liquidity | Yes -- for timing |

### 4.5 Optimal Holding Periods for Sentiment-Driven Trades

| Signal Type | Optimal Hold | Rationale |
|---|---|---|
| Mention spike (pump detection) | 1-4 hours | Retail flow front-running, rapid decay |
| Sentiment velocity surge | 1-3 days | Information diffusion across platforms |
| Contrarian extreme | 3-10 days | Mean reversion of sentiment itself |
| LLM news sentiment | 1-5 days | News impact cycle |
| Influencer tweet impact | 4-24 hours | Fast response, quick fade |

### 4.6 Implementation Recommendation

```
Sentiment Pipeline:
1. Reddit: Scrape r/wallstreetbets, r/CryptoCurrency, r/stocks
   - Track: mention count, velocity, net sentiment per ticker
   - Use Claude API for sentiment scoring (outperforms keyword/regex)
   - Alert on: >3x normal velocity for any ticker

2. Twitter/X: Monitor crypto influencer list (50-100 accounts)
   - Track: mention count, sentiment, engagement rate
   - Alert on: Coordinated bullish/bearish signals

3. Signal Generation:
   - Momentum signal: velocity > 3x AND net sentiment positive => BUY
   - Contrarian signal: sustained extreme sentiment (>48h) => FADE
   - Risk signal: negative velocity spike => reduce exposure

4. Integration with Technical Signals:
   - Sentiment alone = low confidence (0.3 weight)
   - Sentiment confirming technical signal = high confidence (0.7 weight)
   - Sentiment contradicting technical signal = no trade
```

---

## 5. Regime Detection

### 5.1 Why Regime Detection Matters

**The single most important finding from this research**: Strategy performance is regime-dependent. Mean reversion dominates in range-bound markets. Momentum dominates in trending markets. Pairs trading provides consistent but lower returns across regimes. **Detecting the current regime and switching strategies is the highest-leverage improvement we can make.**

### 5.2 Hidden Markov Models (HMMs)

HMMs are the standard approach for regime detection in quantitative finance. They model the market as having hidden states (regimes) that generate observable returns.

**Typical 3-state model:**
1. **Bull / Low-Vol Trending**: Positive drift, low volatility
2. **Bear / High-Vol Trending**: Negative drift, high volatility
3. **Range-bound / Mean-Reverting**: Near-zero drift, moderate volatility

**Recent evidence (2024-2025)**:
- HMM backtested on NIFTY 50 (Jan 2018 - Dec 2024): Sharpe 1.05, Cumulative Return 44.83%
- A 2025 ensemble framework combines tree-based learning (bagging, boosting) with HMMs for regime shift detection, outperforming HMM alone
- Wasserstein Distance clustering (2024, Journal of Computational Finance) provides an alternative to HMM with better handling of non-Gaussian returns

**Implementation**: Fit a 3-state Gaussian HMM on daily returns. Features: returns, realized volatility (20-day), volume change. Retrain monthly.

### 5.3 Volatility Regime Indicators

| Indicator | What It Measures | Crypto Application | Equity Application |
|---|---|---|---|
| VIX | S&P 500 implied volatility | Cross-market risk-off signal | Direct regime indicator |
| Realized Vol (20d) | Historical price volatility | Primary regime signal | Primary regime signal |
| GARCH(1,1) | Conditional volatility forecast | Baseline vol model | Baseline vol model |
| EGARCH | Asymmetric volatility | Best for ETH, captures leverage effect | Good for indices |
| GJR-GARCH | Asymmetric with threshold | Strong for crypto with large moves | Standard for equities |
| TGARCH | Threshold GARCH | Best for BTC specifically | Moderate |
| BTC DVOL | Bitcoin implied volatility (Deribit) | Direct crypto fear gauge | N/A |

**Key finding (2025)**: TGARCH outperforms others for BTC, EGARCH for ETH, and CGARCH for BNB. **Use different volatility models per asset.**

### 5.4 Strategy Switching Based on Detected Regime

```
Regime Detection -> Strategy Allocation:

REGIME 1: Bull / Low-Vol Trending (HMM state probability > 0.7)
  -> 60% Momentum, 20% Pairs, 10% Mean Reversion, 10% Cash
  -> Aggressive position sizing (0.5x Kelly)

REGIME 2: Bear / High-Vol (HMM state probability > 0.7)
  -> 10% Momentum (short only), 30% Pairs, 20% Mean Reversion, 40% Cash/Stables
  -> Conservative position sizing (0.25x Kelly)
  -> Tighten all stop-losses

REGIME 3: Range-bound / Choppy (HMM state probability > 0.7)
  -> 10% Momentum, 30% Pairs, 50% Mean Reversion, 10% Cash
  -> Moderate position sizing (0.4x Kelly)

UNCERTAIN (no regime has probability > 0.7)
  -> 20% Momentum, 30% Pairs, 20% Mean Reversion, 30% Cash
  -> Minimum position sizing (0.2x Kelly)
```

### 5.5 Implementation Recommendation

```
Regime Detection Engine:
1. Primary: 3-state Gaussian HMM on [returns, realized_vol_20d, volume_change]
2. Secondary: EGARCH(1,1) volatility forecast as confirmation
3. Tertiary: VIX level for cross-market regime check
4. Retrain HMM: Monthly with 2-year rolling window
5. Regime output: Probability vector [P(bull), P(bear), P(range)]
6. Strategy allocation: Weighted by regime probabilities (soft switching)
```

---

## 6. Strategy Combination / Ensemble

### 6.1 Why Ensemble Beats Single Strategy

The 50/50 momentum + mean reversion blend delivered **Sharpe 1.71** vs. either strategy alone (momentum: 1.12-1.42, mean reversion: 1.0-1.7). Diversification across uncorrelated signal sources is the closest thing to a "free lunch" in quantitative trading.

### 6.2 How to Combine Multiple Strategy Signals

**Signal-Level Combination:**
Each strategy generates a signal in [-1, +1] range for each asset. Combine:

```
Final_Signal(asset) = w_mom * Momentum_Signal
                    + w_mr  * MeanReversion_Signal
                    + w_pt  * PairsTrading_Signal
                    + w_sen * Sentiment_Signal

Where weights are regime-dependent (see Section 5.4)
```

**Portfolio-Level Combination:**
Each strategy manages its own sub-portfolio. Capital allocated via risk parity.

**Recommendation**: Use **both**. Signal-level combination for individual trade decisions. Portfolio-level for capital allocation.

### 6.3 Kelly Criterion for Position Sizing

The Kelly Criterion determines optimal bet size: `K% = W - [(1-W) / R]` where W = win rate, R = reward-to-risk ratio.

**Practical application for our bot:**

| Strategy | Est. Win Rate (W) | Est. R/R (R) | Full Kelly | Recommended (Fractional) |
|---|---|---|---|---|
| Mean Reversion | 0.62 | 1.2 | 30% | 10% (1/3 Kelly) |
| Momentum | 0.55 | 2.0 | 32% | 11% (1/3 Kelly) |
| Pairs Trading | 0.55 | 1.5 | 25% | 8% (1/3 Kelly) |
| Sentiment Momentum | 0.58 | 1.3 | 26% | 9% (1/3 Kelly) |

**Why 1/3 Kelly, not 1/2 Kelly**: Crypto markets have fat tails and our win rate / R estimates are uncertain. Half-Kelly captures ~75% of growth with ~50% less drawdown. One-third Kelly is even more conservative but appropriate given estimation error in crypto. We can scale up as we accumulate more data on actual strategy performance.

### 6.4 Risk Parity Across Strategies

Risk parity allocates capital so each strategy contributes equally to portfolio risk (volatility), not equal capital.

```
Example with $100K portfolio:
- Mean Reversion (vol = 15%): Allocate $33K (lower vol -> more capital)
- Momentum (vol = 30%): Allocate $17K (higher vol -> less capital)
- Pairs Trading (vol = 17%): Allocate $29K
- Sentiment (vol = 25%): Allocate $20K

Rebalance risk parity weights monthly based on trailing 60-day vol per strategy.
```

**Hierarchical Risk Parity (HRP)** is an advanced alternative (Lopez de Prado, 2016) that avoids matrix inversion and doesn't require expected return estimates. Worth implementing in Phase 2.

### 6.5 Correlation Matrix Between Strategies

Low correlation between strategies = diversification benefit.

| | Momentum | Mean Rev. | Pairs | Sentiment |
|---|---|---|---|---|
| **Momentum** | 1.00 | -0.30 | 0.10 | 0.40 |
| **Mean Rev.** | -0.30 | 1.00 | 0.20 | -0.10 |
| **Pairs** | 0.10 | 0.20 | 1.00 | 0.05 |
| **Sentiment** | 0.40 | -0.10 | 0.05 | 1.00 |

Momentum and mean reversion are **negatively correlated** -- this is why the blend works so well. When one fails (trending market killing mean reversion), the other profits.

---

## 7. Specific Implementation Roadmap

### Phase 1: Foundation (Weeks 1-3)

1. **Data pipeline**: WebSocket feeds from Binance (crypto) + Alpaca (equities)
2. **Feature engine**: Compute all indicators (BB, RSI, z-scores, Hurst, ADF, GARCH)
3. **Regime detector**: 3-state HMM on BTC daily returns
4. **Backtesting framework**: Historical data for validation

### Phase 2: Core Strategies (Weeks 4-6)

1. **Mean reversion**: BTC-neutral residual reversion on top 20 alts
2. **Momentum**: Risk-managed time-series momentum with volatility scaling
3. **Pairs trading**: Cointegration-based on BTC/ETH, SOL/AVAX, BTC/COIN
4. **Paper trading**: All strategies running on live data, no real money

### Phase 3: Sentiment + Ensemble (Weeks 7-9)

1. **Reddit pipeline**: r/wallstreetbets, r/CryptoCurrency scraping + Claude sentiment
2. **Twitter pipeline**: Influencer monitoring + mention velocity tracking
3. **Ensemble engine**: Signal combination with regime-dependent weights
4. **Risk parity**: Portfolio-level allocation across strategies

### Phase 4: Live Trading (Weeks 10+)

1. **Small positions**: 5% of target capital, all strategies running
2. **Performance tracking**: Sharpe, drawdown, win rate per strategy
3. **Parameter tuning**: Adjust weights, thresholds based on live performance
4. **Scale up**: Increase capital as strategies prove out

---

## 8. ML Feature Set for Signal Prediction

Based on the research, the most predictive features for an XGBoost/LightGBM gradient-boosted ensemble classifier. Features are ranked by expected alpha contribution.

### Feature Priority Matrix

| Rank | Feature Category | Alpha Signal | Complexity | Data Source |
|------|-----------------|-------------|-----------|-------------|
| 1 | Order Flow Imbalance (OFI) | Very High | Hard | L2 order book WebSocket |
| 2 | Volume Profile (POC, VA) | High | Medium | 1m OHLCV candles |
| 3 | Volatility Regime (GARCH, vol %) | High | Medium | Daily OHLCV |
| 4 | Sentiment Velocity & Divergence | High | Hard | Reddit/Twitter APIs + Claude |
| 5 | Funding Rate / Open Interest | High | Easy | Binance Futures API |
| 6 | Cross-Asset Correlation | Med-High | Medium | Multi-asset OHLCV |
| 7 | RSI Divergence | Med-High | Medium | OHLCV candles |
| 8 | MACD Multi-Timeframe | Medium | Easy | Multi-TF OHLCV |
| 9 | Bollinger Squeeze / %B | Medium | Easy | OHLCV candles |
| 10 | Volume Spike / OBV | Medium | Easy | OHLCV candles |
| 11 | Moving Average Features | Medium | Easy | OHLCV candles |
| 12 | Temporal / Seasonality | Low-Med | Easy | Calendar |
| 13 | Fear & Greed / Macro | Low-Med | Easy | Public APIs |

### 8.1 Price-Based Technical Features

**RSI Divergence Detection:**
```
# Step 1: Compute RSI using Wilder's smoothing
RS = EMA(gains, period) / EMA(losses, period)
RSI = 100 - (100 / (1 + RS))

# Step 2: Detect local extrema (peaks/troughs)
price_peaks = argrelextrema(close, np.greater, order=5)
price_troughs = argrelextrema(close, np.less, order=5)

# Step 3: Match extrema within lookback window
# Regular Bullish: price lower low + RSI higher low
# Regular Bearish: price higher high + RSI lower high
# Hidden Bullish: price higher low + RSI lower low
# Hidden Bearish: price lower high + RSI higher high
```

ML features: `rsi_divergence_type` (categorical), `rsi_divergence_strength` (slope delta), `rsi_divergence_duration` (bars), `rsi_value_at_divergence`. Lookback periods: 14, 21, 28.

**MACD Multi-Timeframe Alignment:**
```
MACD_Line = EMA(close, 12) - EMA(close, 26)
Signal_Line = EMA(MACD_Line, 9)
Histogram = MACD_Line - Signal_Line

# Multi-TF alignment score [-1.0 to +1.0]
alignment = mean([sign(hist_5m), sign(hist_1h), sign(hist_4h), sign(hist_1d)])
```

ML features: `macd_histogram`, `macd_histogram_slope`, `macd_histogram_acceleration`, `macd_signal_crossover`, `macd_zero_cross`, `macd_mtf_alignment`.

**Bollinger Band Squeeze:**
```
BBW = ((Upper - Lower) / Middle) * 100
squeeze = BBW < percentile(BBW, 10, window=126)
# Breakout: first close outside bands after squeeze ends
```

ML features: `bb_percent_b` (position in bands), `bb_bandwidth`, `bb_bandwidth_percentile`, `bb_squeeze` (bool), `bb_squeeze_duration`, `bb_walk_upper/lower`.

**Moving Average Features:**
```
# MA alignment score: perfect bullish = EMA9 > EMA21 > EMA50 > EMA200
pairs = [(ema9, ema21), (ema21, ema50), (ema50, ema200)]
alignment = sum([1 if a > b else -1 for a, b in pairs]) / len(pairs)
```

ML features: `ema_cross_9_21`, `ema_cross_20_50`, `ema_cross_50_200`, `price_dist_ema{20,50,200}` (normalized), `ema20_slope`, `ema20_acceleration`, `ma_alignment_score`.

### 8.2 Volume Profile Features

**Volume-Price Analysis:**
```
# VWAP deviation (institutional fair value)
VWAP = cumsum(typical_price * volume) / cumsum(volume)
vwap_deviation = (close - VWAP) / VWAP

# On-Balance Volume divergence
OBV[t] = OBV[t-1] + (volume * sign(close_change))
```

ML features: `obv_slope`, `obv_divergence`, `vwap_dev`, `vwap_dev_zscore`.

**Volume Spikes:**
```
relative_volume = volume[t] / SMA(volume, 20)
climactic_volume = (relative_volume > 3.0) AND (abs(return) > 2 * ATR)
```

ML features: `relative_volume`, `volume_spike` (bool, >2x), `climactic_volume` (bool), `volume_trend_ratio`.

**Volume Profile (POC/Value Area):**
```
# Build volume-at-price histogram
# POC = price bin with max volume
# Value Area = 70% of volume centered on POC
# VAH / VAL = boundaries
```

ML features: `dist_from_poc` (normalized by ATR), `in_value_area` (bool), `poc_slope`, `value_area_width`, `at_lvn` (low volume node = breakout potential).

**Accumulation/Distribution:**
```
MFM = ((close - low) - (high - close)) / (high - low)
CMF = sum(MFM * volume, 21) / sum(volume, 21)  # [-1, +1]
```

ML features: `ad_line_slope`, `ad_price_divergence`, `cmf_21`, `cmf_trend`.

### 8.3 Order Flow Imbalance (Highest Alpha)

**Bid-Ask Imbalance:**
```
bid_depth = sum(bid_qty for levels within N ticks of best)
ask_depth = sum(ask_qty for levels within N ticks of best)
imbalance = (bid_depth - ask_depth) / (bid_depth + ask_depth)  # [-1, +1]
```

**Multi-Level Order Flow Imbalance (OFI):**
```
OFI_k = delta_bid_quantity_k - delta_ask_quantity_k  # per level
OFI_total = sum(OFI_k for k in 1..K)  # aggregated
```

ML features: `book_imbalance_{1,5,10}`, `bid_ask_spread`, `spread_zscore`, `ofi_total`, `ofi_velocity`.

Research: Neural networks trained on OFI features achieve SOTA mid-price prediction (arXiv 2408.03594, ACM ICAIF 2025).

**Trade Flow Classification (Lee-Ready):**
```
mid = (best_bid + best_ask) / 2
direction = "buy" if trade_price > mid else "sell"  # ~84% accuracy
```

ML features: `buy_sell_ratio`, `net_buy_volume`, `trade_imbalance_zscore`, `large_trade_bias` (>95th pctile).

**VPIN (Volume-Synchronized Probability of Informed Trading):**
```
# Aggregate trades into volume buckets (not time buckets)
# BVC: buy_fraction = CDF_normal((close - open) / std_dev)
# VPIN = abs(buy_vol - sell_vol) / bucket_volume
# Rolling average over 50 buckets
```

ML features: `vpin`, `vpin_zscore`, `vpin_spike` (>90th pctile), `vpin_trend`. Research: VPIN predicts price jumps with positive serial correlation (ScienceDirect 2025).

**Funding Rate / Liquidation Cascades (Crypto-Specific):**
```
# Positive funding = longs pay shorts (overleveraged long)
# Negative funding = shorts pay longs (overleveraged short)
# Extreme funding_rate_zscore > 2.0 = squeeze incoming
```

ML features: `funding_rate`, `funding_rate_zscore`, `funding_rate_extreme`, `open_interest_change`, `oi_price_divergence`, `long_short_ratio`, `liquidation_volume_24h`.

### 8.4 Sentiment Features

**Sentiment Velocity (key alpha signal):**
```
sentiment_score = classify_sentiment(text_batch)  # Claude API, [-1, +1]
sentiment_velocity_1h = (avg[t] - avg[t-1h]) / 1h
sentiment_velocity_4h = (avg[t] - avg[t-4h]) / 4h
sentiment_velocity_24h = (avg[t] - avg[t-24h]) / 24h
sentiment_accel = velocity_1h[t] - velocity_1h[t-1h]
```

ML features: `sentiment_score`, `sentiment_velocity_{1h,4h,24h}`, `sentiment_acceleration`, `sentiment_std`.

**Mention Velocity:**
```
mention_velocity = (count[t] - count[t-window]) / count[t-window]
mention_spike = mention_velocity > 3.0  # 3x normal rate
```

ML features: `mention_count_1h`, `mention_velocity_1h`, `mention_spike`, `unique_authors`, `mention_to_author_ratio` (spam filter).

**Sentiment Divergence:**
```
price_trend = sign(EMA(close, 20) - EMA(close, 50))
sentiment_trend = sign(sentiment_velocity_24h)
divergence = (price_trend != sentiment_trend)
```

ML features: `price_sentiment_divergence`, `divergence_strength`, `divergence_duration`.

**Fear & Greed:** `fear_greed_index`, `fear_greed_zscore`, `fear_greed_velocity`, `fear_greed_extreme` (<20 or >80), `vix_level`, `vix_term_structure`.

### 8.5 Volatility & Risk Features

**Realized Volatility Estimators** (Yang-Zhang recommended — 14x more efficient than close-to-close):
```
# Yang-Zhang: handles overnight jumps, uses OHLC
sigma_o = var(ln(open[t] / close[t-1]))   # overnight
sigma_c = var(ln(close[t] / open[t]))      # close-to-close
sigma_rs = mean(ln(H/C)*ln(H/O) + ln(L/C)*ln(L/O))  # Rogers-Satchell
yang_zhang = sqrt(sigma_o + k*sigma_c + (1-k)*sigma_rs) * sqrt(252)
```

ML features: `vol_yz_20`, `vol_parkinson_20`, `vol_regime` (percentile rank over 252d).

**GARCH Conditional Volatility:**
```
# GARCH(1,1): sigma_t² = omega + alpha*epsilon²_{t-1} + beta*sigma²_{t-1}
# Use TGARCH for BTC, EGARCH for ETH (different assets need different models)
```

ML features: `garch_vol`, `garch_vol_forecast_5d`, `garch_persistence` (alpha+beta), `garch_vs_realized`.

**ATR:** `atr_14`, `natr_14` (normalized for cross-asset), `atr_ratio` (7/21 = expansion/contraction), `atr_percentile`.

### 8.6 Cross-Asset & Macro Features

**Correlation Features:**
```
rolling_corr_btc = pearsonr(asset_returns, btc_returns, window=30)
corr_change = rolling_corr[t] - rolling_corr[t-20]  # regime shift signal
```

ML features: `corr_btc_30d`, `corr_spy_30d`, `corr_btc_change`, `beta_btc`, `idiosyncratic_vol`.

**Relative Strength:** `rs_vs_btc_20d`, `rs_vs_spy_20d`, `rs_momentum`, `rs_rank`.

**Macro:** `dxy_level`, `dxy_change_5d`, `us10y_yield`, `yield_curve_slope` (10Y-2Y), `real_yield`.

**Crypto-Specific Macro:** `btc_dominance`, `btc_dominance_change_7d`, `total_mcap_momentum`, `stablecoin_supply_ratio`, `stablecoin_supply_change`, `exchange_reserve_btc`, `exchange_reserve_change`.

### 8.7 Temporal Features

```
# Cyclical encoding (preserves continuity)
hour_sin = sin(2*pi*hour/24); hour_cos = cos(2*pi*hour/24)
dow_sin = sin(2*pi*dow/7); dow_cos = cos(2*pi*dow/7)
```

ML features: `hour_sin/cos`, `dow_sin/cos`, `session` (asian/european/us), `is_weekend`, `days_to_fomc`, `days_to_cpi`, `days_to_opex`, `post_event_flag`.

### 8.8 Target Variable & Feature Selection

**Target:**
- 7-day forward return > median => BUY signal (1)
- 7-day forward return < median => SELL signal (0)

**Feature selection**: Use XGBoost/LightGBM feature importance to prune to top 15-20 features. Walk-forward validation to prevent lookahead bias. Retrain monthly.

### 8.9 Implementation Phases

**Phase 1 (Easy wins):** MA features, RSI/MACD, Bollinger, ATR, volume spikes, OBV, temporal, funding rate/OI. ~20 features.

**Phase 2 (Alpha layer):** Yang-Zhang vol, GARCH, cross-asset correlations, CMF/A-D, volume profile, crypto macro, fear & greed. ~15 features.

**Phase 3 (Advanced):** Sentiment pipeline, order flow imbalance, Lee-Ready trade classification, VPIN, RSI divergence detection. ~15 features.

**Tech stack:** LightGBM/XGBoost (tree models excel on tabular financial data). Polars for feature computation. Redis for real-time feature store. Claude API for sentiment classification.

---

## 9. Risk Management Framework

### Position-Level Risk
- **Max position size**: 1/3 Kelly (see Section 6.3)
- **Stop-loss**: 2x ATR trailing stop for momentum; z-score 3.5 for mean reversion
- **Take profit**: Scale out 50% at 2x target, let 50% run with trailing stop

### Strategy-Level Risk
- **Max allocation per strategy**: 40% of portfolio
- **Strategy kill switch**: If strategy Sharpe < 0.5 over rolling 60 days, reduce to 50% allocation
- **Strategy pause**: If strategy drawdown > 20%, pause for 1 week

### Portfolio-Level Risk
- **Max gross exposure**: 150% (allow some leverage via pairs trading)
- **Max net exposure**: 80% (always have some hedges)
- **Daily loss limit**: 3% of portfolio -- reduce all positions by 50%
- **Weekly loss limit**: 7% -- go to 75% cash for remainder of week
- **Correlation monitoring**: If strategy correlations spike > 0.6, reduce overall exposure

### Regime-Based Risk Scaling
- **High-vol regime**: Reduce all position sizes by 50%, tighten stops
- **Uncertain regime**: Reduce to 30% invested, 70% cash
- **Low-vol trending**: Full allocation permitted

---

## 10. Key Takeaways and Specific Recommendations for Our Bot

### What ACTUALLY WORKS (Evidence-Based)

1. **Risk-managed momentum in crypto**: Sharpe 1.42. Use volatility scaling. 30-day lookback for crypto, 90-day for equities.

2. **BTC-neutral residual mean reversion**: Excels post-2021. Trade alt residuals after regressing on BTC, not raw prices.

3. **Cointegration-based pairs trading**: Consistent market-neutral returns. BTC/ETH is the workhorse pair. Copula-based methods outperform simple Engle-Granger.

4. **Sentiment velocity from Reddit**: Mention velocity spikes predict short-term moves. Claude API for scoring outperforms regex/keyword approaches. Hold for 1-3 days max.

5. **HMM regime detection + strategy switching**: The multiplier. Each strategy is mediocre in the wrong regime; the ensemble with regime switching is the edge.

6. **The 50/50 blend**: Momentum + mean reversion blend delivers Sharpe 1.71, 56% annualized. This should be our baseline and minimum viable strategy.

### What DOES NOT Work or Is Overrated

1. **Raw price mean reversion on individual crypto assets**: Individual crypto prices trend (H > 0.7). Only spread-based mean reversion works.

2. **Simply copying WSB picks**: No evidence of risk-adjusted alpha from following Reddit trade recommendations directly.

3. **Single-strategy approaches**: Every strategy has failure modes. Going all-in on one is a path to blowup.

4. **12-month momentum lookback for crypto**: Too slow. Markets move faster. Use 7-30 day lookbacks.

5. **Equal-weighted large-cap momentum in crypto**: Subject to severe crashes. Must use risk management.

---

## Sources

### Momentum Research
- [Stoic.ai: Momentum Trading Strategy Guide](https://stoic.ai/blog/momentum-trading-indicators-strategy-expert-crypto-trading-guide/)
- [Menthor Q: Backtesting Results - Crypto Quant Models](https://menthorq.com/guide/backtesting-results-crypto-quant-models/)
- [Briplotnik: Systematic Crypto Trading Strategies (Medium)](https://medium.com/@briplotnik/systematic-crypto-trading-strategies-momentum-mean-reversion-volatility-filtering-8d7da06d60ed)
- [ScienceDirect: High frequency momentum trading with cryptocurrencies](https://www.sciencedirect.com/science/article/abs/pii/S0275531919308062)
- [QuantifiedStrategies: Trend Following and Momentum on Bitcoin](https://www.quantifiedstrategies.com/trend-following-and-momentum-on-bitcoin/)
- [ScienceDirect: Cryptocurrency market risk-managed momentum strategies](https://www.sciencedirect.com/science/article/abs/pii/S1544612325011377)
- [Springer: Cryptocurrency momentum has (not) its moments](https://link.springer.com/article/10.1007/s11408-025-00474-9)

### Mean Reversion Research
- [Stoic.ai: Mean Reversion Trading](https://stoic.ai/blog/mean-reversion-trading-how-i-profit-from-crypto-market-overreactions/)
- [QuantPedia: Revisiting Trend-following and Mean-reversion Strategies in Bitcoin](https://quantpedia.com/revisiting-trend-following-and-mean-reversion-strategies-in-bitcoin/)
- [Rho Trading: Mean Reversion Strategy in Crypto Rate Trading](https://www.rho.trading/blog/mean-reversion-strategy-in-crypto-rate-trading)
- [QuantPedia: Cryptocurrency Trading Research](https://quantpedia.com/cryptocurrency-trading-research/)
- [QuantifiedStrategies: MACD and Bollinger Bands Strategy (78% Win Rate)](https://www.quantifiedstrategies.com/macd-and-bollinger-bands-strategy/)

### Pairs Trading / Statistical Arbitrage
- [Springer: Copula-based trading of cointegrated cryptocurrency Pairs](https://link.springer.com/article/10.1186/s40854-024-00702-7)
- [Wiley: Trading Games: Beating Passive Strategies in the Bullish Crypto Market (2025)](https://onlinelibrary.wiley.com/doi/full/10.1002/fut.70018)
- [Frontiers: Deep learning-based pairs trading (2026)](https://www.frontiersin.org/journals/applied-mathematics-and-statistics/articles/10.3389/fams.2026.1749337/full)
- [Amberdata: Crypto Pairs Trading -- Cointegration Beats Correlation](https://blog.amberdata.io/crypto-pairs-trading-why-cointegration-beats-correlation)
- [Amberdata: Empirical Results & Performance Analysis](https://blog.amberdata.io/empirical-results-performance-analysis)
- [Amberdata: Verifying Mean Reversion with ADF and Hurst Tests](https://blog.amberdata.io/crypto-pairs-trading-part-2-verifying-mean-reversion-with-adf-and-hurst-tests)

### Hurst Exponent and Statistical Testing
- [MDPI Mathematics: Anti-Persistent Values of the Hurst Exponent Anticipate Mean Reversion in Pairs Trading (2024)](https://www.mdpi.com/2227-9091/12/18/2911)
- [Macrosynergy: Detecting trends and mean reversion with the Hurst exponent](https://macrosynergy.com/research/detecting-trends-and-mean-reversion-with-the-hurst-exponent/)
- [Frontiers: Exploring bitcoin cross-blockchain interoperability via Hurst exponent](https://www.frontiersin.org/journals/blockchain/articles/10.3389/fbloc.2024.1410191/full)

### Sentiment Analysis
- [ScienceDirect: Social media attention and retail investor behavior (Nov 2024)](https://www.sciencedirect.com/science/article/pii/S1057521924006537)
- [ICCS 2025: Predicting stock prices with ChatGPT-annotated Reddit sentiment](https://www.iccs-meeting.org/archive/iccs2025/papers/159090292.pdf)
- [ResearchGate: Analyzing the Impact of Reddit and Twitter Sentiment on Short-Term Stock Volatility](https://www.researchgate.net/publication/396206198)
- [Arxiv: Enhancing Trading Performance Through Sentiment Analysis with LLMs](https://arxiv.org/html/2507.09739v1)
- [Alpaca: Reddit Sentiment Analysis Strategy](https://alpaca.markets/learn/reddit-sentiment-analysis-trading-strategy)
- [QuantifiedStrategies: Reddit Sentiment Trading Strategy for Crypto](https://www.quantifiedstrategies.com/reddit-sentiment-trading-strategy/)
- [MDPI: Sentiment Matters for Cryptocurrencies: Evidence from Tweets](https://www.mdpi.com/2306-5729/10/4/50)
- [Arxiv: Backtesting Sentiment Signals for Trading (2025)](https://arxiv.org/abs/2507.03350)

### Regime Detection
- [QuantStart: Market Regime Detection using HMMs](https://www.quantstart.com/articles/market-regime-detection-using-hidden-markov-models-in-qstrader/)
- [QuantConnect: Intraday Application of Hidden Markov Models](https://www.quantconnect.com/research/17900/intraday-application-of-hidden-markov-models/)
- [Medium: Market Regime Detection -- From HMMs to Wasserstein Clustering](https://medium.com/hikmah-techstack/market-regime-detection-from-hidden-markov-models-to-wasserstein-clustering-6ba0a09559dc)
- [CANA: Regime-Aware Short-Term Trading Strategy Using HMMs and Monte Carlo](https://internationalpubls.com/index.php/cana/article/view/6029)
- [AIMSPress: Multi-model ensemble-HMM voting framework for regime shift detection](https://www.aimspress.com/article/id/69045d2fba35de34708adb5d)

### GARCH and Volatility Models
- [Springer: Regime switching forecasting for cryptocurrencies (2024)](https://link.springer.com/article/10.1007/s42521-024-00123-2)
- [Springer: Volatility dynamics of cryptocurrencies using GARCH-family models (2025)](https://link.springer.com/article/10.1186/s43093-025-00568-w)
- [Virtual Economics: Advanced GARCH Specifications for Cryptocurrency Volatility](https://www.virtual-economics.eu/index.php/VE/article/view/487)

### Kelly Criterion and Position Sizing
- [OSL: Kelly Bet Size Criterion in Crypto Trading](https://www.osl.com/hk-en/academy/article/what-is-the-kelly-bet-size-criterion-and-how-to-use-it-in-crypto-trading)
- [QuantPedia: Beware of Excessive Leverage -- Introduction to Kelly and Optimal F](https://quantpedia.com/beware-of-excessive-leverage-introduction-to-kelly-and-optimal-f/)

### Multi-Strategy and Risk Parity
- [ResearchGate: Design and Implementation of a Multi-Strategy Algorithmic Trading Bot (2025)](https://www.researchgate.net/publication/395841128)
- [Trade with the Pros: Risk Parity Trading Strategies Guide 2024](https://tradewiththepros.com/risk-parity-trading-strategies/)
- [Arxiv: Hierarchical Risk Parity for Portfolio Allocation](https://arxiv.org/pdf/2509.03712)

### ML for Trading
- [MDPI: High-Frequency Cryptocurrency Price Forecasting Using ML Models](https://www.mdpi.com/2078-2489/16/4/300)
- [Frontiers: Predicting Bitcoin's price using AI (2025)](https://www.frontiersin.org/journals/artificial-intelligence/articles/10.3389/frai.2025.1519805/full)
- [ScienceDirect: Deep reinforcement learning with LSTM and XGBoost feature selection](https://www.sciencedirect.com/science/article/abs/pii/S1568494625003400)
- [Springer: Deep learning for Bitcoin price direction prediction (2024)](https://jfin-swufe.springeropen.com/articles/10.1186/s40854-024-00643-1)
