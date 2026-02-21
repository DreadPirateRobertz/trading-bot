// Portfolio Risk Manager
// Sits between signal engine and execution layer to enforce portfolio-level risk limits.
// Covers: portfolio heat, per-symbol concentration, sector limits, correlation guard,
// circuit breaker, daily loss limits, and drawdown-based position scaling.

export class PortfolioRiskManager {
  constructor({
    // Portfolio heat: max total exposure as % of portfolio value
    maxPortfolioHeat = 0.60,      // 60% max total exposure
    // Per-symbol: max allocation to any single asset
    maxSymbolPct = 0.25,          // 25% max per symbol
    // Sector/category limits
    maxSectorPct = 0.40,          // 40% max per sector
    // Correlation guard: reduce allocation when correlated positions exist
    correlationThreshold = 0.70,  // correlation above this triggers reduction
    correlationPenalty = 0.50,    // scale position by this factor when correlated
    // Circuit breaker: halt all trading
    circuitBreakerDrawdown = 0.20,  // halt at 20% portfolio drawdown
    circuitBreakerLossVelocity = 0.05, // halt if losing >5% in circuitBreakerWindow
    circuitBreakerWindow = 60,    // window in bars for loss velocity check
    circuitBreakerCooldown = 120, // bars to wait after circuit breaker triggers
    // Daily loss limit
    dailyLossLimit = 0.03,        // stop trading if daily loss exceeds 3%
    // Min time between trades on same symbol (prevent overtrading)
    minTradeCooldownBars = 5,
  } = {}) {
    this.config = {
      maxPortfolioHeat, maxSymbolPct, maxSectorPct,
      correlationThreshold, correlationPenalty,
      circuitBreakerDrawdown, circuitBreakerLossVelocity,
      circuitBreakerWindow, circuitBreakerCooldown,
      dailyLossLimit, minTradeCooldownBars,
    };

    // State tracking
    this.positions = new Map();           // symbol -> { qty, avgPrice, sector }
    this.equityHistory = [];              // track equity over time
    this.peakEquity = 0;
    this.dailyStartEquity = 0;
    this.currentEquity = 0;
    this.barCount = 0;

    // Circuit breaker state
    this.circuitBreakerActive = false;
    this.circuitBreakerTriggeredAt = 0;
    this.circuitBreakerReason = null;

    // Trade cooldown per symbol
    this.lastTradeBar = new Map();        // symbol -> last trade bar

    // Sector mapping
    this.sectorMap = new Map();           // symbol -> sector

    // Return history for correlation
    this.returnHistory = new Map();       // symbol -> [returns]

    // Event log
    this.riskEvents = [];
  }

  // Register a symbol's sector for sector-level limits
  setSector(symbol, sector) {
    this.sectorMap.set(symbol, sector);
  }

  // Bulk set sectors: { 'BTCUSDT': 'crypto', 'AAPL': 'tech', ... }
  setSectors(sectorMapping) {
    for (const [symbol, sector] of Object.entries(sectorMapping)) {
      this.sectorMap.set(symbol, sector);
    }
  }

  // Update current portfolio state (call on every bar/tick)
  update({ equity, positions, bar }) {
    this.currentEquity = equity;
    this.barCount = bar !== undefined ? bar : this.barCount + 1;

    if (equity > this.peakEquity) this.peakEquity = equity;
    this.equityHistory.push(equity);

    // Trim history to reasonable length
    if (this.equityHistory.length > 5000) {
      this.equityHistory = this.equityHistory.slice(-2500);
    }

    // Update positions snapshot
    if (positions) {
      this.positions = new Map();
      for (const [symbol, pos] of Object.entries(positions)) {
        this.positions.set(symbol, pos);
      }
    }

    // Check if circuit breaker cooldown has elapsed
    if (this.circuitBreakerActive) {
      const elapsed = this.barCount - this.circuitBreakerTriggeredAt;
      if (elapsed >= this.config.circuitBreakerCooldown) {
        this.circuitBreakerActive = false;
        this.circuitBreakerReason = null;
        this._logEvent('circuit_breaker_reset', { elapsed });
      }
    }

    // Check circuit breaker conditions
    this._checkCircuitBreaker();
  }

