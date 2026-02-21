// Ensemble Strategy Engine
// Per STRATEGY-V2: Regime-dependent weighted combination of strategy signals
// 50/50 momentum + mean reversion blend = Sharpe 1.71 target

import { MomentumStrategy } from './momentum.js';
import { MeanReversionStrategy } from './mean-reversion.js';

export class EnsembleStrategy {
  constructor({
    momentumConfig,
    meanReversionConfig,
    // Default to equal weight (the 50/50 blend from research)
    weights = { momentum: 0.5, meanReversion: 0.5 },
  } = {}) {
    this.momentum = new MomentumStrategy(momentumConfig);
    this.meanReversion = new MeanReversionStrategy(meanReversionConfig);
    this.weights = weights;
  }

  // Simple volatility regime detection (placeholder for full HMM)
  detectRegime(closes) {
    if (closes.length < 60) return 'unknown';

    // Compute 20-day and 60-day realized vol
    const recentReturns = [];
    for (let i = closes.length - 20; i < closes.length; i++) {
      recentReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const longReturns = [];
    for (let i = closes.length - 60; i < closes.length; i++) {
      longReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    const recentVol = std(recentReturns);
    const longVol = std(longReturns);
    const volRatio = recentVol / (longVol || 1);

    // Trend strength: 30d return magnitude
    const ret30 = (closes[closes.length - 1] - closes[closes.length - 31]) / closes[closes.length - 31];
    const absRet = Math.abs(ret30);

    if (volRatio > 1.5 && absRet > 0.15) return 'high_vol_trending';
    if (volRatio < 0.8 && absRet < 0.05) return 'low_vol_range';
    if (absRet > 0.10) return 'trending';
    return 'range_bound';
  }

  // Adjust weights based on detected regime
  getRegimeWeights(regime) {
    switch (regime) {
      case 'trending':
      case 'high_vol_trending':
        return { momentum: 0.7, meanReversion: 0.3 };
      case 'range_bound':
      case 'low_vol_range':
        return { momentum: 0.3, meanReversion: 0.7 };
      default:
        return this.weights; // 50/50 default
    }
  }

  generateSignal(closes) {
    const momSignal = this.momentum.generateSignal(closes);
    const mrSignal = this.meanReversion.generateSignal(closes);
    const regime = this.detectRegime(closes);
    const weights = this.getRegimeWeights(regime);

    // Weighted combination
    const combinedSignal = weights.momentum * momSignal.signal + weights.meanReversion * mrSignal.signal;
    const combinedConfidence = weights.momentum * momSignal.confidence + weights.meanReversion * mrSignal.confidence;

    const reasons = [
      `Regime: ${regime} (mom: ${(weights.momentum * 100).toFixed(0)}%, mr: ${(weights.meanReversion * 100).toFixed(0)}%)`,
      `Momentum: ${momSignal.action} (${momSignal.confidence})`,
      `MeanRev: ${mrSignal.action} (${mrSignal.confidence})`,
      `Combined: ${combinedSignal.toFixed(3)}`,
    ];

    return {
      signal: Math.max(-1, Math.min(1, combinedSignal)),
      confidence: Math.round(combinedConfidence * 100) / 100,
      action: combinedSignal > 0.15 ? 'BUY' : combinedSignal < -0.15 ? 'SELL' : 'HOLD',
      regime,
      weights,
      components: { momentum: momSignal, meanReversion: mrSignal },
      reasons,
    };
  }
}

function std(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}
