// tb-658: Paper trading stress test with ML signals
// Exercises the full ML-enhanced ensemble pipeline under diverse market conditions:
// - Walk-forward training + evaluation across regime transitions
// - Extreme volatility, flash crashes, and grinding bear markets
// - Portfolio risk manager integration
// - Position sizing under stress
// - Verifies no NaN/Infinity leaks, no negative equity, no position overflow

import { describe, it, expect } from 'vitest';
import { WalkForwardEvaluator, generateRegimeData } from '../src/ml/walk-forward-evaluator.js';
import { PortfolioRiskManager } from '../src/risk/portfolio-risk-manager.js';
import { PositionSizer } from '../src/signals/position-sizer.js';
import { MultiTimeframeAnalyzer } from '../src/analysis/multi-timeframe.js';
import { NeuralNetwork } from '../src/ml/model.js';
import { extractFeatures, generateTrainingData, NUM_FEATURES, NUM_CLASSES } from '../src/ml/features.js';
import { GaussianHMM } from '../src/ml/hmm.js';
import { EnsembleStrategy } from '../src/strategies/ensemble.js';
import { PaperTrader } from '../src/paper-trading/index.js';

// Generate stress-specific data patterns
function generateFlashCrash(startPrice, length) {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < length; i++) {
    const open = price;
    if (i === Math.floor(length * 0.6)) {
      // Flash crash: 30% drop in one bar
      price *= 0.70;
    } else if (i > length * 0.6 && i < length * 0.75) {
      // Partial recovery
      price *= 1 + Math.random() * 0.03;
    } else {
      price *= 1 + (Math.random() - 0.48) * 0.02;
    }
    price = Math.max(price, 0.01);
    candles.push({
      openTime: Date.now() - (length - i) * 60000,
      open: r(open), high: r(Math.max(open, price) * 1.005),
      low: r(Math.min(open, price) * 0.995), close: r(price),
      volume: Math.round(1e6 * (0.5 + Math.random() * 3)),
    });
  }
  return candles;
}

function generateGrindingBear(startPrice, length) {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < length; i++) {
    const open = price;
    price *= 1 + (-0.003 + (Math.random() - 0.5) * 0.01);
    price = Math.max(price, 0.01);
    candles.push({
      openTime: Date.now() - (length - i) * 60000,
      open: r(open), high: r(Math.max(open, price) * 1.003),
      low: r(Math.min(open, price) * 0.997), close: r(price),
      volume: Math.round(5e5 * (0.5 + Math.random())),
    });
  }
  return candles;
}

function generateExtremeVol(startPrice, length) {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < length; i++) {
    const open = price;
    price *= 1 + (Math.random() - 0.5) * 0.10; // 10% swings
    price = Math.max(price, 0.01);
    candles.push({
      openTime: Date.now() - (length - i) * 60000,
      open: r(open), high: r(Math.max(open, price) * 1.02),
      low: r(Math.min(open, price) * 0.98), close: r(price),
      volume: Math.round(2e6 * (1 + Math.random() * 5)),
    });
  }
  return candles;
}

function r(n) { return Math.round(n * 100) / 100; }

