// Backtest Framework
// Replays historical data through signal engine and paper trader to measure performance
// Enhanced: slippage/commission modeling, Sortino/Calmar ratios, Monte Carlo permutation

import { SignalEngine } from '../signals/engine.js';
import { PositionSizer } from '../signals/position-sizer.js';
import { PaperTrader } from '../paper-trading/index.js';

// Execution cost model: slippage + commission
export class ExecutionModel {
  constructor({
    slippageBps = 5,       // Slippage in basis points (5 bps = 0.05%)
    commissionBps = 10,    // Commission in basis points (10 bps = 0.10%)
    slippageModel = 'fixed', // 'fixed' | 'volume' | 'volatility'
    marketImpactCoeff = 0.1, // For volume-based slippage: impact = coeff * sqrt(qty/avgVol)
  } = {}) {
    this.slippageBps = slippageBps;
    this.commissionBps = commissionBps;
    this.slippageModel = slippageModel;
    this.marketImpactCoeff = marketImpactCoeff;
    this.totalSlippagePaid = 0;
    this.totalCommissionPaid = 0;
  }

  // Compute effective execution price after slippage
  // side: 'buy' or 'sell'
  // price: intended price
  // qty: order quantity
  // avgVolume: average volume (for volume-based model)
  // volatility: recent realized vol (for volatility-based model)
  getExecutionPrice(side, price, { qty = 0, avgVolume = 0, volatility = 0 } = {}) {
    let slippageFrac;

    switch (this.slippageModel) {
      case 'volume':
        // Market impact: slippage increases with sqrt(order_size / avg_volume)
        if (avgVolume > 0 && qty > 0) {
          slippageFrac = this.marketImpactCoeff * Math.sqrt(qty / avgVolume);
        } else {
          slippageFrac = this.slippageBps / 10000;
        }
        break;
      case 'volatility':
        // Slippage scales with volatility (high vol = wider spreads)
        slippageFrac = (this.slippageBps / 10000) * Math.max(1, volatility / 0.02);
        break;
      default: // 'fixed'
        slippageFrac = this.slippageBps / 10000;
    }

    // Buys pay more, sells receive less
    const direction = side === 'buy' ? 1 : -1;
    const slippageAmount = price * slippageFrac * direction;
    const execPrice = price + slippageAmount;

    this.totalSlippagePaid += Math.abs(slippageAmount) * qty;
    return execPrice;
  }

  // Compute commission for a trade
  getCommission(price, qty) {
    const commission = price * qty * (this.commissionBps / 10000);
    this.totalCommissionPaid += commission;
    return commission;
  }

  // Total cost of a round-trip trade (buy + sell)
  roundTripCostBps() {
    return (this.slippageBps + this.commissionBps) * 2;
  }

  reset() {
    this.totalSlippagePaid = 0;
    this.totalCommissionPaid = 0;
  }
}

export class Backtester {
  constructor({
    initialBalance = 100000,
    signalEngineConfig,
    positionSizerConfig,
    maxPositionPct = 0.10,
    executionModel = null,  // ExecutionModel instance for realistic costs
  } = {}) {
    this.initialBalance = initialBalance;
    this.signalEngine = new SignalEngine(signalEngineConfig);
    this.positionSizer = new PositionSizer({ maxPositionPct, ...positionSizerConfig });
    this.maxPositionPct = maxPositionPct;
    this.executionModel = executionModel;
  }

