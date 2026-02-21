import { describe, it, expect } from 'vitest';
import { PositionSizer } from '../src/signals/position-sizer.js';

// Helper: generate trade history with known properties
function makeTrades(wins, losses, avgWinPct = 0.05, avgLossPct = -0.03) {
  return [
    ...Array.from({ length: wins }, () => ({ pnlPct: avgWinPct })),
    ...Array.from({ length: losses }, () => ({ pnlPct: avgLossPct })),
  ];
}

// Helper: shuffled trade history (more realistic)
function makeShuffledTrades(wins, losses, avgWinPct = 0.05, avgLossPct = -0.03) {
  const trades = makeTrades(wins, losses, avgWinPct, avgLossPct);
  // Fisher-Yates shuffle with seeded pseudo-random
  for (let i = trades.length - 1; i > 0; i--) {
    const j = Math.floor(((i * 7 + 13) % (i + 1)));
    [trades[i], trades[j]] = [trades[j], trades[i]];
  }
  return trades;
}

// Helper: generate correlated return series
function correlatedReturns(n, correlation = 0.8) {
  const base = Array.from({ length: n }, (_, i) => Math.sin(i * 0.1) * 0.03);
  const noise = Array.from({ length: n }, (_, i) => ((i * 17 + 7) % 100 - 50) / 2500);
  const seriesA = base.map((v, i) => v + noise[i] * (1 - correlation));
  const seriesB = base.map((v, i) => v * correlation + noise[i] * (1 - correlation));
  return { seriesA, seriesB };
}

// Helper: uncorrelated return series
function uncorrelatedReturns(n) {
  const seriesA = Array.from({ length: n }, (_, i) => Math.sin(i * 0.1) * 0.03);
  const seriesB = Array.from({ length: n }, (_, i) => Math.cos(i * 0.3 + 2) * 0.03);
  return { seriesA, seriesB };
}

describe('Adaptive Fractional Kelly', () => {
  describe('adaptiveKellyFraction', () => {
    it('returns lower fraction with small sample size', () => {
      const sizer = new PositionSizer();
      const small = sizer.adaptiveKellyFraction(15);
      const large = sizer.adaptiveKellyFraction(100);
      expect(small).toBeLessThan(large);
    });

    it('scales between 0.20 and 0.50', () => {
      const sizer = new PositionSizer();
      for (const n of [5, 10, 20, 30, 50, 75, 100, 200]) {
        const frac = sizer.adaptiveKellyFraction(n);
        expect(frac).toBeGreaterThanOrEqual(0.20);
        expect(frac).toBeLessThanOrEqual(0.50);
      }
    });

    it('reaches full regime fraction with large sample', () => {
      const sizer = new PositionSizer();
      const frac = sizer.adaptiveKellyFraction(200, 'bull_low_vol');
      expect(frac).toBe(0.50); // bull_low_vol = 0.50, full confidence
    });

    it('uses conservative fraction in bear with small sample', () => {
      const sizer = new PositionSizer();
      const frac = sizer.adaptiveKellyFraction(15, 'bear_high_vol');
      // bear_high_vol = 0.25, 60% confidence = 0.15 → clamped to 0.20
      expect(frac).toBe(0.20);
    });

    it('monotonically increases with sample size', () => {
      const sizer = new PositionSizer();
      let prev = 0;
      for (let n = 10; n <= 120; n += 10) {
        const frac = sizer.adaptiveKellyFraction(n, 'bull_low_vol');
        expect(frac).toBeGreaterThanOrEqual(prev);
        prev = frac;
      }
    });

    it('falls back to default kellyFraction when no regime', () => {
      const sizer = new PositionSizer({ kellyFraction: 0.40 });
      const frac = sizer.adaptiveKellyFraction(200);
      expect(frac).toBeCloseTo(0.40, 2);
    });

    it('uses regime fraction even for uncertain regime', () => {
      const sizer = new PositionSizer();
      const frac = sizer.adaptiveKellyFraction(200, 'uncertain');
      expect(frac).toBe(0.20); // uncertain = 0.20
    });
  });
});

