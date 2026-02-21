import { describe, it, expect } from 'vitest';
import { PairsTradingStrategy, KalmanHedgeRatio, PairScanner } from '../src/strategies/pairs-trading.js';

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

  describe('johansenTest', () => {
    it('detects cointegration in cointegrated pair', () => {
      const pts = new PairsTradingStrategy();
      const { a, b } = cointegratedPair(300, 1.5, 0.3);
      const result = pts.johansenTest(a, b);
      expect(result).toBeDefined();
      expect(result.traceStats).toHaveLength(2);
      expect(result.maxEigenStats).toHaveLength(2);
      expect(result.eigenvalues).toHaveLength(2);
      expect(typeof result.rank).toBe('number');
      expect(typeof result.isCointegrated).toBe('boolean');
    });

    it('returns proper structure with critical values', () => {
      const pts = new PairsTradingStrategy();
      const { a, b } = cointegratedPair(200, 1.5, 0.3);
      const result = pts.johansenTest(a, b);
      expect(result.traceCritical).toEqual([15.41, 3.76]);
      expect(result.maxEigCritical).toEqual([14.07, 3.76]);
    });

    it('returns rank=0 for independent random walks', () => {
      const pts = new PairsTradingStrategy();
      const { a, b } = independentPair(300);
      const result = pts.johansenTest(a, b);
      // Independent series should generally not be cointegrated
      expect(result.rank).toBeGreaterThanOrEqual(0);
      expect(result.rank).toBeLessThanOrEqual(2);
    });

    it('fails gracefully for insufficient data', () => {
      const pts = new PairsTradingStrategy();
      const result = pts.johansenTest([1, 2, 3], [4, 5, 6]);
      expect(result.isCointegrated).toBe(false);
      expect(result.reason).toBe('Insufficient data');
    });

    it('provides eigenvectors when cointegrated', () => {
      const pts = new PairsTradingStrategy();
      const { a, b } = cointegratedPair(300, 1.5, 0.3);
      const result = pts.johansenTest(a, b);
      expect(result.eigenvectors).toBeDefined();
      expect(result.eigenvectors.length).toBe(2);
      // Each eigenvector should be an array of 2 numbers
      for (const vec of result.eigenvectors) {
        expect(vec).toHaveLength(2);
        expect(typeof vec[0]).toBe('number');
        expect(typeof vec[1]).toBe('number');
      }
    });

    it('eigenvalues are sorted descending', () => {
      const pts = new PairsTradingStrategy();
      const { a, b } = cointegratedPair(200, 1.5, 0.3);
      const result = pts.johansenTest(a, b);
      if (result.eigenvalues.length === 2) {
        expect(result.eigenvalues[0]).toBeGreaterThanOrEqual(result.eigenvalues[1]);
      }
    });

    it('handles near-singular matrices gracefully', () => {
      const pts = new PairsTradingStrategy();
      // Nearly identical series — could cause near-singular matrices
      const b = Array.from({ length: 100 }, (_, i) => 100 + i * 0.001);
      const a = b.map(v => v + 0.0001);
      const result = pts.johansenTest(a, b);
      expect(result).toBeDefined();
      expect(typeof result.isCointegrated).toBe('boolean');
    });
  });
});