  // Run backtest on a single asset's OHLCV history
  // candles: [{ open, high, low, close, volume, openTime? }]
  // sentiment: optional array of { timestamp, classification, score } aligned to candles
  run(symbol, candles, { sentiment = [], lookback = 30 } = {}) {
    if (candles.length < lookback) {
      return { error: `Need at least ${lookback} candles, got ${candles.length}` };
    }

    if (this.executionModel) this.executionModel.reset();

    const trader = new PaperTrader({ initialBalance: this.initialBalance, maxPositionPct: this.maxPositionPct });
    const signals = [];
    const equityCurve = [this.initialBalance];
    const openTimestamps = new Map(); // symbol -> entry bar index (for trade duration)

    for (let i = lookback; i < candles.length; i++) {
      const window = candles.slice(i - lookback, i + 1);
      const closes = window.map(c => c.close);
      const volumes = window.map(c => c.volume);
      const currentPrice = candles[i].close;

      // Find sentiment for this candle's timestamp if available
      const candleSentiment = sentiment.length > 0
        ? findClosestSentiment(sentiment, candles[i].openTime)
        : null;

      const analysis = this.signalEngine.analyze(symbol, {
        closes,
        volumes,
        currentPrice,
        sentiment: candleSentiment,
      });

      const { signal } = analysis;
      signals.push({ index: i, candle: candles[i], signal });

      // Compute average volume for slippage model
      const avgVolume = volumes.reduce((a, b) => a + b, 0) / volumes.length;

      // Execute trades based on signals
      if (signal.action === 'BUY' && signal.confidence > 0.1) {
        const existingPos = trader.getPosition(symbol);
        if (!existingPos) {
          const sizing = this.positionSizer.calculate({
            portfolioValue: trader.portfolioValue,
            price: currentPrice,
            confidence: signal.confidence,
          });
          if (sizing.qty > 0) {
            let execPrice = currentPrice;
            let commission = 0;
            if (this.executionModel) {
              execPrice = this.executionModel.getExecutionPrice('buy', currentPrice, { qty: sizing.qty, avgVolume });
              commission = this.executionModel.getCommission(execPrice, sizing.qty);
            }
            trader.buy(symbol, sizing.qty, execPrice);
            if (commission > 0) trader.cash -= commission;
            openTimestamps.set(symbol, i);
          }
        }
      } else if (signal.action === 'SELL') {
        const pos = trader.getPosition(symbol);
        if (pos) {
          let execPrice = currentPrice;
          let commission = 0;
          if (this.executionModel) {
            execPrice = this.executionModel.getExecutionPrice('sell', currentPrice, { qty: pos.qty, avgVolume });
            commission = this.executionModel.getCommission(execPrice, pos.qty);
          }
          trader.sell(symbol, pos.qty, execPrice);
          if (commission > 0) trader.cash -= commission;

          // Record trade duration on the last sell trade
          const entryBar = openTimestamps.get(symbol);
          if (entryBar !== undefined) {
            const lastTrade = trader.tradeHistory[trader.tradeHistory.length - 1];
            if (lastTrade) lastTrade.durationBars = i - entryBar;
            openTimestamps.delete(symbol);
          }
        }
      }

      // Record equity at current price
      const pos = trader.getPosition(symbol);
      const equity = trader.cash + (pos ? pos.qty * currentPrice : 0);
      equityCurve.push(equity);
    }

    // Close any remaining positions at final price
    const finalPos = trader.getPosition(symbol);
    if (finalPos) {
      const finalPrice = candles[candles.length - 1].close;
      let execPrice = finalPrice;
      if (this.executionModel) {
        execPrice = this.executionModel.getExecutionPrice('sell', finalPrice, { qty: finalPos.qty });
        const commission = this.executionModel.getCommission(execPrice, finalPos.qty);
        trader.sell(symbol, finalPos.qty, execPrice);
        if (commission > 0) trader.cash -= commission;
      } else {
        trader.sell(symbol, finalPos.qty, finalPrice);
      }
    }

    return this.computeMetrics(trader, signals, equityCurve);
  }

  // Multi-asset backtest
  runMultiple(assetHistories, { lookback = 30 } = {}) {
    const results = {};
    for (const { symbol, candles, sentiment } of assetHistories) {
      results[symbol] = this.run(symbol, candles, { sentiment, lookback });
    }
    return results;
  }

