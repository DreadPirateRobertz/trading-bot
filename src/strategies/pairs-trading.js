// Statistical Arbitrage / Cointegrated Pairs Trading Strategy
// Per STRATEGY-V2 Section 3: Engle-Granger + Johansen cointegration, z-score entry/exit
// tb-1hy: Kalman filter hedge ratio, pair universe scanning, Johansen test
// Pairs: BTC/ETH, SOL/AVAX, BTC/COIN (cross-market)
// Expected: Sharpe ~1.0, Win rate ~55%, market-neutral

export class PairsTradingStrategy {
  constructor({
    hedgeRatioLookback = 60,   // Rolling OLS window for hedge ratio
    zScorePeriod = 20,         // Z-score lookback on spread
    entryZScore = 2.0,         // Entry at +/- 2.0
    exitZScore = 0.5,          // Exit when spread returns near mean
    stopZScore = 3.5,          // Stop-loss: spread diverging further
    retestPeriod = 30,         // Cointegration re-test every N bars
    minDataPoints = 60,        // Minimum data for OLS regression
    adfMaxLag = null,          // ADF lag selection (null = auto)
    hurstMaxLag = 20,          // Hurst exponent R/S analysis max lag
  } = {}) {
    this.hedgeRatioLookback = hedgeRatioLookback;
    this.zScorePeriod = zScorePeriod;
    this.entryZScore = entryZScore;
    this.exitZScore = exitZScore;
    this.stopZScore = stopZScore;
    this.retestPeriod = retestPeriod;
    this.minDataPoints = minDataPoints;
    this.adfMaxLag = adfMaxLag;
    this.hurstMaxLag = hurstMaxLag;
  }

  // Ordinary Least Squares regression: y = alpha + beta * x
  // Returns { alpha, beta, residuals, rSquared }
  olsRegression(y, x) {
    const n = y.length;
    if (n !== x.length || n < 3) return null;

    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((s, xi, i) => s + xi * y[i], 0);
    const sumX2 = x.reduce((s, xi) => s + xi * xi, 0);

    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return null;

    const beta = (n * sumXY - sumX * sumY) / denom;
    const alpha = (sumY - beta * sumX) / n;

    const residuals = y.map((yi, i) => yi - alpha - beta * x[i]);

    // R-squared
    const meanY = sumY / n;
    const ssTotal = y.reduce((s, yi) => s + (yi - meanY) ** 2, 0);
    const ssResid = residuals.reduce((s, r) => s + r * r, 0);
    const rSquared = ssTotal > 0 ? 1 - ssResid / ssTotal : 0;

    return { alpha, beta, residuals, rSquared };
  }

  // Compute the spread: A - beta * B (using rolling OLS hedge ratio)
  computeSpread(closesA, closesB) {
    const n = Math.min(closesA.length, closesB.length);
    if (n < this.minDataPoints) return null;

    const a = closesA.slice(-n);
    const b = closesB.slice(-n);

    // Use rolling window for hedge ratio estimation
    const lookback = Math.min(this.hedgeRatioLookback, n);
    const recentA = a.slice(-lookback);
    const recentB = b.slice(-lookback);

    const ols = this.olsRegression(recentA, recentB);
    if (!ols) return null;

    // Compute full spread series using estimated hedge ratio
    const spread = a.map((ai, i) => ai - ols.beta * b[i] - ols.alpha);

    return { spread, hedgeRatio: ols.beta, intercept: ols.alpha, rSquared: ols.rSquared };
  }

