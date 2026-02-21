// Multi-Timeframe Analysis
// Aggregates 1-minute candles into higher timeframes, detects trends at each level,
// and provides hierarchical signal confirmation — don't buy against higher TF trend.

const TIMEFRAMES = {
  '1m':  { minutes: 1,    weight: 0.05 },
  '5m':  { minutes: 5,    weight: 0.10 },
  '15m': { minutes: 15,   weight: 0.15 },
  '1h':  { minutes: 60,   weight: 0.25 },
  '4h':  { minutes: 240,  weight: 0.25 },
  '1d':  { minutes: 1440, weight: 0.20 },
};

export class MultiTimeframeAnalyzer {
  constructor({
    timeframes = ['5m', '15m', '1h', '4h', '1d'],
    emaPeriods = { fast: 9, slow: 21 },
    smaPeriod = 50,
    trendThreshold = 0.001, // min EMA spread to declare trend (0.1%)
    confirmationMode = 'majority', // 'majority' | 'strict' | 'weighted'
  } = {}) {
    this.timeframes = timeframes;
    this.emaPeriods = emaPeriods;
    this.smaPeriod = smaPeriod;
    this.trendThreshold = trendThreshold;
    this.confirmationMode = confirmationMode;
  }

  // Aggregate 1-minute candles into a higher timeframe
  // Returns array of aggregated candles
  aggregateCandles(candles1m, timeframeMinutes) {
    if (!candles1m || candles1m.length === 0) return [];
    if (timeframeMinutes <= 1) return [...candles1m];

    const aggregated = [];
    for (let i = 0; i < candles1m.length; i += timeframeMinutes) {
      const chunk = candles1m.slice(i, i + timeframeMinutes);
      if (chunk.length === 0) break;

      aggregated.push({
        openTime: chunk[0].openTime || chunk[0].timestamp || 0,
        open: chunk[0].open,
        high: Math.max(...chunk.map(c => c.high)),
        low: Math.min(...chunk.map(c => c.low)),
        close: chunk[chunk.length - 1].close,
        volume: chunk.reduce((s, c) => s + (c.volume || 0), 0),
      });
    }
    return aggregated;
  }

  // Build all timeframe candle sets from 1m data
  buildTimeframes(candles1m) {
    const result = { '1m': candles1m };
    for (const tf of this.timeframes) {
      const tfConfig = TIMEFRAMES[tf];
      if (!tfConfig) continue;
      result[tf] = this.aggregateCandles(candles1m, tfConfig.minutes);
    }
    return result;
  }

  // Detect trend for a single timeframe's candles
  // Returns { direction: 'bull'|'bear'|'neutral', strength: 0-1, indicators }
  detectTrend(candles) {
    if (!candles || candles.length < 2) {
      return { direction: 'neutral', strength: 0, indicators: {} };
    }

    const closes = candles.map(c => c.close);
    const emaFast = ema(closes, this.emaPeriods.fast);
    const emaSlow = ema(closes, this.emaPeriods.slow);
    const sma = simpleMA(closes, Math.min(this.smaPeriod, closes.length));

    const lastClose = closes[closes.length - 1];
    const lastEmaFast = emaFast[emaFast.length - 1];
    const lastEmaSlow = emaSlow[emaSlow.length - 1];
    const lastSma = sma[sma.length - 1];

    // EMA crossover direction
    const emaSpread = lastEmaSlow !== 0
      ? (lastEmaFast - lastEmaSlow) / lastEmaSlow
      : 0;

    // Price position relative to SMA
    const priceVsSma = lastSma !== 0
      ? (lastClose - lastSma) / lastSma
      : 0;

    // Recent momentum (last 5 candles)
    const recentLen = Math.min(5, closes.length);
    const recentStart = closes[closes.length - recentLen];
    const recentMom = recentStart !== 0
      ? (lastClose - recentStart) / recentStart
      : 0;

    // Score components: EMA cross, price vs SMA, recent momentum
    let score = 0;
    if (emaSpread > this.trendThreshold) score += 1;
    else if (emaSpread < -this.trendThreshold) score -= 1;

    if (priceVsSma > this.trendThreshold) score += 1;
    else if (priceVsSma < -this.trendThreshold) score -= 1;

    if (recentMom > this.trendThreshold * 2) score += 1;
    else if (recentMom < -this.trendThreshold * 2) score -= 1;

    const direction = score >= 2 ? 'bull' : score <= -2 ? 'bear' : 'neutral';
    const strength = Math.min(Math.abs(score) / 3, 1);

    return {
      direction,
      strength: round(strength),
      indicators: {
        emaFast: round(lastEmaFast),
        emaSlow: round(lastEmaSlow),
        emaSpread: round(emaSpread * 10000), // in bps
        sma: round(lastSma),
        priceVsSma: round(priceVsSma * 10000), // in bps
        recentMom: round(recentMom * 10000), // in bps
      },
    };
  }