  computeMetrics(trader, signals, equityCurve) {
    const trades = trader.tradeHistory;
    const buyTrades = trades.filter(t => t.side === 'buy');
    const sellTrades = trades.filter(t => t.side === 'sell');

    // Win/loss stats from completed round-trips
    const completedTrades = sellTrades.filter(t => t.pnl !== undefined);
    const wins = completedTrades.filter(t => t.pnl > 0);
    const losses = completedTrades.filter(t => t.pnl <= 0);

    const winRate = completedTrades.length > 0
      ? wins.length / completedTrades.length
      : 0;

    const avgWin = wins.length > 0
      ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length
      : 0;

    const avgLoss = losses.length > 0
      ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length)
      : 0;

    const totalPnl = trader.cash - this.initialBalance;
    const totalReturn = (totalPnl / this.initialBalance) * 100;

    // Max drawdown from equity curve
    const maxDrawdown = computeMaxDrawdown(equityCurve);

    // Sharpe ratio (annualized, assuming daily returns)
    const sharpe = computeSharpeRatio(equityCurve);

    // Sortino ratio (penalizes downside volatility only)
    const sortino = computeSortinoRatio(equityCurve);

    // Calmar ratio (annualized return / max drawdown)
    const calmar = computeCalmarRatio(equityCurve);

    // Profit factor
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Trade duration stats
    const tradesWithDuration = completedTrades.filter(t => t.durationBars !== undefined);
    const avgDurationBars = tradesWithDuration.length > 0
      ? tradesWithDuration.reduce((s, t) => s + t.durationBars, 0) / tradesWithDuration.length
      : 0;

    // Execution cost breakdown
    const executionCosts = this.executionModel ? {
      totalSlippage: Math.round(this.executionModel.totalSlippagePaid * 100) / 100,
      totalCommission: Math.round(this.executionModel.totalCommissionPaid * 100) / 100,
      totalCosts: Math.round((this.executionModel.totalSlippagePaid + this.executionModel.totalCommissionPaid) * 100) / 100,
      costPctOfPnl: totalPnl !== 0
        ? Math.round(((this.executionModel.totalSlippagePaid + this.executionModel.totalCommissionPaid) / Math.abs(totalPnl)) * 10000) / 100
        : 0,
    } : null;

    return {
      totalPnl: Math.round(totalPnl * 100) / 100,
      totalReturn: Math.round(totalReturn * 100) / 100,
      totalTrades: completedTrades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: Math.round(winRate * 10000) / 100,
      avgWin: Math.round(avgWin * 100) / 100,
      avgLoss: Math.round(avgLoss * 100) / 100,
      profitFactor: Math.round(profitFactor * 100) / 100,
      maxDrawdown: Math.round(maxDrawdown * 10000) / 100,
      sharpeRatio: Math.round(sharpe * 100) / 100,
      sortinoRatio: Math.round(sortino * 100) / 100,
      calmarRatio: Math.round(calmar * 100) / 100,
      avgDurationBars: Math.round(avgDurationBars * 10) / 10,
      executionCosts,
      equityCurve,
      signals,
      trades,
    };
  }
}

function computeMaxDrawdown(equityCurve) {
  let peak = equityCurve[0];
  let maxDd = 0;
  for (const value of equityCurve) {
    if (value > peak) peak = value;
    const dd = (peak - value) / peak;
    if (dd > maxDd) maxDd = dd;
  }
  return maxDd;
}

function computeSharpeRatio(equityCurve, riskFreeRate = 0) {
  if (equityCurve.length < 2) return 0;
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return 0;
  // Annualize (assuming daily data, ~252 trading days)
  return ((mean - riskFreeRate / 252) / stdDev) * Math.sqrt(252);
}

function findClosestSentiment(sentiments, timestamp) {
  if (!timestamp || sentiments.length === 0) return null;
  let closest = sentiments[0];
  let minDiff = Math.abs(timestamp - (closest.timestamp || 0));
  for (const s of sentiments) {
    const diff = Math.abs(timestamp - (s.timestamp || 0));
    if (diff < minDiff) {
      minDiff = diff;
      closest = s;
    }
  }
  return closest;
}

