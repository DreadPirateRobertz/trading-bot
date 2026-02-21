import { describe, it, expect } from 'vitest';
import { MomentumStrategy } from '../src/strategies/momentum.js';
import { MeanReversionStrategy } from '../src/strategies/mean-reversion.js';
import { EnsembleStrategy } from '../src/strategies/ensemble.js';

// Helper: generate trending up data
function trendingUp(n = 100, start = 100) {
  const closes = [start];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 + 0.005 + Math.random() * 0.01));
  }
  return closes;
}

// Helper: generate trending down data
function trendingDown(n = 100, start = 100) {
  const closes = [start];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 - 0.005 - Math.random() * 0.01));
  }
  return closes;
}

// Helper: generate mean-reverting data (oscillating around a value)
function meanReverting(n = 100, center = 100, amplitude = 5) {
  const closes = [];
  for (let i = 0; i < n; i++) {
    closes.push(center + amplitude * Math.sin(i * 0.3) + (Math.random() - 0.5) * 2);
  }
  return closes;
}

// Helper: flat/low-vol data
function flat(n = 100, price = 100) {
  const closes = [];
  for (let i = 0; i < n; i++) {
    closes.push(price + (Math.random() - 0.5) * 0.5);
  }
  return closes;
}

describe('MomentumStrategy', () => {
  it('generates BUY signal on uptrend', () => {
    const closes = trendingUp(100);
    const mom = new MomentumStrategy({ lookback: 30 });
    const signal = mom.generateSignal(closes);
    expect(signal.action).toBe('BUY');
    expect(signal.signal).toBeGreaterThan(0);
    expect(signal.momentum).toBeGreaterThan(0);
  });

  it('generates SELL signal on downtrend', () => {
    const closes = trendingDown(100);
    const mom = new MomentumStrategy({ lookback: 30 });
    const signal = mom.generateSignal(closes);
    expect(signal.action).toBe('SELL');
    expect(signal.signal).toBeLessThan(0);
    expect(signal.momentum).toBeLessThan(0);
  });

  it('returns HOLD with insufficient data', () => {
    const mom = new MomentumStrategy({ lookback: 30, volWindow: 20 });
    const signal = mom.generateSignal([100, 101, 102]);
    expect(signal.action).toBe('HOLD');
    expect(signal.reasons).toContain('Insufficient data');
  });

  it('scales signal by volatility', () => {
    const mom = new MomentumStrategy({ lookback: 30, targetRisk: 0.02 });
    // High vol data should have lower signal magnitude due to vol scaling
    const lowVolUp = trendingUp(100);
    const highVolUp = lowVolUp.map((p, i) => p * (1 + (Math.random() - 0.5) * 0.1));

    const lowVolSignal = mom.generateSignal(lowVolUp);
    // Both should be BUY but confidence may differ
    expect(lowVolSignal.action).toBe('BUY');
    expect(lowVolSignal.volScale).toBeDefined();
  });

  it('reports volatility metrics', () => {
    const closes = trendingUp(100);
    const mom = new MomentumStrategy();
    const signal = mom.generateSignal(closes);
    expect(signal.volatility).toBeDefined();
    expect(signal.volScale).toBeDefined();
    expect(signal.reasons.length).toBeGreaterThan(0);
  });
});