  // Augmented Dickey-Fuller test (simplified)
  // Tests H0: unit root (non-stationary) vs H1: stationary
  // Returns { statistic, pValue, isStationary }
  adfTest(series) {
    const n = series.length;
    if (n < 20) return { statistic: 0, pValue: 1, isStationary: false };

    // Compute first differences and lagged levels
    const diffs = [];
    const lagged = [];
    for (let i = 1; i < n; i++) {
      diffs.push(series[i] - series[i - 1]);
      lagged.push(series[i - 1]);
    }

    // Regress diffs on lagged levels: dY_t = gamma * Y_{t-1} + epsilon
    // Include constant (demeaned regression)
    const m = diffs.length;
    const meanDiff = diffs.reduce((a, b) => a + b, 0) / m;
    const meanLag = lagged.reduce((a, b) => a + b, 0) / m;

    const sumXY = lagged.reduce((s, x, i) => s + (x - meanLag) * (diffs[i] - meanDiff), 0);
    const sumX2 = lagged.reduce((s, x) => s + (x - meanLag) ** 2, 0);

    if (sumX2 === 0) return { statistic: 0, pValue: 1, isStationary: false };

    const gamma = sumXY / sumX2;

    // Compute standard error of gamma
    const residuals = diffs.map((d, i) => d - meanDiff - gamma * (lagged[i] - meanLag));
    const sse = residuals.reduce((s, r) => s + r * r, 0);
    const se = Math.sqrt(sse / ((m - 2) * sumX2));

    if (se === 0) return { statistic: 0, pValue: 1, isStationary: false };

    const tStat = gamma / se;

    // ADF critical values (with constant, no trend)
    // Approximate p-value from MacKinnon critical values
    // n=100: 1%=-3.51, 5%=-2.89, 10%=-2.58
    let pValue;
    if (tStat <= -3.51) pValue = 0.01;
    else if (tStat <= -2.89) pValue = 0.05;
    else if (tStat <= -2.58) pValue = 0.10;
    else if (tStat <= -1.95) pValue = 0.30;
    else pValue = 0.50;

    return {
      statistic: Math.round(tStat * 100) / 100,
      pValue,
      isStationary: pValue <= 0.05,
    };
  }

  // Hurst exponent via R/S analysis on the spread
  computeHurst(series) {
    const maxLag = this.hurstMaxLag;
    if (series.length < maxLag * 2) return null;

    const returns = [];
    for (let i = 1; i < series.length; i++) {
      if (series[i - 1] === 0) returns.push(0);
      else returns.push((series[i] - series[i - 1]) / Math.abs(series[i - 1]));
    }

    const lags = [];
    const rsValues = [];
    for (let lag = 10; lag <= maxLag; lag += 2) {
      const chunks = Math.floor(returns.length / lag);
      if (chunks < 1) continue;
      let rsSum = 0;
      let validChunks = 0;
      for (let c = 0; c < chunks; c++) {
        const chunk = returns.slice(c * lag, (c + 1) * lag);
        const mean = chunk.reduce((a, b) => a + b, 0) / chunk.length;
        const deviations = chunk.map(r => r - mean);
        const cumDev = [];
        let sum = 0;
        for (const d of deviations) { sum += d; cumDev.push(sum); }
        const range = Math.max(...cumDev) - Math.min(...cumDev);
        const stdDev = Math.sqrt(chunk.reduce((s, r) => s + (r - mean) ** 2, 0) / chunk.length);
        if (stdDev > 0) { rsSum += range / stdDev; validChunks++; }
      }
      if (validChunks > 0) {
        lags.push(Math.log(lag));
        rsValues.push(Math.log(rsSum / validChunks));
      }
    }

    if (lags.length < 2) return 0.5;

    // Linear regression slope = Hurst exponent
    const n = lags.length;
    const sumX = lags.reduce((a, b) => a + b, 0);
    const sumY = rsValues.reduce((a, b) => a + b, 0);
    const sumXY = lags.reduce((s, x, i) => s + x * rsValues[i], 0);
    const sumX2 = lags.reduce((s, x) => s + x * x, 0);
    const denom = n * sumX2 - sumX * sumX;
    if (denom === 0) return 0.5;
    return (n * sumXY - sumX * sumY) / denom;
  }

  // Z-score of the spread
  computeSpreadZScore(spread) {
    if (spread.length < this.zScorePeriod) return null;
    const window = spread.slice(-this.zScorePeriod);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;
    return (spread[spread.length - 1] - mean) / stdDev;
  }

  // Half-life of mean reversion (from OU process estimation)
  // Shorter half-life = faster reversion = better for trading
  computeHalfLife(spread) {
    if (spread.length < 20) return null;
    const lagged = spread.slice(0, -1);
    const diffs = [];
    for (let i = 1; i < spread.length; i++) {
      diffs.push(spread[i] - spread[i - 1]);
    }

    // Regress diffs on lagged: dS = theta * S_{t-1} + epsilon
    const n = diffs.length;
    const sumXY = lagged.reduce((s, x, i) => s + x * diffs[i], 0);
    const sumX2 = lagged.reduce((s, x) => s + x * x, 0);
    if (sumX2 === 0) return null;
    const theta = sumXY / sumX2;

    // Half-life = -ln(2) / theta (theta should be negative for mean reversion)
    if (theta >= 0) return null; // Not mean-reverting
    return -Math.log(2) / theta;
  }