// Sortino ratio: like Sharpe but only penalizes downside deviation
function computeSortinoRatio(equityCurve, riskFreeRate = 0) {
  if (equityCurve.length < 2) return 0;
  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
  }
  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const downsideReturns = returns.filter(r => r < riskFreeRate / 252);
  if (downsideReturns.length === 0) return mean > 0 ? Infinity : 0;
  const downsideVariance = downsideReturns.reduce((s, r) => s + (r - riskFreeRate / 252) ** 2, 0) / downsideReturns.length;
  const downsideDev = Math.sqrt(downsideVariance);
  if (downsideDev === 0) return 0;
  return ((mean - riskFreeRate / 252) / downsideDev) * Math.sqrt(252);
}

// Calmar ratio: annualized return / max drawdown
function computeCalmarRatio(equityCurve) {
  if (equityCurve.length < 2) return 0;
  const totalReturn = (equityCurve[equityCurve.length - 1] - equityCurve[0]) / equityCurve[0];
  const periods = equityCurve.length - 1;
  // Annualize assuming daily data
  const annualizedReturn = totalReturn * (252 / periods);
  const maxDd = computeMaxDrawdown(equityCurve);
  if (maxDd === 0) return annualizedReturn > 0 ? Infinity : 0;
  return annualizedReturn / maxDd;
}

// Monte Carlo permutation test
// Shuffles daily returns N times to estimate probability of observed performance
// Returns { observedSharpe, pValue, percentile, distribution }
export function monteCarloPermutation(equityCurve, { iterations = 1000 } = {}) {
  if (equityCurve.length < 10) return { error: 'Need at least 10 data points' };

  const returns = [];
  for (let i = 1; i < equityCurve.length; i++) {
    returns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
  }

  const observedSharpe = computeSharpeRatio(equityCurve);
  const sharpes = [];

  for (let iter = 0; iter < iterations; iter++) {
    // Shuffle returns (Fisher-Yates)
    const shuffled = [...returns];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }

    // Reconstruct equity curve from shuffled returns
    const simCurve = [equityCurve[0]];
    for (const r of shuffled) {
      simCurve.push(simCurve[simCurve.length - 1] * (1 + r));
    }
    sharpes.push(computeSharpeRatio(simCurve));
  }

  sharpes.sort((a, b) => a - b);
  const beatCount = sharpes.filter(s => s >= observedSharpe).length;
  const pValue = beatCount / iterations;
  const percentile = Math.round((1 - pValue) * 100);

  return {
    observedSharpe: Math.round(observedSharpe * 100) / 100,
    pValue: Math.round(pValue * 1000) / 1000,
    percentile,
    iterations,
    medianRandomSharpe: Math.round(sharpes[Math.floor(sharpes.length / 2)] * 100) / 100,
  };
}

// ─── Pairs Backtester ────────────────────────────────────────────────────────
// Backtests statistical arbitrage pairs trading strategies on two parallel
// price series. Handles two-legged positions (long A / short B and vice versa),
// hedged notional allocation, and spread-based P&L tracking.

import { PairsTradingStrategy } from '../strategies/pairs-trading.js';

export class PairsBacktester {
  constructor({
    initialBalance = 100000,
    maxPositionPct = 0.10,
    strategy = null,
    strategyConfig = {},
    executionModel = null,
  } = {}) {
    this.initialBalance = initialBalance;
    this.maxPositionPct = maxPositionPct;
    this.strategy = strategy || new PairsTradingStrategy(strategyConfig);
    this.executionModel = executionModel;
  }

