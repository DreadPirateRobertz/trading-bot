// Bollinger Bounce Mean Reversion Strategy
// Simpler MR approach that doesn't rely on Hurst filtering
// Buys at lower band touches, sells at upper band touches
// Uses %B position and RSI confirmation for entry quality

export class BollingerBounceStrategy {
  constructor({
    bbPeriod = 20,
    bbStdDev = 2,
    rsiPeriod = 14,
    rsiBuyThreshold = 40,    // RSI below this confirms oversold bounce
    rsiSellThreshold = 60,   // RSI above this confirms overbought fade
    percentBBuy = 0.05,      // Buy when %B below this (near/below lower band)
    percentBSell = 0.95,     // Sell when %B above this (near/above upper band)
    exitPercentB = 0.5,      // Exit when %B returns to middle
    trailingStopATRMultiple = 2.0,
    atrPeriod = 14,
  } = {}) {
    this.bbPeriod = bbPeriod;
    this.bbStdDev = bbStdDev;
    this.rsiPeriod = rsiPeriod;
    this.rsiBuyThreshold = rsiBuyThreshold;
    this.rsiSellThreshold = rsiSellThreshold;
    this.percentBBuy = percentBBuy;
    this.percentBSell = percentBSell;
    this.exitPercentB = exitPercentB;
    this.trailingStopATRMultiple = trailingStopATRMultiple;
    this.atrPeriod = atrPeriod;
  }

  computeRSI(closes) {
    const period = this.rsiPeriod;
    if (closes.length < period + 1) return null;
    let gains = 0, losses = 0;
    for (let i = 1; i <= period; i++) {
      const diff = closes[i] - closes[i - 1];
      if (diff > 0) gains += diff; else losses -= diff;
    }
    let avgGain = gains / period;
    let avgLoss = losses / period;
    for (let i = period + 1; i < closes.length; i++) {
      const diff = closes[i] - closes[i - 1];
      avgGain = (avgGain * (period - 1) + Math.max(diff, 0)) / period;
      avgLoss = (avgLoss * (period - 1) + Math.max(-diff, 0)) / period;
    }
    if (avgLoss === 0) return 100;
    return 100 - 100 / (1 + avgGain / avgLoss);
  }

  computeBollinger(closes) {
    if (closes.length < this.bbPeriod) return null;
    const window = closes.slice(-this.bbPeriod);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    const variance = window.reduce((s, v) => s + (v - mean) ** 2, 0) / window.length;
    const sd = Math.sqrt(variance);
    const upper = mean + this.bbStdDev * sd;
    const lower = mean - this.bbStdDev * sd;
    const range = upper - lower;
    const percentB = range > 0 ? (closes[closes.length - 1] - lower) / range : 0.5;
    const bandwidth = mean > 0 ? range / mean : 0;
    return { upper, middle: mean, lower, percentB, bandwidth };
  }

  computeATR(candles) {
    if (candles.length < this.atrPeriod + 1) return null;
    const trs = [];
    for (let i = 1; i < candles.length; i++) {
      const h = candles[i].high ?? candles[i].close * 1.01;
      const l = candles[i].low ?? candles[i].close * 0.99;
      const pc = candles[i - 1].close;
      trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
    }
    const recent = trs.slice(-this.atrPeriod);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  generateSignal(closes, candles = null) {
    if (closes.length < Math.max(this.bbPeriod, this.rsiPeriod + 1) + 5) {
      return { signal: 0, confidence: 0, action: 'HOLD', reasons: ['Insufficient data'] };
    }

    const bb = this.computeBollinger(closes);
    const rsi = this.computeRSI(closes);
    if (!bb) return { signal: 0, confidence: 0, action: 'HOLD', reasons: ['BB computation failed'] };

    const reasons = [];
    let signal = 0;
    let confidence = 0;

    const { percentB, bandwidth } = bb;

    // Buy zone: price near/below lower band
    if (percentB <= this.percentBBuy) {
      signal = 1;
      // Higher confidence when RSI confirms oversold
      const rsiConfirm = rsi !== null && rsi < this.rsiBuyThreshold;
      confidence = rsiConfirm ? 0.7 : 0.4;
      reasons.push(`%B ${percentB.toFixed(3)} <= ${this.percentBBuy} — near lower band, BUY`);
      if (rsiConfirm) reasons.push(`RSI ${rsi.toFixed(1)} confirms oversold`);
    }
    // Sell zone: price near/above upper band
    else if (percentB >= this.percentBSell) {
      signal = -1;
      const rsiConfirm = rsi !== null && rsi > this.rsiSellThreshold;
      confidence = rsiConfirm ? 0.7 : 0.4;
      reasons.push(`%B ${percentB.toFixed(3)} >= ${this.percentBSell} — near upper band, SELL`);
      if (rsiConfirm) reasons.push(`RSI ${rsi.toFixed(1)} confirms overbought`);
    }
    // Neutral zone but watch for bandwidth squeeze (pre-breakout)
    else if (bandwidth < 0.02) {
      signal = 0;
      confidence = 0;
      reasons.push(`BB squeeze (BW ${bandwidth.toFixed(4)}) — stay flat, breakout imminent`);
    }
    // Exit zone: price returning to middle
    else if (percentB > 0.4 && percentB < 0.6) {
      signal = 0;
      confidence = 0;
      reasons.push(`%B ${percentB.toFixed(3)} near middle — exit zone`);
    }
    else {
      reasons.push(`%B ${percentB.toFixed(3)} in no-trade zone`);
    }

    // Scale confidence by how extreme the %B is
    if (signal !== 0) {
      const extremity = signal > 0 ? (this.percentBBuy - percentB) / this.percentBBuy
        : (percentB - this.percentBSell) / (1 - this.percentBSell);
      confidence = Math.min(confidence + extremity * 0.3, 0.95);
    }

    return {
      signal,
      confidence: Math.round(confidence * 100) / 100,
      action: signal > 0 ? 'BUY' : signal < 0 ? 'SELL' : 'HOLD',
      percentB: Math.round(percentB * 1000) / 1000,
      bandwidth: Math.round(bandwidth * 10000) / 10000,
      rsi: rsi !== null ? Math.round(rsi * 10) / 10 : null,
      reasons,
    };
  }
}
