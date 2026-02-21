import { describe, it, expect } from 'vitest';
import { PositionSizer } from '../src/signals/position-sizer.js';

// Helper: generate returns with known distribution properties
function normalReturns(n = 200, mean = 0, stdDev = 0.02) {
  // Box-Muller transform for approximate normal distribution
  const returns = [];
  for (let i = 0; i < n; i += 2) {
    const u1 = Math.random();
    const u2 = Math.random();
    const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    const z1 = Math.sqrt(-2 * Math.log(u1)) * Math.sin(2 * Math.PI * u2);
    returns.push(mean + z0 * stdDev);
    if (i + 1 < n) returns.push(mean + z1 * stdDev);
  }
  return returns.slice(0, n);
}

// Helper: generate fat-tailed returns (mixture of normals)
function fatTailedReturns(n = 200) {
  const returns = [];
  for (let i = 0; i < n; i++) {
    if (Math.random() < 0.95) {
      returns.push((Math.random() - 0.5) * 0.04);     // Normal regime
    } else {
      returns.push((Math.random() - 0.5) * 0.20);     // Crisis regime
    }
  }
  return returns;
}

describe('Value at Risk (VaR)', () => {
  describe('calculateVaR', () => {
    it('returns positive VaR for typical returns', () => {
      const sizer = new PositionSizer();
      const returns = normalReturns(200, 0.001, 0.02);
      const var95 = sizer.calculateVaR(returns, 0.95);
      expect(var95).toBeGreaterThan(0);
    });

    it('VaR(99%) > VaR(95%) for same data', () => {
      const sizer = new PositionSizer();
      const returns = normalReturns(200, 0, 0.03);
      const var95 = sizer.calculateVaR(returns, 0.95);
      const var99 = sizer.calculateVaR(returns, 0.99);
      expect(var99).toBeGreaterThan(var95);
    });

    it('higher volatility produces higher VaR', () => {
      const sizer = new PositionSizer();
      const lowVol = normalReturns(200, 0, 0.01);
      const highVol = normalReturns(200, 0, 0.05);
      const varLow = sizer.calculateVaR(lowVol, 0.95);
      const varHigh = sizer.calculateVaR(highVol, 0.95);
      expect(varHigh).toBeGreaterThan(varLow);
    });

    it('returns null for insufficient data', () => {
      const sizer = new PositionSizer();
      expect(sizer.calculateVaR([0.01, 0.02], 0.95)).toBeNull();
      expect(sizer.calculateVaR(null, 0.95)).toBeNull();
    });

    it('uses default 95% confidence', () => {
      const sizer = new PositionSizer();
      const returns = normalReturns(200);
      const var95 = sizer.calculateVaR(returns);
      expect(var95).toBeDefined();
      expect(var95).toBeGreaterThan(0);
    });
  });

  describe('calculateHistoricalVaR', () => {
    it('returns positive value for typical returns', () => {
      const sizer = new PositionSizer();
      const returns = normalReturns(200, 0, 0.02);
      const hvar = sizer.calculateHistoricalVaR(returns, 0.95);
      expect(hvar).toBeGreaterThan(0);
    });

    it('captures actual worst-case returns', () => {
      const sizer = new PositionSizer();
      // Several bad returns mixed in — historical VaR at 95% should catch the 5th percentile
      const returns = Array.from({ length: 100 }, () => 0.01);
      // Put 6 bad returns in so 95% VaR lands on one of them
      for (let i = 0; i < 6; i++) returns[i] = -0.08;
      const hvar = sizer.calculateHistoricalVaR(returns, 0.95);
      expect(hvar).toBeGreaterThanOrEqual(0.07);
    });

    it('returns null for insufficient data', () => {
      const sizer = new PositionSizer();
      expect(sizer.calculateHistoricalVaR([0.01])).toBeNull();
    });
  });
});

