// Paper Trading Infrastructure
// Simulates trades without real money for strategy validation

export class PaperTrader {
  constructor({ initialBalance = 100000, maxPositionPct = 0.10 } = {}) {
    this.cash = initialBalance;
    this.initialBalance = initialBalance;
    this.maxPositionPct = maxPositionPct;
    this.positions = new Map();    // symbol -> { qty, avgPrice, side }
    this.tradeHistory = [];
    this.createdAt = new Date();
  }

  get portfolioValue() {
    // Uses last known market prices if available, falls back to cost basis
    let positionValue = 0;
    for (const [symbol, pos] of this.positions) {
      const markPrice = this.lastPrices?.get(symbol) ?? pos.avgPrice;
      positionValue += pos.qty * markPrice;
    }
    return this.cash + positionValue;
  }

  // Update mark-to-market prices for accurate portfolio valuation
  updatePrices(priceMap) {
    if (!this.lastPrices) this.lastPrices = new Map();
    for (const [symbol, price] of Object.entries(priceMap)) {
      this.lastPrices.set(symbol, price);
    }
  }

  get pnl() {
    return this.portfolioValue - this.initialBalance;
  }

  get pnlPct() {
    return (this.pnl / this.initialBalance) * 100;
  }

  calculatePositionSize(price, signal) {
    const maxValue = this.portfolioValue * this.maxPositionPct;
    // Scale by confidence
    const scaledMax = maxValue * (signal.confidence ?? 0.5);
    const qty = Math.floor(scaledMax / price);
    return Math.max(qty, 0);
  }

  buy(symbol, qty, price) {
    const cost = qty * price;
    if (cost > this.cash) {
      return { success: false, reason: 'Insufficient funds' };
    }
    this.cash -= cost;
    const existing = this.positions.get(symbol);
    if (existing && existing.side === 'long') {
      const totalQty = existing.qty + qty;
      existing.avgPrice = (existing.avgPrice * existing.qty + price * qty) / totalQty;
      existing.qty = totalQty;
    } else {
      this.positions.set(symbol, { qty, avgPrice: price, side: 'long' });
    }
    const trade = {
      symbol, side: 'buy', qty, price, cost,
      timestamp: new Date(), cash: this.cash,
    };
    this.tradeHistory.push(trade);
    return { success: true, trade };
  }

  sell(symbol, qty, price) {
    const pos = this.positions.get(symbol);
    if (!pos || pos.qty < qty) {
      return { success: false, reason: `Insufficient position in ${symbol}` };
    }
    const proceeds = qty * price;
    const pnl = (price - pos.avgPrice) * qty;
    this.cash += proceeds;
    pos.qty -= qty;
    if (pos.qty === 0) this.positions.delete(symbol);
    const trade = {
      symbol, side: 'sell', qty, price, proceeds, pnl,
      timestamp: new Date(), cash: this.cash,
    };
    this.tradeHistory.push(trade);
    return { success: true, trade };
  }

  getPosition(symbol) {
    return this.positions.get(symbol) || null;
  }

  getSummary() {
    return {
      cash: Math.round(this.cash * 100) / 100,
      portfolioValue: Math.round(this.portfolioValue * 100) / 100,
      pnl: Math.round(this.pnl * 100) / 100,
      pnlPct: Math.round(this.pnlPct * 100) / 100,
      positions: Object.fromEntries(this.positions),
      tradeCount: this.tradeHistory.length,
      createdAt: this.createdAt,
    };
  }
}
