import { describe, it, expect } from 'vitest';
import { WalkForwardEvaluator, runMultiSessionEvaluation, generateRegimeData } from '../src/ml/walk-forward-evaluator.js';
import { GaussianHMM } from '../src/ml/hmm.js';
import { EnsembleStrategy } from '../src/strategies/ensemble.js';
import { NeuralNetwork } from '../src/ml/model.js';
import { extractFeatures, NUM_FEATURES, NUM_CLASSES } from '../src/ml/features.js';

// Helper: generate candles with enough data for walk-forward evaluation
function makeCandles(n = 500) {
  return generateRegimeData(45000, n);
}

// Helper: make candle array from close prices
function closesToCandles(closes) {
  return closes.map((close, i) => {
    const open = i > 0 ? closes[i - 1] : close;
    return {
      openTime: Date.now() - (closes.length - i) * 86400000,
      open,
      high: Math.max(open, close) * (1 + Math.random() * 0.01),
      low: Math.min(open, close) * (1 - Math.random() * 0.01),
      close,
      volume: Math.round(1000000 * (0.5 + 2 * Math.random())),
    };
  });
}

describe('WalkForwardEvaluator', () => {
  describe('construction', () => {
    it('creates with default config', () => {
      const wf = new WalkForwardEvaluator();
      expect(wf.config.layers).toEqual([NUM_FEATURES, 16, 8, NUM_CLASSES]);
      expect(wf.config.mlWeight).toBe(0.3);
      expect(wf.config.retrainInterval).toBe(60);
    });

    it('accepts custom config', () => {
      const wf = new WalkForwardEvaluator({ mlWeight: 0.5, epochs: 20 });
      expect(wf.config.mlWeight).toBe(0.5);
      expect(wf.config.epochs).toBe(20);
    });
  });

  describe('evaluate', () => {
    it('runs full evaluation and returns all strategy results', () => {
      const candles = makeCandles(400);
      const wf = new WalkForwardEvaluator({
        epochs: 10,
        retrainInterval: 100,
        minTrainSamples: 50,
      });
      const result = wf.evaluate(candles);

      expect(result.error).toBeUndefined();
      expect(result.mlEnsemble).toBeDefined();
      expect(result.rulesOnlyEnsemble).toBeDefined();
      expect(result.bbConservative).toBeDefined();
      expect(result.momentum7d).toBeDefined();
      expect(result.comparison).toBeDefined();
    });

    it('returns Sharpe ratios for all strategies', () => {
      const candles = makeCandles(400);
      const wf = new WalkForwardEvaluator({ epochs: 10, minTrainSamples: 50 });
      const result = wf.evaluate(candles);

      for (const key of ['mlEnsemble', 'rulesOnlyEnsemble', 'bbConservative', 'momentum7d']) {
        expect(typeof result[key].sharpeRatio).toBe('number');
        expect(typeof result[key].totalReturn).toBe('number');
        expect(typeof result[key].maxDrawdown).toBe('number');
        expect(typeof result[key].totalTrades).toBe('number');
        expect(typeof result[key].winRate).toBe('number');
      }
    });

    it('comparison indicates ML vs baseline relationships', () => {
      const candles = makeCandles(400);
      const wf = new WalkForwardEvaluator({ epochs: 10, minTrainSamples: 50 });
      const result = wf.evaluate(candles);

      expect(typeof result.comparison.mlBeatsBB).toBe('boolean');
      expect(typeof result.comparison.mlBeatsMom).toBe('boolean');
      expect(typeof result.comparison.mlBeatsRules).toBe('boolean');
      expect(typeof result.comparison.mlEnsembleSharpe).toBe('number');
      expect(typeof result.comparison.bbConservativeSharpe).toBe('number');
    });

    it('includes HMM info when useHMM=true', () => {
      const candles = makeCandles(400);
      const wf = new WalkForwardEvaluator({ epochs: 10, minTrainSamples: 50, useHMM: true });
      const result = wf.evaluate(candles);

      expect(result.hmm).toBeDefined();
      expect(result.hmm.trained).toBe(true);
      expect(result.hmm.states).toEqual(['bull', 'bear', 'range_bound', 'high_vol']);
    });

    it('works without HMM (useHMM=false)', () => {
      const candles = makeCandles(400);
      const wf = new WalkForwardEvaluator({ epochs: 10, minTrainSamples: 50, useHMM: false });
      const result = wf.evaluate(candles);

      expect(result.hmm).toBeNull();
      expect(result.mlEnsemble).toBeDefined();
    });

    it('returns error on insufficient data', () => {
      const candles = makeCandles(50);
      const wf = new WalkForwardEvaluator();
      const result = wf.evaluate(candles);
      expect(result.error).toBeDefined();
    });

    it('ML ensemble trains models during walk-forward', () => {
      const candles = makeCandles(400);
      const wf = new WalkForwardEvaluator({
        epochs: 5,
        retrainInterval: 80,
        minTrainSamples: 50,
      });
      const result = wf.evaluate(candles);

      // trainCount should be > 0
      expect(result.mlEnsemble.trainCount).toBeGreaterThan(0);
    });
  });

  describe('strategy result format', () => {
    it('each strategy result has standard fields', () => {
      const candles = makeCandles(400);
      const wf = new WalkForwardEvaluator({ epochs: 5, minTrainSamples: 50 });
      const result = wf.evaluate(candles);

      const fields = ['name', 'totalReturn', 'sharpeRatio', 'maxDrawdown',
        'totalTrades', 'winRate', 'profitFactor', 'finalEquity'];
      for (const key of ['mlEnsemble', 'bbConservative', 'momentum7d']) {
        for (const field of fields) {
          expect(result[key]).toHaveProperty(field);
        }
      }
    });
  });
});