  // Full signal generation for a pair
  // closesA, closesB: parallel arrays of closing prices for assets A and B
  generateSignal(closesA, closesB) {
    if (!closesA || !closesB) {
      return { signal: 0, confidence: 0, action: 'HOLD', reasons: ['Missing price data'] };
    }

    const minLen = Math.min(closesA.length, closesB.length);
    if (minLen < this.minDataPoints) {
      return { signal: 0, confidence: 0, action: 'HOLD', reasons: ['Insufficient data'] };
    }

    // Align arrays to same length
    const a = closesA.slice(-minLen);
    const b = closesB.slice(-minLen);

    // Step 1: Compute spread via OLS hedge ratio
    const spreadResult = this.computeSpread(a, b);
    if (!spreadResult) {
      return { signal: 0, confidence: 0, action: 'HOLD', reasons: ['OLS regression failed'] };
    }

    const { spread, hedgeRatio, intercept, rSquared } = spreadResult;
    const reasons = [];

    // Step 2: ADF test for cointegration (stationarity of spread)
    const adf = this.adfTest(spread);
    if (!adf.isStationary) {
      reasons.push(`ADF stat=${adf.statistic}, p=${adf.pValue} — spread NOT stationary, skip`);
      return {
        signal: 0, confidence: 0, action: 'HOLD',
        hedgeRatio: round(hedgeRatio), rSquared: round(rSquared),
        adf, reasons,
      };
    }
    reasons.push(`ADF stat=${adf.statistic}, p=${adf.pValue} — spread IS stationary`);

    // Step 3: Hurst exponent on spread (confirm mean-reverting)
    const hurst = this.computeHurst(spread);
    const isMeanReverting = hurst !== null && hurst < 0.5;
    const isBorderline = hurst !== null && hurst >= 0.5 && hurst < 0.6;
    if (!isMeanReverting && !isBorderline) {
      reasons.push(`Hurst ${hurst !== null ? hurst.toFixed(2) : 'N/A'} >= 0.6 — spread trending, skip`);
      return {
        signal: 0, confidence: 0, action: 'HOLD',
        hedgeRatio: round(hedgeRatio), rSquared: round(rSquared),
        adf, hurst: hurst !== null ? round(hurst) : null, reasons,
      };
    }

    const hurstPenalty = isMeanReverting ? 1.0 : 0.5;

    // Step 4: Z-score of spread
    const zScore = this.computeSpreadZScore(spread);
    if (zScore === null) {
      reasons.push('Z-score computation failed');
      return { signal: 0, confidence: 0, action: 'HOLD', reasons };
    }

    // Step 5: Half-life estimation
    const halfLife = this.computeHalfLife(spread);

    // Step 6: Generate trading signal
    let signal = 0;

    // Stop-loss: z-score too extreme = cointegration may be breaking down
    if (Math.abs(zScore) >= this.stopZScore) {
      reasons.push(`Z-score ${zScore.toFixed(2)} hit stop at ${this.stopZScore} — EXIT`);
      return {
        signal: 0, confidence: 0, action: 'HOLD',
        zScore: round(zScore), hedgeRatio: round(hedgeRatio),
        rSquared: round(rSquared), adf, hurst: round(hurst),
        halfLife: halfLife !== null ? round(halfLife) : null,
        reasons,
      };
    }

    if (zScore <= -this.entryZScore) {
      signal = 1;  // Spread below mean — buy A, sell beta*B
      reasons.push(`Z-score ${zScore.toFixed(2)} <= -${this.entryZScore} — spread oversold, BUY spread`);
    } else if (zScore >= this.entryZScore) {
      signal = -1; // Spread above mean — sell A, buy beta*B
      reasons.push(`Z-score ${zScore.toFixed(2)} >= ${this.entryZScore} — spread overbought, SELL spread`);
    } else if (Math.abs(zScore) <= this.exitZScore) {
      signal = 0;
      reasons.push(`Z-score ${zScore.toFixed(2)} near mean — EXIT/HOLD`);
    } else {
      reasons.push(`Z-score ${zScore.toFixed(2)} in no-trade zone`);
    }

    // Confidence: scales with z-score magnitude and Hurst quality
    const absZ = Math.abs(zScore);
    const rawConfidence = absZ >= this.entryZScore
      ? Math.min((absZ - this.entryZScore) / (this.stopZScore - this.entryZScore), 0.95)
      : absZ / this.entryZScore * 0.3;
    const confidence = rawConfidence * hurstPenalty;

    // Bonus info
    reasons.push(`Hurst: ${hurst.toFixed(2)} (${isMeanReverting ? 'mean-reverting' : 'borderline'})`);
    reasons.push(`Hedge ratio: ${hedgeRatio.toFixed(4)}, R²: ${rSquared.toFixed(3)}`);
    if (halfLife !== null) reasons.push(`Half-life: ${halfLife.toFixed(1)} bars`);

    return {
      signal,
      confidence: Math.round(confidence * 100) / 100,
      action: signal > 0 ? 'BUY' : signal < 0 ? 'SELL' : 'HOLD',
      zScore: round(zScore),
      hedgeRatio: round(hedgeRatio),
      intercept: round(intercept),
      rSquared: round(rSquared),
      adf,
      hurst: round(hurst),
      halfLife: halfLife !== null ? round(halfLife) : null,
      spread: {
        current: round(spread[spread.length - 1]),
        mean: round(spread.slice(-this.zScorePeriod).reduce((a, b) => a + b, 0) / this.zScorePeriod),
      },
      reasons,
    };
  }

