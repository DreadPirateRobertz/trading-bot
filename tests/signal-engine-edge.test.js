import { describe, it, expect } from 'vitest';
import { SignalEngine, generateSignalWithPrice } from '../src/signals/engine.js';
import { computeRSI, computeMACD, computeBollingerBands, detectVolumeSpike } from '../src/signals/index.js';

// Helpers
function makePrices(length, start = 100, trend = 0, noise = 2) {
  return Array.from({ length }, (_, i) => start + trend * i + (Math.sin(i) * noise));
}

function makeVolumes(length, base = 1000) {
  return Array.from({ length }, () => base + Math.floor(Math.random() * 200));
}

describe('SignalEngine edge cases', () => {
  describe('analyze() boundary conditions', () => {
    it('returns error when closes is undefined', () => {
      const engine = new SignalEngine();
      const result = engine.analyze('BTC', {});
      expect(result.error).toBe('No price data');
    });

    it('returns error when closes is null', () => {
      const engine = new SignalEngine();
      const result = engine.analyze('BTC', { closes: null });
      expect(result.error).toBe('No price data');
    });

    it('handles single price point (too few for indicators)', () => {
      const engine = new SignalEngine();
      const result = engine.analyze('BTC', { closes: [100] });
      // Should not error - RSI/MACD/Bollinger return null for insufficient data
      expect(result.symbol).toBe('BTC');
      expect(result.price).toBe(100);
      expect(result.signal).toBeDefined();
      expect(result.indicators.rsi).toBeNull();
      expect(result.indicators.macd).toBeNull();
      expect(result.indicators.bollinger).toBeNull();
    });

    it('uses currentPrice when provided, ignoring last close', () => {
      const engine = new SignalEngine();
      const closes = makePrices(40, 100);
      const result = engine.analyze('ETH', { closes, currentPrice: 999 });
      expect(result.price).toBe(999);
    });

    it('defaults to last close when currentPrice is undefined', () => {
      const engine = new SignalEngine();
      const closes = makePrices(40, 100);
      const result = engine.analyze('ETH', { closes });
      expect(result.price).toBeCloseTo(closes[closes.length - 1]);
    });

    it('handles no volumes (volumeSpike should be false)', () => {
      const engine = new SignalEngine();
      const closes = makePrices(40);
      const result = engine.analyze('AAPL', { closes });
      expect(result.indicators.volumeSpike).toBe(false);
    });

    it('produces a timestamp on every analysis', () => {
      const engine = new SignalEngine();
      const closes = makePrices(40);
      const result = engine.analyze('AAPL', { closes });
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it('handles exactly the minimum data for RSI (period + 1 points)', () => {
      const engine = new SignalEngine({ rsiPeriod: 14 });
      const closes = makePrices(15); // exactly 14+1
      const result = engine.analyze('TEST', { closes });
      expect(result.indicators.rsi).not.toBeNull();
      expect(typeof result.indicators.rsi).toBe('number');
    });

    it('returns null RSI when data is one short of minimum', () => {
      const closes = makePrices(14); // needs 15 for period=14
      const rsi = computeRSI(closes, 14);
      expect(rsi).toBeNull();
    });

    it('returns null MACD when data is less than slow period', () => {
      const closes = makePrices(25); // slow=26 requires 26
      const macd = computeMACD(closes);
      expect(macd).toBeNull();
    });

    it('returns null Bollinger when data is less than period', () => {
      const closes = makePrices(19); // period=20 requires 20
      const bollinger = computeBollingerBands(closes);
      expect(bollinger).toBeNull();
    });
  });

  describe('extreme value handling', () => {
    it('handles zero prices without crashing', () => {
      const engine = new SignalEngine();
      const closes = Array.from({ length: 40 }, () => 0);
      const result = engine.analyze('ZERO', { closes });
      expect(result.symbol).toBe('ZERO');
      expect(result.signal).toBeDefined();
    });

    it('handles very large prices', () => {
      const engine = new SignalEngine();
      const closes = makePrices(40, 1e12, 1e9);
      const result = engine.analyze('HUGE', { closes });
      expect(result.signal).toBeDefined();
      expect(result.signal.action).toMatch(/^(BUY|SELL|HOLD)$/);
    });

    it('handles negative prices (data corruption scenario)', () => {
      const engine = new SignalEngine();
      const closes = makePrices(40, -100, -1);
      const result = engine.analyze('NEG', { closes });
      expect(result.symbol).toBe('NEG');
      // Should not throw, may produce unusual indicators
      expect(result.signal).toBeDefined();
    });

    it('handles flat prices (all identical)', () => {
      const engine = new SignalEngine();
      const closes = Array.from({ length: 40 }, () => 50);
      const result = engine.analyze('FLAT', { closes, volumes: makeVolumes(40) });
      // RSI should be exactly 100 (all gains=0, no losses → special case)
      // or could be 50 if no movement. Let's just verify no crash
      expect(result.signal).toBeDefined();
      expect(result.indicators.rsi).toBeDefined();
    });

    it('RSI returns 100 when price only goes up', () => {
      // Monotonically increasing prices → no losses → RSI = 100
      const closes = Array.from({ length: 40 }, (_, i) => 100 + i);
      const rsi = computeRSI(closes, 14);
      expect(rsi).toBe(100);
    });

    it('RSI is low when price only goes down', () => {
      // Monotonically decreasing → no gains → RSI ≈ 0
      const closes = Array.from({ length: 40 }, (_, i) => 200 - i);
      const rsi = computeRSI(closes, 14);
      expect(rsi).toBeLessThan(5);
    });
  });

  describe('volume spike detection edge cases', () => {
    it('returns false when volumes has exactly 20 entries (needs 21)', () => {
      const volumes = makeVolumes(20);
      expect(detectVolumeSpike(volumes)).toBe(false);
    });

    it('detects spike when last volume is far above average', () => {
      const volumes = Array.from({ length: 21 }, () => 100);
      volumes.push(1000); // 10x the average
      expect(detectVolumeSpike(volumes.slice(-22), { threshold: 2 })).toBe(true);
    });

    it('no spike when volume is at average', () => {
      const volumes = Array.from({ length: 22 }, () => 100);
      expect(detectVolumeSpike(volumes, { threshold: 2 })).toBe(false);
    });

    it('handles zero-volume history', () => {
      const volumes = Array.from({ length: 22 }, () => 0);
      // 0/0 = NaN, last > NaN is false
      expect(detectVolumeSpike(volumes)).toBe(false);
    });
  });

  describe('analyzeMultiple() edge cases', () => {
    it('returns empty array for empty input', () => {
      const engine = new SignalEngine();
      expect(engine.analyzeMultiple([])).toEqual([]);
    });

    it('handles mixed valid and invalid assets', () => {
      const engine = new SignalEngine();
      const assets = [
        { symbol: 'GOOD', closes: makePrices(40), volumes: makeVolumes(40) },
        { symbol: 'BAD', closes: [] },
        { symbol: 'ALSO_GOOD', closes: makePrices(40) },
      ];
      const results = engine.analyzeMultiple(assets);
      expect(results).toHaveLength(3);
      expect(results[0].signal).toBeDefined();
      expect(results[1].error).toBe('No price data');
      expect(results[2].signal).toBeDefined();
    });
  });

  describe('rank() edge cases', () => {
    it('filters out errored analyses', () => {
      const engine = new SignalEngine();
      const analyses = [
        { error: 'No price data', symbol: 'BAD' },
        { signal: { action: 'BUY', confidence: 0.7 } },
      ];
      const ranked = engine.rank(analyses);
      expect(ranked).toHaveLength(1);
      expect(ranked[0].signal.action).toBe('BUY');
    });

    it('returns empty for all-error analyses', () => {
      const engine = new SignalEngine();
      const analyses = [
        { error: 'No price data' },
        { error: 'No price data' },
      ];
      expect(engine.rank(analyses)).toEqual([]);
    });

    it('ranks SELL above HOLD', () => {
      const engine = new SignalEngine();
      const analyses = [
        { signal: { action: 'HOLD', confidence: 0.9 } },
        { signal: { action: 'SELL', confidence: 0.3 } },
      ];
      const ranked = engine.rank(analyses);
      expect(ranked[0].signal.action).toBe('SELL');
    });

    it('ranks by confidence within same actionability tier', () => {
      const engine = new SignalEngine();
      const analyses = [
        { signal: { action: 'BUY', confidence: 0.3 } },
        { signal: { action: 'SELL', confidence: 0.9 } },
        { signal: { action: 'BUY', confidence: 0.8 } },
      ];
      const ranked = engine.rank(analyses);
      expect(ranked[0].signal.confidence).toBe(0.9);
      expect(ranked[1].signal.confidence).toBe(0.8);
      expect(ranked[2].signal.confidence).toBe(0.3);
    });
  });

  describe('generateSignalWithPrice edge cases', () => {
    it('volume spike amplifies bullish score', () => {
      const base = generateSignalWithPrice({
        rsi: 25, macd: null, bollinger: null,
        volumeSpike: false, sentiment: null, price: 100,
      });
      const amplified = generateSignalWithPrice({
        rsi: 25, macd: null, bollinger: null,
        volumeSpike: true, sentiment: null, price: 100,
      });
      expect(amplified.score).toBeGreaterThan(base.score);
    });

    it('volume spike amplifies bearish score', () => {
      const base = generateSignalWithPrice({
        rsi: 75, macd: null, bollinger: null,
        volumeSpike: false, sentiment: null, price: 100,
      });
      const amplified = generateSignalWithPrice({
        rsi: 75, macd: null, bollinger: null,
        volumeSpike: true, sentiment: null, price: 100,
      });
      expect(amplified.score).toBeLessThan(base.score);
    });

    it('volume spike does not amplify neutral score', () => {
      const result = generateSignalWithPrice({
        rsi: 50, macd: null, bollinger: null,
        volumeSpike: true, sentiment: null, price: 100,
      });
      // RSI 50 = no signal, volume spike on neutral = no amplification
      expect(result.score).toBe(0);
    });

    it('confidence is clamped to 1.0 even with all signals maxed', () => {
      const result = generateSignalWithPrice({
        rsi: 10,
        macd: { macd: 5, signal: 1, histogram: 4 },
        bollinger: { upper: 200, middle: 150, lower: 100, bandwidth: 0.5 },
        volumeSpike: true,
        sentiment: { classification: 'very_bullish' },
        price: 50,
      });
      expect(result.confidence).toBeLessThanOrEqual(1);
    });

    it('Bollinger range of zero does not cause division by zero', () => {
      const result = generateSignalWithPrice({
        rsi: null, macd: null,
        bollinger: { upper: 100, middle: 100, lower: 100, bandwidth: 0 },
        volumeSpike: false, sentiment: null, price: 100,
      });
      // range = 0, the position calculation should be skipped
      expect(result.action).toBe('HOLD');
    });

    it('handles all bearish signals combined', () => {
      const result = generateSignalWithPrice({
        rsi: 85,
        macd: { macd: -2, signal: 1, histogram: -3 },
        bollinger: { upper: 100, middle: 90, lower: 80, bandwidth: 0.2 },
        volumeSpike: true,
        sentiment: { classification: 'very_bearish' },
        price: 110,
      });
      expect(result.action).toBe('SELL');
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.reasons.length).toBeGreaterThanOrEqual(4);
    });

    it('RSI boundary value 30 is not oversold (> not >=)', () => {
      // rsi < 30 triggers oversold. rsi=30 is in the 30-40 range? Let's verify.
      // Looking at code: rsi < 30 → oversold, else if rsi < 40 → low
      const result = generateSignalWithPrice({
        rsi: 30, macd: null, bollinger: null,
        volumeSpike: false, sentiment: null, price: 100,
      });
      const hasOversold = result.reasons.some(r => r.includes('oversold'));
      const hasLow = result.reasons.some(r => r.includes('low'));
      expect(hasOversold).toBe(false);
      expect(hasLow).toBe(true);
    });

    it('RSI boundary value 70 is not overbought (< not <=)', () => {
      // rsi > 70 → overbought. rsi=70 is in the 60-70 range
      const result = generateSignalWithPrice({
        rsi: 70, macd: null, bollinger: null,
        volumeSpike: false, sentiment: null, price: 100,
      });
      const hasOverbought = result.reasons.some(r => r.includes('overbought'));
      const hasHigh = result.reasons.some(r => r.includes('high'));
      expect(hasOverbought).toBe(false);
      expect(hasHigh).toBe(true);
    });

    it('unknown sentiment classification produces no sentiment score', () => {
      const result = generateSignalWithPrice({
        rsi: null, macd: null, bollinger: null,
        volumeSpike: false,
        sentiment: { classification: 'confused', score: 0 },
        price: 100,
      });
      expect(result.score).toBe(0);
      expect(result.reasons).toHaveLength(0);
    });
  });
});
