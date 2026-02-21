// Position Sizing Algorithm
// Determines trade size based on confidence, volatility, and risk parameters
// Enhanced with regime-adjusted Kelly, drawdown scaling, and rolling estimation

// Per STRATEGY-V2 Section 6.3: Kelly fractions by regime
const REGIME_KELLY_FRACTIONS = {
  bull_low_vol:  0.50,  // Aggressive
  bear_high_vol: 0.25,  // Conservative
  range_bound:   0.40,  // Moderate
  uncertain:     0.20,  // Minimum
};

// Per STRATEGY-V2 Section 6.3: Strategy-specific Kelly parameters
const STRATEGY_KELLY_DEFAULTS = {
  mean_reversion:    { winRate: 0.62, rewardRisk: 1.2 },
  momentum:          { winRate: 0.55, rewardRisk: 2.0 },
  pairs_trading:     { winRate: 0.55, rewardRisk: 1.5 },
  sentiment_momentum: { winRate: 0.58, rewardRisk: 1.3 },
};

export class PositionSizer {
  constructor({
    maxPositionPct = 0.10,    // Max % of portfolio per trade
    maxYoloPct = 0.25,        // Max % for high-conviction trades
    yoloThreshold = 0.85,     // Confidence threshold for YOLO sizing
    kellyFraction = 0.33,     // One-third Kelly per STRATEGY-V2 (crypto estimation uncertainty)
    minPositionValue = 100,   // Minimum trade value in dollars
    maxDrawdownScale = 0.50,  // At max drawdown threshold, scale to this fraction
    drawdownThreshold = 0.15, // Drawdown level where scaling kicks in
  } = {}) {
    this.maxPositionPct = maxPositionPct;
    this.maxYoloPct = maxYoloPct;
    this.yoloThreshold = yoloThreshold;
    this.kellyFraction = kellyFraction;
    this.minPositionValue = minPositionValue;
    this.maxDrawdownScale = maxDrawdownScale;
    this.drawdownThreshold = drawdownThreshold;
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

  // Kelly Criterion: K% = W - [(1-W) / R]
  // winRate: historical win probability (0-1)
  // avgWin: average winning trade return
  // avgLoss: average losing trade return (positive number)
  kellySize(winRate, avgWin, avgLoss) {
    if (avgLoss === 0) return 0;
    const kelly = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
    // Apply fraction and clamp
    return Math.max(0, Math.min(kelly * this.kellyFraction, this.maxYoloPct));
  }

  // Regime-adjusted Kelly: varies Kelly fraction by market regime
  // Per STRATEGY-V2 Section 5.4: different Kelly multipliers per regime
  regimeAdjustedKelly(winRate, avgWin, avgLoss, regime) {
    if (avgLoss === 0 || avgWin === 0) return 0;
    const fullKelly = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
    if (fullKelly <= 0) return 0;

    const fraction = REGIME_KELLY_FRACTIONS[regime] || this.kellyFraction;
    return Math.max(0, Math.min(fullKelly * fraction, this.maxYoloPct));
  }

  // Drawdown-adjusted Kelly: reduce position size during drawdowns
  // Linear scaling from full size at 0% DD to maxDrawdownScale at drawdownThreshold
  drawdownAdjustedKelly(kellyPct, currentDrawdown) {
    if (currentDrawdown <= 0 || kellyPct <= 0) return kellyPct;

    const ddRatio = Math.min(currentDrawdown / this.drawdownThreshold, 1);
    const scale = 1 - ddRatio * (1 - this.maxDrawdownScale);
    return kellyPct * scale;
  }

  // Estimate Kelly parameters from trade history
  // trades: array of { pnlPct } (percentage return per trade)
  // Returns { winRate, avgWin, avgLoss, kellyPct, sampleSize }
  rollingKellyEstimate(trades, window = 50) {
    if (!trades || trades.length < 10) return null;

    const recent = trades.slice(-window);
    const wins = recent.filter(t => t.pnlPct > 0);
    const losses = recent.filter(t => t.pnlPct <= 0);

    if (wins.length === 0 || losses.length === 0) return null;

    const winRate = wins.length / recent.length;
    const avgWin = wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length;
    const avgLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length);

    const kellyPct = this.kellySize(winRate, avgWin, avgLoss);

    return {
      winRate: Math.round(winRate * 100) / 100,
      avgWin: Math.round(avgWin * 10000) / 10000,
      avgLoss: Math.round(avgLoss * 10000) / 10000,
      kellyPct: Math.round(kellyPct * 10000) / 10000,
      sampleSize: recent.length,
    };
  }