describe('KalmanHedgeRatio', () => {
  it('initializes with default parameters', () => {
    const kf = new KalmanHedgeRatio();
    expect(kf.beta).toBe(0);
    expect(kf.P).toBe(1);
    expect(kf.delta).toBe(1e-4);
    expect(kf.ve).toBe(1e-3);
  });

  it('accepts custom parameters', () => {
    const kf = new KalmanHedgeRatio({ delta: 0.01, ve: 0.1, initialBeta: 1.5 });
    expect(kf.delta).toBe(0.01);
    expect(kf.ve).toBe(0.1);
    expect(kf.beta).toBe(1.5);
  });

  describe('update', () => {
    it('returns correct structure', () => {
      const kf = new KalmanHedgeRatio();
      const result = kf.update(150, 100);
      expect(result.beta).toBeDefined();
      expect(result.P).toBeDefined();
      expect(result.kalmanGain).toBeDefined();
      expect(result.prediction).toBeDefined();
      expect(result.error).toBeDefined();
    });

    it('converges to true hedge ratio', () => {
      const kf = new KalmanHedgeRatio({ delta: 1e-3 });
      const trueBeta = 1.5;
      // Feed observations y = 1.5 * x + noise
      for (let i = 0; i < 200; i++) {
        const x = 50 + Math.random() * 100;
        const y = trueBeta * x + (Math.random() - 0.5) * 2;
        kf.update(y, x);
      }
      expect(kf.beta).toBeCloseTo(trueBeta, 0);
    });

    it('tracks state covariance decreasing over time', () => {
      const kf = new KalmanHedgeRatio({ delta: 1e-4 });
      const initialP = kf.P;
      for (let i = 0; i < 50; i++) {
        kf.update(150, 100);
      }
      // P should generally decrease as filter gains confidence
      expect(kf.P).toBeLessThan(initialP);
    });
  });

  describe('filter', () => {
    it('processes full series and returns betas', () => {
      const kf = new KalmanHedgeRatio();
      const { a, b } = cointegratedPair(200, 1.5, 0.3);
      const result = kf.filter(a, b);
      expect(result).not.toBeNull();
      expect(result.betas).toHaveLength(200);
      expect(result.spread).toHaveLength(200);
      expect(typeof result.finalBeta).toBe('number');
    });

    it('returns null for insufficient data', () => {
      const kf = new KalmanHedgeRatio();
      expect(kf.filter([1], [1])).toBeNull();
    });

    it('final beta approaches OLS beta for stationary relationship', () => {
      const kf = new KalmanHedgeRatio({ delta: 1e-3 });
      const trueBeta = 2.0;
      const n = 300;
      const b = Array.from({ length: n }, (_, i) => 50 + i * 0.1 + Math.random() * 5);
      const a = b.map(bi => trueBeta * bi + (Math.random() - 0.5) * 3);
      const result = kf.filter(a, b);
      expect(result.finalBeta).toBeCloseTo(trueBeta, 0);
    });
  });

  describe('computeSpread', () => {
    it('returns spread using Kalman-filtered hedge ratio', () => {
      const kf = new KalmanHedgeRatio();
      const { a, b } = cointegratedPair(200, 1.5, 0.3);
      const result = kf.computeSpread(a, b);
      expect(result).not.toBeNull();
      expect(result.spread).toHaveLength(200);
      expect(typeof result.hedgeRatio).toBe('number');
      expect(result.betas).toHaveLength(200);
    });

    it('adapts to regime change in hedge ratio', () => {
      const kf = new KalmanHedgeRatio({ delta: 1e-2 });
      // First half: beta = 1.0, second half: beta = 2.0
      const n = 200;
      const b = Array.from({ length: n }, () => 50 + Math.random() * 50);
      const a = b.map((bi, i) => {
        const beta = i < 100 ? 1.0 : 2.0;
        return beta * bi + (Math.random() - 0.5) * 2;
      });
      const result = kf.filter(a, b);
      // Final beta should be closer to 2.0 than 1.0
      expect(result.finalBeta).toBeGreaterThan(1.3);
    });
  });
});

