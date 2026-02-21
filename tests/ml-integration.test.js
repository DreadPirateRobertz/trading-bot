// ML Integration Tests
// End-to-end tests verifying ML module works with existing backtest pipeline
import { describe, it, expect } from 'vitest';
import { Backtester } from '../src/backtest/index.js';
import { Trainer, MLSignalEnhancer } from '../src/ml/trainer.js';
import { NeuralNetwork } from '../src/ml/model.js';
import { extractFeatures, generateTrainingData, NUM_FEATURES } from '../src/ml/features.js';

// Generate realistic-looking candle data with regime changes
function generateRealisticCandles(n = 500) {
  const candles = [];
  let price = 100;
  let regime = 'trend'; // trend, range, volatile
  let regimeLength = 0;

  for (let i = 0; i < n; i++) {
    regimeLength++;
    if (regimeLength > 50 + Math.random() * 50) {
      regime = ['trend', 'range', 'volatile'][Math.floor(Math.random() * 3)];
      regimeLength = 0;
    }

    let change;
    switch (regime) {
      case 'trend':
        change = (Math.random() - 0.4) * 1.5; // Slight upward drift
        break;
      case 'range':
        change = (100 - price) * 0.02 + (Math.random() - 0.5) * 1; // Mean-reverting
        break;
      case 'volatile':
        change = (Math.random() - 0.5) * 5; // High noise
        break;
    }

    price = Math.max(price + change, 10);
    const volatility = regime === 'volatile' ? 3 : 1;
    candles.push({
      open: price - change / 2,
      high: price + Math.random() * volatility + 0.5,
      low: Math.max(price - Math.random() * volatility - 0.5, 1),
      close: price,
      volume: 1000 + Math.random() * (regime === 'volatile' ? 10000 : 3000),
      openTime: Date.now() - (n - i) * 60000,
    });
  }
  return candles;
}

describe('ML + Backtest Integration', () => {
  it('trained model produces valid predictions on backtest-style data', () => {
    const candles = generateRealisticCandles(300);
    const trainer = new Trainer({ epochs: 15, lookback: 30 });
    const { model } = trainer.trainOnCandles(candles);

    // Use model to predict on unseen window
    const window = candles.slice(250, 281);
    const features = extractFeatures(window);
    expect(features).not.toBeNull();

    const prediction = model.predictSignal(features);
    expect(['BUY', 'HOLD', 'SELL']).toContain(prediction.action);
    expect(prediction.confidence).toBeGreaterThan(0);
    expect(prediction.confidence).toBeLessThanOrEqual(1);
    const probSum = prediction.probabilities.buy + prediction.probabilities.hold + prediction.probabilities.sell;
    expect(probSum).toBeCloseTo(1.0, 5);
  });

  it('model serialization round-trip works with real features', () => {
    const candles = generateRealisticCandles(200);
    const trainer = new Trainer({ epochs: 5, lookback: 30 });
    const { model } = trainer.trainOnCandles(candles);

    const json = model.toJSON();
    const jsonStr = JSON.stringify(json);
    const restored = NeuralNetwork.fromJSON(JSON.parse(jsonStr));

    const window = candles.slice(-31);
    const features = extractFeatures(window);
    const origPred = model.predict(features);
    const restoredPred = restored.predict(features);

    for (let i = 0; i < origPred.length; i++) {
      expect(restoredPred[i]).toBeCloseTo(origPred[i], 10);
    }
  });

  it('backtester runs successfully alongside ML training', () => {
    const candles = generateRealisticCandles(300);

    // Run standard backtest
    const backtester = new Backtester({ initialBalance: 100000 });
    const backtestResult = backtester.run('TEST', candles, { lookback: 30 });
    expect(backtestResult.error).toBeUndefined();
    expect(backtestResult.totalReturn).toBeDefined();

    // Train ML model on same data
    const trainer = new Trainer({ epochs: 10, lookback: 30 });
    const mlResult = trainer.trainOnCandles(candles);
    expect(mlResult.error).toBeUndefined();
    expect(mlResult.model.trained).toBe(true);
  });

  it('feature extraction handles edge cases in candle data', () => {
    // Very low volume
    const lowVolCandles = generateRealisticCandles(40);
    lowVolCandles.forEach(c => c.volume = 0.01);
    const features1 = extractFeatures(lowVolCandles);
    expect(features1).not.toBeNull();
    features1.forEach(f => {
      expect(isFinite(f)).toBe(true);
      expect(isNaN(f)).toBe(false);
    });

    // Very high prices
    const highPriceCandles = generateRealisticCandles(40);
    highPriceCandles.forEach(c => {
      c.open *= 1000; c.high *= 1000; c.low *= 1000; c.close *= 1000;
    });
    const features2 = extractFeatures(highPriceCandles);
    expect(features2).not.toBeNull();
    features2.forEach(f => {
      expect(isFinite(f)).toBe(true);
    });
  });

  it('training data label distribution is reasonable', () => {
    const candles = generateRealisticCandles(400);
    const data = generateTrainingData(candles, {
      lookback: 30, horizon: 5, buyThreshold: 0.02, sellThreshold: -0.02,
    });

    const buyCount = data.filter(d => d.output[0] === 1).length;
    const holdCount = data.filter(d => d.output[1] === 1).length;
    const sellCount = data.filter(d => d.output[2] === 1).length;

    // Each class should have at least some representation
    expect(buyCount).toBeGreaterThan(0);
    expect(holdCount).toBeGreaterThan(0);
    expect(sellCount).toBeGreaterThan(0);
    expect(buyCount + holdCount + sellCount).toBe(data.length);
  });
});

describe('ML Module Exports', () => {
  it('all exports are accessible from ml/index.js', async () => {
    const ml = await import('../src/ml/index.js');
    expect(ml.extractFeatures).toBeTypeOf('function');
    expect(ml.generateTrainingData).toBeTypeOf('function');
    expect(ml.NeuralNetwork).toBeTypeOf('function');
    expect(ml.Trainer).toBeTypeOf('function');
    expect(ml.MLSignalEnhancer).toBeTypeOf('function');
    expect(ml.FEATURE_NAMES).toHaveLength(NUM_FEATURES);
    expect(ml.NUM_FEATURES).toBe(10);
    expect(ml.NUM_CLASSES).toBe(3);
    expect(ml.CLASS_NAMES).toEqual(['BUY', 'HOLD', 'SELL']);
  });

  it('ML modules are importable from ml/index.js barrel', async () => {
    // Note: main src/index.js also re-exports these, but we test the direct
    // import to avoid coupling with other modules (e.g. data-pipeline deps)
    const ml = await import('../src/ml/index.js');
    expect(ml.NeuralNetwork).toBeTypeOf('function');
    expect(ml.Trainer).toBeTypeOf('function');
    expect(ml.MLSignalEnhancer).toBeTypeOf('function');
    expect(ml.extractFeatures).toBeTypeOf('function');
    expect(ml.generateTrainingData).toBeTypeOf('function');
  });
});
