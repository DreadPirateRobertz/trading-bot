// Hidden Markov Model — Gaussian Emission Regime Detector
// Pure JavaScript implementation, zero dependencies
// States: bull, bear, range_bound, high_vol (configurable)
// Observations: [return, volatility, volume_ratio] per time step
//
// Training: Baum-Welch (EM) algorithm
// Decoding: Viterbi algorithm
// Online: Forward algorithm for current state probability

export const DEFAULT_STATES = ['bull', 'bear', 'range_bound', 'high_vol'];

export class GaussianHMM {
  constructor({
    states = DEFAULT_STATES,
    obsDim = 3,
    maxIter = 50,
    tolerance = 1e-4,
  } = {}) {
    this.states = states;
    this.N = states.length;
    this.obsDim = obsDim;
    this.maxIter = maxIter;
    this.tolerance = tolerance;
    this.trained = false;

    // Initial state distribution (uniform)
    this.pi = Array(this.N).fill(1 / this.N);

    // Transition matrix A[i][j] = P(state_j | state_i)
    // Initialize with self-transition bias (regimes persist)
    this.A = Array.from({ length: this.N }, (_, i) =>
      Array.from({ length: this.N }, (_, j) =>
        i === j ? 0.7 : 0.3 / (this.N - 1)
      )
    );

    // Emission parameters: Gaussian(mean, variance) per state per dimension
    this.means = Array.from({ length: this.N }, () => Array(obsDim).fill(0));
    this.variances = Array.from({ length: this.N }, () => Array(obsDim).fill(1));

    this._initEmissionPriors();
  }

  // Set reasonable initial emission params based on state semantics
  _initEmissionPriors() {
    const stateMap = {
      bull:        { mean: [0.005, 0.015, 1.0], var: [0.0001, 0.0001, 0.1] },
      bear:        { mean: [-0.005, 0.025, 1.2], var: [0.0001, 0.0001, 0.15] },
      range_bound: { mean: [0.0, 0.01, 0.8], var: [0.00005, 0.00005, 0.08] },
      high_vol:    { mean: [0.0, 0.04, 1.5], var: [0.0005, 0.0003, 0.3] },
    };
    for (let i = 0; i < this.N; i++) {
      const preset = stateMap[this.states[i]];
      if (preset) {
        this.means[i] = [...preset.mean];
        this.variances[i] = [...preset.var];
      }
    }
  }

  // Gaussian log-probability for diagonal covariance
  _logGauss(obs, mean, variance) {
    let logp = 0;
    for (let d = 0; d < this.obsDim; d++) {
      const v = Math.max(variance[d], 1e-10);
      const diff = obs[d] - mean[d];
      logp += -0.5 * Math.log(2 * Math.PI * v) - (diff * diff) / (2 * v);
    }
    return logp;
  }

  // Log-sum-exp for numerical stability
  _logSumExp(logValues) {
    const maxVal = Math.max(...logValues);
    if (maxVal === -Infinity) return -Infinity;
    let sum = 0;
    for (const v of logValues) sum += Math.exp(v - maxVal);
    return maxVal + Math.log(sum);
  }

  // Forward algorithm (log-space)
  // Returns { logAlpha, logLikelihood }
  _forward(observations) {
    const T = observations.length;
    const logAlpha = Array.from({ length: T }, () => Array(this.N).fill(0));

    // t=0
    for (let j = 0; j < this.N; j++) {
      logAlpha[0][j] = Math.log(Math.max(this.pi[j], 1e-300)) +
        this._logGauss(observations[0], this.means[j], this.variances[j]);
    }

    // t=1..T-1
    for (let t = 1; t < T; t++) {
      for (let j = 0; j < this.N; j++) {
        const logTerms = [];
        for (let i = 0; i < this.N; i++) {
          logTerms.push(logAlpha[t - 1][i] + Math.log(Math.max(this.A[i][j], 1e-300)));
        }
        logAlpha[t][j] = this._logSumExp(logTerms) +
          this._logGauss(observations[t], this.means[j], this.variances[j]);
      }
    }

    const logLikelihood = this._logSumExp(logAlpha[T - 1]);
    return { logAlpha, logLikelihood };
  }

