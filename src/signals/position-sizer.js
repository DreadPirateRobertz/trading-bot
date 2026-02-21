// Position Sizing Algorithm
// Determines trade size based on confidence, volatility, and risk parameters
// Enhanced with regime-adjusted Kelly, drawdown scaling, rolling estimation,
// adaptive fractional Kelly, optimal-f, cost-adjusted Kelly, and portfolio Kelly

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

  // Value at Risk (VaR) — parametric, assuming normal returns
  // Returns the maximum expected loss at a given confidence level
  // confidenceLevel: 0.95 = 95% VaR, 0.99 = 99% VaR
  calculateVaR(returns, confidenceLevel = 0.95) {
    if (!returns || returns.length < 10) return null;

    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    // Z-scores for common confidence levels
    const zScores = { 0.90: 1.282, 0.95: 1.645, 0.99: 2.326 };
    const z = zScores[confidenceLevel] || 1.645;

    return -(mean - z * stdDev);
  }

  // Historical VaR — uses sorted actual returns (non-parametric)
  calculateHistoricalVaR(returns, confidenceLevel = 0.95) {
    if (!returns || returns.length < 10) return null;
    const sorted = [...returns].sort((a, b) => a - b);
    const idx = Math.floor((1 - confidenceLevel) * sorted.length);
    return -sorted[idx];
  }

  // Conditional VaR (Expected Shortfall / CVaR)
  // Average of losses beyond VaR — captures tail risk
  calculateCVaR(returns, confidenceLevel = 0.95) {
    if (!returns || returns.length < 10) return null;
    const sorted = [...returns].sort((a, b) => a - b);
    const cutoffIdx = Math.floor((1 - confidenceLevel) * sorted.length);
    if (cutoffIdx === 0) return -sorted[0];

    const tail = sorted.slice(0, cutoffIdx + 1);
    const avgTailLoss = tail.reduce((a, b) => a + b, 0) / tail.length;
    return -avgTailLoss;
  }

  // VaR-constrained Kelly: caps position so portfolio VaR stays within limit
  // maxVaRPct: maximum acceptable daily VaR as fraction of portfolio (e.g., 0.02 = 2%)
  varConstrainedKelly(kellyPct, returns, maxVaRPct = 0.02, confidenceLevel = 0.95) {
    if (kellyPct <= 0) return 0;
    if (!returns || returns.length < 10) return kellyPct;

    const var95 = this.calculateVaR(returns, confidenceLevel);
    if (var95 === null || var95 <= 0) return kellyPct;

    // Scale: if position's VaR exceeds maxVaRPct, scale down proportionally
    const positionVaR = kellyPct * var95;
    if (positionVaR <= maxVaRPct) return kellyPct;
    return (maxVaRPct / var95);
  }

  // CVaR-constrained Kelly: caps position so tail risk stays within limit
  // More conservative than VaR — accounts for extreme losses
  cvarConstrainedKelly(kellyPct, returns, maxCVaRPct = 0.03, confidenceLevel = 0.95) {
    if (kellyPct <= 0) return 0;
    if (!returns || returns.length < 10) return kellyPct;

    const cvar = this.calculateCVaR(returns, confidenceLevel);
    if (cvar === null || cvar <= 0) return kellyPct;

    const positionCVaR = kellyPct * cvar;
    if (positionCVaR <= maxCVaRPct) return kellyPct;
    return (maxCVaRPct / cvar);
  }

  // Adaptive fractional Kelly: adjusts fraction between 0.20-0.50 based on
  // estimation quality (sample size) and market regime
  // More data = higher confidence = closer to half-Kelly
  // Less data = more uncertainty = closer to quarter-Kelly
  adaptiveKellyFraction(sampleSize, regime = null) {
    // Base fraction from regime (or default)
    const regimeFraction = REGIME_KELLY_FRACTIONS[regime] || this.kellyFraction;

    // Sample size confidence adjustment
    // <20 trades: minimum confidence, use 60% of regime fraction
    // 20-50 trades: scaling confidence
    // 50-100 trades: near-full confidence
    // >100 trades: full regime fraction
    let sampleConfidence;
    if (sampleSize < 20) {
      sampleConfidence = 0.60;
    } else if (sampleSize < 50) {
      sampleConfidence = 0.60 + 0.30 * ((sampleSize - 20) / 30);
    } else if (sampleSize < 100) {
      sampleConfidence = 0.90 + 0.10 * ((sampleSize - 50) / 50);
    } else {
      sampleConfidence = 1.0;
    }

    const fraction = regimeFraction * sampleConfidence;
    // Clamp to [0.20, 0.50] per STRATEGY-V2
    return Math.max(0.20, Math.min(fraction, 0.50));
  }

  // Transaction cost-adjusted Kelly
  // Reduces optimal Kelly by the drag of round-trip transaction costs
  // roundTripCostPct: total cost of entry + exit (spread + fees + slippage)
  // Per Kelly theory: K_adj = K - (c / avgWin) where c = round-trip cost
  costAdjustedKelly(kellyPct, roundTripCostPct, avgWin) {
    if (kellyPct <= 0 || avgWin <= 0) return 0;
    const costDrag = roundTripCostPct / avgWin;
    return Math.max(0, kellyPct - costDrag);
  }

  // Ralph Vince's Optimal-f: fraction that maximizes terminal wealth
  // given the worst historical loss. More conservative than Kelly for
  // finite samples with fat tails (crypto).
  // trades: array of { pnlPct }
  // Returns { optimalF, terminalWealth, worstLoss }
  optimalF(trades) {
    if (!trades || trades.length < 10) return null;

    const pnls = trades.map(t => t.pnlPct);
    const worstLoss = Math.min(...pnls);
    if (worstLoss >= 0) return null; // No losses — can't compute optimal-f

    // Search f from 0.01 to 1.0 in steps of 0.01
    // TWR(f) = product of (1 + f * pnl / |worstLoss|)
    let bestF = 0;
    let bestTWR = 1;

    for (let f = 0.01; f <= 1.0; f += 0.01) {
      let twr = 1;
      let valid = true;
      for (const pnl of pnls) {
        const hpr = 1 + f * (pnl / Math.abs(worstLoss));
        if (hpr <= 0) { valid = false; break; }
        twr *= hpr;
      }
      if (valid && twr > bestTWR) {
        bestTWR = twr;
        bestF = f;
      }
    }

    if (bestF === 0) return null;

    // Convert optimal-f to position size: positionPct = f * |worstLoss|
    // But we apply the standard kellyFraction for safety
    return {
      optimalF: Math.round(bestF * 100) / 100,
      terminalWealth: Math.round(bestTWR * 10000) / 10000,
      worstLoss: Math.round(worstLoss * 10000) / 10000,
      positionPct: Math.round(bestF * Math.abs(worstLoss) * this.kellyFraction * 10000) / 10000,
    };
  }

  // Exponentially-weighted Kelly estimation
  // Weights recent trades more heavily using exponential decay
  // halfLife: number of trades for weight to decay by 50%
  exponentialKellyEstimate(trades, halfLife = 20) {
    if (!trades || trades.length < 10) return null;

    const lambda = Math.log(2) / halfLife;
    const n = trades.length;

    let weightedWins = 0, weightedLosses = 0;
    let winWeight = 0, lossWeight = 0;
    let totalWeight = 0;

    for (let i = 0; i < n; i++) {
      const age = n - 1 - i; // 0 = most recent
      const w = Math.exp(-lambda * age);
      totalWeight += w;

      if (trades[i].pnlPct > 0) {
        weightedWins += w;
        winWeight += w * trades[i].pnlPct;
      } else {
        weightedLosses += w;
        lossWeight += w * Math.abs(trades[i].pnlPct);
      }
    }

    if (weightedWins === 0 || weightedLosses === 0) return null;

    const winRate = weightedWins / totalWeight;
    const avgWin = winWeight / weightedWins;
    const avgLoss = lossWeight / weightedLosses;

    const kellyPct = this.kellySize(winRate, avgWin, avgLoss);

    return {
      winRate: Math.round(winRate * 100) / 100,
      avgWin: Math.round(avgWin * 10000) / 10000,
      avgLoss: Math.round(avgLoss * 10000) / 10000,
      kellyPct: Math.round(kellyPct * 10000) / 10000,
      effectiveSampleSize: Math.round(totalWeight * 100) / 100,
    };
  }

  // Bootstrap Kelly confidence interval
  // Resamples trade history to estimate confidence bounds on Kelly %
  // Returns { lower, median, upper, spread } at given confidence level
  kellyConfidenceInterval(trades, alpha = 0.05, nBootstrap = 1000) {
    if (!trades || trades.length < 15) return null;

    const kellys = [];

    for (let b = 0; b < nBootstrap; b++) {
      // Resample with replacement
      const sample = [];
      for (let i = 0; i < trades.length; i++) {
        sample.push(trades[Math.floor(Math.random() * trades.length)]);
      }

      const wins = sample.filter(t => t.pnlPct > 0);
      const losses = sample.filter(t => t.pnlPct <= 0);
      if (wins.length === 0 || losses.length === 0) {
        kellys.push(0);
        continue;
      }

      const winRate = wins.length / sample.length;
      const avgWin = wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length;
      const avgLoss = Math.abs(losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length);

      const k = this.kellySize(winRate, avgWin, avgLoss);
      kellys.push(k);
    }

    kellys.sort((a, b) => a - b);
    const lowerIdx = Math.floor((alpha / 2) * nBootstrap);
    const upperIdx = Math.floor((1 - alpha / 2) * nBootstrap);
    const medianIdx = Math.floor(0.5 * nBootstrap);

    return {
      lower: Math.round(kellys[lowerIdx] * 10000) / 10000,
      median: Math.round(kellys[medianIdx] * 10000) / 10000,
      upper: Math.round(kellys[upperIdx] * 10000) / 10000,
      spread: Math.round((kellys[upperIdx] - kellys[lowerIdx]) * 10000) / 10000,
    };
  }

  // Multi-asset portfolio Kelly sizing
  // Given multiple position candidates with their Kelly sizes and a correlation
  // matrix, reduces positions to account for portfolio-level risk concentration
  // positions: [{ name, kellyPct, returns }]
  // Returns: { name: adjustedKellyPct }
  portfolioKelly(positions) {
    if (!positions || positions.length === 0) return {};
    if (positions.length === 1) {
      return { [positions[0].name]: positions[0].kellyPct };
    }

    // Compute pairwise correlations
    const n = positions.length;
    const corr = Array.from({ length: n }, () => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      corr[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        const c = this._pearsonCorrelation(positions[i].returns, positions[j].returns);
        corr[i][j] = c;
        corr[j][i] = c;
      }
    }

    // Diversification adjustment: scale each position by its average
    // non-self correlation. High correlation = more concentration risk = scale down.
    // diversificationFactor = 1 / sqrt(1 + (n-1) * avgCorr)
    const result = {};
    for (let i = 0; i < n; i++) {
      let sumCorr = 0;
      for (let j = 0; j < n; j++) {
        if (i !== j) sumCorr += Math.abs(corr[i][j]);
      }
      const avgCorr = sumCorr / (n - 1);
      const divFactor = 1 / Math.sqrt(1 + (n - 1) * avgCorr);
      result[positions[i].name] = Math.round(positions[i].kellyPct * divFactor * 10000) / 10000;
    }

    return result;
  }

  // Pearson correlation between two return series
  _pearsonCorrelation(x, y) {
    const len = Math.min(x.length, y.length);
    if (len < 5) return 0;

    const xs = x.slice(-len);
    const ys = y.slice(-len);

    const meanX = xs.reduce((a, b) => a + b, 0) / len;
    const meanY = ys.reduce((a, b) => a + b, 0) / len;

    let cov = 0, varX = 0, varY = 0;
    for (let i = 0; i < len; i++) {
      const dx = xs[i] - meanX;
      const dy = ys[i] - meanY;
      cov += dx * dy;
      varX += dx * dx;
      varY += dy * dy;
    }

    const denom = Math.sqrt(varX * varY);
    if (denom === 0) return 0;
    return cov / denom;
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
    returns,       // historical returns array for VaR/CVaR constraints (optional)
    maxVaRPct,     // max acceptable daily VaR as fraction (optional, default 0.02)
    maxCVaRPct,    // max acceptable daily CVaR as fraction (optional, default 0.03)
    transactionCostPct, // round-trip cost: spread + fees + slippage (optional)
    useAdaptiveFraction, // use sample-size-adaptive Kelly fraction (optional)
    useExponentialWeighting, // use exponential weighting for rolling Kelly (optional)
  }) {
    if (portfolioValue <= 0 || price <= 0 || confidence <= 0) {
      return { qty: 0, value: 0, method: 'none', reason: 'Invalid inputs' };
    }

    let positionPct;
    let method;

    // Try strategy-aware Kelly with rolling estimation
    if (strategyName && !winRate) {
      let kellyPct;
      // Use exponential weighting if requested
      if (useExponentialWeighting && trades && trades.length >= 10) {
        const expEstimate = this.exponentialKellyEstimate(trades);
        if (expEstimate && expEstimate.kellyPct > 0) {
          kellyPct = expEstimate.kellyPct;
          method = 'kelly+exp_weighted';
        }
      }
      if (!kellyPct) {
        kellyPct = this.strategyKellySize(strategyName, regime, trades);
        if (kellyPct > 0) {
          method = regime ? 'kelly+regime' : 'kelly+strategy';
        }
      }
      // Apply adaptive fraction if requested
      if (kellyPct > 0 && useAdaptiveFraction && trades) {
        const adaptiveFrac = this.adaptiveKellyFraction(trades.length, regime);
        // Re-scale: undo the default fraction, apply adaptive
        kellyPct = (kellyPct / this.kellyFraction) * adaptiveFrac;
        method += '+adaptive';
      }
      if (kellyPct > 0) {
        positionPct = kellyPct * confidence;
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
        // Apply adaptive fraction if requested with explicit stats
        if (useAdaptiveFraction && trades) {
          const adaptiveFrac = this.adaptiveKellyFraction(trades.length, regime);
          kellyPct = (kellyPct / (REGIME_KELLY_FRACTIONS[regime] || this.kellyFraction)) * adaptiveFrac;
          method += '+adaptive';
        }
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

    // Apply VaR/CVaR constraints if returns data provided
    if (method && returns && returns.length >= 10) {
      if (maxCVaRPct !== undefined) {
        positionPct = this.cvarConstrainedKelly(positionPct, returns, maxCVaRPct);
        method += '+cvar';
      } else if (maxVaRPct !== undefined) {
        positionPct = this.varConstrainedKelly(positionPct, returns, maxVaRPct);
        method += '+var';
      }
    }

    // Apply transaction cost adjustment
    if (method && transactionCostPct && transactionCostPct > 0) {
      const effectiveAvgWin = avgWinReturn || 0.05; // fallback estimate
      positionPct = this.costAdjustedKelly(positionPct, transactionCostPct, effectiveAvgWin);
      method += '+cost_adj';
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
