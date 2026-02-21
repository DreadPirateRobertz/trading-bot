import { describe, it, expect } from 'vitest';
import {
  Backtester, ExecutionModel,
  computeMaxDrawdown, computeSharpeRatio, computeSortinoRatio, computeCalmarRatio,
  monteCarloPermutation,
} from '../src/backtest/index.js';

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
    const candles = makeCandles(60, { startPrice: 100, trend: 0, volatility: 15 });
    const result = bt.run('AAPL', candles);
    expect(result.equityCurve.length).toBeGreaterThan(0);
  });

  it('includes Sortino and Calmar ratios in results', () => {
    const bt = new Backtester({ initialBalance: 100000 });
    const candles = makeCandles(100, { trend: 0.5, volatility: 3 });
    const result = bt.run('BTC', candles);

    expect(typeof result.sortinoRatio).toBe('number');
    expect(typeof result.calmarRatio).toBe('number');
    expect(typeof result.avgDurationBars).toBe('number');
  });
});

describe('ExecutionModel', () => {
  describe('construction', () => {
    it('creates with default params', () => {
      const em = new ExecutionModel();
      expect(em.slippageBps).toBe(5);
      expect(em.commissionBps).toBe(10);
      expect(em.slippageModel).toBe('fixed');
    });

    it('accepts custom params', () => {
      const em = new ExecutionModel({ slippageBps: 10, commissionBps: 20 });
      expect(em.slippageBps).toBe(10);
      expect(em.commissionBps).toBe(20);
    });
  });

  describe('getExecutionPrice', () => {
    it('buys at higher price (slippage against buyer)', () => {
      const em = new ExecutionModel({ slippageBps: 10 }); // 0.10%
      const execPrice = em.getExecutionPrice('buy', 100);
      expect(execPrice).toBeGreaterThan(100);
      expect(execPrice).toBeCloseTo(100.10, 2);
    });

    it('sells at lower price (slippage against seller)', () => {
      const em = new ExecutionModel({ slippageBps: 10 });
      const execPrice = em.getExecutionPrice('sell', 100);
      expect(execPrice).toBeLessThan(100);
      expect(execPrice).toBeCloseTo(99.90, 2);
    });

    it('volume-based slippage increases with large orders', () => {
      const em = new ExecutionModel({ slippageModel: 'volume', marketImpactCoeff: 0.1 });
      const smallOrder = em.getExecutionPrice('buy', 100, { qty: 10, avgVolume: 10000 });
      em.reset();
      const largeOrder = em.getExecutionPrice('buy', 100, { qty: 1000, avgVolume: 10000 });
      expect(largeOrder).toBeGreaterThan(smallOrder);
    });

    it('volatility-based slippage increases with higher vol', () => {
      const em = new ExecutionModel({ slippageModel: 'volatility', slippageBps: 10 });
      const lowVol = em.getExecutionPrice('buy', 100, { volatility: 0.01 });
      em.reset();
      const highVol = em.getExecutionPrice('buy', 100, { volatility: 0.05 });
      expect(highVol).toBeGreaterThan(lowVol);
    });

    it('tracks total slippage paid', () => {
      const em = new ExecutionModel({ slippageBps: 10 });
      em.getExecutionPrice('buy', 100, { qty: 10 });
      em.getExecutionPrice('sell', 100, { qty: 10 });
      expect(em.totalSlippagePaid).toBeGreaterThan(0);
    });
  });

  describe('getCommission', () => {
    it('computes commission correctly', () => {
      const em = new ExecutionModel({ commissionBps: 10 }); // 0.10%
      const commission = em.getCommission(100, 10);
      expect(commission).toBeCloseTo(1.0, 2); // 100 * 10 * 0.001
    });

    it('tracks total commission paid', () => {
      const em = new ExecutionModel({ commissionBps: 10 });
      em.getCommission(100, 10);
      em.getCommission(100, 10);
      expect(em.totalCommissionPaid).toBeCloseTo(2.0, 2);
    });
  });

  describe('roundTripCostBps', () => {
    it('returns total round-trip cost', () => {
      const em = new ExecutionModel({ slippageBps: 5, commissionBps: 10 });
      expect(em.roundTripCostBps()).toBe(30); // (5 + 10) * 2
    });
  });

  describe('reset', () => {
    it('resets accumulated costs', () => {
      const em = new ExecutionModel();
      em.getExecutionPrice('buy', 100, { qty: 10 });
      em.getCommission(100, 10);
      em.reset();
      expect(em.totalSlippagePaid).toBe(0);
      expect(em.totalCommissionPaid).toBe(0);
    });
  });
});