describe('ML Pipeline Stress Test (tb-658)', () => {
  const CANDLES = 500;
  const INITIAL_BALANCE = 100000;

  describe('walk-forward evaluator under regime data', () => {
    it('completes 10-session multi-regime evaluation without errors', () => {
      const evaluator = new WalkForwardEvaluator({
        epochs: 30, retrainInterval: 80, minTrainSamples: 60,
      });
      const results = [];

      for (let s = 0; s < 10; s++) {
        const candles = generateRegimeData(30000 + Math.random() * 30000, CANDLES);
        const result = evaluator.evaluate(candles);
        expect(result.error).toBeUndefined();
        results.push(result);
      }

      expect(results.length).toBe(10);
      for (const result of results) {
        expect(result.mlEnsemble).toBeDefined();
        expect(result.mlEnsemble.sharpeRatio).not.toBeNaN();
        expect(result.mlEnsemble.totalReturn).not.toBeNaN();
        expect(result.mlEnsemble.maxDrawdown).toBeGreaterThanOrEqual(0);
        expect(result.mlEnsemble.finalEquity).toBeGreaterThan(0);
        expect(Number.isFinite(result.mlEnsemble.sharpeRatio)).toBe(true);
      }
    });

    it('ML ensemble produces non-degenerate results', () => {
      const evaluator = new WalkForwardEvaluator({ epochs: 30 });
      const candles = generateRegimeData(40000, CANDLES);
      const result = evaluator.evaluate(candles);

      // Should have actually traded
      expect(result.mlEnsemble.totalTrades).toBeGreaterThan(0);
      // Execution costs tracked when configured
      expect(result.mlEnsemble.executionCosts).toBeGreaterThanOrEqual(0);
    });
  });

  describe('flash crash resilience', () => {
    it('survives flash crash without negative equity', () => {
      const candles = generateFlashCrash(50000, CANDLES);
      const evaluator = new WalkForwardEvaluator({
        epochs: 20, minTrainSamples: 50, retrainInterval: 60,
      });
      const result = evaluator.evaluate(candles);

      expect(result.error).toBeUndefined();
      expect(result.mlEnsemble.finalEquity).toBeGreaterThan(0);
      expect(result.bbConservative.finalEquity).toBeGreaterThan(0);
      expect(result.momentum7d.finalEquity).toBeGreaterThan(0);

      // All Sharpe ratios should be finite
      for (const key of ['mlEnsemble', 'rulesOnlyEnsemble', 'bbConservative', 'momentum7d']) {
        expect(Number.isFinite(result[key].sharpeRatio)).toBe(true);
        expect(Number.isFinite(result[key].maxDrawdown)).toBe(true);
      }
    });

    it('trailing stop limits drawdown during crash', () => {
      const candles = generateFlashCrash(50000, CANDLES);
      const evaluator = new WalkForwardEvaluator({ epochs: 20 });
      const result = evaluator.evaluate(candles);

      // 15% trailing stop should cap drawdown — some tolerance for timing
      expect(result.mlEnsemble.maxDrawdown).toBeLessThan(50);
    });
  });

  describe('grinding bear market', () => {
    it('handles prolonged downtrend without blowup', () => {
      const candles = generateGrindingBear(45000, CANDLES);
      const evaluator = new WalkForwardEvaluator({ epochs: 20 });
      const result = evaluator.evaluate(candles);

      expect(result.error).toBeUndefined();
      expect(result.mlEnsemble.finalEquity).toBeGreaterThan(0);
      // Should lose money but not catastrophically
      expect(result.mlEnsemble.totalReturn).toBeGreaterThan(-50);
    });
  });

  describe('extreme volatility', () => {
    it('handles 10% daily swings without NaN/Infinity', () => {
      const candles = generateExtremeVol(40000, CANDLES);
      const evaluator = new WalkForwardEvaluator({ epochs: 20 });
      const result = evaluator.evaluate(candles);

      expect(result.error).toBeUndefined();
      for (const key of ['mlEnsemble', 'rulesOnlyEnsemble', 'bbConservative', 'momentum7d']) {
        const r = result[key];
        expect(Number.isFinite(r.sharpeRatio)).toBe(true);
        expect(Number.isFinite(r.sortinoRatio)).toBe(true);
        expect(Number.isFinite(r.calmarRatio)).toBe(true);
        expect(Number.isFinite(r.maxDrawdown)).toBe(true);
        expect(Number.isFinite(r.totalReturn)).toBe(true);
        expect(r.finalEquity).toBeGreaterThan(0);
      }
    });
  });

  describe('neural network robustness', () => {
    it('trains without NaN weights on noisy data', () => {
      const candles = generateExtremeVol(40000, 300);
      const data = generateTrainingData(candles, {
        lookback: 30, horizon: 5, buyThreshold: 0.02, sellThreshold: -0.02,
      });

      if (data.length >= 20) {
        const model = new NeuralNetwork({
          layers: [NUM_FEATURES, 16, 8, NUM_CLASSES],
          learningRate: 0.01,
        });
        model.trainBalanced(data, { epochs: 30, shuffle: true });

        // Verify no NaN in weights
        for (const layer of model.weights) {
          for (const row of layer) {
            for (const w of row) {
              expect(Number.isFinite(w)).toBe(true);
            }
          }
        }

        // Predict should return valid probabilities
        const features = extractFeatures(candles.slice(-31));
        if (features) {
          const pred = model.predict(features);
          expect(pred.length).toBe(NUM_CLASSES);
          for (const p of pred) {
            expect(p).toBeGreaterThanOrEqual(0);
            expect(p).toBeLessThanOrEqual(1);
            expect(Number.isFinite(p)).toBe(true);
          }
        }
      }
    });
  });

  describe('HMM regime detection under stress', () => {
    it('classifies regimes in volatile data without errors', () => {
      const candles = generateExtremeVol(40000, 300);
      const hmm = new GaussianHMM();
      const obs = GaussianHMM.extractObservations(candles, { volWindow: 20 });

      if (obs.length >= 50) {
        hmm.fit(obs);
        expect(hmm.trained).toBe(true);

        const regime = hmm.currentRegime(obs);
        expect(regime).toBeDefined();
        expect(regime.regime).toBeDefined();
        expect(['bull', 'bear', 'range', 'high_vol']).toContain(regime.regime);
      }
    });

    it('handles flash crash data', () => {
      const candles = generateFlashCrash(50000, 300);
      const hmm = new GaussianHMM();
      const obs = GaussianHMM.extractObservations(candles, { volWindow: 20 });

      if (obs.length >= 50) {
        hmm.fit(obs);
        expect(hmm.trained).toBe(true);
        const states = hmm.decode(obs);
        expect(states.length).toBe(obs.length);
      }
    });
  });

  describe('risk manager under stress', () => {
    it('circuit breaker triggers during flash crash simulation', () => {
      const rm = new PortfolioRiskManager({ circuitBreakerDrawdown: 0.15 });
      rm.update({ equity: INITIAL_BALANCE, bar: 0 });

      // Simulate equity path during flash crash
      let equity = INITIAL_BALANCE;
      let triggered = false;
      for (let i = 1; i <= 100; i++) {
        if (i === 60) equity *= 0.80; // 20% drop
        else equity *= 1 + (Math.random() - 0.49) * 0.01;
        rm.update({ equity, bar: i });
        if (rm.circuitBreakerActive) { triggered = true; break; }
      }

      expect(triggered).toBe(true);
    });

    it('blocks new positions when heat limit is reached', () => {
      const rm = new PortfolioRiskManager({ maxPortfolioHeat: 0.50 });
      rm.update({
        equity: INITIAL_BALANCE,
        bar: 0,
        positions: {
          BTC: { qty: 1, currentPrice: 30000 },
          ETH: { qty: 10, currentPrice: 2000 },
        },
      });
      // Exposure: 30k + 20k = 50k = 50% = at limit

      const result = rm.evaluateTrade({
        symbol: 'SOL', side: 'buy', qty: 100, price: 100,
      });
      expect(result.allowed).toBe(false);
      expect(result.riskFlags).toContain('portfolio_heat');
    });
  });

  describe('position sizer under extreme conditions', () => {
    it('handles very high volatility without oversizing', () => {
      const sizer = new PositionSizer({ maxPositionPct: 0.25, kellyFraction: 0.33 });
      const result = sizer.calculate({
        portfolioValue: INITIAL_BALANCE,
        price: 50000,
        confidence: 0.9,
        volatility: 0.15, // extreme daily vol
      });

      // Should scale down due to high vol
      expect(result.qty).toBeGreaterThanOrEqual(0);
      expect(result.value).toBeLessThanOrEqual(INITIAL_BALANCE * 0.25);
    });

    it('handles zero-price edge case', () => {
      const sizer = new PositionSizer();
      const result = sizer.calculate({
        portfolioValue: INITIAL_BALANCE, price: 0, confidence: 0.5,
      });
      expect(result.qty).toBe(0);
    });
  });

  describe('multi-timeframe under stress data', () => {
    it('detects trends in flash crash data', () => {
      const candles = generateFlashCrash(50000, 500);
      const mtf = new MultiTimeframeAnalyzer({ timeframes: ['5m', '15m'] });
      const analysis = mtf.analyze(candles);

      expect(analysis.trends).toBeDefined();
      expect(analysis.confirmation).toBeDefined();
      // After flash crash, should detect bearish bias
      expect(analysis.confirmation.overall).toBeDefined();
    });

    it('signal confirmation works with volatile data', () => {
      const candles = generateExtremeVol(40000, 500);
      const mtf = new MultiTimeframeAnalyzer({ timeframes: ['5m', '15m'] });
      const result = mtf.confirmSignal({ action: 'BUY', confidence: 0.7 }, candles);

      expect(result).toBeDefined();
      expect(Number.isFinite(result.adjustedConfidence)).toBe(true);
      expect(result.adjustedConfidence).toBeGreaterThanOrEqual(0);
      expect(result.adjustedConfidence).toBeLessThanOrEqual(1);
    });
  });

  describe('full integration: ensemble + risk + MTF', () => {
    it('end-to-end paper trade with all systems active', () => {
      const candles = generateRegimeData(40000, CANDLES);
      const rm = new PortfolioRiskManager();
      const sizer = new PositionSizer({ maxPositionPct: 0.25, kellyFraction: 0.33 });
      const mtf = new MultiTimeframeAnalyzer({ timeframes: ['5m', '15m'] });
      const trader = new PaperTrader({ initialBalance: INITIAL_BALANCE });
      const ensemble = new EnsembleStrategy({
        momentumConfig: { lookback: 7, targetRisk: 0.015 },
      });

      rm.update({ equity: INITIAL_BALANCE, bar: 0 });
      rm.startNewDay(INITIAL_BALANCE);

      let trades = 0;
      let riskBlocks = 0;

      for (let i = 60; i < candles.length; i++) {
        const price = candles[i].close;
        trader.updatePrices({ asset: price });

        const closes = candles.slice(0, i + 1).map(c => c.close);
        const signal = ensemble.generateSignal(closes);

        // MTF check
        const windowCandles = candles.slice(0, i + 1);
        const mtfResult = mtf.confirmSignal(signal, windowCandles);

        // Risk check
        const equity = trader.cash + (trader.getPosition('asset')?.qty || 0) * price;
        rm.update({
          equity,
          bar: i,
          positions: trader.getPosition('asset')
            ? { asset: { qty: trader.getPosition('asset').qty, currentPrice: price } }
            : {},
        });

        if (signal.action === 'BUY' && mtfResult.confirmed && !trader.getPosition('asset')) {
          const sizing = sizer.calculate({
            portfolioValue: equity, price, confidence: mtfResult.adjustedConfidence,
          });
          const riskCheck = rm.evaluateTrade({
            symbol: 'asset', side: 'buy', qty: sizing.qty, price,
          });

          if (riskCheck.allowed && riskCheck.adjustedQty > 0) {
            trader.buy('asset', riskCheck.adjustedQty, price);
            rm.recordTrade('asset');
            trades++;
          } else {
            riskBlocks++;
          }
        } else if (signal.action === 'SELL' && trader.getPosition('asset')) {
          const pos = trader.getPosition('asset');
          trader.sell('asset', pos.qty, price);
          trades++;
        }
      }

      // Close remaining
      const pos = trader.getPosition('asset');
      if (pos) trader.sell('asset', pos.qty, candles[candles.length - 1].close);

      const finalEquity = trader.cash;
      expect(finalEquity).toBeGreaterThan(0);
      expect(Number.isFinite(finalEquity)).toBe(true);
      expect(trades).toBeGreaterThan(0);

      // Risk dashboard should be populated
      const dash = rm.getRiskDashboard();
      expect(dash.equity).toBeGreaterThan(0);
    });
  });
});