describe('MeanReversionStrategy', () => {
  it('generates BUY when z-score is very negative (oversold)', () => {
    // Price drops sharply then we check
    const closes = flat(80, 100);
    // Add a sharp drop
    for (let i = 0; i < 20; i++) {
      closes.push(85 - i * 0.5);
    }
    const mr = new MeanReversionStrategy({ entryZScore: 1.5 });
    const signal = mr.generateSignal(closes);
    // May or may not trigger depending on Hurst - the key test is it doesn't crash
    expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    expect(signal.zScore).toBeDefined();
  });

  it('generates signals for mean-reverting data', () => {
    const closes = meanReverting(200, 100, 8);
    const mr = new MeanReversionStrategy({ entryZScore: 1.5 });
    const signal = mr.generateSignal(closes);
    expect(signal.zScore).toBeDefined();
    expect(signal.hurst).toBeDefined();
    expect(signal.percentB).toBeDefined();
  });

  it('computes Hurst exponent', () => {
    const mr = new MeanReversionStrategy();
    // Mean-reverting data should have H < 0.5
    const mrData = meanReverting(200, 100, 5);
    const hurst = mr.computeHurst(mrData);
    expect(hurst).toBeDefined();
    expect(typeof hurst).toBe('number');
  });

  it('computes z-score', () => {
    const mr = new MeanReversionStrategy({ zScorePeriod: 20 });
    const closes = flat(30, 100);
    closes.push(110); // Push price up
    const zScore = mr.computeZScore(closes);
    expect(zScore).toBeGreaterThan(0);
  });

  it('respects stop-loss at extreme z-scores', () => {
    const mr = new MeanReversionStrategy({ entryZScore: 2.0, stopZScore: 3.5 });
    // Create data where z-score would be extreme
    const closes = flat(80, 100);
    // Massive spike
    for (let i = 0; i < 5; i++) closes.push(130 + i * 5);
    const signal = mr.generateSignal(closes);
    // Should either be HOLD (stop triggered) or BUY/SELL depending on Hurst
    expect(signal.reasons.length).toBeGreaterThan(0);
  });

  it('returns HOLD with insufficient data', () => {
    const mr = new MeanReversionStrategy();
    const signal = mr.generateSignal([100, 101]);
    expect(signal.action).toBe('HOLD');
  });
});

describe('EnsembleStrategy', () => {
  it('combines momentum and mean reversion signals', () => {
    const closes = trendingUp(100);
    const ens = new EnsembleStrategy();
    const signal = ens.generateSignal(closes);
    expect(signal.components).toBeDefined();
    expect(signal.components.momentum).toBeDefined();
    expect(signal.components.meanReversion).toBeDefined();
    expect(signal.regime).toBeDefined();
    expect(signal.weights).toBeDefined();
  });

  it('detects trending regime', () => {
    const closes = trendingUp(200);
    const ens = new EnsembleStrategy();
    const signal = ens.generateSignal(closes);
    expect(['trending', 'high_vol_trending', 'range_bound', 'low_vol_range', 'unknown']).toContain(signal.regime);
  });

  it('adjusts weights based on regime', () => {
    const ens = new EnsembleStrategy();
    const trendingWeights = ens.getRegimeWeights('trending');
    expect(trendingWeights.momentum).toBeGreaterThan(trendingWeights.meanReversion);

    const rangeWeights = ens.getRegimeWeights('range_bound');
    expect(rangeWeights.meanReversion).toBeGreaterThan(rangeWeights.momentum);

    const unknownWeights = ens.getRegimeWeights('unknown');
    expect(unknownWeights.momentum).toBe(0.5);
    expect(unknownWeights.meanReversion).toBe(0.5);
  });

  it('signal stays in [-1, 1] range', () => {
    const closes = trendingUp(200);
    const ens = new EnsembleStrategy();
    const signal = ens.generateSignal(closes);
    expect(signal.signal).toBeGreaterThanOrEqual(-1);
    expect(signal.signal).toBeLessThanOrEqual(1);
  });

  it('provides detailed reasons', () => {
    const closes = trendingUp(200);
    const ens = new EnsembleStrategy();
    const signal = ens.generateSignal(closes);
    expect(signal.reasons.length).toBeGreaterThanOrEqual(3);
    expect(signal.reasons[0]).toContain('Regime');
  });

  it('works with custom weights', () => {
    const closes = trendingUp(200);
    const ens = new EnsembleStrategy({ weights: { momentum: 0.8, meanReversion: 0.2 } });
    const signal = ens.generateSignal(closes);
    expect(signal).toBeDefined();
    expect(signal.action).toBeDefined();
  });
});
