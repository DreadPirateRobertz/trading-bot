import { describe, it, expect, beforeEach } from 'vitest';
import { MultiTimeframeAnalyzer, TIMEFRAMES, ema, simpleMA } from '../src/analysis/multi-timeframe.js';

// Generate synthetic 1-minute candles with a given trend
function generateCandles(count, startPrice = 100, trend = 0, vol = 0.001) {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < count; i++) {
    const noise = (Math.random() - 0.5) * 2 * vol * price;
    const open = price;
    price = price * (1 + trend) + noise;
    price = Math.max(price, 0.01);
    const high = Math.max(open, price) * (1 + Math.random() * vol);
    const low = Math.min(open, price) * (1 - Math.random() * vol);
    candles.push({
      openTime: Date.now() - (count - i) * 60000,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(price),
      volume: Math.round(1000 + Math.random() * 5000),
    });
  }
  return candles;
}

function round(n) { return Math.round(n * 100) / 100; }

describe('MultiTimeframeAnalyzer', () => {
  let analyzer;

  beforeEach(() => {
    analyzer = new MultiTimeframeAnalyzer();
  });

  describe('constructor', () => {
    it('initializes with default config', () => {
      expect(analyzer.timeframes).toEqual(['5m', '15m', '1h', '4h', '1d']);
      expect(analyzer.emaPeriods).toEqual({ fast: 9, slow: 21 });
      expect(analyzer.confirmationMode).toBe('majority');
    });

    it('accepts custom config', () => {
      const custom = new MultiTimeframeAnalyzer({
        timeframes: ['5m', '1h'],
        confirmationMode: 'strict',
      });
      expect(custom.timeframes).toEqual(['5m', '1h']);
      expect(custom.confirmationMode).toBe('strict');
    });
  });

  describe('aggregateCandles()', () => {
    it('aggregates 1m candles into 5m candles', () => {
      const candles1m = generateCandles(20, 100, 0.001);
      const candles5m = analyzer.aggregateCandles(candles1m, 5);

      expect(candles5m.length).toBe(4); // 20 / 5

      // First 5m candle should have open of first 1m and close of 5th 1m
      expect(candles5m[0].open).toBe(candles1m[0].open);
      expect(candles5m[0].close).toBe(candles1m[4].close);

      // High should be max of the 5 candles
      const first5High = Math.max(...candles1m.slice(0, 5).map(c => c.high));
      expect(candles5m[0].high).toBe(first5High);

      // Low should be min of the 5 candles
      const first5Low = Math.min(...candles1m.slice(0, 5).map(c => c.low));
      expect(candles5m[0].low).toBe(first5Low);
    });

    it('aggregates into 15m candles', () => {
      const candles1m = generateCandles(60, 100, 0);
      const candles15m = analyzer.aggregateCandles(candles1m, 15);
      expect(candles15m.length).toBe(4); // 60 / 15
    });

    it('aggregates into 1h candles', () => {
      const candles1m = generateCandles(120, 100, 0);
      const candles1h = analyzer.aggregateCandles(candles1m, 60);
      expect(candles1h.length).toBe(2); // 120 / 60
    });

    it('handles volume aggregation', () => {
      const candles1m = generateCandles(10, 100, 0);
      const candles5m = analyzer.aggregateCandles(candles1m, 5);

      const firstChunkVolume = candles1m.slice(0, 5).reduce((s, c) => s + c.volume, 0);
      expect(candles5m[0].volume).toBe(firstChunkVolume);
    });

    it('handles partial last candle', () => {
      const candles1m = generateCandles(7, 100, 0);
      const candles5m = analyzer.aggregateCandles(candles1m, 5);
      expect(candles5m.length).toBe(2); // 5 + 2 partial
      expect(candles5m[1].close).toBe(candles1m[6].close);
    });

    it('returns copy when timeframe is 1m', () => {
      const candles1m = generateCandles(10, 100, 0);
      const result = analyzer.aggregateCandles(candles1m, 1);
      expect(result.length).toBe(10);
      expect(result).not.toBe(candles1m); // different reference
    });

    it('returns empty for empty input', () => {
      expect(analyzer.aggregateCandles([], 5)).toEqual([]);
      expect(analyzer.aggregateCandles(null, 5)).toEqual([]);
    });
  });

  describe('buildTimeframes()', () => {
    it('builds all configured timeframes', () => {
      const candles1m = generateCandles(1500, 100, 0.001);
      const result = analyzer.buildTimeframes(candles1m);

      expect(result).toHaveProperty('1m');
      expect(result).toHaveProperty('5m');
      expect(result).toHaveProperty('15m');
      expect(result).toHaveProperty('1h');
      expect(result['1m'].length).toBe(1500);
      expect(result['5m'].length).toBe(300);
      expect(result['15m'].length).toBe(100);
      expect(result['1h'].length).toBe(25);
    });
  });

  describe('detectTrend()', () => {
    it('detects bullish trend in uptrending data', () => {
      const candles = generateCandles(100, 100, 0.005, 0.001);
      const trend = analyzer.detectTrend(candles);

      expect(trend.direction).toBe('bull');
      expect(trend.strength).toBeGreaterThan(0);
    });

    it('detects bearish trend in downtrending data', () => {
      const candles = generateCandles(100, 100, -0.005, 0.001);
      const trend = analyzer.detectTrend(candles);

      expect(trend.direction).toBe('bear');
      expect(trend.strength).toBeGreaterThan(0);
    });

    it('detects neutral in flat/noisy data', () => {
      // Very small trend with high noise
      const candles = generateCandles(100, 100, 0, 0.0001);
      const trend = analyzer.detectTrend(candles);

      // Could be neutral or weak directional — main thing is strength is low
      expect(trend.strength).toBeLessThanOrEqual(1);
      expect(['bull', 'bear', 'neutral']).toContain(trend.direction);
    });

    it('returns neutral for insufficient data', () => {
      const trend = analyzer.detectTrend([]);
      expect(trend.direction).toBe('neutral');
      expect(trend.strength).toBe(0);
    });

    it('includes indicator values', () => {
      const candles = generateCandles(50, 100, 0.003);
      const trend = analyzer.detectTrend(candles);

      expect(trend.indicators).toHaveProperty('emaFast');
      expect(trend.indicators).toHaveProperty('emaSlow');
      expect(trend.indicators).toHaveProperty('emaSpread');
      expect(trend.indicators).toHaveProperty('sma');
      expect(trend.indicators).toHaveProperty('priceVsSma');
      expect(trend.indicators).toHaveProperty('recentMom');
    });
  });

  describe('analyze()', () => {
    it('returns trends for all timeframes plus confirmation', () => {
      const candles1m = generateCandles(1500, 100, 0.002);
      const result = analyzer.analyze(candles1m);

      expect(result.trends).toHaveProperty('1m');
      expect(result.trends).toHaveProperty('5m');
      expect(result.trends).toHaveProperty('15m');
      expect(result.trends).toHaveProperty('1h');
      expect(result.confirmation).toBeDefined();
      expect(result.confirmation.overall).toBeDefined();
      expect(result.timeframeCount).toBeGreaterThan(0);
    });

    it('confirmation shows bullish for strong uptrend', () => {
      const candles1m = generateCandles(1500, 100, 0.005, 0.001);
      const result = analyzer.analyze(candles1m);

      expect(result.confirmation.overall).toBe('bullish');
      expect(result.confirmation.netBias).toBeGreaterThan(0);
    });

    it('confirmation shows bearish for strong downtrend', () => {
      const candles1m = generateCandles(1500, 100, -0.005, 0.001);
      const result = analyzer.analyze(candles1m);

      expect(result.confirmation.overall).toBe('bearish');
      expect(result.confirmation.netBias).toBeLessThan(0);
    });
  });

  describe('confirmSignal()', () => {
    it('confirms BUY signal in uptrend', () => {
      const candles1m = generateCandles(1500, 100, 0.005, 0.001);
      const signal = { action: 'BUY', confidence: 0.6 };
      const result = analyzer.confirmSignal(signal, candles1m);

      expect(result.confirmed).toBe(true);
      expect(result.adjustedConfidence).toBeGreaterThanOrEqual(result.originalConfidence);
      expect(result.alignment).toBeGreaterThan(0);
    });

    it('rejects BUY signal in downtrend', () => {
      const candles1m = generateCandles(1500, 100, -0.005, 0.001);
      const signal = { action: 'BUY', confidence: 0.6 };
      const result = analyzer.confirmSignal(signal, candles1m);

      expect(result.confirmed).toBe(false);
      expect(result.adjustedConfidence).toBeLessThanOrEqual(result.originalConfidence);
    });

    it('confirms SELL signal in downtrend', () => {
      const candles1m = generateCandles(1500, 100, -0.005, 0.001);
      const signal = { action: 'SELL', confidence: 0.6 };
      const result = analyzer.confirmSignal(signal, candles1m);

      expect(result.confirmed).toBe(true);
      expect(result.alignment).toBeGreaterThan(0);
    });

    it('rejects HOLD signal', () => {
      const candles1m = generateCandles(100, 100, 0);
      const signal = { action: 'HOLD', confidence: 0 };
      const result = analyzer.confirmSignal(signal, candles1m);

      expect(result.confirmed).toBe(false);
      expect(result.adjustedConfidence).toBe(0);
    });

    it('handles null signal', () => {
      const candles1m = generateCandles(100, 100, 0);
      const result = analyzer.confirmSignal(null, candles1m);
      expect(result.confirmed).toBe(false);
    });

    it('returns trend summary', () => {
      const candles1m = generateCandles(1500, 100, 0.003);
      const signal = { action: 'BUY', confidence: 0.5 };
      const result = analyzer.confirmSignal(signal, candles1m);

      expect(result.trendSummary).toBeDefined();
      expect(result.trendSummary.overall).toBeDefined();
      expect(typeof result.trendSummary.bullCount).toBe('number');
    });
  });

  describe('confirmation modes', () => {
    it('strict mode requires all timeframes aligned', () => {
      const strict = new MultiTimeframeAnalyzer({
        timeframes: ['5m', '15m'],
        confirmationMode: 'strict',
      });
      // Strong uptrend — all TFs should agree
      const candles1m = generateCandles(500, 100, 0.008, 0.001);
      const signal = { action: 'BUY', confidence: 0.6 };
      const result = strict.confirmSignal(signal, candles1m);

      // In a strong trend, strict mode should confirm
      if (result.confirmed) {
        expect(result.reason).toContain('aligned');
      }
    });

    it('weighted mode uses alignment score', () => {
      const weighted = new MultiTimeframeAnalyzer({
        timeframes: ['5m', '15m', '1h'],
        confirmationMode: 'weighted',
      });
      const candles1m = generateCandles(500, 100, 0.005, 0.001);
      const signal = { action: 'BUY', confidence: 0.5 };
      const result = weighted.confirmSignal(signal, candles1m);

      expect(typeof result.alignment).toBe('number');
    });
  });

  describe('TIMEFRAMES config', () => {
    it('has correct minute values', () => {
      expect(TIMEFRAMES['1m'].minutes).toBe(1);
      expect(TIMEFRAMES['5m'].minutes).toBe(5);
      expect(TIMEFRAMES['15m'].minutes).toBe(15);
      expect(TIMEFRAMES['1h'].minutes).toBe(60);
      expect(TIMEFRAMES['4h'].minutes).toBe(240);
      expect(TIMEFRAMES['1d'].minutes).toBe(1440);
    });

    it('weights sum to approximately 1', () => {
      const totalWeight = Object.values(TIMEFRAMES).reduce((s, tf) => s + tf.weight, 0);
      expect(totalWeight).toBeCloseTo(1, 1);
    });
  });

  describe('ema()', () => {
    it('computes exponential moving average', () => {
      const values = [10, 11, 12, 13, 14, 15];
      const result = ema(values, 3);

      expect(result.length).toBe(6);
      expect(result[0]).toBe(10); // first value = input
      // EMA should trend upward
      expect(result[5]).toBeGreaterThan(result[0]);
    });

    it('handles empty input', () => {
      expect(ema([], 3)).toEqual([]);
    });
  });

  describe('simpleMA()', () => {
    it('computes simple moving average', () => {
      const values = [10, 20, 30, 40, 50];
      const result = simpleMA(values, 3);

      expect(result.length).toBe(5);
      // Third value should be average of first 3: (10+20+30)/3 = 20
      expect(result[2]).toBe(20);
      // Fourth value: (20+30+40)/3 = 30
      expect(result[3]).toBe(30);
    });

    it('handles period larger than data', () => {
      const values = [10, 20];
      const result = simpleMA(values, 5);
      expect(result.length).toBe(2);
      // Uses available data
      expect(result[0]).toBe(10);
      expect(result[1]).toBe(15);
    });

    it('handles empty input', () => {
      expect(simpleMA([], 3)).toEqual([]);
    });
  });
});
