// Feature engineering for OHLCV candle data
// Computes 19 features per row using rolling calculations

const BB_SQUEEZE_THRESHOLD = 0.04; // bandwidth below this = squeeze

export function computeAllFeatures(candles, { sentimentScores = [] } = {}) {
  const n = candles.length;
  if (n === 0) return [];

  const closes = candles.map(c => c.close);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);
  const volumes = candles.map(c => c.volume);

  const rsiArr = rollingRSI(closes, 14);
  const rsiDivergence = detectRSIDivergence(closes, rsiArr, 14);
  const { macdLine, macdSignal, macdHistogram } = rollingMACD(closes);
  const macdMomentum = rollingDelta(macdHistogram);
  const { upper: bbUpper, middle: bbMiddle, lower: bbLower, bandwidth: bbBandwidth } =
    rollingBollinger(closes, 20, 2);
  const bbSqueeze = bbBandwidth.map(bw => bw !== null && bw < BB_SQUEEZE_THRESHOLD ? 1 : 0);
  const volumeProfile = rollingVolumeProfile(volumes, 20);
  const sma20 = rollingSMA(closes, 20);
  const sma50 = rollingSMA(closes, 50);
  const ema12 = rollingEMA(closes, 12);
  const ema26 = rollingEMA(closes, 26);
  const atr = rollingATR(highs, lows, closes, 14);
  const priceChangePct = rollingPriceChange(closes);
  const sentVelocity = computeSentimentVelocity(sentimentScores, n);

  const results = [];
  for (let i = 0; i < n; i++) {
    results.push({
      symbol: candles[i].symbol,
      timestamp: candles[i].timestamp,
      rsi_14: rsiArr[i],
      rsi_divergence: rsiDivergence[i],
      macd_line: macdLine[i],
      macd_signal: macdSignal[i],
      macd_histogram: macdHistogram[i],
      macd_momentum: macdMomentum[i],
      bb_upper: bbUpper[i],
      bb_middle: bbMiddle[i],
      bb_lower: bbLower[i],
      bb_bandwidth: bbBandwidth[i],
      bb_squeeze: bbSqueeze[i],
      volume_profile: volumeProfile[i],
      sma_20: sma20[i],
      sma_50: sma50[i],
      ema_12: ema12[i],
      ema_26: ema26[i],
      sentiment_velocity: sentVelocity[i],
      atr_14: atr[i],
      price_change_pct: priceChangePct[i],
    });
  }
  return results;
}