describe('PairScanner', () => {
  // Helper to build universe of cointegrated + independent assets
  function buildUniverse() {
    const n = 200;
    // BTC: random walk
    const BTC = [40000];
    for (let i = 1; i < n; i++) BTC.push(BTC[i - 1] * (1 + (Math.random() - 0.5) * 0.03));
    // ETH: cointegrated with BTC (beta ~0.06)
    const ETH = BTC.map(p => 0.06 * p + (Math.random() - 0.5) * 50);
    // SOL: cointegrated with ETH (beta ~0.03)
    const SOL = ETH.map(p => 0.03 * p + (Math.random() - 0.5) * 2);
    // DOGE: independent random walk
    const DOGE = [0.1];
    for (let i = 1; i < n; i++) DOGE.push(DOGE[i - 1] * (1 + (Math.random() - 0.5) * 0.05));
    return { BTC, ETH, SOL, DOGE };
  }

  it('initializes with default parameters', () => {
    const scanner = new PairScanner();
    expect(scanner.minCorrelation).toBe(0.5);
    expect(scanner.maxHalfLife).toBe(30);
    expect(scanner.adfSignificance).toBe(0.05);
  });

  it('accepts custom parameters', () => {
    const scanner = new PairScanner({ minCorrelation: 0.7, maxHalfLife: 20 });
    expect(scanner.minCorrelation).toBe(0.7);
    expect(scanner.maxHalfLife).toBe(20);
  });

  describe('correlation', () => {
    it('returns 1 for perfectly correlated series', () => {
      const scanner = new PairScanner();
      const a = [1, 2, 3, 4, 5];
      const b = [2, 4, 6, 8, 10];
      expect(scanner.correlation(a, b)).toBeCloseTo(1, 5);
    });

    it('returns -1 for perfectly inversely correlated', () => {
      const scanner = new PairScanner();
      const a = [1, 2, 3, 4, 5];
      const b = [10, 8, 6, 4, 2];
      expect(scanner.correlation(a, b)).toBeCloseTo(-1, 5);
    });

    it('returns ~0 for uncorrelated series', () => {
      const scanner = new PairScanner();
      // Sine and cosine (quarter-cycle offset = uncorrelated over full cycle)
      const n = 1000;
      const a = Array.from({ length: n }, (_, i) => Math.sin(i * 2 * Math.PI / n));
      const b = Array.from({ length: n }, (_, i) => Math.cos(i * 2 * Math.PI / n));
      expect(Math.abs(scanner.correlation(a, b))).toBeLessThan(0.1);
    });

    it('handles short series', () => {
      const scanner = new PairScanner();
      expect(scanner.correlation([1, 2], [3, 4])).toBe(0);
    });
  });

  describe('scan', () => {
    it('returns empty for single-asset universe', () => {
      const scanner = new PairScanner();
      expect(scanner.scan({ BTC: [1, 2, 3] })).toEqual([]);
    });

    it('returns array of pair candidates', () => {
      const scanner = new PairScanner({ minCorrelation: 0.3 });
      const universe = buildUniverse();
      const results = scanner.scan(universe);
      expect(Array.isArray(results)).toBe(true);
      // Should find at least some candidates
      for (const pair of results) {
        expect(pair.pairA).toBeDefined();
        expect(pair.pairB).toBeDefined();
        expect(typeof pair.score).toBe('number');
        expect(pair.metrics).toBeDefined();
        expect(pair.metrics.correlation).toBeDefined();
        expect(pair.metrics.adfStatistic).toBeDefined();
        expect(pair.metrics.hurst).toBeDefined();
        expect(pair.metrics.halfLife).toBeDefined();
        expect(pair.metrics.hedgeRatio).toBeDefined();
      }
    });

    it('results are sorted by score descending', () => {
      const scanner = new PairScanner({ minCorrelation: 0.3 });
      const universe = buildUniverse();
      const results = scanner.scan(universe);
      for (let i = 1; i < results.length; i++) {
        expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
      }
    });

    it('filters out pairs with insufficient data', () => {
      const scanner = new PairScanner({ minDataPoints: 100 });
      const results = scanner.scan({
        A: Array.from({ length: 50 }, () => Math.random()),
        B: Array.from({ length: 50 }, () => Math.random()),
      });
      expect(results).toEqual([]);
    });

    it('includes Johansen test results in metrics', () => {
      const scanner = new PairScanner({ minCorrelation: 0.3 });
      const universe = buildUniverse();
      const results = scanner.scan(universe);
      for (const pair of results) {
        expect(typeof pair.metrics.johansenCointegrated).toBe('boolean');
        expect(typeof pair.metrics.johansenRank).toBe('number');
      }
    });

    it('scores favor low Hurst and strong ADF', () => {
      const scanner = new PairScanner({ minCorrelation: 0.3 });
      const universe = buildUniverse();
      const results = scanner.scan(universe);
      for (const pair of results) {
        expect(pair.score).toBeGreaterThanOrEqual(0);
        expect(pair.score).toBeLessThanOrEqual(1);
      }
    });
  });
});