  // Run pairs backtest on two parallel close price arrays
  // closesA, closesB: arrays of closing prices for the two assets
  // Returns standard metrics plus spread-specific stats
  run(closesA, closesB, { lookback = 60, symbolA = 'A', symbolB = 'B' } = {}) {
    const n = Math.min(closesA.length, closesB.length);
    if (n < lookback) {
      return { error: `Need at least ${lookback} data points, got ${n}` };
    }

    if (this.executionModel) this.executionModel.reset();

    let cash = this.initialBalance;
    let position = null; // { direction, legA, legB, entryBar, hedgeRatio }
    const trades = [];
    const equityCurve = [this.initialBalance];
    const spreadSignals = [];

    for (let i = lookback; i < n; i++) {
      const windowA = closesA.slice(i - lookback, i + 1);
      const windowB = closesB.slice(i - lookback, i + 1);
      const priceA = closesA[i];
      const priceB = closesB[i];

      const sig = this.strategy.generateSignal(windowA, windowB);
      spreadSignals.push({ index: i, signal: sig.signal, action: sig.action, zScore: sig.zScore, confidence: sig.confidence });

      // Position management
      if (position) {
        // Check for exit: signal flipped or returned to mean (signal=0)
        const shouldExit = sig.signal === 0 || sig.signal === -position.direction;

        if (shouldExit) {
          const pnl = this._closePosition(position, priceA, priceB, i);
          cash += pnl;
          trades.push({
            direction: position.direction,
            entryBar: position.entryBar,
            exitBar: i,
            durationBars: i - position.entryBar,
            hedgeRatio: position.hedgeRatio,
            pnl: round4(pnl),
            pnlPct: round4(pnl / this.initialBalance * 100),
            exitReason: sig.signal === 0 ? 'mean_reversion' : 'signal_flip',
          });
          position = null;

          // If signal flipped, immediately enter the opposite direction
          if (sig.signal !== 0 && sig.confidence > 0.1) {
            position = this._openPosition(sig, priceA, priceB, cash, i);
          }
        }
      } else {
        // No position — check for entry
        if (sig.signal !== 0 && sig.confidence > 0.1 && sig.hedgeRatio) {
          position = this._openPosition(sig, priceA, priceB, cash, i);
        }
      }

      // Mark-to-market equity
      let unrealizedPnl = 0;
      if (position) {
        unrealizedPnl = this._markToMarket(position, priceA, priceB);
      }
      equityCurve.push(cash + unrealizedPnl);
    }

    // Close remaining position at final prices
    if (position) {
      const finalA = closesA[n - 1];
      const finalB = closesB[n - 1];
      const pnl = this._closePosition(position, finalA, finalB, n - 1);
      cash += pnl;
      trades.push({
        direction: position.direction,
        entryBar: position.entryBar,
        exitBar: n - 1,
        durationBars: n - 1 - position.entryBar,
        hedgeRatio: position.hedgeRatio,
        pnl: round4(pnl),
        pnlPct: round4(pnl / this.initialBalance * 100),
        exitReason: 'end_of_data',
      });
      position = null;
    }

    return this._computeMetrics(cash, trades, equityCurve, spreadSignals, {
      symbolA, symbolB, dataPoints: n,
    });
  }

  // Open a new spread position
  _openPosition(sig, priceA, priceB, cash, bar) {
    const direction = sig.signal; // 1 = long spread, -1 = short spread
    const hedgeRatio = Math.abs(sig.hedgeRatio);
    const notional = cash * this.maxPositionPct;

    // Allocate notional across both legs: qtyA * priceA + qtyB * priceB = notional
    const qtyA = notional / (priceA + hedgeRatio * priceB);
    const qtyB = qtyA * hedgeRatio;

    let entryPriceA = priceA;
    let entryPriceB = priceB;

    if (this.executionModel) {
      // Long spread: buy A (pay more), sell B (receive less)
      // Short spread: sell A (receive less), buy B (pay more)
      const sideA = direction > 0 ? 'buy' : 'sell';
      const sideB = direction > 0 ? 'sell' : 'buy';
      entryPriceA = this.executionModel.getExecutionPrice(sideA, priceA, { qty: qtyA });
      entryPriceB = this.executionModel.getExecutionPrice(sideB, priceB, { qty: qtyB });
      this.executionModel.getCommission(entryPriceA, qtyA);
      this.executionModel.getCommission(entryPriceB, qtyB);
    }

    return {
      direction,
      legA: { qty: qtyA, entryPrice: entryPriceA },
      legB: { qty: qtyB, entryPrice: entryPriceB },
      entryBar: bar,
      hedgeRatio,
    };
  }