  // Set daily start equity (call at start of each trading day)
  startNewDay(equity) {
    this.dailyStartEquity = equity || this.currentEquity;
  }

  // Record a return for a symbol (for correlation tracking)
  recordReturn(symbol, ret) {
    if (!this.returnHistory.has(symbol)) {
      this.returnHistory.set(symbol, []);
    }
    const history = this.returnHistory.get(symbol);
    history.push(ret);
    if (history.length > 200) {
      this.returnHistory.set(symbol, history.slice(-100));
    }
  }

  // Main method: evaluate whether a proposed trade should be allowed
  // Returns { allowed, reason, adjustedQty, riskFlags }
  evaluateTrade({ symbol, side, qty, price, sector }) {
    const flags = [];

    // Always allow sells — risk reduction should never be blocked
    if (side === 'sell') {
      return { allowed: true, reason: 'sells always allowed', adjustedQty: qty, riskFlags: [] };
    }

    // Circuit breaker check (buys only)
    if (this.circuitBreakerActive) {
      return {
        allowed: false,
        reason: `Circuit breaker active: ${this.circuitBreakerReason}`,
        adjustedQty: 0,
        riskFlags: ['circuit_breaker'],
      };
    }

    // Daily loss limit
    if (this.dailyStartEquity > 0) {
      const dailyPnlPct = (this.currentEquity - this.dailyStartEquity) / this.dailyStartEquity;
      if (dailyPnlPct <= -this.config.dailyLossLimit) {
        this._logEvent('daily_loss_limit', { dailyPnlPct });
        return {
          allowed: false,
          reason: `Daily loss limit reached: ${(dailyPnlPct * 100).toFixed(2)}% (limit: -${(this.config.dailyLossLimit * 100).toFixed(1)}%)`,
          adjustedQty: 0,
          riskFlags: ['daily_loss_limit'],
        };
      }
    }

    // Trade cooldown check
    const lastBar = this.lastTradeBar.get(symbol);
    if (lastBar !== undefined && this.barCount - lastBar < this.config.minTradeCooldownBars) {
      flags.push('cooldown');
      return {
        allowed: false,
        reason: `Trade cooldown: ${this.config.minTradeCooldownBars - (this.barCount - lastBar)} bars remaining`,
        adjustedQty: 0,
        riskFlags: flags,
      };
    }

    let adjustedQty = qty;
    const tradeValue = qty * price;

    // 1. Portfolio heat check
    const currentExposure = this._totalExposure();
    const newExposure = currentExposure + tradeValue;
    const maxExposure = this.currentEquity * this.config.maxPortfolioHeat;

    if (newExposure > maxExposure) {
      const allowedValue = Math.max(0, maxExposure - currentExposure);
      adjustedQty = Math.floor(allowedValue / price);
      flags.push('portfolio_heat');
      if (adjustedQty <= 0) {
        this._logEvent('portfolio_heat_blocked', { currentExposure, maxExposure });
        return {
          allowed: false,
          reason: `Portfolio heat limit: exposure ${pct(currentExposure / this.currentEquity)} >= max ${pct(this.config.maxPortfolioHeat)}`,
          adjustedQty: 0,
          riskFlags: flags,
        };
      }
    }

    // 2. Per-symbol concentration
    const existingPos = this.positions.get(symbol);
    const existingValue = existingPos ? existingPos.qty * (existingPos.currentPrice || price) : 0;
    const newSymbolValue = existingValue + adjustedQty * price;
    const maxSymbolValue = this.currentEquity * this.config.maxSymbolPct;

    if (newSymbolValue > maxSymbolValue) {
      const allowedAdditional = Math.max(0, maxSymbolValue - existingValue);
      adjustedQty = Math.min(adjustedQty, Math.floor(allowedAdditional / price));
      flags.push('symbol_concentration');
      if (adjustedQty <= 0) {
        this._logEvent('symbol_concentration_blocked', { symbol, existingValue, maxSymbolValue });
        return {
          allowed: false,
          reason: `Symbol concentration limit: ${symbol} at ${pct(existingValue / this.currentEquity)} >= max ${pct(this.config.maxSymbolPct)}`,
          adjustedQty: 0,
          riskFlags: flags,
        };
      }
    }

    // 3. Sector concentration
    const effectiveSector = sector || this.sectorMap.get(symbol) || 'default';
    const sectorExposure = this._sectorExposure(effectiveSector, price);
    const newSectorValue = sectorExposure + adjustedQty * price;
    const maxSectorValue = this.currentEquity * this.config.maxSectorPct;

    if (newSectorValue > maxSectorValue) {
      const allowedAdditional = Math.max(0, maxSectorValue - sectorExposure);
      adjustedQty = Math.min(adjustedQty, Math.floor(allowedAdditional / price));
      flags.push('sector_concentration');
      if (adjustedQty <= 0) {
        this._logEvent('sector_blocked', { sector: effectiveSector, sectorExposure, maxSectorValue });
        return {
          allowed: false,
          reason: `Sector limit: ${effectiveSector} at ${pct(sectorExposure / this.currentEquity)} >= max ${pct(this.config.maxSectorPct)}`,
          adjustedQty: 0,
          riskFlags: flags,
        };
      }
    }

    // 4. Correlation guard
    const correlationPenalty = this._correlationPenalty(symbol);
    if (correlationPenalty < 1.0) {
      adjustedQty = Math.max(1, Math.floor(adjustedQty * correlationPenalty));
      flags.push('correlation_penalty');
    }

    return {
      allowed: adjustedQty > 0,
      reason: flags.length > 0 ? `Adjusted: ${flags.join(', ')}` : 'approved',
      adjustedQty,
      riskFlags: flags,
    };
  }