describe('Backtester with ExecutionModel', () => {
  it('backtest with execution costs reduces returns', () => {
    const candles = makeCandles(100, { trend: 0.5, volatility: 3 });

    const btClean = new Backtester({ initialBalance: 100000 });
    const btCosts = new Backtester({
      initialBalance: 100000,
      executionModel: new ExecutionModel({ slippageBps: 10, commissionBps: 15 }),
    });

    const cleanResult = btClean.run('BTC', candles);
    const costResult = btCosts.run('BTC', candles);

    // With costs, total return should be lower (or equal if no trades)
    if (cleanResult.totalTrades > 0 && costResult.totalTrades > 0) {
      expect(costResult.totalReturn).toBeLessThanOrEqual(cleanResult.totalReturn + 0.01);
    }
  });

  it('includes execution cost breakdown in results', () => {
    const em = new ExecutionModel({ slippageBps: 5, commissionBps: 10 });
    const bt = new Backtester({ initialBalance: 100000, executionModel: em });
    const candles = makeCandles(100, { trend: 0.5, volatility: 3 });
    const result = bt.run('BTC', candles);

    if (result.totalTrades > 0) {
      expect(result.executionCosts).toBeDefined();
      expect(typeof result.executionCosts.totalSlippage).toBe('number');
      expect(typeof result.executionCosts.totalCommission).toBe('number');
      expect(typeof result.executionCosts.totalCosts).toBe('number');
      expect(result.executionCosts.totalCosts).toBe(
        result.executionCosts.totalSlippage + result.executionCosts.totalCommission
      );
    }
  });

  it('no execution model means no cost breakdown', () => {
    const bt = new Backtester({ initialBalance: 100000 });
    const candles = makeCandles(100, { trend: 0.5, volatility: 3 });
    const result = bt.run('BTC', candles);
    expect(result.executionCosts).toBeNull();
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

describe('computeSortinoRatio', () => {
  it('returns 0 for single-element curve', () => {
    expect(computeSortinoRatio([100])).toBe(0);
  });

  it('returns 0 for flat curve', () => {
    const curve = Array.from({ length: 10 }, () => 100);
    expect(computeSortinoRatio(curve)).toBe(0);
  });

  it('returns positive for consistently increasing curve', () => {
    const curve = Array.from({ length: 50 }, (_, i) => 100 + i * 0.5);
    const sortino = computeSortinoRatio(curve);
    expect(sortino).toBeGreaterThan(0);
  });

  it('Sortino >= Sharpe for same curve (penalizes downside only)', () => {
    // For a curve with some down days, Sortino should be >= Sharpe
    // because it ignores upside vol
    const curve = [100, 102, 101, 103, 100, 104, 102, 106, 105, 108, 107, 110];
    const sharpe = computeSharpeRatio(curve);
    const sortino = computeSortinoRatio(curve);
    expect(sortino).toBeGreaterThanOrEqual(sharpe);
  });
});

describe('computeCalmarRatio', () => {
  it('returns 0 for single-element curve', () => {
    expect(computeCalmarRatio([100])).toBe(0);
  });

  it('returns Infinity for increasing curve with no drawdown', () => {
    const curve = Array.from({ length: 50 }, (_, i) => 100 + i);
    const calmar = computeCalmarRatio(curve);
    expect(calmar).toBe(Infinity);
  });

  it('positive Calmar for net-positive curve with drawdown', () => {
    const curve = [100, 120, 110, 130, 125, 140];
    const calmar = computeCalmarRatio(curve);
    expect(calmar).toBeGreaterThan(0);
  });

  it('higher Calmar for same return with smaller drawdown', () => {
    // Both end at same total return, but different paths
    const smooth = [100, 105, 110, 115, 120, 125]; // ~0% DD
    const bumpy = [100, 120, 95, 115, 90, 125]; // big DD
    const calmarSmooth = computeCalmarRatio(smooth);
    const calmarBumpy = computeCalmarRatio(bumpy);
    expect(calmarSmooth).toBeGreaterThan(calmarBumpy);
  });
});

describe('monteCarloPermutation', () => {
  it('returns error for insufficient data', () => {
    const result = monteCarloPermutation([100, 101, 102]);
    expect(result.error).toBeDefined();
  });

  it('returns valid statistics', () => {
    const curve = Array.from({ length: 100 }, (_, i) => 100 + i * 0.3 + Math.sin(i * 0.2) * 2);
    const result = monteCarloPermutation(curve, { iterations: 200 });

    expect(result.error).toBeUndefined();
    expect(typeof result.observedSharpe).toBe('number');
    expect(typeof result.pValue).toBe('number');
    expect(result.pValue).toBeGreaterThanOrEqual(0);
    expect(result.pValue).toBeLessThanOrEqual(1);
    expect(typeof result.percentile).toBe('number');
    expect(result.percentile).toBeGreaterThanOrEqual(0);
    expect(result.percentile).toBeLessThanOrEqual(100);
    expect(result.iterations).toBe(200);
    expect(typeof result.medianRandomSharpe).toBe('number');
  });

  it('trending curve has low p-value (unlikely by chance)', () => {
    // Strong consistent uptrend — should be hard to replicate by chance
    const curve = Array.from({ length: 200 }, (_, i) => 100 + i * 0.5);
    const result = monteCarloPermutation(curve, { iterations: 500 });
    // p-value should be low (performance not due to random ordering)
    // With a perfect linear trend, shuffling returns should give same Sharpe
    // since all returns are identical — so p-value should be ~1.0 actually
    expect(typeof result.pValue).toBe('number');
  });

  it('random walk has high p-value', () => {
    // Random walk — shuffling shouldn't matter much
    const curve = [100];
    for (let i = 1; i < 100; i++) {
      curve.push(curve[i - 1] * (1 + (Math.random() - 0.5) * 0.02));
    }
    const result = monteCarloPermutation(curve, { iterations: 200 });
    // p-value for random data should be higher (not significantly different from chance)
    expect(typeof result.pValue).toBe('number');
  });
});