describe('Ensemble + HMM integration', () => {
  it('ensemble uses HMM regime when detector provided', () => {
    // Train HMM on some data
    const candles = makeCandles(300);
    const hmm = new GaussianHMM();
    const obs = GaussianHMM.extractObservations(candles);
    hmm.fit(obs);

    const closes = candles.map(c => c.close);
    const ensemble = new EnsembleStrategy({ hmmDetector: hmm });
    const signal = ensemble.generateSignal(closes, candles);

    expect(signal.hmmActive).toBe(true);
    expect(['bull', 'bear', 'range_bound', 'high_vol']).toContain(signal.regime);
  });

  it('ensemble falls back to vol-ratio when HMM not provided', () => {
    const candles = makeCandles(200);
    const closes = candles.map(c => c.close);
    const ensemble = new EnsembleStrategy();
    const signal = ensemble.generateSignal(closes);

    expect(signal.hmmActive).toBe(false);
    expect(signal.regime).toBeDefined();
  });

  it('ensemble with ML + HMM produces valid signals', () => {
    const candles = makeCandles(300);
    const hmm = new GaussianHMM();
    const obs = GaussianHMM.extractObservations(candles);
    hmm.fit(obs);

    // Quick-train a model
    const model = new NeuralNetwork();
    const trainData = Array.from({ length: 50 }, () => ({
      input: Array.from({ length: NUM_FEATURES }, () => Math.random()),
      output: [1, 0, 0],
    }));
    model.train(trainData, { epochs: 5 });

    const closes = candles.map(c => c.close);
    const windowCandles = candles.slice(-60);
    const ensemble = new EnsembleStrategy({
      mlModel: model,
      mlFeatureExtractor: extractFeatures,
      mlWeight: 0.3,
      hmmDetector: hmm,
    });
    const signal = ensemble.generateSignal(closes, windowCandles);

    expect(signal.mlActive).toBe(true);
    expect(signal.hmmActive).toBe(true);
    expect(signal.signal).toBeGreaterThanOrEqual(-1);
    expect(signal.signal).toBeLessThanOrEqual(1);
    expect(['BUY', 'SELL', 'HOLD']).toContain(signal.action);
  });
});

describe('generateRegimeData', () => {
  it('generates candles with regime labels', () => {
    const candles = generateRegimeData(50000, 200);
    expect(candles.length).toBeGreaterThan(190); // rounding
    expect(candles[0].regime).toBeDefined();
    expect(candles[0].close).toBeGreaterThan(0);
    expect(candles[0].volume).toBeGreaterThan(0);
  });

  it('has multiple regime transitions', () => {
    const candles = generateRegimeData(50000, 500);
    const regimes = [...new Set(candles.map(c => c.regime))];
    expect(regimes.length).toBeGreaterThanOrEqual(3);
  });
});

describe('runMultiSessionEvaluation', () => {
  it('runs multiple sessions and aggregates results', () => {
    const result = runMultiSessionEvaluation({
      sessions: 3,
      candlesPerSession: 400,
      config: { epochs: 5, minTrainSamples: 50 },
    });

    expect(result.error).toBeUndefined();
    expect(result.sessions).toBe(3);
    expect(result.aggregate).toBeDefined();
    expect(result.aggregate.mlEnsemble).toBeDefined();
    expect(result.aggregate.bbConservative).toBeDefined();
    expect(typeof result.mlBeatsBBRate).toBe('number');
  });

  it('per-session results track ML vs BB', () => {
    const result = runMultiSessionEvaluation({
      sessions: 2,
      candlesPerSession: 400,
      config: { epochs: 5, minTrainSamples: 50 },
    });

    expect(result.perSession.length).toBe(2);
    for (const s of result.perSession) {
      expect(typeof s.mlSharpe).toBe('number');
      expect(typeof s.bbSharpe).toBe('number');
      expect(typeof s.mlBeatsBB).toBe('boolean');
    }
  });
});
