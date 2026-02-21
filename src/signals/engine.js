// Signal Engine
// Orchestrates technical indicators + sentiment into unified confidence score per asset
// Supports pluggable strategy backends: 'technical' (default), 'ensemble', 'momentum',
// 'meanReversion', 'pairsTrading'

import { computeRSI, computeMACD, computeBollingerBands, detectVolumeSpike, generateSignal } from './index.js';
import { EnsembleStrategy } from '../strategies/ensemble.js';
import { MomentumStrategy } from '../strategies/momentum.js';
import { MeanReversionStrategy } from '../strategies/mean-reversion.js';

export class SignalEngine {
  constructor({
    rsiPeriod = 14,
    macdParams,
    bollingerParams,
    volumeThreshold = 2,
    // Strategy backend: 'technical' (default), 'ensemble', 'momentum', 'meanReversion'
    strategy = 'technical',
    strategyConfig = {},
  } = {}) {
    this.rsiPeriod = rsiPeriod;
    this.macdParams = macdParams || { fast: 12, slow: 26, signal: 9 };
    this.bollingerParams = bollingerParams || { period: 20, stdDev: 2 };
    this.volumeThreshold = volumeThreshold;
    this.strategyName = strategy;

    // Initialize strategy backend
    if (strategy === 'ensemble') {
      this.strategy = new EnsembleStrategy(strategyConfig);
    } else if (strategy === 'momentum') {
      this.strategy = new MomentumStrategy(strategyConfig);
    } else if (strategy === 'meanReversion') {
      this.strategy = new MeanReversionStrategy(strategyConfig);
    } else {
      this.strategy = null; // 'technical' — use built-in indicators
    }
  }

  // Analyze a single asset given its OHLCV data and optional sentiment
  // candles: optional OHLCV array for strategy backends that need it (ensemble with ML/HMM)
  analyze(symbol, { closes, volumes, currentPrice, sentiment, candles } = {}) {
    if (!closes || closes.length === 0) {
      return { symbol, error: 'No price data' };
    }

    const price = currentPrice ?? closes[closes.length - 1];

    // Always compute technical indicators (used for diagnostics even with strategy backend)
    const rsi = computeRSI(closes, this.rsiPeriod);
    const macd = computeMACD(closes, this.macdParams);
    const bollinger = computeBollingerBands(closes, this.bollingerParams);
    const volumeSpike = volumes ? detectVolumeSpike(volumes, { threshold: this.volumeThreshold }) : false;

    let signal;
    if (this.strategy) {
      // Use strategy backend
      const strategyResult = this.strategy.generateSignal(closes, candles || null);
      signal = {
        action: strategyResult.action,
        score: strategyResult.signal * 10, // Normalize [-1,1] to [-10,10] score range
        confidence: strategyResult.confidence,
        reasons: strategyResult.reasons || [],
        strategy: this.strategyName,
        ...(strategyResult.regime ? { regime: strategyResult.regime } : {}),
      };
    } else {
      // Default: built-in technical indicator pipeline
      signal = generateSignalWithPrice({
        rsi, macd, bollinger, volumeSpike, sentiment, price,
      });
    }

    return {
      symbol,
      price,
      timestamp: new Date(),
      indicators: { rsi, macd, bollinger, volumeSpike },
      sentiment: sentiment || null,
      signal,
    };
  }

  // Batch analyze multiple assets
  analyzeMultiple(assets) {
    return assets.map(asset => this.analyze(asset.symbol, asset));
  }

  // Rank assets by signal strength (absolute confidence, then direction)
  rank(analyses) {
    return [...analyses]
      .filter(a => !a.error && a.signal)
      .sort((a, b) => {
        // Prioritize actionable signals (BUY/SELL over HOLD)
        const aActionable = a.signal.action !== 'HOLD' ? 1 : 0;
        const bActionable = b.signal.action !== 'HOLD' ? 1 : 0;
        if (aActionable !== bActionable) return bActionable - aActionable;
        return b.signal.confidence - a.signal.confidence;
      });
  }
}

// Enhanced generateSignal that incorporates Bollinger Band price position
export function generateSignalWithPrice({ rsi, macd, bollinger, volumeSpike, sentiment, price }) {
  let score = 0;
  const reasons = [];

  // RSI signals
  if (rsi !== null && rsi !== undefined) {
    if (rsi < 30) { score += 2; reasons.push(`RSI oversold (${rsi.toFixed(1)})`); }
    else if (rsi < 40) { score += 1; reasons.push(`RSI low (${rsi.toFixed(1)})`); }
    else if (rsi > 70) { score -= 2; reasons.push(`RSI overbought (${rsi.toFixed(1)})`); }
    else if (rsi > 60) { score -= 1; reasons.push(`RSI high (${rsi.toFixed(1)})`); }
  }

  // MACD signals
  if (macd !== null && macd !== undefined) {
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      score += 1; reasons.push('MACD bullish crossover');
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      score -= 1; reasons.push('MACD bearish crossover');
    }
  }

  // Bollinger Band signals with price context
  if (bollinger !== null && bollinger !== undefined && price !== undefined) {
    if (price < bollinger.lower) {
      score += 2; reasons.push('Price below lower Bollinger Band');
    } else if (price > bollinger.upper) {
      score -= 2; reasons.push('Price above upper Bollinger Band');
    }
    // Near band edges
    const range = bollinger.upper - bollinger.lower;
    if (range > 0) {
      const position = (price - bollinger.lower) / range;
      if (position < 0.2) {
        score += 1; reasons.push('Price near lower Bollinger Band');
      } else if (position > 0.8) {
        score -= 1; reasons.push('Price near upper Bollinger Band');
      }
    }
  }

  // Volume spike amplifies existing signals
  if (volumeSpike) {
    score = score > 0 ? score + 1 : score < 0 ? score - 1 : score;
    reasons.push('Volume spike detected');
  }

  // Sentiment overlay
  if (sentiment) {
    if (sentiment.classification === 'very_bullish') { score += 2; reasons.push('Very bullish sentiment'); }
    else if (sentiment.classification === 'bullish') { score += 1; reasons.push('Bullish sentiment'); }
    else if (sentiment.classification === 'very_bearish') { score -= 2; reasons.push('Very bearish sentiment'); }
    else if (sentiment.classification === 'bearish') { score -= 1; reasons.push('Bearish sentiment'); }
  }

  // Confidence: normalize absolute score against max possible (10 = all signals aligned)
  const maxScore = 10;
  const confidence = Math.min(Math.abs(score) / maxScore, 1);

  return {
    action: score >= 2 ? 'BUY' : score <= -2 ? 'SELL' : 'HOLD',
    score,
    confidence: Math.round(confidence * 100) / 100,
    reasons,
  };
}
