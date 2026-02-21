// Tests for OHLCV data pipeline with feature engineering
import { CandleStore } from '../src/data-pipeline/storage.js';
import { HistoricalFetcher } from '../src/data-pipeline/fetcher.js';
import {
  computeAllFeatures,
  rollingRSI,
  rollingMACD,
  rollingBollinger,
  rollingSMA,
  rollingEMA,
  rollingATR,
  rollingVolumeProfile,
  detectRSIDivergence,
} from '../src/data-pipeline/features.js';
import { DataPipeline } from '../src/data-pipeline/pipeline.js';

// --- Test Helpers ---

function makePrices(length, start = 100, trend = 0.1, noise = 2) {
  const prices = [];
  for (let i = 0; i < length; i++) {
    prices.push(start + trend * i + (Math.sin(i * 0.5) * noise));
  }
  return prices;
}

function makeCandles(length, { symbol = 'BTC/USD', startPrice = 40000, trend = 10, noise = 500, baseVolume = 1000 } = {}) {
  const candles = [];
  const startTs = Date.now() - length * 86400000;
  for (let i = 0; i < length; i++) {
    const base = startPrice + trend * i + Math.sin(i * 0.3) * noise;
    const spread = Math.abs(noise * 0.1);
    candles.push({
      symbol,
      timestamp: startTs + i * 86400000,
      open: base - spread,
      high: base + spread * 2,
      low: base - spread * 2,
      close: base + spread * (i % 2 === 0 ? 1 : -1),
      volume: baseVolume + Math.sin(i * 0.7) * baseVolume * 0.5,
    });
  }
  return candles;
}

function mockFetch(candles) {
  return async (url) => {
    const binanceData = candles.map(c => [
      c.timestamp,       // openTime
      String(c.open),    // open
      String(c.high),    // high
      String(c.low),     // low
      String(c.close),   // close
      String(c.volume),  // volume
      c.timestamp + 86400000, // closeTime
    ]);
    return {
      ok: true,
      json: async () => binanceData,
      text: async () => JSON.stringify(binanceData),
    };
  };
}

// ===================== STORAGE TESTS =====================

describe('CandleStore', () => {
  let store;
  beforeEach(() => { store = new CandleStore(); });
  afterEach(() => { store.close(); });

  test('creates table and inserts candles', () => {
    const candles = makeCandles(10);
    store.insertCandles(candles);
    expect(store.getRowCount('BTC/USD')).toBe(10);
  });

  test('retrieves candles ordered by timestamp', () => {
    const candles = makeCandles(5);
    store.insertCandles(candles);
    const result = store.getCandles('BTC/USD');
    expect(result).toHaveLength(5);
    for (let i = 1; i < result.length; i++) {
      expect(result[i].timestamp).toBeGreaterThan(result[i - 1].timestamp);
    }
  });

  test('upsert is idempotent (no duplicates)', () => {
    const candles = makeCandles(10);
    store.insertCandles(candles);
    store.insertCandles(candles); // re-insert same data
    expect(store.getRowCount('BTC/USD')).toBe(10);
  });

  test('upsert updates existing candle values', () => {
    const candles = makeCandles(3);
    store.insertCandles(candles);
    const modified = candles.map(c => ({ ...c, close: c.close + 100 }));
    store.insertCandles(modified);
    const result = store.getCandles('BTC/USD');
    expect(result[0].close).toBe(modified[0].close);
  });

  test('supports multiple symbols', () => {
    store.insertCandles(makeCandles(5, { symbol: 'BTC/USD' }));
    store.insertCandles(makeCandles(5, { symbol: 'ETH/USD' }));
    expect(store.getRowCount('BTC/USD')).toBe(5);
    expect(store.getRowCount('ETH/USD')).toBe(5);
    expect(store.getSymbols()).toEqual(['BTC/USD', 'ETH/USD']);
  });

  test('getLatestTimestamp returns max timestamp', () => {
    const candles = makeCandles(10);
    store.insertCandles(candles);
    const latest = store.getLatestTimestamp('BTC/USD');
    expect(latest).toBe(candles[candles.length - 1].timestamp);
  });

  test('getLatestTimestamp returns null for unknown symbol', () => {
    expect(store.getLatestTimestamp('DOGE/USD')).toBeNull();
  });

  test('filters by start and end timestamps', () => {
    const candles = makeCandles(100);
    store.insertCandles(candles);
    const mid = candles[50].timestamp;
    const result = store.getCandles('BTC/USD', { startTs: mid });
    expect(result.length).toBe(50);
    expect(result[0].timestamp).toBe(mid);
  });

  test('limits result count', () => {
    store.insertCandles(makeCandles(100));
    const result = store.getCandles('BTC/USD', { limit: 10 });
    expect(result).toHaveLength(10);
  });

  test('updates feature columns', () => {
    const candles = makeCandles(5);
    store.insertCandles(candles);
    const features = candles.map(c => ({
      symbol: c.symbol,
      timestamp: c.timestamp,
      rsi_14: 55.5,
      rsi_divergence: 0,
      macd_line: 1.2,
      macd_signal: 0.8,
      macd_histogram: 0.4,
      macd_momentum: 0.1,
      bb_upper: 42000,
      bb_middle: 40000,
      bb_lower: 38000,
      bb_bandwidth: 0.1,
      bb_squeeze: 0,
      volume_profile: 1.3,
      sma_20: 40000,
      sma_50: 39000,
      ema_12: 40100,
      ema_26: 39800,
      sentiment_velocity: 0.2,
      atr_14: 800,
      price_change_pct: 1.5,
    }));
    store.updateFeatures(features);
    const result = store.getCandles('BTC/USD');
    expect(result[0].rsi_14).toBe(55.5);
    expect(result[0].macd_histogram).toBe(0.4);
    expect(result[0].bb_squeeze).toBe(0);
    expect(result[0].volume_profile).toBe(1.3);
  });
});