  // Record that a trade was executed (for cooldown tracking)
  recordTrade(symbol) {
    this.lastTradeBar.set(symbol, this.barCount);
  }

  // Manually trigger or reset circuit breaker
  triggerCircuitBreaker(reason) {
    this.circuitBreakerActive = true;
    this.circuitBreakerTriggeredAt = this.barCount;
    this.circuitBreakerReason = reason;
    this._logEvent('circuit_breaker_triggered', { reason, bar: this.barCount });
  }

  resetCircuitBreaker() {
    this.circuitBreakerActive = false;
    this.circuitBreakerReason = null;
    this._logEvent('circuit_breaker_manual_reset', { bar: this.barCount });
  }

  // Get comprehensive risk dashboard
  getRiskDashboard() {
    const totalExposure = this._totalExposure();
    const drawdown = this.peakEquity > 0
      ? (this.peakEquity - this.currentEquity) / this.peakEquity
      : 0;
    const dailyPnl = this.dailyStartEquity > 0
      ? (this.currentEquity - this.dailyStartEquity) / this.dailyStartEquity
      : 0;

    // Per-symbol exposures
    const symbolExposures = {};
    for (const [symbol, pos] of this.positions) {
      const value = pos.qty * (pos.currentPrice || pos.avgPrice || 0);
      symbolExposures[symbol] = {
        value: round(value),
        pctOfPortfolio: this.currentEquity > 0 ? round(value / this.currentEquity * 100) : 0,
        limit: round(this.config.maxSymbolPct * 100),
      };
    }

    // Sector exposures
    const sectorExposures = {};
    for (const [symbol, pos] of this.positions) {
      const sector = this.sectorMap.get(symbol) || 'default';
      const value = pos.qty * (pos.currentPrice || pos.avgPrice || 0);
      if (!sectorExposures[sector]) {
        sectorExposures[sector] = { value: 0, symbols: [] };
      }
      sectorExposures[sector].value += value;
      sectorExposures[sector].symbols.push(symbol);
    }
    for (const sector of Object.keys(sectorExposures)) {
      sectorExposures[sector].pctOfPortfolio = this.currentEquity > 0
        ? round(sectorExposures[sector].value / this.currentEquity * 100)
        : 0;
      sectorExposures[sector].value = round(sectorExposures[sector].value);
      sectorExposures[sector].limit = round(this.config.maxSectorPct * 100);
    }

    return {
      equity: round(this.currentEquity),
      peakEquity: round(this.peakEquity),
      drawdown: round(drawdown * 100),
      drawdownLimit: round(this.config.circuitBreakerDrawdown * 100),
      dailyPnl: round(dailyPnl * 100),
      dailyLossLimit: round(this.config.dailyLossLimit * 100),
      totalExposure: round(totalExposure),
      portfolioHeat: this.currentEquity > 0 ? round(totalExposure / this.currentEquity * 100) : 0,
      portfolioHeatLimit: round(this.config.maxPortfolioHeat * 100),
      circuitBreaker: {
        active: this.circuitBreakerActive,
        reason: this.circuitBreakerReason,
        triggeredAt: this.circuitBreakerTriggeredAt,
        cooldownRemaining: this.circuitBreakerActive
          ? Math.max(0, this.config.circuitBreakerCooldown - (this.barCount - this.circuitBreakerTriggeredAt))
          : 0,
      },
      symbolExposures,
      sectorExposures,
      recentEvents: this.riskEvents.slice(-20),
    };
  }

