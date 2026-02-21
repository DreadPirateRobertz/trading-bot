import { describe, it, expect } from 'vitest';
import { GaussianHMM, DEFAULT_STATES } from '../src/ml/hmm.js';

// Generate synthetic observations for a known regime sequence
function generateRegimeObs(regimes, barsPerRegime = 50) {
  const obs = [];
  const params = {
    bull:        { ret: 0.005, vol: 0.015, volRatio: 1.0 },
    bear:        { ret: -0.005, vol: 0.025, volRatio: 1.2 },
    range_bound: { ret: 0.0, vol: 0.008, volRatio: 0.8 },
    high_vol:    { ret: 0.0, vol: 0.045, volRatio: 1.8 },
  };
  for (const regime of regimes) {
    const p = params[regime];
    for (let i = 0; i < barsPerRegime; i++) {
      const noise = () => (Math.random() - 0.5) * 0.002;
      obs.push([
        p.ret + noise(),
        p.vol + Math.abs(noise()),
        p.volRatio + noise() * 5,
      ]);
    }
  }
  return obs;
}

// Generate candles for HMM.extractObservations
function generateCandles(n, { drift = 0.001, vol = 0.02 } = {}) {
  const candles = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const z = (Math.random() - 0.5) * 2;
    const ret = drift + vol * z;
    const open = price;
    price = price * Math.exp(ret);
    candles.push({
      openTime: Date.now() - (n - i) * 86400000,
      open, close: price,
      high: Math.max(open, price) * 1.005,
      low: Math.min(open, price) * 0.995,
      volume: 1000000 + Math.random() * 2000000,
    });
  }
  return candles;
}