  // Close a spread position and return realized P&L
  _closePosition(position, priceA, priceB, bar) {
    let exitPriceA = priceA;
    let exitPriceB = priceB;

    if (this.executionModel) {
      const sideA = position.direction > 0 ? 'sell' : 'buy';
      const sideB = position.direction > 0 ? 'buy' : 'sell';
      exitPriceA = this.executionModel.getExecutionPrice(sideA, priceA, { qty: position.legA.qty });
      exitPriceB = this.executionModel.getExecutionPrice(sideB, priceB, { qty: position.legB.qty });
      this.executionModel.getCommission(exitPriceA, position.legA.qty);
      this.executionModel.getCommission(exitPriceB, position.legB.qty);
    }

    // Long spread: profit when A rises and B falls
    // Short spread: profit when A falls and B rises
    const pnlA = (exitPriceA - position.legA.entryPrice) * position.legA.qty * position.direction;
    const pnlB = (position.legB.entryPrice - exitPriceB) * position.legB.qty * position.direction;

    return pnlA + pnlB;
  }

  // Mark-to-market unrealized P&L
  _markToMarket(position, priceA, priceB) {
    const pnlA = (priceA - position.legA.entryPrice) * position.legA.qty * position.direction;
    const pnlB = (position.legB.entryPrice - priceB) * position.legB.qty * position.direction;
    return pnlA + pnlB;
  }

  _computeMetrics(finalCash, trades, equityCurve, signals, info) {
    const totalPnl = finalCash - this.initialBalance;
    const totalReturn = (totalPnl / this.initialBalance) * 100;
    const maxDrawdown = computeMaxDrawdown(equityCurve);
    const sharpe = computeSharpeRatio(equityCurve);
    const sortino = computeSortinoRatio(equityCurve);
    const calmar = computeCalmarRatio(equityCurve);

    const wins = trades.filter(t => t.pnl > 0);
    const losses = trades.filter(t => t.pnl <= 0);
    const winRate = trades.length > 0 ? wins.length / trades.length : 0;
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + t.pnl, 0) / losses.length) : 0;

    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    const avgDuration = trades.length > 0
      ? trades.reduce((s, t) => s + t.durationBars, 0) / trades.length
      : 0;

    // Exit reason breakdown
    const exitReasons = {};
    for (const t of trades) {
      exitReasons[t.exitReason] = (exitReasons[t.exitReason] || 0) + 1;
    }

    const executionCosts = this.executionModel ? {
      totalSlippage: round4(this.executionModel.totalSlippagePaid),
      totalCommission: round4(this.executionModel.totalCommissionPaid),
      totalCosts: round4(this.executionModel.totalSlippagePaid + this.executionModel.totalCommissionPaid),
    } : null;

    return {
      symbolA: info.symbolA,
      symbolB: info.symbolB,
      dataPoints: info.dataPoints,
      initialBalance: this.initialBalance,
      finalBalance: round4(finalCash),
      totalPnl: round4(totalPnl),
      totalReturn: round4(totalReturn),
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: round4(winRate * 100),
      avgWin: round4(avgWin),
      avgLoss: round4(avgLoss),
      profitFactor: round4(profitFactor),
      maxDrawdown: round4(maxDrawdown * 100),
      sharpeRatio: round4(sharpe),
      sortinoRatio: round4(sortino),
      calmarRatio: round4(calmar),
      avgDurationBars: round4(avgDuration),
      exitReasons,
      executionCosts,
      equityCurve,
      trades,
    };
  }
}

function round4(n) { return Math.round(n * 10000) / 10000; }

export { computeMaxDrawdown, computeSharpeRatio, computeSortinoRatio, computeCalmarRatio };
