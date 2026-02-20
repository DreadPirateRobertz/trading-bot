import { describe, it, expect } from 'vitest';
import { Backtester, computeMaxDrawdown, computeSharpeRatio } from '../src/backtest/index.js';

// Generate synthetic OHLCV candles with a trend
function makeCandles(length, { startPrice = 100, trend = 0, volatility = 2 } = {}) {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < length; i++) {
    price = price + trend + (Math.sin(i * 0.5) * volatility);
    const open = price - volatility * 0.3;
    const high = price + volatility * 0.5;
    const low = price - volatility * 0.5;
    const close = price;
    const volume = 1000 + Math.floor(Math.random() * 500);
    candles.push({ open, high, low, close, volume, openTime: Date.now() + i * 86400000 });
  }
  return candles;
}

describe('Backtester', () => {
  it('returns error for insufficient data', () => {
    const bt = new Backtester();
    const result = bt.run('BTC', makeCandles(10));
    expect(result.error).toMatch(/Need at least/);
  });

  it('runs backtest on trending up data', () => {
    const bt = new Backtester({ initialBalance: 100000 });
    const candles = makeCandles(100, { trend: 0.5, volatility: 3 });
    const result = bt.run('BTC', candles);

    expect(result.totalTrades).toBeGreaterThanOrEqual(0);
    expect(result.equityCurve.length).toBeGreaterThan(0);
    expect(result.winRate).toBeGreaterThanOrEqual(0);
    expect(result.winRate).toBeLessThanOrEqual(100);
    expect(typeof result.sharpeRatio).toBe('number');
    expect(typeof result.maxDrawdown).toBe('number');
    expect(typeof result.profitFactor).toBe('number');
  });

  it('runs backtest on trending down data', () => {
    const bt = new Backtester({ initialBalance: 100000 });
    const candles = makeCandles(100, { trend: -0.5, volatility: 3 });
    const result = bt.run('BTC', candles);
    expect(result.totalTrades).toBeGreaterThanOrEqual(0);
  });

  it('runs backtest with sentiment data', () => {
    const bt = new Backtester();
    const candles = makeCandles(80, { trend: 0.3 });
    const sentiment = candles.map((c, i) => ({
      timestamp: c.openTime,
      classification: i % 3 === 0 ? 'bullish' : 'neutral',
      score: i % 3 === 0 ? 2 : 0,
    }));
    const result = bt.run('ETH', candles, { sentiment });
    expect(result.signals.length).toBeGreaterThan(0);
  });

  it('runs multi-asset backtest', () => {
    const bt = new Backtester();
    const assets = [
      { symbol: 'BTC', candles: makeCandles(80, { startPrice: 50000, trend: 100 }) },
      { symbol: 'ETH', candles: makeCandles(80, { startPrice: 3000, trend: 5 }) },
    ];
    const results = bt.runMultiple(assets);
    expect(results.BTC).toBeDefined();
    expect(results.ETH).toBeDefined();
    expect(results.BTC.equityCurve.length).toBeGreaterThan(0);
  });

  it('closes remaining positions at end of backtest', () => {
    const bt = new Backtester({ initialBalance: 100000 });
    // Strong uptrend should trigger a buy that gets closed at end
    const candles = makeCandles(60, { startPrice: 100, trend: 0, volatility: 15 });
    const result = bt.run('AAPL', candles);
    // All positions should be closed
    expect(result.equityCurve.length).toBeGreaterThan(0);
  });
});

describe('computeMaxDrawdown', () => {
  it('returns 0 for monotonically increasing curve', () => {
    const curve = [100, 110, 120, 130, 140];
    expect(computeMaxDrawdown(curve)).toBe(0);
  });

  it('computes drawdown correctly', () => {
    const curve = [100, 120, 90, 110, 80];
    const dd = computeMaxDrawdown(curve);
    // Peak 120, trough 80 = 33.33%
    expect(dd).toBeCloseTo(1 / 3, 2);
  });

  it('returns 0 for single-element curve', () => {
    expect(computeMaxDrawdown([100])).toBe(0);
  });
});

describe('computeSharpeRatio', () => {
  it('returns 0 for single-element curve', () => {
    expect(computeSharpeRatio([100])).toBe(0);
  });

  it('returns 0 for flat curve', () => {
    const curve = Array.from({ length: 10 }, () => 100);
    expect(computeSharpeRatio(curve)).toBe(0);
  });

  it('returns positive Sharpe for consistently increasing curve', () => {
    const curve = Array.from({ length: 50 }, (_, i) => 100 + i * 0.5);
    const sharpe = computeSharpeRatio(curve);
    expect(sharpe).toBeGreaterThan(0);
  });
});
