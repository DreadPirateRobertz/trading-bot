// BTC-Neutral Residual Mean Reversion Strategy
// Per STRATEGY-V2: z-score entry at +/-2.0, exit at 0, stop at 3.5

export class MeanReversionStrategy {
  constructor({
    zScorePeriod = 20,
    entryZScore = 2.0,
    exitZScore = 0.5,
    stopZScore = 3.5,
    bbPeriod = 20,
    bbStdDev = 2,
  } = {}) {
    this.zScorePeriod = zScorePeriod;
    this.entryZScore = entryZScore;
    this.exitZScore = exitZScore;
    this.stopZScore = stopZScore;
    this.bbPeriod = bbPeriod;
    this.bbStdDev = bbStdDev;
  }

  // Compute z-score of current price relative to rolling mean
  computeZScore(closes) {
    if (closes.length < this.zScorePeriod) return null;
    const window = closes.slice(-this.zScorePeriod);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return 0;
    return (closes[closes.length - 1] - mean) / stdDev;
  }

  // Compute Bollinger Band %B position
  computePercentB(closes) {
    if (closes.length < this.bbPeriod) return null;
    const window = closes.slice(-this.bbPeriod);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
    const stdDev = Math.sqrt(variance);
    const upper = mean + this.bbStdDev * stdDev;
    const lower = mean - this.bbStdDev * stdDev;
    const range = upper - lower;
    if (range === 0) return 0.5;
    return (closes[closes.length - 1] - lower) / range;
  }

  // Estimate Hurst exponent (simplified R/S analysis)
  computeHurst(closes, maxLag = 20) {
    if (closes.length < maxLag * 2) return null;
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }

    const lags = [];
    const rsValues = [];
    for (let lag = 10; lag <= maxLag; lag += 2) {
      const chunks = Math.floor(returns.length / lag);
      if (chunks < 1) continue;
      let rsSum = 0;
      for (let c = 0; c < chunks; c++) {
        const chunk = returns.slice(c * lag, (c + 1) * lag);
        const mean = chunk.reduce((a, b) => a + b, 0) / chunk.length;
        const deviations = chunk.map(r => r - mean);
        const cumDev = [];
        let sum = 0;
        for (const d of deviations) { sum += d; cumDev.push(sum); }
        const range = Math.max(...cumDev) - Math.min(...cumDev);
        const stdDev = Math.sqrt(chunk.reduce((s, r) => s + (r - mean) ** 2, 0) / chunk.length);
        if (stdDev > 0) rsSum += range / stdDev;
      }
      lags.push(Math.log(lag));
      rsValues.push(Math.log(rsSum / chunks));
    }

    if (lags.length < 2) return 0.5;
    // Linear regression slope = Hurst exponent
    const n = lags.length;
    const sumX = lags.reduce((a, b) => a + b, 0);
    const sumY = rsValues.reduce((a, b) => a + b, 0);
    const sumXY = lags.reduce((s, x, i) => s + x * rsValues[i], 0);
    const sumX2 = lags.reduce((s, x) => s + x * x, 0);
    return (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  }

  generateSignal(closes) {
    if (closes.length < Math.max(this.zScorePeriod, this.bbPeriod) + 10) {
      return { signal: 0, confidence: 0, action: 'HOLD', reasons: ['Insufficient data'] };
    }

    const zScore = this.computeZScore(closes);
    const percentB = this.computePercentB(closes);
    const hurst = this.computeHurst(closes);

    const reasons = [];
    let signal = 0;

    // Hurst filter: prefer mean reversion if H < 0.5, but allow trades with reduced confidence if 0.5-0.6
    const isMeanReverting = hurst !== null && hurst < 0.5;
    const isBorderline = hurst !== null && hurst >= 0.5 && hurst < 0.6;
    const hurstPenalty = isMeanReverting ? 1.0 : isBorderline ? 0.5 : 0;
    if (!isMeanReverting && !isBorderline) {
      reasons.push(`Hurst ${hurst !== null ? hurst.toFixed(2) : 'N/A'} >= 0.6 — strongly trending, skip MR`);
      return { signal: 0, confidence: 0, action: 'HOLD', zScore, hurst, percentB, reasons };
    }

    // Z-score based entry
    if (zScore <= -this.entryZScore) {
      signal = 1;  // Price below mean — buy
      reasons.push(`Z-score ${zScore.toFixed(2)} <= -${this.entryZScore} — oversold, BUY`);
    } else if (zScore >= this.entryZScore) {
      signal = -1; // Price above mean — sell
      reasons.push(`Z-score ${zScore.toFixed(2)} >= ${this.entryZScore} — overbought, SELL`);
    } else if (Math.abs(zScore) <= this.exitZScore) {
      signal = 0;  // Near mean — close/hold
      reasons.push(`Z-score ${zScore.toFixed(2)} near mean — HOLD/EXIT`);
    } else {
      reasons.push(`Z-score ${zScore.toFixed(2)} in no-trade zone`);
    }

    // Stop-loss: z-score too extreme = mean reversion failing
    if (Math.abs(zScore) >= this.stopZScore) {
      signal = 0;
      reasons.push(`Z-score ${zScore.toFixed(2)} hit stop at ${this.stopZScore} — EXIT`);
    }

    // Bollinger %B confirmation
    if (percentB !== null) {
      if (percentB < 0 && signal > 0) reasons.push('Confirmed: below lower BB');
      if (percentB > 1 && signal < 0) reasons.push('Confirmed: above upper BB');
    }

    // Confidence: higher z-score = more confident (up to stop level), scaled by Hurst penalty
    const absZ = Math.abs(zScore);
    const rawConfidence = absZ >= this.entryZScore
      ? Math.min((absZ - this.entryZScore) / (this.stopZScore - this.entryZScore), 0.95)
      : absZ / this.entryZScore * 0.3;
    const confidence = rawConfidence * hurstPenalty;

    reasons.push(`Hurst: ${hurst.toFixed(2)} (${isMeanReverting ? 'mean-reverting' : 'borderline'}${isBorderline ? ', 50% penalty' : ''})`);

    return {
      signal,
      confidence: Math.round(confidence * 100) / 100,
      action: signal > 0 ? 'BUY' : signal < 0 ? 'SELL' : 'HOLD',
      zScore: Math.round(zScore * 100) / 100,
      hurst: hurst !== null ? Math.round(hurst * 100) / 100 : null,
      percentB: percentB !== null ? Math.round(percentB * 100) / 100 : null,
      reasons,
    };
  }
}