  // Compute position legs for execution
  // Returns the trades needed to enter/exit the spread position
  getPositionLegs(signal, hedgeRatio, priceA, priceB, notional) {
    if (signal === 0 || notional <= 0) return null;

    // Long spread = buy A, sell hedgeRatio * B
    // Short spread = sell A, buy hedgeRatio * B
    const qtyA = notional / (priceA + Math.abs(hedgeRatio) * priceB);
    const qtyB = qtyA * Math.abs(hedgeRatio);

    return {
      legA: {
        side: signal > 0 ? 'BUY' : 'SELL',
        qty: Math.round(qtyA * 1e8) / 1e8,
        price: priceA,
        notional: round(qtyA * priceA),
      },
      legB: {
        side: signal > 0 ? 'SELL' : 'BUY',
        qty: Math.round(qtyB * 1e8) / 1e8,
        price: priceB,
        notional: round(qtyB * priceB),
      },
      hedgeRatio: round(hedgeRatio),
      totalNotional: round(qtyA * priceA + qtyB * priceB),
    };
  }

  // Johansen cointegration test (2-variable case)
  // Tests for cointegrating relationships using trace and max-eigenvalue statistics
  // More robust than Engle-Granger for detecting cointegration
  // Returns { traceStats, maxEigenStats, eigenvalues, eigenvectors, rank, isCointegrated }
  johansenTest(seriesA, seriesB, { maxLags = 1 } = {}) {
    const n = Math.min(seriesA.length, seriesB.length);
    if (n < 40) return { rank: 0, isCointegrated: false, reason: 'Insufficient data' };

    const a = seriesA.slice(-n);
    const b = seriesB.slice(-n);
    const k = 2; // number of variables

    // Step 1: Compute first differences
    const dA = [], dB = [], lagA = [], lagB = [];
    for (let i = maxLags; i < n; i++) {
      dA.push(a[i] - a[i - 1]);
      dB.push(b[i] - b[i - 1]);
      lagA.push(a[i - 1]);
      lagB.push(b[i - 1]);
    }
    const T = dA.length;

    // Step 2: Regress dX and X_{t-1} on lagged differences (VAR residuals)
    // For simplicity with maxLags=1, regress on constant only (demean)
    const meanDA = dA.reduce((s, v) => s + v, 0) / T;
    const meanDB = dB.reduce((s, v) => s + v, 0) / T;
    const meanLA = lagA.reduce((s, v) => s + v, 0) / T;
    const meanLB = lagB.reduce((s, v) => s + v, 0) / T;

    // Residuals from demeaning
    const r0 = dA.map((v, i) => [v - meanDA, dB[i] - meanDB]); // residuals of dX on deterministic
    const r1 = lagA.map((v, i) => [v - meanLA, lagB[i] - meanLB]); // residuals of X_{t-1} on deterministic

    // Step 3: Compute moment matrices S00, S01, S10, S11
    const S00 = [[0, 0], [0, 0]];
    const S01 = [[0, 0], [0, 0]];
    const S11 = [[0, 0], [0, 0]];
    for (let t = 0; t < T; t++) {
      for (let i = 0; i < k; i++) {
        for (let j = 0; j < k; j++) {
          S00[i][j] += r0[t][i] * r0[t][j];
          S01[i][j] += r0[t][i] * r1[t][j];
          S11[i][j] += r1[t][i] * r1[t][j];
        }
      }
    }
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        S00[i][j] /= T;
        S01[i][j] /= T;
        S11[i][j] /= T;
      }
    }
    const S10 = [[S01[0][0], S01[1][0]], [S01[0][1], S01[1][1]]]; // transpose

    // Step 4: Solve generalized eigenvalue problem
    // |lambda * S11 - S10 * S00^{-1} * S01| = 0
    const detS00 = S00[0][0] * S00[1][1] - S00[0][1] * S00[1][0];
    if (Math.abs(detS00) < 1e-12) return { rank: 0, isCointegrated: false, reason: 'Singular S00 matrix' };

    const S00inv = [
      [S00[1][1] / detS00, -S00[0][1] / detS00],
      [-S00[1][0] / detS00, S00[0][0] / detS00],
    ];

    // M = S00^{-1} * S01
    const M01 = mat2x2Mul(S00inv, S01);
    // Product = S10 * M01
    const product = mat2x2Mul(S10, M01);

    // Solve det(S11) for generalized eigenvalues: S11^{-1} * product
    const detS11 = S11[0][0] * S11[1][1] - S11[0][1] * S11[1][0];
    if (Math.abs(detS11) < 1e-12) return { rank: 0, isCointegrated: false, reason: 'Singular S11 matrix' };

    const S11inv = [
      [S11[1][1] / detS11, -S11[0][1] / detS11],
      [-S11[1][0] / detS11, S11[0][0] / detS11],
    ];
    const A = mat2x2Mul(S11inv, product);

    // Eigenvalues of 2x2 matrix A
    const eigenvalues = eigenvalues2x2(A);
    if (!eigenvalues) return { rank: 0, isCointegrated: false, reason: 'Eigenvalue computation failed' };

    // Sort descending
    eigenvalues.sort((a, b) => b - a);

    // Clamp eigenvalues to [0, 1) for log computation
    const clampedEig = eigenvalues.map(e => Math.max(0, Math.min(e, 1 - 1e-10)));

    // Step 5: Trace and max-eigenvalue statistics
    const traceStats = [];
    const maxEigenStats = [];
    for (let r = 0; r < k; r++) {
      let traceStat = 0;
      for (let i = r; i < k; i++) {
        traceStat += -T * Math.log(1 - clampedEig[i]);
      }
      traceStats.push(round(traceStat));
      maxEigenStats.push(round(-T * Math.log(1 - clampedEig[r])));
    }

    // Step 6: Compare to critical values (5% significance, with constant, k=2)
    // Osterwald-Lenum (1992) critical values
    const traceCritical = [15.41, 3.76];    // r=0, r<=1
    const maxEigCritical = [14.07, 3.76];   // r=0, r<=1

    // Determine cointegration rank
    let rank = 0;
    if (traceStats[0] > traceCritical[0]) rank = 1;
    if (traceStats[1] > traceCritical[1]) rank = 2;

    // Compute eigenvectors for the cointegrating vector
    const eigenvectors = [];
    for (const lambda of eigenvalues) {
      const vec = eigenvector2x2(A, lambda);
      eigenvectors.push(vec);
    }

    return {
      traceStats,
      maxEigenStats,
      traceCritical,
      maxEigCritical,
      eigenvalues: eigenvalues.map(e => round(e)),
      eigenvectors,
      rank,
      isCointegrated: rank >= 1,
      cointegrationVector: rank >= 1 && eigenvectors[0] ? eigenvectors[0] : null,
    };
  }
}

