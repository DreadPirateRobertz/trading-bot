// Hybrid Strategy: Momentum + Bollinger Bounce with Regime Switching
// Core insight from paper trading: Mom-7d dominates in trending, BB-Bounce dominates in range
// This strategy dynamically blends based on detected regime

import { MomentumStrategy } from './momentum.js';
import { BollingerBounceStrategy } from './bollinger-bounce.js';

export class HybridStrategy {
  constructor({
    momentumConfig = { lookback: 7, targetRisk: 0.02 },
    bbConfig = { percentBBuy: 0.10, percentBSell: 0.90 },
    volWindow = 20,
    trendWindow = 30,
  } = {}) {
    this.momentum = new MomentumStrategy(momentumConfig);
    this.bb = new BollingerBounceStrategy(bbConfig);
    this.volWindow = volWindow;
    this.trendWindow = trendWindow;
  }

  detectRegime(closes) {
    if (closes.length < 61) return { regime: 'unknown', trendStrength: 0, volRatio: 1 };

    // Short-term vs long-term volatility ratio
    const shortReturns = [];
    for (let i = closes.length - this.volWindow; i < closes.length; i++) {
      shortReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const longReturns = [];
    for (let i = closes.length - 60; i < closes.length; i++) {
      longReturns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    const shortVol = std(shortReturns);
    const longVol = std(longReturns);
    const volRatio = shortVol / (longVol || 1);

    // Trend strength: magnitude of 30d return relative to volatility
    const ret30 = (closes[closes.length - 1] - closes[closes.length - 1 - this.trendWindow]) /
                  closes[closes.length - 1 - this.trendWindow];
    const trendStrength = shortVol > 0 ? Math.abs(ret30) / (shortVol * Math.sqrt(this.trendWindow)) : 0;

    // ADX-like directional movement (simplified)
    const ret7 = (closes[closes.length - 1] - closes[closes.length - 8]) / closes[closes.length - 8];
    const ret14 = (closes[closes.length - 1] - closes[closes.length - 15]) / closes[closes.length - 15];
    const directional = Math.sign(ret7) === Math.sign(ret14) && Math.abs(ret7) > shortVol;

    let regime;
    if (trendStrength > 1.5 && directional) regime = 'strong_trend';
    else if (trendStrength > 0.8) regime = 'trending';
    else if (volRatio > 1.3) regime = 'volatile_chop';
    else regime = 'range_bound';

    return { regime, trendStrength: round(trendStrength), volRatio: round(volRatio) };
  }

  generateSignal(closes) {
    if (closes.length < 61) {
      return { signal: 0, confidence: 0, action: 'HOLD', reasons: ['Insufficient data'] };
    }

    const { regime, trendStrength, volRatio } = this.detectRegime(closes);
    const momSignal = this.momentum.generateSignal(closes);
    const bbSignal = this.bb.generateSignal(closes);

    // Dynamic weight allocation
    let momWeight, bbWeight;
    switch (regime) {
      case 'strong_trend':
        momWeight = 0.85; bbWeight = 0.15;
        break;
      case 'trending':
        momWeight = 0.65; bbWeight = 0.35;
        break;
      case 'volatile_chop':
        momWeight = 0.30; bbWeight = 0.70;
        break;
      case 'range_bound':
        momWeight = 0.20; bbWeight = 0.80;
        break;
      default:
        momWeight = 0.50; bbWeight = 0.50;
    }

    // Combined signal
    const combinedSignal = momWeight * momSignal.signal + bbWeight * bbSignal.signal;
    const combinedConfidence = momWeight * momSignal.confidence + bbWeight * bbSignal.confidence;

    // Conflict detection: if momentum and BB strongly disagree, reduce confidence
    const conflicting = Math.sign(momSignal.signal) !== Math.sign(bbSignal.signal) &&
                        momSignal.confidence > 0.3 && bbSignal.confidence > 0.3;
    const confidenceAdj = conflicting ? 0.5 : 1.0;

    const finalConfidence = combinedConfidence * confidenceAdj;
    const finalSignal = combinedSignal;

    const reasons = [
      `Regime: ${regime} (trend=${trendStrength}, vol_ratio=${volRatio})`,
      `Weights: mom=${(momWeight * 100).toFixed(0)}% bb=${(bbWeight * 100).toFixed(0)}%`,
      `Mom: ${momSignal.action} (${momSignal.confidence})`,
      `BB: ${bbSignal.action} (${bbSignal.confidence})`,
      conflicting ? 'CONFLICT: signals disagree, halving confidence' : 'Aligned',
    ];

    return {
      signal: Math.max(-1, Math.min(1, finalSignal)),
      confidence: Math.round(finalConfidence * 100) / 100,
      action: finalSignal > 0.10 ? 'BUY' : finalSignal < -0.10 ? 'SELL' : 'HOLD',
      regime,
      trendStrength,
      volRatio,
      components: { momentum: momSignal, bollingerBounce: bbSignal },
      conflicting,
      reasons,
    };
  }
}

function std(arr) {
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length);
}

function round(n) { return Math.round(n * 100) / 100; }