describe('Conditional VaR (CVaR / Expected Shortfall)', () => {
  describe('calculateCVaR', () => {
    it('CVaR >= VaR (always worse than VaR)', () => {
      const sizer = new PositionSizer();
      const returns = normalReturns(200, 0, 0.03);
      const var95 = sizer.calculateHistoricalVaR(returns, 0.95);
      const cvar95 = sizer.calculateCVaR(returns, 0.95);
      expect(cvar95).toBeGreaterThanOrEqual(var95 * 0.99); // small tolerance for rounding
    });

    it('captures tail risk beyond VaR', () => {
      const sizer = new PositionSizer();
      const returns = fatTailedReturns(500);
      const cvar95 = sizer.calculateCVaR(returns, 0.95);
      expect(cvar95).toBeGreaterThan(0);
    });

    it('CVaR(99%) > CVaR(95%)', () => {
      const sizer = new PositionSizer();
      const returns = fatTailedReturns(500);
      const cvar95 = sizer.calculateCVaR(returns, 0.95);
      const cvar99 = sizer.calculateCVaR(returns, 0.99);
      expect(cvar99).toBeGreaterThanOrEqual(cvar95);
    });

    it('returns null for insufficient data', () => {
      const sizer = new PositionSizer();
      expect(sizer.calculateCVaR([0.01], 0.95)).toBeNull();
    });
  });
});

describe('VaR-constrained Kelly', () => {
  it('caps position when VaR exceeds limit', () => {
    const sizer = new PositionSizer();
    const returns = normalReturns(200, 0, 0.05); // High vol
    const unconstrained = 0.20; // 20% Kelly
    const constrained = sizer.varConstrainedKelly(unconstrained, returns, 0.02);
    expect(constrained).toBeLessThanOrEqual(unconstrained);
    expect(constrained).toBeGreaterThan(0);
  });

  it('does not reduce position when VaR is within limit', () => {
    const sizer = new PositionSizer();
    const returns = normalReturns(200, 0, 0.005); // Very low vol
    const kelly = 0.05; // 5% position
    const constrained = sizer.varConstrainedKelly(kelly, returns, 0.10); // Very generous limit
    expect(constrained).toBeCloseTo(kelly, 2);
  });

  it('returns 0 for 0 kelly', () => {
    const sizer = new PositionSizer();
    const returns = normalReturns(200);
    expect(sizer.varConstrainedKelly(0, returns, 0.02)).toBe(0);
  });

  it('returns unconstrained for insufficient data', () => {
    const sizer = new PositionSizer();
    expect(sizer.varConstrainedKelly(0.10, [0.01], 0.02)).toBe(0.10);
  });
});

describe('CVaR-constrained Kelly', () => {
  it('caps position when CVaR exceeds limit', () => {
    const sizer = new PositionSizer();
    const returns = fatTailedReturns(500); // Fat-tailed
    const unconstrained = 0.20;
    const constrained = sizer.cvarConstrainedKelly(unconstrained, returns, 0.02);
    expect(constrained).toBeLessThanOrEqual(unconstrained);
    expect(constrained).toBeGreaterThan(0);
  });

  it('CVaR constraint is tighter than VaR constraint', () => {
    const sizer = new PositionSizer();
    const returns = fatTailedReturns(500);
    const kelly = 0.20;
    // Same limit for both — CVaR should produce tighter constraint
    const varConstrained = sizer.varConstrainedKelly(kelly, returns, 0.02);
    const cvarConstrained = sizer.cvarConstrainedKelly(kelly, returns, 0.02);
    // CVaR is always >= VaR, so cvarConstrained should be <= varConstrained
    expect(cvarConstrained).toBeLessThanOrEqual(varConstrained + 0.001); // small tolerance
  });

  it('returns 0 for 0 kelly', () => {
    const sizer = new PositionSizer();
    const returns = normalReturns(200);
    expect(sizer.cvarConstrainedKelly(0, returns, 0.03)).toBe(0);
  });

  it('returns unconstrained for insufficient data', () => {
    const sizer = new PositionSizer();
    expect(sizer.cvarConstrainedKelly(0.10, [0.01], 0.03)).toBe(0.10);
  });
});

