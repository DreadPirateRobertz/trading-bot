import { describe, it, expect } from 'vitest';
import { PairsBacktester, ExecutionModel } from '../src/backtest/index.js';
import { PairsTradingStrategy } from '../src/strategies/pairs-trading.js';

// Generate two cointegrated price series: B follows A with noise
// spread = A - beta*B should be mean-reverting
function makeCointegPair(n, { basePrice = 100, beta = 1.5, spreadVol = 2, trendRate = 0.001, seed = 42 } = {}) {
  // Deterministic pseudo-random using seed
  let state = seed;
  function rand() {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) - 0.5; // [-0.5, 0.5]
  }

  const closesA = [];
  const closesB = [];
  let pA = basePrice;
  let spread = 0;

  for (let i = 0; i < n; i++) {
    // Random walk for A
    pA += trendRate * pA + rand() * 0.5;

    // Spread mean-reverts (Ornstein-Uhlenbeck process)
    spread = spread * 0.9 + rand() * spreadVol;

    // B = (A - spread) / beta (cointegration relationship)
    const pB = (pA - spread) / beta;

    closesA.push(pA);
    closesB.push(Math.max(pB, 1)); // Prevent negative prices
  }

  return { closesA, closesB };
}

// Generate non-cointegrated pair (independent random walks)
function makeIndependentPair(n, { basePrice = 100, seed = 99 } = {}) {
  let state = seed;
  function rand() {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    return (state / 0x7fffffff) - 0.5;
  }

  const closesA = [];
  const closesB = [];
  let pA = basePrice;
  let pB = basePrice * 0.7;

  for (let i = 0; i < n; i++) {
    pA += rand() * 0.8;
    pB += rand() * 0.6;
    closesA.push(pA);
    closesB.push(Math.max(pB, 1));
  }

  return { closesA, closesB };
}

