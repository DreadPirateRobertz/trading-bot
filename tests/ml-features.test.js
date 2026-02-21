// ML Feature Extraction Tests
import { describe, it, expect } from 'vitest';
import { extractFeatures, generateTrainingData, FEATURE_NAMES, NUM_FEATURES, NUM_CLASSES, CLASS_NAMES } from '../src/ml/features.js';

// Generate synthetic OHLCV candles for testing
function generateCandles(n = 60, startPrice = 100) {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    const change = (Math.random() - 0.48) * 2; // Slight upward bias
    price = Math.max(price + change, 1);
    const high = price + Math.random() * 2;
    const low = price - Math.random() * 2;
    candles.push({
      open: price - change / 2,
      high,
      low: Math.max(low, 0.1),
      close: price,
      volume: 1000 + Math.random() * 5000,
      openTime: Date.now() - (n - i) * 60000,
    });
  }
  return candles;
}

describe('Feature Extraction', () => {
  it('extracts correct number of features from valid candles', () => {
    const candles = generateCandles(40);
    const features = extractFeatures(candles);
    expect(features).not.toBeNull();
    expect(features).toHaveLength(NUM_FEATURES);
    expect(features).toHaveLength(10);
  });

  it('returns null when insufficient candles (< 26)', () => {
    const candles = generateCandles(20);
    const features = extractFeatures(candles);
    expect(features).toBeNull();
  });

  it('produces features in [0, 1] range', () => {
    const candles = generateCandles(60);
    const features = extractFeatures(candles);
    expect(features).not.toBeNull();
    for (let i = 0; i < features.length; i++) {
      expect(features[i]).toBeGreaterThanOrEqual(0);
      expect(features[i]).toBeLessThanOrEqual(1);
    }
  });

  it('incorporates sentiment data when provided', () => {
    const candles = generateCandles(40);
    const featuresNoSentiment = extractFeatures(candles);
    const featuresWithSentiment = extractFeatures(candles, {
      sentiment: { classification: 'very_bullish', score: 5 },
    });
    expect(featuresNoSentiment).not.toBeNull();
    expect(featuresWithSentiment).not.toBeNull();
    // Sentiment feature (index 9) should differ
    expect(featuresWithSentiment[9]).not.toEqual(featuresNoSentiment[9]);
    expect(featuresWithSentiment[9]).toBeGreaterThan(0.5); // Bullish > neutral
  });

  it('handles sentiment with score value', () => {
    const candles = generateCandles(40);
    const features = extractFeatures(candles, { sentiment: { score: -3 } });
    expect(features).not.toBeNull();
    expect(features[9]).toBeLessThan(0.5); // Bearish
  });

  it('handles flat price data', () => {
    const candles = [];
    for (let i = 0; i < 40; i++) {
      candles.push({ open: 100, high: 100.1, low: 99.9, close: 100, volume: 1000, openTime: i * 60000 });
    }
    const features = extractFeatures(candles);
    expect(features).not.toBeNull();
    // Returns should be ~0.5 (centered)
    expect(features[6]).toBeCloseTo(0.5, 1); // 1-period return
    expect(features[7]).toBeCloseTo(0.5, 1); // 5-period return
  });
});

describe('Training Data Generation', () => {
  it('generates labeled samples from candle history', () => {
    const candles = generateCandles(100);
    const data = generateTrainingData(candles, { lookback: 30, horizon: 5 });
    expect(data.length).toBeGreaterThan(0);
    expect(data.length).toBeLessThanOrEqual(100 - 30 - 5);
  });

  it('each sample has input features and one-hot output', () => {
    const candles = generateCandles(100);
    const data = generateTrainingData(candles, { lookback: 30, horizon: 5 });
    for (const sample of data) {
      expect(sample.input).toHaveLength(NUM_FEATURES);
      expect(sample.output).toHaveLength(NUM_CLASSES);
      // One-hot: exactly one element is 1
      expect(sample.output.reduce((a, b) => a + b, 0)).toBe(1);
      expect(sample.output.every(v => v === 0 || v === 1)).toBe(true);
    }
  });

  it('labels reflect future returns correctly', () => {
    // Create a clear uptrend
    const candles = [];
    for (let i = 0; i < 100; i++) {
      const price = 100 + i * 0.5; // Steady uptrend
      candles.push({
        open: price - 0.2, high: price + 0.3, low: price - 0.3,
        close: price, volume: 1000, openTime: i * 60000,
      });
    }
    const data = generateTrainingData(candles, {
      lookback: 30, horizon: 5, buyThreshold: 0.01, sellThreshold: -0.01,
    });
    // Most labels should be BUY in an uptrend
    const buyCount = data.filter(d => d.output[0] === 1).length;
    expect(buyCount).toBeGreaterThan(data.length * 0.5);
  });

  it('returns empty array when candles too short', () => {
    const candles = generateCandles(20);
    const data = generateTrainingData(candles, { lookback: 30, horizon: 5 });
    expect(data).toHaveLength(0);
  });

  it('includes futureReturn in each sample', () => {
    const candles = generateCandles(100);
    const data = generateTrainingData(candles, { lookback: 30, horizon: 5 });
    for (const sample of data) {
      expect(typeof sample.futureReturn).toBe('number');
    }
  });
});

describe('Constants', () => {
  it('FEATURE_NAMES matches NUM_FEATURES', () => {
    expect(FEATURE_NAMES).toHaveLength(NUM_FEATURES);
  });

  it('CLASS_NAMES has correct values', () => {
    expect(CLASS_NAMES).toEqual(['BUY', 'HOLD', 'SELL']);
    expect(NUM_CLASSES).toBe(3);
  });
});
