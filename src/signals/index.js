// Signal Scoring Framework
// Combines technical indicators with sentiment signals

export function computeRSI(closes, period = 14) {
  if (closes.length < period + 1) return null;
  let gains = 0;
  let losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses -= diff;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  // Smooth for remaining data
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function computeMACD(closes, { fast = 12, slow = 26, signal = 9 } = {}) {
  if (closes.length < slow) return null;
  const fastEma = ema(closes, fast);
  const slowEma = ema(closes, slow);
  const macdLine = fastEma.map((f, i) => f - slowEma[i]);
  const signalLine = ema(macdLine.slice(slow - fast), signal);
  const latest = macdLine.length - 1;
  const signalLatest = signalLine.length - 1;
  return {
    macd: macdLine[latest],
    signal: signalLine[signalLatest],
    histogram: macdLine[latest] - signalLine[signalLatest],
  };
}

export function computeBollingerBands(closes, { period = 20, stdDev = 2 } = {}) {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
  const sd = Math.sqrt(variance);
  return {
    upper: mean + stdDev * sd,
    middle: mean,
    lower: mean - stdDev * sd,
    bandwidth: (2 * stdDev * sd) / mean,
  };
}

export function detectVolumeSpike(volumes, { threshold = 2 } = {}) {
  if (volumes.length < 21) return false;
  const recent = volumes.slice(-20, -1);
  const avgVolume = recent.reduce((a, b) => a + b, 0) / recent.length;
  const current = volumes[volumes.length - 1];
  return current > avgVolume * threshold;
}

function ema(data, period) {
  const k = 2 / (period + 1);
  const result = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

export function generateSignal({ rsi, macd, bollinger, volumeSpike, sentiment }) {
  let score = 0;
  const reasons = [];

  // RSI signals
  if (rsi !== null) {
    if (rsi < 30) { score += 2; reasons.push(`RSI oversold (${rsi.toFixed(1)})`); }
    else if (rsi > 70) { score -= 2; reasons.push(`RSI overbought (${rsi.toFixed(1)})`); }
  }

  // MACD signals
  if (macd !== null) {
    if (macd.histogram > 0 && macd.macd > macd.signal) {
      score += 1; reasons.push('MACD bullish crossover');
    } else if (macd.histogram < 0 && macd.macd < macd.signal) {
      score -= 1; reasons.push('MACD bearish crossover');
    }
  }

  // Bollinger Band signals (mean reversion)
  if (bollinger !== null) {
    // Would need current price to compare — placeholder
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

  const confidence = Math.min(Math.abs(score) / 6, 1);
  return {
    action: score >= 2 ? 'BUY' : score <= -2 ? 'SELL' : 'HOLD',
    score,
    confidence: Math.round(confidence * 100) / 100,
    reasons,
  };
}
