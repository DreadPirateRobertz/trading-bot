// ML Feature Extraction
// Transforms raw OHLCV candles + indicators into normalized feature vectors for model input

import { computeRSI, computeMACD, computeBollingerBands, detectVolumeSpike } from '../signals/index.js';

// Extract a single feature vector from a window of candles + optional sentiment
// Returns array of normalized features suitable for neural network input
export function extractFeatures(candles, { sentiment = null, rsiPeriod = 14 } = {}) {
  if (candles.length < 26) return null; // Need enough data for MACD slow period

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const currentPrice = closes[closes.length - 1];

  // Technical indicators
  const rsi = computeRSI(closes, rsiPeriod);
  const macd = computeMACD(closes);
  const bollinger = computeBollingerBands(closes);

  // Volume ratio: current / 20-period average
  const volWindow = volumes.slice(-20);
  const avgVolume = volWindow.reduce((a, b) => a + b, 0) / volWindow.length;
  const volumeRatio = avgVolume > 0 ? volumes[volumes.length - 1] / avgVolume : 1;

  // Price returns over various lookback periods
  const ret1 = closes.length >= 2 ? (currentPrice - closes[closes.length - 2]) / closes[closes.length - 2] : 0;
  const ret5 = closes.length >= 6 ? (currentPrice - closes[closes.length - 6]) / closes[closes.length - 6] : 0;
  const ret10 = closes.length >= 11 ? (currentPrice - closes[closes.length - 11]) / closes[closes.length - 11] : 0;

  // Bollinger position: where price sits in the band [0=lower, 1=upper]
  let bollingerPos = 0.5;
  let bollingerBw = 0;
  if (bollinger) {
    const range = bollinger.upper - bollinger.lower;
    bollingerPos = range > 0 ? (currentPrice - bollinger.lower) / range : 0.5;
    bollingerBw = bollinger.bandwidth || 0;
  }

  // Normalize sentiment to [-1, 1]
  let sentimentScore = 0;
  if (sentiment) {
    if (typeof sentiment.score === 'number') {
      sentimentScore = Math.max(-1, Math.min(1, sentiment.score / 5));
    } else if (sentiment.classification) {
      const classMap = { very_bullish: 1, bullish: 0.5, neutral: 0, bearish: -0.5, very_bearish: -1 };
      sentimentScore = classMap[sentiment.classification] ?? 0;
    }
  }

  return [
    rsi !== null ? rsi / 100 : 0.5,                          // RSI [0, 1]
    macd ? clamp(macd.histogram / (Math.abs(currentPrice) * 0.01 + 1), -1, 1) * 0.5 + 0.5 : 0.5, // MACD histogram [0, 1]
    macd ? (macd.macd > macd.signal ? 1 : 0) : 0.5,         // MACD bullish signal {0, 1}
    clamp(bollingerPos, 0, 1),                                // Bollinger position [0, 1]
    clamp(bollingerBw, 0, 0.2) / 0.2,                        // Bollinger bandwidth [0, 1]
    clamp(volumeRatio / 3, 0, 1),                             // Volume ratio [0, 1]
    clamp(ret1 * 10, -1, 1) * 0.5 + 0.5,                     // 1-period return [0, 1]
    clamp(ret5 * 5, -1, 1) * 0.5 + 0.5,                      // 5-period return [0, 1]
    clamp(ret10 * 3, -1, 1) * 0.5 + 0.5,                     // 10-period return [0, 1]
    sentimentScore * 0.5 + 0.5,                               // Sentiment [0, 1]
  ];
}

// Generate labeled training data from candle history
// Label based on future returns: BUY if up > threshold, SELL if down > threshold, else HOLD
export function generateTrainingData(candles, {
  lookback = 30,
  horizon = 5,
  buyThreshold = 0.02,
  sellThreshold = -0.02,
  sentiment = [],
} = {}) {
  const samples = [];

  for (let i = lookback; i < candles.length - horizon; i++) {
    const window = candles.slice(i - lookback, i + 1);
    const currentPrice = candles[i].close;

    // Future return over horizon
    const futurePrice = candles[i + horizon].close;
    const futureReturn = (futurePrice - currentPrice) / currentPrice;

    // Label: [buy, hold, sell] one-hot
    let label;
    if (futureReturn > buyThreshold) {
      label = [1, 0, 0]; // BUY
    } else if (futureReturn < sellThreshold) {
      label = [0, 0, 1]; // SELL
    } else {
      label = [0, 1, 0]; // HOLD
    }

    // Find matching sentiment if available
    const candleSentiment = sentiment.length > 0
      ? findClosestSentiment(sentiment, candles[i].openTime || candles[i].timestamp)
      : null;

    const features = extractFeatures(window, { sentiment: candleSentiment });
    if (features) {
      samples.push({ input: features, output: label, futureReturn });
    }
  }

  return samples;
}

