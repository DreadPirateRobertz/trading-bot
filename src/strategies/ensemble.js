// Ensemble Strategy Engine
// Per STRATEGY-V2: Regime-dependent weighted combination of strategy signals
// tb-6ft: ML signal enhancer integrated alongside rule-based strategies
// tb-bhm: HMM regime detector replaces simple vol-ratio heuristic
// ML weight configurable (default 0.3), graceful fallback when unavailable

import { MomentumStrategy } from './momentum.js';
import { MeanReversionStrategy } from './mean-reversion.js';

export class EnsembleStrategy {
  constructor({
    momentumConfig,
    meanReversionConfig,
    // Default to equal weight for rule-based strategies
    weights = { momentum: 0.5, meanReversion: 0.5 },
    // ML integration (tb-6ft)
    mlModel = null,          // NeuralNetwork instance (from src/ml/model.js)
    mlFeatureExtractor = null, // extractFeatures function (from src/ml/features.js)
    mlWeight = 0.3,          // Weight for ML signal; rules get (1 - mlWeight)
    // HMM regime detector (tb-bhm)
    hmmDetector = null,      // GaussianHMM instance (from src/ml/hmm.js)
  } = {}) {
    this.momentum = new MomentumStrategy(momentumConfig);
    this.meanReversion = new MeanReversionStrategy(meanReversionConfig);
    this.weights = weights;
    this.mlModel = mlModel;
    this.mlFeatureExtractor = mlFeatureExtractor;
    this.mlWeight = mlWeight;
    this.hmmDetector = hmmDetector;
  }

  // Simple volatility regime detection (fallback when HMM unavailable)
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

  // Detect regime using HMM if available, fallback to vol-ratio heuristic
  detectRegimeHMM(candles) {
    if (!this.hmmDetector || !this.hmmDetector.trained) return null;

    try {
      // GaussianHMM.extractObservations is a static method
      const GaussianHMM = this.hmmDetector.constructor;
      const obs = GaussianHMM.extractObservations(candles, { volWindow: 20 });
      if (obs.length < 1) return null;

      const result = this.hmmDetector.currentRegime(obs);
      return result;
    } catch {
      return null;
    }
  }

  // Map HMM states to regime weight scheme
  _hmmToRegimeWeights(hmmRegime) {
    switch (hmmRegime) {
      case 'bull':
        return { momentum: 0.7, meanReversion: 0.3 };
      case 'bear':
        return { momentum: 0.6, meanReversion: 0.4 };
      case 'range_bound':
        return { momentum: 0.25, meanReversion: 0.75 };
      case 'high_vol':
        return { momentum: 0.4, meanReversion: 0.6 };
      default:
        return null;
    }
  }

  // Adjust weights based on detected regime
  getRegimeWeights(regime) {
    switch (regime) {
      case 'trending':
      case 'high_vol_trending':
      case 'bull':
        return { momentum: 0.7, meanReversion: 0.3 };
      case 'bear':
        return { momentum: 0.6, meanReversion: 0.4 };
      case 'range_bound':
      case 'low_vol_range':
        return { momentum: 0.3, meanReversion: 0.7 };
      case 'high_vol':
        return { momentum: 0.4, meanReversion: 0.6 };
      default:
        return this.weights; // 50/50 default
    }
  }

  // Get ML prediction, converting to strategy signal format [-1, 1]
  // Returns null if ML unavailable or errored
  _getMLSignal(candles) {
    if (!this.mlModel || !this.mlFeatureExtractor) return null;

    try {
      const features = this.mlFeatureExtractor(candles);
      if (!features) return null;

      const prediction = this.mlModel.predictSignal(features);
      const { probabilities } = prediction;

      // Convert probabilities to directional signal: buy - sell = [-1, 1]
      const signal = probabilities.buy - probabilities.sell;
      const confidence = Math.max(probabilities.buy, probabilities.sell, probabilities.hold);

      return {
        signal: Math.max(-1, Math.min(1, signal)),
        confidence: Math.round(confidence * 100) / 100,
        action: prediction.action,
        probabilities,
      };
    } catch {
      // ML error — fall back silently
      return null;
    }
  }

