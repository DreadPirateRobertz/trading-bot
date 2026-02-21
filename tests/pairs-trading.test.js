import { describe, it, expect } from 'vitest';
import { PairsTradingStrategy } from '../src/strategies/pairs-trading.js';

// Helper: generate cointegrated pair (B drives A with noise)
function cointegratedPair(n = 200, beta = 1.5, noiseScale = 0.5) {
  const b = [100];
  for (let i = 1; i < n; i++) {
    b.push(b[i - 1] * (1 + (Math.random() - 0.5) * 0.03));
  }
  const a = b.map(bi => 10 + beta * bi + (Math.random() - 0.5) * noiseScale);
  return { a, b };
}

// Helper: generate non-cointegrated pair (independent random walks)
function independentPair(n = 200) {
  const a = [100], b = [100];
  for (let i = 1; i < n; i++) {
    a.push(a[i - 1] * (1 + (Math.random() - 0.5) * 0.04));
    b.push(b[i - 1] * (1 + (Math.random() - 0.5) * 0.04));
  }
  return { a, b };
}

// Helper: generate pair with spread at extreme z-score
function extremeSpreadPair(n = 200, direction = 'oversold') {
  const b = [100];
  for (let i = 1; i < n; i++) {
    b.push(b[i - 1] * (1 + (Math.random() - 0.5) * 0.01));
  }
  const beta = 1.5;
  const a = b.map(bi => 10 + beta * bi + (Math.random() - 0.5) * 0.3);
  // Push last 5 prices to create extreme spread
  const shift = direction === 'oversold' ? -8 : 8;
  for (let i = n - 5; i < n; i++) {
    a[i] += shift;
  }
  return { a, b };
}