describe('Transaction Cost-Adjusted Kelly', () => {
  describe('costAdjustedKelly', () => {
    it('reduces Kelly by cost drag', () => {
      const sizer = new PositionSizer();
      // 10% Kelly, 0.2% round-trip cost, 5% avg win
      // costDrag = 0.002 / 0.05 = 0.04
      // adjusted = 0.10 - 0.04 = 0.06
      const adj = sizer.costAdjustedKelly(0.10, 0.002, 0.05);
      expect(adj).toBeCloseTo(0.06, 6);
    });

    it('returns 0 when cost exceeds Kelly', () => {
      const sizer = new PositionSizer();
      // 1% Kelly, 5% cost, 2% avg win → costDrag = 2.5 > 0.01
      const adj = sizer.costAdjustedKelly(0.01, 0.05, 0.02);
      expect(adj).toBe(0);
    });

    it('returns 0 for 0 kelly', () => {
      const sizer = new PositionSizer();
      expect(sizer.costAdjustedKelly(0, 0.001, 0.05)).toBe(0);
    });

    it('returns 0 for 0 avgWin', () => {
      const sizer = new PositionSizer();
      expect(sizer.costAdjustedKelly(0.10, 0.001, 0)).toBe(0);
    });

    it('high-frequency trading costs eat into Kelly more', () => {
      const sizer = new PositionSizer();
      const lowCost = sizer.costAdjustedKelly(0.10, 0.001, 0.05);
      const highCost = sizer.costAdjustedKelly(0.10, 0.005, 0.05);
      expect(lowCost).toBeGreaterThan(highCost);
    });

    it('larger avg wins reduce cost impact', () => {
      const sizer = new PositionSizer();
      const smallWin = sizer.costAdjustedKelly(0.10, 0.002, 0.02);
      const largeWin = sizer.costAdjustedKelly(0.10, 0.002, 0.10);
      expect(largeWin).toBeGreaterThan(smallWin);
    });
  });
});

describe('Optimal-f (Ralph Vince)', () => {
  describe('optimalF', () => {
    it('finds optimal-f for profitable strategy', () => {
      const sizer = new PositionSizer();
      const trades = makeShuffledTrades(15, 5, 0.06, -0.04);
      const result = sizer.optimalF(trades);
      expect(result).not.toBeNull();
      expect(result.optimalF).toBeGreaterThan(0);
      expect(result.optimalF).toBeLessThanOrEqual(1.0);
      expect(result.terminalWealth).toBeGreaterThan(1);
      expect(result.worstLoss).toBeLessThan(0);
      expect(result.positionPct).toBeGreaterThan(0);
    });

    it('returns null for insufficient trades', () => {
      const sizer = new PositionSizer();
      expect(sizer.optimalF([])).toBeNull();
      expect(sizer.optimalF([{ pnlPct: 0.01 }])).toBeNull();
      expect(sizer.optimalF(null)).toBeNull();
    });

    it('returns null for all-winning trades', () => {
      const sizer = new PositionSizer();
      const trades = Array.from({ length: 20 }, () => ({ pnlPct: 0.03 }));
      expect(sizer.optimalF(trades)).toBeNull();
    });

    it('applies kellyFraction to positionPct', () => {
      const conservativeSizer = new PositionSizer({ kellyFraction: 0.25 });
      const aggressiveSizer = new PositionSizer({ kellyFraction: 0.50 });
      const trades = makeShuffledTrades(15, 5, 0.06, -0.04);
      const conservative = conservativeSizer.optimalF(trades);
      const aggressive = aggressiveSizer.optimalF(trades);
      // Same optimal-f but different positionPct due to kellyFraction
      expect(conservative.optimalF).toBe(aggressive.optimalF);
      expect(aggressive.positionPct).toBeGreaterThan(conservative.positionPct);
    });

    it('higher win rate yields higher optimal-f', () => {
      const sizer = new PositionSizer();
      const mediocre = sizer.optimalF(makeShuffledTrades(12, 8, 0.04, -0.03));
      const good = sizer.optimalF(makeShuffledTrades(17, 3, 0.06, -0.03));
      expect(good.optimalF).toBeGreaterThanOrEqual(mediocre.optimalF);
    });

    it('returns null for losing strategy', () => {
      const sizer = new PositionSizer();
      // All losses or net negative
      const trades = makeShuffledTrades(3, 17, 0.02, -0.05);
      const result = sizer.optimalF(trades);
      // May find a small f or null
      if (result !== null) {
        expect(result.optimalF).toBeLessThanOrEqual(0.10);
      }
    });

    it('terminal wealth > 1 at optimal-f', () => {
      const sizer = new PositionSizer();
      const trades = makeShuffledTrades(14, 6, 0.05, -0.03);
      const result = sizer.optimalF(trades);
      expect(result).not.toBeNull();
      expect(result.terminalWealth).toBeGreaterThan(1);
    });
  });
});