// Extract features from a data-pipeline feature row (19 precomputed indicators)
// Uses richer feature set than the basic extractFeatures function
export function extractPipelineFeatures(row, candles) {
  if (!row || row.rsi_14 === null) return null;

  const price = row.close || (candles && candles.length > 0 ? candles[candles.length - 1].close : null);
  if (!price) return null;

  // Bollinger position
  const bbRange = (row.bb_upper && row.bb_lower) ? row.bb_upper - row.bb_lower : 0;
  const bbPos = bbRange > 0 ? (price - row.bb_lower) / bbRange : 0.5;

  // SMA trend ratio (SMA20/SMA50 - 1, centered on 0)
  const smaTrend = (row.sma_20 && row.sma_50 && row.sma_50 > 0)
    ? (row.sma_20 / row.sma_50 - 1) : 0;

  // EMA trend ratio
  const emaTrend = (row.ema_12 && row.ema_26 && row.ema_26 > 0)
    ? (row.ema_12 / row.ema_26 - 1) : 0;

  // ATR as % of price (volatility measure)
  const atrPct = (row.atr_14 && price > 0) ? row.atr_14 / price : 0;

  // MACD histogram normalized by ATR
  const macdNorm = (row.macd_histogram !== null && row.atr_14)
    ? row.macd_histogram / (row.atr_14 + 1) : 0;

  // MACD momentum normalized
  const macdMomNorm = (row.macd_momentum !== null && row.atr_14)
    ? row.macd_momentum / (row.atr_14 + 1) : 0;

  return [
    row.rsi_14 !== null ? row.rsi_14 / 100 : 0.5,                    // [0, 1] RSI
    (row.rsi_divergence + 1) / 2,                                     // [0, 1] divergence
    clamp(macdNorm, -1, 1) * 0.5 + 0.5,                              // [0, 1] MACD histogram
    clamp(macdMomNorm, -1, 1) * 0.5 + 0.5,                           // [0, 1] MACD momentum
    clamp(bbPos, 0, 1),                                               // [0, 1] BB position
    clamp((row.bb_bandwidth || 0) / 0.2, 0, 1),                      // [0, 1] BB bandwidth
    row.bb_squeeze || 0,                                              // {0, 1} BB squeeze
    clamp((row.volume_profile || 1) / 3, 0, 1),                      // [0, 1] volume ratio
    clamp(smaTrend * 10, -1, 1) * 0.5 + 0.5,                         // [0, 1] SMA trend
    clamp(emaTrend * 10, -1, 1) * 0.5 + 0.5,                         // [0, 1] EMA trend
    clamp(atrPct / 0.1, 0, 1),                                       // [0, 1] volatility
    clamp((row.price_change_pct || 0) / 10, -1, 1) * 0.5 + 0.5,     // [0, 1] price change
    clamp((row.sentiment_velocity || 0) / 5, -1, 1) * 0.5 + 0.5,    // [0, 1] sentiment vel
  ];
}

// Generate training data from pipeline feature rows + candle history
// Supports both 3-class (BUY/HOLD/SELL) and binary (UP/DOWN) modes
export function generatePipelineTrainingData(candles, featureRows, {
  warmup = 50,
  horizon = 5,
  buyThreshold = 0.02,
  sellThreshold = -0.02,
  mode = 'ternary', // 'ternary' or 'directional'
} = {}) {
  const samples = [];

  for (let i = warmup; i < candles.length - horizon; i++) {
    const row = featureRows[i];
    if (!row || row.rsi_14 === null) continue;

    const currentPrice = candles[i].close;
    const futurePrice = candles[i + horizon].close;
    const futureReturn = (futurePrice - currentPrice) / currentPrice;

    let label;
    if (mode === 'directional') {
      // Binary: UP [1,0] or DOWN [0,1]
      label = futureReturn >= 0 ? [1, 0] : [0, 1];
    } else {
      // Ternary: BUY/HOLD/SELL
      if (futureReturn > buyThreshold) label = [1, 0, 0];
      else if (futureReturn < sellThreshold) label = [0, 0, 1];
      else label = [0, 1, 0];
    }

    const features = extractPipelineFeatures({ ...row, close: currentPrice }, null);
    if (features) {
      samples.push({ input: features, output: label, futureReturn });
    }
  }

  return samples;
}

// Feature names for interpretability
export const FEATURE_NAMES = [
  'rsi', 'macd_histogram', 'macd_signal', 'bollinger_position',
  'bollinger_bandwidth', 'volume_ratio', 'return_1p', 'return_5p',
  'return_10p', 'sentiment',
];

export const PIPELINE_FEATURE_NAMES = [
  'rsi_14', 'rsi_divergence', 'macd_histogram', 'macd_momentum',
  'bb_position', 'bb_bandwidth', 'bb_squeeze', 'volume_profile',
  'sma_trend', 'ema_trend', 'atr_pct', 'price_change_pct', 'sentiment_velocity',
];

export const NUM_FEATURES = 10;
export const NUM_PIPELINE_FEATURES = 13;
export const NUM_CLASSES = 3; // BUY, HOLD, SELL
export const CLASS_NAMES = ['BUY', 'HOLD', 'SELL'];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function findClosestSentiment(sentiments, timestamp) {
  if (!timestamp || sentiments.length === 0) return null;
  let closest = sentiments[0];
  let minDiff = Math.abs(timestamp - (closest.timestamp || 0));
  for (const s of sentiments) {
    const diff = Math.abs(timestamp - (s.timestamp || 0));
    if (diff < minDiff) {
      minDiff = diff;
      closest = s;
    }
  }
  return closest;
}