// ===================== FEATURE ENGINEERING TESTS =====================

describe('Rolling RSI', () => {
  test('returns null for insufficient data', () => {
    const result = rollingRSI([1, 2, 3], 14);
    expect(result.every(v => v === null)).toBe(true);
  });

  test('computes RSI for valid data', () => {
    const closes = makePrices(100);
    const result = rollingRSI(closes, 14);
    expect(result[14]).not.toBeNull();
    expect(result[14]).toBeGreaterThan(0);
    expect(result[14]).toBeLessThan(100);
  });

  test('RSI is 100 when only gains', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const result = rollingRSI(closes, 14);
    expect(result[14]).toBe(100);
  });

  test('RSI approaches 0 when only losses', () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 - i);
    const result = rollingRSI(closes, 14);
    expect(result[14]).toBeLessThan(5);
  });

  test('computes for all rows after warmup', () => {
    const closes = makePrices(100);
    const result = rollingRSI(closes, 14);
    for (let i = 14; i < 100; i++) {
      expect(result[i]).not.toBeNull();
    }
    for (let i = 0; i < 14; i++) {
      expect(result[i]).toBeNull();
    }
  });
});

describe('RSI Divergence', () => {
  test('detects bullish divergence (lower price, higher RSI)', () => {
    // Construct prices that create a divergence pattern
    const n = 50;
    const closes = makePrices(n, 100, -0.5, 3);
    const rsi = rollingRSI(closes, 14);
    const div = detectRSIDivergence(closes, rsi, 14);
    // Should have some divergence signals (either 1 or -1)
    const hasSignals = div.some(v => v !== 0);
    expect(hasSignals).toBe(true);
  });

  test('returns array of same length as input', () => {
    const closes = makePrices(30);
    const rsi = rollingRSI(closes, 14);
    const div = detectRSIDivergence(closes, rsi, 14);
    expect(div).toHaveLength(30);
  });
});

describe('Rolling MACD', () => {
  test('returns null arrays for short data', () => {
    const { macdLine, macdSignal, macdHistogram } = rollingMACD([1, 2, 3]);
    expect(macdLine.every(v => v === null)).toBe(true);
    expect(macdSignal.every(v => v === null)).toBe(true);
    expect(macdHistogram.every(v => v === null)).toBe(true);
  });

  test('computes MACD for 50+ candles', () => {
    const closes = makePrices(60);
    const { macdLine, macdSignal, macdHistogram } = rollingMACD(closes);
    // MACD line available from index 25 (slow-1)
    expect(macdLine[25]).not.toBeNull();
    // Signal available from index 25+8=33
    expect(macdSignal[33]).not.toBeNull();
    expect(macdHistogram[33]).not.toBeNull();
  });

  test('histogram equals macdLine minus signal', () => {
    const closes = makePrices(60);
    const { macdLine, macdSignal, macdHistogram } = rollingMACD(closes);
    for (let i = 33; i < 60; i++) {
      if (macdHistogram[i] !== null) {
        expect(macdHistogram[i]).toBeCloseTo(macdLine[i] - macdSignal[i], 10);
      }
    }
  });
});