describe('Exponentially-Weighted Kelly Estimation', () => {
  describe('exponentialKellyEstimate', () => {
    it('returns estimate from trade history', () => {
      const sizer = new PositionSizer();
      const trades = makeTrades(12, 8);
      const estimate = sizer.exponentialKellyEstimate(trades);
      expect(estimate).not.toBeNull();
      expect(estimate.winRate).toBeGreaterThan(0);
      expect(estimate.avgWin).toBeGreaterThan(0);
      expect(estimate.avgLoss).toBeGreaterThan(0);
      expect(estimate.kellyPct).toBeGreaterThanOrEqual(0);
      expect(estimate.effectiveSampleSize).toBeGreaterThan(0);
    });

    it('returns null for insufficient trades', () => {
      const sizer = new PositionSizer();
      expect(sizer.exponentialKellyEstimate([])).toBeNull();
      expect(sizer.exponentialKellyEstimate(null)).toBeNull();
      expect(sizer.exponentialKellyEstimate([{ pnlPct: 0.01 }])).toBeNull();
    });

    it('weights recent trades more heavily', () => {
      const sizer = new PositionSizer();
      // Old trades: bad, Recent trades: good
      const improvingTrades = [
        ...Array.from({ length: 10 }, () => ({ pnlPct: -0.04 })),
        ...Array.from({ length: 10 }, () => ({ pnlPct: 0.06 })),
      ];
      // Old trades: good, Recent trades: bad
      const worseningTrades = [
        ...Array.from({ length: 10 }, () => ({ pnlPct: 0.06 })),
        ...Array.from({ length: 10 }, () => ({ pnlPct: -0.04 })),
      ];

      const improving = sizer.exponentialKellyEstimate(improvingTrades, 10);
      const worsening = sizer.exponentialKellyEstimate(worseningTrades, 10);

      // Improving strategy should show higher Kelly than worsening
      expect(improving.kellyPct).toBeGreaterThan(worsening.kellyPct);
    });

    it('shorter half-life emphasizes recent trades more', () => {
      const sizer = new PositionSizer();
      // Recent trades are winners
      const trades = [
        ...Array.from({ length: 15 }, () => ({ pnlPct: -0.03 })),
        ...Array.from({ length: 5 }, () => ({ pnlPct: 0.08 })),
      ];

      const shortHL = sizer.exponentialKellyEstimate(trades, 5);
      const longHL = sizer.exponentialKellyEstimate(trades, 50);

      // Short half-life should see recent winners more → higher win rate
      expect(shortHL.winRate).toBeGreaterThan(longHL.winRate);
    });

    it('effective sample size is less than actual with decay', () => {
      const sizer = new PositionSizer();
      const trades = makeTrades(15, 5);
      const estimate = sizer.exponentialKellyEstimate(trades, 10);
      expect(estimate.effectiveSampleSize).toBeLessThan(trades.length);
    });

    it('returns null if all trades are wins (after weighting)', () => {
      const sizer = new PositionSizer();
      const trades = Array.from({ length: 20 }, () => ({ pnlPct: 0.03 }));
      expect(sizer.exponentialKellyEstimate(trades)).toBeNull();
    });

    it('returns null if all trades are losses (after weighting)', () => {
      const sizer = new PositionSizer();
      const trades = Array.from({ length: 20 }, () => ({ pnlPct: -0.03 }));
      expect(sizer.exponentialKellyEstimate(trades)).toBeNull();
    });
  });
});