  // --- Internal methods ---

  _totalExposure() {
    let total = 0;
    for (const [, pos] of this.positions) {
      total += pos.qty * (pos.currentPrice || pos.avgPrice || 0);
    }
    return total;
  }

  _sectorExposure(sector, fallbackPrice) {
    let total = 0;
    for (const [symbol, pos] of this.positions) {
      const posSector = this.sectorMap.get(symbol) || 'default';
      if (posSector === sector) {
        total += pos.qty * (pos.currentPrice || pos.avgPrice || fallbackPrice || 0);
      }
    }
    return total;
  }

  _correlationPenalty(symbol) {
    const symbolReturns = this.returnHistory.get(symbol);
    if (!symbolReturns || symbolReturns.length < 20) return 1.0;

    let maxCorr = 0;
    for (const [otherSymbol, otherReturns] of this.returnHistory) {
      if (otherSymbol === symbol) continue;
      // Only check correlation with symbols we currently hold
      if (!this.positions.has(otherSymbol)) continue;
      if (otherReturns.length < 20) continue;

      const corr = Math.abs(pearsonCorrelation(symbolReturns, otherReturns));
      if (corr > maxCorr) maxCorr = corr;
    }

    if (maxCorr >= this.config.correlationThreshold) {
      return this.config.correlationPenalty;
    }
    return 1.0;
  }

  _checkCircuitBreaker() {
    if (this.circuitBreakerActive) return;

    // Check drawdown
    if (this.peakEquity > 0) {
      const drawdown = (this.peakEquity - this.currentEquity) / this.peakEquity;
      if (drawdown >= this.config.circuitBreakerDrawdown) {
        this.triggerCircuitBreaker(
          `Drawdown ${pct(drawdown)} exceeds limit ${pct(this.config.circuitBreakerDrawdown)}`
        );
        return;
      }
    }

    // Check loss velocity
    const window = this.config.circuitBreakerWindow;
    if (this.equityHistory.length > window) {
      const windowStart = this.equityHistory[this.equityHistory.length - 1 - window];
      const windowEnd = this.equityHistory[this.equityHistory.length - 1];
      const lossVelocity = (windowStart - windowEnd) / windowStart;
      if (lossVelocity >= this.config.circuitBreakerLossVelocity) {
        this.triggerCircuitBreaker(
          `Loss velocity ${pct(lossVelocity)} in ${window} bars exceeds limit ${pct(this.config.circuitBreakerLossVelocity)}`
        );
      }
    }
  }

  _logEvent(type, data) {
    this.riskEvents.push({
      type,
      bar: this.barCount,
      timestamp: Date.now(),
      ...data,
    });
    // Trim log
    if (this.riskEvents.length > 500) {
      this.riskEvents = this.riskEvents.slice(-250);
    }
  }
}

// Pearson correlation between two arrays
function pearsonCorrelation(x, y) {
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

function round(n) { return Math.round(n * 100) / 100; }
function pct(n) { return `${(n * 100).toFixed(1)}%`; }