  // Backward algorithm (log-space)
  _backward(observations) {
    const T = observations.length;
    const logBeta = Array.from({ length: T }, () => Array(this.N).fill(0));

    // t=T-1: log(1) = 0
    for (let j = 0; j < this.N; j++) logBeta[T - 1][j] = 0;

    // t=T-2..0
    for (let t = T - 2; t >= 0; t--) {
      for (let i = 0; i < this.N; i++) {
        const logTerms = [];
        for (let j = 0; j < this.N; j++) {
          logTerms.push(
            Math.log(Math.max(this.A[i][j], 1e-300)) +
            this._logGauss(observations[t + 1], this.means[j], this.variances[j]) +
            logBeta[t + 1][j]
          );
        }
        logBeta[t][i] = this._logSumExp(logTerms);
      }
    }

    return logBeta;
  }

  // Baum-Welch EM training
  fit(observations) {
    if (observations.length < 10) return { error: 'Need at least 10 observations' };

    const T = observations.length;
    let prevLL = -Infinity;

    for (let iter = 0; iter < this.maxIter; iter++) {
      // E-step
      const { logAlpha, logLikelihood } = this._forward(observations);
      const logBeta = this._backward(observations);

      if (!isFinite(logLikelihood)) break;

      // Check convergence
      if (Math.abs(logLikelihood - prevLL) < this.tolerance && iter > 2) break;
      prevLL = logLikelihood;

      // Compute gamma[t][i] = P(state_i at time t | observations)
      const gamma = Array.from({ length: T }, () => Array(this.N).fill(0));
      for (let t = 0; t < T; t++) {
        const logTerms = [];
        for (let i = 0; i < this.N; i++) {
          logTerms.push(logAlpha[t][i] + logBeta[t][i]);
        }
        const logDenom = this._logSumExp(logTerms);
        for (let i = 0; i < this.N; i++) {
          gamma[t][i] = Math.exp(logAlpha[t][i] + logBeta[t][i] - logDenom);
        }
      }

      // Compute xi[t][i][j] = P(state_i at t, state_j at t+1 | observations)
      const xi = Array.from({ length: T - 1 }, () =>
        Array.from({ length: this.N }, () => Array(this.N).fill(0))
      );
      for (let t = 0; t < T - 1; t++) {
        const logTerms = [];
        for (let i = 0; i < this.N; i++) {
          for (let j = 0; j < this.N; j++) {
            logTerms.push(
              logAlpha[t][i] +
              Math.log(Math.max(this.A[i][j], 1e-300)) +
              this._logGauss(observations[t + 1], this.means[j], this.variances[j]) +
              logBeta[t + 1][j]
            );
          }
        }
        const logDenom = this._logSumExp(logTerms);
        let idx = 0;
        for (let i = 0; i < this.N; i++) {
          for (let j = 0; j < this.N; j++) {
            xi[t][i][j] = Math.exp(logTerms[idx] - logDenom);
            idx++;
          }
        }
      }

      // M-step: re-estimate parameters
      // Initial distribution
      for (let i = 0; i < this.N; i++) {
        this.pi[i] = Math.max(gamma[0][i], 1e-10);
      }
      normalizeDist(this.pi);

      // Transition matrix
      for (let i = 0; i < this.N; i++) {
        let gammaSum = 0;
        for (let t = 0; t < T - 1; t++) gammaSum += gamma[t][i];
        for (let j = 0; j < this.N; j++) {
          let xiSum = 0;
          for (let t = 0; t < T - 1; t++) xiSum += xi[t][i][j];
          this.A[i][j] = gammaSum > 1e-10 ? xiSum / gammaSum : 1 / this.N;
        }
        normalizeDist(this.A[i]);
      }

      // Emission means and variances
      for (let j = 0; j < this.N; j++) {
        let gammaSum = 0;
        for (let t = 0; t < T; t++) gammaSum += gamma[t][j];

        for (let d = 0; d < this.obsDim; d++) {
          let weightedSum = 0;
          for (let t = 0; t < T; t++) {
            weightedSum += gamma[t][j] * observations[t][d];
          }
          this.means[j][d] = gammaSum > 1e-10 ? weightedSum / gammaSum : 0;

          let weightedVarSum = 0;
          for (let t = 0; t < T; t++) {
            const diff = observations[t][d] - this.means[j][d];
            weightedVarSum += gamma[t][j] * diff * diff;
          }
          this.variances[j][d] = Math.max(
            gammaSum > 1e-10 ? weightedVarSum / gammaSum : 0.001,
            1e-6 // variance floor
          );
        }
      }
    }

    this.trained = true;
    return { logLikelihood: prevLL };
  }

