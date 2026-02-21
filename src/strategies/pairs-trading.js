// Statistical Arbitrage / Cointegrated Pairs Trading Strategy
// Per STRATEGY-V2 Section 3: Engle-Granger cointegration, z-score entry/exit
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
}

function round(n) { return Math.round(n * 100) / 100; }
