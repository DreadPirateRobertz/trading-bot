// Position Sizing Algorithm
// Determines trade size based on confidence, volatility, and risk parameters

export class PositionSizer {
  constructor({
    maxPositionPct = 0.10,    // Max % of portfolio per trade
    maxYoloPct = 0.25,        // Max % for high-conviction trades
    yoloThreshold = 0.85,     // Confidence threshold for YOLO sizing
    kellyFraction = 0.33,     // One-third Kelly per STRATEGY-V2 (crypto estimation uncertainty)
    minPositionValue = 100,   // Minimum trade value in dollars
  } = {}) {
    this.maxPositionPct = maxPositionPct;
    this.maxYoloPct = maxYoloPct;
    this.yoloThreshold = yoloThreshold;
    this.kellyFraction = kellyFraction;
    this.minPositionValue = minPositionValue;
  }

  // Calculate volatility (standard deviation of returns)
  calculateVolatility(closes) {
    if (closes.length < 2) return 0;
    const returns = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    return Math.sqrt(variance);
  }

  // Average True Range for volatility-based sizing
  calculateATR(candles, period = 14) {
    if (candles.length < period + 1) return null;
    const trueRanges = [];
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      trueRanges.push(tr);
    }
    // Simple moving average of last `period` true ranges
    const recent = trueRanges.slice(-period);
    return recent.reduce((a, b) => a + b, 0) / recent.length;
  }

  // Kelly Criterion estimate
  // winRate: historical win probability (0-1)
  // avgWin: average winning trade return
  // avgLoss: average losing trade return (positive number)
  kellySize(winRate, avgWin, avgLoss) {
    if (avgLoss === 0) return 0;
    const kelly = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
    // Apply fraction and clamp
    return Math.max(0, Math.min(kelly * this.kellyFraction, this.maxYoloPct));
  }

  // Main sizing method
  // Returns { qty, value, method, reason }
  calculate({
    portfolioValue,
    price,
    confidence,
    volatility,    // daily return stddev (optional)
    winRate,       // historical win rate (optional, for Kelly)
    avgWinReturn,  // average win return (optional, for Kelly)
    avgLossReturn, // average loss return (optional, for Kelly)
  }) {
    if (portfolioValue <= 0 || price <= 0 || confidence <= 0) {
      return { qty: 0, value: 0, method: 'none', reason: 'Invalid inputs' };
    }

    let positionPct;
    let method;

    // Try Kelly if we have historical stats
    if (winRate !== undefined && avgWinReturn !== undefined && avgLossReturn !== undefined) {
      const kellyPct = this.kellySize(winRate, avgWinReturn, avgLossReturn);
      if (kellyPct > 0) {
        positionPct = kellyPct * confidence;
        method = 'kelly';
      }
    }

    // Fallback: confidence-scaled position
    if (!method) {
      const basePct = confidence >= this.yoloThreshold
        ? this.maxYoloPct
        : this.maxPositionPct;
      positionPct = basePct * confidence;
      method = confidence >= this.yoloThreshold ? 'yolo' : 'standard';
    }

    // Volatility adjustment: reduce size for high-volatility assets
    if (volatility && volatility > 0) {
      // Target: 2% daily portfolio risk per position
      const targetRisk = 0.02;
      const volAdjust = Math.min(targetRisk / volatility, 1);
      positionPct = positionPct * volAdjust;
      method += '+vol_adjusted';
    }

    // Clamp
    positionPct = Math.min(positionPct, this.maxYoloPct);
    const value = portfolioValue * positionPct;

    // Skip tiny positions
    if (value < this.minPositionValue) {
      return { qty: 0, value: 0, method: 'skip', reason: `Position value $${value.toFixed(2)} below minimum $${this.minPositionValue}` };
    }

    const qty = Math.floor(value / price);
    if (qty === 0) {
      // For expensive assets (BTC), allow fractional
      const fractionalQty = Math.round((value / price) * 1e8) / 1e8;
      return {
        qty: fractionalQty,
        value: Math.round(fractionalQty * price * 100) / 100,
        method,
        positionPct: Math.round(positionPct * 10000) / 100,
      };
    }

    return {
      qty,
      value: Math.round(qty * price * 100) / 100,
      method,
      positionPct: Math.round(positionPct * 10000) / 100,
    };
  }
}