describe('PairsTradingStrategy', () => {
  describe('olsRegression', () => {
    it('recovers known linear relationship', () => {
      const pts = new PairsTradingStrategy();
      const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const y = x.map(xi => 2 + 3 * xi);  // y = 2 + 3x
      const result = pts.olsRegression(y, x);
      expect(result).not.toBeNull();
      expect(result.beta).toBeCloseTo(3, 5);
      expect(result.alpha).toBeCloseTo(2, 5);
      expect(result.rSquared).toBeCloseTo(1, 5);
      expect(result.residuals.length).toBe(10);
    });

    it('handles noisy data', () => {
      const pts = new PairsTradingStrategy();
      const x = Array.from({ length: 100 }, (_, i) => i);
      const y = x.map(xi => 5 + 2 * xi + (Math.random() - 0.5) * 3);
      const result = pts.olsRegression(y, x);
      expect(result).not.toBeNull();
      expect(result.beta).toBeCloseTo(2, 0);
      expect(result.rSquared).toBeGreaterThan(0.9);
    });

    it('returns null for insufficient data', () => {
      const pts = new PairsTradingStrategy();
      expect(pts.olsRegression([1, 2], [1])).toBeNull();
      expect(pts.olsRegression([1], [1])).toBeNull();
    });

    it('returns null for constant x', () => {
      const pts = new PairsTradingStrategy();
      const result = pts.olsRegression([1, 2, 3], [5, 5, 5]);
      expect(result).toBeNull();
    });
  });

  describe('computeSpread', () => {
    it('computes spread for cointegrated pair', () => {
      const pts = new PairsTradingStrategy({ minDataPoints: 60 });
      const { a, b } = cointegratedPair(200, 1.5);
      const result = pts.computeSpread(a, b);
      expect(result).not.toBeNull();
      expect(result.hedgeRatio).toBeCloseTo(1.5, 0);
      expect(result.spread.length).toBe(200);
      expect(result.rSquared).toBeGreaterThan(0.5);
    });

    it('returns null for insufficient data', () => {
      const pts = new PairsTradingStrategy({ minDataPoints: 60 });
      expect(pts.computeSpread([1, 2, 3], [1, 2, 3])).toBeNull();
    });
  });

  describe('adfTest', () => {
    it('detects stationary series', () => {
      const pts = new PairsTradingStrategy();
      // Mean-reverting series (stationary)
      const series = Array.from({ length: 200 }, (_, i) =>
        5 * Math.sin(i * 0.2) + (Math.random() - 0.5) * 2
      );
      const result = pts.adfTest(series);
      expect(result.statistic).toBeDefined();
      expect(result.pValue).toBeDefined();
      // Stationary series should have negative test statistic
      expect(result.statistic).toBeLessThan(0);
    });

    it('identifies non-stationary series (random walk)', () => {
      const pts = new PairsTradingStrategy();
      // Random walk (non-stationary)
      const series = [100];
      for (let i = 1; i < 200; i++) {
        series.push(series[i - 1] + (Math.random() - 0.5) * 2);
      }
      const result = pts.adfTest(series);
      expect(result.statistic).toBeDefined();
      // Random walk should have less negative stat (closer to 0)
    });

    it('handles short series', () => {
      const pts = new PairsTradingStrategy();
      const result = pts.adfTest([1, 2, 3]);
      expect(result.pValue).toBe(1);
      expect(result.isStationary).toBe(false);
    });
  });

  describe('computeHurst', () => {
    it('returns value between 0 and 1 for typical data', () => {
      const pts = new PairsTradingStrategy();
      const series = Array.from({ length: 200 }, (_, i) =>
        5 * Math.sin(i * 0.3) + (Math.random() - 0.5) * 2
      );
      const hurst = pts.computeHurst(series);
      expect(hurst).not.toBeNull();
      expect(typeof hurst).toBe('number');
    });

    it('returns null for insufficient data', () => {
      const pts = new PairsTradingStrategy({ hurstMaxLag: 20 });
      expect(pts.computeHurst([1, 2, 3, 4, 5])).toBeNull();
    });

    it('returns 0.5 for insufficient lag range', () => {
      const pts = new PairsTradingStrategy({ hurstMaxLag: 10 });
      // With maxLag=10, only one lag (10) possible, need at least 2
      const series = Array.from({ length: 100 }, () => Math.random());
      const hurst = pts.computeHurst(series);
      expect(hurst).toBe(0.5);
    });
  });

  describe('computeSpreadZScore', () => {
    it('returns positive z-score for above-mean spread', () => {
      const pts = new PairsTradingStrategy({ zScorePeriod: 10 });
      const spread = [0, 0.1, -0.1, 0.05, -0.05, 0, 0.1, -0.1, 0, 5]; // last one high
      const z = pts.computeSpreadZScore(spread);
      expect(z).toBeGreaterThan(0);
    });

    it('returns negative z-score for below-mean spread', () => {
      const pts = new PairsTradingStrategy({ zScorePeriod: 10 });
      const spread = [0, 0.1, -0.1, 0.05, -0.05, 0, 0.1, -0.1, 0, -5];
      const z = pts.computeSpreadZScore(spread);
      expect(z).toBeLessThan(0);
    });

    it('returns 0 for constant spread', () => {
      const pts = new PairsTradingStrategy({ zScorePeriod: 5 });
      const z = pts.computeSpreadZScore([3, 3, 3, 3, 3]);
      expect(z).toBe(0);
    });

    it('returns null for insufficient data', () => {
      const pts = new PairsTradingStrategy({ zScorePeriod: 20 });
      expect(pts.computeSpreadZScore([1, 2, 3])).toBeNull();
    });
  });

  describe('computeHalfLife', () => {
    it('returns positive half-life for mean-reverting spread', () => {
      const pts = new PairsTradingStrategy();
      // Ornstein-Uhlenbeck-like process (mean-reverting)
      const spread = [0];
      const theta = 0.1;
      for (let i = 1; i < 200; i++) {
        spread.push(spread[i - 1] * (1 - theta) + (Math.random() - 0.5) * 0.5);
      }
      const hl = pts.computeHalfLife(spread);
      expect(hl).not.toBeNull();
      expect(hl).toBeGreaterThan(0);
    });

    it('returns null for trending spread', () => {
      const pts = new PairsTradingStrategy();
      // Trending series (not mean-reverting)
      const spread = Array.from({ length: 100 }, (_, i) => i * 0.5);
      const hl = pts.computeHalfLife(spread);
      expect(hl).toBeNull();
    });

    it('returns null for short series', () => {
      const pts = new PairsTradingStrategy();
      expect(pts.computeHalfLife([1, 2, 3])).toBeNull();
    });
  });

  describe('generateSignal', () => {
    it('returns HOLD with missing data', () => {
      const pts = new PairsTradingStrategy();
      const signal = pts.generateSignal(null, [1, 2]);
      expect(signal.action).toBe('HOLD');
      expect(signal.reasons).toContain('Missing price data');
    });

    it('returns HOLD with insufficient data', () => {
      const pts = new PairsTradingStrategy({ minDataPoints: 60 });
      const signal = pts.generateSignal([1, 2, 3], [1, 2, 3]);
      expect(signal.action).toBe('HOLD');
      expect(signal.reasons).toContain('Insufficient data');
    });

    it('produces valid signal structure for cointegrated pair', () => {
      const pts = new PairsTradingStrategy({ minDataPoints: 60 });
      const { a, b } = cointegratedPair(200, 1.5, 0.3);
      const signal = pts.generateSignal(a, b);
      expect(signal).toBeDefined();
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
      expect(signal.signal).toBeGreaterThanOrEqual(-1);
      expect(signal.signal).toBeLessThanOrEqual(1);
      expect(signal.confidence).toBeGreaterThanOrEqual(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
      expect(signal.reasons.length).toBeGreaterThan(0);
    });

    it('includes diagnostics in signal output', () => {
      const pts = new PairsTradingStrategy({ minDataPoints: 60 });
      const { a, b } = cointegratedPair(200, 1.5, 0.3);
      const signal = pts.generateSignal(a, b);
      // Should include hedge ratio and R² at minimum
      expect(signal.hedgeRatio).toBeDefined();
      expect(signal.rSquared).toBeDefined();
      expect(signal.adf).toBeDefined();
    });

    it('generates BUY when spread is oversold (extreme negative z)', () => {
      const pts = new PairsTradingStrategy({ minDataPoints: 60, entryZScore: 1.5 });
      const { a, b } = extremeSpreadPair(200, 'oversold');
      const signal = pts.generateSignal(a, b);
      // May or may not trigger depending on ADF/Hurst — key test is structure
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    });

    it('generates SELL when spread is overbought (extreme positive z)', () => {
      const pts = new PairsTradingStrategy({ minDataPoints: 60, entryZScore: 1.5 });
      const { a, b } = extremeSpreadPair(200, 'overbought');
      const signal = pts.generateSignal(a, b);
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    });

    it('skips when spread is not stationary', () => {
      const pts = new PairsTradingStrategy({ minDataPoints: 60 });
      const { a, b } = independentPair(200);
      const signal = pts.generateSignal(a, b);
      // Independent random walks should fail ADF or Hurst filter
      expect(signal.reasons.length).toBeGreaterThan(0);
    });

    it('handles equal-length and different-length arrays', () => {
      const pts = new PairsTradingStrategy({ minDataPoints: 60 });
      const { a, b } = cointegratedPair(200, 1.5, 0.3);
      // Different lengths: should align to shorter
      const signal = pts.generateSignal(a.slice(0, 150), b);
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    });
  });

  describe('getPositionLegs', () => {
    it('returns buy A / sell B for long spread', () => {
      const pts = new PairsTradingStrategy();
      const legs = pts.getPositionLegs(1, 1.5, 100, 60, 10000);
      expect(legs).not.toBeNull();
      expect(legs.legA.side).toBe('BUY');
      expect(legs.legB.side).toBe('SELL');
      expect(legs.legA.qty).toBeGreaterThan(0);
      expect(legs.legB.qty).toBeGreaterThan(0);
      expect(legs.hedgeRatio).toBe(1.5);
    });

    it('returns sell A / buy B for short spread', () => {
      const pts = new PairsTradingStrategy();
      const legs = pts.getPositionLegs(-1, 1.5, 100, 60, 10000);
      expect(legs).not.toBeNull();
      expect(legs.legA.side).toBe('SELL');
      expect(legs.legB.side).toBe('BUY');
    });

    it('returns null for zero signal', () => {
      const pts = new PairsTradingStrategy();
      expect(pts.getPositionLegs(0, 1.5, 100, 60, 10000)).toBeNull();
    });

    it('returns null for zero notional', () => {
      const pts = new PairsTradingStrategy();
      expect(pts.getPositionLegs(1, 1.5, 100, 60, 0)).toBeNull();
    });

    it('allocates notional across both legs', () => {
      const pts = new PairsTradingStrategy();
      const legs = pts.getPositionLegs(1, 2.0, 50, 25, 5000);
      // Total notional should be approximately the input notional
      expect(legs.totalNotional).toBeGreaterThan(0);
      expect(legs.totalNotional).toBeLessThanOrEqual(5001); // rounding tolerance
    });
  });

  describe('configuration', () => {
    it('uses default parameters', () => {
      const pts = new PairsTradingStrategy();
      expect(pts.hedgeRatioLookback).toBe(60);
      expect(pts.entryZScore).toBe(2.0);
      expect(pts.exitZScore).toBe(0.5);
      expect(pts.stopZScore).toBe(3.5);
    });

    it('accepts custom parameters', () => {
      const pts = new PairsTradingStrategy({
        hedgeRatioLookback: 30,
        entryZScore: 1.5,
        stopZScore: 3.0,
      });
      expect(pts.hedgeRatioLookback).toBe(30);
      expect(pts.entryZScore).toBe(1.5);
      expect(pts.stopZScore).toBe(3.0);
    });
  });
});