// --- Rolling RSI ---
export function rollingRSI(closes, period = 14) {
  const n = closes.length;
  const result = new Array(n).fill(null);
  if (n < period + 1) return result;

  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);

  for (let i = period + 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
    avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

// --- RSI Divergence Detection ---
// Bullish divergence: price makes lower low but RSI makes higher low
// Bearish divergence: price makes higher high but RSI makes lower high
export function detectRSIDivergence(closes, rsiArr, lookback = 14) {
  const n = closes.length;
  const result = new Array(n).fill(0);
  for (let i = lookback; i < n; i++) {
    if (rsiArr[i] === null || rsiArr[i - lookback] === null) continue;
    const priceDelta = closes[i] - closes[i - lookback];
    const rsiDelta = rsiArr[i] - rsiArr[i - lookback];
    // Bullish: price fell but RSI rose (or flat)
    if (priceDelta < 0 && rsiDelta > 0) { result[i] = 1; continue; }
    // Bearish: price rose but RSI fell
    if (priceDelta > 0 && rsiDelta < 0) { result[i] = -1; }
  }
  return result;
}

// --- Rolling MACD ---
export function rollingMACD(closes, fast = 12, slow = 26, signal = 9) {
  const n = closes.length;
  const macdLine = new Array(n).fill(null);
  const macdSignal = new Array(n).fill(null);
  const macdHistogram = new Array(n).fill(null);

  const fastEma = rollingEMA(closes, fast);
  const slowEma = rollingEMA(closes, slow);

  // MACD line starts when both EMAs are available (index slow-1)
  const macdStart = slow - 1;
  const macdValues = [];
  for (let i = macdStart; i < n; i++) {
    macdLine[i] = fastEma[i] - slowEma[i];
    macdValues.push(macdLine[i]);
  }

  // Signal line = EMA(signal) of MACD values
  const sigEma = rollingEMA(macdValues, signal);
  const signalStart = macdStart + signal - 1;
  for (let i = 0; i < sigEma.length; i++) {
    const idx = macdStart + i;
    if (i >= signal - 1) {
      macdSignal[idx] = sigEma[i];
      macdHistogram[idx] = macdLine[idx] - sigEma[i];
    }
  }

  return { macdLine, macdSignal, macdHistogram };
}

// --- Rolling Bollinger Bands ---
export function rollingBollinger(closes, period = 20, stdDevMult = 2) {
  const n = closes.length;
  const upper = new Array(n).fill(null);
  const middle = new Array(n).fill(null);
  const lower = new Array(n).fill(null);
  const bandwidth = new Array(n).fill(null);

  for (let i = period - 1; i < n; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += closes[j];
    const mean = sum / period;
    let sqSum = 0;
    for (let j = i - period + 1; j <= i; j++) sqSum += (closes[j] - mean) ** 2;
    const sd = Math.sqrt(sqSum / period);
    upper[i] = mean + stdDevMult * sd;
    middle[i] = mean;
    lower[i] = mean - stdDevMult * sd;
    bandwidth[i] = mean !== 0 ? (2 * stdDevMult * sd) / mean : 0;
  }

  return { upper, middle, lower, bandwidth };
}

// --- Rolling SMA ---
export function rollingSMA(values, period) {
  const n = values.length;
  const result = new Array(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

// --- Rolling EMA ---
export function rollingEMA(values, period) {
  const n = values.length;
  if (n === 0) return [];
  const k = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < n; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

// --- Rolling ATR ---
export function rollingATR(highs, lows, closes, period = 14) {
  const n = highs.length;
  const result = new Array(n).fill(null);
  if (n < 2) return result;

  const trueRanges = [highs[0] - lows[0]];
  for (let i = 1; i < n; i++) {
    trueRanges.push(Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - closes[i - 1]),
      Math.abs(lows[i] - closes[i - 1])
    ));
  }

  if (n < period) return result;
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = atr;
  for (let i = period; i < n; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result[i] = atr;
  }
  return result;
}

// --- Rolling Volume Profile (relative to prior N-day average, excluding current) ---
export function rollingVolumeProfile(volumes, period = 20) {
  const n = volumes.length;
  const result = new Array(n).fill(null);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    if (i >= period) {
      // sum contains volumes[i-period..i-1] (prior period values)
      const avg = sum / period;
      result[i] = avg !== 0 ? volumes[i] / avg : null;
      sum += volumes[i] - volumes[i - period];
    } else {
      sum += volumes[i];
      if (i === period - 1) {
        // We have exactly 'period' values [0..period-1], use as avg for next
        // No result yet since we need prior window
      }
    }
  }
  return result;
}

// --- Rolling Price Change % ---
function rollingPriceChange(closes) {
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    result[i] = closes[i - 1] !== 0
      ? ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100
      : 0;
  }
  return result;
}

// --- Rolling Delta (change between consecutive values) ---
function rollingDelta(values) {
  const n = values.length;
  const result = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    if (values[i] !== null && values[i - 1] !== null) {
      result[i] = values[i] - values[i - 1];
    }
  }
  return result;
}

// --- Sentiment Velocity ---
// Rate of change in sentiment scores. sentimentScores is sparse array aligned by index.
function computeSentimentVelocity(scores, n) {
  const result = new Array(n).fill(null);
  if (!scores || scores.length === 0) return result;
  for (let i = 1; i < Math.min(scores.length, n); i++) {
    if (scores[i] != null && scores[i - 1] != null) {
      result[i] = scores[i] - scores[i - 1];
    }
  }
  return result;
}