// Kalman filter for dynamic hedge ratio estimation
// Tracks time-varying beta more responsively than rolling OLS
// State: beta_t (hedge ratio), Observation: y_t = beta_t * x_t + epsilon
export class KalmanHedgeRatio {
  constructor({
    delta = 1e-4,          // State transition variance (controls adaptation speed)
    ve = 1e-3,             // Observation noise variance
    initialBeta = 0,       // Initial hedge ratio estimate
    initialP = 1,          // Initial state covariance
  } = {}) {
    this.delta = delta;
    this.ve = ve;
    this.beta = initialBeta;
    this.P = initialP;       // State covariance (scalar for 1D state)
    this.history = [];       // Track beta over time
  }

  // Process one observation: y_t = beta_t * x_t + noise
  // Returns { beta, P, kalmanGain, prediction, error }
  update(y, x) {
    // Prediction step
    const betaPred = this.beta;
    const Ppred = this.P + this.delta;  // Q = delta (process noise)

    // Update step
    const innovation = y - betaPred * x;         // Prediction error
    const S = x * Ppred * x + this.ve;           // Innovation covariance
    const K = (Ppred * x) / S;                   // Kalman gain

    this.beta = betaPred + K * innovation;        // Updated state
    this.P = (1 - K * x) * Ppred;                // Updated covariance

    this.history.push(this.beta);

    return {
      beta: this.beta,
      P: this.P,
      kalmanGain: K,
      prediction: betaPred * x,
      error: innovation,
    };
  }