describe('calculate with VaR/CVaR constraints', () => {
  it('applies VaR constraint when maxVaRPct provided', () => {
    const sizer = new PositionSizer();
    const returns = normalReturns(200, 0, 0.05);
    const result = sizer.calculate({
      portfolioValue: 100000,
      price: 100,
      confidence: 0.7,
      winRate: 0.6,
      avgWinReturn: 0.05,
      avgLossReturn: 0.03,
      returns,
      maxVaRPct: 0.01,
    });
    expect(result.method).toContain('var');
    expect(result.qty).toBeGreaterThan(0);
  });

  it('applies CVaR constraint when maxCVaRPct provided', () => {
    const sizer = new PositionSizer();
    const returns = fatTailedReturns(500);
    const result = sizer.calculate({
      portfolioValue: 100000,
      price: 100,
      confidence: 0.7,
      winRate: 0.6,
      avgWinReturn: 0.05,
      avgLossReturn: 0.03,
      returns,
      maxCVaRPct: 0.02,
    });
    expect(result.method).toContain('cvar');
    expect(result.qty).toBeGreaterThan(0);
  });

  it('CVaR takes precedence over VaR when both provided', () => {
    const sizer = new PositionSizer();
    const returns = normalReturns(200, 0, 0.03);
    const result = sizer.calculate({
      portfolioValue: 100000,
      price: 100,
      confidence: 0.7,
      winRate: 0.6,
      avgWinReturn: 0.05,
      avgLossReturn: 0.03,
      returns,
      maxVaRPct: 0.02,
      maxCVaRPct: 0.02,
    });
    expect(result.method).toContain('cvar');
    expect(result.method).not.toContain('+var');
  });

  it('VaR-constrained position is smaller than unconstrained', () => {
    const sizer = new PositionSizer();
    const returns = normalReturns(200, 0, 0.06); // High vol
    const unconstrained = sizer.calculate({
      portfolioValue: 100000,
      price: 100,
      confidence: 0.7,
      winRate: 0.6,
      avgWinReturn: 0.05,
      avgLossReturn: 0.03,
    });
    const constrained = sizer.calculate({
      portfolioValue: 100000,
      price: 100,
      confidence: 0.7,
      winRate: 0.6,
      avgWinReturn: 0.05,
      avgLossReturn: 0.03,
      returns,
      maxVaRPct: 0.005, // Very tight
    });
    expect(constrained.qty).toBeLessThanOrEqual(unconstrained.qty);
  });

  it('combines regime + drawdown + CVaR constraints', () => {
    const sizer = new PositionSizer();
    const returns = fatTailedReturns(500);
    const result = sizer.calculate({
      portfolioValue: 100000,
      price: 100,
      confidence: 0.7,
      winRate: 0.6,
      avgWinReturn: 0.05,
      avgLossReturn: 0.03,
      regime: 'bear_high_vol',
      currentDrawdown: 0.10,
      returns,
      maxCVaRPct: 0.02,
    });
    expect(result.method).toContain('kelly+regime');
    expect(result.method).toContain('dd_adjusted');
    expect(result.method).toContain('cvar');
    expect(result.qty).toBeGreaterThan(0);
  });

  it('no constraint applied without returns data', () => {
    const sizer = new PositionSizer();
    const result = sizer.calculate({
      portfolioValue: 100000,
      price: 100,
      confidence: 0.7,
      winRate: 0.6,
      avgWinReturn: 0.05,
      avgLossReturn: 0.03,
      maxVaRPct: 0.02,
    });
    expect(result.method).not.toContain('var');
    expect(result.method).not.toContain('cvar');
  });
});