describe('Rolling Bollinger Bands', () => {
  test('returns nulls for short data', () => {
    const { upper, middle, lower, bandwidth } = rollingBollinger([1, 2, 3], 20);
    expect(upper.every(v => v === null)).toBe(true);
  });

  test('computes bands for sufficient data', () => {
    const closes = makePrices(30, 100, 0, 5);
    const { upper, middle, lower, bandwidth } = rollingBollinger(closes, 20);
    expect(upper[19]).not.toBeNull();
    expect(middle[19]).not.toBeNull();
    expect(lower[19]).not.toBeNull();
    expect(upper[19]).toBeGreaterThan(middle[19]);
    expect(lower[19]).toBeLessThan(middle[19]);
    expect(bandwidth[19]).toBeGreaterThan(0);
  });

  test('detects squeeze (low bandwidth)', () => {
    // Near-constant prices → very small bandwidth
    const closes = Array.from({ length: 30 }, () => 100 + Math.random() * 0.001);
    const { bandwidth } = rollingBollinger(closes, 20);
    expect(bandwidth[19]).toBeLessThan(0.01);
  });
});

describe('Rolling SMA', () => {
  test('computes simple moving average', () => {
    const values = [1, 2, 3, 4, 5];
    const result = rollingSMA(values, 3);
    expect(result[0]).toBeNull();
    expect(result[1]).toBeNull();
    expect(result[2]).toBe(2); // (1+2+3)/3
    expect(result[3]).toBe(3); // (2+3+4)/3
    expect(result[4]).toBe(4); // (3+4+5)/3
  });

  test('handles period longer than data', () => {
    const result = rollingSMA([1, 2, 3], 10);
    expect(result.every(v => v === null)).toBe(true);
  });
});

describe('Rolling EMA', () => {
  test('first value equals first input', () => {
    const result = rollingEMA([10, 20, 30], 3);
    expect(result[0]).toBe(10);
  });

  test('converges toward recent values', () => {
    const values = Array.from({ length: 50 }, (_, i) => i < 25 ? 100 : 200);
    const result = rollingEMA(values, 10);
    // After shift to 200, EMA should approach 200
    expect(result[49]).toBeGreaterThan(195);
  });

  test('returns empty for empty input', () => {
    expect(rollingEMA([], 5)).toEqual([]);
  });
});

describe('Rolling ATR', () => {
  test('computes ATR for sufficient data', () => {
    const candles = makeCandles(20);
    const highs = candles.map(c => c.high);
    const lows = candles.map(c => c.low);
    const closes = candles.map(c => c.close);
    const result = rollingATR(highs, lows, closes, 14);
    expect(result[13]).not.toBeNull();
    expect(result[13]).toBeGreaterThan(0);
  });

  test('returns nulls for insufficient data', () => {
    const result = rollingATR([100], [90], [95], 14);
    expect(result.every(v => v === null)).toBe(true);
  });
});

describe('Volume Profile', () => {
  test('computes relative volume', () => {
    const volumes = Array.from({ length: 25 }, () => 1000);
    volumes[24] = 2000; // last volume is 2x average
    const result = rollingVolumeProfile(volumes, 20);
    expect(result[24]).toBeCloseTo(2.0, 1);
  });

  test('returns null for short data', () => {
    const result = rollingVolumeProfile([100, 200], 20);
    expect(result.every(v => v === null)).toBe(true);
  });
});