  // Full multi-timeframe analysis
  // Returns trend for each timeframe + hierarchical confirmation
  analyze(candles1m) {
    const tfCandles = this.buildTimeframes(candles1m);
    const trends = {};

    for (const [tf, candles] of Object.entries(tfCandles)) {
      trends[tf] = this.detectTrend(candles);
    }

    const confirmation = this._computeConfirmation(trends);

    return {
      trends,
      confirmation,
      timeframeCount: Object.keys(trends).length,
    };
  }

  // Evaluate whether a signal from a lower timeframe is confirmed by higher timeframes
  // signal: { action: 'BUY'|'SELL'|'HOLD', confidence }
  // Returns: { confirmed, adjustedConfidence, reason, alignment }
  confirmSignal(signal, candles1m) {
    if (!signal || signal.action === 'HOLD') {
      return {
        confirmed: false,
        adjustedConfidence: 0,
        reason: 'no actionable signal',
        alignment: 0,
      };
    }

    const { trends, confirmation } = this.analyze(candles1m);
    const isBuy = signal.action === 'BUY';
    const targetDirection = isBuy ? 'bull' : 'bear';

    // Count aligned vs opposing timeframes (weighted)
    let alignedWeight = 0;
    let opposedWeight = 0;
    let totalWeight = 0;

    for (const [tf, trend] of Object.entries(trends)) {
      const weight = TIMEFRAMES[tf]?.weight || 0.1;
      totalWeight += weight;

      if (trend.direction === targetDirection) {
        alignedWeight += weight * trend.strength;
      } else if (trend.direction !== 'neutral') {
        opposedWeight += weight * trend.strength;
      }
    }

    const alignment = totalWeight > 0
      ? (alignedWeight - opposedWeight) / totalWeight
      : 0;

    let confirmed;
    let reason;

    switch (this.confirmationMode) {
      case 'strict':
        // All higher TFs must be aligned or neutral
        confirmed = opposedWeight === 0 && alignedWeight > 0;
        reason = confirmed
          ? 'all higher timeframes aligned'
          : 'higher timeframes not fully aligned';
        break;

      case 'weighted':
        // Weighted alignment must be positive
        confirmed = alignment > 0;
        reason = alignment > 0.3
          ? 'strong multi-timeframe alignment'
          : alignment > 0
            ? 'marginal timeframe alignment'
            : 'higher timeframes oppose signal';
        break;

      case 'majority':
      default: {
        // Majority of weighted timeframes must agree
        confirmed = alignedWeight > opposedWeight;
        reason = confirmed
          ? 'majority of timeframes confirm'
          : 'majority of timeframes oppose';
        break;
      }
    }

    // Adjust confidence: boost when aligned, penalize when opposed
    let adjustedConfidence = signal.confidence;
    if (alignment > 0) {
      // Boost up to 30% for strong alignment
      adjustedConfidence = Math.min(1, signal.confidence * (1 + alignment * 0.3));
    } else if (alignment < 0) {
      // Penalize up to 50% for opposition
      adjustedConfidence = signal.confidence * (1 + alignment * 0.5);
    }

    return {
      confirmed,
      adjustedConfidence: round(Math.max(0, adjustedConfidence)),
      originalConfidence: signal.confidence,
      reason,
      alignment: round(alignment),
      trendSummary: confirmation,
    };
  }

  _computeConfirmation(trends) {
    let bullCount = 0, bearCount = 0, neutralCount = 0;
    let bullWeight = 0, bearWeight = 0;
    let totalWeight = 0;

    for (const [tf, trend] of Object.entries(trends)) {
      const weight = TIMEFRAMES[tf]?.weight || 0.1;
      totalWeight += weight;

      if (trend.direction === 'bull') {
        bullCount++;
        bullWeight += weight * trend.strength;
      } else if (trend.direction === 'bear') {
        bearCount++;
        bearWeight += weight * trend.strength;
      } else {
        neutralCount++;
      }
    }

    const netBias = totalWeight > 0 ? (bullWeight - bearWeight) / totalWeight : 0;
    let overall;
    if (netBias > 0.15) overall = 'bullish';
    else if (netBias < -0.15) overall = 'bearish';
    else overall = 'mixed';

    return {
      overall,
      netBias: round(netBias),
      bullCount,
      bearCount,
      neutralCount,
    };
  }
}

// Exponential Moving Average
function ema(values, period) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result = [values[0]];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

// Simple Moving Average
function simpleMA(values, period) {
  if (values.length === 0 || period <= 0) return [];
  const result = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      // Not enough data yet — use available average
      const slice = values.slice(0, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    } else {
      const slice = values.slice(i - period + 1, i + 1);
      result.push(slice.reduce((a, b) => a + b, 0) / period);
    }
  }
  return result;
}

function round(n) { return Math.round(n * 100) / 100; }

export { TIMEFRAMES, ema, simpleMA };