  // Risk parity weights across strategies
  // strategyVols: { stratName: volatility } — realized vol per strategy
  // Returns: { stratName: weight } — capital allocation weights (sum to 1)
  riskParityWeights(strategyVols) {
    const entries = Object.entries(strategyVols).filter(([, v]) => v > 0);
    if (entries.length === 0) return {};

    // Inverse-volatility weighting
    const invVols = entries.map(([name, vol]) => [name, 1 / vol]);
    const totalInvVol = invVols.reduce((s, [, iv]) => s + iv, 0);

    const weights = {};
    for (const [name, iv] of invVols) {
      weights[name] = Math.round((iv / totalInvVol) * 10000) / 10000;
    }
    return weights;
  }

  // Strategy-aware Kelly: uses STRATEGY-V2 default parameters if no history
  strategyKellySize(strategyName, regime = null, trades = null) {
    // Try rolling estimate from actual trades first
    if (trades && trades.length >= 10) {
      const estimate = this.rollingKellyEstimate(trades);
      if (estimate && estimate.kellyPct > 0) {
        if (regime) {
          return this.regimeAdjustedKelly(
            estimate.winRate, estimate.avgWin, estimate.avgLoss, regime,
          );
        }
        return estimate.kellyPct;
      }
    }

    // Fall back to STRATEGY-V2 defaults
    const defaults = STRATEGY_KELLY_DEFAULTS[strategyName];
    if (!defaults) return 0;

    const { winRate, rewardRisk } = defaults;
    // Convert R/R ratio to avgWin/avgLoss: assume avgLoss = 1 unit
    const avgWin = rewardRisk;
    const avgLoss = 1;

    if (regime) {
      return this.regimeAdjustedKelly(winRate, avgWin, avgLoss, regime);
    }
    return this.kellySize(winRate, avgWin, avgLoss);
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
    regime,        // market regime for regime-adjusted Kelly (optional)
    currentDrawdown, // current portfolio drawdown 0-1 (optional)
    strategyName,  // strategy name for default Kelly params (optional)
    trades,        // trade history for rolling Kelly (optional)
  }) {
    if (portfolioValue <= 0 || price <= 0 || confidence <= 0) {
      return { qty: 0, value: 0, method: 'none', reason: 'Invalid inputs' };
    }

    let positionPct;
    let method;

    // Try strategy-aware Kelly with rolling estimation
    if (strategyName && !winRate) {
      const kellyPct = this.strategyKellySize(strategyName, regime, trades);
      if (kellyPct > 0) {
        positionPct = kellyPct * confidence;
        method = regime ? 'kelly+regime' : 'kelly+strategy';
      }
    }

    // Try Kelly if we have historical stats
    if (!method && winRate !== undefined && avgWinReturn !== undefined && avgLossReturn !== undefined) {
      let kellyPct;
      if (regime) {
        kellyPct = this.regimeAdjustedKelly(winRate, avgWinReturn, avgLossReturn, regime);
        method = 'kelly+regime';
      } else {
        kellyPct = this.kellySize(winRate, avgWinReturn, avgLossReturn);
        method = 'kelly';
      }
      if (kellyPct > 0) {
        positionPct = kellyPct * confidence;
      } else {
        method = undefined; // Fall through to standard
      }
    }

    // Apply drawdown adjustment if in drawdown
    if (method && currentDrawdown && currentDrawdown > 0) {
      positionPct = this.drawdownAdjustedKelly(positionPct, currentDrawdown);
      method += '+dd_adjusted';
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
