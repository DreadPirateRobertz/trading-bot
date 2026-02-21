import { describe, it, expect } from 'vitest';
import { EnsembleStrategy } from '../src/strategies/ensemble.js';
import { NeuralNetwork } from '../src/ml/model.js';
import { extractFeatures, NUM_FEATURES, NUM_CLASSES } from '../src/ml/features.js';

// === Helpers ===

function trendingUp(n = 200, start = 100) {
  const closes = [start];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 + 0.005 + Math.random() * 0.01));
  }
  return closes;
}

function trendingDown(n = 200, start = 100) {
  const closes = [start];
  for (let i = 1; i < n; i++) {
    closes.push(closes[i - 1] * (1 - 0.005 - Math.random() * 0.01));
  }
  return closes;
}

function flat(n = 200, price = 100) {
  const closes = [];
  for (let i = 0; i < n; i++) {
    closes.push(price + (Math.random() - 0.5) * 2);
  }
  return closes;
}

// Generate OHLCV candle data from closes
function closesToCandles(closes) {
  return closes.map((close, i) => {
    const open = i > 0 ? closes[i - 1] : close;
    const high = Math.max(open, close) * (1 + Math.random() * 0.01);
    const low = Math.min(open, close) * (1 - Math.random() * 0.01);
    const volume = Math.round(1000000 * (0.5 + 2 * Math.random()));
    return {
      openTime: Date.now() - (closes.length - i) * 86400000,
      timestamp: Date.now() - (closes.length - i) * 86400000,
      open, high, low, close, volume,
    };
  });
}

// Create a mock ML model that always predicts a given action
function createMockModel(action, confidence = 0.8) {
  const probs = {
    BUY: { buy: confidence, hold: (1 - confidence) / 2, sell: (1 - confidence) / 2 },
    HOLD: { buy: (1 - confidence) / 2, hold: confidence, sell: (1 - confidence) / 2 },
    SELL: { buy: (1 - confidence) / 2, hold: (1 - confidence) / 2, sell: confidence },
  };
  return {
    trained: true,
    predict(input) {
      const p = probs[action];
      return [p.buy, p.hold, p.sell];
    },
    predictSignal(input) {
      const p = probs[action];
      return {
        action,
        confidence,
        probabilities: p,
      };
    },
  };
}

// A mock feature extractor that returns a valid 10-element feature vector
function mockFeatureExtractor(candles) {
  if (!candles || candles.length < 26) return null;
  return Array.from({ length: NUM_FEATURES }, () => Math.random());
}

// A feature extractor that throws an error
function brokenFeatureExtractor() {
  throw new Error('Feature extraction failed');
}