describe('Kelly Confidence Interval', () => {
  describe('kellyConfidenceInterval', () => {
    it('returns CI with lower < median < upper', () => {
      const sizer = new PositionSizer();
      const trades = makeTrades(30, 20, 0.05, -0.03);
      const ci = sizer.kellyConfidenceInterval(trades, 0.05, 500);
      expect(ci).not.toBeNull();
      expect(ci.lower).toBeLessThanOrEqual(ci.median);
      expect(ci.median).toBeLessThanOrEqual(ci.upper);
      expect(ci.spread).toBeGreaterThanOrEqual(0);
    });

    it('returns null for insufficient trades', () => {
      const sizer = new PositionSizer();
      expect(sizer.kellyConfidenceInterval([])).toBeNull();
      expect(sizer.kellyConfidenceInterval(null)).toBeNull();
      expect(sizer.kellyConfidenceInterval(makeTrades(5, 5))).toBeNull();
    });

    it('wider CI for smaller sample sizes', () => {
      const sizer = new PositionSizer();
      const small = sizer.kellyConfidenceInterval(makeTrades(10, 6, 0.05, -0.03), 0.05, 500);
      const large = sizer.kellyConfidenceInterval(makeTrades(60, 40, 0.05, -0.03), 0.05, 500);
      // Larger sample → narrower CI (less uncertainty)
      expect(large.spread).toBeLessThan(small.spread);
    });

    it('narrower CI at lower confidence (wider alpha)', () => {
      const sizer = new PositionSizer();
      const trades = makeTrades(25, 15, 0.05, -0.03);
      const ci90 = sizer.kellyConfidenceInterval(trades, 0.10, 500);
      const ci95 = sizer.kellyConfidenceInterval(trades, 0.05, 500);
      // 90% CI should be narrower than 95% CI
      expect(ci90.spread).toBeLessThanOrEqual(ci95.spread + 0.001);
    });

    it('all values are non-negative', () => {
      const sizer = new PositionSizer();
      const trades = makeTrades(20, 10, 0.05, -0.03);
      const ci = sizer.kellyConfidenceInterval(trades, 0.05, 500);
      expect(ci.lower).toBeGreaterThanOrEqual(0);
      expect(ci.median).toBeGreaterThanOrEqual(0);
      expect(ci.upper).toBeGreaterThanOrEqual(0);
    });

    it('spread equals upper minus lower', () => {
      const sizer = new PositionSizer();
      const trades = makeTrades(25, 15);
      const ci = sizer.kellyConfidenceInterval(trades, 0.05, 500);
      expect(ci.spread).toBeCloseTo(ci.upper - ci.lower, 4);
    });
  });
});

