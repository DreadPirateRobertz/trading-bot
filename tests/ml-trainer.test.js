// ML Trainer Tests
import { describe, it, expect } from 'vitest';
import { Trainer, MLSignalEnhancer } from '../src/ml/trainer.js';
import { NeuralNetwork } from '../src/ml/model.js';
import { SignalEngine } from '../src/signals/engine.js';

// Generate synthetic trending candles
function generateTrendCandles(n = 200, startPrice = 100, trend = 'up') {
  const candles = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    const drift = trend === 'up' ? 0.1 : trend === 'down' ? -0.1 : 0;
    const noise = (Math.random() - 0.5) * 2;
    price = Math.max(price + drift + noise, 1);
    candles.push({
      open: price - noise / 2,
      high: price + Math.abs(noise) + 0.5,
      low: price - Math.abs(noise) - 0.5,
      close: price,
      volume: 1000 + Math.random() * 5000,
      openTime: Date.now() - (n - i) * 60000,
    });
  }
  return candles;
}

// Generate mean-reverting candles (clearer signal for training)
function generateMeanRevertingCandles(n = 300) {
  const candles = [];
  let price = 100;
  const mean = 100;
  for (let i = 0; i < n; i++) {
    const reversion = (mean - price) * 0.05;
    const noise = (Math.random() - 0.5) * 3;
    price = Math.max(price + reversion + noise, 50);
    candles.push({
      open: price - noise / 2,
      high: price + Math.abs(noise) + 0.5,
      low: price - Math.abs(noise) - 0.5,
      close: price,
      volume: 1000 + Math.random() * 5000,
      openTime: Date.now() - (n - i) * 60000,
    });
  }
  return candles;
}

describe('Trainer', () => {
  describe('trainOnCandles', () => {
    it('trains model on candle data and returns results', () => {
      const trainer = new Trainer({ epochs: 10, lookback: 30 });
      const candles = generateTrendCandles(200, 100, 'up');
      const result = trainer.trainOnCandles(candles);

      expect(result.error).toBeUndefined();
      expect(result.model).toBeInstanceOf(NeuralNetwork);
      expect(result.model.trained).toBe(true);
      expect(result.history).toHaveLength(10);
      expect(result.trainMetrics).toHaveProperty('accuracy');
      expect(result.valMetrics).toHaveProperty('accuracy');
      expect(result.dataStats).toHaveProperty('total');
    });

    it('returns error when insufficient candles', () => {
      const trainer = new Trainer({ lookback: 30 });
      const candles = generateTrendCandles(40);
      const result = trainer.trainOnCandles(candles);
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Insufficient');
    });

    it('produces valid dataStats with class distribution', () => {
      const trainer = new Trainer({ epochs: 5, lookback: 30 });
      const candles = generateTrendCandles(200);
      const result = trainer.trainOnCandles(candles);

      expect(result.dataStats.total).toBeGreaterThan(0);
      expect(result.dataStats.train).toBeGreaterThan(0);
      expect(result.dataStats.val).toBeGreaterThan(0);
      expect(result.dataStats.train + result.dataStats.val).toBe(result.dataStats.total);
      const classes = result.dataStats.classes;
      expect(classes.BUY + classes.HOLD + classes.SELL).toBe(result.dataStats.total);
    });

    it('walk-forward split maintains temporal order', () => {
      const trainer = new Trainer({ epochs: 5, trainSplit: 0.8, lookback: 30 });
      const candles = generateTrendCandles(200);
      const result = trainer.trainOnCandles(candles);

      // Train should be ~80%, val ~20%
      const trainPct = result.dataStats.train / result.dataStats.total;
      expect(trainPct).toBeCloseTo(0.8, 1);
    });

    it('accepts sentiment data', () => {
      const trainer = new Trainer({ epochs: 5, lookback: 30 });
      const candles = generateTrendCandles(200);
      const sentiment = candles.map((c, i) => ({
        timestamp: c.openTime,
        classification: i % 3 === 0 ? 'bullish' : i % 3 === 1 ? 'bearish' : 'neutral',
        score: i % 3 === 0 ? 2 : i % 3 === 1 ? -2 : 0,
      }));
      const result = trainer.trainOnCandles(candles, { sentiment });
      expect(result.error).toBeUndefined();
      expect(result.model.trained).toBe(true);
    });
  });

  describe('walkForwardCV', () => {
    it('performs walk-forward cross-validation', () => {
      const trainer = new Trainer({ epochs: 10, lookback: 30 });
      const candles = generateMeanRevertingCandles(400);
      const result = trainer.walkForwardCV(candles, { folds: 3 });

      expect(result.error).toBeUndefined();
      expect(result.folds.length).toBeGreaterThan(0);
      expect(result.folds.length).toBeLessThanOrEqual(3);
      expect(result.avgAccuracy).toBeGreaterThanOrEqual(0);
      expect(result.avgAccuracy).toBeLessThanOrEqual(1);
      expect(result.totalSamples).toBeGreaterThan(0);
    });

    it('each fold has increasing training size', () => {
      const trainer = new Trainer({ epochs: 5, lookback: 30 });
      const candles = generateMeanRevertingCandles(400);
      const result = trainer.walkForwardCV(candles, { folds: 3 });

      for (let i = 1; i < result.folds.length; i++) {
        expect(result.folds[i].trainSize).toBeGreaterThan(result.folds[i - 1].trainSize);
      }
    });

    it('returns error for insufficient data', () => {
      const trainer = new Trainer({ lookback: 30 });
      const candles = generateTrendCandles(50);
      const result = trainer.walkForwardCV(candles, { folds: 5 });
      expect(result.error).toBeDefined();
    });
  });
});