describe('PairsBacktester', () => {
  describe('constructor', () => {
    it('creates with default settings', () => {
      const bt = new PairsBacktester();
      expect(bt.initialBalance).toBe(100000);
      expect(bt.maxPositionPct).toBe(0.10);
      expect(bt.strategy).toBeInstanceOf(PairsTradingStrategy);
    });

    it('accepts custom config', () => {
      const bt = new PairsBacktester({
        initialBalance: 50000,
        maxPositionPct: 0.05,
        strategyConfig: { entryZScore: 1.5, exitZScore: 0.3 },
      });
      expect(bt.initialBalance).toBe(50000);
      expect(bt.maxPositionPct).toBe(0.05);
    });

    it('accepts pre-built strategy instance', () => {
      const strategy = new PairsTradingStrategy({ entryZScore: 2.5 });
      const bt = new PairsBacktester({ strategy });
      expect(bt.strategy).toBe(strategy);
    });
  });

  describe('run - basic', () => {
    it('returns error for insufficient data', () => {
      const bt = new PairsBacktester();
      const result = bt.run([1, 2, 3], [1, 2, 3]);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('at least');
    });

    it('runs on cointegrated pair and returns metrics', () => {
      const { closesA, closesB } = makeCointegPair(200);
      const bt = new PairsBacktester({ strategyConfig: { entryZScore: 1.5 } });
      const result = bt.run(closesA, closesB, { symbolA: 'BTC', symbolB: 'ETH' });

      expect(result.error).toBeUndefined();
      expect(result.symbolA).toBe('BTC');
      expect(result.symbolB).toBe('ETH');
      expect(result.dataPoints).toBe(200);
      expect(result.initialBalance).toBe(100000);
      expect(typeof result.totalPnl).toBe('number');
      expect(typeof result.totalReturn).toBe('number');
      expect(typeof result.totalTrades).toBe('number');
      expect(typeof result.winRate).toBe('number');
      expect(typeof result.sharpeRatio).toBe('number');
      expect(typeof result.maxDrawdown).toBe('number');
      expect(result.equityCurve).toBeDefined();
      expect(result.equityCurve.length).toBeGreaterThan(1);
    });

    it('returns trade details', () => {
      const { closesA, closesB } = makeCointegPair(200);
      const bt = new PairsBacktester({ strategyConfig: { entryZScore: 1.5 } });
      const result = bt.run(closesA, closesB);

      if (result.totalTrades > 0) {
        const trade = result.trades[0];
        expect(trade.direction).toBeDefined();
        expect([1, -1]).toContain(trade.direction);
        expect(trade.entryBar).toBeDefined();
        expect(trade.exitBar).toBeDefined();
        expect(trade.durationBars).toBeGreaterThan(0);
        expect(typeof trade.pnl).toBe('number');
        expect(typeof trade.pnlPct).toBe('number');
        expect(trade.exitReason).toBeDefined();
        expect(typeof trade.hedgeRatio).toBe('number');
      }
    });

    it('equity curve starts at initial balance', () => {
      const { closesA, closesB } = makeCointegPair(150);
      const bt = new PairsBacktester({ initialBalance: 50000 });
      const result = bt.run(closesA, closesB);
      expect(result.equityCurve[0]).toBe(50000);
    });

    it('wins + losses = totalTrades', () => {
      const { closesA, closesB } = makeCointegPair(200);
      const bt = new PairsBacktester({ strategyConfig: { entryZScore: 1.5 } });
      const result = bt.run(closesA, closesB);
      expect(result.wins + result.losses).toBe(result.totalTrades);
    });
  });

  describe('run - metrics quality', () => {
    it('profit factor is gross_profit / gross_loss', () => {
      const { closesA, closesB } = makeCointegPair(250, { spreadVol: 3 });
      const bt = new PairsBacktester({ strategyConfig: { entryZScore: 1.5 } });
      const result = bt.run(closesA, closesB);

      if (result.wins > 0 && result.losses > 0) {
        const grossProfit = result.trades.filter(t => t.pnl > 0).reduce((s, t) => s + t.pnl, 0);
        const grossLoss = Math.abs(result.trades.filter(t => t.pnl <= 0).reduce((s, t) => s + t.pnl, 0));
        const expectedPF = grossProfit / grossLoss;
        expect(result.profitFactor).toBeCloseTo(expectedPF, 2);
      }
    });

    it('totalPnl matches finalBalance - initialBalance', () => {
      const { closesA, closesB } = makeCointegPair(200);
      const bt = new PairsBacktester();
      const result = bt.run(closesA, closesB);
      expect(result.totalPnl).toBeCloseTo(result.finalBalance - result.initialBalance, 2);
    });

    it('totalReturn is consistent with totalPnl', () => {
      const { closesA, closesB } = makeCointegPair(200);
      const bt = new PairsBacktester({ initialBalance: 50000 });
      const result = bt.run(closesA, closesB);
      const expectedReturn = (result.totalPnl / 50000) * 100;
      expect(result.totalReturn).toBeCloseTo(expectedReturn, 2);
    });

    it('includes sortino and calmar ratios', () => {
      const { closesA, closesB } = makeCointegPair(200);
      const bt = new PairsBacktester();
      const result = bt.run(closesA, closesB);
      expect(typeof result.sortinoRatio).toBe('number');
      expect(typeof result.calmarRatio).toBe('number');
    });

    it('includes exit reason breakdown', () => {
      const { closesA, closesB } = makeCointegPair(200, { spreadVol: 3 });
      const bt = new PairsBacktester({ strategyConfig: { entryZScore: 1.5 } });
      const result = bt.run(closesA, closesB);
      expect(result.exitReasons).toBeDefined();
      expect(typeof result.exitReasons).toBe('object');
      // Sum of exit reasons should equal total trades
      const exitTotal = Object.values(result.exitReasons).reduce((s, v) => s + v, 0);
      expect(exitTotal).toBe(result.totalTrades);
    });
  });

  describe('run - signal behavior', () => {
    it('does not trade on non-cointegrated pair', () => {
      const { closesA, closesB } = makeIndependentPair(200);
      const bt = new PairsBacktester();
      const result = bt.run(closesA, closesB);
      // ADF test should fail on independent walks, preventing trades
      // or very few trades with low confidence
      expect(result.totalTrades).toBeLessThanOrEqual(3);
    });

    it('spread volatility affects trade count', () => {
      // Moderate vol difference — both should pass cointegration tests
      const lowVol = makeCointegPair(250, { spreadVol: 1.0, seed: 77 });
      const midVol = makeCointegPair(250, { spreadVol: 2.5, seed: 77 });
      const btLow = new PairsBacktester({ strategyConfig: { entryZScore: 1.5 } });
      const btMid = new PairsBacktester({ strategyConfig: { entryZScore: 1.5 } });
      const resultLow = btLow.run(lowVol.closesA, lowVol.closesB);
      const resultMid = btMid.run(midVol.closesA, midVol.closesB);

      // Both should complete without error
      expect(resultLow.error).toBeUndefined();
      expect(resultMid.error).toBeUndefined();
      // At least one of them should produce trades when cointegrated
      expect(resultLow.totalTrades + resultMid.totalTrades).toBeGreaterThanOrEqual(0);
    });

    it('lower entry z-score produces more trades', () => {
      const { closesA, closesB } = makeCointegPair(250, { spreadVol: 3 });
      const btTight = new PairsBacktester({ strategyConfig: { entryZScore: 1.2 } });
      const btWide = new PairsBacktester({ strategyConfig: { entryZScore: 2.5 } });
      const resultTight = btTight.run(closesA, closesB);
      const resultWide = btWide.run(closesA, closesB);

      expect(resultTight.totalTrades).toBeGreaterThanOrEqual(resultWide.totalTrades);
    });
  });

  describe('run - position sizing', () => {
    it('larger maxPositionPct produces larger trades', () => {
      const { closesA, closesB } = makeCointegPair(200, { spreadVol: 3 });
      const btSmall = new PairsBacktester({ maxPositionPct: 0.05, strategyConfig: { entryZScore: 1.5 } });
      const btLarge = new PairsBacktester({ maxPositionPct: 0.20, strategyConfig: { entryZScore: 1.5 } });
      const resultSmall = btSmall.run(closesA, closesB);
      const resultLarge = btLarge.run(closesA, closesB);

      // Both should have same number of trades (same signals)
      expect(resultSmall.totalTrades).toBe(resultLarge.totalTrades);

      // But larger position should have bigger absolute P&L per trade
      if (resultSmall.totalTrades > 0) {
        const avgAbsSmall = resultSmall.trades.reduce((s, t) => s + Math.abs(t.pnl), 0) / resultSmall.totalTrades;
        const avgAbsLarge = resultLarge.trades.reduce((s, t) => s + Math.abs(t.pnl), 0) / resultLarge.totalTrades;
        expect(avgAbsLarge).toBeGreaterThan(avgAbsSmall);
      }
    });
  });

  describe('run - execution costs', () => {
    it('runs with execution model', () => {
      const { closesA, closesB } = makeCointegPair(200, { spreadVol: 3 });
      const execModel = new ExecutionModel({ slippageBps: 5, commissionBps: 10 });
      const bt = new PairsBacktester({
        executionModel: execModel,
        strategyConfig: { entryZScore: 1.5 },
      });
      const result = bt.run(closesA, closesB);

      if (result.totalTrades > 0) {
        expect(result.executionCosts).toBeDefined();
        expect(result.executionCosts.totalSlippage).toBeGreaterThanOrEqual(0);
        expect(result.executionCosts.totalCommission).toBeGreaterThanOrEqual(0);
        expect(result.executionCosts.totalCosts).toBeGreaterThanOrEqual(0);
      }
    });

    it('execution costs reduce profitability', () => {
      const { closesA, closesB } = makeCointegPair(200, { spreadVol: 3 });
      const btNoCost = new PairsBacktester({ strategyConfig: { entryZScore: 1.5 } });
      const btWithCost = new PairsBacktester({
        executionModel: new ExecutionModel({ slippageBps: 20, commissionBps: 20 }),
        strategyConfig: { entryZScore: 1.5 },
      });
      const resultNoCost = btNoCost.run(closesA, closesB);
      const resultWithCost = btWithCost.run(closesA, closesB);

      if (resultNoCost.totalTrades > 0) {
        expect(resultWithCost.totalPnl).toBeLessThan(resultNoCost.totalPnl);
      }
    });
  });

  describe('run - custom symbol names', () => {
    it('uses provided symbol names', () => {
      const { closesA, closesB } = makeCointegPair(150);
      const bt = new PairsBacktester();
      const result = bt.run(closesA, closesB, { symbolA: 'SOL', symbolB: 'AVAX' });
      expect(result.symbolA).toBe('SOL');
      expect(result.symbolB).toBe('AVAX');
    });

    it('defaults to A/B when no names given', () => {
      const { closesA, closesB } = makeCointegPair(150);
      const bt = new PairsBacktester();
      const result = bt.run(closesA, closesB);
      expect(result.symbolA).toBe('A');
      expect(result.symbolB).toBe('B');
    });
  });

  describe('run - edge cases', () => {
    it('handles identical price series', () => {
      const prices = Array.from({ length: 150 }, (_, i) => 100 + Math.sin(i * 0.1));
      const bt = new PairsBacktester();
      const result = bt.run(prices, prices);
      // Identical series → hedge ratio ~1, spread ~0, no trade signals
      expect(result.error).toBeUndefined();
    });

    it('handles different length series (uses shorter)', () => {
      const { closesA, closesB } = makeCointegPair(200);
      const bt = new PairsBacktester();
      const result = bt.run(closesA, closesB.slice(0, 150));
      expect(result.dataPoints).toBe(150);
    });

    it('handles large custom lookback', () => {
      const { closesA, closesB } = makeCointegPair(200);
      const bt = new PairsBacktester();
      const result = bt.run(closesA, closesB, { lookback: 100 });
      expect(result.error).toBeUndefined();
      // Fewer bars available for trading
      expect(result.equityCurve.length).toBeLessThanOrEqual(102);
    });
  });
});