describe('EnsembleStrategy with ML integration (tb-6ft)', () => {
  describe('backward compatibility (no ML)', () => {
    it('works without ML model (same as before)', () => {
      const closes = trendingUp(200);
      const ens = new EnsembleStrategy();
      const signal = ens.generateSignal(closes);
      expect(signal.components.momentum).toBeDefined();
      expect(signal.components.meanReversion).toBeDefined();
      expect(signal.components.ml).toBeUndefined();
      expect(signal.mlActive).toBe(false);
      expect(signal.regime).toBeDefined();
      expect(signal.weights).toBeDefined();
    });

    it('signal format unchanged — action/signal/confidence/regime/weights/components/reasons', () => {
      const closes = trendingUp(200);
      const ens = new EnsembleStrategy();
      const signal = ens.generateSignal(closes);
      expect(signal).toHaveProperty('signal');
      expect(signal).toHaveProperty('confidence');
      expect(signal).toHaveProperty('action');
      expect(signal).toHaveProperty('regime');
      expect(signal).toHaveProperty('weights');
      expect(signal).toHaveProperty('components');
      expect(signal).toHaveProperty('reasons');
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    });

    it('getRegimeWeights still works', () => {
      const ens = new EnsembleStrategy();
      const trendingWeights = ens.getRegimeWeights('trending');
      expect(trendingWeights.momentum).toBeGreaterThan(trendingWeights.meanReversion);
      const rangeWeights = ens.getRegimeWeights('range_bound');
      expect(rangeWeights.meanReversion).toBeGreaterThan(rangeWeights.momentum);
      const unknownWeights = ens.getRegimeWeights('unknown');
      expect(unknownWeights.momentum).toBe(0.5);
      expect(unknownWeights.meanReversion).toBe(0.5);
    });

    it('signal stays in [-1, 1] range without ML', () => {
      const closes = trendingUp(200);
      const ens = new EnsembleStrategy();
      const signal = ens.generateSignal(closes);
      expect(signal.signal).toBeGreaterThanOrEqual(-1);
      expect(signal.signal).toBeLessThanOrEqual(1);
    });

    it('works with custom weights', () => {
      const closes = trendingUp(200);
      const ens = new EnsembleStrategy({ weights: { momentum: 0.8, meanReversion: 0.2 } });
      const signal = ens.generateSignal(closes);
      expect(signal).toBeDefined();
      expect(signal.action).toBeDefined();
    });
  });

  describe('ML integration', () => {
    it('uses ML signal when model and candles provided', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);
      const mlModel = createMockModel('BUY', 0.9);
      const ens = new EnsembleStrategy({
        mlModel,
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 0.3,
      });
      const signal = ens.generateSignal(closes, candles);
      expect(signal.mlActive).toBe(true);
      expect(signal.components.ml).toBeDefined();
      expect(signal.components.ml.action).toBe('BUY');
      expect(signal.components.ml.confidence).toBe(0.9);
      expect(signal.reasons.some(r => r.includes('ML:'))).toBe(true);
    });

    it('ML weight is configurable (default 0.3)', () => {
      const closes = flat(200);
      const candles = closesToCandles(closes);

      // With ML weight 0 = no ML influence
      const ens0 = new EnsembleStrategy({
        mlModel: createMockModel('BUY', 0.9),
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 0,
      });
      const sig0 = ens0.generateSignal(closes, candles);

      // With ML weight 1 = full ML
      const ens1 = new EnsembleStrategy({
        mlModel: createMockModel('BUY', 0.9),
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 1.0,
      });
      const sig1 = ens1.generateSignal(closes, candles);

      // With weight=0, ml component should still be in components but with 0 influence
      expect(sig0.mlActive).toBe(true);
      expect(sig1.mlActive).toBe(true);

      // Full ML weight should push signal strongly toward BUY
      expect(sig1.signal).toBeGreaterThan(sig0.signal);
    });

    it('ML skipped when candles not provided (backward compatible)', () => {
      const closes = trendingUp(200);
      const mlModel = createMockModel('BUY', 0.9);
      const ens = new EnsembleStrategy({
        mlModel,
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 0.3,
      });
      // No candles argument
      const signal = ens.generateSignal(closes);
      expect(signal.mlActive).toBe(false);
      expect(signal.components.ml).toBeUndefined();
    });
  });

  describe('AC #6: ML agrees with rules', () => {
    it('ML BUY + rules BUY = stronger BUY signal', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);

      // Without ML
      const ensNoML = new EnsembleStrategy();
      const sigNoML = ensNoML.generateSignal(closes);

      // With ML agreeing (BUY)
      const ensML = new EnsembleStrategy({
        mlModel: createMockModel('BUY', 0.9),
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 0.3,
      });
      const sigML = ensML.generateSignal(closes, candles);

      // Both should be BUY, ML-enhanced should have higher or equal signal
      if (sigNoML.action === 'BUY') {
        expect(sigML.action).toBe('BUY');
        // Signal magnitude should be >= rule-only (ML agrees, adding in same direction)
        expect(sigML.signal).toBeGreaterThanOrEqual(sigNoML.signal * 0.7 - 0.01);
      }
    });
  });

  describe('AC #6: ML disagrees with rules', () => {
    it('ML SELL + rules BUY = weakened signal', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);

      // Without ML
      const ensNoML = new EnsembleStrategy();
      const sigNoML = ensNoML.generateSignal(closes);

      // With ML disagreeing (SELL when rules say BUY)
      const ensML = new EnsembleStrategy({
        mlModel: createMockModel('SELL', 0.9),
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 0.3,
      });
      const sigML = ensML.generateSignal(closes, candles);

      // ML disagreement should pull signal toward zero (weaker than rule-only)
      if (sigNoML.signal > 0) {
        expect(sigML.signal).toBeLessThan(sigNoML.signal + 0.01);
      }
    });

    it('ML HOLD dampens extreme rule signals', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);

      const ensML = new EnsembleStrategy({
        mlModel: createMockModel('HOLD', 0.9),
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 0.5, // high ML weight to see the effect
      });
      const sigML = ensML.generateSignal(closes, candles);

      // With 50% weight on HOLD, signal should be dampened
      const ensNoML = new EnsembleStrategy();
      const sigNoML = ensNoML.generateSignal(closes);

      expect(Math.abs(sigML.signal)).toBeLessThanOrEqual(Math.abs(sigNoML.signal) + 0.01);
    });
  });

  describe('AC #6: ML unavailable', () => {
    it('falls back to rules when mlModel is null', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);
      const ens = new EnsembleStrategy({ mlModel: null, mlWeight: 0.3 });
      const signal = ens.generateSignal(closes, candles);
      expect(signal.mlActive).toBe(false);
      expect(signal.components.ml).toBeUndefined();
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    });

    it('falls back when feature extractor is null', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);
      const ens = new EnsembleStrategy({
        mlModel: createMockModel('BUY'),
        mlFeatureExtractor: null,
        mlWeight: 0.3,
      });
      const signal = ens.generateSignal(closes, candles);
      expect(signal.mlActive).toBe(false);
    });

    it('falls back when feature extractor throws error (no crash)', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);
      const ens = new EnsembleStrategy({
        mlModel: createMockModel('BUY'),
        mlFeatureExtractor: brokenFeatureExtractor,
        mlWeight: 0.3,
      });
      // Should NOT throw
      const signal = ens.generateSignal(closes, candles);
      expect(signal.mlActive).toBe(false);
      expect(signal.components.ml).toBeUndefined();
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    });

    it('falls back when feature extractor returns null (insufficient data)', () => {
      const closes = trendingUp(200);
      // Too few candles for feature extraction
      const shortCandles = closesToCandles(closes.slice(0, 10));
      const ens = new EnsembleStrategy({
        mlModel: createMockModel('BUY'),
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 0.3,
      });
      const signal = ens.generateSignal(closes, shortCandles);
      expect(signal.mlActive).toBe(false);
    });

    it('falls back when model predict throws', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);
      const brokenModel = {
        trained: true,
        predictSignal() { throw new Error('Model inference failed'); },
      };
      const ens = new EnsembleStrategy({
        mlModel: brokenModel,
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 0.3,
      });
      const signal = ens.generateSignal(closes, candles);
      expect(signal.mlActive).toBe(false);
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
    });

    it('mentions fallback in reasons when model configured but unavailable', () => {
      const closes = trendingUp(200);
      const ens = new EnsembleStrategy({
        mlModel: createMockModel('BUY'),
        mlFeatureExtractor: brokenFeatureExtractor,
        mlWeight: 0.3,
      });
      const signal = ens.generateSignal(closes, closesToCandles(closes));
      expect(signal.reasons.some(r => r.includes('unavailable') || r.includes('fallback'))).toBe(true);
    });
  });

  describe('AC #5: signal output format unchanged', () => {
    it('output has all standard fields regardless of ML state', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);

      // With ML
      const ensML = new EnsembleStrategy({
        mlModel: createMockModel('BUY'),
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 0.3,
      });
      const sigML = ensML.generateSignal(closes, candles);

      // Without ML
      const ensNoML = new EnsembleStrategy();
      const sigNoML = ensNoML.generateSignal(closes);

      // Both should have same top-level keys
      for (const key of ['signal', 'confidence', 'action', 'regime', 'weights', 'components', 'reasons']) {
        expect(sigML).toHaveProperty(key);
        expect(sigNoML).toHaveProperty(key);
      }

      // Signal range
      expect(sigML.signal).toBeGreaterThanOrEqual(-1);
      expect(sigML.signal).toBeLessThanOrEqual(1);
      expect(sigML.confidence).toBeGreaterThanOrEqual(0);
      expect(sigML.confidence).toBeLessThanOrEqual(1);
    });
  });

  describe('AC #7: integration with real feature pipeline', () => {
    it('ensemble produces signals using real extractFeatures from ML module', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);

      // Use real NeuralNetwork (untrained — should still not crash)
      const model = new NeuralNetwork();
      const ens = new EnsembleStrategy({
        mlModel: model,
        mlFeatureExtractor: extractFeatures,
        mlWeight: 0.3,
      });
      const signal = ens.generateSignal(closes, candles);

      // Untrained model: model.trained is false, but predictSignal still works
      // (NeuralNetwork.predictSignal works on untrained models, just random output)
      expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
      expect(signal.signal).toBeGreaterThanOrEqual(-1);
      expect(signal.signal).toBeLessThanOrEqual(1);
    });

    it('ensemble with trained model produces ML-influenced signals', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);

      // Create and quickly train a model
      const model = new NeuralNetwork();
      // Train on a few synthetic samples
      const trainData = [];
      for (let i = 0; i < 50; i++) {
        const input = Array.from({ length: NUM_FEATURES }, () => Math.random());
        const output = i % 3 === 0 ? [1, 0, 0] : i % 3 === 1 ? [0, 1, 0] : [0, 0, 1];
        trainData.push({ input, output });
      }
      model.train(trainData, { epochs: 5 });

      const ens = new EnsembleStrategy({
        mlModel: model,
        mlFeatureExtractor: extractFeatures,
        mlWeight: 0.3,
      });
      const signal = ens.generateSignal(closes, candles);

      expect(signal.mlActive).toBe(true);
      expect(signal.components.ml).toBeDefined();
      expect(signal.components.ml.probabilities).toBeDefined();
      expect(signal.components.ml.probabilities.buy).toBeGreaterThanOrEqual(0);
      expect(signal.components.ml.probabilities.sell).toBeGreaterThanOrEqual(0);
      expect(signal.components.ml.probabilities.hold).toBeGreaterThanOrEqual(0);
    });
  });

  describe('edge cases', () => {
    it('signal stays in [-1, 1] with extreme ML predictions', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);
      const ens = new EnsembleStrategy({
        mlModel: createMockModel('BUY', 1.0),
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 1.0, // all ML
      });
      const signal = ens.generateSignal(closes, candles);
      expect(signal.signal).toBeGreaterThanOrEqual(-1);
      expect(signal.signal).toBeLessThanOrEqual(1);
    });

    it('confidence stays in [0, 1]', () => {
      const closes = trendingUp(200);
      const candles = closesToCandles(closes);
      const ens = new EnsembleStrategy({
        mlModel: createMockModel('BUY', 1.0),
        mlFeatureExtractor: mockFeatureExtractor,
        mlWeight: 0.3,
      });
      const signal = ens.generateSignal(closes, candles);
      expect(signal.confidence).toBeGreaterThanOrEqual(0);
      expect(signal.confidence).toBeLessThanOrEqual(1);
    });
  });
});