describe('MLSignalEnhancer', () => {
  it('passes through analysis when no trained model', () => {
    const enhancer = new MLSignalEnhancer(null);
    const analysis = {
      symbol: 'TEST',
      signal: { action: 'BUY', score: 3, confidence: 0.5, reasons: ['RSI oversold'] },
    };
    const result = enhancer.enhance(analysis, []);
    expect(result).toEqual(analysis);
  });

  it('enhances signal with ML prediction when model is trained', () => {
    // Train a quick model
    const trainer = new Trainer({ epochs: 10, lookback: 30 });
    const candles = generateTrendCandles(200);
    const { model } = trainer.trainOnCandles(candles);

    const enhancer = new MLSignalEnhancer(model, { mlWeight: 0.4 });
    const engine = new SignalEngine();

    // Create analysis window
    const window = candles.slice(-31);
    const closes = window.map(c => c.close);
    const volumes = window.map(c => c.volume);
    const analysis = engine.analyze('TEST', { closes, volumes, currentPrice: closes[closes.length - 1] });

    const enhanced = enhancer.enhance(analysis, window);
    expect(enhanced).toHaveProperty('ml');
    expect(enhanced.ml).toHaveProperty('prediction');
    expect(enhanced.ml).toHaveProperty('confidence');
    expect(enhanced.ml).toHaveProperty('probabilities');
    expect(['BUY', 'HOLD', 'SELL']).toContain(enhanced.ml.prediction);
  });

  it('blends rule-based and ML signals with configurable weight', () => {
    const trainer = new Trainer({ epochs: 10, lookback: 30 });
    const candles = generateTrendCandles(200);
    const { model } = trainer.trainOnCandles(candles);

    // Test with different ML weights
    const enhancerLow = new MLSignalEnhancer(model, { mlWeight: 0.1 });
    const enhancerHigh = new MLSignalEnhancer(model, { mlWeight: 0.9 });

    const engine = new SignalEngine();
    const window = candles.slice(-31);
    const closes = window.map(c => c.close);
    const volumes = window.map(c => c.volume);
    const analysis = engine.analyze('TEST', { closes, volumes, currentPrice: closes[closes.length - 1] });

    const lowResult = enhancerLow.enhance(analysis, window);
    const highResult = enhancerHigh.enhance(analysis, window);

    // Both should have ML data
    expect(lowResult.ml).toBeDefined();
    expect(highResult.ml).toBeDefined();
    // Confidence should differ with different weights
    if (lowResult.ml.prediction !== 'HOLD' || highResult.ml.prediction !== 'HOLD') {
      expect(lowResult.signal.confidence).not.toBe(highResult.signal.confidence);
    }
  });

  it('adds ML reason to signal reasons', () => {
    const trainer = new Trainer({ epochs: 20, lookback: 30 });
    const candles = generateTrendCandles(200, 100, 'up');
    const { model } = trainer.trainOnCandles(candles);

    const enhancer = new MLSignalEnhancer(model);
    const engine = new SignalEngine();
    const window = candles.slice(-31);
    const closes = window.map(c => c.close);
    const volumes = window.map(c => c.volume);
    const analysis = engine.analyze('TEST', { closes, volumes, currentPrice: closes[closes.length - 1] });

    const enhanced = enhancer.enhance(analysis, window);
    // If ML has a non-HOLD prediction, it should add a reason
    if (enhanced.ml.prediction !== 'HOLD') {
      const mlReasons = enhanced.signal.reasons.filter(r => r.startsWith('ML predicts'));
      expect(mlReasons.length).toBe(1);
    }
  });
});