  // Run Kalman filter over full series, returns { betas, spread, finalBeta }
  filter(seriesY, seriesX) {
    const n = Math.min(seriesY.length, seriesX.length);
    if (n < 2) return null;

    // Reset state
    this.beta = 0;
    this.P = 1;
    this.history = [];

    const betas = [];
    const spread = [];
    const errors = [];

    for (let i = 0; i < n; i++) {
      const result = this.update(seriesY[i], seriesX[i]);
      betas.push(result.beta);
      spread.push(result.error); // Innovation = spread
      errors.push(result.error);
    }

    return {
      betas,
      spread,
      errors,
      finalBeta: this.beta,
      finalP: this.P,
    };
  }

  // Compute spread using Kalman-filtered hedge ratio
  // Better than OLS: adapts to regime changes and structural breaks
  computeSpread(closesA, closesB) {
    const result = this.filter(closesA, closesB);
    if (!result) return null;

    return {
      spread: result.spread,
      hedgeRatio: result.finalBeta,
      betas: result.betas,
      intercept: 0, // Kalman models y = beta*x, no intercept
      rSquared: null, // Not meaningful for Kalman
    };
  }
}

// Pair Universe Scanner
// Tests all pairs in a universe for cointegration and ranks by tradability
export class PairScanner {
  constructor({
    minCorrelation = 0.5,      // Minimum correlation to consider
    maxHalfLife = 30,          // Maximum half-life in bars
    minHalfLife = 1,           // Minimum half-life (too fast = noise)
    adfSignificance = 0.05,   // ADF p-value threshold
    minDataPoints = 60,
  } = {}) {
    this.minCorrelation = minCorrelation;
    this.maxHalfLife = maxHalfLife;
    this.minHalfLife = minHalfLife;
    this.adfSignificance = adfSignificance;
    this.minDataPoints = minDataPoints;
    this.strategy = new PairsTradingStrategy({ minDataPoints });
  }

