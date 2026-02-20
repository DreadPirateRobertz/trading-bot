// Backtest Framework
// Replays historical data through signal engine and paper trader to measure performance

import { SignalEngine } from '../signals/engine.js';
import { PositionSizer } from '../signals/position-sizer.js';
import { PaperTrader } from '../paper-trading/index.js';

export class Backtester {
  constructor({
    initialBalance = 100000,
    signalEngineConfig,
    positionSizerConfig,
    maxPositionPct = 0.10,
  } = {}) {
    this.initialBalance = initialBalance;
    this.signalEngine = new SignalEngine(signalEngineConfig);
    this.positionSizer = new PositionSizer({ maxPositionPct, ...positionSizerConfig });
    this.maxPositionPct = maxPositionPct;
  }

  // Run backtest on a single asset's OHLCV history
  // candles: [{ open, high, low, close, volume, openTime? }]
  // sentiment: optional array of { timestamp, classification, score } aligned to candles
  run(symbol, candles, { sentiment = [], lookback = 30 } = {}) {
    if (candles.length < lookback) {
      return { error: `Need at least ${lookback} candles, got ${candles.length}` };
    }

    const trader = new PaperTrader({ initialBalance: this.initialBalance, maxPositionPct: this.maxPositionPct });
    const signals = [];
    const equityCurve = [this.initialBalance];

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
            trader.buy(symbol, sizing.qty, currentPrice);
          }
        }
      } else if (signal.action === 'SELL') {
        const pos = trader.getPosition(symbol);
        if (pos) {
          trader.sell(symbol, pos.qty, currentPrice);
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
      trader.sell(symbol, finalPos.qty, finalPrice);
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

    // Profit factor
    const grossProfit = wins.reduce((s, t) => s + t.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + t.pnl, 0));
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

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

export { computeMaxDrawdown, computeSharpeRatio };