describe('computeAllFeatures', () => {
  test('computes 19 features per candle row', () => {
    const candles = makeCandles(100);
    const features = computeAllFeatures(candles);
    expect(features).toHaveLength(100);

    // Check that all 19 feature keys exist
    const featureKeys = [
      'rsi_14', 'rsi_divergence', 'macd_line', 'macd_signal', 'macd_histogram',
      'macd_momentum', 'bb_upper', 'bb_middle', 'bb_lower', 'bb_bandwidth',
      'bb_squeeze', 'volume_profile', 'sma_20', 'sma_50', 'ema_12', 'ema_26',
      'sentiment_velocity', 'atr_14', 'price_change_pct',
    ];
    for (const key of featureKeys) {
      expect(features[50]).toHaveProperty(key);
    }
  });

  test('features have non-null values after warmup period', () => {
    const candles = makeCandles(100);
    const features = computeAllFeatures(candles);
    // After index 50 (max warmup: SMA50 needs 50 rows), all should be populated
    const row = features[60];
    expect(row.rsi_14).not.toBeNull();
    expect(row.macd_histogram).not.toBeNull();
    expect(row.bb_upper).not.toBeNull();
    expect(row.sma_20).not.toBeNull();
    expect(row.sma_50).not.toBeNull();
    expect(row.ema_12).not.toBeNull();
    expect(row.ema_26).not.toBeNull();
    expect(row.atr_14).not.toBeNull();
    expect(row.volume_profile).not.toBeNull();
    expect(row.price_change_pct).not.toBeNull();
  });

  test('preserves symbol and timestamp from input', () => {
    const candles = makeCandles(30, { symbol: 'ETH/USD' });
    const features = computeAllFeatures(candles);
    expect(features[0].symbol).toBe('ETH/USD');
    expect(features[0].timestamp).toBe(candles[0].timestamp);
  });

  test('bb_squeeze is 1 when bandwidth is low', () => {
    // Very low volatility prices → squeeze should trigger
    const candles = makeCandles(30, { noise: 0.001 });
    const features = computeAllFeatures(candles);
    const squeezes = features.filter(f => f.bb_squeeze === 1);
    expect(squeezes.length).toBeGreaterThan(0);
  });

  test('handles sentiment velocity', () => {
    const candles = makeCandles(30);
    const sentimentScores = Array.from({ length: 30 }, (_, i) => i * 0.1);
    const features = computeAllFeatures(candles, { sentimentScores });
    expect(features[1].sentiment_velocity).toBeCloseTo(0.1, 5);
  });

  test('returns empty array for empty input', () => {
    expect(computeAllFeatures([])).toEqual([]);
  });

  test('feature count meets 15+ requirement', () => {
    const candles = makeCandles(60);
    const features = computeAllFeatures(candles);
    const row = features[55];
    const nonNullFeatures = [
      'rsi_14', 'rsi_divergence', 'macd_line', 'macd_signal', 'macd_histogram',
      'macd_momentum', 'bb_upper', 'bb_middle', 'bb_lower', 'bb_bandwidth',
      'bb_squeeze', 'volume_profile', 'sma_20', 'sma_50', 'ema_12', 'ema_26',
      'atr_14', 'price_change_pct',
    ].filter(k => row[k] !== null);
    expect(nonNullFeatures.length).toBeGreaterThanOrEqual(15);
  });
});

// ===================== FETCHER TESTS =====================

describe('HistoricalFetcher', () => {
  test('fetches daily candles from mock Binance', async () => {
    const sourceCandles = makeCandles(30);
    const fetcher = new HistoricalFetcher({ fetchFn: mockFetch(sourceCandles) });
    const result = await fetcher.fetchDailyCandles('BTC/USD', { days: 30 });
    expect(result).toHaveLength(30);
    expect(result[0]).toHaveProperty('symbol', 'BTC/USD');
    expect(result[0]).toHaveProperty('open');
    expect(result[0]).toHaveProperty('high');
    expect(result[0]).toHaveProperty('low');
    expect(result[0]).toHaveProperty('close');
    expect(result[0]).toHaveProperty('volume');
    expect(result[0]).toHaveProperty('timestamp');
  });

  test('maps BTC/USD to BTCUSDT in URL', async () => {
    let capturedUrl = '';
    const fetcher = new HistoricalFetcher({
      fetchFn: async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => [] };
      },
    });
    await fetcher.fetchDailyCandles('BTC/USD');
    expect(capturedUrl).toContain('symbol=BTCUSDT');
  });

  test('maps ETH/USD to ETHUSDT in URL', async () => {
    let capturedUrl = '';
    const fetcher = new HistoricalFetcher({
      fetchFn: async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => [] };
      },
    });
    await fetcher.fetchDailyCandles('ETH/USD');
    expect(capturedUrl).toContain('symbol=ETHUSDT');
  });

  test('throws on non-ok response', async () => {
    const fetcher = new HistoricalFetcher({
      fetchFn: async () => ({ ok: false, status: 429, text: async () => 'rate limited' }),
    });
    await expect(fetcher.fetchDailyCandles('BTC/USD')).rejects.toThrow('429');
  });

  test('fetchMultipleSymbols returns per-symbol results', async () => {
    const candles = makeCandles(10);
    const fetcher = new HistoricalFetcher({ fetchFn: mockFetch(candles) });
    const results = await fetcher.fetchMultipleSymbols(['BTC/USD', 'ETH/USD']);
    expect(results['BTC/USD']).toHaveLength(10);
    expect(results['ETH/USD']).toHaveLength(10);
    expect(results['BTC/USD'][0].symbol).toBe('BTC/USD');
    expect(results['ETH/USD'][0].symbol).toBe('ETH/USD');
  });

  test('uses default 365 days', async () => {
    let capturedUrl = '';
    const fetcher = new HistoricalFetcher({
      fetchFn: async (url) => {
        capturedUrl = url;
        return { ok: true, json: async () => [] };
      },
    });
    await fetcher.fetchDailyCandles('BTC/USD');
    expect(capturedUrl).toContain('limit=365');
  });
});