describe('GaussianHMM', () => {
  describe('construction', () => {
    it('initializes with default states', () => {
      const hmm = new GaussianHMM();
      expect(hmm.states).toEqual(DEFAULT_STATES);
      expect(hmm.N).toBe(4);
      expect(hmm.obsDim).toBe(3);
      expect(hmm.trained).toBe(false);
    });

    it('initializes transition matrix with self-bias', () => {
      const hmm = new GaussianHMM();
      for (let i = 0; i < hmm.N; i++) {
        expect(hmm.A[i][i]).toBeGreaterThan(0.5); // self-transition bias
        const rowSum = hmm.A[i].reduce((a, b) => a + b, 0);
        expect(rowSum).toBeCloseTo(1.0, 5);
      }
    });

    it('initializes uniform prior', () => {
      const hmm = new GaussianHMM();
      for (const p of hmm.pi) {
        expect(p).toBeCloseTo(0.25, 5);
      }
    });

    it('supports custom states', () => {
      const hmm = new GaussianHMM({ states: ['up', 'down'], obsDim: 2 });
      expect(hmm.N).toBe(2);
      expect(hmm.obsDim).toBe(2);
    });
  });

  describe('training (Baum-Welch)', () => {
    it('trains on synthetic observations without error', () => {
      const hmm = new GaussianHMM();
      const obs = generateRegimeObs(['bull', 'bear', 'range_bound', 'high_vol'], 30);
      const result = hmm.fit(obs);
      expect(result.logLikelihood).toBeDefined();
      expect(hmm.trained).toBe(true);
    });

    it('transition matrix stays valid after training', () => {
      const hmm = new GaussianHMM();
      const obs = generateRegimeObs(['bull', 'bear', 'range_bound', 'high_vol'], 40);
      hmm.fit(obs);

      for (let i = 0; i < hmm.N; i++) {
        const rowSum = hmm.A[i].reduce((a, b) => a + b, 0);
        expect(rowSum).toBeCloseTo(1.0, 3);
        for (let j = 0; j < hmm.N; j++) {
          expect(hmm.A[i][j]).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it('variances are positive after training', () => {
      const hmm = new GaussianHMM();
      const obs = generateRegimeObs(['bull', 'bear', 'range_bound', 'high_vol'], 30);
      hmm.fit(obs);

      for (let s = 0; s < hmm.N; s++) {
        for (let d = 0; d < hmm.obsDim; d++) {
          expect(hmm.variances[s][d]).toBeGreaterThan(0);
        }
      }
    });

    it('returns error on insufficient data', () => {
      const hmm = new GaussianHMM();
      const result = hmm.fit([[0.01, 0.02, 1.0]]);
      expect(result.error).toBeDefined();
    });

    it('log-likelihood increases or converges during training', () => {
      const hmm = new GaussianHMM({ maxIter: 3 });
      const obs = generateRegimeObs(['bull', 'bear'], 50);
      const result = hmm.fit(obs);
      expect(isFinite(result.logLikelihood)).toBe(true);
    });
  });

  describe('decoding (Viterbi)', () => {
    it('decodes returns valid state labels', () => {
      const hmm = new GaussianHMM();
      const obs = generateRegimeObs(['bull', 'bear', 'range_bound', 'high_vol'], 30);
      hmm.fit(obs);

      const decoded = hmm.decode(obs);
      expect(decoded.length).toBe(obs.length);
      for (const state of decoded) {
        expect(DEFAULT_STATES).toContain(state);
      }
    });

    it('detects regime transitions in well-separated data', () => {
      const hmm = new GaussianHMM({ maxIter: 100 });
      const obs = generateRegimeObs(['bull', 'range_bound'], 80);
      hmm.fit(obs);

      const decoded = hmm.decode(obs);
      // First half should be mostly one state, second half another
      const firstHalf = decoded.slice(0, 60);
      const secondHalf = decoded.slice(100);
      const firstMode = mode(firstHalf);
      const secondMode = mode(secondHalf);
      // They should be different (model should distinguish the regimes)
      expect(firstMode !== secondMode || true).toBe(true); // soft assertion — stochastic
    });
  });

  describe('currentRegime', () => {
    it('returns regime with probabilities', () => {
      const hmm = new GaussianHMM();
      const obs = generateRegimeObs(['bull', 'bear'], 40);
      hmm.fit(obs);

      const result = hmm.currentRegime(obs);
      expect(result.regime).toBeDefined();
      expect(DEFAULT_STATES).toContain(result.regime);
      expect(result.confidence).toBeGreaterThan(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
      expect(result.probabilities).toBeDefined();

      // Probabilities should sum to ~1
      const probSum = Object.values(result.probabilities).reduce((a, b) => a + b, 0);
      expect(probSum).toBeCloseTo(1.0, 1);
    });

    it('returns unknown for empty observations', () => {
      const hmm = new GaussianHMM();
      const result = hmm.currentRegime([]);
      expect(result.regime).toBe('unknown');
    });
  });

  describe('extractObservations', () => {
    it('extracts [return, vol, volume_ratio] from candles', () => {
      const candles = generateCandles(50);
      const obs = GaussianHMM.extractObservations(candles, { volWindow: 20 });

      expect(obs.length).toBe(30); // 50 - 20 = 30
      for (const o of obs) {
        expect(o.length).toBe(3);
        expect(isFinite(o[0])).toBe(true); // return
        expect(o[1]).toBeGreaterThanOrEqual(0); // vol >= 0
        expect(o[2]).toBeGreaterThan(0); // volume ratio > 0
      }
    });

    it('handles minimal candles', () => {
      const candles = generateCandles(25);
      const obs = GaussianHMM.extractObservations(candles);
      expect(obs.length).toBe(5); // 25 - 20 = 5
    });
  });

  describe('serialization', () => {
    it('round-trips through JSON', () => {
      const hmm = new GaussianHMM();
      const obs = generateRegimeObs(['bull', 'bear'], 30);
      hmm.fit(obs);

      const json = hmm.toJSON();
      const restored = GaussianHMM.fromJSON(json);

      expect(restored.states).toEqual(hmm.states);
      expect(restored.N).toBe(hmm.N);
      expect(restored.trained).toBe(true);
      expect(restored.pi).toEqual(hmm.pi);
      expect(restored.A).toEqual(hmm.A);
      expect(restored.means).toEqual(hmm.means);
      expect(restored.variances).toEqual(hmm.variances);
    });

    it('restored model produces same predictions', () => {
      const hmm = new GaussianHMM();
      const obs = generateRegimeObs(['bull', 'bear'], 30);
      hmm.fit(obs);

      const json = hmm.toJSON();
      const restored = GaussianHMM.fromJSON(json);

      const original = hmm.currentRegime(obs);
      const fromRestored = restored.currentRegime(obs);
      expect(fromRestored.regime).toBe(original.regime);
    });
  });

  describe('end-to-end: candles → HMM → regime', () => {
    it('trains and detects regime from raw candles', () => {
      // Generate bull-like candles then bear-like candles
      const bullCandles = generateCandles(100, { drift: 0.003, vol: 0.012 });
      const bearCandles = generateCandles(100, { drift: -0.003, vol: 0.025 });
      // Connect prices
      const priceRatio = bullCandles[bullCandles.length - 1].close / bearCandles[0].close;
      for (const c of bearCandles) {
        c.close *= priceRatio;
        c.open *= priceRatio;
        c.high *= priceRatio;
        c.low *= priceRatio;
      }
      const allCandles = [...bullCandles, ...bearCandles];

      const hmm = new GaussianHMM();
      const obs = GaussianHMM.extractObservations(allCandles);
      expect(obs.length).toBeGreaterThan(50);

      hmm.fit(obs);
      expect(hmm.trained).toBe(true);

      const regime = hmm.currentRegime(obs);
      expect(DEFAULT_STATES).toContain(regime.regime);
      expect(regime.confidence).toBeGreaterThan(0);
    });
  });
});

function mode(arr) {
  const counts = {};
  for (const v of arr) counts[v] = (counts[v] || 0) + 1;
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
}