  // generateSignal(closes, candles?)
  // candles: optional OHLCV array for ML feature extraction and HMM regime detection
  // If candles not provided, ML and HMM are skipped (backward compatible)
  generateSignal(closes, candles = null) {
    const momSignal = this.momentum.generateSignal(closes);
    const mrSignal = this.meanReversion.generateSignal(closes);

    // Regime detection: prefer HMM, fallback to vol-ratio heuristic
    let regime;
    let hmmInfo = null;
    if (candles && this.hmmDetector) {
      hmmInfo = this.detectRegimeHMM(candles);
    }

    if (hmmInfo) {
      regime = hmmInfo.regime;
    } else {
      regime = this.detectRegime(closes);
    }

    const ruleWeights = hmmInfo
      ? (this._hmmToRegimeWeights(hmmInfo.regime) || this.getRegimeWeights(regime))
      : this.getRegimeWeights(regime);

    // Rule-based combined signal
    const ruleSignal = ruleWeights.momentum * momSignal.signal + ruleWeights.meanReversion * mrSignal.signal;
    const ruleConfidence = ruleWeights.momentum * momSignal.confidence + ruleWeights.meanReversion * mrSignal.confidence;

    // ML signal (if available)
    const mlSignal = candles ? this._getMLSignal(candles) : null;
    const mlActive = mlSignal !== null;

    // Adaptive ML weighting: ML gets more influence when confident and agreeing with rules
    let effectiveMLWeight = 0;
    if (mlActive) {
      const mlConfident = mlSignal.confidence > 0.55;
      const ruleDirection = ruleSignal > 0 ? 'BUY' : ruleSignal < 0 ? 'SELL' : 'HOLD';
      const mlAgreesWithRules = mlSignal.action === ruleDirection;

      if (mlConfident && mlAgreesWithRules) {
        // ML confirms rules → boost ML influence (agreement bonus)
        effectiveMLWeight = Math.min(this.mlWeight * 1.5, 0.5);
      } else if (mlConfident && !mlAgreesWithRules) {
        // ML contradicts rules → use ML as caution signal (reduced weight)
        effectiveMLWeight = this.mlWeight * 0.7;
      } else {
        // ML uncertain → minimal influence
        effectiveMLWeight = this.mlWeight * 0.3;
      }
    }
    const effectiveRuleWeight = 1 - effectiveMLWeight;

    // Final blended signal
    const combinedSignal = effectiveRuleWeight * ruleSignal +
      (mlActive ? effectiveMLWeight * mlSignal.signal : 0);
    const combinedConfidence = effectiveRuleWeight * ruleConfidence +
      (mlActive ? effectiveMLWeight * mlSignal.confidence : 0);

    const reasons = [
      `Regime: ${regime}${hmmInfo ? ` (HMM conf=${hmmInfo.confidence})` : ''} (mom: ${(ruleWeights.momentum * 100).toFixed(0)}%, mr: ${(ruleWeights.meanReversion * 100).toFixed(0)}%)`,
      `Momentum: ${momSignal.action} (${momSignal.confidence})`,
      `MeanRev: ${mrSignal.action} (${mrSignal.confidence})`,
    ];

    if (mlActive) {
      reasons.push(`ML: ${mlSignal.action} (${mlSignal.confidence}) [weight=${(effectiveMLWeight * 100).toFixed(0)}%]`);
    } else if (this.mlModel) {
      reasons.push('ML: unavailable (fallback to rules only)');
    }

    reasons.push(`Combined: ${combinedSignal.toFixed(3)}`);

    return {
      signal: Math.max(-1, Math.min(1, combinedSignal)),
      confidence: Math.round(combinedConfidence * 100) / 100,
      action: combinedSignal > 0.15 ? 'BUY' : combinedSignal < -0.15 ? 'SELL' : 'HOLD',
      regime,
      weights: ruleWeights,
      components: {
        momentum: momSignal,
        meanReversion: mrSignal,
        ...(mlActive ? { ml: mlSignal } : {}),
      },
      mlActive,
      hmmActive: hmmInfo !== null,
      reasons,
    };
  }
}

function std(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}
