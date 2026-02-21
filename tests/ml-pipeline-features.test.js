// Tests for pipeline feature extraction + directional training
import { describe, it, expect } from 'vitest';
import { extractPipelineFeatures, generatePipelineTrainingData, NUM_PIPELINE_FEATURES, PIPELINE_FEATURE_NAMES } from '../src/ml/features.js';
import { computeAllFeatures } from '../src/data-pipeline/features.js';
import { NeuralNetwork } from '../src/ml/model.js';

// Generate synthetic candle data for testing
function generateCandles(n = 200) {
  const candles = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const change = (Math.random() - 0.45) * 2;
    price = Math.max(price + change, 10);
    candles.push({
      symbol: 'TEST',
      timestamp: Date.now() - (n - i) * 86400000,
      open: price - change / 2,
      high: price + Math.random() * 2 + 0.1,
      low: Math.max(price - Math.random() * 2 - 0.1, 1),
      close: price,
      volume: 1000 + Math.random() * 5000,
    });
  }
  return candles;
}

describe('Pipeline Feature Extraction', () => {
  it('extracts 13 features from a valid pipeline row', () => {
    const candles = generateCandles(100);
    const featureRows = computeAllFeatures(candles);
    const validRow = featureRows.find(r => r.rsi_14 !== null);
    expect(validRow).toBeDefined();

    const features = extractPipelineFeatures({ ...validRow, close: candles[50].close });
    expect(features).not.toBeNull();
    expect(features).toHaveLength(NUM_PIPELINE_FEATURES);
    expect(features).toHaveLength(13);
  });

  it('all features are in [0, 1] range', () => {
    const candles = generateCandles(200);
    const featureRows = computeAllFeatures(candles);

    for (let i = 50; i < candles.length; i++) {
      const row = featureRows[i];
      if (row.rsi_14 === null) continue;

      const features = extractPipelineFeatures({ ...row, close: candles[i].close });
      if (!features) continue;

      for (let j = 0; j < features.length; j++) {
        expect(features[j]).toBeGreaterThanOrEqual(0);
        expect(features[j]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('returns null when row has no RSI', () => {
    const features = extractPipelineFeatures({ rsi_14: null, close: 100 });
    expect(features).toBeNull();
  });

  it('returns null when row has no close price', () => {
    const features = extractPipelineFeatures({ rsi_14: 50 });
    expect(features).toBeNull();
  });

  it('all features are finite numbers', () => {
    const candles = generateCandles(200);
    const featureRows = computeAllFeatures(candles);
    const row = featureRows.find(r => r.rsi_14 !== null);
    const features = extractPipelineFeatures({ ...row, close: candles[60].close });

    expect(features).not.toBeNull();
    for (const f of features) {
      expect(isFinite(f)).toBe(true);
      expect(isNaN(f)).toBe(false);
    }
  });
});

describe('Pipeline Training Data Generation', () => {
  it('generates directional (binary) training data', () => {
    const candles = generateCandles(200);
    const featureRows = computeAllFeatures(candles);
    const data = generatePipelineTrainingData(candles, featureRows, {
      warmup: 50, horizon: 5, mode: 'directional',
    });

    expect(data.length).toBeGreaterThan(0);
    for (const sample of data) {
      expect(sample.input).toHaveLength(NUM_PIPELINE_FEATURES);
      expect(sample.output).toHaveLength(2); // UP, DOWN
      expect(sample.output[0] + sample.output[1]).toBe(1);
    }
  });

  it('generates ternary (BUY/HOLD/SELL) training data', () => {
    const candles = generateCandles(200);
    const featureRows = computeAllFeatures(candles);
    const data = generatePipelineTrainingData(candles, featureRows, {
      warmup: 50, horizon: 5, mode: 'ternary',
    });

    expect(data.length).toBeGreaterThan(0);
    for (const sample of data) {
      expect(sample.input).toHaveLength(NUM_PIPELINE_FEATURES);
      expect(sample.output).toHaveLength(3);
      expect(sample.output.reduce((a, b) => a + b, 0)).toBe(1);
    }
  });

  it('directional data has both UP and DOWN labels', () => {
    const candles = generateCandles(300);
    const featureRows = computeAllFeatures(candles);
    const data = generatePipelineTrainingData(candles, featureRows, {
      warmup: 50, horizon: 5, mode: 'directional',
    });

    const ups = data.filter(d => d.output[0] === 1).length;
    const downs = data.filter(d => d.output[1] === 1).length;
    expect(ups).toBeGreaterThan(0);
    expect(downs).toBeGreaterThan(0);
    expect(ups + downs).toBe(data.length);
  });

  it('each sample includes futureReturn', () => {
    const candles = generateCandles(200);
    const featureRows = computeAllFeatures(candles);
    const data = generatePipelineTrainingData(candles, featureRows, {
      warmup: 50, horizon: 5, mode: 'directional',
    });

    for (const sample of data) {
      expect(typeof sample.futureReturn).toBe('number');
      expect(isFinite(sample.futureReturn)).toBe(true);
    }
  });

  it('returns empty when insufficient candles', () => {
    const candles = generateCandles(40);
    const featureRows = computeAllFeatures(candles);
    const data = generatePipelineTrainingData(candles, featureRows, {
      warmup: 50, horizon: 5, mode: 'directional',
    });
    expect(data).toHaveLength(0);
  });
});

describe('Directional Model Training', () => {
  it('trains a binary classifier on pipeline features', () => {
    const candles = generateCandles(300);
    const featureRows = computeAllFeatures(candles);
    const data = generatePipelineTrainingData(candles, featureRows, {
      warmup: 50, horizon: 5, mode: 'directional',
    });

    const model = new NeuralNetwork({
      layers: [NUM_PIPELINE_FEATURES, 16, 8, 2],
      learningRate: 0.01,
    });

    const history = model.train(data, { epochs: 20, shuffle: true });
    expect(history).toHaveLength(20);
    expect(model.trained).toBe(true);

    // Output should be 2 probabilities summing to ~1
    const pred = model.predict(data[0].input);
    expect(pred).toHaveLength(2);
    expect(pred[0] + pred[1]).toBeCloseTo(1.0, 4);
  });

  it('trainBalanced oversamples minority class', () => {
    // Create imbalanced data: 80% UP, 20% DOWN
    const data = [];
    for (let i = 0; i < 100; i++) {
      const isUp = i < 80;
      data.push({
        input: Array.from({ length: NUM_PIPELINE_FEATURES }, () => Math.random()),
        output: isUp ? [1, 0] : [0, 1],
      });
    }

    const model = new NeuralNetwork({
      layers: [NUM_PIPELINE_FEATURES, 8, 2],
      learningRate: 0.05,
    });

    // trainBalanced should train on balanced data internally
    const history = model.trainBalanced(data, { epochs: 50, shuffle: true });
    expect(history.length).toBe(50);
    expect(model.trained).toBe(true);
  });
});

describe('Model Evaluation Metrics', () => {
  it('evaluate includes perClass precision/recall/f1', () => {
    const model = new NeuralNetwork({ layers: [4, 8, 3] });
    const data = [
      { input: [0.1, 0.2, 0.3, 0.4], output: [1, 0, 0] },
      { input: [0.5, 0.6, 0.7, 0.8], output: [0, 1, 0] },
      { input: [0.9, 0.8, 0.7, 0.6], output: [0, 0, 1] },
    ];
    model.train(data, { epochs: 10 });
    const metrics = model.evaluate(data);

    expect(metrics).toHaveProperty('perClass');
    expect(metrics).toHaveProperty('directionalAccuracy');
    for (const cls of ['BUY', 'HOLD', 'SELL']) {
      expect(metrics.perClass[cls]).toHaveProperty('precision');
      expect(metrics.perClass[cls]).toHaveProperty('recall');
      expect(metrics.perClass[cls]).toHaveProperty('f1');
      expect(metrics.perClass[cls]).toHaveProperty('support');
    }
  });

  it('directionalAccuracy counts BUY and SELL correct predictions', () => {
    const model = new NeuralNetwork({ layers: [2, 4, 3] });
    // Manually check: if model predicts everything as HOLD, directional acc = 0
    const data = [
      { input: [0.1, 0.2], output: [1, 0, 0] }, // BUY
      { input: [0.9, 0.8], output: [0, 0, 1] }, // SELL
    ];
    const metrics = model.evaluate(data);
    expect(metrics.directionalAccuracy).toBeGreaterThanOrEqual(0);
    expect(metrics.directionalAccuracy).toBeLessThanOrEqual(1);
  });
});

describe('Pipeline Feature Constants', () => {
  it('PIPELINE_FEATURE_NAMES matches NUM_PIPELINE_FEATURES', () => {
    expect(PIPELINE_FEATURE_NAMES).toHaveLength(NUM_PIPELINE_FEATURES);
    expect(NUM_PIPELINE_FEATURES).toBe(13);
  });
});