  // Viterbi algorithm: most likely state sequence
  decode(observations) {
    const T = observations.length;
    const delta = Array.from({ length: T }, () => Array(this.N).fill(0));
    const psi = Array.from({ length: T }, () => Array(this.N).fill(0));

    // t=0
    for (let j = 0; j < this.N; j++) {
      delta[0][j] = Math.log(Math.max(this.pi[j], 1e-300)) +
        this._logGauss(observations[0], this.means[j], this.variances[j]);
    }

    // Forward pass
    for (let t = 1; t < T; t++) {
      for (let j = 0; j < this.N; j++) {
        let bestVal = -Infinity;
        let bestIdx = 0;
        for (let i = 0; i < this.N; i++) {
          const val = delta[t - 1][i] + Math.log(Math.max(this.A[i][j], 1e-300));
          if (val > bestVal) {
            bestVal = val;
            bestIdx = i;
          }
        }
        delta[t][j] = bestVal + this._logGauss(observations[t], this.means[j], this.variances[j]);
        psi[t][j] = bestIdx;
      }
    }

    // Backtrack
    const stateSeq = Array(T);
    let bestLast = 0;
    let bestVal = delta[T - 1][0];
    for (let j = 1; j < this.N; j++) {
      if (delta[T - 1][j] > bestVal) {
        bestVal = delta[T - 1][j];
        bestLast = j;
      }
    }
    stateSeq[T - 1] = bestLast;
    for (let t = T - 2; t >= 0; t--) {
      stateSeq[t] = psi[t + 1][stateSeq[t + 1]];
    }

    return stateSeq.map(s => this.states[s]);
  }

  // Current regime: P(state | all observations up to now)
  // Returns { regime, probabilities, allRegimes }
  currentRegime(observations) {
    if (observations.length < 1) return { regime: 'unknown', probabilities: {} };

    const { logAlpha } = this._forward(observations);
    const lastAlpha = logAlpha[logAlpha.length - 1];
    const logDenom = this._logSumExp(lastAlpha);

    const probabilities = {};
    let maxProb = 0;
    let maxState = 0;
    for (let i = 0; i < this.N; i++) {
      const prob = Math.exp(lastAlpha[i] - logDenom);
      probabilities[this.states[i]] = Math.round(prob * 1000) / 1000;
      if (prob > maxProb) {
        maxProb = prob;
        maxState = i;
      }
    }

    return {
      regime: this.states[maxState],
      confidence: Math.round(maxProb * 100) / 100,
      probabilities,
    };
  }

  // Extract observations from OHLCV candles for HMM input
  // Returns array of [return, realized_vol, volume_ratio]
  static extractObservations(candles, { volWindow = 20 } = {}) {
    const obs = [];
    for (let i = volWindow; i < candles.length; i++) {
      // Daily return
      const ret = (candles[i].close - candles[i - 1].close) / candles[i - 1].close;

      // Realized volatility over window
      const returns = [];
      for (let j = i - volWindow + 1; j <= i; j++) {
        returns.push((candles[j].close - candles[j - 1].close) / candles[j - 1].close);
      }
      const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
      const vol = Math.sqrt(returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length);

      // Volume ratio
      const volumes = candles.slice(i - volWindow, i).map(c => c.volume);
      const avgVol = volumes.reduce((a, b) => a + b, 0) / volumes.length;
      const volRatio = avgVol > 0 ? candles[i].volume / avgVol : 1;

      obs.push([ret, vol, volRatio]);
    }
    return obs;
  }

  // Serialize/deserialize
  toJSON() {
    return {
      states: this.states,
      obsDim: this.obsDim,
      pi: this.pi,
      A: this.A,
      means: this.means,
      variances: this.variances,
      trained: this.trained,
    };
  }

  static fromJSON(json) {
    const hmm = new GaussianHMM({
      states: json.states,
      obsDim: json.obsDim,
    });
    hmm.pi = json.pi;
    hmm.A = json.A;
    hmm.means = json.means;
    hmm.variances = json.variances;
    hmm.trained = json.trained;
    return hmm;
  }
}

function normalizeDist(arr) {
  const sum = arr.reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (let i = 0; i < arr.length; i++) arr[i] /= sum;
  }
}