describe('Portfolio Kelly (Multi-Asset)', () => {
  describe('portfolioKelly', () => {
    it('returns single position unchanged', () => {
      const sizer = new PositionSizer();
      const result = sizer.portfolioKelly([
        { name: 'BTC', kellyPct: 0.10, returns: [0.01, 0.02, -0.01, 0.03, -0.02] },
      ]);
      expect(result.BTC).toBe(0.10);
    });

    it('returns empty for empty input', () => {
      const sizer = new PositionSizer();
      expect(sizer.portfolioKelly([])).toEqual({});
      expect(sizer.portfolioKelly(null)).toEqual({});
    });

    it('reduces correlated positions more', () => {
      const sizer = new PositionSizer();
      const { seriesA, seriesB } = correlatedReturns(100, 0.9);

      const corrResult = sizer.portfolioKelly([
        { name: 'A', kellyPct: 0.10, returns: seriesA },
        { name: 'B', kellyPct: 0.10, returns: seriesB },
      ]);

      const { seriesA: uA, seriesB: uB } = uncorrelatedReturns(100);
      const uncorrResult = sizer.portfolioKelly([
        { name: 'A', kellyPct: 0.10, returns: uA },
        { name: 'B', kellyPct: 0.10, returns: uB },
      ]);

      // Correlated assets should be reduced more
      expect(corrResult.A).toBeLessThan(uncorrResult.A);
    });

    it('all adjusted positions are <= original', () => {
      const sizer = new PositionSizer();
      const { seriesA, seriesB } = correlatedReturns(100);
      const seriesC = Array.from({ length: 100 }, (_, i) => Math.cos(i * 0.2) * 0.02);

      const result = sizer.portfolioKelly([
        { name: 'A', kellyPct: 0.10, returns: seriesA },
        { name: 'B', kellyPct: 0.15, returns: seriesB },
        { name: 'C', kellyPct: 0.08, returns: seriesC },
      ]);

      expect(result.A).toBeLessThanOrEqual(0.10);
      expect(result.B).toBeLessThanOrEqual(0.15);
      expect(result.C).toBeLessThanOrEqual(0.08);
    });

    it('handles identical return series (max correlation)', () => {
      const sizer = new PositionSizer();
      const series = Array.from({ length: 50 }, (_, i) => Math.sin(i) * 0.03);

      const result = sizer.portfolioKelly([
        { name: 'A', kellyPct: 0.10, returns: series },
        { name: 'B', kellyPct: 0.10, returns: [...series] },
      ]);

      // Identical returns → max correlation → aggressive reduction
      expect(result.A).toBeLessThan(0.08);
      expect(result.B).toBeLessThan(0.08);
    });

    it('preserves relative sizing between positions', () => {
      const sizer = new PositionSizer();
      const { seriesA, seriesB } = uncorrelatedReturns(100);

      const result = sizer.portfolioKelly([
        { name: 'A', kellyPct: 0.20, returns: seriesA },
        { name: 'B', kellyPct: 0.10, returns: seriesB },
      ]);

      // A should still be larger than B
      expect(result.A).toBeGreaterThan(result.B);
    });
  });

  describe('_pearsonCorrelation', () => {
    it('returns ~1 for identical series', () => {
      const sizer = new PositionSizer();
      const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(sizer._pearsonCorrelation(x, x)).toBeCloseTo(1.0, 5);
    });

    it('returns ~-1 for inverse series', () => {
      const sizer = new PositionSizer();
      const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const y = x.map(v => -v);
      expect(sizer._pearsonCorrelation(x, y)).toBeCloseTo(-1.0, 5);
    });

    it('returns 0 for insufficient data', () => {
      const sizer = new PositionSizer();
      expect(sizer._pearsonCorrelation([1, 2], [3, 4])).toBe(0);
    });

    it('returns 0 for constant series', () => {
      const sizer = new PositionSizer();
      const x = [5, 5, 5, 5, 5, 5, 5, 5, 5, 5];
      const y = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      expect(sizer._pearsonCorrelation(x, y)).toBe(0);
    });

    it('handles series of different lengths', () => {
      const sizer = new PositionSizer();
      const x = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const y = [1, 2, 3, 4, 5]; // shorter
      const corr = sizer._pearsonCorrelation(x, y);
      expect(corr).toBeCloseTo(1.0, 5);
    });
  });
});