  // Compute Pearson correlation between two series
  correlation(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 3) return 0;
    const x = a.slice(-n);
    const y = b.slice(-n);
    const meanX = x.reduce((s, v) => s + v, 0) / n;
    const meanY = y.reduce((s, v) => s + v, 0) / n;
    let cov = 0, varX = 0, varY = 0;
    for (let i = 0; i < n; i++) {
      const dx = x[i] - meanX;
      const dy = y[i] - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }
    const denom = Math.sqrt(varX * varY);
    return denom > 0 ? cov / denom : 0;
  }

  // Scan a universe of assets and return ranked pairs
  // universe: { [symbol]: number[] } — map of symbol to closing prices
  // Returns sorted array of { pairA, pairB, score, metrics }
  scan(universe) {
    const symbols = Object.keys(universe);
    if (symbols.length < 2) return [];

    const candidates = [];

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const symA = symbols[i];
        const symB = symbols[j];
        const closesA = universe[symA];
        const closesB = universe[symB];

        const minLen = Math.min(closesA.length, closesB.length);
        if (minLen < this.minDataPoints) continue;

        const a = closesA.slice(-minLen);
        const b = closesB.slice(-minLen);

        // Step 1: Correlation pre-filter (fast)
        const corr = this.correlation(a, b);
        if (Math.abs(corr) < this.minCorrelation) continue;

        // Step 2: Compute spread and test stationarity
        const spreadResult = this.strategy.computeSpread(a, b);
        if (!spreadResult) continue;

        const { spread, hedgeRatio, rSquared } = spreadResult;

        // Step 3: ADF test
        const adf = this.strategy.adfTest(spread);
        if (adf.pValue > this.adfSignificance) continue;

        // Step 4: Hurst exponent
        const hurst = this.strategy.computeHurst(spread);
        if (hurst === null || hurst >= 0.6) continue;

        // Step 5: Half-life
        const halfLife = this.strategy.computeHalfLife(spread);
        if (halfLife === null || halfLife < this.minHalfLife || halfLife > this.maxHalfLife) continue;

        // Step 6: Johansen test (additional confirmation)
        const johansen = this.strategy.johansenTest(a, b);

        // Score: composite of cointegration strength
        // Lower ADF p-value = better, lower Hurst = better, moderate half-life = better
        const adfScore = (0.05 - adf.pValue) / 0.05;      // 0-1, higher = stronger
        const hurstScore = Math.max(0, (0.5 - hurst) * 2); // 0-1, more mean-reverting = higher
        const halfLifeScore = 1 - Math.abs(halfLife - 10) / this.maxHalfLife; // peak at ~10 bars
        const johansenBonus = johansen.isCointegrated ? 0.2 : 0;

        const score = round(
          0.35 * adfScore +
          0.25 * hurstScore +
          0.20 * Math.max(0, halfLifeScore) +
          johansenBonus
        );

        candidates.push({
          pairA: symA,
          pairB: symB,
          score,
          metrics: {
            correlation: round(corr),
            adfStatistic: adf.statistic,
            adfPValue: adf.pValue,
            hurst: round(hurst),
            halfLife: round(halfLife),
            hedgeRatio: round(hedgeRatio),
            rSquared: round(rSquared),
            johansenCointegrated: johansen.isCointegrated,
            johansenRank: johansen.rank,
          },
        });
      }
    }

    // Sort by composite score descending
    candidates.sort((a, b) => b.score - a.score);
    return candidates;
  }
}

// --- Linear algebra helpers for 2x2 matrices ---

function mat2x2Mul(A, B) {
  return [
    [A[0][0] * B[0][0] + A[0][1] * B[1][0], A[0][0] * B[0][1] + A[0][1] * B[1][1]],
    [A[1][0] * B[0][0] + A[1][1] * B[1][0], A[1][0] * B[0][1] + A[1][1] * B[1][1]],
  ];
}

// Eigenvalues of 2x2 matrix via quadratic formula
function eigenvalues2x2(A) {
  const trace = A[0][0] + A[1][1];
  const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
  const discriminant = trace * trace - 4 * det;
  if (discriminant < -1e-10) return null; // Complex eigenvalues
  const sqrtDisc = Math.sqrt(Math.max(0, discriminant));
  return [(trace + sqrtDisc) / 2, (trace - sqrtDisc) / 2];
}

// Eigenvector for 2x2 matrix given eigenvalue
function eigenvector2x2(A, lambda) {
  // (A - lambda*I) * v = 0
  const a = A[0][0] - lambda;
  const b = A[0][1];
  if (Math.abs(b) > 1e-10) {
    const norm = Math.sqrt(1 + (a / b) ** 2);
    return [round(1 / norm), round(-a / (b * norm))];
  }
  const c = A[1][0];
  if (Math.abs(c) > 1e-10) {
    const d = A[1][1] - lambda;
    const norm = Math.sqrt(1 + (d / c) ** 2);
    return [round(1 / norm), round(-d / (c * norm))];
  }
  return [1, 0]; // Default if degenerate
}

function round(n) { return Math.round(n * 100) / 100; }
