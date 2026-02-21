// Risk-Managed Time-Series Momentum Strategy
// Per STRATEGY-V2: 30-day lookback, volatility scaling, Sharpe target 1.42

export class MomentumStrategy {
  constructor({
    lookback = 30,
    volWindow = 20,
    targetRisk = 0.02,    // 2% daily portfolio risk
    entryThreshold = 0,   // momentum > 0 = long
  } = {}) {
    this.lookback = lookback;
    this.volWindow = volWindow;
    this.targetRisk = targetRisk;
    this.entryThreshold = entryThreshold;
  }

  // Returns signal in [-1, +1] range
  // Positive = bullish momentum, negative = bearish
  generateSignal(closes) {
    if (closes.length < this.lookback + this.volWindow) {
      return { signal: 0, confidence: 0, action: 'HOLD', reasons: ['Insufficient data'] };
    }

    const current = closes[closes.length - 1];
    const past = closes[closes.length - 1 - this.lookback];
    const momentum = (current - past) / past;

    // Compute volatility for scaling
    const returns = [];
    for (let i = closes.length - this.volWindow; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const volatility = Math.sqrt(variance);

    // Volatility-scaled momentum signal
    const volScale = volatility > 0 ? Math.min(this.targetRisk / volatility, 2) : 1;
    const rawSignal = momentum > this.entryThreshold ? 1 : momentum < -this.entryThreshold ? -1 : 0;
    const scaledSignal = rawSignal * volScale;

    // Confidence based on momentum magnitude relative to volatility
    const momentumZScore = volatility > 0 ? Math.abs(momentum) / volatility : 0;
    const confidence = Math.min(momentumZScore / 3, 1); // z-score of 3 = max confidence

    const reasons = [];
    if (momentum > 0) reasons.push(`Positive ${this.lookback}d momentum: ${(momentum * 100).toFixed(2)}%`);
    else reasons.push(`Negative ${this.lookback}d momentum: ${(momentum * 100).toFixed(2)}%`);
    reasons.push(`Volatility: ${(volatility * 100).toFixed(2)}%, scale: ${volScale.toFixed(2)}`);

    return {
      signal: Math.max(-1, Math.min(1, scaledSignal)),
      confidence: Math.round(confidence * 100) / 100,
      action: scaledSignal > 0.1 ? 'BUY' : scaledSignal < -0.1 ? 'SELL' : 'HOLD',
      momentum: Math.round(momentum * 10000) / 100,
      volatility: Math.round(volatility * 10000) / 100,
      volScale: Math.round(volScale * 100) / 100,
      reasons,
    };
  }
}