// ===================== PIPELINE INTEGRATION TESTS =====================

describe('DataPipeline', () => {
  test('full pipeline: fetch → store → features', async () => {
    const candles = makeCandles(100);
    const pipeline = new DataPipeline({
      fetchFn: mockFetch(candles),
      symbols: ['BTC/USD'],
      days: 100,
    });

    const report = await pipeline.run();
    expect(report.fetched['BTC/USD']).toBe(100);
    expect(report.computed['BTC/USD']).toBe(100);
    expect(report.errors).toHaveLength(0);

    const stored = pipeline.getCandles('BTC/USD');
    expect(stored).toHaveLength(100);
    // Features should be populated
    expect(stored[60].rsi_14).not.toBeNull();
    expect(stored[60].macd_histogram).not.toBeNull();
    expect(stored[60].sma_20).not.toBeNull();

    pipeline.close();
  });

  test('pipeline is idempotent (re-run does not duplicate)', async () => {
    const candles = makeCandles(50);
    const pipeline = new DataPipeline({
      fetchFn: mockFetch(candles),
      symbols: ['BTC/USD'],
      days: 50,
    });

    await pipeline.run();
    await pipeline.run(); // second run
    expect(pipeline.getRowCount('BTC/USD')).toBe(50);

    pipeline.close();
  });

  test('pipeline handles multiple symbols', async () => {
    const candles = makeCandles(60);
    const pipeline = new DataPipeline({
      fetchFn: mockFetch(candles),
      symbols: ['BTC/USD', 'ETH/USD'],
      days: 60,
    });

    const report = await pipeline.run();
    expect(pipeline.getSymbols()).toEqual(['BTC/USD', 'ETH/USD']);
    expect(report.fetched['BTC/USD']).toBe(60);
    expect(report.fetched['ETH/USD']).toBe(60);

    pipeline.close();
  });

  test('pipeline reports fetch errors gracefully', async () => {
    const pipeline = new DataPipeline({
      fetchFn: async () => ({ ok: false, status: 500, text: async () => 'server error' }),
      symbols: ['BTC/USD'],
    });

    const report = await pipeline.run();
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].symbol).toBe('BTC/USD');
    expect(report.errors[0].error).toContain('500');

    pipeline.close();
  });

  test('pipeline passes sentiment scores to features', async () => {
    const candles = makeCandles(30);
    const pipeline = new DataPipeline({
      fetchFn: mockFetch(candles),
      symbols: ['BTC/USD'],
      days: 30,
    });

    const sentimentScores = { 'BTC/USD': Array.from({ length: 30 }, (_, i) => i * 0.05) };
    await pipeline.run({ sentimentScores });

    const stored = pipeline.getCandles('BTC/USD');
    expect(stored[1].sentiment_velocity).toBeCloseTo(0.05, 4);

    pipeline.close();
  });

  test('stored data is queryable with filters', async () => {
    const candles = makeCandles(100);
    const pipeline = new DataPipeline({
      fetchFn: mockFetch(candles),
      symbols: ['BTC/USD'],
      days: 100,
    });

    await pipeline.run();
    const all = pipeline.getCandles('BTC/USD');
    const midTs = all[50].timestamp;
    const filtered = pipeline.getCandles('BTC/USD', { startTs: midTs, limit: 10 });
    expect(filtered).toHaveLength(10);
    expect(filtered[0].timestamp).toBe(midTs);

    pipeline.close();
  });

  test('OHLCV schema has required columns', async () => {
    const candles = makeCandles(10);
    const pipeline = new DataPipeline({
      fetchFn: mockFetch(candles),
      symbols: ['BTC/USD'],
      days: 10,
    });

    await pipeline.run();
    const row = pipeline.getCandles('BTC/USD')[0];
    expect(row).toHaveProperty('timestamp');
    expect(row).toHaveProperty('open');
    expect(row).toHaveProperty('high');
    expect(row).toHaveProperty('low');
    expect(row).toHaveProperty('close');
    expect(row).toHaveProperty('volume');
    expect(row).toHaveProperty('symbol');

    pipeline.close();
  });
});
