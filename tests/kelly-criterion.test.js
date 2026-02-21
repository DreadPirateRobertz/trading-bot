import { describe, it, expect } from 'vitest';
import { PositionSizer } from '../src/signals/position-sizer.js';

describe('Enhanced Kelly Criterion', () => {
  describe('regimeAdjustedKelly', () => {
    it('returns larger size in bull regime', () => {
      const sizer = new PositionSizer();
      const bull = sizer.regimeAdjustedKelly(0.6, 0.05, 0.03, 'bull_low_vol');
      const bear = sizer.regimeAdjustedKelly(0.6, 0.05, 0.03, 'bear_high_vol');
      expect(bull).toBeGreaterThan(bear);
      expect(bull).toBeGreaterThan(0);
      expect(bear).toBeGreaterThan(0);
    });

    it('uses conservative sizing in bear regime', () => {
      const sizer = new PositionSizer();
      const bear = sizer.regimeAdjustedKelly(0.6, 0.05, 0.03, 'bear_high_vol');
      const standard = sizer.kellySize(0.6, 0.05, 0.03);
      // Bear uses 0.25x, standard uses 0.33x
      expect(bear).toBeLessThan(standard);
    });

    it('uses moderate sizing in range_bound regime', () => {
      const sizer = new PositionSizer();
      const range = sizer.regimeAdjustedKelly(0.6, 0.05, 0.03, 'range_bound');
      const bull = sizer.regimeAdjustedKelly(0.6, 0.05, 0.03, 'bull_low_vol');
      const bear = sizer.regimeAdjustedKelly(0.6, 0.05, 0.03, 'bear_high_vol');
      expect(range).toBeGreaterThan(bear);
      expect(range).toBeLessThan(bull);
    });

    it('uses minimum sizing for uncertain regime', () => {
      const sizer = new PositionSizer();
      const uncertain = sizer.regimeAdjustedKelly(0.6, 0.05, 0.03, 'uncertain');
      const bear = sizer.regimeAdjustedKelly(0.6, 0.05, 0.03, 'bear_high_vol');
      expect(uncertain).toBeLessThan(bear);
    });

    it('falls back to default fraction for unknown regime', () => {
      const sizer = new PositionSizer({ kellyFraction: 0.33 });
      const unknown = sizer.regimeAdjustedKelly(0.6, 0.05, 0.03, 'some_new_regime');
      const standard = sizer.kellySize(0.6, 0.05, 0.03);
      expect(unknown).toBeCloseTo(standard, 6);
    });

    it('returns 0 for losing strategy', () => {
      const sizer = new PositionSizer();
      expect(sizer.regimeAdjustedKelly(0.3, 0.02, 0.05, 'bull_low_vol')).toBe(0);
    });

    it('returns 0 when avgLoss is 0', () => {
      const sizer = new PositionSizer();
      expect(sizer.regimeAdjustedKelly(0.6, 0.05, 0, 'bull_low_vol')).toBe(0);
    });

    it('returns 0 when avgWin is 0', () => {
      const sizer = new PositionSizer();
      expect(sizer.regimeAdjustedKelly(0.6, 0, 0.03, 'bull_low_vol')).toBe(0);
    });

    it('clamps to maxYoloPct', () => {
      const sizer = new PositionSizer({ maxYoloPct: 0.15 });
      // Very profitable strategy in aggressive regime
      const result = sizer.regimeAdjustedKelly(0.9, 0.20, 0.01, 'bull_low_vol');
      expect(result).toBeLessThanOrEqual(0.15);
    });
  });

  describe('drawdownAdjustedKelly', () => {
    it('returns full size at 0% drawdown', () => {
      const sizer = new PositionSizer();
      expect(sizer.drawdownAdjustedKelly(0.10, 0)).toBe(0.10);
    });

    it('reduces size during drawdown', () => {
      const sizer = new PositionSizer({ drawdownThreshold: 0.15, maxDrawdownScale: 0.50 });
      const adjusted = sizer.drawdownAdjustedKelly(0.10, 0.10);
      expect(adjusted).toBeLessThan(0.10);
      expect(adjusted).toBeGreaterThan(0);
    });

    it('reaches minimum scale at threshold drawdown', () => {
      const sizer = new PositionSizer({ drawdownThreshold: 0.15, maxDrawdownScale: 0.50 });
      const adjusted = sizer.drawdownAdjustedKelly(0.10, 0.15);
      expect(adjusted).toBeCloseTo(0.10 * 0.50, 6);
    });

    it('clamps at threshold for extreme drawdowns', () => {
      const sizer = new PositionSizer({ drawdownThreshold: 0.15, maxDrawdownScale: 0.50 });
      const atThreshold = sizer.drawdownAdjustedKelly(0.10, 0.15);
      const extreme = sizer.drawdownAdjustedKelly(0.10, 0.30);
      expect(extreme).toBeCloseTo(atThreshold, 6);
    });

    it('handles negative drawdown (profit)', () => {
      const sizer = new PositionSizer();
      expect(sizer.drawdownAdjustedKelly(0.10, -0.05)).toBe(0.10);
    });

    it('handles 0 kellyPct', () => {
      const sizer = new PositionSizer();
      expect(sizer.drawdownAdjustedKelly(0, 0.10)).toBe(0);
    });
  });

  describe('rollingKellyEstimate', () => {
    it('estimates from trade history', () => {
      const sizer = new PositionSizer();
      const trades = [
        // 60% win rate, ~5% avg win, ~3% avg loss
        ...Array.from({ length: 12 }, () => ({ pnlPct: 0.05 })),
        ...Array.from({ length: 8 }, () => ({ pnlPct: -0.03 })),
      ];
      const estimate = sizer.rollingKellyEstimate(trades);
      expect(estimate).not.toBeNull();
      expect(estimate.winRate).toBeCloseTo(0.60, 2);
      expect(estimate.avgWin).toBeCloseTo(0.05, 4);
      expect(estimate.avgLoss).toBeCloseTo(0.03, 4);
      expect(estimate.kellyPct).toBeGreaterThan(0);
      expect(estimate.sampleSize).toBe(20);
    });

    it('returns null for insufficient trades', () => {
      const sizer = new PositionSizer();
      expect(sizer.rollingKellyEstimate([])).toBeNull();
      expect(sizer.rollingKellyEstimate([{ pnlPct: 0.01 }])).toBeNull();
      expect(sizer.rollingKellyEstimate(null)).toBeNull();
    });

    it('uses rolling window', () => {
      const sizer = new PositionSizer();
      // Old trades: bad strategy
      const oldTrades = Array.from({ length: 30 }, () => ({ pnlPct: -0.05 }));
      // Recent trades: good strategy
      const recentTrades = [
        ...Array.from({ length: 15 }, () => ({ pnlPct: 0.06 })),
        ...Array.from({ length: 5 }, () => ({ pnlPct: -0.02 })),
      ];
      const allTrades = [...oldTrades, ...recentTrades];

      const fullEstimate = sizer.rollingKellyEstimate(allTrades, 20);
      expect(fullEstimate).not.toBeNull();
      expect(fullEstimate.winRate).toBeCloseTo(0.75, 2);
      expect(fullEstimate.sampleSize).toBe(20);
    });

    it('returns null if all trades are wins', () => {
      const sizer = new PositionSizer();
      const trades = Array.from({ length: 20 }, () => ({ pnlPct: 0.05 }));
      expect(sizer.rollingKellyEstimate(trades)).toBeNull();
    });

    it('returns null if all trades are losses', () => {
      const sizer = new PositionSizer();
      const trades = Array.from({ length: 20 }, () => ({ pnlPct: -0.03 }));
      expect(sizer.rollingKellyEstimate(trades)).toBeNull();
    });
  });

  describe('riskParityWeights', () => {
    it('allocates more capital to lower-vol strategies', () => {
      const sizer = new PositionSizer();
      const weights = sizer.riskParityWeights({
        mean_reversion: 0.15,
        momentum: 0.30,
        pairs_trading: 0.17,
      });
      expect(weights.mean_reversion).toBeGreaterThan(weights.momentum);
      expect(weights.pairs_trading).toBeGreaterThan(weights.momentum);
    });

    it('weights sum to approximately 1', () => {
      const sizer = new PositionSizer();
      const weights = sizer.riskParityWeights({
        strategy_a: 0.10,
        strategy_b: 0.20,
        strategy_c: 0.15,
        strategy_d: 0.25,
      });
      const sum = Object.values(weights).reduce((a, b) => a + b, 0);
      expect(sum).toBeCloseTo(1.0, 2);
    });

    it('returns equal weights for equal volatilities', () => {
      const sizer = new PositionSizer();
      const weights = sizer.riskParityWeights({
        a: 0.10,
        b: 0.10,
        c: 0.10,
      });
      expect(weights.a).toBeCloseTo(0.3333, 2);
      expect(weights.b).toBeCloseTo(0.3333, 2);
      expect(weights.c).toBeCloseTo(0.3333, 2);
    });

    it('returns empty object for no strategies', () => {
      const sizer = new PositionSizer();
      expect(sizer.riskParityWeights({})).toEqual({});
    });

    it('filters out zero-vol strategies', () => {
      const sizer = new PositionSizer();
      const weights = sizer.riskParityWeights({
        active: 0.10,
        dormant: 0,
      });
      expect(weights.active).toBeCloseTo(1.0, 2);
      expect(weights.dormant).toBeUndefined();
    });
  });

  describe('strategyKellySize', () => {
    it('uses STRATEGY-V2 defaults for known strategies', () => {
      const sizer = new PositionSizer();
      const mrKelly = sizer.strategyKellySize('mean_reversion');
      const momKelly = sizer.strategyKellySize('momentum');
      const pairsKelly = sizer.strategyKellySize('pairs_trading');
      expect(mrKelly).toBeGreaterThan(0);
      expect(momKelly).toBeGreaterThan(0);
      expect(pairsKelly).toBeGreaterThan(0);
    });

    it('returns 0 for unknown strategy without trades', () => {
      const sizer = new PositionSizer();
      expect(sizer.strategyKellySize('unknown_strategy')).toBe(0);
    });

    it('prefers rolling estimate over defaults', () => {
      const sizer = new PositionSizer();
      const trades = [
        ...Array.from({ length: 15 }, () => ({ pnlPct: 0.08 })),
        ...Array.from({ length: 5 }, () => ({ pnlPct: -0.02 })),
      ];
      // With trades, should use rolling estimate
      const withTrades = sizer.strategyKellySize('mean_reversion', null, trades);
      const withoutTrades = sizer.strategyKellySize('mean_reversion');
      // Rolling estimate should differ from static defaults
      expect(withTrades).toBeGreaterThan(0);
      expect(withTrades).not.toBeCloseTo(withoutTrades, 3);
    });

    it('applies regime adjustment with trades', () => {
      const sizer = new PositionSizer();
      const trades = [
        ...Array.from({ length: 12 }, () => ({ pnlPct: 0.05 })),
        ...Array.from({ length: 8 }, () => ({ pnlPct: -0.03 })),
      ];
      const bull = sizer.strategyKellySize('momentum', 'bull_low_vol', trades);
      const bear = sizer.strategyKellySize('momentum', 'bear_high_vol', trades);
      expect(bull).toBeGreaterThan(bear);
    });

    it('applies regime adjustment with defaults (no trades)', () => {
      const sizer = new PositionSizer();
      const bull = sizer.strategyKellySize('pairs_trading', 'bull_low_vol');
      const bear = sizer.strategyKellySize('pairs_trading', 'bear_high_vol');
      expect(bull).toBeGreaterThan(bear);
    });
  });

  describe('calculate with enhanced Kelly', () => {
    it('uses strategy-aware Kelly when strategyName provided', () => {
      const sizer = new PositionSizer();
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        strategyName: 'mean_reversion',
      });
      expect(result.method).toBe('kelly+strategy');
      expect(result.qty).toBeGreaterThan(0);
    });

    it('uses regime-adjusted Kelly when regime provided', () => {
      const sizer = new PositionSizer();
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        strategyName: 'momentum',
        regime: 'bull_low_vol',
      });
      expect(result.method).toContain('kelly+regime');
      expect(result.qty).toBeGreaterThan(0);
    });

    it('applies drawdown adjustment', () => {
      const sizer = new PositionSizer();
      const normal = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        winRate: 0.6,
        avgWinReturn: 0.05,
        avgLossReturn: 0.03,
      });
      const inDrawdown = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        winRate: 0.6,
        avgWinReturn: 0.05,
        avgLossReturn: 0.03,
        currentDrawdown: 0.10,
      });
      expect(inDrawdown.qty).toBeLessThan(normal.qty);
      expect(inDrawdown.method).toContain('dd_adjusted');
    });

    it('regime-adjusted Kelly produces different sizes per regime', () => {
      const sizer = new PositionSizer();
      const bull = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        winRate: 0.6,
        avgWinReturn: 0.05,
        avgLossReturn: 0.03,
        regime: 'bull_low_vol',
      });
      const bear = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        winRate: 0.6,
        avgWinReturn: 0.05,
        avgLossReturn: 0.03,
        regime: 'bear_high_vol',
      });
      expect(bull.qty).toBeGreaterThan(bear.qty);
    });

    it('combines regime + drawdown + vol adjustment', () => {
      const sizer = new PositionSizer();
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        winRate: 0.6,
        avgWinReturn: 0.05,
        avgLossReturn: 0.03,
        regime: 'bear_high_vol',
        currentDrawdown: 0.10,
        volatility: 0.06,
      });
      expect(result.method).toContain('kelly+regime');
      expect(result.method).toContain('dd_adjusted');
      expect(result.method).toContain('vol_adjusted');
      expect(result.qty).toBeGreaterThan(0);
    });

    it('falls back to standard when strategyName is unknown and no winRate', () => {
      const sizer = new PositionSizer();
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.5,
        strategyName: 'unknown_strategy',
      });
      expect(result.method).toBe('standard');
    });

    it('prefers explicit winRate over strategyName', () => {
      const sizer = new PositionSizer();
      // If winRate is provided, strategyName should not be used
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 100,
        confidence: 0.7,
        winRate: 0.6,
        avgWinReturn: 0.05,
        avgLossReturn: 0.03,
        strategyName: 'mean_reversion',
      });
      // strategyName is only tried when winRate is not provided
      expect(result.method).toContain('kelly');
    });
  });

  describe('backward compatibility', () => {
    it('existing calculate API still works unchanged', () => {
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

    it('existing Kelly API still works', () => {
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

    it('existing YOLO sizing still works', () => {
      const sizer = new PositionSizer({ maxPositionPct: 0.10, maxYoloPct: 0.25, yoloThreshold: 0.85 });
      const result = sizer.calculate({
        portfolioValue: 100000,
        price: 50,
        confidence: 0.9,
      });
      expect(result.qty).toBe(450);
      expect(result.method).toBe('yolo');
    });

    it('existing kellySize method unchanged', () => {
      const sizer = new PositionSizer();
      expect(sizer.kellySize(0.6, 0.05, 0.03)).toBeGreaterThan(0);
      expect(sizer.kellySize(0.6, 0.05, 0)).toBe(0);
      expect(sizer.kellySize(0.3, 0.02, 0.05)).toBe(0);
    });
  });
});