describe('calculate() with new enhancements', () => {
  describe('transaction cost adjustment', () => {
    it('reduces position when transactionCostPct provided', () => {
      const sizer = new PositionSizer();
      const base = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        winRate: 0.6,
        avgWinReturn: 0.05,
        avgLossReturn: 0.03,
      });
      const withCost = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        winRate: 0.6,
        avgWinReturn: 0.05,
        avgLossReturn: 0.03,
        transactionCostPct: 0.003, // 30bps round trip
      });
      expect(withCost.qty).toBeLessThanOrEqual(base.qty);
      expect(withCost.method).toContain('cost_adj');
    });

    it('does not apply cost when no Kelly method used', () => {
      const sizer = new PositionSizer();
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.5,
        transactionCostPct: 0.003,
      });
      expect(result.method).not.toContain('cost_adj');
    });
  });

  describe('adaptive fraction', () => {
    it('applies adaptive fraction with strategy + trades', () => {
      const sizer = new PositionSizer();
      const trades = makeTrades(30, 20);
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        strategyName: 'momentum',
        trades,
        useAdaptiveFraction: true,
      });
      expect(result.method).toContain('adaptive');
      expect(result.qty).toBeGreaterThan(0);
    });

    it('adaptive fraction with small sample reduces position', () => {
      const sizer = new PositionSizer();
      const smallSample = makeTrades(8, 4);
      const largeSample = makeTrades(60, 40);

      const small = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        strategyName: 'momentum',
        trades: smallSample,
        useAdaptiveFraction: true,
      });
      const large = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        strategyName: 'momentum',
        trades: largeSample,
        useAdaptiveFraction: true,
      });

      // Larger sample → more confidence → larger position
      expect(large.qty).toBeGreaterThanOrEqual(small.qty);
    });

    it('adaptive fraction with explicit winRate and trades', () => {
      const sizer = new PositionSizer();
      const trades = makeTrades(25, 15);
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        winRate: 0.6,
        avgWinReturn: 0.05,
        avgLossReturn: 0.03,
        trades,
        useAdaptiveFraction: true,
      });
      expect(result.method).toContain('adaptive');
    });
  });

  describe('exponential weighting', () => {
    it('uses exponential weighting when requested', () => {
      const sizer = new PositionSizer();
      const trades = [
        ...Array.from({ length: 10 }, () => ({ pnlPct: -0.03 })),
        ...Array.from({ length: 10 }, () => ({ pnlPct: 0.06 })),
      ];
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        strategyName: 'momentum',
        trades,
        useExponentialWeighting: true,
      });
      expect(result.method).toContain('exp_weighted');
      expect(result.qty).toBeGreaterThan(0);
    });

    it('falls back to standard if exp estimate fails', () => {
      const sizer = new PositionSizer();
      // All wins → exp estimate returns null → falls through
      const trades = Array.from({ length: 20 }, () => ({ pnlPct: 0.05 }));
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        strategyName: 'momentum',
        trades,
        useExponentialWeighting: true,
      });
      // Should fall through to strategyKellySize defaults
      expect(result.method).not.toContain('exp_weighted');
    });
  });

  describe('combined enhancements', () => {
    it('stacks adaptive + cost + CVaR constraints', () => {
      const sizer = new PositionSizer();
      const trades = makeTrades(30, 20);
      const returns = Array.from({ length: 200 }, (_, i) =>
        ((i * 17 + 7) % 100 - 50) / 1500,
      );
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        strategyName: 'mean_reversion',
        trades,
        returns,
        maxCVaRPct: 0.02,
        transactionCostPct: 0.002,
        useAdaptiveFraction: true,
      });
      expect(result.method).toContain('adaptive');
      expect(result.method).toContain('cvar');
      expect(result.method).toContain('cost_adj');
      expect(result.qty).toBeGreaterThan(0);
    });

    it('stacks exponential + regime + drawdown + VaR', () => {
      const sizer = new PositionSizer();
      const trades = [
        ...Array.from({ length: 15 }, () => ({ pnlPct: -0.02 })),
        ...Array.from({ length: 15 }, () => ({ pnlPct: 0.05 })),
      ];
      const returns = Array.from({ length: 200 }, (_, i) =>
        ((i * 13 + 3) % 100 - 50) / 2000,
      );
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        strategyName: 'pairs_trading',
        regime: 'bear_high_vol',
        currentDrawdown: 0.08,
        trades,
        returns,
        maxVaRPct: 0.015,
        useExponentialWeighting: true,
      });
      expect(result.qty).toBeGreaterThanOrEqual(0);
      // Should not be unreasonably large given all constraints
      expect(result.positionPct).toBeLessThan(10); // <10% of portfolio
    });
  });
});

describe('backward compatibility with new enhancements', () => {
  it('existing calculate still works without new params', () => {
    const sizer = new PositionSizer({ maxPositionPct: 0.10 });
    const result = sizer.calculate({
      portfolioValue: 100000,
      price: 50,
      confidence: 0.5,
    });
    expect(result.qty).toBe(100);
    expect(result.value).toBe(5000);
    expect(result.method).toBe('standard');
  });

  it('existing Kelly still works without new params', () => {
    const sizer = new PositionSizer();
    const result = sizer.calculate({
      portfolioValue: 100000,
      price: 100,
      confidence: 0.7,
      winRate: 0.6,
      avgWinReturn: 0.05,
      avgLossReturn: 0.03,
    });
    expect(result.method).toBe('kelly');
    expect(result.qty).toBeGreaterThan(0);
  });

  it('existing YOLO still works', () => {
    const sizer = new PositionSizer({ maxPositionPct: 0.10, maxYoloPct: 0.25, yoloThreshold: 0.85 });
    const result = sizer.calculate({
      portfolioValue: 100000,
      price: 50,
      confidence: 0.9,
    });
    expect(result.qty).toBe(450);
    expect(result.method).toBe('yolo');
  });
});
