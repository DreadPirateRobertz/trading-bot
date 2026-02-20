import { describe, it, expect } from 'vitest';
import { PositionSizer } from '../src/signals/position-sizer.js';

describe('PositionSizer', () => {
  describe('calculateVolatility', () => {
    it('returns 0 for insufficient data', () => {
      const sizer = new PositionSizer();
      expect(sizer.calculateVolatility([100])).toBe(0);
    });

    it('returns 0 for constant prices', () => {
      const sizer = new PositionSizer();
      const closes = Array.from({ length: 20 }, () => 100);
      expect(sizer.calculateVolatility(closes)).toBe(0);
    });

    it('returns positive value for varying prices', () => {
      const sizer = new PositionSizer();
      const closes = [100, 102, 98, 105, 97, 103, 99, 101, 104, 96];
      const vol = sizer.calculateVolatility(closes);
      expect(vol).toBeGreaterThan(0);
    });
  });

  describe('calculateATR', () => {
    it('returns null for insufficient data', () => {
      const sizer = new PositionSizer();
      const candles = Array.from({ length: 5 }, () => ({
        high: 105, low: 95, close: 100,
      }));
      expect(sizer.calculateATR(candles)).toBeNull();
    });

    it('computes ATR for valid candle data', () => {
      const sizer = new PositionSizer();
      const candles = Array.from({ length: 20 }, (_, i) => ({
        high: 100 + Math.random() * 5,
        low: 95 + Math.random() * 5,
        close: 97 + Math.random() * 6,
      }));
      const atr = sizer.calculateATR(candles);
      expect(atr).toBeGreaterThan(0);
    });
  });

  describe('kellySize', () => {
    it('returns 0 when avgLoss is 0', () => {
      const sizer = new PositionSizer();
      expect(sizer.kellySize(0.6, 0.05, 0)).toBe(0);
    });

    it('returns positive fraction for profitable strategy', () => {
      const sizer = new PositionSizer();
      // 60% win rate, avg win 5%, avg loss 3%
      const kelly = sizer.kellySize(0.6, 0.05, 0.03);
      expect(kelly).toBeGreaterThan(0);
      expect(kelly).toBeLessThanOrEqual(0.25); // clamped to maxYoloPct
    });

    it('returns 0 for losing strategy', () => {
      const sizer = new PositionSizer();
      // 30% win rate, avg win 2%, avg loss 5%
      const kelly = sizer.kellySize(0.3, 0.02, 0.05);
      expect(kelly).toBe(0);
    });
  });

  describe('calculate', () => {
    it('returns zero for invalid inputs', () => {
      const sizer = new PositionSizer();
      const result = sizer.calculate({
        portfolioValue: 0, price: 100, confidence: 0.5,
      });
      expect(result.qty).toBe(0);
      expect(result.method).toBe('none');
    });

    it('sizes based on confidence with standard method', () => {
      const sizer = new PositionSizer({ maxPositionPct: 0.10 });
      const result = sizer.calculate({
        portfolioValue: 100000, price: 50, confidence: 0.5,
      });
      // maxPos = 10000, scaled = 10000 * 0.5 = 5000, qty = 100
      expect(result.qty).toBe(100);
      expect(result.value).toBe(5000);
      expect(result.method).toBe('standard');
    });

    it('uses YOLO sizing for high confidence', () => {
      const sizer = new PositionSizer({ maxPositionPct: 0.10, maxYoloPct: 0.25, yoloThreshold: 0.85 });
      const result = sizer.calculate({
        portfolioValue: 100000, price: 50, confidence: 0.9,
      });
      // YOLO: maxPos = 25000, scaled = 25000 * 0.9 = 22500, qty = 450
      expect(result.qty).toBe(450);
      expect(result.method).toBe('yolo');
    });

    it('uses Kelly sizing when historical stats provided', () => {
      const sizer = new PositionSizer();
      const result = sizer.calculate({
        portfolioValue: 100000, price: 100, confidence: 0.7,
        winRate: 0.6, avgWinReturn: 0.05, avgLossReturn: 0.03,
      });
      expect(result.method).toBe('kelly');
      expect(result.qty).toBeGreaterThan(0);
    });

    it('reduces size for high volatility', () => {
      const sizer = new PositionSizer({ maxPositionPct: 0.10 });
      const normal = sizer.calculate({
        portfolioValue: 100000, price: 100, confidence: 0.5,
      });
      const volatile = sizer.calculate({
        portfolioValue: 100000, price: 100, confidence: 0.5,
        volatility: 0.08,
      });
      expect(volatile.qty).toBeLessThan(normal.qty);
    });

    it('skips positions below minimum value', () => {
      const sizer = new PositionSizer({ minPositionValue: 1000 });
      const result = sizer.calculate({
        portfolioValue: 1000, price: 100, confidence: 0.05,
      });
      expect(result.qty).toBe(0);
      expect(result.method).toBe('skip');
    });

    it('handles expensive assets with fractional quantities', () => {
      const sizer = new PositionSizer({ maxPositionPct: 0.05 });
      const result = sizer.calculate({
        portfolioValue: 10000, price: 60000, confidence: 0.5,
      });
      // 10000 * 0.05 * 0.5 = 250, qty = 250/60000 ≈ 0.00416
      expect(result.qty).toBeGreaterThan(0);
      expect(result.qty).toBeLessThan(1);
    });
  });
});
